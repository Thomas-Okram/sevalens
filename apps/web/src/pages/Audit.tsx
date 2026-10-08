import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import type { AuditEntry } from '@sevalens/shared';
import { api } from '../lib/api';
import { Button, Card, Empty, ErrorState, Loading, PageHeader, Select } from '../components/ui';

const ACTION_LABEL: Record<string, string> = {
  'auth.login': 'Signed in', 'auth.logout': 'Signed out', 'auth.login_failed': 'Failed sign-in',
  'beneficiary.view': 'Viewed beneficiary record', 'ai.brief_generated': 'Generated officer brief', 'ai.ask': 'Asked SevaLens',
  'export.pendency_csv': 'Exported pendency CSV', 'anomaly.review': 'Reviewed anomaly',
};

export default function Audit() {
  const [action, setAction] = useState('');
  const q = useQuery({ queryKey: ['audit'], queryFn: () => api.get<{ entries: AuditEntry[] }>('/audit?limit=500'), refetchInterval: 15_000 });
  const entries = (q.data?.entries ?? []).filter((e) => !action || e.action === action);
  const actions = [...new Set((q.data?.entries ?? []).map((e) => e.action))];
  return (
    <div className="space-y-4">
      <PageHeader title="Audit log" subtitle="Every sign-in, record view, AI use, export and review — visible to state admins only"
        actions={<Button variant="secondary" onClick={() => q.refetch()}><RefreshCw className="h-4 w-4" /> Refresh</Button>} />
      <Card bodyClass="p-0" title="Recent activity" subtitle="Latest 500 entries" actions={<Select label="" value={action} onChange={setAction} options={[{ value: '', label: 'All actions' }, ...actions.map((a) => ({ value: a, label: ACTION_LABEL[a] ?? a }))]} />}>
        {q.isError ? <div className="p-4"><ErrorState error={q.error} /></div> : !q.data ? <Loading /> : entries.length === 0 ? <Empty title="No audit entries" /> : (
          <div className="max-h-[65vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-2">Time</th><th className="px-3 py-2">User</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Target</th><th className="px-3 py-2">Details</th></tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100 align-top">
                    <td className="whitespace-nowrap px-4 py-1.5 tabular-nums text-slate-600">{new Date(e.ts).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium' })}</td>
                    <td className="px-3 py-1.5">{e.userEmail ?? '—'}</td>
                    <td className="px-3 py-1.5 font-medium text-navy-900">{ACTION_LABEL[e.action] ?? e.action}</td>
                    <td className="px-3 py-1.5 text-slate-600">{e.entity ? `${e.entity}${e.entityId ? ` #${e.entityId}` : ''}` : '—'}</td>
                    <td className="max-w-md truncate px-3 py-1.5 font-mono text-[11px] text-slate-500" title={e.details ?? ''}>{e.details ?? ''}</td>
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
