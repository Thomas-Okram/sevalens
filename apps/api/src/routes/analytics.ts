import { Router, type Request } from 'express';
import {
  anomaliesQuerySchema,
  idParamSchema,
  pendencyQuerySchema,
  reviewSchema,
  type AnomalyDetail,
  type AnomaliesResponse,
  type DataStamp,
  type DistrictDetail,
  type Kpis,
  type MonthlyPoint,
  type Overview,
  type PendencyResponse,
  type PendingApplication,
  type BeneficiaryView,
  type AuditEntry,
} from '@sevalens/shared';
import { z } from 'zod';
import { sqlite } from '../db/client';
import { AGE_BUCKETS, ATTENTION_LEVELS, ATTENTION_SCALES, ATTENTION_WEIGHTS, ANOMALY, STAGE_LABELS, bucketIndex, bucketize, mergeCoverage, nameSimilarity, summarizePendency } from '../analytics';
import { ageInDays, asOfMs } from '../analytics/pendency';
import { getSnapshot, invalidateReviews, type Snapshot } from '../services/snapshot';
import { assertInScope, currentUser, districtScope, effectiveDistrict, requireRole } from '../middleware/auth';
import { audit } from '../lib/audit';
import { h, HttpError, parse } from '../lib/http';
import { maskAadhaar, maskName } from '../lib/mask';
import { aiEnabled, aiModel } from '../ai/llm';
import { scrub } from '../ai/sanitize';

export const analyticsRouter = Router();

const stamp = (s: Snapshot): DataStamp => ({ dataAsOf: s.asOf, computedAt: s.computedAt, synthetic: true });

function scopedDistricts(req: Request, s: Snapshot) {
  const scope = districtScope(req);
  return scope === null ? s.districtSummaries : s.districtSummaries.filter((d) => d.id === scope);
}

function scopedAnomalies(req: Request, s: Snapshot) {
  const scope = districtScope(req);
  return scope === null ? s.anomalies : s.anomalies.filter((a) => a.districtId === scope);
}

export function buildKpis(req: Request, s: Snapshot): Kpis {
  const ds = scopedDistricts(req, s);
  const cov = mergeCoverage(ds.map((d) => d.coverage));
  const open = ds.reduce((a, d) => a + d.openApplications, 0);
  const breached = ds.reduce((a, d) => a + d.breached, 0);
  const anomalies = scopedAnomalies(req, s).filter((a) => a.review.status === 'open');
  const ids = new Set(ds.map((d) => d.id));
  let n = 0;
  let f = 0;
  for (const b of s.blocks) if (ids.has(b.districtId)) for (const p of s.monthlyByBlock.get(b.id)!.slice(-3)) { n += p.disbursed; f += p.failed; }
  return {
    eligible: cov.eligible, enrolled: cov.enrolled, coverage: cov.coverage, gap: cov.gap,
    openApplications: open, breached, breachPct: open ? breached / open : 0,
    activeAnomalies: anomalies.length, highAnomalies: anomalies.filter((a) => a.severity === 'high').length,
    failureRate: n ? f / n : 0,
  };
}

// ---------- meta ----------
analyticsRouter.get('/meta', h((req, res) => {
  const s = getSnapshot();
  const scope = districtScope(req);
  res.json({
    ...stamp(s),
    schemes: s.schemes,
    districts: s.districts.filter((d) => scope === null || d.id === scope).map((d) => ({ id: d.id, name: d.name, code: d.code })),
    blocks: s.blocks.filter((b) => scope === null || b.districtId === scope).map((b) => ({ id: b.id, name: b.name, districtId: b.districtId })),
    weights: ATTENTION_WEIGHTS,
    scales: ATTENTION_SCALES,
    levels: ATTENTION_LEVELS,
    anomalyConfig: ANOMALY,
    ageBuckets: AGE_BUCKETS,
    stages: STAGE_LABELS,
    ai: { enabled: aiEnabled(), model: aiEnabled() ? aiModel() : null },
  });
}));

