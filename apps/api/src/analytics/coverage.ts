import type { CoverageCell, CoverageSummary } from '@sevalens/shared';

export interface PopulationProfile {
  population: number;
  pctElderly: number;
  pctWidows: number;
  pctPwd: number;
}

export interface SchemeRule {
  id: number;
  code: string;
  shortName: string;
  eligibleBasis: string; // population | pct_elderly | pct_widows | pct_pwd
  eligibleFactor: number;
}

/** estimated_eligible = population x basis share x scheme factor */
export function estimateEligible(p: PopulationProfile, s: SchemeRule): number {
  const share =
    s.eligibleBasis === 'population' ? 1
    : s.eligibleBasis === 'pct_elderly' ? p.pctElderly
    : s.eligibleBasis === 'pct_widows' ? p.pctWidows
    : s.eligibleBasis === 'pct_pwd' ? p.pctPwd
    : 0;
  return Math.max(0, p.population * share * s.eligibleFactor);
}

export function coverageCell(s: SchemeRule, eligible: number, enrolled: number): CoverageCell {
  const e = Math.round(eligible);
  return {
    schemeId: s.id,
    schemeCode: s.code,
    schemeName: s.shortName,
    eligible: e,
    enrolled,
    coverage: e > 0 ? enrolled / e : 0,
    gap: Math.max(0, e - enrolled),
  };
}

export function summarizeCoverage(cells: CoverageCell[]): CoverageSummary {
  const eligible = cells.reduce((a, c) => a + c.eligible, 0);
  const enrolled = cells.reduce((a, c) => a + c.enrolled, 0);
  return {
    eligible,
    enrolled,
    coverage: eligible > 0 ? enrolled / eligible : 0,
    gap: cells.reduce((a, c) => a + c.gap, 0),
    bySchemes: cells,
  };
}

/** Sum coverage summaries scheme-by-scheme (e.g. blocks -> district, districts -> state). */
export function mergeCoverage(list: CoverageSummary[]): CoverageSummary {
  const byId = new Map<number, CoverageCell>();
  for (const c of list.flatMap((l) => l.bySchemes)) {
    const cur = byId.get(c.schemeId);
    if (!cur) byId.set(c.schemeId, { ...c });
    else {
      cur.eligible += c.eligible;
      cur.enrolled += c.enrolled;
      cur.gap += c.gap;
    }
  }
  const cells = [...byId.values()].map((c) => ({ ...c, coverage: c.eligible > 0 ? c.enrolled / c.eligible : 0 }));
  return summarizeCoverage(cells.sort((a, b) => a.schemeId - b.schemeId));
}
