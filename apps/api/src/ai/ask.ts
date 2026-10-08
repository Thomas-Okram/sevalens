/**
 * "Ask SevaLens": natural language -> one of a FIXED set of whitelisted query intents.
 * The LLM never writes SQL. It only picks an intent + params (validated by zod); the
 * API runs the safe, RBAC-scoped query; the LLM then summarises the aggregate rows.
 * Without an API key a keyword matcher and a template summary are used instead.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { askIntentSchema, type AskIntent, type AskIntentParams, type AskResult } from '@sevalens/shared';
import { STAGE_LABELS } from '../analytics';
import { ageInDays, asOfMs } from '../analytics/pendency';
import { levenshtein } from '../analytics/similarity';
import { sqlite } from '../db/client';
import type { Snapshot } from '../services/snapshot';
import { aiModel, callJson, LlmUnavailable } from './llm';
import { toLLMPayload } from './sanitize';

export const INTENT_LABELS: Record<AskIntent, string> = {
  pending_by_block: 'Pending applications by block',
  coverage_gap: 'Coverage gap ranking',
  attention_ranking: 'Attention Score ranking',
  anomalies_list: 'Active anomalies',
  disbursement_failures: 'Payment failure rates by block',
  sla_breach_by_scheme: 'SLA breach by scheme',
};

type Row = Record<string, string | number | null>;
const pct = (x: number) => +(x * 100).toFixed(1);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

// ---------- entity resolution ----------
const SCHEME_ALIASES: [RegExp, string][] = [
  [/widow/i, 'IGNWPS'],
  [/disab|divyang|pwd|handicap/i, 'IGNDPS'],
  [/matern|pregnan|pmmvy|mother/i, 'PMMVY'],
  [/scholar|student|post.?matric/i, 'PMS'],
  [/state (social security )?pension|sssp/i, 'SSSP'],
  [/old.?age|elderly|ignoaps|senior/i, 'IGNOAPS'],
];

export function resolveScheme(s: Snapshot, text: string | null | undefined) {
  if (!text) return null;
  const byCode = s.schemes.find((x) => norm(x.code) === norm(text) || norm(x.shortName) === norm(text) || norm(x.name) === norm(text));
  if (byCode) return byCode;
  for (const [re, code] of SCHEME_ALIASES) if (re.test(text)) return s.schemes.find((x) => x.code === code) ?? null;
  return null;
}

export function resolveDistrict(s: Snapshot, text: string | null | undefined) {
  if (!text) return null;
  const t = norm(text);
  return (
    s.districts.find((d) => norm(d.name) === t || norm(d.code) === t) ??
    s.districts.find((d) => t.includes(norm(d.name))) ??
    // misspellings such as "Ukrul" or "Churachandpu"
    s.districts.find((d) => t.length >= 4 && levenshtein(t, norm(d.name)) <= (t.length >= 8 ? 2 : 1)) ??
    null
  );
}

// ---------- typo tolerance for the keyword fallback ----------
const VOCAB = [
  'pending', 'pendency', 'pension', 'widow', 'block', 'blocks', 'district', 'districts', 'scheme', 'schemes',
  'duplicate', 'duplicates', 'coverage', 'payment', 'payments', 'failure', 'failures', 'failed', 'anomaly', 'anomalies',
  'deceased', 'overdue', 'backlog', 'enrolment', 'enrollment', 'disability', 'maternity', 'scholarship', 'elderly',
  'suspicious', 'unusual', 'breach', 'breaches', 'officer', 'lowest', 'highest', 'attention',
];

/** Snap misspelt words ("pendng", "duplicat", "ukrul") to the nearest known term, if the match is unambiguous. */
export function correctTypos(s: Snapshot, text: string): string {
  const vocab = [...VOCAB, ...s.districts.flatMap((d) => d.name.toLowerCase().split(/\s+/))];
  return text.replace(/[a-z]{4,}/g, (w) => {
    if (vocab.includes(w)) return w;
    const max = w.length >= 8 ? 2 : 1;
    let best: string | null = null;
    let bestD = Infinity;
    let tie = false;
    for (const v of vocab) {
      const d = levenshtein(w, v);
      if (d < bestD) { best = v; bestD = d; tie = false; } else if (d === bestD && v !== best) tie = true;
    }
    return best && bestD <= max && !tie ? best : w;
  });
}