// ---------- overview ----------
analyticsRouter.get('/overview', h((req, res) => {
  const s = getSnapshot();
  const scope = districtScope(req);
  const districts = scopedDistricts(req, s);
  const blocks = s.blockSummaries.filter((b) => scope === null || b.districtId === scope);
  const attention = [...districts.map((d) => d.attention), ...blocks.map((b) => b.attention)].sort((a, b) => b.score - a.score);
  const body: Overview = { ...stamp(s), kpis: buildKpis(req, s), districts, attention, weights: ATTENTION_WEIGHTS };
  res.json(body);
}));

// ---------- attention ----------
analyticsRouter.get('/attention', h((req, res) => {
  const { level, districtId } = parse(z.object({ level: z.enum(['district', 'block']).default('district'), districtId: z.coerce.number().int().positive().optional() }), req.query);
  const s = getSnapshot();
  const d = effectiveDistrict(req, districtId);
  const list = level === 'district'
    ? s.districtSummaries.filter((x) => d === undefined || x.id === d).map((x) => x.attention)
    : s.blockSummaries.filter((x) => d === undefined || x.districtId === d).map((x) => x.attention);
  res.json({ ...stamp(s), weights: ATTENTION_WEIGHTS, levels: ATTENTION_LEVELS, scores: list.sort((a, b) => b.score - a.score) });
}));

// ---------- district drill-down ----------
export function districtMonthly(s: Snapshot, districtId: number): MonthlyPoint[] {
  const blocks = s.blocks.filter((b) => b.districtId === districtId);
  return s.months.map((month, i) => {
    const p = { month, received: 0, approved: 0, rejected: 0, disbursed: 0, failed: 0, failureRate: 0 };
    for (const b of blocks) {
      const q = s.monthlyByBlock.get(b.id)![i];
      p.received += q.received; p.approved += q.approved; p.rejected += q.rejected; p.disbursed += q.disbursed; p.failed += q.failed;
    }
    p.failureRate = p.disbursed ? p.failed / p.disbursed : 0;
    return p;
  });
}

analyticsRouter.get('/districts/:id', h((req, res) => {
  const { id } = parse(idParamSchema, req.params);
  assertInScope(req, id);
  const s = getSnapshot();
  const district = s.districtSummaries.find((d) => d.id === id);
  if (!district) throw new HttpError(404, 'District not found.');
  const apps = s.apps.filter((a) => a.districtId === id);
  const nowMs = asOfMs(s.asOf);
  const blocks = s.blockSummaries.filter((b) => b.districtId === id);
  const body: DistrictDetail = {
    ...stamp(s),
    district,
    blocks,
    pendency: summarizePendency(apps, s.asOf),
    pendencyByBlock: blocks.map((b) => {
      const open = apps.filter((a) => a.blockId === b.id && a.decidedAt === null);
      return { blockId: b.id, blockName: b.name, buckets: bucketize(open.map((a) => ageInDays(a.submittedAt, nowMs))), open: open.length, breached: b.breached };
    }),
    monthly: districtMonthly(s, id),
    anomalies: s.anomalies.filter((a) => a.districtId === id),
  };
  res.json(body);
}));

// ---------- pendency ----------
function pendingItems(req: Request, s: Snapshot, query: z.infer<typeof pendencyQuerySchema>) {
  const d = effectiveDistrict(req, query.districtId);
  const nowMs = asOfMs(s.asOf);
  const schemeById = new Map(s.schemes.map((x) => [x.id, x]));
  const blockById = new Map(s.blocks.map((b) => [b.id, b]));
  const districtById = new Map(s.districts.map((x) => [x.id, x]));
  const open = s.apps.filter((a) => a.decidedAt === null && (d === undefined || a.districtId === d));
  const items: PendingApplication[] = open
    .filter((a) => (query.blockId === undefined || a.blockId === query.blockId) && (query.schemeId === undefined || a.schemeId === query.schemeId) && (query.stage === undefined || a.pendingStage === query.stage))
    .map((a) => {
      const age = ageInDays(a.submittedAt, nowMs);
      const sc = schemeById.get(a.schemeId)!;
      const stage = a.pendingStage ?? 'document_check';
      return {
        id: a.id, refNo: a.refNo, applicantMasked: maskName(a.applicantName), schemeCode: sc.code, schemeName: sc.shortName,
        districtId: a.districtId, districtName: districtById.get(a.districtId)!.name, blockId: a.blockId, blockName: blockById.get(a.blockId)!.name,
        submittedAt: a.submittedAt.slice(0, 10), ageDays: age, slaDays: a.slaDays, breached: age > a.slaDays, status: a.status, stage, stageLabel: STAGE_LABELS[stage] ?? stage,
      };
    })
    .filter((x) => !query.breachedOnly || x.breached)
    .sort((a, b) => b.ageDays - a.ageDays);
  return { d, open, items };
}

