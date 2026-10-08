/**
 * CSV ingestion of new applications (STATE_ADMIN only; role enforced where the router is mounted).
 * Valid rows are inserted, invalid rows are reported with row-level errors, and the analytics
 * snapshot + cached briefs are invalidated so scores and anomalies reflect the new data.
 */
import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { sqlite } from '../db/client';
import { getSnapshot, invalidateAll } from '../services/snapshot';
import { audit } from '../lib/audit';
import { h, HttpError } from '../lib/http';
import { REQUIRED_COLUMNS, STAGES, STATUSES, TEMPLATE_COLUMNS, blockCode, readUpload, validateRows, type IngestContext, type RowIssue } from '../ingest/validate';

export const ingestRouter = Router();

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 20_000;
const MAX_REPORTED_ISSUES = 1000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.csv$/i.test(file.originalname) || ['text/csv', 'application/vnd.ms-excel', 'text/plain'].includes(file.mimetype);
    if (ok) cb(null, true);
    else cb(new HttpError(400, 'Please upload a .csv file.'));
  },
});

/** multer errors (size limit, unexpected field) → clean 4xx instead of a 500. */
const singleCsv = (req: Request, res: Response, next: NextFunction) =>
  upload.single('file')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) return next(new HttpError(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400, err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 5 MB.' : 'Upload a single CSV file in the "file" field.'));
    next(err);
  });

const q = <T>(sql: string, ...p: unknown[]) => sqlite.prepare(sql).all(...p) as T[];

function referenceData() {
  const asOf = (sqlite.prepare("SELECT value FROM meta WHERE key = 'data_as_of'").get() as { value: string }).value;
  const schemes = q<{ id: number; code: string; name: string }>('SELECT id, code, name FROM schemes ORDER BY id');
  const blocks = q<{ id: number; name: string; districtId: number; districtCode: string; districtName: string }>(
    'SELECT b.id, b.name, b.district_id AS districtId, d.code AS districtCode, d.name AS districtName FROM blocks b JOIN districts d ON d.id = b.district_id ORDER BY d.name, b.name',
  );
  return { asOf, schemes, blocks: blocks.map((b) => ({ ...b, code: blockCode(b.districtCode, b.name) })) };
}

