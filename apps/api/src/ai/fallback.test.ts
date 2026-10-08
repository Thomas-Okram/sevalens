import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '../services/snapshot';

// No database in unit tests: the cache always misses and writes are dropped.
vi.mock('../db/client', () => ({ sqlite: { prepare: () => ({ get: () => undefined, run: () => undefined }) } }));

const { setAiClient, DEFAULT_TIMEOUT_MS, extractJson } = await import('./llm');
const { generateBrief } = await import('./brief');
const { ask } = await import('./ask');

const attention = (name: string, score: number) => ({ name, districtName: 'Kamjong', score, level: 'high', topReason: 'Coverage gap', factors: [] });
const s = {
  asOf: '2026-10-08',
  districts: [{ id: 9, name: 'Kamjong', code: 'KJG' }],
  blocks: [{ id: 90, districtId: 9, name: 'Kasom Khullen' }],
  schemes: [],
  apps: [],
  anomalies: [],
  districtSummaries: [{ id: 9, name: 'Kamjong', population: 50000, remoteness: 0.9, failureRate: 0.02, coverage: { coverage: 0.18, eligible: 1500, enrolled: 270, gap: 1230, bySchemes: [] }, attention: attention('Kamjong', 48) }],
  blockSummaries: [{ id: 90, districtId: 9, name: 'Kasom Khullen', coverage: { coverage: 0.16, gap: 267 }, openApplications: 4, breached: 1, failureRate: 0.01, anomalyCount: 0, attention: attention('Kasom Khullen', 50) }],
} as unknown as Snapshot;

/** Fake SDK client whose messages.create does whatever the test needs. */
const fakeClient = (create: () => Promise<unknown>) => {
  const spy = vi.fn(create);
  setAiClient({ messages: { create: spy } } as never);
  return spy;
};
const hang = () => new Promise<never>(() => {});

beforeEach(() => vi.stubEnv('ANTHROPIC_API_KEY', 'test-key'));
afterEach(() => {
  setAiClient(null);
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('AI fallback — officer brief', () => {
  it('uses the template when the API throws', async () => {
    const spy = fakeClient(() => Promise.reject(new Error('socket hang up')));
    const b = await generateBrief(s, 9, true);
    expect(spy).toHaveBeenCalledOnce();
    expect(b).toMatchObject({ source: 'template', model: null, fallbackReason: 'AI call failed', visitFirst: { blockName: 'Kasom Khullen' } });
    expect(b.situation).toContain('Kamjong');
  });

  it(`uses the template when the API takes longer than ${DEFAULT_TIMEOUT_MS / 1000}s`, async () => {
    vi.useFakeTimers();
    fakeClient(hang);
    let settled = false;
    const pending = generateBrief(s, 9, true).finally(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS - 100);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    const b = await pending;
    expect(b).toMatchObject({ source: 'template', fallbackReason: 'AI call timed out after 8s' });
  });

  it('rejects a rambling brief (over 250 words) in favour of the template', async () => {
    const long = Array.from({ length: 70 }, () => 'go').join(' '); // passes per-field limits, ~285 words in total
    const out = { situation: long, topIssues: [{ title: 'Low coverage', detail: long }], actions: [long, long], visitFirst: { blockName: 'Kasom Khullen', reason: 'Lowest coverage.' } };
    fakeClient(async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(out) }] }));
    const b = await generateBrief(s, 9, true);
    expect(b).toMatchObject({ source: 'template', fallbackReason: 'AI brief exceeded 250 words' });
  });
});

describe('AI fallback — Ask SevaLens', () => {
  const q = 'Which districts need the most attention?';

  it('uses the keyword matcher and template answer when the API throws', async () => {
    fakeClient(() => Promise.reject(new Error('ECONNRESET')));
    const r = await ask(s, q, null);
    expect(r).toMatchObject({ source: 'keyword', intent: 'attention_ranking', model: null, fallbackReason: 'AI call failed' });
    expect(r.answer).toContain('Kamjong needs the most attention');
  });

  it(`uses the keyword matcher when the API takes longer than ${DEFAULT_TIMEOUT_MS / 1000}s`, async () => {
    vi.useFakeTimers();
    fakeClient(hang);
    const pending = ask(s, q, null);
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS + 100);
    const r = await pending;
    expect(r).toMatchObject({ source: 'keyword', intent: 'attention_ranking', fallbackReason: 'AI call timed out after 8s' });
  });
});

describe('extractJson', () => {
  it('tolerates code fences and preambles around the JSON', () => {
    expect(JSON.parse(extractJson('```json\n{"a":1}\n```'))).toEqual({ a: 1 });
    expect(JSON.parse(extractJson('Here you go: {"a":{"b":2}} hope it helps'))).toEqual({ a: { b: 2 } });
    expect(JSON.parse(extractJson(' {"a":1} '))).toEqual({ a: 1 });
  });
});
