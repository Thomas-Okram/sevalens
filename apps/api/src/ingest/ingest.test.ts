import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { blockCode, hashAadhaar, normaliseDateTime, readUpload, validateRows, type IngestContext } from './validate';

const ctx = (): IngestContext => ({
  asOf: '2026-10-08',
  schemes: new Map([['IGNOAPS', { id: 1 }], ['IGNWPS', { id: 2 }]]),
  blocks: new Map([['KCG-KAKCHING', { id: 17, districtId: 5, districtCode: 'KCG', name: 'Kakching' }]]),
  existingRefNos: new Set(['SW/KCG/2026/000001']),
  enrolledHashes: new Set([`${hashAadhaar('999988887777')}|1`]),
});

const HEADER = 'ref_no,applicant_name,scheme_code,block_code,submitted_at,status,stage,decided_at,aadhaar';
const run = (...lines: string[]) => validateRows(readUpload([HEADER, ...lines].join('\n')).records, ctx());

describe('CSV parser', () => {
  it('handles quotes, escaped quotes, CRLF, BOM and blank lines', () => {
    const t = parseCsv('﻿Name,Block Code\r\n"Devi, Thoibi","KCG-""X"""\r\n\r\nTomba,KCG-KAKCHING');
    expect(t.headers).toEqual(['name', 'block_code']);
    expect(t.records).toEqual([
      { line: 2, values: { name: 'Devi, Thoibi', block_code: 'KCG-"X"' } },
      { line: 4, values: { name: 'Tomba', block_code: 'KCG-KAKCHING' } },
    ]);
  });
});

describe('row validator', () => {
  it('accepts a valid open application and normalises fields', () => {
    const r = run(',Thoibi Devi,ignoaps,kcg-kakching,2026-07-01,Pending,Field verification,,');
    expect(r.errors).toEqual([]);
    expect(r.valid[0]).toMatchObject({ line: 2, schemeId: 1, blockId: 17, districtId: 5, status: 'pending', pendingStage: 'field_verification', submittedAt: '2026-07-01T10:00:00', decidedAt: null, refNo: null });
  });

  it('accepts a decided application with decided_at', () => {
    const r = run('SW/KCG/2026/900001,Tomba Singh,IGNWPS,KCG-KAKCHING,2026-06-01 09:15,approved,,2026-06-20,');
    expect(r.errors).toEqual([]);
    expect(r.valid[0]).toMatchObject({ status: 'approved', pendingStage: null, decidedAt: '2026-06-20T10:00:00', submittedAt: '2026-06-01T09:15:00' });
  });

  it('rejects unknown scheme and block codes, bad status and bad stage', () => {
    const r = run(',A Person,XYZ,KCG-NOWHERE,2026-07-01,lost,limbo,,');
    expect(r.valid).toHaveLength(0);
    expect(r.errors.map((e) => e.field).sort()).toEqual(['block_code', 'scheme_code', 'stage', 'status']);
    expect(r.errors.every((e) => e.row === 2)).toBe(true);
  });

  it('rejects impossible, future and missing dates', () => {
    const r = run(',A Person,IGNOAPS,KCG-KAKCHING,2026-02-30,submitted,document_check,,', ',B Person,IGNOAPS,KCG-KAKCHING,2026-10-09,submitted,document_check,,', ',C Person,IGNOAPS,KCG-KAKCHING,,submitted,document_check,,');
    expect(r.valid).toHaveLength(0);
    expect(r.errors.map((e) => [e.row, e.field])).toEqual([[2, 'submitted_at'], [3, 'submitted_at'], [4, 'submitted_at']]);
    expect(r.errors[1].message).toMatch(/after the data date/);
  });

  it('enforces status/stage/decided_at consistency', () => {
    const r = run(
      ',Open No Stage,IGNOAPS,KCG-KAKCHING,2026-07-01,submitted,,,',
      ',Decided No Date,IGNOAPS,KCG-KAKCHING,2026-07-01,rejected,,,',
      ',Decided With Stage,IGNOAPS,KCG-KAKCHING,2026-07-01,approved,sanction,2026-07-10,',
      ',Decided Before Submit,IGNOAPS,KCG-KAKCHING,2026-07-01,approved,,2026-06-10,',
    );
    expect(r.valid).toHaveLength(0);
    expect(r.errors.map((e) => [e.row, e.field])).toEqual([[2, 'stage'], [3, 'decided_at'], [4, 'stage'], [5, 'decided_at']]);
  });

  it('rejects ref numbers already in the database or repeated in the file', () => {
    const r = run(
      'SW/KCG/2026/000001,A Person,IGNOAPS,KCG-KAKCHING,2026-07-01,submitted,document_check,,',
      'NEW-1,B Person,IGNOAPS,KCG-KAKCHING,2026-07-01,submitted,document_check,,',
      'new-1,C Person,IGNOAPS,KCG-KAKCHING,2026-07-01,submitted,document_check,,',
    );
    expect(r.valid.map((v) => v.line)).toEqual([3]);
    expect(r.errors.map((e) => [e.row, e.field])).toEqual([[2, 'ref_no'], [4, 'ref_no']]);
    expect(r.errors[1].message).toMatch(/duplicates row 3/);
  });

  it('reports a missing required value per row without stopping other rows', () => {
    const r = run(',,IGNOAPS,KCG-KAKCHING,2026-07-01,submitted,document_check,,', ',Fine Person,IGNOAPS,KCG-KAKCHING,2026-07-01,submitted,document_check,,');
    expect(r.errors).toEqual([{ row: 2, field: 'applicant_name', message: 'is required' }]);
    expect(r.valid.map((v) => v.line)).toEqual([3]);
  });
});