// ---------- keyword fallback ----------
export function keywordIntent(s: Snapshot, q: string): AskIntentParams {
  const text = correctTypos(s, q.toLowerCase());
  const district = s.districts.find((d) => text.includes(d.name.toLowerCase()))?.name ?? null;
  const schemeHit = SCHEME_ALIASES.find(([re]) => re.test(text));
  const scheme = schemeHit ? schemeHit[1] : null;
  const level = /\bblocks?\b/.test(text) ? 'block' : /\bdistricts?\b/.test(text) ? 'district' : undefined;
  const n = Number(/\b(?:top|first)\s+(\d{1,2})\b/.exec(text)?.[1]);
  const limit = Number.isFinite(n) && n > 0 ? Math.min(n, 20) : undefined;
  if (/duplicate|anomal|fraud|suspicious|deceased|dead|death|outlier|unusual|spike/.test(text)) {
    const type = /duplicate/.test(text) ? 'duplicate_beneficiary' : /deceased|dead|death/.test(text) ? 'deceased_paid' : /officer/.test(text) ? 'officer_outlier' : null;
    return { intent: 'anomalies_list', district, type, limit };
  }
  if (/fail|bounce|return|disburs|payment|paisa|paise|money|bhugtan/.test(text)) return { intent: 'disbursement_failures', district, limit };
  if (/sla|breach|overdue|delay/.test(text) && /scheme/.test(text)) return { intent: 'sla_breach_by_scheme', district };
  if (/pending|pendency|stuck|backlog|open application|waiting|overdue|sla|delay|atka|ruka/.test(text)) return { intent: 'pending_by_block', district, scheme, limit };
  if (/coverage|gap|not reached|unreached|excluded|enrol|left out|missing/.test(text)) return { intent: 'coverage_gap', district, scheme, level: level ?? (district ? 'block' : 'district'), limit };
  return { intent: 'attention_ranking', district, level: level ?? (district ? 'block' : 'district'), limit };
}

// ---------- safe query execution ----------
export interface Executed {
  filters: Record<string, string | number | null>;
  columns: { key: string; label: string }[];
  rows: Row[];
  note?: string;
}

