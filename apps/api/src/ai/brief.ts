import { z } from 'zod';
import type { Brief } from '@sevalens/shared';
import { sqlite } from '../db/client';
import { summarizePendency } from '../analytics';
import type { Snapshot } from '../services/snapshot';
import { aiModel, callJson, LlmUnavailable } from './llm';
import { toLLMPayload } from './sanitize';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const int = (n: number) => Math.round(n).toLocaleString('en-IN');

/** Aggregated, de-identified facts about a district — the ONLY input to the brief. */
export function briefFacts(s: Snapshot, districtId: number) {
  const d = s.districtSummaries.find((x) => x.id === districtId);
  if (!d) throw new Error('district not found');
  const blocks = s.blockSummaries.filter((b) => b.districtId === districtId).sort((a, b) => b.attention.score - a.attention.score);
  const pend = summarizePendency(s.apps.filter((a) => a.districtId === districtId), s.asOf);
  const anomalies = s.anomalies.filter((a) => a.districtId === districtId && a.review.status !== 'false_positive');
  return {
    dataAsOf: s.asOf,
    district: d.name,
    population: d.population,
    remoteness: d.remoteness,
    coverage: d.coverage.coverage,
    eligible: d.coverage.eligible,
    enrolled: d.coverage.enrolled,
    gap: d.coverage.gap,
    schemes: d.coverage.bySchemes.map((c) => ({ scheme: c.schemeName, coverage: c.coverage, gap: c.gap })),
    open: pend.open,
    breached: pend.breached,
    breachPct: pend.breachPct,
    medianAgeDays: pend.medianAgeDays,
    stages: pend.stages.map((x) => ({ stage: x.label, count: x.count, breached: x.breached })),
    trend: pend.trend,
    failureRate: d.failureRate,
    attention: { score: d.attention.score, level: d.attention.level, factors: d.attention.factors.map((f) => ({ factor: f.label, points: f.points, rawLabel: f.rawLabel })) },
    blocks: blocks.map((b) => ({
      block: b.name, score: b.attention.score, level: b.attention.level, topReason: b.attention.topReason,
      coverage: b.coverage.coverage, gap: b.coverage.gap, open: b.openApplications, breached: b.breached, failureRate: b.failureRate, anomalyCount: b.anomalyCount,
    })),
    anomalies: anomalies.slice(0, 12).map((a) => ({ type: a.typeLabel, severity: a.severity, entity: a.entityLabel, metric: a.metric, expected: a.expected, observed: a.observed, reviewStatus: a.review.status })),
  };
}
export type BriefFacts = ReturnType<typeof briefFacts>;

const factorsUsed = (f: BriefFacts) => [
  `Coverage ${pct(f.coverage)} (${int(f.enrolled)} of ${int(f.eligible)} est. eligible)`,
  `${f.open} open applications, ${f.breached} past SLA`,
  `Payment failure rate ${pct(f.failureRate)} (last 3 months)`,
  `${f.anomalies.length} active anomalies`,
  `Attention score ${f.attention.score}/100 with factor breakdown`,
  `${f.blocks.length} block-level scorecards`,
];

/** Deterministic brief built from the same facts (used when the LLM is unavailable). */
export function templateBrief(f: BriefFacts): Omit<Brief, 'districtId' | 'source' | 'model' | 'generatedAt' | 'fallbackReason'> {
  const issues: { title: string; detail: string; weight: number }[] = [];
  if (f.coverage < 0.8) issues.push({ weight: (1 - f.coverage) * 100, title: `Coverage gap: ${int(f.gap)} eligible people not enrolled`, detail: `Only ${pct(f.coverage)} of the estimated eligible population is enrolled. Lowest: ${[...f.schemes].sort((a, b) => a.coverage - b.coverage).slice(0, 2).map((s) => `${s.scheme} (${pct(s.coverage)})`).join(', ')}.` });
  if (f.breached >= 10 || f.breachPct > 0.3) {
    const stage = [...f.stages].sort((a, b) => b.breached - a.breached)[0];
    issues.push({ weight: f.breachPct * 100 + f.breached / 5, title: `${f.breached} applications past SLA`, detail: `${pct(f.breachPct)} of ${f.open} open applications are overdue; the main bottleneck is ${stage.stage.toLowerCase()} (${stage.breached} overdue). Open caseload was ${f.trend.open90DaysAgo} ninety days ago.` });
  }
  if (f.failureRate > 0.05) issues.push({ weight: f.failureRate * 400, title: `Payment failures at ${pct(f.failureRate)}`, detail: `Failed or returned disbursements over the last 3 months are well above the ~2% norm, delaying benefits to enrolled beneficiaries.` });
  for (const a of f.anomalies.filter((x) => x.severity === 'high').slice(0, 3)) issues.push({ weight: 40, title: `${a.type} — ${a.entity}`, detail: `${a.metric}: observed ${a.observed} vs expected ${a.expected}.` });
  if (issues.length === 0) issues.push({ weight: 1, title: 'No major issues detected', detail: 'Coverage, pendency and payments are within normal ranges. Continue routine monitoring.' });
  const top = issues.sort((a, b) => b.weight - a.weight).slice(0, 3).map(({ title, detail }) => ({ title, detail }));

  const actions: string[] = [];
  if (f.coverage < 0.6) actions.push(`Launch a targeted enrolment camp in the lowest-coverage blocks (${f.blocks.filter((b) => b.coverage < 0.6).slice(0, 3).map((b) => b.block).join(', ') || 'see block table'}), using Anganwadi/ASHA networks and mobile outreach for remote villages.`);
  else if (f.coverage < 0.8) actions.push('Run door-to-door verification drives with Anganwadi/ASHA workers to identify eligible non-enrolled households.');
  if (f.breached >= 10) actions.push('Assign additional verification staff or a time-bound special drive to clear overdue field verifications; review the oldest cases first.');
  if (f.failureRate > 0.05) actions.push('Reconcile failed/returned payments with the bank/PFMS: check account-Aadhaar seeding and re-push failed batches.');
  if (f.anomalies.some((a) => a.type.includes('duplicate'))) actions.push('Freeze payments to suspected duplicate records pending verification and de-duplicate across pension schemes.');
  if (f.anomalies.some((a) => a.type.includes('death'))) actions.push('Stop payments to beneficiaries recorded as deceased and initiate recovery; link the death registry to the pension MIS.');
  if (f.anomalies.some((a) => a.type.includes('Officer'))) actions.push('Conduct a sample audit of approvals by the flagged officer (statistical flag only — not a finding).');
  if (actions.length < 3) actions.push('Review this brief at the next district review meeting and track the attention score weekly.');

  const first = f.blocks[0];
  return {
    districtName: f.district,
    title: `Officer brief — ${f.district} district`,
    situation: `${f.district} has an Attention Score of ${f.attention.score}/100 (${f.attention.level}). Coverage is ${pct(f.coverage)} with ${int(f.gap)} estimated eligible people not yet enrolled; ${f.open} applications are open (${f.breached} past SLA) and the payment failure rate is ${pct(f.failureRate)}.`,
    topIssues: top,
    actions: actions.slice(0, 5),
    visitFirst: { blockName: first?.block ?? f.district, reason: first ? `Highest block Attention Score (${first.score}) — ${first.topReason}.` : 'District HQ.' },
    factorsUsed: factorsUsed(f),
    dataAsOf: f.dataAsOf,
  };
}

