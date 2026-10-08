import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { CheckCheck, X, Ban, TableProperties, RotateCcw, Users, HeartCrack, TrendingUp, ThumbsDown, CreditCard, UserCog, Hourglass } from 'lucide-react';
import type { Anomaly, AnomalyDetail, AnomaliesResponse, AnomalyType, ReviewStatus } from '@sevalens/shared';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useMeta } from '../lib/queries';
import { fmtDate, fmtINR, fmtMonth } from '../lib/format';
import { AXIS, GRID, SEV_COLOR } from '../lib/theme';
import { Button, Card, Empty, ErrorState, Loading, PageHeader, Select, SeverityBadge, Skeleton, cx } from '../components/ui';
import { BeneficiaryModal } from '../components/BeneficiaryModal';
import { CreateActionButton } from '../components/CreateActionButton';

const TYPE_META: Record<AnomalyType, { label: string; icon: typeof Users; blurb: string }> = {
  duplicate_beneficiary: { label: 'Possible duplicates', icon: Users, blurb: 'Same person enrolled more than once' },
  deceased_paid: { label: 'Paid after death', icon: HeartCrack, blurb: 'Payments after recorded date of death' },
  pendency_backlog: { label: 'SLA backlog', icon: Hourglass, blurb: 'Blocks with unusual numbers of overdue cases' },
  application_spike: { label: 'Application surges', icon: TrendingUp, blurb: 'Monthly applications far above normal' },
  disbursement_failure_spike: { label: 'Payment failure spikes', icon: CreditCard, blurb: 'Failed / returned payments far above normal' },
  rejection_spike: { label: 'Rejection spikes', icon: ThumbsDown, blurb: 'Monthly rejections far above normal' },
  officer_outlier: { label: 'Officer outliers', icon: UserCog, blurb: 'Decision patterns far from peers' },
};
const TYPE_ORDER = Object.keys(TYPE_META) as AnomalyType[];

export default function Anomalies() {
  const { user } = useAuth();
  const meta = useMeta();
  const [sp, setSp] = useSearchParams();
  const districtId = sp.get('districtId') ?? '';
  const type = sp.get('type') ?? '';
  const showDismissed = sp.get('dismissed') === '1';
  const openKey = sp.get('key');
  const setParam = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v); else n.delete(k);
    setSp(n, { replace: true });
  };
  const query = qs({ districtId, type, includeDismissed: showDismissed ? 'true' : undefined });
  const q = useQuery({ queryKey: ['anomalies', query], queryFn: () => api.get<AnomaliesResponse>(`/anomalies${query}`) });

  const groups = useMemo(() => {
    const m = new Map<AnomalyType, Anomaly[]>();
    for (const a of q.data?.anomalies ?? []) m.set(a.type, [...(m.get(a.type) ?? []), a]);
    const highs = (xs: Anomaly[]) => xs.filter((a) => a.severity === 'high').length;
    // groups with the most high-severity flags first; fixed type order breaks ties
    return TYPE_ORDER.filter((t) => m.has(t))
      .map((t) => ({ type: t, items: m.get(t)! }))
      .sort((a, b) => highs(b.items) - highs(a.items));
  }, [q.data]);

  const all = q.data?.anomalies ?? [];
  const openCount = all.filter((a) => a.review.status === 'open').length;

  return (
    <div className="space-y-4">
      <PageHeader title="Anomalies" subtitle="Explainable flags for officer review — every flag shows the rule, expected vs observed, and the underlying records" />

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        {user?.role === 'STATE_ADMIN' && (
          <Select label="District" value={districtId} onChange={(v) => setParam('districtId', v)} options={[{ value: '', label: 'All districts' }, ...(meta.data?.districts ?? []).map((x) => ({ value: String(x.id), label: x.name }))]} />
        )}
        <Select label="Type" value={type} onChange={(v) => setParam('type', v)} options={[{ value: '', label: 'All types' }, ...TYPE_ORDER.map((t) => ({ value: t, label: TYPE_META[t].label }))]} />
        <label className="mb-1.5 inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={showDismissed} onChange={(e) => setParam('dismissed', e.target.checked ? '1' : '')} className="h-4 w-4 accent-teal-600" />
          Show false positives
        </label>
        <div className="mb-1.5 ml-auto text-xs text-slate-500">
          <b className="text-navy-900">{openCount}</b> awaiting review · {all.length - openCount} reviewed
        </div>
      </div>

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data ? (
        <div className="grid gap-3 md:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-44" />)}</div>
      ) : groups.length === 0 ? (
        <Card><Empty title="No anomalies for these filters">Detected anomalies will appear here for review.</Empty></Card>
      ) : (
        groups.map((g) => {
          const M = TYPE_META[g.type];
          return (
            <section key={g.type}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-navy-900">
                <M.icon className="h-4 w-4 text-teal-600" /> {M.label}
                <span className="rounded-full bg-slate-200 px-1.5 text-[11px] font-medium text-slate-700">{g.items.length}</span>
                <span className="font-normal text-slate-500">— {M.blurb}</span>
              </h2>
              <div className="grid gap-3 xl:grid-cols-2">
                {g.items.map((a) => <AnomalyCard key={a.key} a={a} onOpen={() => setParam('key', a.key)} />)}
              </div>
            </section>
          );
        })
      )}

      {openKey && <AnomalyDrawer anomalyKey={openKey} onClose={() => setParam('key', '')} />}
    </div>
  );
}

