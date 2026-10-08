import { useQuery } from '@tanstack/react-query';
import { X, ShieldAlert } from 'lucide-react';
import type { BeneficiaryView } from '@sevalens/shared';
import { api } from '../lib/api';
import { fmtDate, fmtINR } from '../lib/format';
import { ErrorState, Loading, cx } from './ui';

export function BeneficiaryModal({ id, onClose }: { id: number; onClose: () => void }) {
  const q = useQuery({ queryKey: ['beneficiary', id], queryFn: () => api.get<BeneficiaryView>(`/beneficiaries/${id}`), staleTime: 0, gcTime: 0 });
  const b = q.data;
  return (
    <div className="fixed inset-0 z-[1800] flex items-center justify-center bg-navy-950/50 p-4" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Beneficiary detail">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-navy-900">Beneficiary #{id}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button>
        </header>
        <div className="max-h-[calc(90vh-52px)] overflow-y-auto p-5">
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
            <ShieldAlert className="h-4 w-4 shrink-0" /> Full record view. This access has been recorded in the audit log. (Synthetic person.)
          </div>
          {q.isError ? <ErrorState error={q.error} /> : !b ? <Loading /> : (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {[
                  ['Name', b.name], ['Aadhaar', b.aadhaarMasked], ['Gender', b.gender], ['Date of birth', `${fmtDate(b.dob)} (${b.age} yrs)`],
                  ['District', b.districtName], ['Block', b.blockName], ['Village', b.village], ['Scheme', `${b.schemeName} (${b.schemeCode})`],
                  ['Status', b.status], ['Enrolled', fmtDate(b.enrolledAt)], ...(b.deceasedAt ? [['Recorded death', fmtDate(b.deceasedAt)]] : []),
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[11px] font-medium text-slate-500">{k}</dt>
                    <dd className={cx('font-medium text-slate-800', k === 'Status' && v === 'deceased' && 'text-red-700')}>{v}</dd>
                  </div>
                ))}
              </dl>
              <h3 className="mb-1 mt-4 text-xs font-semibold text-navy-900">Payments ({b.payments.length})</h3>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-left text-[10px] uppercase text-slate-500"><tr><th className="px-3 py-1.5">Month</th><th className="px-3 py-1.5">Amount</th><th className="px-3 py-1.5">Status</th><th className="px-3 py-1.5">Paid on</th></tr></thead>
                  <tbody>
                    {b.payments.map((p) => {
                      const afterDeath = b.deceasedAt && p.status === 'success' && p.paidAt > b.deceasedAt;
                      return (
                        <tr key={p.month + p.paidAt} className={cx('border-t border-slate-100', afterDeath && 'bg-red-50')}>
                          <td className="px-3 py-1">{p.month}</td>
                          <td className="px-3 py-1 tabular-nums">{fmtINR(p.amount)}</td>
                          <td className={cx('px-3 py-1', p.status !== 'success' && 'font-medium text-red-700')}>{p.status}</td>
                          <td className="px-3 py-1">{fmtDate(p.paidAt.slice(0, 10))}{afterDeath && <span className="ml-1 font-semibold text-red-700">· after death</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
