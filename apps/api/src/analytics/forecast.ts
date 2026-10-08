/**
 * Explainable pendency forecast: Holt's linear exponential smoothing (level + trend)
 * on evenly spaced open-application and SLA-breach counts, with an 80% prediction
 * interval derived from the one-step-ahead residuals. Pure functions, no I/O.
 */
import { ageInDays, asOfMs, isOpenAt, type AppLite } from './pendency';

const DAY = 86_400_000;

export const FORECAST = {
  /** Fewer points than this and we refuse to forecast. */
  minPoints: 6,
  /** Spacing of the series (≈ one month) and how far ahead we project. */
  stepDays: 30,
  horizonDays: 60,
  /** Two-sided 80% interval → standard normal 90th percentile. */
  coverage: 0.8,
  z: 1.2816,
  /** α, β grid searched to minimise the one-step squared error. */
  grid: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
} as const;

export interface SeriesPoint { date: string; value: number }
export interface ForecastPoint { date: string; daysAhead: number; value: number; lower: number; upper: number }

export interface HoltFit {
  alpha: number;
  beta: number;
  level: number;
  trend: number;
  /** One-step-ahead residuals (actual − predicted) from the third point on. */
  residuals: number[];
  sse: number;
}

/** Fit Holt's method with fixed α (level) and β (trend). Initial level = y0, trend = y1 − y0. */
export function holt(ys: number[], alpha: number, beta: number): HoltFit {
  let level = ys[0];
  let trend = ys[1] - ys[0];
  const residuals: number[] = [];
  for (let t = 1; t < ys.length; t++) {
    const predicted = level + trend;
    if (t >= 2) residuals.push(ys[t] - predicted);
    const prevLevel = level;
    level = alpha * ys[t] + (1 - alpha) * predicted;
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }
  return { alpha, beta, level, trend, residuals, sse: residuals.reduce((a, r) => a + r * r, 0) };
}

/** Grid-search α, β; ties keep the first (smallest) pair so results are deterministic. */
export function fitHolt(ys: number[]): HoltFit {
  let best: HoltFit | null = null;
  for (const a of FORECAST.grid) for (const b of FORECAST.grid) {
    const f = holt(ys, a, b);
    if (!best || f.sse < best.sse - 1e-9) best = f;
  }
  return best!;
}

/**
 * h-step forecast with prediction interval. For Holt's method the h-step error variance is
 * σ²·(1 + Σ_{j=1}^{h−1} α²(1 + jβ)²), with σ estimated from the one-step residuals
 * (divided by m − 2 for the two fitted smoothing parameters).
 */
