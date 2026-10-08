/**
 * Deterministic synthetic data generator for the SevaLens demo.
 *
 * Everything here is SYNTHETIC. A fixed RNG seed and a fixed "data as of" date
 * make every run produce identical data, so the demo script numbers are stable.
 *
 * Planted patterns (neutral framing: remote / difficult terrain only):
 *  1. Low coverage in remote districts (Kamjong, Pherzawl, Noney)
 *  2. Pendency spike at field verification in Imphal West / Lamshang (last 90 days)
 *  3. Duplicate-beneficiary cluster in Thoubal / Thoubal block
 *  4. Disbursement failure spike in Churachandpur (last 2 months)
 *  5. ~40 deceased beneficiaries still receiving successful payments
 *  6. One officer with approval rate / speed far outside peers (Bishnupur / Moirang)
 */
import { fakerEN_IN as faker } from '@faker-js/faker';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { sqlite } from './client';
import { DISTRICTS, SCHEMES, LOW_COVERAGE } from './reference';
import { EXPECTED_COUNTS, plantedPatternChecks, tableCounts } from './seedChecks';

const SEED = 20261009;
const AS_OF = process.env.SEED_AS_OF ?? '2026-10-08';
const SALT = process.env.AADHAAR_SALT ?? 'demo-salt-not-for-production';
const t0 = Date.now();

// ---------- deterministic helpers ----------
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
faker.seed(SEED);
const rint = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
const chance = (p: number) => rnd() < p;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
/** Approx. standard normal via Box-Muller. */
const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

const DAY = 86_400_000;
const asOfMs = Date.parse(`${AS_OF}T18:00:00Z`);
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const isoDT = (ms: number) => new Date(ms).toISOString().slice(0, 19);
const monthOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);
const daysAgo = (d: number) => asOfMs - d * DAY;

// 18 full months ending with the month before AS_OF
const MONTHS: string[] = [];
{
  const d = new Date(asOfMs);
  for (let i = 18; i >= 1; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    MONTHS.push(m.toISOString().slice(0, 7));
  }
}
const monthStartMs = (m: string) => Date.parse(`${m}-01T00:00:00Z`);

const hashAadhaar = (a: string) => crypto.createHash('sha256').update(SALT + a).digest('hex');
const newAadhaar = () => String(rint(2, 9)) + Array.from({ length: 11 }, () => rint(0, 9)).join('');

const SYL_A = ['Khul', 'Lam', 'Wai', 'Nung', 'Sang', 'Thang', 'Mol', 'Kei', 'Hao', 'Phai', 'Chin', 'Lei', 'Mak', 'Ten', 'Kho', 'Sai'];
const SYL_B = ['lok', 'pat', 'jang', 'khong', 'phai', 'bung', 'ching', 'mei', 'ram', 'tek', 'lou', 'nam'];

// ---------- reset ----------
const TABLES = ['sessions', 'anomaly_reviews', 'insights_cache', 'audit_log', 'disbursements', 'applications', 'beneficiaries', 'users', 'officers', 'schemes', 'blocks', 'districts', 'meta'];
sqlite.pragma('foreign_keys = OFF');
for (const t of TABLES) sqlite.prepare(`DELETE FROM ${t}`).run();
sqlite.pragma('foreign_keys = ON');

