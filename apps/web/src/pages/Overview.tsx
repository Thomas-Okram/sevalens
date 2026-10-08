import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Users, UserCheck, Target, Hourglass, TimerOff, ScanSearch, ChevronRight } from 'lucide-react';
import type { Overview as OverviewT } from '@sevalens/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtInt, fmtPct } from '../lib/format';
import { Card, ErrorState, FactorBar, FactorLegend, InfoTip, KpiTile, PageHeader, ScorePill, Skeleton, cx } from '../components/ui';
import { ManipurMap } from '../components/ManipurMap';

export function useOverview() {
  return useQuery({ queryKey: ['overview'], queryFn: () => api.get<OverviewT>('/overview') });
}

export default function Overview() {
  const { user } = useAuth();
  const q = useOverview();
  const [level, setLevel] = useState<'district' | 'block'>('district');
  const navigate = useNavigate();

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const k = d?.kpis;
  const scope = user?.role === 'STATE_ADMIN' ? 'Manipur — all 16 districts' : `${user?.districtName} district (your jurisdiction)`;
  const ranked = d?.attention.filter((a) => a.entityType === level) ?? [];

  return (
    <div className="space-y-4">
      <PageHeader title="State overview" subtitle={`${scope} · 6 welfare schemes · coverage, pendency, anomalies and where to act first`} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {!k ? (
          Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[88px]" />)
        ) : (
          <>
            <KpiTile icon={<Users className="h-3.5 w-3.5" />} label="Est. eligible" value={fmtInt(k.eligible)} sub="across 6 schemes"
              info={<>Σ over blocks & schemes of <b>population × basis share × scheme factor</b> (e.g. old-age pension: population × % aged 60+ × BPL share). Census-2011-based estimates.</>} />
            <KpiTile icon={<UserCheck className="h-3.5 w-3.5" />} label="Enrolled" value={fmtInt(k.enrolled)} sub={`${fmtInt(k.gap)} eligible not yet reached`}
              info="Count of beneficiaries with status = active. Suspended and deceased records are excluded. Gap = Σ max(0, eligible − enrolled) per scheme × block." />
            <KpiTile icon={<Target className="h-3.5 w-3.5" />} label="Coverage" value={fmtPct(k.coverage)} tone={k.coverage < 0.6 ? 'high' : k.coverage < 0.8 ? 'medium' : 'low'} sub="enrolled ÷ est. eligible"
              info="Coverage = active beneficiaries ÷ estimated eligible. Below 60% is flagged high, 60–80% medium." />
            <KpiTile icon={<Hourglass className="h-3.5 w-3.5" />} label="Open apps" value={fmtInt(k.openApplications)} sub="awaiting a decision"
              info="Applications with status submitted, verified or pending (not yet approved/rejected) as of the data date." />
            <KpiTile icon={<TimerOff className="h-3.5 w-3.5" />} label="SLA breach" value={fmtPct(k.breachPct)} tone={k.breachPct > 0.3 ? 'high' : k.breachPct > 0.15 ? 'medium' : 'low'} sub={`${fmtInt(k.breached)} cases past SLA`}
              info="Open applications older than their scheme's processing SLA (30 days for pensions & maternity, 45 for scholarships) ÷ all open applications." />
            <KpiTile icon={<ScanSearch className="h-3.5 w-3.5" />} label="Anomalies" value={fmtInt(k.activeAnomalies)} tone={k.highAnomalies > 0 ? 'high' : k.activeAnomalies > 0 ? 'medium' : 'low'} sub={`${k.highAnomalies} high severity`}
              info="Anomalies not yet reviewed by an officer: duplicates, payments after death, robust-z spikes (|z| > 3.5), officer outliers and SLA backlogs." />
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-6" title="Manipur — coverage gap & attention" info="Each circle is a district HQ. Size = estimated eligible people not enrolled (gap). Colour + legend = Attention Score level. Click a circle to drill down." bodyClass="p-3">
          {d ? <ManipurMap districts={d.districts} /> : <Skeleton className="h-[420px]" />}
        </Card>

        <Card
          className="lg:col-span-6"
          title="Areas needing attention"
          info={<>Attention Score (0–100) = 100 × Σ weight × normalised factor. Weights: coverage gap 30%, SLA breach 20%, anomalies 20%, payment failures 15%, remoteness 15%. Hover a bar for the full breakdown. ≥ 45 high, ≥ 30 medium.</>}
          actions={
            <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
              {(['district', 'block'] as const).map((l) => (
                <button key={l} onClick={() => setLevel(l)} className={cx('rounded-md px-2.5 py-1', level === l ? 'bg-white text-navy-900 shadow-sm' : 'text-slate-500')}>
                  {l === 'district' ? 'Districts' : 'Blocks'}
                </button>
              ))}
            </div>
          }
          bodyClass="p-0"
        >
          {!d ? (
            <div className="space-y-2 p-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-9" />)}</div>
          ) : (
            <>
              <div className="max-h-[392px] overflow-y-auto">
                <table className="w-full table-fixed text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="w-8 px-3 py-2">#</th>
                      <th className="w-[32%] px-2 py-2">Area</th>
                      <th className="w-[100px] px-2 py-2">Score</th>
                      <th className="px-3 py-2">Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.slice(0, 30).map((a, i) => (
                      <tr key={`${a.entityType}-${a.entityId}`} onClick={() => navigate(`/districts/${a.districtId}`)} className="cursor-pointer border-t border-slate-100 hover:bg-teal-50/40">
                        <td className="px-3 py-2 text-xs tabular-nums text-slate-400">{i + 1}</td>
                        <td className="px-2 py-2">
                          <div className="truncate font-medium text-navy-900">{a.name}</div>
                          {a.entityType === 'block' && <div className="text-[11px] text-slate-500">{a.districtName}</div>}
                        </td>
                        <td className="px-2 py-2"><ScorePill score={a.score} level={a.level} /></td>
                        <td className="px-3 py-2">
                          <FactorBar attention={a} />
                          <div className="mt-1 truncate text-[11px] text-slate-500" title={a.topReason}>{a.topReason}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-slate-100 px-4 py-2"><FactorLegend /></div>
            </>
          )}
        </Card>
      </div>

      <Card title="District scorecard" subtitle="Click a district to open its drill-down" info="All figures computed server-side from the synthetic dataset. Payment failure rate = failed + returned ÷ all disbursements in the last 3 months." bodyClass="p-0">
        {!d ? <Skeleton className="m-4 h-40" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">District</th>
                  <th className="px-3 py-2 text-right">Est. eligible</th>
                  <th className="px-3 py-2 text-right">Enrolled</th>
                  <th className="px-3 py-2">Coverage</th>
                  <th className="px-3 py-2 text-right">Gap</th>
                  <th className="px-3 py-2 text-right">Open apps</th>
                  <th className="px-3 py-2 text-right">SLA breach</th>
                  <th className="px-3 py-2 text-right">Pay failures</th>
                  <th className="px-3 py-2 text-right">Anomalies</th>
                  <th className="px-3 py-2">Attention</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...d.districts].sort((a, b) => b.attention.score - a.attention.score).map((x) => (
                  <tr key={x.id} className="border-t border-slate-100 hover:bg-teal-50/40">
                    <td className="px-4 py-2 font-medium text-navy-900"><Link to={`/districts/${x.id}`} className="hover:underline">{x.name}</Link></td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtInt(x.coverage.eligible)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtInt(x.coverage.enrolled)}</td>
                    <td className="px-3 py-2"><CoverageMini value={x.coverage.coverage} /></td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtInt(x.coverage.gap)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtInt(x.openApplications)}</td>
                    <td className={cx('px-3 py-2 text-right tabular-nums', x.breachPct > 0.3 && 'font-semibold text-red-700')}>{fmtPct(x.breachPct, 0)}</td>
                    <td className={cx('px-3 py-2 text-right tabular-nums', x.failureRate > 0.08 && 'font-semibold text-red-700')}>{fmtPct(x.failureRate)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{x.anomalyCount}</td>
                    <td className="px-3 py-2"><ScorePill score={x.attention.score} level={x.attention.level} /></td>
                    <td className="pr-3"><Link to={`/districts/${x.id}`} aria-label={`Open ${x.name}`}><ChevronRight className="h-4 w-4 text-slate-400" /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export function CoverageMini({ value }: { value: number }) {
  const tone = value < 0.6 ? '#d03b3b' : value < 0.8 ? '#fab219' : '#0ca30c';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, value * 100)}%`, background: tone }} />
      </div>
      <span className={cx('text-xs tabular-nums', value < 0.6 && 'font-semibold text-red-700')}>{fmtPct(value, 0)}</span>
      {value < 0.6 && <InfoTip content="Below 60% of estimated eligible population enrolled — high coverage gap." width={220} />}
    </div>
  );
}
