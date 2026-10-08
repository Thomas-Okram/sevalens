/**
 * Explainable anomaly detection. Every detector is rule- or robust-statistics-based
 * and returns a plain-English reason plus expected-vs-observed values.
 */
import type { Anomaly, AnomalyType, Severity } from '@sevalens/shared';
import { ANOMALY } from './config';
import { countFloor, median, robustZ, robustZAll } from './stats';
import { nameSimilarity } from './similarity';

export type DetectedAnomaly = Omit<Anomaly, 'review'>;

export const ANOMALY_TYPE_LABELS: Record<AnomalyType, string> = {
  duplicate_beneficiary: 'Possible duplicate beneficiaries',
  deceased_paid: 'Payments after recorded death',
  application_spike: 'Unusual surge in applications',
  rejection_spike: 'Unusual surge in rejections',
  disbursement_failure_spike: 'Disbursement failure spike',
  officer_outlier: 'Officer decision pattern outlier',
  pendency_backlog: 'Pendency backlog (SLA breach)',
};

export interface Place {
  districtId: number;
  districtName: string;
  blockId: number | null;
  blockName: string | null;
}

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-IN');
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

// ---------------- Duplicates ----------------

export interface BenLite {
  id: number;
  hash: string;
  name: string;
  dob: string;
  blockId: number;
  village: string;
  schemeCode: string;
}

export interface DuplicatePair {
  a: BenLite;
  b: BenLite;
  kind: 'exact_id' | 'fuzzy_name_dob';
  similarity: number;
}

/**
 * Two rules:
 *  1. exact_id — same salted Aadhaar hash on more than one record.
 *  2. fuzzy_name_dob — same block + same DOB + name similarity >= threshold, different hash.
 * Fuzzy comparison is "blocked" by (block, DOB) so it stays O(n) in practice.
 */
export function findDuplicatePairs(bens: BenLite[], threshold: number = ANOMALY.fuzzyNameThreshold): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  const byHash = new Map<string, BenLite[]>();
  for (const b of bens) {
    const g = byHash.get(b.hash);
    if (g) g.push(b);
    else byHash.set(b.hash, [b]);
  }
  for (const g of byHash.values()) {
    for (let i = 1; i < g.length; i++) pairs.push({ a: g[0], b: g[i], kind: 'exact_id', similarity: 1 });
  }
  const byBlockDob = new Map<string, BenLite[]>();
  for (const b of bens) {
    const k = `${b.blockId}|${b.dob}`;
    const g = byBlockDob.get(k);
    if (g) g.push(b);
    else byBlockDob.set(k, [b]);
  }
  for (const g of byBlockDob.values()) {
    if (g.length < 2) continue;
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        if (g[i].hash === g[j].hash) continue; // already covered by rule 1
        const sim = nameSimilarity(g[i].name, g[j].name);
        if (sim >= threshold) pairs.push({ a: g[i], b: g[j], kind: 'fuzzy_name_dob', similarity: sim });
      }
    }
  }
  return pairs;
}

export function duplicateAnomaly(place: Place, pairs: DuplicatePair[], monthlyAtRisk: number, blockBeneficiaries: number): DetectedAnomaly {
  const exact = pairs.filter((p) => p.kind === 'exact_id').length;
  const fuzzy = pairs.length - exact;
  const severity: Severity = pairs.length >= 10 ? 'high' : pairs.length >= 3 ? 'medium' : 'low';
  const expectedPairs = Math.max(0, Math.round(blockBeneficiaries * 0.0002));
  return {
    key: `dup:block:${place.blockId}`,
    type: 'duplicate_beneficiary',
    typeLabel: ANOMALY_TYPE_LABELS.duplicate_beneficiary,
    severity,
    ...place,
    entityLabel: `${place.blockName}, ${place.districtName}`,
    metric: 'Suspected duplicate record pairs',
    expected: `≈${expectedPairs} (background rate)`,
    observed: `${pairs.length} ${pairs.length === 1 ? 'pair' : 'pairs'} (${exact} same Aadhaar, ${fuzzy} near-identical name + DOB)`,
    reason:
      pairs.length === 1
        ? `One pair of beneficiary records in ${place.blockName} ${exact ? 'shares the same Aadhaar (hashed)' : 'has near-identical names with the same date of birth'} — likely an isolated data-entry duplicate.`
        : `${pairs.length} pairs of beneficiary records in ${place.blockName} look like the same person enrolled more than once — ${exact} share the same Aadhaar (hashed) and ${fuzzy} have near-identical names with the same date of birth. Most are enrolled in two pension schemes, which should not overlap.`,
    method: `Exact salted-hash match, plus same block + same DOB + name similarity ≥ ${ANOMALY.fuzzyNameThreshold} (Jaro-Winkler / normalised Levenshtein).`,
    count: pairs.length,
    amountAtRisk: monthlyAtRisk,
    score: null,
  };
}

