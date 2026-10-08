/**
 * Row validation for CSV ingestion of new applications. Pure: all reference data
 * (scheme/block codes, data date, existing ref numbers) comes in via IngestContext,
 * so it is unit-tested without a database.
 *
 * Privacy: any Aadhaar-like column is replaced by its salted hash in scrubAadhaar(),
 * which runs immediately after the CSV is parsed — before validation, logging or
 * storage. The raw number is never echoed back in errors.
 */
import crypto from 'node:crypto';
import { z } from 'zod';
import { parseCsv, type CsvTable } from './csv';

export const STATUSES = ['submitted', 'verified', 'pending', 'approved', 'rejected'] as const;
export const OPEN_STATUSES = new Set<string>(['submitted', 'verified', 'pending']);
export const STAGES = ['document_check', 'field_verification', 'sanction', 'payment_setup'] as const;

export const REQUIRED_COLUMNS = ['applicant_name', 'scheme_code', 'block_code', 'submitted_at', 'status'] as const;
export const TEMPLATE_COLUMNS = ['ref_no', 'applicant_name', 'scheme_code', 'block_code', 'submitted_at', 'status', 'stage', 'decided_at', 'aadhaar'] as const;

/** Stable, human-readable block code: district code + block name, e.g. KCG-KAKCHING, KJG-KASOM-KHULLEN. */
export const blockCode = (districtCode: string, blockName: string) =>
  `${districtCode}-${blockName.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

const SALT = process.env.AADHAAR_SALT ?? 'demo-salt-not-for-production';
/** Same salted SHA-256 as the seed, so uploads can be matched against existing beneficiaries. */
export const hashAadhaar = (digits: string) => crypto.createHash('sha256').update(SALT + digits).digest('hex');

const AADHAAR_HEADER = /aadhaa?r|^uid(_|$)/;

export interface ScrubbedRecord {
  line: number;
  values: Record<string, string>; // no Aadhaar columns remain
  aadhaarHash: string | null;
  aadhaarError: string | null;
}

/** Remove every Aadhaar-like column from a record, keeping only its salted hash. */
export function scrubAadhaar(rec: { line: number; values: Record<string, string> }): ScrubbedRecord {
  const values: Record<string, string> = {};
  let aadhaarHash: string | null = null;
  let aadhaarError: string | null = null;
  for (const [k, v] of Object.entries(rec.values)) {
    if (!AADHAAR_HEADER.test(k)) { values[k] = v; continue; }
    const digits = v.replace(/[\s-]/g, '');
    if (!digits) continue;
    if (/^\d{12}$/.test(digits)) aadhaarHash = hashAadhaar(digits);
    else aadhaarError = 'must be 12 digits (value not shown)';
  }
  return { line: rec.line, values, aadhaarHash, aadhaarError };
}

/** Parse an uploaded CSV and scrub Aadhaar on arrival. The only entry point the route uses. */
export function readUpload(text: string): { headers: string[]; records: ScrubbedRecord[]; aadhaarColumns: string[] } {
  const t: CsvTable = parseCsv(text);
  return {
    headers: t.headers.filter((h) => !AADHAAR_HEADER.test(h)),
    aadhaarColumns: t.headers.filter((h) => AADHAAR_HEADER.test(h)),
    records: t.records.map(scrubAadhaar),
  };
}

export interface IngestContext {
  asOf: string; // YYYY-MM-DD data date; nothing may be dated after it
  schemes: Map<string, { id: number }>; // by scheme code
  blocks: Map<string, { id: number; districtId: number; districtCode: string; name: string }>; // by block code
  existingRefNos: Set<string>;
  enrolledHashes?: Set<string>; // `${aadhaarHash}|${schemeId}` of active beneficiaries
}

export interface ValidApplication {
  line: number;
  refNo: string | null;
  applicantName: string;
  schemeId: number;
  districtId: number;
  districtCode: string;
  blockId: number;
  blockName: string;
  submittedAt: string; // YYYY-MM-DDTHH:MM:SS
  status: (typeof STATUSES)[number];
  decidedAt: string | null;
  pendingStage: (typeof STAGES)[number] | null;
  aadhaarHash: string | null;
}

export interface RowIssue { row: number; field: string; message: string }

/** Accepts YYYY-MM-DD or YYYY-MM-DD[T ]HH:MM[:SS]; returns YYYY-MM-DDTHH:MM:SS or null if not a real date. */
export function normaliseDateTime(v: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(v.trim());
  if (!m) return null;
  const [, y, mo, d, hh = '10', mi = '00', ss = '00'] = m;
  const iso = `${y}-${mo}-${d}T${hh}:${mi}:${ss}`;
  const dt = new Date(iso + 'Z');
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 19) !== iso) return null;
  return iso;
}

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const lower = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : v);

function rowSchema(ctx: IngestContext) {
  const latest = `${ctx.asOf}T23:59:59`;
  const dateField = (label: string) =>
    z.string().transform((v, c) => {
      const iso = normaliseDateTime(v);
      if (!iso) { c.addIssue({ code: 'custom', message: `${label} must be a valid date (YYYY-MM-DD or YYYY-MM-DD HH:MM)` }); return z.NEVER; }
      if (iso > latest) { c.addIssue({ code: 'custom', message: `${label} is after the data date (${ctx.asOf})` }); return z.NEVER; }
      if (iso < '2000-01-01') { c.addIssue({ code: 'custom', message: `${label} is before 2000` }); return z.NEVER; }
      return iso;
    });

  return z
    .object({
      ref_no: z.preprocess(blankToNull, z.string().regex(/^[A-Za-z0-9/_-]{3,40}$/, 'must be 3–40 letters, digits, / _ or -').nullable().default(null)),
      applicant_name: z.string({ required_error: 'is required' }).min(2, 'is required').max(120, 'is too long (max 120)'),
      scheme_code: z.preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v), z.string().refine((c) => ctx.schemes.has(c), 'is not a known scheme code')),
      block_code: z.preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v), z.string().refine((c) => ctx.blocks.has(c), 'is not a known block code')),
      submitted_at: dateField('submitted_at'),
      status: z.preprocess(lower, z.enum(STATUSES, { errorMap: () => ({ message: `must be one of ${STATUSES.join(', ')}` }) })),
      stage: z.preprocess((v) => blankToNull(typeof v === 'string' ? v.trim().toLowerCase().replace(/[\s-]+/g, '_') : v), z.enum(STAGES, { errorMap: () => ({ message: `must be one of ${STAGES.join(', ')}` }) }).nullable().default(null)),
      decided_at: z.preprocess(blankToNull, dateField('decided_at').nullable().default(null)),
    })
    .superRefine((r, c) => {
      const open = OPEN_STATUSES.has(r.status);
      if (open && !r.stage) c.addIssue({ code: 'custom', path: ['stage'], message: `is required when status is ${r.status}` });
      if (!open && r.stage) c.addIssue({ code: 'custom', path: ['stage'], message: `must be blank when status is ${r.status}` });
      if (open && r.decided_at) c.addIssue({ code: 'custom', path: ['decided_at'], message: `must be blank when status is ${r.status}` });
      if (!open && !r.decided_at) c.addIssue({ code: 'custom', path: ['decided_at'], message: `is required when status is ${r.status}` });
      if (r.decided_at && r.decided_at < r.submitted_at) c.addIssue({ code: 'custom', path: ['decided_at'], message: 'is before submitted_at' });
    });
}

export function validateRows(records: ScrubbedRecord[], ctx: IngestContext): { valid: ValidApplication[]; errors: RowIssue[]; warnings: RowIssue[] } {
  const schema = rowSchema(ctx);
  const valid: ValidApplication[] = [];
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const refSeen = new Map<string, number>();
  const aadhaarSeen = new Map<string, number>();

  for (const rec of records) {
    const rowErrors: RowIssue[] = [];
    if (rec.aadhaarError) rowErrors.push({ row: rec.line, field: 'aadhaar', message: rec.aadhaarError });
    const r = schema.safeParse(rec.values);
    if (!r.success) for (const i of r.error.issues) rowErrors.push({ row: rec.line, field: String(i.path[0] ?? 'row'), message: i.message });

    if (r.success) {
      const d = r.data;
      if (d.ref_no) {
        const key = d.ref_no.toUpperCase();
        if (ctx.existingRefNos.has(key)) rowErrors.push({ row: rec.line, field: 'ref_no', message: 'already exists (application previously ingested)' });
        else if (refSeen.has(key)) rowErrors.push({ row: rec.line, field: 'ref_no', message: `duplicates row ${refSeen.get(key)}` });
      }
      const scheme = ctx.schemes.get(d.scheme_code)!;
      if (rec.aadhaarHash) {
        const key = `${rec.aadhaarHash}|${scheme.id}`;
        if (aadhaarSeen.has(key)) rowErrors.push({ row: rec.line, field: 'aadhaar', message: `same applicant and scheme as row ${aadhaarSeen.get(key)}` });
        else if (ctx.enrolledHashes?.has(key)) warnings.push({ row: rec.line, field: 'aadhaar', message: 'applicant is already an active beneficiary of this scheme' });
      }
      if (!rowErrors.length) {
        if (d.ref_no) refSeen.set(d.ref_no.toUpperCase(), rec.line);
        if (rec.aadhaarHash) aadhaarSeen.set(`${rec.aadhaarHash}|${scheme.id}`, rec.line);
        const b = ctx.blocks.get(d.block_code)!;
        valid.push({
          line: rec.line, refNo: d.ref_no, applicantName: d.applicant_name, schemeId: scheme.id,
          districtId: b.districtId, districtCode: b.districtCode, blockId: b.id, blockName: b.name,
          submittedAt: d.submitted_at, status: d.status, decidedAt: d.decided_at, pendingStage: d.stage, aadhaarHash: rec.aadhaarHash,
        });
      }
    }
    errors.push(...rowErrors);
  }
  return { valid, errors, warnings };
}