export function executeIntent(s: Snapshot, p: AskIntentParams, scopeDistrictId: number | null): Executed {
  let district = 'district' in p ? resolveDistrict(s, p.district) : null;
  let note: string | undefined;
  if (scopeDistrictId !== null) {
    if (district && district.id !== scopeDistrictId) note = `Your access is limited to ${s.districts.find((d) => d.id === scopeDistrictId)!.name}; showing that district instead of ${district.name}.`;
    district = s.districts.find((d) => d.id === scopeDistrictId)!;
  }
  const limit = ('limit' in p && p.limit) || 10;
  const scheme = 'scheme' in p ? resolveScheme(s, p.scheme) : null;
  const filters: Record<string, string | number | null> = { district: district?.name ?? 'All districts', limit };
  if ('scheme' in p) filters.scheme = scheme?.shortName ?? 'All schemes';
  const inDistrict = (id: number) => !district || id === district.id;
  const blockName = new Map(s.blocks.map((b) => [b.id, b.name]));
  const districtName = new Map(s.districts.map((d) => [d.id, d.name]));
  const nowMs = asOfMs(s.asOf);

  switch (p.intent) {
    case 'pending_by_block': {
      const agg = new Map<number, { open: number; breached: number; stages: Map<string, number> }>();
      for (const a of s.apps) {
        if (a.decidedAt !== null || !inDistrict(a.districtId) || (scheme && a.schemeId !== scheme.id)) continue;
        const cur = agg.get(a.blockId) ?? { open: 0, breached: 0, stages: new Map() };
        cur.open++;
        if (ageInDays(a.submittedAt, nowMs) > a.slaDays) cur.breached++;
        const st = a.pendingStage ?? 'document_check';
        cur.stages.set(st, (cur.stages.get(st) ?? 0) + 1);
        agg.set(a.blockId, cur);
      }
      const rows = [...agg.entries()]
        .map(([bid, v]) => {
          const blk = s.blocks.find((b) => b.id === bid)!;
          const top = [...v.stages.entries()].sort((x, y) => y[1] - x[1])[0][0];
          return { block: blockName.get(bid)!, district: districtName.get(blk.districtId)!, open: v.open, breached: v.breached, topStage: STAGE_LABELS[top] ?? top };
        })
        .sort((a, b) => b.open - a.open)
        .slice(0, limit);
      return { filters, note, rows, columns: [{ key: 'block', label: 'Block' }, { key: 'district', label: 'District' }, { key: 'open', label: 'Open' }, { key: 'breached', label: 'Past SLA' }, { key: 'topStage', label: 'Main stage' }] };
    }
    case 'coverage_gap': {
      const level = p.level ?? (district ? 'block' : 'district');
      filters.level = level;
      const pickCov = (c: { coverage: number; eligible: number; enrolled: number; gap: number; bySchemes: { schemeId: number; coverage: number; eligible: number; enrolled: number; gap: number }[] }) =>
        scheme ? c.bySchemes.find((x) => x.schemeId === scheme.id)! : c;
      const src = level === 'district'
        ? s.districtSummaries.filter((d) => inDistrict(d.id)).map((d) => ({ area: d.name, district: d.name, c: pickCov(d.coverage) }))
        : s.blockSummaries.filter((b) => inDistrict(b.districtId)).map((b) => ({ area: b.name, district: districtName.get(b.districtId)!, c: pickCov(b.coverage) }));
      const rows = src
        .map((x) => ({ area: x.area, district: x.district, eligible: Math.round(x.c.eligible), enrolled: x.c.enrolled, coverage: pct(x.c.coverage), gap: x.c.gap }))
        .sort((a, b) => a.coverage - b.coverage)
        .slice(0, limit);
      return { filters, note, rows, columns: [{ key: 'area', label: level === 'district' ? 'District' : 'Block' }, ...(level === 'block' ? [{ key: 'district', label: 'District' }] : []), { key: 'eligible', label: 'Est. eligible' }, { key: 'enrolled', label: 'Enrolled' }, { key: 'coverage', label: 'Coverage %' }, { key: 'gap', label: 'Gap' }] };
    }
    case 'attention_ranking': {
      const level = p.level ?? (district ? 'block' : 'district');
      filters.level = level;
      const list = level === 'district' ? s.districtSummaries.filter((d) => inDistrict(d.id)).map((d) => d.attention) : s.blockSummaries.filter((b) => inDistrict(b.districtId)).map((b) => b.attention);
      const rows = list.sort((a, b) => b.score - a.score).slice(0, limit).map((a) => ({ area: a.name, district: a.districtName, score: a.score, level: a.level, topReason: a.topReason }));
      return { filters, note, rows, columns: [{ key: 'area', label: 'Area' }, { key: 'district', label: 'District' }, { key: 'score', label: 'Score' }, { key: 'level', label: 'Level' }, { key: 'topReason', label: 'Main driver' }] };
    }
    case 'anomalies_list': {
      const type = p.type && /^[a-z_]+$/.test(p.type) ? p.type : null;
      filters.type = type ?? 'All types';
      const rows = s.anomalies
        .filter((a) => inDistrict(a.districtId) && a.review.status !== 'false_positive' && (!type || a.type === type))
        .slice(0, limit)
        .map((a) => ({ type: a.typeLabel, severity: a.severity, entity: a.entityLabel, observed: a.observed, expected: a.expected }));
      return { filters, note, rows, columns: [{ key: 'severity', label: 'Severity' }, { key: 'type', label: 'Type' }, { key: 'entity', label: 'Where' }, { key: 'observed', label: 'Observed' }, { key: 'expected', label: 'Expected' }] };
    }
    case 'disbursement_failures': {
      const rows = s.blockSummaries
        .filter((b) => inDistrict(b.districtId))
        .map((b) => ({ block: b.name, district: districtName.get(b.districtId)!, failureRate: pct(b.failureRate) }))
        .sort((a, b) => b.failureRate - a.failureRate)
        .slice(0, limit);
      return { filters, note, rows, columns: [{ key: 'block', label: 'Block' }, { key: 'district', label: 'District' }, { key: 'failureRate', label: 'Failure rate % (3 mo)' }] };
    }
    case 'sla_breach_by_scheme': {
      const rows = s.schemes.map((sc) => {
        const open = s.apps.filter((a) => a.decidedAt === null && a.schemeId === sc.id && inDistrict(a.districtId));
        const breached = open.filter((a) => ageInDays(a.submittedAt, nowMs) > a.slaDays).length;
        return { scheme: sc.shortName, slaDays: sc.slaDays, open: open.length, breached, breachPct: open.length ? pct(breached / open.length) : 0 };
      }).sort((a, b) => b.breached - a.breached);
      return { filters, note, rows, columns: [{ key: 'scheme', label: 'Scheme' }, { key: 'slaDays', label: 'SLA (days)' }, { key: 'open', label: 'Open' }, { key: 'breached', label: 'Past SLA' }, { key: 'breachPct', label: 'Breach %' }] };
    }
  }
}

