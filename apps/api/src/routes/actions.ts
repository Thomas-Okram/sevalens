import { Router, type Request } from 'express';
import { actionCreateSchema, actionsQuerySchema, actionUpdateSchema, idParamSchema, type ActionsResponse, type FieldAction } from '@sevalens/shared';
import { sqlite } from '../db/client';
import { getSnapshot } from '../services/snapshot';
import { assertInScope, currentUser, districtScope, effectiveDistrict } from '../middleware/auth';
import { audit } from '../lib/audit';
import { h, HttpError, parse } from '../lib/http';

/** Field actions: insight -> assigned task. Officers are pinned to their district; state admin sees all. */
export const actionsRouter = Router();

const today = () => new Date().toISOString().slice(0, 10);

const SELECT = `SELECT a.id, a.district_id AS districtId, d.name AS districtName, a.block_id AS blockId, b.name AS blockName,
    a.anomaly_id AS anomalyId, a.title, a.assigned_to_user_id AS assignedToUserId, ua.name AS assignedToName,
    a.due_date AS dueDate, a.status, a.notes, a.created_by AS createdBy, uc.name AS createdByName, a.created_at AS createdAt, a.updated_at AS updatedAt
  FROM field_actions a
  JOIN districts d ON d.id = a.district_id
  JOIN blocks b ON b.id = a.block_id
  JOIN users ua ON ua.id = a.assigned_to_user_id
  JOIN users uc ON uc.id = a.created_by`;

const withOverdue = (r: Omit<FieldAction, 'overdue'>, now = today()): FieldAction => ({ ...r, overdue: r.status !== 'done' && r.dueDate < now });

function loadAction(req: Request, id: number): FieldAction {
  const r = sqlite.prepare(`${SELECT} WHERE a.id = ?`).get(id) as Omit<FieldAction, 'overdue'> | undefined;
  if (!r) throw new HttpError(404, 'Action not found.');
  assertInScope(req, r.districtId);
  return withOverdue(r);
}

/** Assignee must be a state admin or a user of the action's district. */
function assertAssignable(userId: number, districtId: number) {
  const u = sqlite.prepare('SELECT role, district_id AS districtId FROM users WHERE id = ?').get(userId) as { role: string; districtId: number | null } | undefined;
  if (!u) throw new HttpError(400, 'Assignee not found.');
  if (u.role !== 'STATE_ADMIN' && u.districtId !== districtId) throw new HttpError(400, 'Assignee must work in this district.');
}

actionsRouter.get('/', h((req, res) => {
  const query = parse(actionsQuerySchema, req.query);
  const d = effectiveDistrict(req, query.districtId);
  const where: string[] = [];
  const params: unknown[] = [];
  if (d !== undefined) { where.push('a.district_id = ?'); params.push(d); }
  if (query.status) { where.push('a.status = ?'); params.push(query.status); }
  const rows = sqlite.prepare(`${SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY a.due_date, a.id`).all(...params) as Omit<FieldAction, 'overdue'>[];
  const scope = districtScope(req);
  const assignees = sqlite
    .prepare(`SELECT id, name, district_id AS districtId FROM users WHERE ? IS NULL OR role = 'STATE_ADMIN' OR district_id = ? ORDER BY role DESC, name`)
    .all(scope, scope) as ActionsResponse['assignees'];
  const now = today();
  const body: ActionsResponse = { actions: rows.map((r) => withOverdue(r, now)), assignees, today: now };
  res.json(body);
}));

actionsRouter.get('/:id', h((req, res) => {
  const { id } = parse(idParamSchema, req.params);
  res.json({ action: loadAction(req, id) });
}));

actionsRouter.post('/', h((req, res) => {
  const body = parse(actionCreateSchema, req.body);
  assertInScope(req, body.districtId);
  const s = getSnapshot();
  if (!s.blocks.some((b) => b.id === body.blockId && b.districtId === body.districtId)) throw new HttpError(400, 'Block is not in this district.');
  if (body.anomalyId && !s.anomalies.some((a) => a.key === body.anomalyId && a.districtId === body.districtId)) throw new HttpError(400, 'Anomaly not found in this district.');
  assertAssignable(body.assignedToUserId, body.districtId);
  const u = currentUser(req);
  const now = new Date().toISOString();
  const { lastInsertRowid } = sqlite
    .prepare(`INSERT INTO field_actions (district_id, block_id, anomaly_id, title, assigned_to_user_id, due_date, status, notes, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,'open',?,?,?,?)`)
    .run(body.districtId, body.blockId, body.anomalyId ?? null, body.title, body.assignedToUserId, body.dueDate, body.notes || null, u.id, now, now);
  const id = Number(lastInsertRowid);
  audit(req, 'action.create', 'field_action', id, { districtId: body.districtId, blockId: body.blockId, anomalyId: body.anomalyId ?? null, assignedToUserId: body.assignedToUserId, dueDate: body.dueDate, status: 'open' });
  res.status(201).json({ action: loadAction(req, id) });
}));

actionsRouter.patch('/:id', h((req, res) => {
  const { id } = parse(idParamSchema, req.params);
  const body = parse(actionUpdateSchema, req.body);
  const before = loadAction(req, id);
  if (body.assignedToUserId !== undefined) assertAssignable(body.assignedToUserId, before.districtId);
  const cols = { title: 'title', assignedToUserId: 'assigned_to_user_id', dueDate: 'due_date', status: 'status', notes: 'notes' } as const;
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, col] of Object.entries(cols) as [keyof typeof cols, string][]) {
    if (body[k] === undefined) continue;
    sets.push(`${col} = ?`);
    params.push(k === 'notes' ? body.notes || null : body[k]);
  }
  sqlite.prepare(`UPDATE field_actions SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...params, new Date().toISOString(), id);
  if (body.status !== undefined && body.status !== before.status) audit(req, 'action.status', 'field_action', id, { from: before.status, to: body.status });
  const changed = (Object.keys(body) as (keyof typeof body)[]).filter((k) => k !== 'status' && body[k] !== before[k]);
  if (changed.length) audit(req, 'action.update', 'field_action', id, { fields: changed });
  res.json({ action: loadAction(req, id) });
}));

actionsRouter.delete('/:id', h((req, res) => {
  const { id } = parse(idParamSchema, req.params);
  const before = loadAction(req, id);
  sqlite.prepare('DELETE FROM field_actions WHERE id = ?').run(id);
  audit(req, 'action.delete', 'field_action', id, { title: before.title, status: before.status });
  res.json({ ok: true });
}));