describe('Aadhaar handling', () => {
  it('hashes the Aadhaar column on arrival and drops the raw number', () => {
    const up = readUpload(`applicant_name,Aadhaar No\nThoibi Devi,2345 6789 0123`);
    expect(up.aadhaarColumns).toEqual(['aadhaar_no']);
    expect(up.headers).not.toContain('aadhaar_no');
    expect(up.records[0].aadhaarHash).toBe(hashAadhaar('234567890123'));
    expect(JSON.stringify(up.records)).not.toMatch(/2345|234567890123/);
  });

  it('flags malformed Aadhaar without echoing it, and duplicate applicant+scheme in one file', () => {
    const r = run(
      ',A Person,IGNOAPS,KCG-KAKCHING,2026-07-01,submitted,document_check,,12345',
      ',B Person,IGNOAPS,KCG-KAKCHING,2026-07-01,submitted,document_check,,234567890123',
      ',B Again,IGNOAPS,KCG-KAKCHING,2026-07-02,submitted,document_check,,234567890123',
      ',B Other Scheme,IGNWPS,KCG-KAKCHING,2026-07-02,submitted,document_check,,234567890123',
    );
    expect(r.valid.map((v) => v.line)).toEqual([3, 5]);
    expect(r.errors.map((e) => [e.row, e.field])).toEqual([[2, 'aadhaar'], [4, 'aadhaar']]);
    expect(JSON.stringify(r.errors)).not.toMatch(/12345|234567890123/);
  });

  it('warns (but accepts) when the applicant is already an active beneficiary of the scheme', () => {
    const r = run(',Already In,IGNOAPS,KCG-KAKCHING,2026-07-01,submitted,document_check,,9999-8888-7777');
    expect(r.valid).toHaveLength(1);
    expect(r.warnings).toEqual([{ row: 2, field: 'aadhaar', message: 'applicant is already an active beneficiary of this scheme' }]);
  });
});

describe('helpers', () => {
  it('builds block codes and normalises dates', () => {
    expect(blockCode('KJG', 'Kasom Khullen')).toBe('KJG-KASOM-KHULLEN');
    expect(normaliseDateTime('2026-07-01T08:05')).toBe('2026-07-01T08:05:00');
    expect(normaliseDateTime('01/07/2026')).toBeNull();
  });
});