analyticsRouter.get('/pendency', h((req, res) => {
  const query = parse(pendencyQuerySchema, req.query);
  const s = getSnapshot();
  const { d, items } = pendingItems(req, s, query);
  const nowMs = asOfMs(s.asOf);
  const scopeApps = s.apps.filter((a) => (d === undefined || a.districtId === d) && (query.schemeId === undefined || a.schemeId === query.schemeId) && (query.blockId === undefined || a.blockId === query.blockId));
  const blocks = s.blockSummaries.filter((b) => (d === undefined || b.districtId === d) && (query.blockId === undefined || b.id === query.blockId));
  const districtById = new Map(s.districts.map((x) => [x.id, x]));
  const heatmap = blocks
    .map((b) => {
      const open = scopeApps.filter((a) => a.blockId === b.id && a.decidedAt === null && (query.stage === undefined || a.pendingStage === query.stage));
      const counts = AGE_BUCKETS.map(() => 0);
      let breached = 0;
      for (const a of open) {
        const age = ageInDays(a.submittedAt, nowMs);
        counts[bucketIndex(age)]++;
        if (age > a.slaDays) breached++;
      }
      return { blockId: b.id, blockName: b.name, districtName: districtById.get(b.districtId)!.name, buckets: counts, open: open.length, breached };
    })
    .filter((r) => r.open > 0)
    .sort((a, b) => b.breached - a.breached || b.open - a.open);
  const body: PendencyResponse = {
    ...stamp(s),
    summary: summarizePendency(scopeApps, s.asOf),
    heatmap,
    bucketLabels: AGE_BUCKETS.map((b) => b.label),
    items: items.slice(0, query.limit),
    total: items.length,
  };
  res.json(body);
}));

analyticsRouter.get('/pendency/export.csv', h((req, res) => {
  const query = parse(pendencyQuerySchema, req.query);
  const s = getSnapshot();
  const { items } = pendingItems(req, s, query);
  audit(req, 'export.pendency_csv', 'applications', null, { rows: items.length, filters: query });
  const cols: (keyof PendingApplication)[] = ['refNo', 'applicantMasked', 'schemeCode', 'districtName', 'blockName', 'submittedAt', 'ageDays', 'slaDays', 'breached', 'stageLabel'];
  // quote every cell; prefix text starting with = + - @ so spreadsheets don't evaluate it as a formula
  const esc = (v: unknown) => `"${(typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : String(v)).replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...items.map((it) => cols.map((c) => esc(it[c])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="sevalens-pending-${s.asOf}.csv"`);
  res.send(`# SevaLens export — SYNTHETIC DEMO DATA — data as of ${s.asOf}\n${csv}`);
}));

// ---------- anomalies ----------
analyticsRouter.get('/anomalies', h((req, res) => {
  const query = parse(anomaliesQuerySchema, req.query);
  const s = getSnapshot();
  const d = effectiveDistrict(req, query.districtId);
  const anomalies = s.anomalies.filter((a) => (d === undefined || a.districtId === d) && (!query.type || a.type === query.type) && (query.includeDismissed || a.review.status !== 'false_positive'));
  const body: AnomaliesResponse = { ...stamp(s), anomalies };
  res.json(body);
}));

const keySchema = z.object({ key: z.string().min(3).max(80).regex(/^[a-z_]+(:[a-z_]+)*(:\d+)?$/) });

function findAnomaly(req: Request, s: Snapshot, key: string) {
  const a = s.anomalies.find((x) => x.key === key);
  if (!a) throw new HttpError(404, 'Anomaly not found.');
  assertInScope(req, a.districtId);
  return a;
}

