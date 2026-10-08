import type { Request } from 'express';
import { sqlite } from '../db/client';

const ins = sqlite.prepare('INSERT INTO audit_log (ts, user_id, user_email, action, entity, entity_id, details, ip) VALUES (?,?,?,?,?,?,?,?)');

export function audit(req: Request, action: string, entity?: string | null, entityId?: string | number | null, details?: Record<string, unknown>, userOverride?: { id: number; email: string }) {
  const u = userOverride ?? req.session?.user;
  try {
    ins.run(new Date().toISOString(), u?.id ?? null, u?.email ?? null, action, entity ?? null, entityId != null ? String(entityId) : null, details ? JSON.stringify(details) : null, req.ip ?? null);
  } catch (e) {
    console.error('[audit] failed to write', e);
  }
}