// ---------- reference tables ----------
interface Blk { id: number; districtId: number; dcode: string; name: string; pop: number; remoteness: number; villages: string[] }
const blocksOut: Blk[] = [];
const insMeta = sqlite.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
const insDistrict = sqlite.prepare(`INSERT INTO districts (id, code, name, hq_lat, hq_lng, population, pct_elderly, pct_widows, pct_pwd, pct_rural, remoteness) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
const insBlock = sqlite.prepare(`INSERT INTO blocks (id, district_id, name, lat, lng, pop_share, remoteness) VALUES (?,?,?,?,?,?,?)`);
const insScheme = sqlite.prepare(`INSERT INTO schemes (id, code, name, short_name, category, min_age, max_age, gender, requires_pwd, requires_bpl, eligibility_text, eligible_basis, eligible_factor, benefit_amount, frequency, sla_days, exclusive_group) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const insOfficer = sqlite.prepare(`INSERT INTO officers (id, code, name, designation, block_id, district_id) VALUES (?,?,?,?,?,?)`);
const insUser = sqlite.prepare(`INSERT INTO users (email, name, password_hash, role, district_id) VALUES (?,?,?,?,?)`);

const districtByCode = new Map<string, number>();
const officersByBlock = new Map<number, number[]>();
let OUTLIER_OFFICER = 0;

sqlite.transaction(() => {
  insMeta.run('data_as_of', AS_OF);
  insMeta.run('seed', String(SEED));
  insMeta.run('generated_at', new Date().toISOString());
  insMeta.run('months', JSON.stringify(MONTHS));

  let blockId = 1;
  let officerId = 1;
  DISTRICTS.forEach((d, i) => {
    const did = i + 1;
    districtByCode.set(d.code, did);
    insDistrict.run(did, d.code, d.name, d.lat, d.lng, d.population, d.pctElderly, d.pctWidows, d.pctPwd, d.pctRural, d.remoteness);
    const weights = d.blocks.map((_, j) => (j === 0 ? 1.6 : 0.7 + rnd() * 0.6));
    const wsum = weights.reduce((a, b) => a + b, 0);
    d.blocks.forEach((name, j) => {
      const share = weights[j] / wsum;
      const ang = (j / d.blocks.length) * 2 * Math.PI + rnd();
      const r = j === 0 ? 0.01 : 0.06 + rnd() * 0.07;
      const rem = clamp(d.remoteness + (j === 0 ? -0.05 : 0.03 + gauss() * 0.05), 0, 1);
      insBlock.run(blockId, did, name, +(d.lat + r * Math.sin(ang)).toFixed(4), +(d.lng + r * Math.cos(ang)).toFixed(4), +share.toFixed(4), +rem.toFixed(3));
      const villages = Array.from({ length: rint(8, 14) }, () => pick(SYL_A) + pick(SYL_B));
      blocksOut.push({ id: blockId, districtId: did, dcode: d.code, name, pop: d.population * share, remoteness: rem, villages: [...new Set(villages)] });
      const offs: number[] = [];
      for (let k = 0; k < 2; k++) {
        const code = `OFF-${d.code}-${String(officerId).padStart(3, '0')}`;
        insOfficer.run(officerId, code, faker.person.fullName(), k === 0 ? 'Block Social Welfare Officer' : 'Verification Officer', blockId, did);
        offs.push(officerId++);
      }
      officersByBlock.set(blockId, offs);
      blockId++;
    });
  });

  SCHEMES.forEach((s, i) =>
    insScheme.run(i + 1, s.code, s.name, s.shortName, s.category, s.minAge, s.maxAge, s.gender, s.requiresPwd ? 1 : 0, s.requiresBpl ? 1 : 0, s.eligibilityText, s.eligibleBasis, s.eligibleFactor, s.benefitAmount, s.frequency, s.slaDays, s.exclusiveGroup),
  );

  const hash = bcrypt.hashSync('Demo@2026', 10);
  insUser.run('state@sevalens.demo', 'State Nodal Officer', hash, 'STATE_ADMIN', null);
  insUser.run('dist.ukhrul@sevalens.demo', 'District Social Welfare Officer, Ukhrul', hash, 'DISTRICT_OFFICER', districtByCode.get('UKL'));
})();

const blockByName = (dcode: string, name: string) => blocksOut.find((b) => b.dcode === dcode && b.name === name)!;
const LAMSHANG = blockByName('IW', 'Lamshang');
const THOUBAL = blockByName('TBL', 'Thoubal');
const MOIRANG = blockByName('BPR', 'Moirang');
const CHINGAI = blockByName('UKL', 'Chingai');
const CCP_ID = districtByCode.get('CCP')!;
OUTLIER_OFFICER = officersByBlock.get(MOIRANG.id)![0];

// ---------- beneficiaries ----------
interface Ben {
  id: number; aadhaar: string; hash: string; name: string; gender: string; dob: string;
  districtId: number; blockId: number; village: string; schemeIdx: number;
  status: 'active' | 'suspended' | 'deceased'; enrolledMs: number; deceasedMs: number | null;
  stopMs: number | null; paidAfterDeath?: boolean;
}
const bens: Ben[] = [];
const AGE: Record<string, [number, number]> = { IGNOAPS: [60, 92], IGNWPS: [40, 79], IGNDPS: [18, 79], PMMVY: [19, 36], PMS: [16, 25], SSSP: [60, 90] };

function makePerson(scheme: string, blk: Blk) {
  const s = SCHEMES.find((x) => x.code === scheme)!;
  const gender = s.gender ?? (chance(0.5) ? 'F' : 'M');
  const [a0, a1] = AGE[scheme];
  const age = rint(a0, a1);
  const dob = isoDate(asOfMs - age * 365.25 * DAY - rint(0, 364) * DAY);
  const name = faker.person.fullName({ sex: gender === 'F' ? 'female' : 'male' }).replace(/^(Mr|Mrs|Ms|Miss|Dr)\.? /, '');
  const aadhaar = newAadhaar();
  return { gender, dob, name, aadhaar, hash: hashAadhaar(aadhaar), village: pick(blk.villages) };
}

const blockCoverage = new Map<number, number>();
for (const blk of blocksOut) {
  const d = DISTRICTS[blk.districtId - 1];
  const base = LOW_COVERAGE[d.code] ?? 0.82 - 0.2 * d.remoteness + gauss() * 0.03;
  blockCoverage.set(blk.id, clamp(base + gauss() * 0.04, 0.12, 0.97));
}

SCHEMES.forEach((s, si) => {
  for (const blk of blocksOut) {
    const d = DISTRICTS[blk.districtId - 1];
    const basis = s.eligibleBasis === 'population' ? 1 : s.eligibleBasis === 'pct_elderly' ? d.pctElderly : s.eligibleBasis === 'pct_widows' ? d.pctWidows : d.pctPwd;
    const eligible = blk.pop * basis * s.eligibleFactor;
    const cov = clamp(blockCoverage.get(blk.id)! + gauss() * 0.03, 0.08, 0.98);
    const active = Math.round(eligible * cov);
    const suspended = Math.round(active * 0.03);
    const deceased = s.category === 'pension' ? Math.round(active * 0.035) : 0;
    const total = active + suspended + deceased;
    for (let k = 0; k < total; k++) {
      const p = makePerson(s.code, blk);
      const status = k < active ? 'active' : k < active + suspended ? 'suspended' : 'deceased';
      const enrollWindow = s.category === 'pension' ? 6 * 365 : s.code === 'PMMVY' ? 540 : 730;
      const enrolledMs = daysAgo(rint(20, enrollWindow));
      let deceasedMs: number | null = null;
      let stopMs: number | null = null;
      if (status === 'deceased') {
        deceasedMs = Math.max(enrolledMs + 30 * DAY, daysAgo(rint(15, 540)));
        stopMs = deceasedMs;
      } else if (status === 'suspended') {
        stopMs = Math.max(enrolledMs + 30 * DAY, daysAgo(rint(15, 400)));
      }
      bens.push({ id: bens.length + 1, ...p, districtId: blk.districtId, blockId: blk.id, schemeIdx: si, status, enrolledMs, deceasedMs, stopMs });
    }
  }
});

// Pattern 3: duplicate cluster in Thoubal / Thoubal block
const schemeIdx = (code: string) => SCHEMES.findIndex((s) => s.code === code);
const typo = (name: string) => {
  const parts = name.split(' ');
  const i = rint(0, parts.length - 1);
  const w = parts[i];
  const op = rint(0, 3);
  let out = w;
  if (w.length > 3) {
    const j = rint(1, w.length - 2);
    if (op === 0) out = w.slice(0, j) + w[j] + w.slice(j); // double a letter
    else if (op === 1) out = w.slice(0, j) + w.slice(j + 1); // drop a letter
    else if (op === 2) out = w.slice(0, j) + w[j + 1] + w[j] + w.slice(j + 2); // swap
    else out = w.slice(0, j) + (w[j] === 'a' ? 'e' : 'a') + w.slice(j + 1); // vowel swap
  }
  parts[i] = out;
  return parts.join(' ');
};
const dupSource = bens.filter((b) => b.blockId === THOUBAL.id && b.status === 'active' && (b.schemeIdx === schemeIdx('IGNOAPS') || b.schemeIdx === schemeIdx('IGNWPS')));
let plantedExact = 0;
let plantedFuzzy = 0;
const makeClone = (src: Ben, fuzzy: boolean, blockIdOverride?: number): Ben => {
  const targetScheme = src.schemeIdx === schemeIdx('IGNOAPS') ? schemeIdx('SSSP') : schemeIdx('IGNOAPS');
  const aadhaar = fuzzy ? newAadhaar() : src.aadhaar;
  return {
    ...src,
    id: bens.length + 1,
    aadhaar,
    hash: hashAadhaar(aadhaar),
    name: fuzzy ? typo(src.name) : src.name,
    blockId: blockIdOverride ?? src.blockId,
    schemeIdx: targetScheme,
    enrolledMs: daysAgo(rint(60, 500)),
  };
};
for (let i = 0; i < 30 && i < dupSource.length; i++) { bens.push(makeClone(dupSource[i], false)); plantedExact++; }
for (let i = 30; i < 50 && i < dupSource.length; i++) { bens.push(makeClone(dupSource[i], true)); plantedFuzzy++; }
// small background rate elsewhere (realism): 3 exact-hash pairs in other districts
for (const code of ['IE', 'SPT', 'KCG']) {
  const src = bens.find((b) => b.districtId === districtByCode.get(code) && b.status === 'active' && b.schemeIdx === schemeIdx('IGNOAPS'))!;
  bens.push(makeClone(src, false));
}

// Pattern 5: deceased but still paid (~40), deaths 3–9 months ago
const deceasedPension = bens.filter((b) => b.status === 'deceased' && b.deceasedMs! < daysAgo(100) && b.deceasedMs! > daysAgo(270));
const stillPaid = new Set<number>();
while (stillPaid.size < 40 && stillPaid.size < deceasedPension.length) stillPaid.add(pick(deceasedPension).id);
for (const b of bens) if (stillPaid.has(b.id)) { b.paidAfterDeath = true; b.stopMs = null; }

const insBen = sqlite.prepare(`INSERT INTO beneficiaries (id, aadhaar_last4, aadhaar_hash, name, gender, dob, district_id, block_id, village, scheme_id, status, enrolled_at, deceased_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
sqlite.transaction(() => {
  for (const b of bens) insBen.run(b.id, b.aadhaar.slice(-4), b.hash, b.name, b.gender, b.dob, b.districtId, b.blockId, b.village, b.schemeIdx + 1, b.status, isoDate(b.enrolledMs), b.deceasedMs ? isoDate(b.deceasedMs) : null);
})();

// ---------- applications ----------
const insApp = sqlite.prepare(`INSERT INTO applications (id, ref_no, applicant_name, scheme_id, district_id, block_id, submitted_at, status, decided_at, officer_id, pending_stage) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
const WINDOW_DAYS = 548;
const totalPop = blocksOut.reduce((a, b) => a + b.pop, 0);
const schemeWeights = SCHEMES.map((s) => (s.eligibleBasis === 'population' ? 1 : 0.075) * s.eligibleFactor);
const swSum = schemeWeights.reduce((a, b) => a + b, 0);
const pickScheme = () => {
  let r = rnd() * swSum;
  for (let i = 0; i < schemeWeights.length; i++) if ((r -= schemeWeights[i]) <= 0) return i;
  return 0;
};
let appId = 1;
let lamshangStuck = 0;
let outlierDecisions = 0;
sqlite.transaction(() => {
  const addApp = (blk: Blk, submittedMs: number, forceStuck = false, schemeOverride?: number, stuckStage = 'field_verification') => {
    const si = schemeOverride ?? pickScheme();
    const s = SCHEMES[si];
    const offs = officersByBlock.get(blk.id)!;
    const isOutlierBlock = blk.id === MOIRANG.id;
    const officer = isOutlierBlock && chance(0.65) ? offs[0] : offs[isOutlierBlock ? 1 : rint(0, 1)];
    const outlier = officer === OUTLIER_OFFICER;
    const ageDays = (asOfMs - submittedMs) / DAY;
    let decisionDays = Math.exp(Math.log(10 + blk.remoteness * 8) + gauss() * 0.45);
    if (outlier) decisionDays = 0.05 + rnd() * 0.7;
    // a small natural backlog everywhere
    if (!outlier && chance(0.025)) decisionDays = 35 + rnd() * 170;
    const stuck = forceStuck || (blk.id === LAMSHANG.id && ageDays <= 90 && chance(0.85));
    let status: string;
    let decidedAt: string | null = null;
    let stage: string | null = null;
    if (!stuck && decisionDays < ageDays) {
      const approveP = outlier ? 0.99 : 0.74;
      status = chance(approveP) ? 'approved' : 'rejected';
      decidedAt = isoDT(submittedMs + decisionDays * DAY);
      if (outlier) outlierDecisions++;
    } else if (stuck) {
      status = stuckStage === 'sanction' ? 'verified' : 'pending';
      stage = stuckStage;
      if (blk.id === LAMSHANG.id) lamshangStuck++;
    } else {
      const frac = ageDays / Math.max(decisionDays, 1);
      if (ageDays < 5 || frac < 0.25) { status = 'submitted'; stage = 'document_check'; }
      else if (frac < 0.6) { status = 'pending'; stage = 'field_verification'; }
      else if (frac < 0.85) { status = 'verified'; stage = 'sanction'; }
      else { status = 'verified'; stage = 'payment_setup'; }
    }
    const year = new Date(submittedMs).getUTCFullYear();
    const name = faker.person.fullName().replace(/^(Mr|Mrs|Ms|Miss|Dr)\.? /, '');
    insApp.run(appId, `SW/${blk.dcode}/${year}/${String(appId).padStart(6, '0')}`, name, si + 1, blk.districtId, blk.id, isoDT(submittedMs), status, decidedAt, decidedAt ? officer : null, stage);
    appId++;
    void s;
  };
  const TARGET = 14200;
  for (const blk of blocksOut) {
    const n = Math.round((TARGET * blk.pop) / totalPop * (1 - 0.3 * blk.remoteness) * 1.12);
    for (let k = 0; k < n; k++) addApp(blk, asOfMs - rnd() * WINDOW_DAYS * DAY - rint(0, 36000) * 1000);
  }
  // Pattern 2: surge of applications in Lamshang over the last 90 days, stuck at field verification
  for (let k = 0; k < 330; k++) addApp(LAMSHANG, asOfMs - rnd() * 90 * DAY, true);
  // Minor pattern for the district-officer demo: widow-pension cases waiting at sanction in Ukhrul / Chingai
  for (let k = 0; k < 26; k++) addApp(CHINGAI, asOfMs - (10 + rnd() * 70) * DAY, true, schemeIdx('IGNWPS'), 'sanction');
  // Pattern 6 support: make sure the outlier officer has plenty of decisions
  for (let k = 0; k < 140; k++) addApp(MOIRANG, asOfMs - (30 + rnd() * (WINDOW_DAYS - 30)) * DAY);
})();

// ---------- disbursements ----------
const insDis = sqlite.prepare(`INSERT INTO disbursements (beneficiary_id, scheme_id, district_id, block_id, month, amount, status, paid_at) VALUES (?,?,?,?,?,?,?,?)`);
let disCount = 0;
const LAST2 = new Set(MONTHS.slice(-2));
sqlite.transaction(() => {
  for (const b of bens) {
    const s = SCHEMES[b.schemeIdx];
    const blk = blocksOut[b.blockId - 1];
    const pay = (m: string, amount: number) => {
      let failP = 0.012 + blk.remoteness * 0.01;
      let retP = 0.008;
      if (b.districtId === CCP_ID && LAST2.has(m)) { failP = 0.2; retP = 0.04; }
      const r = rnd();
      const status = r < failP ? 'failed' : r < failP + retP ? 'returned' : 'success';
      const paidMs = monthStartMs(m) + rint(4, 11) * DAY + rint(0, 30000) * 1000;
      insDis.run(b.id, b.schemeIdx + 1, b.districtId, b.blockId, m, amount, status, isoDT(paidMs));
      disCount++;
    };
    if (s.frequency === 'monthly') {
      for (const m of MONTHS) {
        const ms = monthStartMs(m);
        if (ms <= b.enrolledMs) continue;
        // normal stop: no payment in or after the month of death / suspension
        if (b.stopMs !== null && ms + 15 * DAY >= monthStartMs(monthOf(b.stopMs))) break;
        pay(m, s.benefitAmount);
      }
    } else if (s.frequency === 'instalment') {
      for (const off of [35, 125]) {
        const ms = b.enrolledMs + off * DAY;
        if (ms < asOfMs && MONTHS.includes(monthOf(ms))) pay(monthOf(ms), s.benefitAmount);
      }
    } else {
      for (let y = 0; y < 3; y++) {
        const ms = b.enrolledMs + (30 + y * 365) * DAY;
        if (ms < asOfMs && MONTHS.includes(monthOf(ms))) pay(monthOf(ms), s.benefitAmount);
      }
    }
  }
})();

// ---------- verification summary ----------
console.log(`\n=== SevaLens seed summary (as of ${AS_OF}, seed ${SEED}) — SYNTHETIC DATA ===`);
const counts = tableCounts(sqlite);
console.log(Object.entries(counts).map(([t, n]) => `${t}=${n}`).join(' '));
const countDrift = (Object.keys(EXPECTED_COUNTS) as (keyof typeof EXPECTED_COUNTS)[]).filter((t) => counts[t] !== EXPECTED_COUNTS[t]);
if (countDrift.length) console.warn(`!! counts differ from EXPECTED_COUNTS in seedChecks.ts (${countDrift.join(', ')}) — update it if the generator changed on purpose`);
console.log(`generator: ${plantedExact} exact-hash + ${plantedFuzzy} fuzzy duplicate pairs in Thoubal; ${lamshangStuck} Lamshang apps stuck at field verification; outlier officer #${OUTLIER_OFFICER}`);
for (const c of plantedPatternChecks(sqlite)) console.log(`\n[${c.id}] ${c.ok ? 'OK ' : 'FAIL'} ${c.label}: ${c.detail}`);
void outlierDecisions;

console.log(`\nSeed completed in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
