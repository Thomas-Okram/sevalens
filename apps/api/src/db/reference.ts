/**
 * Reference data for the synthetic demo.
 *
 * ESTIMATES ONLY. District populations are approximate Census-2011-based figures
 * re-apportioned to the 16 present-day districts; demographic shares (% elderly,
 * % widows, % PwD, % rural) and the remoteness index are illustrative estimates
 * chosen to be plausible. Headquarter coordinates are approximate. None of these
 * are official figures and they must not be used for real decisions.
 */

export interface DistrictRef {
  code: string;
  name: string;
  lat: number;
  lng: number;
  population: number;
  pctElderly: number;
  pctWidows: number;
  pctPwd: number;
  pctRural: number;
  remoteness: number; // 0..1, terrain / access difficulty
  blocks: string[];
}

export const DISTRICTS: DistrictRef[] = [
  { code: 'IW', name: 'Imphal West', lat: 24.8, lng: 93.89, population: 518000, pctElderly: 0.089, pctWidows: 0.036, pctPwd: 0.016, pctRural: 0.38, remoteness: 0.05, blocks: ['Lamshang', 'Patsoi', 'Lamphelpat', 'Wangoi', 'Konthoujam'] },
  { code: 'IE', name: 'Imphal East', lat: 24.82, lng: 93.98, population: 413000, pctElderly: 0.086, pctWidows: 0.035, pctPwd: 0.016, pctRural: 0.52, remoteness: 0.1, blocks: ['Porompat', 'Sawombung', 'Keirao Bitra', 'Andro'] },
  { code: 'BPR', name: 'Bishnupur', lat: 24.63, lng: 93.77, population: 237000, pctElderly: 0.084, pctWidows: 0.034, pctPwd: 0.017, pctRural: 0.6, remoteness: 0.2, blocks: ['Bishnupur', 'Nambol', 'Moirang'] },
  { code: 'TBL', name: 'Thoubal', lat: 24.64, lng: 94.0, population: 286000, pctElderly: 0.083, pctWidows: 0.034, pctPwd: 0.017, pctRural: 0.62, remoteness: 0.15, blocks: ['Thoubal', 'Heirok', 'Yairipok', 'Wangjing'] },
  { code: 'KCG', name: 'Kakching', lat: 24.5, lng: 93.98, population: 136000, pctElderly: 0.082, pctWidows: 0.033, pctPwd: 0.017, pctRural: 0.64, remoteness: 0.2, blocks: ['Kakching', 'Waikhong', 'Sugnu'] },
  { code: 'SPT', name: 'Senapati', lat: 25.27, lng: 94.02, population: 300000, pctElderly: 0.068, pctWidows: 0.028, pctPwd: 0.015, pctRural: 0.94, remoteness: 0.55, blocks: ['Senapati', 'Mao', 'Paomata', 'Purul', 'Tadubi'] },
  { code: 'KPI', name: 'Kangpokpi', lat: 25.13, lng: 93.97, population: 193000, pctElderly: 0.066, pctWidows: 0.028, pctPwd: 0.015, pctRural: 0.93, remoteness: 0.5, blocks: ['Kangpokpi', 'Saikul', 'Saitu', 'Bungte Chiru'] },
  { code: 'UKL', name: 'Ukhrul', lat: 25.12, lng: 94.36, population: 138000, pctElderly: 0.07, pctWidows: 0.029, pctPwd: 0.016, pctRural: 0.86, remoteness: 0.7, blocks: ['Ukhrul', 'Lungchong Maiphei', 'Chingai', 'Phungyar'] },
  { code: 'KJG', name: 'Kamjong', lat: 24.86, lng: 94.51, population: 46000, pctElderly: 0.069, pctWidows: 0.03, pctPwd: 0.017, pctRural: 0.98, remoteness: 0.92, blocks: ['Kamjong', 'Kasom Khullen', 'Sahamphung'] },
  { code: 'TML', name: 'Tamenglong', lat: 24.99, lng: 93.5, population: 75000, pctElderly: 0.067, pctWidows: 0.029, pctPwd: 0.016, pctRural: 0.9, remoteness: 0.8, blocks: ['Tamenglong', 'Tamei', 'Tousem'] },
  { code: 'NNY', name: 'Noney', lat: 24.85, lng: 93.62, population: 65000, pctElderly: 0.066, pctWidows: 0.029, pctPwd: 0.017, pctRural: 0.97, remoteness: 0.86, blocks: ['Noney', 'Nungba', 'Khoupum'] },
  { code: 'CCP', name: 'Churachandpur', lat: 24.33, lng: 93.68, population: 228000, pctElderly: 0.065, pctWidows: 0.03, pctPwd: 0.015, pctRural: 0.8, remoteness: 0.55, blocks: ['Churachandpur', 'Henglep', 'Singngat', 'Tuibong', 'Samulamlan'] },
  { code: 'PZL', name: 'Pherzawl', lat: 24.26, lng: 93.19, population: 47000, pctElderly: 0.064, pctWidows: 0.03, pctPwd: 0.017, pctRural: 0.98, remoteness: 0.9, blocks: ['Pherzawl', 'Thanlon', 'Tipaimukh', 'Vangai Range'] },
  { code: 'CDL', name: 'Chandel', lat: 24.32, lng: 94.01, population: 85000, pctElderly: 0.066, pctWidows: 0.03, pctPwd: 0.016, pctRural: 0.9, remoteness: 0.7, blocks: ['Chandel', 'Chakpikarong', 'Khengjoy'] },
  { code: 'TNP', name: 'Tengnoupal', lat: 24.38, lng: 94.15, population: 59000, pctElderly: 0.065, pctWidows: 0.03, pctPwd: 0.016, pctRural: 0.85, remoteness: 0.75, blocks: ['Tengnoupal', 'Moreh', 'Machi'] },
  { code: 'JRB', name: 'Jiribam', lat: 24.8, lng: 93.11, population: 44000, pctElderly: 0.078, pctWidows: 0.032, pctPwd: 0.016, pctRural: 0.85, remoteness: 0.5, blocks: ['Jiribam', 'Borobekra', 'Jirighat'] },
];