// ---------- summaries ----------
export function templateAnswer(p: AskIntentParams, ex: Executed): string {
  const r = ex.rows;
  const where = ex.filters.district === 'All districts' ? 'across Manipur' : `in ${ex.filters.district}`;
  const prefix = ex.note ? `${ex.note} ` : '';
  if (r.length === 0) return `${prefix}No matching records ${where} for this question.`;
  const top = r[0];
  switch (p.intent) {
    case 'pending_by_block':
      return `${prefix}${top.block} (${top.district}) has the most pending ${ex.filters.scheme !== 'All schemes' ? `${ex.filters.scheme} ` : ''}applications ${where}: ${top.open} open, ${top.breached} past SLA, mostly at ${String(top.topStage).toLowerCase()}.${r[1] ? ` Next: ${r[1].block} (${r[1].open} open).` : ''}`;
    case 'coverage_gap':
      return `${prefix}Lowest ${ex.filters.scheme !== 'All schemes' ? `${ex.filters.scheme} ` : ''}coverage ${where} is in ${top.area} at ${top.coverage}% — about ${top.gap} estimated eligible people not enrolled.${r[1] ? ` Followed by ${r[1].area} (${r[1].coverage}%).` : ''}`;
    case 'attention_ranking':
      return `${prefix}${top.area} needs the most attention ${where} (score ${top.score}/100, ${top.level}). Main driver — ${top.topReason}.`;
    case 'anomalies_list':
      return `${prefix}${r.length} active anomal${r.length === 1 ? 'y' : 'ies'} ${where}. Most serious: ${top.type} at ${top.entity} (${top.observed}).`;
    case 'disbursement_failures':
      return `${prefix}Highest payment failure rate ${where}: ${top.block} (${top.district}) at ${top.failureRate}% over the last 3 months, versus a ~2% norm.`;
    case 'sla_breach_by_scheme':
      return `${prefix}${top.scheme} has the most overdue applications ${where}: ${top.breached} of ${top.open} open cases past its ${top.slaDays}-day SLA.`;
  }
}

const intentJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'district', 'scheme', 'level', 'type', 'limit'],
  properties: {
    intent: { type: 'string', enum: Object.keys(INTENT_LABELS) },
    district: { type: ['string', 'null'], description: 'One of the Manipur district names, or null for all' },
    scheme: { type: ['string', 'null'], description: 'Scheme code: IGNOAPS, IGNWPS, IGNDPS, PMMVY, PMS, SSSP, or null' },
    level: { type: ['string', 'null'], description: '"district" or "block" for ranking intents, else null' },
    type: { type: ['string', 'null'], description: 'Anomaly type for anomalies_list, or null' },
    limit: { type: ['integer', 'null'] },
  },
};
const rawIntentSchema = z.object({
  intent: z.string(),
  district: z.string().nullable(),
  scheme: z.string().nullable(),
  level: z.string().nullable().transform((v) => (v === 'district' || v === 'block' ? v : null)),
  type: z.string().nullable(),
  limit: z.number().int().nullable(),
});

function toIntentParams(raw: z.infer<typeof rawIntentSchema>): AskIntentParams | null {
  const clean = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null));
  if (typeof clean.limit === 'number') clean.limit = Math.max(1, Math.min(20, clean.limit));
  const r = askIntentSchema.safeParse(clean);
  return r.success ? r.data : null;
}

const answerSchema = z.object({ answer: z.string().min(3).max(600) });
const answerJsonSchema = { type: 'object', additionalProperties: false, required: ['answer'], properties: { answer: { type: 'string', description: '2 sentences, at most 60 words.' } } };

// ---------- cache (insights_cache) ----------
// The intent is cached per question; the summary per question + exact result rows, so a
// cached sentence can never describe numbers that have since changed (e.g. after a review).
const askKey = (kind: string, s: Snapshot, parts: unknown) =>
  `ask:${kind}:${s.asOf}:${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32)}`;
const normQuestion = (q: string) => q.toLowerCase().replace(/\s+/g, ' ').trim();

