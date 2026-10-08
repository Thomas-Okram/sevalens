import type { AttentionFactorKey, AttentionScore, FactorContribution, Severity } from '@sevalens/shared';
import { ATTENTION_LEVELS, ATTENTION_SCALES, ATTENTION_WEIGHTS } from './config';
import { clamp01 } from './stats';

export interface AttentionInput {
  entityType: 'district' | 'block';
  entityId: number;
  name: string;
  districtId: number;
  districtName: string;
  coverage: number; // enrolled / estimated eligible
  openApplications: number;
  breached: number;
  anomalyPoints: number; // sum of severity points of open anomalies
  failureRate: number; // failed + returned share of recent payments
  remoteness: number; // 0..1
}

const LABELS: Record<AttentionFactorKey, string> = {
  coverageGap: 'Coverage gap',
  slaBreach: 'SLA breach',
  anomalies: 'Anomalies',
  disbursementFailure: 'Payment failures',
  remoteness: 'Remoteness',
};

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function levelFor(score: number): Severity {
  return score >= ATTENTION_LEVELS.high ? 'high' : score >= ATTENTION_LEVELS.medium ? 'medium' : 'low';
}

/**
 * Attention Score (0–100) = 100 × Σ weight_i × normalised_i.
 * Each factor is normalised to 0..1 on a fixed scale (see ATTENTION_SCALES) so scores
 * are stable over time and directly explainable.
 */
export function computeAttention(input: AttentionInput, weights: Record<AttentionFactorKey, number> = ATTENTION_WEIGHTS): AttentionScore {
  const gapRatio = Math.max(0, 1 - input.coverage);
  const breachRate = input.openApplications > 0 ? input.breached / input.openApplications : 0;
  // damp the breach rate for tiny caseloads so 1 late case of 2 doesn't dominate
  const breachDamped = breachRate * Math.min(1, input.openApplications / 10);

  const raw: Record<AttentionFactorKey, { raw: number; norm: number; rawLabel: string; explanation: string }> = {
    coverageGap: {
      raw: gapRatio,
      norm: clamp01(gapRatio / ATTENTION_SCALES.coverageGap),
      rawLabel: `${pct(gapRatio)} of est. eligible not enrolled`,
      explanation: `1 − coverage, scaled so ${pct(ATTENTION_SCALES.coverageGap)} gap = maximum.`,
    },
    slaBreach: {
      raw: breachRate,
      norm: clamp01(breachDamped / ATTENTION_SCALES.slaBreach),
      rawLabel: `${input.breached} of ${input.openApplications} open cases past SLA (${pct(breachRate)})`,
      explanation: `Share of open applications older than the scheme SLA, scaled so ${pct(ATTENTION_SCALES.slaBreach)} = maximum (damped below 10 open cases).`,
    },
    anomalies: {
      raw: input.anomalyPoints,
      norm: clamp01(input.anomalyPoints / ATTENTION_SCALES.anomalies),
      rawLabel: `${input.anomalyPoints} severity points`,
      explanation: `Open anomalies weighted high = 3, medium = 2, low = 1; ${ATTENTION_SCALES.anomalies} points = maximum.`,
    },
    disbursementFailure: {
      raw: input.failureRate,
      norm: clamp01((input.failureRate - ATTENTION_SCALES.disbursementFailureFloor) / ATTENTION_SCALES.disbursementFailure),
      rawLabel: `${pct(input.failureRate)} of payments failed/returned (last 3 months)`,
      explanation: `Failure rate above a ${pct(ATTENTION_SCALES.disbursementFailureFloor)} background, scaled so +${pct(ATTENTION_SCALES.disbursementFailure)} = maximum.`,
    },
    remoteness: {
      raw: input.remoteness,
      norm: clamp01(input.remoteness),
      rawLabel: `index ${input.remoteness.toFixed(2)}`,
      explanation: 'Terrain / access difficulty index (0–1): remote areas need more outreach effort.',
    },
  };

  const factors: FactorContribution[] = (Object.keys(weights) as AttentionFactorKey[]).map((key) => ({
    key,
    label: LABELS[key],
    raw: +raw[key].raw.toFixed(4),
    rawLabel: raw[key].rawLabel,
    normalized: +raw[key].norm.toFixed(3),
    weight: weights[key],
    points: +(100 * weights[key] * raw[key].norm).toFixed(1),
    explanation: raw[key].explanation,
  }));

  const score = Math.round(factors.reduce((a, f) => a + f.points, 0));
  const top = [...factors].sort((a, b) => b.points - a.points)[0];
  return {
    entityType: input.entityType,
    entityId: input.entityId,
    name: input.name,
    districtId: input.districtId,
    districtName: input.districtName,
    score,
    level: levelFor(score),
    factors,
    topReason: `${top.label}: ${top.rawLabel}`,
  };
}
