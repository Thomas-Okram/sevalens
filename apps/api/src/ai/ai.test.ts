import { describe, expect, it } from 'vitest';
import { toLLMPayload, FORBIDDEN_KEYS } from './sanitize';
import { keywordIntent } from './ask';
import type { Snapshot } from '../services/snapshot';

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
    expect(out).toMatchObject({ district: 'Ukhrul', coverage: 0.749, blocks: [{ block: 'Chingai', open: 12 }], anomalies: [{ type: 'Possible duplicates', observed: '50 pairs' }] });
  });
});

describe('keyword intent fallback', () => {
  const s = { districts: [{ id: 8, name: 'Ukhrul', code: 'UKL' }, { id: 1, name: 'Imphal West', code: 'IW' }] } as unknown as Snapshot;
  it('maps the sample question to pending_by_block with district + scheme', () => {
    expect(keywordIntent(s, 'Which blocks in Ukhrul have the most pending widow pension cases?')).toMatchObject({ intent: 'pending_by_block', district: 'Ukhrul', scheme: 'IGNWPS' });
  });
  it('routes other phrasings', () => {
    expect(keywordIntent(s, 'Where is coverage lowest?').intent).toBe('coverage_gap');
    expect(keywordIntent(s, 'Show duplicate beneficiaries in Imphal West')).toMatchObject({ intent: 'anomalies_list', type: 'duplicate_beneficiary', district: 'Imphal West' });
    expect(keywordIntent(s, 'payment failures by block').intent).toBe('disbursement_failures');
    expect(keywordIntent(s, 'top 5 areas to visit').intent).toBe('attention_ranking');
  });
});
