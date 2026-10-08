/**
 * Builds an in-memory analytics snapshot from the database. SQL does the heavy
 * aggregation; the pure functions in ../analytics do all scoring and detection.
 * The snapshot is cached and rebuilt on invalidate() (e.g. after data ingestion).
 */
import type {
  Anomaly,
  AnomalyReview,
  BlockSummary,
  CoverageSummary,
  DistrictSummary,
  MonthlyPoint,
  SchemeInfo,
} from '@sevalens/shared';
import { sqlite } from '../db/client';
import {
  SEVERITY_POINTS,
  STAGE_LABELS,
  computeAttention,
  coverageCell,
  deceasedPaidAnomaly,
  detectBacklogs,
  detectOfficerOutliers,
  detectSpike,
  duplicateAnomaly,
  estimateEligible,
  findDuplicatePairs,
  mergeCoverage,
  median,
  officerAnomaly,
  sortAnomalies,
  spikeAnomaly,
  summarizeCoverage,
  type BenLite,
  type DetectedAnomaly,
  type DuplicatePair,
  type OfficerStats,
  type Place,
} from '../analytics';
import { asOfMs, ageInDays } from '../analytics/pendency';

export interface DistrictRow { id: number; code: string; name: string; hqLat: number; hqLng: number; population: number; pctElderly: number; pctWidows: number; pctPwd: number; pctRural: number; remoteness: number }
export interface BlockRow { id: number; districtId: number; name: string; lat: number; lng: number; popShare: number; remoteness: number }
export interface AppRow { id: number; refNo: string; applicantName: string; schemeId: number; districtId: number; blockId: number; submittedAt: string; status: string; decidedAt: string | null; officerId: number | null; pendingStage: string | null; slaDays: number }

interface Base {
  asOf: string;
  months: string[];
  computedAt: string;
  districts: DistrictRow[];
  blocks: BlockRow[];
  schemes: SchemeInfo[];
  apps: AppRow[];
  blockCoverage: Map<number, CoverageSummary>;
  blockFailure: Map<number, number>;
  monthlyByBlock: Map<number, MonthlyPoint[]>;
  detected: DetectedAnomaly[];
  dupPairs: Map<number, DuplicatePair[]>;
  officers: OfficerStats[];
}

export interface Snapshot extends Base {
  anomalies: Anomaly[];
  districtSummaries: DistrictSummary[];
  blockSummaries: BlockSummary[];
}

const q = <T>(sql: string, ...p: unknown[]) => sqlite.prepare(sql).all(...p) as T[];

