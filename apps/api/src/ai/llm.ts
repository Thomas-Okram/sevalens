/**
 * Thin wrapper around the Anthropic SDK. The LLM is OPTIONAL: every caller has a
 * deterministic fallback and treats any error (no key, timeout, refusal, bad JSON)
 * as "use the fallback".
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ZodSchema, z } from 'zod';

export const aiModel = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

export const DEFAULT_TIMEOUT_MS = 8000;
let timeoutMs = DEFAULT_TIMEOUT_MS;
/** Live requests keep the 8s budget; offline jobs (ai:warm) can afford to wait longer. */
export const setAiTimeout = (ms: number) => { timeoutMs = ms; };

type MessagesClient = Pick<Anthropic, 'messages'>;
let client: MessagesClient | null = null;
const getClient = () => (client ??= new Anthropic({ maxRetries: 0 }));
/** Test seam: swap in a fake client (null restores the real one). */
export const setAiClient = (c: MessagesClient | null) => { client = c; };

export class LlmUnavailable extends Error {}

/**
 * Ask the model for JSON matching `jsonSchema` (structured outputs), then validate
 * it again with zod. Throws LlmUnavailable on anything unexpected, including a hard
 * deadline that fires even if the SDK itself never settles.
 */
export async function callJson<S extends ZodSchema>(opts: {
  system: string;
  user: string;
  jsonSchema: Record<string, unknown>;
  schema: S;
  maxTokens?: number;
}): Promise<z.infer<S>> {
  if (!aiEnabled()) throw new LlmUnavailable('No ANTHROPIC_API_KEY configured');
  const ms = timeoutMs;
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(new LlmUnavailable(`AI call timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
  });
  let res: Anthropic.Message;
  try {
    res = await Promise.race([
      getClient().messages.create(
        {
          model: aiModel(),
          // generous ceiling: adaptive thinking shares this budget, and a truncated reply is useless
          max_tokens: opts.maxTokens ?? 4000,
          system: opts.system,
          messages: [{ role: 'user', content: opts.user }],
          output_config: { effort: 'low', format: { type: 'json_schema', schema: opts.jsonSchema } },
        },
        { signal: abort.signal, timeout: ms },
      ),
      deadline,
    ]);
  } catch (e) {
    if (e instanceof LlmUnavailable) throw e;
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new LlmUnavailable(`AI call timed out after ${Math.round(ms / 1000)}s`);
    if (e instanceof Anthropic.AuthenticationError) throw new LlmUnavailable('AI key rejected');
    if (e instanceof Anthropic.RateLimitError) throw new LlmUnavailable('AI rate limited');
    if (e instanceof Anthropic.APIError) throw new LlmUnavailable(`AI service error (${e.status ?? 'network'})`);
    throw new LlmUnavailable('AI call failed');
  } finally {
    clearTimeout(timer);
  }
  if (res.stop_reason === 'refusal') throw new LlmUnavailable('AI declined the request');
  if (res.stop_reason === 'max_tokens') throw new LlmUnavailable('AI response truncated');
  const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    throw new LlmUnavailable('AI returned invalid JSON');
  }
  const v = opts.schema.safeParse(parsed);
  if (!v.success) throw new LlmUnavailable('AI output failed validation');
  return v.data;
}

/** Structured outputs should return bare JSON; tolerate a stray code fence or preamble anyway. */
export function extractJson(text: string): string {
  const t = text.trim();
  if (t.startsWith('{')) return t;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  if (fenced) return fenced[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  return start >= 0 && end > start ? t.slice(start, end + 1) : t;
}