analyticsRouter.get('/anomalies/:key', h((req, res) => {
  const { key } = parse(keySchema, req.params);
  const s = getSnapshot();
  const anomaly = findAnomaly(req, s, key);
  const schemeById = new Map(s.schemes.map((x) => [x.id, x]));
  let detail: Omit<AnomalyDetail, 'anomaly'>;
  switch (anomaly.type) {
    case 'duplicate_beneficiary': {
      const pairs = s.dupPairs.get(anomaly.blockId!) ?? [];
      detail = {
        columns: [
          { key: 'aId', label: 'Record A' }, { key: 'aName', label: 'Name A' }, { key: 'aScheme', label: 'Scheme A' },
          { key: 'bId', label: 'Record B' }, { key: 'bName', label: 'Name B' }, { key: 'bScheme', label: 'Scheme B' },
          { key: 'match', label: 'Match rule' }, { key: 'dobYear', label: 'Birth year' }, { key: 'village', label: 'Village' },
        ],
        records: pairs.map((p) => ({
          aId: p.a.id, aName: maskName(p.a.name), aScheme: p.a.schemeCode, bId: p.b.id, bName: maskName(p.b.name), bScheme: p.b.schemeCode,
          match: p.kind === 'exact_id' ? 'Same Aadhaar (hash)' : `Name ${(nameSimilarity(p.a.name, p.b.name) * 100).toFixed(0)}% similar + same DOB`,
          dobYear: p.a.dob.slice(0, 4), village: p.a.village === p.b.village ? p.a.village : `${p.a.village} / ${p.b.village}`,
        })),
      };
      break;
    }
    case 'deceased_paid': {
      const rows = sqlite.prepare(`SELECT b.id, b.name, b.scheme_id AS schemeId, b.deceased_at AS deceasedAt, bl.name AS blockName, COUNT(*) AS payments, SUM(d.amount) AS amount, MAX(d.paid_at) AS lastPaid
        FROM beneficiaries b JOIN disbursements d ON d.beneficiary_id = b.id JOIN blocks bl ON bl.id = b.block_id
        WHERE b.district_id = ? AND b.status = 'deceased' AND d.status = 'success' AND d.paid_at > b.deceased_at GROUP BY b.id ORDER BY amount DESC`).all(anomaly.districtId) as { id: number; name: string; schemeId: number; deceasedAt: string; blockName: string; payments: number; amount: number; lastPaid: string }[];
      detail = {
        columns: [{ key: 'id', label: 'Beneficiary' }, { key: 'name', label: 'Name' }, { key: 'scheme', label: 'Scheme' }, { key: 'block', label: 'Block' }, { key: 'deceasedAt', label: 'Recorded death' }, { key: 'payments', label: 'Payments after' }, { key: 'amount', label: 'Amount (₹)' }, { key: 'lastPaid', label: 'Last paid' }],
        records: rows.map((r) => ({ id: r.id, name: maskName(r.name), scheme: schemeById.get(r.schemeId)!.code, block: r.blockName, deceasedAt: r.deceasedAt, payments: r.payments, amount: r.amount, lastPaid: r.lastPaid.slice(0, 10) })),
      };
      break;
    }
    case 'application_spike':
    case 'rejection_spike':
    case 'disbursement_failure_spike': {
      const series = s.monthlyByBlock.get(anomaly.blockId!)!;
      const field = anomaly.type === 'application_spike' ? 'received' : anomaly.type === 'rejection_spike' ? 'rejected' : 'failed';
      detail = {
        columns: [{ key: 'month', label: 'Month' }, { key: 'value', label: anomaly.metric }, { key: 'window', label: 'Window' }],
        records: series.map((p, i) => ({ month: p.month, value: p[field], window: i >= series.length - ANOMALY.testMonths ? 'Tested' : 'Baseline' })),
      };
      break;
    }
    case 'officer_outlier': {
      const officerId = Number(anomaly.key.split(':')[1]);
      const rows = s.apps.filter((a) => a.officerId === officerId && a.decidedAt).sort((a, b) => b.decidedAt!.localeCompare(a.decidedAt!)).slice(0, 60);
      detail = {
        columns: [{ key: 'refNo', label: 'Application' }, { key: 'scheme', label: 'Scheme' }, { key: 'submitted', label: 'Submitted' }, { key: 'decided', label: 'Decided' }, { key: 'hours', label: 'Decision time (h)' }, { key: 'status', label: 'Outcome' }],
        records: rows.map((a) => ({ refNo: a.refNo, scheme: schemeById.get(a.schemeId)!.code, submitted: a.submittedAt.replace('T', ' ').slice(0, 16), decided: a.decidedAt!.replace('T', ' ').slice(0, 16), hours: +((Date.parse(a.decidedAt! + 'Z') - Date.parse(a.submittedAt + 'Z')) / 3_600_000).toFixed(1), status: a.status })),
      };
      break;
    }
    case 'pendency_backlog': {
      const { items } = pendingItems(req, s, { blockId: anomaly.blockId!, districtId: anomaly.districtId, breachedOnly: true, limit: 200 });
      detail = {
        columns: [{ key: 'refNo', label: 'Application' }, { key: 'applicant', label: 'Applicant' }, { key: 'scheme', label: 'Scheme' }, { key: 'submitted', label: 'Submitted' }, { key: 'age', label: 'Age (days)' }, { key: 'stage', label: 'Stuck at' }],
        records: items.slice(0, 200).map((i) => ({ refNo: i.refNo, applicant: i.applicantMasked, scheme: i.schemeCode, submitted: i.submittedAt, age: i.ageDays, stage: i.stageLabel })),
      };
      break;
    }
  }
  res.json({ anomaly, ...detail } satisfies AnomalyDetail);
}));

