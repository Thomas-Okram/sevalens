import { describe, expect, it } from 'vitest';
import { FORECAST, fitHolt, forecastPendency, forecastSentence, forecastSeries, pendencySeries, type SeriesPoint } from './forecast';

const series = (values: number[], start = '2026-01-01'): SeriesPoint[] =>
  values.map((value, i) => ({ date: new Date(Date.parse(`${start}T00:00:00Z`) + i * 30 * 86_400_000).toISOString().slice(0, 10), value }));

describe('Holt forecast', () => {
  it('projects a constant series flat with a zero-width interval', () => {
    const f = forecastSeries(series(Array(12).fill(40)));
    expect(f.trend).toBeCloseTo(0);
    expect(f.points).toHaveLength(2);
    for (const p of f.points) {
      expect(p.value).toBeCloseTo(40);
      expect(p.lower).toBeCloseTo(40);
      expect(p.upper).toBeCloseTo(40);
    }
    expect(f.points.map((p) => p.daysAhead)).toEqual([30, 60]);
  });

  it('extends a linear trend exactly', () => {
    const ys = Array.from({ length: 10 }, (_, i) => 100 + 15 * i); // last = 235
    const f = forecastSeries(series(ys));
    expect(f.trend).toBeCloseTo(15);
    expect(f.points[0].value).toBeCloseTo(250);
    expect(f.points[1].value).toBeCloseTo(265);
    expect(f.points[1].upper - f.points[1].lower).toBeCloseTo(0);
    expect(f.points[1].date).toBe('2026-11-27'); // (9 + 2) × 30 days after 1 Jan
  });

  it('widens the interval with the horizon on a noisy series and keeps counts non-negative', () => {
    const noise = [3, -4, 2, -1, 5, -3, 0, 4, -2, 1, -5, 2];
    const f = forecastSeries(series(noise.map((e, i) => 50 + 4 * i + e)));
    const [p1, p2] = f.points;
    expect(f.sigma).toBeGreaterThan(0);
    expect(p1.lower).toBeLessThan(p1.value);
    expect(p1.upper).toBeGreaterThan(p1.value);
    expect(p2.upper - p2.lower).toBeGreaterThan(p1.upper - p1.lower);
    const falling = forecastSeries(series([60, 50, 40, 30, 20, 10]));
    expect(falling.points.every((p) => p.value >= 0 && p.lower >= 0)).toBe(true);
  });

  it('picks smoothing parameters from the grid', () => {
    const fit = fitHolt([10, 12, 9, 14, 13, 17, 15, 19]);
    expect(FORECAST.grid).toContain(fit.alpha);
    expect(FORECAST.grid).toContain(fit.beta);
    expect(fit.residuals).toHaveLength(6);
  });
});

describe('pendency forecast', () => {
  it('refuses to forecast with fewer than 6 points and says why', () => {
    const r = forecastPendency({ areaName: 'Lamshang', asOf: '2026-10-01', open: series([1, 2, 3, 4, 5]), breached: series([0, 1, 1, 2, 2]) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/Only 5 data points/);
    expect(r.reason).toMatch(/at least 6/);
    expect(r.actual.open).toHaveLength(5);
  });

  it('forecasts both series and writes a plain-English summary', () => {
    const r = forecastPendency({ areaName: 'Lamshang', asOf: '2026-10-09', open: series([300, 320, 340, 360, 380, 400]), breached: series([200, 260, 320, 380, 440, 500]) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.forecast.breached.points[1].value).toBeCloseTo(620);
    expect(r.forecast.open.points[1].value).toBeCloseTo(440);
    expect(r.extraPerDay).toBe(11); // ceil(620 / 60)
    expect(r.summary).toBe(`At the current rate, Lamshang will have ~620 cases past SLA by ${new Date(Date.parse(r.forecast.breached.points[1].date + 'T00:00:00Z')).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} (up from 500 today); clearing it needs ~11 extra verifications per day.`);
  });

  it('phrases the sentence like the brief', () => {
    expect(forecastSentence('Lamshang', 410, 517, '2026-12-08', 60)).toBe('At the current rate, Lamshang will have ~520 cases past SLA by 8 Dec (up from 410 today); clearing it needs ~9 extra verifications per day.');
    expect(forecastSentence('Ukhrul', 12, 0.3, '2026-12-08', 60)).toBe('At the current rate, Ukhrul is on track to have no cases past SLA by 8 Dec.');
  });

  it('reconstructs open and past-SLA counts at past dates', () => {
    const apps = [
      { submittedAt: '2026-08-01T00:00:00', decidedAt: null, slaDays: 30, pendingStage: null }, // open throughout, breached from ~31 Aug
      { submittedAt: '2026-09-20T00:00:00', decidedAt: '2026-10-05T00:00:00', slaDays: 30, pendingStage: null }, // open only at the middle point
    ];
    const s = pendencySeries(apps, '2026-10-09', 3);
    expect(s.open.map((p) => p.date)).toEqual(['2026-08-10', '2026-09-09', '2026-10-09']);
    expect(s.open.map((p) => p.value)).toEqual([1, 1, 1]);
    expect(s.breached.map((p) => p.value)).toEqual([0, 1, 1]);
    const s2 = pendencySeries(apps, '2026-09-25', 1);
    expect(s2.open[0].value).toBe(2);
  });
});
