import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, MapPinned, Hourglass, ScanSearch, MessageSquareText, ShieldCheck, ScrollText, LogOut, Database, UploadCloud } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useMeta } from '../lib/queries';
import { fmtDate } from '../lib/format';
import { ErrorBoundary, SyntheticBadge, Tip, cx } from './ui';

export function Logo({ light }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="8" fill={light ? '#ffffff14' : '#0B1F3A'} />
        <circle cx="14" cy="14" r="7" fill="none" stroke="#14B8A6" strokeWidth="3" />
        <path d="M19 19l6 6" stroke="#14B8A6" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <div className="leading-tight">
        <div className={cx('text-[15px] font-semibold tracking-tight', light ? 'text-white' : 'text-navy-900')}>SevaLens</div>
        <div className={cx('text-[10px]', light ? 'text-slate-300' : 'text-slate-500')}>Welfare Coverage Intelligence</div>
      </div>
    </div>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const meta = useMeta();
  const loc = useLocation();
  const nav = [
    { to: '/', label: 'State overview', icon: LayoutDashboard, end: true, show: true },
    { to: user?.districtId ? `/districts/${user.districtId}` : '/districts', label: user?.districtId ? `${user.districtName} district` : 'District drill-down', icon: MapPinned, show: true },
    { to: '/pendency', label: 'Pendency', icon: Hourglass, show: true },
    { to: '/anomalies', label: 'Anomalies', icon: ScanSearch, show: true },
    { to: '/ask', label: 'Ask SevaLens', icon: MessageSquareText, show: true },
    { to: '/privacy', label: 'Data & privacy', icon: ShieldCheck, show: true },
    { to: '/ingest', label: 'Data ingest', icon: UploadCloud, show: user?.role === 'STATE_ADMIN' },
    { to: '/audit', label: 'Audit log', icon: ScrollText, show: user?.role === 'STATE_ADMIN' },
  ];
  return (
    <div className="flex h-full">
      <aside className="hidden w-56 shrink-0 flex-col bg-navy-900 text-slate-200 md:flex">
        <div className="px-4 py-4">
          <Logo light />
        </div>
        <nav className="flex-1 space-y-0.5 px-2">
          {nav.filter((n) => n.show).map((n) => (
            <NavLink
              key={n.label}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cx('flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors', isActive || (n.to === '/districts' && loc.pathname.startsWith('/districts')) ? 'bg-white/10 text-white shadow-[inset_3px_0_0_#14B8A6]' : 'text-slate-300 hover:bg-white/5 hover:text-white')
              }
            >
              <n.icon className="h-4 w-4" /> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-2 border-t border-white/10 px-4 py-3 text-[11px] text-slate-400">
          <div>Social Welfare Department</div>
          <div>Government of Manipur · AI4SEVA SW-04</div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4">
          <div className="flex items-center gap-3">
            <div className="md:hidden"><Logo /></div>
            <SyntheticBadge />
            {meta.data && (
              <Tip content="Analytics reflect records up to this date. Scores and anomalies are recomputed when new data is ingested.">
                <span className="hidden items-center gap-1 text-xs text-slate-500 sm:inline-flex">
                  <Database className="h-3.5 w-3.5" /> Data as of <b className="font-semibold text-slate-700">{fmtDate(meta.data.dataAsOf)}</b>
                </span>
              </Tip>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right leading-tight">
              <div className="text-xs font-semibold text-navy-900">{user?.name}</div>
              <div className="text-[11px] text-slate-500">{user?.role === 'STATE_ADMIN' ? 'State admin · all 16 districts' : `District officer · ${user?.districtName} only`}</div>
            </div>
            <button onClick={logout} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-navy-900" title="Sign out" aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2 py-1 md:hidden">
          {nav.filter((n) => n.show).map((n) => (
            <NavLink key={n.label} to={n.to} end={n.end} className={({ isActive }) => cx('whitespace-nowrap rounded-md px-2 py-1 text-xs', isActive ? 'bg-navy-900 text-white' : 'text-slate-600')}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] p-4 lg:p-5">
            <ErrorBoundary resetKey={loc.pathname}>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
