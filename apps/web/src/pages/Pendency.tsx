import { useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { Download, AlertOctagon } from 'lucide-react';
import type { PendencyResponse } from '@sevalens/shared';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useMeta } from '../lib/queries';
import { fmtDate, fmtInt, fmtPct } from '../lib/format';
import { AXIS, GRID, SERIES, SEV_COLOR } from '../lib/theme';
import { Card, Empty, ErrorState, KpiTile, PageHeader, Select, Skeleton, Tip, cx } from '../components/ui';

// sequential single-hue ramp (light -> dark) for heatmap magnitude
const RAMP = ['#f1f5f9', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
const rampColor = (v: number, max: number) => (v === 0 ? RAMP[0] : RAMP[Math.min(RAMP.length - 1, 1 + Math.floor((Math.sqrt(v / max)) * (RAMP.length - 2)))]);

export default function Pendency() {
  const { user } = useAuth();
  const meta = useMeta();
  const [sp, setSp] = useSearchParams();
  const f = {
    districtId: sp.get('districtId') ?? '',
    blockId: sp.get('blockId') ?? '',
    schemeId: sp.get('schemeId') ?? '',
    stage: sp.get('stage') ?? '',
    breachedOnly: sp.get('breachedOnly') ?? '',
  };
  const set = (k: keyof typeof f, v: string) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v); else next.delete(k);
    if (k === 'districtId') next.delete('blockId');
    setSp(next, { replace: true });
  };
  const query = qs({ ...f, limit: 200 });
  const q = useQuery({ queryKey: ['pendency', query], queryFn: () => api.get<PendencyResponse>(`/pendency${query}`), placeholderData: keepPreviousData });

  const effectiveDistrict = user?.districtId ? String(user.districtId) : f.districtId;
  const blocks = (meta.data?.blocks ?? []).filter((b) => !effectiveDistrict || String(b.districtId) === effectiveDistrict);
  const d = q.data;
  const maxCell = Math.max(1, ...(d?.heatmap.flatMap((r) => r.buckets) ?? [1]));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pendency"
        subtitle="Where applications are stuck, for how long, and at which stage"
        actions={
          <a href={`/api/pendency/export.csv${query}`} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-navy-900 ring-1 ring-slate-300 hover:bg-slate-50">
            <Download className="h-4 w-4" /> Export CSV
          </a>
        }
      />

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        {user?.role === 'STATE_ADMIN' && (
          <Select label="District" value={f.districtId} onChange={(v) => set('districtId', v)} options={[{ value: '', label: 'All districts' }, ...(meta.data?.districts ?? []).map((x) => ({ value: String(x.id), label: x.name }))]} />
        )}
        <Select label="Block" value={f.blockId} onChange={(v) => set('blockId', v)} options={[{ value: '', label: 'All blocks' }, ...blocks.map((x) => ({ value: String(x.id), label: x.name }))]} />
        <Select label="Scheme" value={f.schemeId} onChange={(v) => set('schemeId', v)} options={[{ value: '', label: 'All schemes' }, ...(meta.data?.schemes ?? []).map((x) => ({ value: String(x.id), label: x.shortName }))]} />
        <Select label="Stage" value={f.stage} onChange={(v) => set('stage', v)} options={[{ value: '', label: 'All stages' }, ...Object.entries(meta.data?.stages ?? {}).map(([value, label]) => ({ value, label }))]} />
        <label className="mb-1.5 inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={f.breachedOnly === 'true'} onChange={(e) => set('breachedOnly', e.target.checked ? 'true' : '')} className="h-4 w-4 accent-teal-600" />
          Past SLA only
        </label>
        {q.isFetching && <span className="mb-2 text-xs text-slate-400">Updating…</span>}
      </div>

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !d ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[88px]" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiTile label="Open applications" value={fmtInt(d.summary.open)} sub={`${fmtInt(d.summary.trend.open90DaysAgo)} were open 90 days ago`} info="Applications not yet approved or rejected. The comparison reconstructs the open caseload as it stood 90 days before the data date." />
            <KpiTile label="Past SLA" value={fmtInt(d.summary.breached)} tone={d.summary.breachPct > 0.3 ? 'high' : d.summary.breachPct > 0.15 ? 'medium' : 'low'} sub={`${fmtPct(d.summary.breachPct)} of open · was ${fmtInt(d.summary.trend.breached90DaysAgo)}`} info="Open applications older than their scheme SLA (30 days; 45 for scholarships)." />
            <KpiTile label="Median age" value={`${d.summary.medianAgeDays} days`} sub="of open applications" info="Median days since submission across open applications." />
            <KpiTile label="Received (90 days)" value={fmtInt(d.summary.trend.received90)} sub={`previous 90 days: ${fmtInt(d.summary.trend.receivedPrev90)}${d.summary.trend.receivedPrev90 ? ` (${d.summary.trend.received90 >= d.summary.trend.receivedPrev90 ? '+' : ''}${fmtPct(d.summary.trend.received90 / d.summary.trend.receivedPrev90 - 1, 0)})` : ''}`} info="New applications submitted in the last 90 days vs the 90 days before that." />
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <Card className="lg:col-span-7" title="Ageing heatmap" subtitle="Open applications by block × age — darker = more cases" info="Each cell counts open applications in that block and age bucket. Rows sorted by SLA-breached cases. Shows the top 15 blocks." bodyClass="p-0">
              {d.heatmap.length === 0 ? <Empty title="No open applications match these filters" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-2 text-left">Block</th>
                        {d.bucketLabels.map((l, i) => <th key={l} className={cx('px-1 py-2 text-center', i >= 2 && 'text-red-700')}>{l}{i >= 2 && <AlertOctagon className="ml-0.5 inline h-3 w-3" />}</th>)}
                        <th className="px-3 py-2 text-right">Past SLA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.heatmap.slice(0, 15).map((r) => (
                        <tr key={r.blockId} className="border-t border-slate-100">
                          <td className="px-4 py-1.5">
                            <button onClick={() => set('blockId', String(r.blockId))} className="text-left hover:underline">
                              <span className="font-medium text-navy-900">{r.blockName}</span> <span className="text-[11px] text-slate-500">{r.districtName}</span>
                            </button>
                          </td>
                          {r.buckets.map((v, i) => (
                            <td key={i} className="px-1 py-1">
                              <Tip content={`${r.blockName}: ${v} open applications aged ${d.bucketLabels[i]}`} width={220} className="w-full">
                                <div className="flex h-8 w-full items-center justify-center rounded-md text-xs font-semibold tabular-nums" style={{ background: rampColor(v, maxCell), color: v / maxCell > 0.3 ? '#fff' : '#0f172a', border: '2px solid #fff' }}>
                                  {v || ''}
                                </div>
                              </Tip>
                            </td>
                          ))}
                          <td className={cx('px-3 py-1.5 text-right tabular-nums', r.breached >= 20 && 'font-semibold text-red-700')}>{r.breached}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card className="lg:col-span-5" title="Stage bottlenecks" subtitle="Where open applications are waiting" info="Open applications by current processing stage, split into within-SLA and past-SLA. The longest red bar is the bottleneck.">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={d.summary.stages.map((s) => ({ label: s.label, within: s.count - s.breached, breached: s.breached }))} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }} barCategoryGap={10}>
                  <CartesianGrid horizontal={false} stroke={GRID} />
                  <XAxis type="number" tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="label" width={120} tick={{ fill: '#334155', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <RTooltip cursor={{ fill: '#f1f5f9' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="within" name="Within SLA" stackId="a" fill={SERIES.primary} maxBarSize={24} />
                  <Bar dataKey="breached" name="Past SLA" stackId="a" fill={SEV_COLOR.high} radius={[0, 4, 4, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          <Card title="Stuck applications" subtitle={`Oldest first · showing ${Math.min(d.items.length, 200)} of ${fmtInt(d.total)}`} info="Applicant names are masked in list views. Export is logged in the audit trail." bodyClass="p-0">
            {d.items.length === 0 ? <Empty title="No applications match these filters" /> : (
              <div className="max-h-[480px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Application</th>
                      <th className="px-3 py-2">Applicant</th>
                      <th className="px-3 py-2">Scheme</th>
                      <th className="px-3 py-2">Block</th>
                      <th className="px-3 py-2">Submitted</th>
                      <th className="px-3 py-2 text-right">Age</th>
                      <th className="px-3 py-2">Stage</th>
                      <th className="px-3 py-2">SLA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((a) => (
                      <tr key={a.id} className="border-t border-slate-100">
                        <td className="px-4 py-1.5 font-mono text-xs text-slate-700">{a.refNo}</td>
                        <td className="px-3 py-1.5">{a.applicantMasked}</td>
                        <td className="px-3 py-1.5">{a.schemeName}</td>
                        <td className="px-3 py-1.5">{a.blockName} <span className="text-[11px] text-slate-500">{a.districtName}</span></td>
                        <td className="px-3 py-1.5 tabular-nums">{fmtDate(a.submittedAt)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{a.ageDays}d</td>
                        <td className="px-3 py-1.5">{a.stageLabel}</td>
                        <td className="px-3 py-1.5">
                          {a.breached ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700"><AlertOctagon className="h-3.5 w-3.5" /> +{a.ageDays - a.slaDays}d over</span>
                          ) : (
                            <span className="text-xs text-slate-500">{a.slaDays - a.ageDays}d left</span>
                          )}
                        </td>
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