analyticsRouter.post('/anomalies/:key/review', h((req, res) => {
  const { key } = parse(keySchema, req.params);
  const body = parse(reviewSchema, req.body);
  const s = getSnapshot();
  findAnomaly(req, s, key);
  const u = currentUser(req);
  const now = new Date().toISOString();
  sqlite.prepare(`INSERT INTO anomaly_reviews (anomaly_key, status, note, user_id, user_email, updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(anomaly_key) DO UPDATE SET status = excluded.status, note = excluded.note, user_id = excluded.user_id, user_email = excluded.user_email, updated_at = excluded.updated_at`)
    .run(key, body.status, body.note ?? null, u.id, u.email, now);
  audit(req, 'anomaly.review', 'anomaly', key, { status: body.status, note: body.note ? scrub(body.note) : null });
  invalidateReviews();
  res.json({ ok: true, review: { status: body.status, note: body.note ?? null, by: u.email, at: now } });
}));

// ---------- beneficiary detail (full PII, audited) ----------
analyticsRouter.get('/beneficiaries/:id', h((req, res) => {
  const { id } = parse(idParamSchema, req.params);
  const r = sqlite.prepare(`SELECT b.*, d.name AS districtName, bl.name AS blockName, s.code AS schemeCode, s.short_name AS schemeName FROM beneficiaries b JOIN districts d ON d.id = b.district_id JOIN blocks bl ON bl.id = b.block_id JOIN schemes s ON s.id = b.scheme_id WHERE b.id = ?`).get(id) as Record<string, string & number> | undefined;
  if (!r) throw new HttpError(404, 'Beneficiary not found.');
  assertInScope(req, r.district_id);
  audit(req, 'beneficiary.view', 'beneficiary', id);
  const s = getSnapshot();
  const payments = sqlite.prepare('SELECT month, amount, status, paid_at AS paidAt FROM disbursements WHERE beneficiary_id = ? ORDER BY month DESC').all(id) as BeneficiaryView['payments'];
  const age = Math.floor((asOfMs(s.asOf) - Date.parse(r.dob)) / (365.25 * 86_400_000));
  const view: BeneficiaryView = {
    id: r.id, name: r.name, aadhaarMasked: maskAadhaar(r.aadhaar_last4), gender: r.gender, dob: r.dob, age,
    districtName: r.districtName, blockName: r.blockName, village: r.village, schemeCode: r.schemeCode, schemeName: r.schemeName,
    status: r.status, enrolledAt: r.enrolled_at, deceasedAt: r.deceased_at ?? null, payments,
  };
  res.json(view);
}));

// ---------- audit log (state admin) ----------
analyticsRouter.get('/audit', requireRole('STATE_ADMIN'), h((req, res) => {
  const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(200) }), req.query);
  const rows = sqlite.prepare('SELECT id, ts, user_email AS userEmail, action, entity, entity_id AS entityId, details, ip FROM audit_log ORDER BY id DESC LIMIT ?').all(limit) as AuditEntry[];
  res.json({ entries: rows });
}));
