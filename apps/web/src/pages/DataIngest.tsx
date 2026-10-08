import { useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Download, FileSpreadsheet, ShieldCheck, UploadCloud, XCircle, AlertTriangle } from 'lucide-react';
import type { Severity } from '@sevalens/shared';
import { api, ApiError } from '../lib/api';
import { fmtInt } from '../lib/format';
import { Button, Card, Empty, ErrorState, KpiTile, PageHeader, ScorePill, cx } from '../components/ui';

interface RowIssue { row: number; field: string; message: string }
interface IngestResult {
  totalRows: number;
  accepted: number;
  rejected: number;
  errors: RowIssue[];
  warnings: RowIssue[];
  truncated: boolean;
  aadhaarHashed: number;
  dataAsOf: string;
  blocks: { blockId: number; block: string; districtId: number; district: string; rows: number; attentionBefore: number | null; attentionAfter: number; level: Severity; openApplications: number; breached: number }[];
}
interface IngestReference {
  asOf: string;
  columns: string[];
  requiredColumns: string[];
  statuses: string[];
  stages: string[];
  schemes: { code: string; name: string }[];
  blocks: { code: string; name: string; district: string }[];
}

const MAX_BYTES = 5 * 1024 * 1024;

async function uploadCsv(file: File): Promise<IngestResult> {
  const body = new FormData();
  body.append('file', file);
  let res: Response;
  try {
    res = await fetch('/api/ingest/applications', { method: 'POST', credentials: 'same-origin', body });
  } catch {
    throw new ApiError(0, 'Cannot reach the SevaLens server. Is the API running?');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Upload failed (${res.status})`);
  return data as IngestResult;
}

export default function DataIngest() {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const ref = useQuery({ queryKey: ['ingest-reference'], queryFn: () => api.get<IngestReference>('/ingest/reference'), staleTime: Infinity });

  const m = useMutation({
    mutationFn: uploadCsv,
    // analytics are rebuilt server-side; drop every cached view so overview, scores and anomalies refetch
    onSuccess: (r) => { if (r.accepted) qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'ingest-reference' }); },
  });

  const choose = (f: File | undefined) => {
    m.reset();
    setLocalError(null);
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) return setLocalError('Please choose a .csv file.');
    if (f.size > MAX_BYTES) return setLocalError('File is larger than 5 MB.');
    setFile(f);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    choose(e.dataTransfer.files[0]);
  };

  const r = m.data;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Data ingest"
        subtitle="Upload new applications as CSV — valid rows are added and all analytics are recomputed"
        actions={
          <a href="/api/ingest/template.csv" download className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-navy-900 ring-1 ring-slate-300 transition-colors hover:bg-slate-50">
            <Download className="h-4 w-4" /> Download template CSV
          </a>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Upload applications" subtitle="CSV, up to 5 MB. Every row is validated; invalid rows are skipped and listed below.">
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            onClick={() => input.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
            role="button"
            tabIndex={0}
            className={cx('flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors', drag ? 'border-teal-500 bg-teal-50' : 'border-slate-300 bg-slate-50 hover:border-slate-400')}
          >
            <UploadCloud className={cx('h-8 w-8', drag ? 'text-teal-600' : 'text-slate-400')} />
            {file ? (
              <div className="flex items-center gap-2 text-sm font-medium text-navy-900"><FileSpreadsheet className="h-4 w-4 text-teal-600" /> {file.name} <span className="font-normal text-slate-500">({fmtInt(Math.ceil(file.size / 1024))} KB)</span></div>
            ) : (
              <div className="text-sm text-slate-600"><b className="text-navy-900">Drop a CSV here</b> or click to choose a file</div>
            )}
            <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-xs text-slate-500"><ShieldCheck className="h-3.5 w-3.5 text-teal-600" /> Aadhaar numbers are hashed on arrival and never stored. Each upload is written to the audit log.</p>
            <Button disabled={!file || m.isPending} onClick={() => file && m.mutate(file)}>
              <UploadCloud className="h-4 w-4" /> {m.isPending ? 'Uploading & recomputing…' : 'Upload and validate'}
            </Button>
          </div>
          {localError && <p className="mt-3 text-sm text-red-700">{localError}</p>}
          {m.isError && <div className="mt-3"><ErrorState error={m.error} /></div>}
        </Card>

        <Card title="Expected columns" subtitle={ref.data ? `Dates up to ${ref.data.asOf} (data date)` : undefined}>
          {ref.isError ? <ErrorState error={ref.error} /> : !ref.data ? <div className="h-32" /> : (
            <div className="space-y-2 text-xs text-slate-600">
              <div className="flex flex-wrap gap-1">
                {ref.data.columns.map((c) => (
                  <code key={c} className={cx('rounded px-1.5 py-0.5', ref.data.requiredColumns.includes(c) ? 'bg-navy-900 text-white' : 'bg-slate-100 text-slate-700')}>{c}</code>
                ))}
              </div>
              <p>Dark = required. <b>stage</b> is required for open cases ({ref.data.statuses.filter((s) => s !== 'approved' && s !== 'rejected').join(', ')}); <b>decided_at</b> for approved / rejected.</p>
              <p><b>Stages:</b> {ref.data.stages.join(', ')}</p>
              <details>
                <summary className="cursor-pointer font-medium text-navy-900">Scheme codes ({ref.data.schemes.length})</summary>
                <ul className="mt-1 space-y-0.5">{ref.data.schemes.map((s) => <li key={s.code}><code>{s.code}</code> — {s.name}</li>)}</ul>
              </details>
              <details>
                <summary className="cursor-pointer font-medium text-navy-900">Block codes ({ref.data.blocks.length})</summary>
                <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto">{ref.data.blocks.map((b) => <li key={b.code}><code>{b.code}</code> — {b.name}, {b.district}</li>)}</ul>
              </details>
            </div>
          )}
        </Card>
      </div>

      {r && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile label="Rows in file" value={fmtInt(r.totalRows)} info="Data rows in the uploaded CSV (blank lines ignored)." />
            <KpiTile label="Accepted" value={fmtInt(r.accepted)} icon={<CheckCircle2 className="h-4 w-4" />} info="Rows that passed validation and were added as applications." />
            <KpiTile label="Rejected" value={fmtInt(r.rejected)} icon={<XCircle className="h-4 w-4" />} info="Rows with at least one error. Fix them and re-upload just those rows." />
            <KpiTile label="Aadhaar hashed" value={fmtInt(r.aadhaarHashed)} info="Accepted rows with an Aadhaar number. Each was replaced by a salted hash on arrival, used only for duplicate checks; the raw number is never stored." />
          </div>

          {r.blocks.length > 0 && (
            <Card bodyClass="p-0" title="Impact on attention scores" subtitle="Block Attention Score before and after this upload"
              actions={<Link to="/" className="inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:underline">Open state overview <ArrowRight className="h-4 w-4" /></Link>}>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <tr><th className="px-4 py-2">Block</th><th className="px-3 py-2 text-right">Rows added</th><th className="px-3 py-2 text-right">Open now</th><th className="px-3 py-2 text-right">Past SLA</th><th className="px-3 py-2">Attention</th><th className="px-3 py-2" /></tr>
                </thead>
                <tbody>
                  {r.blocks.map((b) => (
                    <tr key={b.blockId} className="border-t border-slate-100">
                      <td className="px-4 py-2"><span className="font-medium text-navy-900">{b.block}</span> <span className="text-slate-500">· {b.district}</span></td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtInt(b.rows)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtInt(b.openApplications)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtInt(b.breached)}</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-2">
                          <span className="tabular-nums text-slate-500">{b.attentionBefore ?? '—'}</span>
                          <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                          <ScorePill score={b.attentionAfter} level={b.level} />
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right"><Link to={`/districts/${b.districtId}`} className="text-xs font-medium text-teal-700 hover:underline">District view</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          <Card bodyClass="p-0" title="Row errors" subtitle={r.errors.length ? `${fmtInt(r.rejected)} row(s) skipped. Row numbers match the spreadsheet (header = row 1).${r.truncated ? ' Showing the first 1,000 issues.' : ''}` : undefined}>
            {r.errors.length === 0 && r.warnings.length === 0 ? (
              <Empty title="No errors — every row was accepted" />
            ) : (
              <div className="max-h-[50vh] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <tr><th className="px-4 py-2">Row</th><th className="px-3 py-2">Column</th><th className="px-3 py-2">Problem</th></tr>
                  </thead>
                  <tbody>
                    {r.errors.map((e, i) => (
                      <tr key={`e${i}`} className="border-t border-slate-100">
                        <td className="px-4 py-1.5 tabular-nums"><span className="inline-flex items-center gap-1.5"><XCircle className="h-3.5 w-3.5 text-red-600" />{e.row}</span></td>
                        <td className="px-3 py-1.5 font-mono text-xs text-navy-900">{e.field}</td>
                        <td className="px-3 py-1.5 text-slate-700">{e.message}</td>
                      </tr>
                    ))}
                    {r.warnings.map((w, i) => (
                      <tr key={`w${i}`} className="border-t border-slate-100 bg-amber-50/40">
                        <td className="px-4 py-1.5 tabular-nums"><span className="inline-flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 text-amber-600" />{w.row}</span></td>
                        <td className="px-3 py-1.5 font-mono text-xs text-navy-900">{w.field}</td>
                        <td className="px-3 py-1.5 text-slate-700">Accepted, but {w.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