function cacheGet<T>(key: string): T | null {
  const row = sqlite.prepare('SELECT content FROM insights_cache WHERE key = ?').get(key) as { content: string } | undefined;
  return row ? (JSON.parse(row.content) as T) : null;
}
function cacheSet(key: string, content: unknown) {
  sqlite.prepare('INSERT INTO insights_cache (key, kind, district_id, content, source, model, created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET content = excluded.content, model = excluded.model, created_at = excluded.created_at')
    .run(key, 'ask', null, JSON.stringify(content), 'llm', aiModel(), new Date().toISOString());
}

const routerSystem = (s: Snapshot) => `You route questions from Manipur Social Welfare Department officers to ONE of these whitelisted analytics intents. You never write SQL.
Intents: ${Object.entries(INTENT_LABELS).map(([k, v]) => `${k} = ${v}`).join('; ')}.
Districts: ${s.districts.map((d) => d.name).join(', ')}.
Schemes: ${s.schemes.map((x) => `${x.code} (${x.shortName})`).join(', ')}.
Anomaly types: duplicate_beneficiary, deceased_paid, application_spike, rejection_spike, disbursement_failure_spike, officer_outlier, pendency_backlog.
Questions are often typed fast: expect typos, SMS spelling, and English mixed with Hindi or Manipuri words. Infer the intended district and scheme and return the exact spelling from the lists above (e.g. "ukrul" -> Ukhrul, "CCpur" -> Churachandpur, "widdow pensn" -> IGNWPS).
Mapping hints: pending / stuck / backlog / "kitna pending" -> pending_by_block; coverage / not reached / left out / low enrolment -> coverage_gap; payment / paisa / money not received / bank failure -> disbursement_failures; duplicate / fraud / dead people paid / suspicious officer -> anomalies_list with the matching type; overdue or SLA by scheme -> sla_breach_by_scheme; vague questions ("where is the problem", "what should I look at", "kya haal hai") -> attention_ranking.
level is "block" when the question mentions blocks or names one district, otherwise "district"; null for intents that do not rank areas.
Use null for any parameter not mentioned. If nothing fits, use attention_ranking.`;

export async function ask(s: Snapshot, question: string, scopeDistrictId: number | null): Promise<AskResult> {
  let params: AskIntentParams | null = null;
  let source: AskResult['source'] = 'keyword';
  let fallbackReason: string | undefined;
  const intentKey = askKey('intent', s, normQuestion(question));
  params = cacheGet<AskIntentParams>(intentKey);
  if (params) source = 'llm';
  else {
    try {
      const raw = await callJson({
        system: routerSystem(s),
        user: String(toLLMPayload(question)),
        jsonSchema: intentJsonSchema,
        schema: rawIntentSchema,
        maxTokens: 2000,
      });
      params = toIntentParams(raw);
      if (params) {
        source = 'llm';
        cacheSet(intentKey, params);
      } else fallbackReason = 'AI intent did not validate';
    } catch (e) {
      fallbackReason = e instanceof LlmUnavailable ? e.message : 'AI unavailable';
    }
  }
  if (!params) params = keywordIntent(s, question);

  const ex = executeIntent(s, params, scopeDistrictId);
  let answer = templateAnswer(params, ex);
  let model: string | null = null;
  if (source === 'llm') {
    model = aiModel();
    const summaryInput = toLLMPayload({ question, intent: params.intent, filters: ex.filters, note: ex.note ?? null, rows: ex.rows });
    const summaryKey = askKey('answer', s, summaryInput);
    const cached = cacheGet<string>(summaryKey);
    if (cached) answer = cached;
    else {
      try {
        const out = await callJson({
          system: 'You summarise query results for a government welfare officer in at most 2 plain sentences (60 words). Lead with the direct answer to the question: name the top item and its key numbers, then the next one or what it implies. Use only the numbers given. Neutral language; describe places only by geography.',
          user: JSON.stringify(summaryInput),
          jsonSchema: answerJsonSchema,
          schema: answerSchema,
          maxTokens: 2000,
        });
        answer = out.answer;
        cacheSet(summaryKey, answer);
      } catch (e) {
        fallbackReason = e instanceof LlmUnavailable ? `Summary: ${e.message}` : 'AI summary unavailable';
      }
    }
  }
  return {
    question,
    intent: params.intent,
    intentLabel: INTENT_LABELS[params.intent],
    filters: ex.filters,
    columns: ex.columns,
    rows: ex.rows,
    answer,
    source,
    model,
    dataAsOf: s.asOf,
    fallbackReason,
  };
}
