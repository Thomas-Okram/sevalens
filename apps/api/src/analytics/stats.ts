/** Robust statistics helpers (no external deps). */

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median absolute deviation. */
export function mad(xs: number[]): number {
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

/**
 * Robust z-score of `x` against a baseline: (x - median) / (1.4826 * MAD).
 * `floor` guards against a zero MAD (e.g. flat baselines); for counts we pass a
 * Poisson-style floor of sqrt(median).
 */
export function robustZ(x: number, baseline: number[], floor = 1e-9): number {
  const m = median(baseline);
  const scale = Math.max(1.4826 * mad(baseline), floor);
  return (x - m) / scale;
}

/** Robust z for every element of a population against the whole population. */
export function robustZAll(xs: number[], floor = 1e-9): number[] {
  const m = median(xs);
  const scale = Math.max(1.4826 * mad(xs), floor);
  return xs.map((x) => (x - m) / scale);
}

/** Scale floor for count data: Poisson sd ~ sqrt(mean). */
export const countFloor = (baseline: number[]) => Math.max(1, Math.sqrt(Math.max(median(baseline), 1)));

export const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