// ---------------- Deceased still paid ----------------

export interface DeceasedPaidRow {
  beneficiaries: number;
  payments: number;
  amount: number;
}

export function deceasedPaidAnomaly(place: Place, row: DeceasedPaidRow): DetectedAnomaly | null {
  if (row.beneficiaries <= 0) return null;
  const severity: Severity = row.beneficiaries >= 5 || row.amount >= 20000 ? 'high' : 'medium';
  return {
    key: `deceased:district:${place.districtId}`,
    type: 'deceased_paid',
    typeLabel: ANOMALY_TYPE_LABELS.deceased_paid,
    severity,
    ...place,
    entityLabel: place.districtName,
    metric: 'Successful payments after recorded date of death',
    expected: '0',
    observed: `${row.beneficiaries} beneficiaries, ${row.payments} payments, ₹${fmtInt(row.amount)}`,
    reason: `${row.beneficiaries} beneficiaries marked deceased in ${place.districtName} continued to receive ${row.payments} successful payments (₹${fmtInt(row.amount)}) after their recorded date of death. Payments should stop once death is recorded.`,
    method: 'Rule: beneficiary.status = deceased AND disbursement.status = success AND paid_at > deceased_at.',
    count: row.beneficiaries,
    amountAtRisk: row.amount,
    score: null,
  };
}

// ---------------- Time-series spikes ----------------

export interface SpikeResult {
  month: string;
  value: number;
  baselineMedian: number;
  z: number;
}

/**
 * Tests each of the latest `testMonths` points against the earlier months using a
 * robust z-score (median / MAD, Poisson floor for counts). Returns the strongest
 * test point if |z| > threshold and the absolute excess is material.
 */
export function detectSpike(series: number[], months: string[], opts: { threshold?: number; testMonths?: number; minExcess?: number } = {}): SpikeResult | null {
  const threshold = opts.threshold ?? ANOMALY.zThreshold;
  const testMonths = opts.testMonths ?? ANOMALY.testMonths;
  const minExcess = opts.minExcess ?? ANOMALY.minSpikeExcess;
  if (series.length <= testMonths + 3) return null;
  const baseline = series.slice(0, series.length - testMonths);
  const m = median(baseline);
  const floor = countFloor(baseline);
  let best: SpikeResult | null = null;
  for (let i = series.length - testMonths; i < series.length; i++) {
    const z = robustZ(series[i], baseline, floor);
    if (Math.abs(z) > threshold && Math.abs(series[i] - m) >= minExcess && (!best || Math.abs(z) > Math.abs(best.z))) {
      best = { month: months[i], value: series[i], baselineMedian: m, z };
    }
  }
  return best;
}

const SPIKE_META: Record<'application_spike' | 'rejection_spike' | 'disbursement_failure_spike', { metric: string; noun: string; prefix: string }> = {
  application_spike: { metric: 'Applications received per month', noun: 'applications received', prefix: 'spike:apps' },
  rejection_spike: { metric: 'Applications rejected per month', noun: 'rejections', prefix: 'spike:rej' },
  disbursement_failure_spike: { metric: 'Failed / returned payments per month', noun: 'failed or returned payments', prefix: 'spike:fail' },
};

export function spikeAnomaly(type: keyof typeof SPIKE_META, place: Place, s: SpikeResult): DetectedAnomaly {
  const meta = SPIKE_META[type];
  const az = Math.abs(s.z);
  const severity: Severity = az >= 8 ? 'high' : az >= 5 ? 'medium' : 'low';
  const dir = s.z > 0 ? 'above' : 'below';
  return {
    key: `${meta.prefix}:block:${place.blockId}`,
    type,
    typeLabel: ANOMALY_TYPE_LABELS[type],
    severity,
    ...place,
    entityLabel: `${place.blockName}, ${place.districtName}`,
    metric: meta.metric,
    expected: `≈${fmtInt(s.baselineMedian)} / month (median of earlier months)`,
    observed: `${fmtInt(s.value)} in ${s.month}`,
    reason: `${place.blockName} recorded ${fmtInt(s.value)} ${meta.noun} in ${s.month}, far ${dir} its usual ≈${fmtInt(s.baselineMedian)} per month (robust z = ${s.z.toFixed(1)}).`,
    method: `Robust z-score (median/MAD) of the latest ${ANOMALY.testMonths} months vs the earlier 15; flagged when |z| > ${ANOMALY.zThreshold}.`,
    count: Math.round(s.value),
    amountAtRisk: null,
    score: +s.z.toFixed(2),
  };
}

// ---------------- Officer outliers ----------------

export interface OfficerStats {
  id: number;
  code: string;
  decisions: number;
  approvalRate: number;
  medianDays: number;
  place: Place;
}

