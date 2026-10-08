import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { TrendingUp } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useMeta } from '../lib/queries';
import { fmtInt } from '../lib/format';
import { AXIS, GRID, SERIES } from '../lib/theme';
import { Card, Empty, ErrorState, Select, Skeleton } from './ui';

// Mirrors PendencyForecast in apps/api/src/analytics/forecast.ts
interface SeriesPoint { date: string; value: number }
interface ForecastPoint { date: string; daysAhead: number; value: number; lower: number; upper: number }
interface SeriesForecast { alpha: number; beta: number; level: number; trend: number; sigma: number; points: ForecastPoint[] }
type ForecastResponse = { dataAsOf: string; areaName: string; actual: { open: SeriesPoint[]; breached: SeriesPoint[] } } & (
  | { ok: false; reason: string }
  | { ok: true; horizonDays: number; coverage: number; forecast: { open: SeriesForecast; breached: SeriesForecast }; summary: string; extraPerDay: number; method: string }
);

interface Row {
  date: string;
  forecast: boolean;
  open?: number;
  breached?: number;
  openF?: number;
  breachedF?: number;
  openBand?: [number, number];
  breachedBand?: [number, number];
}

const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function buildRows(f: ForecastResponse): Row[] {
  const rows: Row[] = f.actual.open.map((p, i) => ({ date: p.date, forecast: false, open: p.value, breached: f.actual.breached[i]?.value }));
  if (!f.ok || rows.length === 0) return rows;
  // Anchor the dashed lines and bands on the last actual point so they join the solid lines.
  const last = rows[rows.length - 1];
  Object.assign(last, { openF: last.open, breachedF: last.breached, openBand: [last.open, last.open], breachedBand: [last.breached, last.breached] });
  f.forecast.open.points.forEach((o, i) => {
    const b = f.forecast.breached.points[i];
    rows.push({ date: o.date, forecast: true, openF: Math.round(o.value), breachedF: Math.round(b.value), openBand: [Math.round(o.lower), Math.round(o.upper)], breachedBand: [Math.round(b.lower), Math.round(b.upper)] });
  });
  return rows;
}

function ForecastTooltip({ active, payload, label, f }: TooltipProps<number, string> & { f: Extract<ForecastResponse, { ok: true }> }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as Row;
  return (
    <div className="max-w-[300px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-semibold text-navy-900">{fmtDay(String(label))}{row.forecast ? ' · forecast' : ''}</div>
      {row.forecast ? (
        <>
          <div style={{ color: SERIES.primary }}>Open: ~{fmtInt(row.openF!)} <span className="text-slate-500">({Math.round(f.coverage * 100)}% range {fmtInt(row.openBand![0])}–{fmtInt(row.openBand![1])})</span></div>
          <div style={{ color: SERIES.secondary }}>Past SLA: ~{fmtInt(row.breachedF!)} <span className="text-slate-500">({fmtInt(row.breachedBand![0])}–{fmtInt(row.breachedBand![1])})</span></div>
          <div className="mt-1.5 border-t border-slate-100 pt-1.5 text-[11px] leading-snug text-slate-500">
            Holt's linear smoothing (past-SLA series: α = {f.forecast.breached.alpha}, β = {f.forecast.breached.beta}). The band is where we expect the true value {Math.round(f.coverage * 100)}% of the time, sized from past forecast errors. Assumes the current trend continues with no extra effort.
          </div>
        </>
      ) : (
        <>
          <div style={{ color: SERIES.primary }}>Open: {fmtInt(row.open ?? 0)}</div>
          <div style={{ color: SERIES.secondary }}>Past SLA: {fmtInt(row.breached ?? 0)}</div>
          <div className="mt-1 text-[11px] text-slate-500">Actual caseload on this date</div>
        </>
      )}
    </div>
  );
}

// Recharts' legend lists the band series by their data keys, so the legend is drawn here instead.
function ForecastLegend({ coverage }: { coverage: number }) {
  const line = (color: string, dashed?: boolean) => (
    <svg width="18" height="6" aria-hidden><line x1="0" y1="3" x2="18" y2="3" stroke={color} strokeWidth="2" strokeDasharray={dashed ? '5 3' : undefined} /></svg>
  );
  return (
    <div className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
      <span className="inline-flex items-center gap-1.5">{line(SERIES.primary)} Open applications</span>
      <span className="inline-flex items-center gap-1.5">{line(SERIES.secondary)} Past SLA</span>
      <span className="inline-flex items-center gap-1.5">{line('#64748b', true)} Forecast</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-slate-400/30" /> {Math.round(coverage * 100)}% range</span>
    </div>
  );
}

export function ForecastCard({ districtId }: { districtId: number }) {
  const meta = useMeta();
  const [blockId, setBlockId] = useState('');
  const q = useQuery({
    queryKey: ['forecast', districtId, blockId],
    queryFn: () => api.get<ForecastResponse>(`/forecast${qs({ districtId, blockId: blockId || undefined })}`),
  });
  const blocks = (meta.data?.blocks ?? []).filter((b) => b.districtId === districtId);
  const f = q.data;

  return (
    <Card
      title="60-day pendency forecast"
      subtitle={f ? `${f.areaName} · solid = actual, dashed = forecast, band = ${f.ok ? Math.round(f.coverage * 100) : 80}% prediction interval` : 'Loading…'}
      info={f?.ok ? f.method : "Holt's linear exponential smoothing on the open and past-SLA caseload at 30-day intervals, with an 80% prediction interval from past forecast errors."}
      actions={
        <Select
          label="Area"
          value={blockId}
          onChange={setBlockId}
          options={[{ value: '', label: 'Whole district' }, ...blocks.map((b) => ({ value: String(b.id), label: b.name }))]}
        />
      }
    >
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !f ? (
        <Skeleton className="h-[260px]" />
      ) : !f.ok ? (
        <Empty title="Not enough history to forecast">{f.reason}</Empty>
      ) : (
        <>
          <p className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <TrendingUp className="mt-0.5 h-4 w-4 shrink-0" />
            {f.summary}
          </p>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={buildRows(f)} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fill: AXIS, fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={36} />
              <YAxis tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <RTooltip content={<ForecastTooltip f={f} />} />
              <Area dataKey="openBand" stroke="none" fill={SERIES.primary} fillOpacity={0.15} legendType="none" isAnimationActive={false} />
              <Area dataKey="breachedBand" stroke="none" fill={SERIES.secondary} fillOpacity={0.15} legendType="none" isAnimationActive={false} />
              <Line dataKey="open" name="Open applications" stroke={SERIES.primary} strokeWidth={2} dot={false} />
              <Line dataKey="breached" name="Past SLA" stroke={SERIES.secondary} strokeWidth={2} dot={false} />
              <Line dataKey="openF" name="Open (forecast)" stroke={SERIES.primary} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2 }} legendType="none" />
              <Line dataKey="breachedF" name="Past SLA (forecast)" stroke={SERIES.secondary} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2 }} legendType="none" />
            </ComposedChart>
          </ResponsiveContainer>
          <ForecastLegend coverage={f.coverage} />
        </>
      )}
    </Card>
  );
}
