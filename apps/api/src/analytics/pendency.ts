import type { AgeBucket, PendencySummary, StageCount } from '@sevalens/shared';
import { AGE_BUCKETS, STAGE_LABELS } from './config';
import { median } from './stats';

const DAY = 86_400_000;

export interface AppLite {
  submittedAt: string; // ISO
  decidedAt: string | null;
  slaDays: number;
  pendingStage: string | null;
}

/** "As of" dates are interpreted as end of that day (UTC). */
export const asOfMs = (asOf: string) => Date.parse(asOf.length === 10 ? `${asOf}T18:00:00Z` : asOf);
const parse = (iso: string) => Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso.endsWith('Z') ? iso : `${iso}Z`);

export function ageInDays(submittedAt: string, atMs: number): number {
  return Math.max(0, Math.floor((atMs - parse(submittedAt)) / DAY));
}

export function isOpenAt(a: AppLite, atMs: number): boolean {
  return parse(a.submittedAt) <= atMs && (a.decidedAt === null || parse(a.decidedAt) > atMs);
}

export function bucketIndex(ageDays: number): number {
  const i = AGE_BUCKETS.findIndex((b) => ageDays >= b.min && (b.max === null || ageDays <= b.max));
  return i === -1 ? AGE_BUCKETS.length - 1 : i;
}

export function bucketize(ages: number[]): AgeBucket[] {
  const counts = AGE_BUCKETS.map(() => 0);
  for (const a of ages) counts[bucketIndex(a)]++;
  return AGE_BUCKETS.map((b, i) => ({ ...b, count: counts[i] }));
}

export function summarizePendency(apps: AppLite[], asOf: string): PendencySummary {
  const now = asOfMs(asOf);
  const then = now - 90 * DAY;
  const openNow = apps.filter((a) => a.decidedAt === null && parse(a.submittedAt) <= now);
  const ages = openNow.map((a) => ageInDays(a.submittedAt, now));
  const breachedFlags = openNow.map((a, i) => ages[i] > a.slaDays);
  const breached = breachedFlags.filter(Boolean).length;

  const stageMap = new Map<string, StageCount>();
  openNow.forEach((a, i) => {
    const stage = a.pendingStage ?? 'document_check';
    const cur = stageMap.get(stage) ?? { stage, label: STAGE_LABELS[stage] ?? stage, count: 0, breached: 0 };
    cur.count++;
    if (breachedFlags[i]) cur.breached++;
    stageMap.set(stage, cur);
  });
  const stages = Object.keys(STAGE_LABELS).map((s) => stageMap.get(s) ?? { stage: s, label: STAGE_LABELS[s], count: 0, breached: 0 });

  let open90 = 0;
  let breached90 = 0;
  let received90 = 0;
  let receivedPrev90 = 0;
  for (const a of apps) {
    const sub = parse(a.submittedAt);
    if (sub > then && sub <= now) received90++;
    else if (sub > then - 90 * DAY && sub <= then) receivedPrev90++;
    if (isOpenAt(a, then)) {
      open90++;
      if (ageInDays(a.submittedAt, then) > a.slaDays) breached90++;
    }
  }

  return {
    open: openNow.length,
    breached,
    breachPct: openNow.length ? breached / openNow.length : 0,
    medianAgeDays: Math.round(median(ages)),
    buckets: bucketize(ages),
    stages,
    trend: { openNow: openNow.length, open90DaysAgo: open90, breachedNow: breached, breached90DaysAgo: breached90, received90, receivedPrev90 },
  };
}