function useReview(key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { status: ReviewStatus; note?: string }) => api.post(`/anomalies/${encodeURIComponent(key)}/review`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['anomalies'] });
      qc.invalidateQueries({ queryKey: ['anomaly', key] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      qc.invalidateQueries({ queryKey: ['district'] });
    },
  });
}

function ReviewControls({ a }: { a: Anomaly }) {
  const m = useReview(a.key);
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState<ReviewStatus | null>(null);
  if (a.review.status !== 'open')
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={cx('inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium', a.review.status === 'reviewed' ? 'bg-teal-50 text-teal-800' : 'bg-slate-100 text-slate-700')}>
          {a.review.status === 'reviewed' ? <CheckCheck className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
          {a.review.status === 'reviewed' ? 'Reviewed — confirmed' : 'Marked false positive'}
        </span>
        <span className="text-slate-500">by {a.review.by} · {a.review.at && fmtDate(a.review.at)}</span>
        {a.review.note && <span className="italic text-slate-600">“{a.review.note}”</span>}
        <button onClick={() => m.mutate({ status: 'open' })} className="inline-flex items-center gap-1 text-slate-500 hover:text-navy-900"><RotateCcw className="h-3 w-3" /> Reopen</button>
      </div>
    );
  if (asking)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={asking === 'reviewed' ? 'Action taken (optional)…' : 'Why is this a false positive? (optional)'} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-xs focus:border-teal-500 focus:outline-none" />
        <Button className="!px-2 !py-1 text-xs" disabled={m.isPending} onClick={() => m.mutate({ status: asking, note: note || undefined })}>Save</Button>
        <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setAsking(null)}>Cancel</Button>
      </div>
    );
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" className="!py-1 text-xs" onClick={() => setAsking('reviewed')}><CheckCheck className="h-3.5 w-3.5" /> Mark reviewed</Button>
      <Button variant="secondary" className="!py-1 text-xs" onClick={() => setAsking('false_positive')}><Ban className="h-3.5 w-3.5" /> False positive</Button>
      {m.isError && <span className="text-xs text-red-700">{(m.error as Error).message}</span>}
    </div>
  );
}

