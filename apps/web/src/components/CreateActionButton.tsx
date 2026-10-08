import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardPlus, Loader2, X } from 'lucide-react';
import type { FieldAction } from '@sevalens/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useActions, useMeta } from '../lib/queries';
import { Button, cx } from './ui';

interface Props {
  districtId: number;
  blockId?: number;
  /** Anomaly key the action is raised from. */
  anomalyId?: string;
  suggestedTitle: string;
  className?: string;
}

/** Turns an insight into an assigned field action. */
export function CreateActionButton({ className, ...props }: Props) {
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<FieldAction | null>(null);
  if (created)
    return (
      <Link to="/actions" className={cx('inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-teal-800 hover:bg-teal-50', className)}>
        <CheckCircle2 className="h-3.5 w-3.5" /> Action #{created.id} assigned to {created.assignedToName}
      </Link>
    );
  return (
    <>
      <Button variant="secondary" className={cx('!py-1 text-xs', className)} onClick={() => setOpen(true)}>
        <ClipboardPlus className="h-3.5 w-3.5" /> Create action
      </Button>
      {open && <CreateActionModal {...props} onClose={() => setOpen(false)} onCreated={(a) => { setOpen(false); setCreated(a); }} />}
    </>
  );
}

const inputCls = 'rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20';
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function CreateActionModal({ districtId, blockId, anomalyId, suggestedTitle, onClose, onCreated }: Omit<Props, 'className'> & { onClose: () => void; onCreated: (a: FieldAction) => void }) {
  const { user } = useAuth();
  const meta = useMeta();
  const actions = useActions();
  const qc = useQueryClient();
  const blocks = (meta.data?.blocks ?? []).filter((b) => b.districtId === districtId);
  const assignees = (actions.data?.assignees ?? []).filter((u) => u.districtId === null || u.districtId === districtId);
  // default assignee: the district's own officer if there is one, else the current user
  const defaultAssignee = assignees.find((u) => u.districtId === districtId)?.id ?? user?.id;
  const [title, setTitle] = useState(suggestedTitle.slice(0, 200));
  const [block, setBlock] = useState<number | undefined>(blockId);
  const [assignee, setAssignee] = useState<number | undefined>();
  const [due, setDue] = useState(inDays(7));
  const [notes, setNotes] = useState('');
  const effBlock = block ?? blocks[0]?.id;
  const effAssignee = assignee ?? defaultAssignee;

  const m = useMutation({
    mutationFn: () => api.post<{ action: FieldAction }>('/actions', { districtId, blockId: effBlock, anomalyId: anomalyId ?? null, title, assignedToUserId: effAssignee, dueDate: due, notes: notes || null }),
    onSuccess: ({ action }) => {
      qc.invalidateQueries({ queryKey: ['actions'] });
      onCreated(action);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  const districtName = meta.data?.districts.find((d) => d.id === districtId)?.name;

  return (
    <div className="fixed inset-0 z-[1800] flex items-center justify-center bg-navy-950/50 p-4" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <form onSubmit={submit} className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Create field action">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-navy-900">Create field action</h2>
            <p className="text-xs text-slate-500">{districtName}{anomalyId ? ` · from anomaly ${anomalyId}` : ''}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button>
        </header>
        <div className="space-y-3 p-5">
          <label className="flex flex-col gap-0.5 text-[11px] font-medium text-slate-500">
            Title
            <input autoFocus required minLength={3} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-0.5 text-[11px] font-medium text-slate-500">
              Block
              <select required value={effBlock ?? ''} onChange={(e) => setBlock(Number(e.target.value))} className={inputCls}>
                {blocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-0.5 text-[11px] font-medium text-slate-500">
              Due date
              <input type="date" required value={due} onChange={(e) => setDue(e.target.value)} className={inputCls} />
            </label>
          </div>
          <label className="flex flex-col gap-0.5 text-[11px] font-medium text-slate-500">
            Assign to
            <select required value={effAssignee ?? ''} onChange={(e) => setAssignee(Number(e.target.value))} className={inputCls}>
              {assignees.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === user?.id ? ' (you)' : ''}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] font-medium text-slate-500">
            Notes (optional)
            <textarea rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="What should the field team check or do?" />
          </label>
          {m.isError && <div className="text-xs text-red-700">{(m.error as Error).message}</div>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={m.isPending || !effBlock || !effAssignee}>
            {m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardPlus className="h-4 w-4" />} Create action
          </Button>
        </footer>
      </form>
    </div>
  );
}
