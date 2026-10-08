import { describe, expect, it } from 'vitest';
import {
  ATTENTION_WEIGHTS,
  computeAttention,
  coverageCell,
  detectBacklogs,
  detectOfficerOutliers,
  detectSpike,
  estimateEligible,
  findDuplicatePairs,
  jaroWinkler,
  levenshtein,
  mad,
  median,
  mergeCoverage,
  nameSimilarity,
  normalizeName,
  robustZ,
  summarizeCoverage,
  summarizePendency,
  type BenLite,
  type OfficerStats,
} from './index';

const place = (id: number) => ({ districtId: 1, districtName: 'D', blockId: id, blockName: `B${id}` });

describe('coverage math', () => {
  const profile = { population: 100_000, pctElderly: 0.08, pctWidows: 0.03, pctPwd: 0.016 };
  const oap = { id: 1, code: 'IGNOAPS', shortName: 'OAP', eligibleBasis: 'pct_elderly', eligibleFactor: 0.1 };
  const pmmvy = { id: 4, code: 'PMMVY', shortName: 'Mat', eligibleBasis: 'population', eligibleFactor: 0.0025 };

  it('estimates eligible = population x basis share x factor', () => {
    expect(estimateEligible(profile, oap)).toBeCloseTo(800);
    expect(estimateEligible(profile, pmmvy)).toBeCloseTo(250);
  });

  it('computes coverage and a non-negative gap', () => {
    const c = coverageCell(oap, 800, 600);
    expect(c.coverage).toBeCloseTo(0.75);
    expect(c.gap).toBe(200);
    const over = coverageCell(oap, 100, 120);
    expect(over.gap).toBe(0);
    expect(over.coverage).toBeCloseTo(1.2);
  });

  it('handles zero eligible without dividing by zero', () => {
    expect(coverageCell(oap, 0, 5).coverage).toBe(0);
  });

  it('summarises and merges coverage across areas', () => {
    const a = summarizeCoverage([coverageCell(oap, 800, 600), coverageCell(pmmvy, 250, 50)]);
    expect(a.eligible).toBe(1050);
    expect(a.enrolled).toBe(650);
    expect(a.gap).toBe(400);
    const merged = mergeCoverage([a, a]);
    expect(merged.eligible).toBe(2100);
    expect(merged.bySchemes.find((c) => c.schemeId === 4)!.coverage).toBeCloseTo(0.2);
  });
});