export interface OfficerOutlier {
  officer: OfficerStats;
  zRate: number;
  zSpeed: number; // on log(days); negative = faster than peers
  peerApproval: number;
  peerMedianDays: number;
}

export function detectOfficerOutliers(officers: OfficerStats[], threshold: number = ANOMALY.zThreshold, minDecisions: number = ANOMALY.officerMinDecisions): OfficerOutlier[] {
  const eligible = officers.filter((o) => o.decisions >= minDecisions);
  if (eligible.length < 5) return [];
  const rates = eligible.map((o) => o.approvalRate);
  const logDays = eligible.map((o) => Math.log(o.medianDays + 0.1));
  const zr = robustZAll(rates, 0.02);
  const zs = robustZAll(logDays, 0.05);
  const peerApproval = median(rates);
  const peerMedianDays = median(eligible.map((o) => o.medianDays));
  return eligible
    .map((o, i) => ({ officer: o, zRate: zr[i], zSpeed: zs[i], peerApproval, peerMedianDays }))
    .filter((x) => Math.abs(x.zRate) > threshold || Math.abs(x.zSpeed) > threshold);
}

export function officerAnomaly(x: OfficerOutlier): DetectedAnomaly {
  const { officer: o } = x;
  const maxZ = Math.max(Math.abs(x.zRate), Math.abs(x.zSpeed));
  const severity: Severity = maxZ >= 8 ? 'high' : maxZ >= 5 ? 'medium' : 'low';
  const speed = o.medianDays < 1 ? `${(o.medianDays * 24).toFixed(0)} hours` : `${o.medianDays.toFixed(1)} days`;
  return {
    key: `officer:${o.id}`,
    type: 'officer_outlier',
    typeLabel: ANOMALY_TYPE_LABELS.officer_outlier,
    severity,
    ...o.place,
    entityLabel: `Officer ${o.code} (${o.place.blockName})`,
    metric: 'Approval rate and median decision time',
    expected: `Peers: ${pct(x.peerApproval)} approved, median ${x.peerMedianDays.toFixed(1)} days`,
    observed: `${pct(o.approvalRate)} approved, median ${speed} (${o.decisions} decisions)`,
    reason: `Officer ${o.code} approves ${pct(o.approvalRate)} of applications with a median decision time of ${speed}, versus peers at ${pct(x.peerApproval)} and ${x.peerMedianDays.toFixed(1)} days. Decisions this fast may skip field verification — worth a sample audit. This is a statistical flag, not a finding of wrongdoing.`,
    method: `Robust z-score vs all officers with ≥ ${ANOMALY.officerMinDecisions} decisions (approval rate z = ${x.zRate.toFixed(1)}, log decision time z = ${x.zSpeed.toFixed(1)}); flagged when |z| > ${ANOMALY.zThreshold}.`,
    count: o.decisions,
    amountAtRisk: null,
    score: +maxZ.toFixed(2),
  };
}

// ---------------- Pendency backlog ----------------

export interface BlockBacklog {
  place: Place;
  open: number;
  breached: number;
  topStage: string;
}

export function detectBacklogs(blocks: BlockBacklog[], threshold: number = ANOMALY.zThreshold, minBreached = 20): DetectedAnomaly[] {
  if (blocks.length < 5) return [];
  const breached = blocks.map((b) => b.breached);
  const zs = robustZAll(breached, countFloor(breached));
  const med = median(breached);
  return blocks
    .map((b, i) => ({ b, z: zs[i] }))
    .filter(({ b, z }) => z > threshold && b.breached >= minBreached)
    .map(({ b, z }) => ({
      key: `backlog:block:${b.place.blockId}`,
      type: 'pendency_backlog' as const,
      typeLabel: ANOMALY_TYPE_LABELS.pendency_backlog,
      severity: (z >= 8 ? 'high' : z >= 5 ? 'medium' : 'low') as Severity,
      ...b.place,
      entityLabel: `${b.place.blockName}, ${b.place.districtName}`,
      metric: 'Open applications past SLA',
      expected: `≈${fmtInt(med)} per block (median)`,
      observed: `${b.breached} of ${b.open} open cases past SLA`,
      reason: `${b.breached} applications in ${b.place.blockName} are past their processing SLA — mostly stuck at "${b.topStage}". The typical block has about ${fmtInt(med)}.`,
      method: `Robust z-score of SLA-breached open cases across all blocks (z = ${z.toFixed(1)}); flagged when z > ${ANOMALY.zThreshold} and ≥ ${minBreached} cases.`,
      count: b.breached,
      amountAtRisk: null,
      score: +z.toFixed(2),
    }));
}

const SEV_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
export const sortAnomalies = <T extends { severity: Severity; count: number }>(xs: T[]) =>
  [...xs].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.count - a.count);
