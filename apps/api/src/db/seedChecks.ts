/**
 * Verification of the seeded demo data. Used by the seed summary (`npm run db:seed`)
 * and by `npm run preflight`, so both report the same numbers against the same thresholds.
 */
import type Database from 'better-sqlite3';
import { LOW_COVERAGE } from './reference';

/** Row counts produced by the deterministic seed (seed 20261009). Update if the generator changes. */
export const EXPECTED_COUNTS = { districts: 16, blocks: 59, beneficiaries: 49862, applications: 14737, disbursements: 610955, users: 2 } as const;
export type CountTable = keyof typeof EXPECTED_COUNTS;

export interface SeedCheck { id: number; label: string; detail: string; ok: boolean }

export function tableCounts(db: Database.Database): Record<CountTable, number> {
  const out = {} as Record<CountTable, number>;
  for (const t of Object.keys(EXPECTED_COUNTS) as CountTable[]) out[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  return out;
}

/** The six planted patterns the demo relies on, each with a pass/fail threshold. */
export function plantedPatternChecks(db: Database.Database): SeedCheck[] {
  const q = <T = Record<string, number>>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as T[];
  const one = <T = Record<string, number>>(sql: string, ...p: unknown[]) => db.prepare(sql).get(...p) as T;
  const asOf = (one<{ value: string }>(`SELECT value FROM meta WHERE key = 'data_as_of'`))?.value;
  const months = JSON.parse((one<{ value: string }>(`SELECT value FROM meta WHERE key = 'months'`))?.value ?? '[]') as string[];
  const blockId = (dcode: string, name: string) => one<{ id: number }>(`SELECT b.id FROM blocks b JOIN districts d ON d.id = b.district_id WHERE d.code = ? AND b.name = ?`, dcode, name)?.id;
  const checks: SeedCheck[] = [];

  // [1] the planted low-coverage districts are the three lowest in the state
  const cov = q<{ code: string; name: string; enrolled: number; eligible: number }>(`
    SELECT d.code, d.name,
      (SELECT COUNT(*) FROM beneficiaries b WHERE b.district_id = d.id AND b.status = 'active') AS enrolled,
      (SELECT SUM(d.population * CASE s.eligible_basis WHEN 'population' THEN 1 WHEN 'pct_elderly' THEN d.pct_elderly WHEN 'pct_widows' THEN d.pct_widows ELSE d.pct_pwd END * s.eligible_factor) FROM schemes s) AS eligible
    FROM districts d`);
  const totEnr = cov.reduce((a, c) => a + c.enrolled, 0);
  const totElig = cov.reduce((a, c) => a + c.eligible, 0);
  const lowest = [...cov].sort((a, b) => a.enrolled / a.eligible - b.enrolled / b.eligible);
  const want = Object.keys(LOW_COVERAGE);
  checks.push({
    id: 1,
    label: 'Low coverage in remote districts',
    ok: cov.length > 0 && lowest.slice(0, want.length).every((c) => want.includes(c.code)),
    detail: `state ${(100 * totEnr / totElig).toFixed(1)}% (${totEnr} / ${Math.round(totElig)} est. eligible); lowest: ${lowest.slice(0, 5).map((c) => `${c.name} ${(100 * c.enrolled / c.eligible).toFixed(1)}%`).join(', ')}`,
  });

  // [2] Lamshang field-verification backlog
  const lamId = blockId('IW', 'Lamshang');
  const stuck = `status IN ('submitted','verified','pending') AND pending_stage = 'field_verification' AND julianday(?) - julianday(submitted_at) > 30`;
  const lam = lamId ? one(`SELECT COUNT(*) AS n FROM applications WHERE block_id = ? AND ${stuck}`, lamId, asOf).n : 0;
  const otherAvg = one(`SELECT AVG(n) AS n FROM (SELECT COUNT(*) AS n FROM applications WHERE block_id != ? AND ${stuck} GROUP BY block_id)`, lamId ?? -1, asOf).n ?? 0;
  checks.push({ id: 2, label: 'Pendency spike in Lamshang', ok: lam >= 100 && lam > 10 * otherAvg, detail: `Lamshang (Imphal West) ${lam} past 30-day SLA at field verification (other blocks avg ${otherAvg.toFixed(1)})` });

  // [3] duplicate cluster in Thoubal block
  const dupHash = q<{ block: string; n: number }>(`SELECT bl.name AS block, COUNT(*) AS n FROM (SELECT aadhaar_hash, MIN(block_id) AS block_id FROM beneficiaries GROUP BY aadhaar_hash HAVING COUNT(*) > 1) x JOIN blocks bl ON bl.id = x.block_id GROUP BY bl.name ORDER BY n DESC`);
  checks.push({ id: 3, label: 'Duplicate cluster in Thoubal', ok: dupHash[0]?.block === 'Thoubal' && dupHash[0].n >= 25, detail: `exact-hash groups by block: ${dupHash.map((d) => `${d.block}=${d.n}`).join(', ') || 'none'}` });

  // [4] Churachandpur payment-failure spike in the last 2 months
  const last2 = months.slice(-2);
  const ph = last2.map(() => '?').join(',') || "''";
  const ccp = one<{ recent: number | null; prior: number | null }>(`SELECT
    AVG(CASE WHEN month IN (${ph}) THEN (status = 'failed') END) AS recent,
    AVG(CASE WHEN month NOT IN (${ph}) THEN (status = 'failed') END) AS prior
    FROM disbursements WHERE district_id = (SELECT id FROM districts WHERE code = 'CCP')`, ...last2, ...last2);
  const recent = ccp?.recent ?? 0;
  const prior = ccp?.prior ?? 0;
  checks.push({ id: 4, label: 'Payment failures in Churachandpur', ok: recent >= 0.1 && recent > 3 * prior, detail: `failed-payment rate last 2 months ${(100 * recent).toFixed(1)}% vs prior ${(100 * prior).toFixed(1)}%` });

  // [5] deceased beneficiaries still being paid
  const dead = one(`SELECT COUNT(DISTINCT b.id) AS n, COUNT(*) AS payments, COALESCE(SUM(d.amount), 0) AS amt FROM beneficiaries b JOIN disbursements d ON d.beneficiary_id = b.id WHERE b.status = 'deceased' AND d.status = 'success' AND d.paid_at > b.deceased_at`);
  checks.push({ id: 5, label: 'Deceased-but-paid beneficiaries', ok: dead.n >= 30 && dead.n <= 50, detail: `${dead.n} beneficiaries, ${dead.payments} payments, INR ${dead.amt}` });

  // [6] officer outlier: the first officer in Bishnupur / Moirang
  const outlierId = one<{ id: number } | undefined>(`SELECT o.id FROM officers o WHERE o.block_id = ? ORDER BY o.id LIMIT 1`, blockId('BPR', 'Moirang') ?? -1)?.id;
  const offs = q<{ id: number; n: number; rate: number; avgDays: number }>(`SELECT officer_id AS id, COUNT(*) AS n, AVG(status = 'approved') AS rate, AVG(julianday(decided_at) - julianday(submitted_at)) AS avgDays FROM applications WHERE decided_at IS NOT NULL GROUP BY officer_id`);
  const out = offs.find((o) => o.id === outlierId);
  const peers = offs.filter((o) => o.id !== outlierId);
  const peerRate = peers.reduce((a, o) => a + o.rate, 0) / (peers.length || 1);
  const peerDays = peers.reduce((a, o) => a + o.avgDays, 0) / (peers.length || 1);
  checks.push({
    id: 6,
    label: 'Officer outlier in Moirang',
    ok: Boolean(out) && out!.rate > peerRate + 0.15 && out!.avgDays < peerDays / 5,
    detail: out ? `officer #${out.id}: ${out.n} decisions, approval ${(100 * out.rate).toFixed(1)}%, avg ${out.avgDays.toFixed(2)} days; peers avg approval ${(100 * peerRate).toFixed(1)}%, avg ${peerDays.toFixed(1)} days` : 'outlier officer not found',
  });

  return checks;
}