describe('robust z-score', () => {
  it('median and MAD', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(mad([1, 1, 2, 2, 4, 6, 9])).toBe(1);
  });

  it('is robust to an outlier in the baseline', () => {
    const baseline = [10, 11, 9, 10, 12, 10, 9, 11, 500];
    expect(Math.abs(robustZ(11, baseline))).toBeLessThan(1.5);
    expect(robustZ(60, baseline)).toBeGreaterThan(3.5);
  });

  it('respects a floor when MAD is zero', () => {
    expect(robustZ(5, [5, 5, 5, 5], 1)).toBe(0);
    expect(robustZ(9, [5, 5, 5, 5], 1)).toBeCloseTo(4);
  });

  it('detectSpike flags a late surge but not ordinary noise', () => {
    const months = Array.from({ length: 18 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`);
    const noisy = [5, 6, 4, 5, 7, 5, 6, 4, 5, 6, 5, 4, 6, 5, 7, 6, 5, 7];
    expect(detectSpike(noisy, months)).toBeNull();
    const surge = [...noisy.slice(0, 15), 6, 90, 110];
    const s = detectSpike(surge, months)!;
    expect(s).not.toBeNull();
    expect(s.month).toBe(months[17]);
    expect(s.z).toBeGreaterThan(3.5);
  });

  it('detectSpike ignores tiny absolute changes even with high z', () => {
    const months = Array.from({ length: 18 }, (_, i) => String(i));
    const flat = [...Array(15).fill(0), 0, 0, 4];
    expect(detectSpike(flat, months)).toBeNull();
  });
});

describe('duplicate matcher', () => {
  it('normalises names and scores similarity', () => {
    expect(normalizeName('  Smt. Sunita  DEVI ')).toBe('sunita devi');
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.961, 2);
    expect(nameSimilarity('Rajesh Kumar', 'Rajesh Kumaar')).toBeGreaterThan(0.9);
    expect(nameSimilarity('Rajesh Kumar', 'Anita Singh')).toBeLessThan(0.7);
  });

  const ben = (id: number, over: Partial<BenLite>): BenLite => ({
    id, hash: `h${id}`, name: 'Person', dob: '1950-01-01', blockId: 1, village: 'V', schemeCode: 'IGNOAPS', ...over,
  });

  it('finds exact-id and fuzzy name+DOB pairs, and nothing else', () => {
    const bens = [
      ben(1, { hash: 'X', name: 'Sunita Devi' }),
      ben(2, { hash: 'X', name: 'Sunita Devi', schemeCode: 'SSSP' }), // exact id
      ben(3, { name: 'Ramesh Sharma', dob: '1948-02-02' }),
      ben(4, { name: 'Ramesh Sharmaa', dob: '1948-02-02' }), // fuzzy, same block+dob
      ben(5, { name: 'Ramesh Sharmaa', dob: '1948-02-02', blockId: 2 }), // different block
      ben(6, { name: 'Anil Kapoor', dob: '1948-02-02' }), // same block+dob, different name
      ben(7, { name: 'Sunita Devi', dob: '1960-03-03' }), // same name, different dob
    ];
    const pairs = findDuplicatePairs(bens);
    const ids = pairs.map((p) => [p.a.id, p.b.id, p.kind]);
    expect(ids).toContainEqual([1, 2, 'exact_id']);
    expect(ids).toContainEqual([3, 4, 'fuzzy_name_dob']);
    expect(pairs).toHaveLength(2);
  });
});

describe('officer outliers & backlogs', () => {
  it('flags an officer far outside peers on approval rate and speed', () => {
    const officers: OfficerStats[] = Array.from({ length: 20 }, (_, i) => ({
      id: i, code: `O${i}`, decisions: 100, approvalRate: 0.72 + (i % 5) * 0.01, medianDays: 10 + (i % 4), place: place(i),
    }));
    officers.push({ id: 99, code: 'FAST', decisions: 300, approvalRate: 0.99, medianDays: 0.3, place: place(99) });
    const out = detectOfficerOutliers(officers);
    expect(out.map((o) => o.officer.code)).toEqual(['FAST']);
    expect(out[0].zSpeed).toBeLessThan(-3.5);
  });

  it('ignores officers with too few decisions', () => {
    const officers: OfficerStats[] = Array.from({ length: 10 }, (_, i) => ({
      id: i, code: `O${i}`, decisions: i === 0 ? 5 : 100, approvalRate: i === 0 ? 1 : 0.7, medianDays: 10, place: place(i),
    }));
    expect(detectOfficerOutliers(officers)).toHaveLength(0);
  });

  it('flags a block with an unusual SLA-breach backlog', () => {
    const blocks = Array.from({ length: 12 }, (_, i) => ({ place: place(i), open: 20, breached: 2 + (i % 3), topStage: 'Sanction' }));
    blocks.push({ place: place(50), open: 400, breached: 290, topStage: 'Field verification' });
    const res = detectBacklogs(blocks);
    expect(res).toHaveLength(1);
    expect(res[0].blockId).toBe(50);
    expect(res[0].severity).toBe('high');
  });
});

describe('pendency', () => {
  it('buckets open applications by age and computes SLA breach', () => {
    const asOf = '2026-10-08';
    const mk = (daysOld: number, decided = false) => {
      const d = new Date(Date.parse('2026-10-08T12:00:00Z') - daysOld * 86_400_000).toISOString().slice(0, 19);
      return { submittedAt: d, decidedAt: decided ? d : null, slaDays: 30, pendingStage: 'field_verification' };
    };
    const s = summarizePendency([mk(3), mk(20), mk(45), mk(90), mk(10, true)], asOf);
    expect(s.open).toBe(4);
    expect(s.buckets.map((b) => b.count)).toEqual([1, 1, 1, 1]);
    expect(s.breached).toBe(2);
    expect(s.breachPct).toBeCloseTo(0.5);
    expect(s.stages.find((x) => x.stage === 'field_verification')!.count).toBe(4);
  });
});

describe('attention score', () => {
  const base = {
    entityType: 'district' as const, entityId: 1, name: 'X', districtId: 1, districtName: 'X',
    coverage: 0.85, openApplications: 100, breached: 5, anomalyPoints: 0, failureRate: 0.015, remoteness: 0.1,
  };

  it('weights sum to 1', () => {
    expect(Object.values(ATTENTION_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it('returns a factor breakdown whose points sum to the score', () => {
    const s = computeAttention(base);
    expect(s.factors).toHaveLength(5);
    expect(Math.abs(s.factors.reduce((a, f) => a + f.points, 0) - s.score)).toBeLessThanOrEqual(0.5);
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(100);
    expect(s.level).toBe('low');
  });

  it('is monotonic: a worse coverage gap never lowers the score', () => {
    const good = computeAttention(base).score;
    const bad = computeAttention({ ...base, coverage: 0.2 }).score;
    expect(bad).toBeGreaterThan(good);
  });

  it('a remote, low-coverage, anomalous area is flagged high and explains why', () => {
    const s = computeAttention({ ...base, coverage: 0.18, remoteness: 0.92, anomalyPoints: 6, breached: 60, failureRate: 0.12 });
    expect(s.level).toBe('high');
    expect(s.topReason).toMatch(/Coverage gap/);
  });

  it('caps each factor at its weight', () => {
    const s = computeAttention({ ...base, coverage: -5, breached: 1000, openApplications: 1000, anomalyPoints: 99, failureRate: 5, remoteness: 3 });
    expect(s.score).toBe(100);
  });
});
