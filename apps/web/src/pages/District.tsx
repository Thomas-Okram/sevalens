import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis, Legend } from 'recharts';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import type { DistrictDetail } from '@sevalens/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useMeta } from '../lib/queries';
import { fmtInt, fmtMonth, fmtPct, fmtINR } from '../lib/format';
import { AXIS, FACTOR_COLOR, GRID, SERIES, SEV_COLOR } from '../lib/theme';
import { Card, Empty, ErrorState, FactorBar, KpiTile, Loading, PageHeader, ScorePill, Select, SeverityBadge, Skeleton, cx } from '../components/ui';
import { CoverageMini, useOverview } from './Overview';
import { BriefPanel } from '../components/BriefPanel';

const BUCKET_COLORS = ['#86b6ef', '#2a78d6', '#fab219', '#d03b3b'];

export function DistrictIndex() {
  const { user } = useAuth();
  const o = useOverview();
  if (user?.districtId) return <Navigate to={`/districts/${user.districtId}`} replace />;
  if (o.isError) return <ErrorState error={o.error} />;
  if (!o.data) return <Loading />;
  const top = [...o.data.districts].sort((a, b) => b.attention.score - a.attention.score)[0];
  return <Navigate to={`/districts/${top.id}`} replace />;
}

export default function District() {
  const id = Number(useParams().id);
  const { user } = useAuth();
  const meta = useMeta();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['district', id], queryFn: () => api.get<DistrictDetail>(`/districts/${id}`), enabled: Number.isFinite(id) });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const dist = d?.district;

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {user?.role === 'STATE_ADMIN' && <Link to="/" className="rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-navy-900" aria-label="Back to overview"><ArrowLeft className="h-4 w-4" /></Link>}
            {dist?.name ?? '…'} district
            {dist && <ScorePill score={dist.attention.score} level={dist.attention.level} />}
          </span>
        }
        subtitle={dist ? `Population ≈ ${fmtInt(dist.population)} (estimate) · ${d!.blocks.length} blocks · remoteness index ${dist.remoteness.toFixed(2)}` : 'Loading…'}
        actions={
          user?.role === 'STATE_ADMIN' && meta.data ? (
            <Select label="Switch district" value={String(id)} onChange={(v) => navigate(`/districts/${v}`)} options={meta.data.districts.map((x) => ({ value: String(x.id), label: x.name }))} />
          ) : undefined
        }
      />

      {!d || !dist ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[88px]" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <KpiTile label="Coverage" value={fmtPct(dist.coverage.coverage)} tone={dist.coverage.coverage < 0.6 ? 'high' : dist.coverage.coverage < 0.8 ? 'medium' : 'low'} sub={`${fmtInt(dist.coverage.enrolled)} of ${fmtInt(dist.coverage.eligible)} est. eligible`} info="Active beneficiaries ÷ estimated eligible, summed across the 6 schemes and all blocks in the district." />
            <KpiTile label="Coverage gap" value={fmtInt(dist.coverage.gap)} sub="eligible people not enrolled" info="Σ max(0, estimated eligible − active enrolled) per scheme × block." />
            <KpiTile label="Open applications" value={fmtInt(dist.openApplications)} sub={`${fmtInt(d.pendency.trend.open90DaysAgo)} open 90 days ago`} info="Applications awaiting a decision as of the data date; comparison counts applications that were open exactly 90 days earlier." />
            <KpiTile label="SLA breach" value={fmtPct(dist.breachPct)} tone={dist.breachPct > 0.3 ? 'high' : dist.breachPct > 0.15 ? 'medium' : 'low'} sub={`${fmtInt(dist.breached)} past SLA · median age ${d.pendency.medianAgeDays}d`} info="Open applications older than the scheme SLA ÷ all open applications." />
            <KpiTile label="Payment failures" value={fmtPct(dist.failureRate)} tone={dist.failureRate > 0.08 ? 'high' : dist.failureRate > 0.04 ? 'medium' : 'low'} sub="failed + returned, last 3 months" info="(failed + returned disbursements) ÷ all disbursements in the last 3 complete months." />
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <Card className="lg:col-span-5" title={`Why is ${dist.name} ${dist.attention.level === 'high' ? 'red' : dist.attention.level === 'medium' ? 'amber' : 'green'}?`} subtitle={`Attention Score ${dist.attention.score}/100 — factor breakdown`} info="Score = Σ (weight × normalised factor × 100). Each factor is normalised on a fixed scale so scores are comparable over time. Weights are configurable in one place (see Data & privacy).">
              <div className="space-y-3">
                {dist.attention.factors.map((f) => (
                  <div key={f.key}>
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="flex items-center gap-1.5 font-medium text-slate-700">
                        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: FACTOR_COLOR[f.key] }} />
                        {f.label} <span className="font-normal text-slate-400">· weight {Math.round(f.weight * 100)}%</span>
                      </span>
                      <span className="font-semibold tabular-nums text-navy-900">+{f.points.toFixed(1)}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full" style={{ width: `${f.normalized * 100}%`, background: FACTOR_COLOR[f.key] }} />
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">{f.rawLabel}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="lg:col-span-7" title="Scheme-wise coverage" info="Active beneficiaries ÷ estimated eligible per scheme. Dashed line = 80% target. Bar colour + label show the level (red < 60%, amber 60–80%, green ≥ 80%).">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={dist.coverage.bySchemes.map((c) => ({ ...c, pct: +(c.coverage * 100).toFixed(1) }))} layout="vertical" margin={{ left: 8, right: 48, top: 4, bottom: 4 }} barCategoryGap={8}>
                  <CartesianGrid horizontal={false} stroke={GRID} />
                  <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="schemeName" width={150} tick={{ fill: '#334155', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <RTooltip cursor={{ fill: '#f1f5f9' }} formatter={(_v, _n, p) => [`${fmtPct(p.payload.coverage)} (${fmtInt(p.payload.enrolled)} of ${fmtInt(p.payload.eligible)}; gap ${fmtInt(p.payload.gap)})`, 'Coverage']} />
                  <ReferenceLine x={80} stroke="#94a3b8" strokeDasharray="4 3" />
                  <Bar dataKey="pct" radius={[0, 4, 4, 0]} maxBarSize={22}>
                    {dist.coverage.bySchemes.map((c) => <Cell key={c.schemeId} fill={c.coverage < 0.6 ? SEV_COLOR.high : c.coverage < 0.8 ? SEV_COLOR.medium : SEV_COLOR.low} />)}
                    <LabelList dataKey="pct" position="right" formatter={(v: number) => `${v}%`} style={{ fill: '#334155', fontSize: 11, fontWeight: 600 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          <BriefPanel districtId={dist.id} districtName={dist.name} />

          <Card title="Blocks" subtitle="Ranked by Attention Score — hover the bar for the breakdown" bodyClass="p-0" info="Block figures use the block's share of district population for eligibility estimates.">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Block</th>
                    <th className="px-3 py-2">Coverage</th>
                    <th className="px-3 py-2 text-right">Gap</th>
                    <th className="px-3 py-2 text-right">Open</th>
                    <th className="px-3 py-2 text-right">Past SLA</th>
                    <th className="px-3 py-2 text-right">Pay failures</th>
                    <th className="px-3 py-2 text-right">Anomalies</th>
                    <th className="px-3 py-2">Attention</th>
                    <th className="w-[22%] px-3 py-2">Breakdown</th>
                  </tr>
                </thead>
                <tbody>
                  {[...d.blocks].sort((a, b) => b.attention.score - a.attention.score).map((b) => (
                    <tr key={b.id} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-medium text-navy-900">{b.name}</td>
                      <td className="px-3 py-2"><CoverageMini value={b.coverage.coverage} /></td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtInt(b.coverage.gap)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{b.openApplications}</td>
                      <td className={cx('px-3 py-2 text-right tabular-nums', b.breached >= 20 && 'font-semibold text-red-700')}>{b.breached}</td>
                      <td className={cx('px-3 py-2 text-right tabular-nums', b.failureRate > 0.08 && 'font-semibold text-red-700')}>{fmtPct(b.failureRate)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{b.anomalyCount}</td>
                      <td className="px-3 py-2"><ScorePill score={b.attention.score} level={b.attention.level} /></td>
                      <td className="px-3 py-2"><FactorBar attention={b.attention} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-12">
            <Card className="lg:col-span-4" title="Pendency ageing" subtitle={`${fmtInt(d.pendency.open)} open applications`} info="Open applications by days since submission. SLA for most schemes is 30 days, so the two right-hand buckets are breaches.">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={d.pendency.buckets} margin={{ top: 16, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 10 }} axisLine={false} tickLine={false} interval={0} />
                  <YAxis tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <RTooltip cursor={{ fill: '#f1f5f9' }} formatter={(v: number) => [fmtInt(v), 'Open applications']} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={44}>
                    {d.pendency.buckets.map((_, i) => <Cell key={i} fill={BUCKET_COLORS[i]} />)}
                    <LabelList dataKey="count" position="top" style={{ fill: '#334155', fontSize: 11, fontWeight: 600 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card className="lg:col-span-4" title="Applications per month" subtitle="Received vs decided" info="Received = applications submitted in the month. Decided = approved + rejected in the month. A widening gap means a growing backlog.">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={d.monthly.map((m) => ({ ...m, decided: m.approved + m.rejected }))} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="month" tickFormatter={fmtMonth} tick={{ fill: AXIS, fontSize: 10 }} axisLine={false} tickLine={false} interval={2} />
                  <YAxis tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <RTooltip labelFormatter={fmtMonth} />
                  <Legend iconType="plainline" wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="received" name="Received" stroke={SERIES.primary} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="decided" name="Decided" stroke={SERIES.secondary} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
            <Card className="lg:col-span-4" title="Payment failure rate" subtitle="Failed + returned ÷ all disbursements" info="Monthly disbursement failure rate. A sudden rise usually points to bank/account seeding issues or a PFMS batch failure.">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={d.monthly.map((m) => ({ ...m, pct: +(m.failureRate * 100).toFixed(2) }))} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="month" tickFormatter={fmtMonth} tick={{ fill: AXIS, fontSize: 10 }} axisLine={false} tickLine={false} interval={2} />
                  <YAxis tickFormatter={(v) => `${v}%`} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <RTooltip labelFormatter={fmtMonth} formatter={(v: number, _n, p) => [`${v}% (${fmtInt(p.payload.failed)} of ${fmtInt(p.payload.disbursed)})`, 'Failure rate']} />
                  <Line type="monotone" dataKey="pct" name="Failure rate" stroke={SERIES.primary} strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
          </div>

          <Card title="Anomalies in this district" subtitle={`${d.anomalies.length} detected`} bodyClass="p-0" actions={<Link to={`/anomalies?districtId=${dist.id}`} className="text-xs font-medium text-teal-700 hover:underline">Review all →</Link>}>
            {d.anomalies.length === 0 ? <Empty title="No anomalies detected">Nothing unusual in the current data.</Empty> : (
              <ul className="divide-y divide-slate-100">
                {d.anomalies.map((a) => (
                  <li key={a.key}>
                    <Link to={`/anomalies?key=${encodeURIComponent(a.key)}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-teal-50/40">
                      <SeverityBadge severity={a.severity} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-navy-900">{a.typeLabel} <span className="font-normal text-slate-500">· {a.entityLabel}</span></div>
                        <div className="truncate text-xs text-slate-500">{a.observed}{a.amountAtRisk && a.type === 'duplicate_beneficiary' ? ` · ${fmtINR(a.amountAtRisk)}/month to suspected duplicates` : ''}</div>
                      </div>
                      {a.review.status !== 'open' && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{a.review.status === 'reviewed' ? 'Reviewed' : 'False positive'}</span>}
                      <ChevronRight className="h-4 w-4 text-slate-400" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