const briefOutSchema = z.object({
  situation: z.string().min(10).max(900),
  topIssues: z.array(z.object({ title: z.string().max(160), detail: z.string().max(600) })).min(1).max(3),
  actions: z.array(z.string().max(400)).min(1).max(5),
  visitFirst: z.object({ blockName: z.string().max(80), reason: z.string().max(400) }),
});
const briefJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['situation', 'topIssues', 'actions', 'visitFirst'],
  properties: {
    situation: { type: 'string', description: '2–3 sentence situation summary with the key numbers.' },
    topIssues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'detail'], properties: { title: { type: 'string' }, detail: { type: 'string' } } } },
    actions: { type: 'array', items: { type: 'string' } },
    visitFirst: { type: 'object', additionalProperties: false, required: ['blockName', 'reason'], properties: { blockName: { type: 'string' }, reason: { type: 'string' } } },
  },
};

const SYSTEM = `You are an analyst supporting the Social Welfare Department, Government of Manipur. You write a one-page action note for a district officer from aggregated, de-identified statistics.
Rules:
- Use only the numbers provided; do not invent figures. Quote key numbers.
- Exactly 3 top issues (fewer only if the data shows fewer), most urgent first.
- 3–5 concrete, practical recommended actions an Indian district administration can take (e.g. enrolment camps via Anganwadi/ASHA networks, special verification drives, PFMS/bank reconciliation, death-registry linkage, sample audits).
- visitFirst.blockName must be one of the block names provided.
- Neutral, factual language. Describe areas only by geography or terrain/remoteness. Never speculate about communities, ethnicity, religion or politics.
- Statistical flags (e.g. officer outliers) are prompts for review, not findings of wrongdoing; say so.`;

export async function generateBrief(s: Snapshot, districtId: number, refresh: boolean): Promise<Brief> {
  const key = `brief:${districtId}:${s.asOf}`;
  if (!refresh) {
    const cached = sqlite.prepare('SELECT content FROM insights_cache WHERE key = ?').get(key) as { content: string } | undefined;
    if (cached) return JSON.parse(cached.content) as Brief;
  }
  const facts = briefFacts(s, districtId);
  const base = templateBrief(facts);
  let brief: Brief;
  try {
    const payload = toLLMPayload(facts);
    const out = await callJson({ system: SYSTEM, user: `District statistics (JSON):\n${JSON.stringify(payload)}`, jsonSchema: briefJsonSchema, schema: briefOutSchema });
    const validBlock = facts.blocks.some((b) => b.block === out.visitFirst.blockName);
    brief = { ...base, ...out, visitFirst: validBlock ? out.visitFirst : base.visitFirst, districtId, source: 'llm', model: aiModel(), generatedAt: new Date().toISOString() };
  } catch (e) {
    brief = { ...base, districtId, source: 'template', model: null, generatedAt: new Date().toISOString(), fallbackReason: e instanceof LlmUnavailable ? e.message : 'AI unavailable' };
  }
  sqlite.prepare('INSERT INTO insights_cache (key, kind, district_id, content, source, model, created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET content = excluded.content, source = excluded.source, model = excluded.model, created_at = excluded.created_at')
    .run(key, 'brief', districtId, JSON.stringify(brief), brief.source, brief.model, brief.generatedAt);
  return brief;
}

export function cachedBrief(s: Snapshot, districtId: number): Brief | null {
  const row = sqlite.prepare('SELECT content FROM insights_cache WHERE key = ?').get(`brief:${districtId}:${s.asOf}`) as { content: string } | undefined;
  return row ? (JSON.parse(row.content) as Brief) : null;
}
