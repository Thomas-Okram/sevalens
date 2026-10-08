/**
 * Thin wrapper around the Anthropic SDK. The LLM is OPTIONAL: every caller has a
 * deterministic fallback and treats any error (no key, timeout, refusal, bad JSON)
 * as "use the fallback".
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ZodSchema, z } from 'zod';

export const aiModel = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

const TIMEOUT_MS = 8000;
let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 0 }));

export class LlmUnavailable extends Error {}

/**
 * Ask the model for JSON matching `jsonSchema` (structured outputs), then validate
 * it again with zod. Throws LlmUnavailable on anything unexpected.
 */
export async function callJson<S extends ZodSchema>(opts: {
  system: string;
  user: string;
  jsonSchema: Record<string, unknown>;
  schema: S;
  maxTokens?: number;
}): Promise<z.infer<S>> {
  if (!aiEnabled()) throw new LlmUnavailable('No ANTHROPIC_API_KEY configured');
  let res: Anthropic.Message;
  try {
    res = await getClient().messages.create({
      model: aiModel(),
      max_tokens: opts.maxTokens ?? 2000,
      system: opts.system,
      messages: [{ role: 'user', content: opts.user }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: opts.jsonSchema } },
    });
  } catch (e) {
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new LlmUnavailable('AI call timed out after 8s');
    if (e instanceof Anthropic.AuthenticationError) throw new LlmUnavailable('AI key rejected');
    if (e instanceof Anthropic.RateLimitError) throw new LlmUnavailable('AI rate limited');
    if (e instanceof Anthropic.APIError) throw new LlmUnavailable(`AI service error (${e.status ?? 'network'})`);
    throw new LlmUnavailable('AI call failed');
  }
  if (res.stop_reason === 'refusal') throw new LlmUnavailable('AI declined the request');
  if (res.stop_reason === 'max_tokens') throw new LlmUnavailable('AI response truncated');
  const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LlmUnavailable('AI returned invalid JSON');
  }
  const v = opts.schema.safeParse(parsed);
  if (!v.success) throw new LlmUnavailable('AI output failed validation');
  return v.data;
}