function buildContext(ref: ReturnType<typeof referenceData>): IngestContext {
  return {
    asOf: ref.asOf,
    schemes: new Map(ref.schemes.map((s) => [s.code, { id: s.id }])),
    blocks: new Map(ref.blocks.map((b) => [b.code, { id: b.id, districtId: b.districtId, districtCode: b.districtCode, name: b.name }])),
    existingRefNos: new Set(q<{ r: string }>('SELECT UPPER(ref_no) AS r FROM applications').map((x) => x.r)),
    enrolledHashes: new Set(q<{ k: string }>("SELECT aadhaar_hash || '|' || scheme_id AS k FROM beneficiaries WHERE status = 'active'").map((x) => x.k)),
  };
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Valid codes, statuses and stages for the upload page. */
ingestRouter.get('/reference', h((_req, res) => {
  const ref = referenceData();
  res.json({
    asOf: ref.asOf,
    columns: TEMPLATE_COLUMNS,
    requiredColumns: REQUIRED_COLUMNS,
    statuses: STATUSES,
    stages: STAGES,
    schemes: ref.schemes.map((s) => ({ code: s.code, name: s.name })),
    blocks: ref.blocks.map((b) => ({ code: b.code, name: b.name, district: b.districtName })),
  });
}));

ingestRouter.get('/template.csv', h((_req, res) => {
  const { asOf } = referenceData();
  const rows = [
    TEMPLATE_COLUMNS,
    ['', 'Example Applicant One', 'IGNOAPS', 'KCG-KAKCHING', asOf, 'submitted', 'document_check', '', ''],
    ['', 'Example Applicant Two', 'IGNWPS', 'UKL-CHINGAI', `${asOf} 11:30`, 'pending', 'field_verification', '', ''],
    ['', 'Example Applicant Three', 'PMMVY', 'IW-LAMSHANG', '2026-08-01', 'approved', '', `${asOf}`, ''],
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="sevalens_applications_template.csv"');
  res.send(rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n');
}));

const insApp = sqlite.prepare('INSERT INTO applications (ref_no, applicant_name, scheme_id, district_id, block_id, submitted_at, status, decided_at, officer_id, pending_stage) VALUES (?,?,?,?,?,?,?,?,NULL,?)');
const setRef = sqlite.prepare('UPDATE applications SET ref_no = ? WHERE id = ?');

ingestRouter.post('/applications', singleCsv, h((req, res) => {
  const file = req.file;
  if (!file) throw new HttpError(400, 'No file received. Choose a CSV file to upload.');
  const fileInfo = { filename: file.originalname.slice(0, 120), sizeBytes: file.size, sha256: crypto.createHash('sha256').update(file.buffer).digest('hex') };

  // Aadhaar is hashed here, as the very first step after decoding; the raw buffer is not kept.
  const { headers, records, aadhaarColumns } = readUpload(file.buffer.toString('utf8'));
  const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length || records.length === 0 || records.length > MAX_ROWS) {
    const reason = missing.length ? `Missing required column(s): ${missing.join(', ')}. Download the template for the expected header.`
      : records.length === 0 ? 'The file has no data rows.' : `Too many rows (${records.length}); the limit is ${MAX_ROWS.toLocaleString('en-IN')} per upload.`;
    audit(req, 'ingest.applications', 'upload', null, { ...fileInfo, accepted: 0, rejected: records.length, reason });
    throw new HttpError(400, reason);
  }

  const ref = referenceData();
  const { valid, errors, warnings } = validateRows(records, buildContext(ref));
  const touchedBlocks = [...new Set(valid.map((v) => v.blockId))];
  const before = new Map(getSnapshot().blockSummaries.filter((b) => touchedBlocks.includes(b.id)).map((b) => [b.id, b.attention]));

  if (valid.length) {
    sqlite.transaction(() => {
      for (const v of valid) {
        const id = Number(insApp.run(v.refNo ?? 'PENDING', v.applicantName, v.schemeId, v.districtId, v.blockId, v.submittedAt, v.status, v.decidedAt, v.pendingStage).lastInsertRowid);
        if (!v.refNo) setRef.run(`SW/${v.districtCode}/${v.submittedAt.slice(0, 4)}/${String(id).padStart(6, '0')}`, id);
      }
      // briefs are keyed by data date, which ingestion does not change — drop the affected ones
      const districts = [...new Set(valid.map((v) => v.districtId))];
      sqlite.prepare(`DELETE FROM insights_cache WHERE kind = 'brief' AND district_id IN (${districts.map(() => '?').join(',')})`).run(...districts);
    })();
    invalidateAll();
  }

  const after = getSnapshot();
  const blocks = after.blockSummaries
    .filter((b) => touchedBlocks.includes(b.id))
    .map((b) => ({
      blockId: b.id, block: b.name, districtId: b.districtId, district: after.districts.find((d) => d.id === b.districtId)!.name,
      rows: valid.filter((v) => v.blockId === b.id).length,
      attentionBefore: before.get(b.id)?.score ?? null, attentionAfter: b.attention.score, level: b.attention.level,
      openApplications: b.openApplications, breached: b.breached,
    }))
    .sort((a, b) => b.rows - a.rows);

  const rejectedRows = new Set(errors.map((e) => e.row)).size;
  const result = {
    totalRows: records.length,
    accepted: valid.length,
    rejected: rejectedRows,
    errors: errors.slice(0, MAX_REPORTED_ISSUES) as RowIssue[],
    warnings: warnings.slice(0, MAX_REPORTED_ISSUES) as RowIssue[],
    truncated: errors.length > MAX_REPORTED_ISSUES || warnings.length > MAX_REPORTED_ISSUES,
    aadhaarHashed: valid.filter((v) => v.aadhaarHash).length,
    blocks,
    dataAsOf: ref.asOf,
  };
  audit(req, 'ingest.applications', 'upload', null, {
    ...fileInfo, totalRows: result.totalRows, accepted: result.accepted, rejected: result.rejected, warnings: warnings.length,
    aadhaarColumns, aadhaarHashed: result.aadhaarHashed, blocks: blocks.map((b) => `${b.block} (${b.rows})`),
  });
  res.json(result);
}));