export interface SchemeRef {
  code: string;
  name: string;
  shortName: string;
  category: 'pension' | 'maternity' | 'education';
  minAge: number | null;
  maxAge: number | null;
  gender: 'F' | 'M' | null;
  requiresPwd: boolean;
  requiresBpl: boolean;
  eligibilityText: string;
  eligibleBasis: 'population' | 'pct_elderly' | 'pct_widows' | 'pct_pwd';
  eligibleFactor: number;
  benefitAmount: number;
  frequency: 'monthly' | 'instalment' | 'annual';
  slaDays: number;
  exclusiveGroup: string | null;
}

/**
 * eligibleFactor = estimated share of the basis population that meets the
 * remaining criteria (e.g. BPL). Illustrative, tuned for the demo.
 */
export const SCHEMES: SchemeRef[] = [
  { code: 'IGNOAPS', name: 'Indira Gandhi National Old Age Pension Scheme', shortName: 'Old Age Pension', category: 'pension', minAge: 60, maxAge: null, gender: null, requiresPwd: false, requiresBpl: true, eligibilityText: 'Age 60+ and belonging to a BPL household', eligibleBasis: 'pct_elderly', eligibleFactor: 0.1, benefitAmount: 500, frequency: 'monthly', slaDays: 30, exclusiveGroup: 'pension' },
  { code: 'IGNWPS', name: 'Indira Gandhi National Widow Pension Scheme', shortName: 'Widow Pension', category: 'pension', minAge: 40, maxAge: 79, gender: 'F', requiresPwd: false, requiresBpl: true, eligibilityText: 'Widow aged 40–79 from a BPL household', eligibleBasis: 'pct_widows', eligibleFactor: 0.13, benefitAmount: 500, frequency: 'monthly', slaDays: 30, exclusiveGroup: 'pension' },
  { code: 'IGNDPS', name: 'Indira Gandhi National Disability Pension Scheme', shortName: 'Disability Pension', category: 'pension', minAge: 18, maxAge: 79, gender: null, requiresPwd: true, requiresBpl: true, eligibilityText: 'Person with 80%+ disability, aged 18–79, BPL', eligibleBasis: 'pct_pwd', eligibleFactor: 0.13, benefitAmount: 500, frequency: 'monthly', slaDays: 30, exclusiveGroup: 'pension' },
  { code: 'PMMVY', name: 'Pradhan Mantri Matru Vandana Yojana', shortName: 'Maternity Benefit', category: 'maternity', minAge: 19, maxAge: null, gender: 'F', requiresPwd: false, requiresBpl: false, eligibilityText: 'Pregnant / lactating women (first child; second if girl)', eligibleBasis: 'population', eligibleFactor: 0.0024, benefitAmount: 2500, frequency: 'instalment', slaDays: 30, exclusiveGroup: null },
  { code: 'PMS', name: 'Post-Matric Scholarship (SC/ST/OBC)', shortName: 'Post-Matric Scholarship', category: 'education', minAge: 15, maxAge: 30, gender: null, requiresPwd: false, requiresBpl: false, eligibilityText: 'SC/ST/OBC students in post-matric courses within income ceiling', eligibleBasis: 'population', eligibleFactor: 0.0026, benefitAmount: 12000, frequency: 'annual', slaDays: 45, exclusiveGroup: null },
  { code: 'SSSP', name: 'State Social Security Pension', shortName: 'State Pension', category: 'pension', minAge: 60, maxAge: null, gender: null, requiresPwd: false, requiresBpl: false, eligibilityText: 'Age 60+ not covered by a central pension scheme', eligibleBasis: 'pct_elderly', eligibleFactor: 0.042, benefitAmount: 200, frequency: 'monthly', slaDays: 30, exclusiveGroup: 'pension' },
];

/** Districts planted with low coverage (remote / difficult terrain). */
export const LOW_COVERAGE: Record<string, number> = { KJG: 0.22, PZL: 0.27, NNY: 0.3 };
