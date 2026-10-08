/**
 * PRIVACY GATE: the only path by which data reaches the LLM.
 *
 * toLLMPayload() keeps ONLY whitelisted keys (recursively) and redacts any string
 * that looks like an identifier (Aadhaar-like digit runs, full dates such as DOB,
 * application reference numbers). Names, Aadhaar, DOB, villages and record IDs are
 * never on the whitelist, so they cannot pass through even if a caller adds them.
 */
const ALLOWED_KEYS = new Set([
  // geography / programme (aggregate labels)
  'district', 'districts', 'block', 'blocks', 'scheme', 'schemes', 'area', 'level', 'entity', 'entityType',
  // aggregates
  'population', 'remoteness', 'eligible', 'enrolled', 'coverage', 'gap', 'open', 'breached', 'breachPct',
  'medianAgeDays', 'failureRate', 'anomalyCount', 'score', 'count', 'amount', 'rate', 'value', 'month',
  'received90', 'receivedPrev90', 'openNow', 'open90DaysAgo', 'breachedNow', 'breached90DaysAgo',
  'buckets', 'label', 'stages', 'stage', 'topStage', 'trend', 'rows', 'columns', 'kpis',
  // attention / anomalies
  'attention', 'factors', 'factor', 'points', 'weight', 'rawLabel', 'topReason', 'anomalies', 'type', 'severity',
  'metric', 'expected', 'observed', 'reason', 'amountAtRisk', 'reviewStatus',
  // meta
  'dataAsOf', 'question', 'intent', 'filters', 'note', 'pendencyByBlock', 'slaDays',
]);

/** Field names that must never be sent, even if someone adds them to the whitelist by mistake. */
export const FORBIDDEN_KEYS = ['applicantName', 'aadhaar', 'aadhaarHash', 'aadhaarLast4', 'aadhaar_hash', 'aadhaar_last4', 'dob', 'village', 'beneficiaryId', 'refNo', 'email', 'phone'];

const AADHAAR_LIKE = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g;
const FULL_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const REF_NO = /\bSW\/[A-Z]+\/\d{4}\/\d+\b/g;

function scrub(s: string): string {
  return s.replace(AADHAAR_LIKE, '[redacted-id]').replace(FULL_DATE, '[redacted-date]').replace(REF_NO, '[redacted-ref]').slice(0, 600);
}

export function toLLMPayload(input: unknown, depth = 0): unknown {
  if (depth > 6) return null;
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 1000) / 1000 : null;
  if (typeof input === 'boolean') return input;
  if (typeof input === 'string') return scrub(input);
  if (Array.isArray(input)) return input.slice(0, 40).map((x) => toLLMPayload(x, depth + 1));
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (!ALLOWED_KEYS.has(k) || FORBIDDEN_KEYS.includes(k)) continue;
      // the snapshot date is not personal data; every other full date is redacted
      out[k] = k === 'dataAsOf' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : toLLMPayload(v, depth + 1);
    }
    return out;
  }
  return null;
}