function loadBase(): Base {
  const t0 = Date.now();
  const meta = Object.fromEntries(q<{ key: string; value: string }>('SELECT key, value FROM meta').map((r) => [r.key, r.value]));
  const asOf: string = meta.data_as_of;
  const months: string[] = JSON.parse(meta.months);
  const nowMs = asOfMs(asOf);

  const districts = q<DistrictRow>('SELECT id, code, name, hq_lat AS hqLat, hq_lng AS hqLng, population, pct_elderly AS pctElderly, pct_widows AS pctWidows, pct_pwd AS pctPwd, pct_rural AS pctRural, remoteness FROM districts ORDER BY id');
  const blocks = q<BlockRow>('SELECT id, district_id AS districtId, name, lat, lng, pop_share AS popShare, remoteness FROM blocks ORDER BY id');
  const schemes = q<SchemeInfo>('SELECT id, code, name, short_name AS shortName, category, eligibility_text AS eligibilityText, eligible_basis AS eligibleBasis, eligible_factor AS eligibleFactor, sla_days AS slaDays, benefit_amount AS benefitAmount, frequency FROM schemes ORDER BY id');
  const schemeById = new Map(schemes.map((s) => [s.id, s]));
  const districtById = new Map(districts.map((d) => [d.id, d]));
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const placeOfBlock = (blockId: number): Place => {
    const b = blockById.get(blockId)!;
    return { districtId: b.districtId, districtName: districtById.get(b.districtId)!.name, blockId, blockName: b.name };
  };

  // --- coverage per block x scheme
  const enrolled = new Map<string, number>();
  for (const r of q<{ blockId: number; schemeId: number; n: number }>(`SELECT block_id AS blockId, scheme_id AS schemeId, COUNT(*) AS n FROM beneficiaries WHERE status = 'active' GROUP BY block_id, scheme_id`))
    enrolled.set(`${r.blockId}|${r.schemeId}`, r.n);
  const blockCoverage = new Map<number, CoverageSummary>();
  for (const b of blocks) {
    const d = districtById.get(b.districtId)!;
    const profile = { population: d.population * b.popShare, pctElderly: d.pctElderly, pctWidows: d.pctWidows, pctPwd: d.pctPwd };
    blockCoverage.set(b.id, summarizeCoverage(schemes.map((s) => coverageCell(s, estimateEligible(profile, s), enrolled.get(`${b.id}|${s.id}`) ?? 0))));
  }

  // --- applications
  const apps = q<AppRow>(`SELECT a.id, a.ref_no AS refNo, a.applicant_name AS applicantName, a.scheme_id AS schemeId, a.district_id AS districtId, a.block_id AS blockId, a.submitted_at AS submittedAt, a.status, a.decided_at AS decidedAt, a.officer_id AS officerId, a.pending_stage AS pendingStage, s.sla_days AS slaDays FROM applications a JOIN schemes s ON s.id = a.scheme_id`);

  // --- monthly series per block
  const monthIdx = new Map(months.map((m, i) => [m, i]));
  const emptySeries = (): MonthlyPoint[] => months.map((month) => ({ month, received: 0, approved: 0, rejected: 0, disbursed: 0, failed: 0, failureRate: 0 }));
  const monthlyByBlock = new Map<number, MonthlyPoint[]>(blocks.map((b) => [b.id, emptySeries()]));
  for (const a of apps) {
    const s = monthlyByBlock.get(a.blockId)!;
    const mi = monthIdx.get(a.submittedAt.slice(0, 7));
    if (mi !== undefined) s[mi].received++;
    if (a.decidedAt) {
      const di = monthIdx.get(a.decidedAt.slice(0, 7));
      if (di !== undefined) a.status === 'approved' ? s[di].approved++ : a.status === 'rejected' && s[di].rejected++;
    }
  }
  for (const r of q<{ blockId: number; month: string; n: number; failed: number }>(`SELECT block_id AS blockId, month, COUNT(*) AS n, SUM(status != 'success') AS failed FROM disbursements GROUP BY block_id, month`)) {
    const mi = monthIdx.get(r.month);
    if (mi === undefined) continue;
    const p = monthlyByBlock.get(r.blockId)![mi];
    p.disbursed = r.n;
    p.failed = r.failed;
    p.failureRate = r.n ? r.failed / r.n : 0;
  }
  const blockFailure = new Map<number, number>();
  for (const [bid, s] of monthlyByBlock) {
    const last = s.slice(-3);
    const n = last.reduce((a, p) => a + p.disbursed, 0);
    blockFailure.set(bid, n ? last.reduce((a, p) => a + p.failed, 0) / n : 0);
  }

  // --- anomaly detection
  const detected: DetectedAnomaly[] = [];

  // duplicates
  const bens = q<BenLite & { schemeId: number }>(`SELECT id, aadhaar_hash AS hash, name, dob, block_id AS blockId, village, scheme_id AS schemeId, '' AS schemeCode FROM beneficiaries WHERE status != 'deceased'`);
  for (const b of bens) b.schemeCode = schemeById.get(b.schemeId)!.code;
  const pairs = findDuplicatePairs(bens);
  const dupPairs = new Map<number, DuplicatePair[]>();
  for (const p of pairs) {
    const arr = dupPairs.get(p.b.blockId) ?? [];
    arr.push(p);
    dupPairs.set(p.b.blockId, arr);
  }
  const benCountByBlock = new Map<number, number>();
  for (const b of bens) benCountByBlock.set(b.blockId, (benCountByBlock.get(b.blockId) ?? 0) + 1);
  for (const [blockId, ps] of dupPairs) {
    const monthly = ps.reduce((a, p) => a + (schemeById.get((p.b as BenLite & { schemeId: number }).schemeId)?.benefitAmount ?? 0), 0);
    detected.push(duplicateAnomaly(placeOfBlock(blockId), ps, monthly, benCountByBlock.get(blockId) ?? 0));
  }

  // deceased still paid
  for (const r of q<{ districtId: number; beneficiaries: number; payments: number; amount: number }>(`SELECT b.district_id AS districtId, COUNT(DISTINCT b.id) AS beneficiaries, COUNT(*) AS payments, SUM(d.amount) AS amount FROM beneficiaries b JOIN disbursements d ON d.beneficiary_id = b.id WHERE b.status = 'deceased' AND d.status = 'success' AND d.paid_at > b.deceased_at GROUP BY b.district_id`)) {
    const a = deceasedPaidAnomaly({ districtId: r.districtId, districtName: districtById.get(r.districtId)!.name, blockId: null, blockName: null }, r);
    if (a) detected.push(a);
  }

  // time-series spikes per block
  for (const b of blocks) {
    const s = monthlyByBlock.get(b.id)!;
    const place = placeOfBlock(b.id);
    const apSpike = detectSpike(s.map((p) => p.received), months);
    if (apSpike && apSpike.z > 0) detected.push(spikeAnomaly('application_spike', place, apSpike));
    const rjSpike = detectSpike(s.map((p) => p.rejected), months);
    if (rjSpike && rjSpike.z > 0) detected.push(spikeAnomaly('rejection_spike', place, rjSpike));
    const fSpike = detectSpike(s.map((p) => p.failed), months);
    if (fSpike && fSpike.z > 0) detected.push(spikeAnomaly('disbursement_failure_spike', place, fSpike));
  }

  // officer outliers
  const officerRows = q<{ id: number; code: string; blockId: number }>('SELECT id, code, block_id AS blockId FROM officers');
  const decByOfficer = new Map<number, AppRow[]>();
  for (const a of apps) if (a.officerId && a.decidedAt) {
    const arr = decByOfficer.get(a.officerId) ?? [];
    arr.push(a);
    decByOfficer.set(a.officerId, arr);
  }
  const officers: OfficerStats[] = officerRows.map((o) => {
    const ds = decByOfficer.get(o.id) ?? [];
    const days = ds.map((a) => (Date.parse(a.decidedAt! + 'Z') - Date.parse(a.submittedAt + 'Z')) / 86_400_000);
    return {
      id: o.id,
      code: o.code,
      decisions: ds.length,
      approvalRate: ds.length ? ds.filter((a) => a.status === 'approved').length / ds.length : 0,
      medianDays: median(days),
      place: placeOfBlock(o.blockId),
    };
  });
  for (const x of detectOfficerOutliers(officers)) detected.push(officerAnomaly(x));

  // pendency backlog per block
  const backlog = blocks.map((b) => {
    const open = apps.filter((a) => a.blockId === b.id && a.decidedAt === null);
    const breached = open.filter((a) => ageInDays(a.submittedAt, nowMs) > a.slaDays);
    const stageCounts = new Map<string, number>();
    for (const a of breached) stageCounts.set(a.pendingStage ?? 'document_check', (stageCounts.get(a.pendingStage ?? 'document_check') ?? 0) + 1);
    const topStage = [...stageCounts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'document_check';
    return { place: placeOfBlock(b.id), open: open.length, breached: breached.length, topStage: STAGE_LABELS[topStage] ?? topStage };
  });
  detected.push(...detectBacklogs(backlog));

  console.log(`[analytics] snapshot built in ${Date.now() - t0} ms — ${detected.length} anomalies`);
  return {
    asOf, months, computedAt: new Date().toISOString(), districts, blocks, schemes, apps,
    blockCoverage, blockFailure, monthlyByBlock, detected: sortAnomalies(detected), dupPairs, officers,
  };
}

function loadReviews(): Map<string, AnomalyReview> {
  return new Map(
    q<{ key: string; status: AnomalyReview['status']; note: string | null; by: string | null; at: string }>('SELECT anomaly_key AS key, status, note, user_email AS by, updated_at AS at FROM anomaly_reviews').map((r) => [r.key, { status: r.status, note: r.note, by: r.by, at: r.at }]),
  );
}

function derive(base: Base): Snapshot {
  const reviews = loadReviews();
  const nowMs = asOfMs(base.asOf);
  const anomalies: Anomaly[] = base.detected.map((a) => ({ ...a, review: reviews.get(a.key) ?? { status: 'open', note: null, by: null, at: null } }));
  // false positives are excluded from scoring; open + reviewed (confirmed) count
  const counting = anomalies.filter((a) => a.review.status !== 'false_positive');
  const pointsFor = (pred: (a: Anomaly) => boolean) => counting.filter(pred).reduce((s, a) => s + SEVERITY_POINTS[a.severity], 0);

  const openByBlock = new Map<number, { open: number; breached: number }>();
  for (const a of base.apps) {
    if (a.decidedAt !== null) continue;
    const cur = openByBlock.get(a.blockId) ?? { open: 0, breached: 0 };
    cur.open++;
    if (ageInDays(a.submittedAt, nowMs) > a.slaDays) cur.breached++;
    openByBlock.set(a.blockId, cur);
  }
  const districtById = new Map(base.districts.map((d) => [d.id, d]));

  const blockSummaries: BlockSummary[] = base.blocks.map((b) => {
    const d = districtById.get(b.districtId)!;
    const cov = base.blockCoverage.get(b.id)!;
    const ob = openByBlock.get(b.id) ?? { open: 0, breached: 0 };
    const failureRate = base.blockFailure.get(b.id) ?? 0;
    const inBlock = (a: Anomaly) => a.blockId === b.id;
    return {
      id: b.id, districtId: b.districtId, name: b.name, lat: b.lat, lng: b.lng,
      population: Math.round(d.population * b.popShare), remoteness: b.remoteness,
      coverage: cov, openApplications: ob.open, breached: ob.breached, breachPct: ob.open ? ob.breached / ob.open : 0,
      failureRate, anomalyCount: counting.filter(inBlock).length,
      attention: computeAttention({ entityType: 'block', entityId: b.id, name: b.name, districtId: d.id, districtName: d.name, coverage: cov.coverage, openApplications: ob.open, breached: ob.breached, anomalyPoints: pointsFor(inBlock), failureRate, remoteness: b.remoteness }),
    };
  });

  const districtSummaries: DistrictSummary[] = base.districts.map((d) => {
    const bs = blockSummaries.filter((b) => b.districtId === d.id);
    const cov = mergeCoverage(bs.map((b) => b.coverage));
    const open = bs.reduce((a, b) => a + b.openApplications, 0);
    const breached = bs.reduce((a, b) => a + b.breached, 0);
    let n = 0;
    let f = 0;
    for (const b of bs) for (const p of base.monthlyByBlock.get(b.id)!.slice(-3)) { n += p.disbursed; f += p.failed; }
    const failureRate = n ? f / n : 0;
    const inDistrict = (a: Anomaly) => a.districtId === d.id;
    return {
      id: d.id, code: d.code, name: d.name, lat: d.hqLat, lng: d.hqLng, population: d.population, remoteness: d.remoteness,
      coverage: cov, openApplications: open, breached, breachPct: open ? breached / open : 0, failureRate,
      anomalyCount: counting.filter(inDistrict).length,
      attention: computeAttention({ entityType: 'district', entityId: d.id, name: d.name, districtId: d.id, districtName: d.name, coverage: cov.coverage, openApplications: open, breached, anomalyPoints: pointsFor(inDistrict), failureRate, remoteness: d.remoteness }),
    };
  });

  return { ...base, anomalies, districtSummaries, blockSummaries };
}

let base: Base | null = null;
let snap: Snapshot | null = null;

export function getSnapshot(): Snapshot {
  if (!base) base = loadBase();
  if (!snap) snap = derive(base);
  return snap;
}

/** Re-derive scores after a human review changes (cheap). */
export function invalidateReviews() {
  snap = null;
}

/** Full rebuild, e.g. after new data is ingested. */
export function invalidateAll() {
  base = null;
  snap = null;
}