export function projectHolt(fit: HoltFit, h: number, z: number = FORECAST.z) {
  const m = fit.residuals.length;
  const sigma = m > 0 ? Math.sqrt(fit.sse / Math.max(1, m - 2)) : 0;
  let k = 1;
  for (let j = 1; j < h; j++) k += (fit.alpha * (1 + j * fit.beta)) ** 2;
  const mean = fit.level + h * fit.trend;
  const half = z * sigma * Math.sqrt(k);
  return { mean, lower: mean - half, upper: mean + half, sigma };
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Forecast one series `horizonDays` ahead in `stepDays` steps. Counts are floored at 0. */
export function forecastSeries(series: SeriesPoint[], horizonDays: number = FORECAST.horizonDays, stepDays: number = FORECAST.stepDays) {
  const fit = fitHolt(series.map((p) => p.value));
  const lastMs = Date.parse(`${series[series.length - 1].date}T00:00:00Z`);
  const steps = Math.max(1, Math.round(horizonDays / stepDays));
  const points: ForecastPoint[] = [];
  let sigma = 0;
  for (let h = 1; h <= steps; h++) {
    const p = projectHolt(fit, h);
    sigma = p.sigma;
    points.push({ date: iso(lastMs + h * stepDays * DAY), daysAhead: h * stepDays, value: Math.max(0, p.mean), lower: Math.max(0, p.lower), upper: Math.max(0, p.upper) });
  }
  return { alpha: fit.alpha, beta: fit.beta, level: fit.level, trend: fit.trend, sigma, points };
}

export type SeriesForecast = ReturnType<typeof forecastSeries>;

/**
 * Reconstruct the open and past-SLA caseload as it stood at `points` evenly spaced dates
 * ending on `asOf` (oldest first), using submission/decision dates.
 */
export function pendencySeries(apps: AppLite[], asOf: string, points: number, stepDays: number = FORECAST.stepDays) {
  const end = asOfMs(asOf);
  const open: SeriesPoint[] = [];
  const breached: SeriesPoint[] = [];
  for (let k = points - 1; k >= 0; k--) {
    const at = end - k * stepDays * DAY;
    let o = 0;
    let b = 0;
    for (const a of apps) {
      if (!isOpenAt(a, at)) continue;
      o++;
      if (ageInDays(a.submittedAt, at) > a.slaDays) b++;
    }
    const date = iso(at);
    open.push({ date, value: o });
    breached.push({ date, value: b });
  }
  return { open, breached };
}

const approx = (n: number) => (n >= 100 ? Math.round(n / 10) * 10 : Math.round(n));
const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function forecastSentence(areaName: string, breachedNow: number, breachedAtHorizon: number, horizonDate: string, horizonDays: number): string {
  const n = approx(breachedAtHorizon);
  const when = shortDate(horizonDate);
  if (n === 0) return `At the current rate, ${areaName} is on track to have no cases past SLA by ${when}.`;
  const perDay = Math.max(1, Math.ceil(breachedAtHorizon / horizonDays));
  const direction = n > breachedNow ? `up from ${breachedNow} today` : n < breachedNow ? `down from ${breachedNow} today` : 'about the same as today';
  return `At the current rate, ${areaName} will have ~${n} cases past SLA by ${when} (${direction}); clearing it needs ~${perDay} extra verification${perDay === 1 ? '' : 's'} per day.`;
}

export const FORECAST_METHOD =
  `Holt's linear exponential smoothing (a level and a trend, each updated as an exponentially weighted average) fitted to the caseload at ${FORECAST.stepDays}-day intervals. ` +
  `α (level) and β (trend) are chosen from a 0.1–0.9 grid to minimise one-step-ahead error. The shaded band is an ${FORECAST.coverage * 100}% prediction interval: ` +
  `±${FORECAST.z} × σ × √(1 + Σ α²(1 + jβ)²), where σ is the spread of past one-step forecast errors. It assumes the recent trend continues and no intervention.`;

export type PendencyForecast =
  | { ok: false; reason: string; areaName: string; asOf: string; actual: { open: SeriesPoint[]; breached: SeriesPoint[] } }
  | {
      ok: true;
      areaName: string;
      asOf: string;
      horizonDays: number;
      coverage: number;
      actual: { open: SeriesPoint[]; breached: SeriesPoint[] };
      forecast: { open: SeriesForecast; breached: SeriesForecast };
      summary: string;
      extraPerDay: number;
      method: string;
    };

export function forecastPendency(input: { areaName: string; asOf: string; open: SeriesPoint[]; breached: SeriesPoint[]; horizonDays?: number; stepDays?: number }): PendencyForecast {
  const { areaName, asOf, open, breached } = input;
  const horizonDays = input.horizonDays ?? FORECAST.horizonDays;
  const stepDays = input.stepDays ?? FORECAST.stepDays;
  const actual = { open, breached };
  const n = Math.min(open.length, breached.length);
  if (n < FORECAST.minPoints)
    return { ok: false, reason: `Only ${n} data point${n === 1 ? '' : 's'} available; at least ${FORECAST.minPoints} are needed to estimate a trend and its uncertainty.`, areaName, asOf, actual };

  const fOpen = forecastSeries(open, horizonDays, stepDays);
  const fBreached = forecastSeries(breached, horizonDays, stepDays);
  const last = fBreached.points[fBreached.points.length - 1];
  const breachedNow = breached[breached.length - 1].value;
  return {
    ok: true,
    areaName,
    asOf,
    horizonDays,
    coverage: FORECAST.coverage,
    actual,
    forecast: { open: fOpen, breached: fBreached },
    summary: forecastSentence(areaName, breachedNow, last.value, last.date, horizonDays),
    extraPerDay: last.value > 0 ? Math.max(1, Math.ceil(last.value / horizonDays)) : 0,
    method: FORECAST_METHOD,
  };
}
