import { describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '../services/snapshot';

vi.mock('../db/client', () => ({ sqlite: { prepare: () => ({ get: () => undefined, run: () => undefined }) } }));
const { toLLMPayload, FORBIDDEN_KEYS } = await import('./sanitize');
const { keywordIntent, resolveDistrict } = await import('./ask');

describe('toLLMPayload — PII never reaches the LLM', () => {
  const pii = {
    name: 'Sunita Devi',
    applicantName: 'Ramesh Kumar',
    aadhaar: '234567890123',
    aadhaarHash: 'f'.repeat(64),
    aadhaarLast4: '0123',
    dob: '1950-01-01',
    village: 'Khullok',
    beneficiaryId: 4242,
    refNo: 'SW/IW/2026/000165',
    email: 'someone@example.com',
  };
  const payload = {
    district: 'Ukhrul',
    coverage: 0.7489,
    note: 'Call 2345 6789 0123 born 1950-01-01 ref SW/IW/2026/000165',
    blocks: [{ block: 'Chingai', open: 12, ...pii, nested: { ...pii } }],
    anomalies: [{ type: 'Possible duplicates', observed: '50 pairs', records: [pii] }],
    ...pii,
  };
  const out = toLLMPayload(payload);
  const json = JSON.stringify(out);

  it('drops every non-whitelisted / forbidden field at any depth', () => {
    for (const k of [...FORBIDDEN_KEYS, 'name', 'records', 'nested']) expect(json).not.toContain(`"${k}"`);
  });

  it('contains no personal values', () => {
    for (const v of ['Sunita', 'Ramesh', '234567890123', 'f'.repeat(64), '1950-01-01', 'Khullok', 'someone@example.com', '000165', '2345 6789 0123']) {
      expect(json).not.toContain(v);
    }
  });

  it('redacts identifier-like patterns inside allowed free text', () => {
    expect((out as { note: string }).note).toBe('Call [redacted-id] born [redacted-date] ref [redacted-ref]');
  });

  it('keeps the aggregate statistics', () => {
    expect(toLLMPayload({ dataAsOf: '2026-10-08', note: 'dob 2026-10-08' })).toEqual({ dataAsOf: '2026-10-08', note: 'dob [redacted-date]' });
    expect(out).toMatchObject({ district: 'Ukhrul', coverage: 0.749, blocks: [{ block: 'Chingai', open: 12 }], anomalies: [{ type: 'Possible duplicates', observed: '50 pairs' }] });
  });
});

describe('keyword intent fallback', () => {
  const s = { districts: [{ id: 8, name: 'Ukhrul', code: 'UKL' }, { id: 1, name: 'Imphal West', code: 'IW' }, { id: 4, name: 'Thoubal', code: 'TBL' }, { id: 9, name: 'Kamjong', code: 'KJG' }, { id: 12, name: 'Churachandpur', code: 'CCP' }] } as unknown as Snapshot;
  it('maps the sample question to pending_by_block with district + scheme', () => {
    expect(keywordIntent(s, 'Which blocks in Ukhrul have the most pending widow pension cases?')).toMatchObject({ intent: 'pending_by_block', district: 'Ukhrul', scheme: 'IGNWPS' });
  });
  it('routes other phrasings', () => {
    expect(keywordIntent(s, 'Where is coverage lowest?').intent).toBe('coverage_gap');
    expect(keywordIntent(s, 'Show duplicate beneficiaries in Imphal West')).toMatchObject({ intent: 'anomalies_list', type: 'duplicate_beneficiary', district: 'Imphal West' });
    expect(keywordIntent(s, 'payment failures by block').intent).toBe('disbursement_failures');
    expect(keywordIntent(s, 'top 5 areas to visit').intent).toBe('attention_ranking');
  });
  it('survives typos, Hinglish and vague wording', () => {
    expect(keywordIntent(s, 'whch blok in ukrul hav most pendng widdow pensn')).toMatchObject({ intent: 'pending_by_block', district: 'Ukhrul', scheme: 'IGNWPS' });
    expect(keywordIntent(s, 'duplicat ppl in thoubal??')).toMatchObject({ intent: 'anomalies_list', type: 'duplicate_beneficiary', district: 'Thoubal' });
    expect(keywordIntent(s, 'kamjong coverge v low why')).toMatchObject({ intent: 'coverage_gap', district: 'Kamjong' });
    expect(keywordIntent(s, 'churachandpur paisa nahi aa raha')).toMatchObject({ intent: 'disbursement_failures', district: 'Churachandpur' });
    expect(keywordIntent(s, 'where is the problem').intent).toBe('attention_ranking');
  });
  it('resolves misspelt district names from the model', () => {
    expect(resolveDistrict(s, 'Ukrul')?.name).toBe('Ukhrul');
    expect(resolveDistrict(s, 'Churachandpr')?.name).toBe('Churachandpur');
    expect(resolveDistrict(s, 'Senapati')).toBeNull();
  });
});
