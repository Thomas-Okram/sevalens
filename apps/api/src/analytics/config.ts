import type { AttentionFactorKey } from '@sevalens/shared';

/** Weights for the 0–100 Attention Score. Must sum to 1. Shown in the UI. */
export const ATTENTION_WEIGHTS: Record<AttentionFactorKey, number> = {
  coverageGap: 0.3,
  slaBreach: 0.2,
  anomalies: 0.2,
  disbursementFailure: 0.15,
  remoteness: 0.15,
};

/**
 * Fixed-scale normalisation: raw value at which a factor is considered "maxed out" (normalised = 1).
 * Fixed scales (rather than min-max across districts) keep scores stable and comparable over time.
 */
export const ATTENTION_SCALES = {
  coverageGap: 0.7, // 70% of eligible not enrolled
  slaBreach: 0.6, // 60% of open applications past SLA
  anomalies: 6, // severity points (high=3, medium=2, low=1)
  disbursementFailureFloor: 0.01, // normal background failure rate
  disbursementFailure: 0.15, // 15 pp above background
} as const;

export const ATTENTION_LEVELS = { high: 45, medium: 30 } as const;

export const SEVERITY_POINTS = { high: 3, medium: 2, low: 1 } as const;

export const ANOMALY = {
  zThreshold: 3.5,
  minSpikeExcess: 5, // spike must also exceed baseline median by this many events
  testMonths: 3, // latest months tested against the earlier baseline
  fuzzyNameThreshold: 0.9, // Jaro-Winkler on normalised names
  officerMinDecisions: 30,
} as const;

export const AGE_BUCKETS: { label: string; min: number; max: number | null }[] = [
  { label: '0–15 days', min: 0, max: 15 },
  { label: '16–30 days', min: 16, max: 30 },
  { label: '31–60 days', min: 31, max: 60 },
  { label: '60+ days', min: 61, max: null },
];

export const STAGE_LABELS: Record<string, string> = {
  document_check: 'Document check',
  field_verification: 'Field verification',
  sanction: 'Sanction',
  payment_setup: 'Payment setup',
};