function AnomalyCard({ a, onOpen }: { a: Anomaly; onOpen: () => void }) {
  return (
    <article className={cx('flex flex-col rounded-xl border bg-white p-4 shadow-sm', a.review.status === 'false_positive' ? 'border-slate-200 opacity-70' : 'border-slate-200')} style={{ borderLeft: `4px solid ${SEV_COLOR[a.severity]}` }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-navy-900">{a.entityLabel}</div>
          <div className="text-xs text-slate-500">{a.metric}</div>
        </div>
        <SeverityBadge severity={a.severity} />
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate-700">{a.reason}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Expected</div>
          <div className="mt-0.5 font-medium text-slate-800">{a.expected}</div>
        </div>
        <div className="rounded-lg bg-red-50/60 px-3 py-2 ring-1 ring-red-100">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-red-700">Observed</div>
          <div className="mt-0.5 font-semibold text-slate-900">{a.observed}</div>
        </div>
      </div>
      <div className="mt-2 text-[11px] text-slate-500"><b className="font-medium text-slate-600">Method:</b> {a.method}</div>
      {a.amountAtRisk ? <div className="mt-1 text-xs font-medium text-red-800">{a.type === 'duplicate_beneficiary' ? 'Monthly payout to suspected duplicates' : 'Amount paid in error'}: {fmtINR(a.amountAtRisk)}</div> : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <ReviewControls a={a} />
        <CreateActionButton districtId={a.districtId} blockId={a.blockId ?? undefined} anomalyId={a.key} suggestedTitle={`Field check: ${a.typeLabel} — ${a.entityLabel}`} />
        <Button variant="ghost" className="!py-1 text-xs text-teal-700" onClick={onOpen}><TableProperties className="h-3.5 w-3.5" /> View records</Button>
      </div>
    </article>
  );
}

function AnomalyDrawer({ anomalyKey, onClose }: { anomalyKey: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['anomaly', anomalyKey], queryFn: () => api.get<AnomalyDetail>(`/anomalies/${encodeURIComponent(anomalyKey)}`) });
  const [benId, setBenId] = useState<number | null>(null);
  const d = q.data;
  const isSeries = d && d.records.length > 0 && 'month' in d.records[0] && 'window' in d.records[0];
  const benCols = new Set(['aId', 'bId', 'id']);
  return (
    <div className="fixed inset-0 z-[1500] flex justify-end bg-navy-950/40" onClick={onClose}>
      <div className="flex h-full w-full max-w-4xl flex-col bg-white shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Anomaly records">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          {d ? (
            <div>
              <div className="flex items-center gap-2"><SeverityBadge severity={d.anomaly.severity} /><span className="text-xs text-slate-500">{d.anomaly.typeLabel}</span></div>
              <h2 className="mt-1 text-base font-semibold text-navy-900">{d.anomaly.entityLabel}</h2>
              <p className="mt-1 text-sm text-slate-600">{d.anomaly.reason}</p>
            </div>
          ) : <div className="text-sm text-slate-500">Loading…</div>}
          <button onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button>
        </header>
        <div className="flex-1 overflow-auto p-5">
          {q.isError ? <ErrorState error={q.error} /> : !d ? <Loading /> : (
            <>
              <div className="mb-3"><ReviewControls a={d.anomaly} /></div>
              {isSeries && (
                <div className="mb-4 rounded-lg border border-slate-200 p-3">
                  <div className="mb-1 flex items-center gap-3 text-xs text-slate-600">
                    <span className="font-semibold text-navy-900">{d.anomaly.metric}</span>
                    <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-[#9ec5f4]" /> Baseline months</span>
                    <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SEV_COLOR.high }} /> Tested (latest 3)</span>
                  </div>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={d.records as { month: string; value: number; window: string }[]} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke={GRID} />
                      <XAxis dataKey="month" tickFormatter={fmtMonth} tick={{ fill: AXIS, fontSize: 10 }} axisLine={false} tickLine={false} interval={1} />
                      <YAxis tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <RTooltip labelFormatter={fmtMonth} />
                      <Bar dataKey="value" name={d.anomaly.metric} radius={[3, 3, 0, 0]}>
                        {d.records.map((r, i) => <Cell key={i} fill={r.window === 'Tested' ? SEV_COLOR.high : '#9ec5f4'} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="mb-2 text-xs text-slate-500">{d.records.length} records · names masked{d.columns.some((c) => benCols.has(c.key)) ? ' · click a record ID to open the full beneficiary view (access is audited)' : ''}</div>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                    <tr>{d.columns.map((c) => <th key={c.key} className="whitespace-nowrap px-3 py-2">{c.label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {d.records.map((r, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        {d.columns.map((c) => (
                          <td key={c.key} className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                            {benCols.has(c.key) && typeof r[c.key] === 'number' ? (
                              <button onClick={() => setBenId(r[c.key] as number)} className="font-mono text-teal-700 hover:underline">#{r[c.key]}</button>
                            ) : String(r[c.key] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
      {benId !== null && <BeneficiaryModal id={benId} onClose={() => setBenId(null)} />}
    </div>
  );
}
