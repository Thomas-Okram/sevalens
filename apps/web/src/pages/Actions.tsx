import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, ArrowLeft, ArrowRight, CalendarDays, CircleDashed, CircleDot, CheckCircle2, MapPin, ScanSearch, Trash2, UserRound } from 'lucide-react';
import type { ActionStatus, FieldAction } from '@sevalens/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useActions, useMeta } from '../lib/queries';
import { fmtDate } from '../lib/format';
import { Card, Empty, ErrorState, PageHeader, Select, Skeleton, cx } from '../components/ui';

const COLUMNS: { status: ActionStatus; label: string; icon: typeof CircleDot; accent: string }[] = [
  { status: 'open', label: 'Open', icon: CircleDot, accent: 'border-t-slate-400' },
  { status: 'in_progress', label: 'In progress', icon: CircleDashed, accent: 'border-t-amber-400' },
  { status: 'done', label: 'Done', icon: CheckCircle2, accent: 'border-t-teal-500' },
];
const ORDER = COLUMNS.map((c) => c.status);

export default function Actions() {
  const { user } = useAuth();
  const meta = useMeta();
  const q = useActions();
  const [districtId, setDistrictId] = useState('');
  const actions = (q.data?.actions ?? []).filter((a) => !districtId || a.districtId === Number(districtId));
  const overdue = actions.filter((a) => a.overdue).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Field actions"
        subtitle="Insights turned into assigned tasks — raise one from an anomaly card or a district brief's “Visit first”"
        actions={user?.role === 'STATE_ADMIN' && (
          <Select label="District" value={districtId} onChange={setDistrictId} options={[{ value: '', label: 'All districts' }, ...(meta.data?.districts ?? []).map((d) => ({ value: String(d.id), label: d.name }))]} />
        )}
      />
      {q.data && (
        <div className="text-xs text-slate-500">
          <b className="text-navy-900">{actions.filter((a) => a.status !== 'done').length}</b> open ·{' '}
          <b className={cx(overdue ? 'text-red-700' : 'text-navy-900')}>{overdue}</b> overdue · status changes are recorded in the audit log
        </div>
      )}

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <div className="grid gap-4 md:grid-cols-3">
          {COLUMNS.map((col) => {
            const items = actions.filter((a) => a.status === col.status);
            return (
              <section key={col.status} className={cx('flex flex-col rounded-xl border border-t-4 border-slate-200 bg-slate-50/70', col.accent)} aria-label={`${col.label} actions`}>
                <h2 className="flex items-center gap-2 px-3 py-2.5 text-sm font-semibold text-navy-900">
                  <col.icon className="h-4 w-4 text-slate-500" /> {col.label}
                  <span className="rounded-full bg-slate-200 px-1.5 text-[11px] font-medium text-slate-700">{q.data ? items.length : '–'}</span>
                </h2>
                <div className="flex-1 space-y-2 px-2 pb-2">
                  {!q.data ? (
                    Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-28" />)
                  ) : items.length === 0 ? (
                    <Card bodyClass="p-0"><Empty title="Nothing here" /></Card>
                  ) : (
                    items.map((a) => <ActionCard key={a.id} a={a} />)
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ActionCard({ a }: { a: FieldAction }) {
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const onSuccess = () => qc.invalidateQueries({ queryKey: ['actions'] });
  const move = useMutation({ mutationFn: (status: ActionStatus) => api.patch(`/actions/${a.id}`, { status }), onSuccess });
  const del = useMutation({ mutationFn: () => api.del(`/actions/${a.id}`), onSuccess });
  const i = ORDER.indexOf(a.status);
  const prev = ORDER[i - 1];
  const next = ORDER[i + 1];
  const busy = move.isPending || del.isPending;

  return (
    <article className={cx('rounded-lg border bg-white p-3 shadow-sm', a.overdue ? 'border-red-300 ring-1 ring-red-200' : 'border-slate-200', a.status === 'done' && 'opacity-80')}>
      <div className="flex items-start justify-between gap-2">
        <h3 className={cx('text-sm font-semibold text-navy-900', a.status === 'done' && 'line-through decoration-slate-400')}>{a.title}</h3>
        {a.overdue && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-800 ring-1 ring-inset ring-red-600/25">
            <AlarmClock className="h-3 w-3" /> Overdue
          </span>
        )}
      </div>
      <dl className="mt-2 space-y-1 text-xs text-slate-600">
        <div className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-slate-400" /><Link to={`/districts/${a.districtId}`} className="hover:underline">{a.districtName}</Link> · {a.blockName}</div>
        <div className="flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5 text-slate-400" />{a.assignedToName}</div>
        <div className={cx('flex items-center gap-1.5', a.overdue && 'font-semibold text-red-700')}><CalendarDays className={cx('h-3.5 w-3.5', a.overdue ? 'text-red-500' : 'text-slate-400')} />Due {fmtDate(a.dueDate)}</div>
        {a.anomalyId && (
          <div className="flex items-center gap-1.5"><ScanSearch className="h-3.5 w-3.5 text-slate-400" /><Link to={`/anomalies?districtId=${a.districtId}&key=${encodeURIComponent(a.anomalyId)}`} className="text-teal-700 hover:underline">Linked anomaly</Link></div>
        )}
      </dl>
      {a.notes && <p className="mt-2 rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-700">{a.notes}</p>}
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs">
        <div className="flex gap-1">
          {prev && (
            <button disabled={busy} onClick={() => move.mutate(prev)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-slate-600 hover:bg-slate-100 disabled:opacity-50" title={`Move to ${COLUMNS[i - 1].label}`}>
              <ArrowLeft className="h-3.5 w-3.5" /> {COLUMNS[i - 1].label}
            </button>
          )}
          {next && (
            <button disabled={busy} onClick={() => move.mutate(next)} className="inline-flex items-center gap-1 rounded-md bg-navy-900 px-1.5 py-1 font-medium text-white hover:bg-navy-800 disabled:opacity-50" title={`Move to ${COLUMNS[i + 1].label}`}>
              {COLUMNS[i + 1].label} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {confirmDelete ? (
          <span className="flex items-center gap-1">
            <button disabled={busy} onClick={() => del.mutate()} className="rounded-md px-1.5 py-1 font-medium text-red-700 hover:bg-red-50">Delete</button>
            <button onClick={() => setConfirmDelete(false)} className="rounded-md px-1.5 py-1 text-slate-500 hover:bg-slate-100">Keep</button>
          </span>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-red-700" aria-label="Delete action"><Trash2 className="h-3.5 w-3.5" /></button>
        )}
      </div>
      {(move.isError || del.isError) && <div className="mt-1 text-xs text-red-700">{((move.error ?? del.error) as Error).message}</div>}
      <div className="mt-1 text-[11px] text-slate-500">Raised by {a.createdByName} · {fmtDate(a.createdAt)}</div>
    </article>
  );
}
