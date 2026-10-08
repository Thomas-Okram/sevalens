import { Component, useRef, useState, type ReactNode, type ErrorInfo } from 'react';
import { createPortal } from 'react-dom';
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, Loader2, FlaskConical, RefreshCw, Inbox } from 'lucide-react';
import type { AttentionScore, Severity } from '@sevalens/shared';
import { FACTOR_COLOR, SEV_COLOR, SEV_LABEL } from '../lib/theme';

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');

// ---------- Tooltip (fixed-position, never clipped by overflow containers) ----------
export function Tip({ content, children, className, width = 280 }: { content: ReactNode; children: ReactNode; className?: string; width?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null);
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const above = r.bottom + 140 > window.innerHeight;
    const x = Math.min(Math.max(8, r.left + r.width / 2 - width / 2), window.innerWidth - width - 8);
    setPos({ x, y: above ? r.top - 8 : r.bottom + 8, above });
  };
  return (
    <span ref={ref} className={cx('inline-flex', className)} onMouseEnter={show} onMouseLeave={() => setPos(null)} onFocus={show} onBlur={() => setPos(null)} tabIndex={0}>
      {children}
      {pos &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-[2000] rounded-lg bg-navy-900 px-3 py-2 text-xs leading-relaxed text-slate-100 shadow-xl"
            style={{ left: pos.x, top: pos.y, width, transform: pos.above ? 'translateY(-100%)' : undefined }}
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}

export function InfoTip({ content, width }: { content: ReactNode; width?: number }) {
  return (
    <Tip content={content} width={width}>
      <Info className="h-3.5 w-3.5 cursor-help text-slate-400 hover:text-teal-600" aria-label="How is this computed?" />
    </Tip>
  );
}

// ---------- Layout primitives ----------
export function Card({ title, subtitle, info, actions, children, className, bodyClass }: { title?: ReactNode; subtitle?: ReactNode; info?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={cx('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-navy-900">
              {title}
              {info && <InfoTip content={info} />}
            </h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx('p-4', bodyClass)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function KpiTile({ label, value, sub, info, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; info: ReactNode; tone?: Severity; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        {icon}
        <span className="truncate">{label}</span>
        <InfoTip content={info} />
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums tracking-tight text-navy-900">{value}</span>
        {tone && <SeverityBadge severity={tone} compact />}
      </div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

const SEV_ICON = { low: CheckCircle2, medium: AlertTriangle, high: AlertOctagon };

export function SeverityBadge({ severity, label, compact }: { severity: Severity; label?: string; compact?: boolean }) {
  const Icon = SEV_ICON[severity];
  const styles = {
    low: 'bg-green-50 text-green-800 ring-green-600/25',
    medium: 'bg-amber-50 text-amber-900 ring-amber-500/40',
    high: 'bg-red-50 text-red-800 ring-red-600/25',
  }[severity];
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full font-medium ring-1 ring-inset', compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs', styles)}>
      <Icon className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} style={{ color: SEV_COLOR[severity] }} aria-hidden />
      {label ?? SEV_LABEL[severity]}
    </span>
  );
}

/** Score pill: number + level icon/label, so the level is never colour-only. */
export function ScorePill({ score, level }: { score: number; level: Severity }) {
  const Icon = SEV_ICON[level];
  const styles = { low: 'bg-green-50 text-green-800 ring-green-600/25', medium: 'bg-amber-50 text-amber-900 ring-amber-500/40', high: 'bg-red-50 text-red-800 ring-red-600/25' }[level];
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums ring-1 ring-inset', styles)}>
      <Icon className="h-3.5 w-3.5" style={{ color: SEV_COLOR[level] }} aria-hidden />
      {score}
      <span className="font-medium opacity-80">{SEV_LABEL[level]}</span>
    </span>
  );
}

/** Horizontal stacked bar of factor points (0–100) with an explaining tooltip. */
export function FactorBar({ attention, showLegend }: { attention: AttentionScore; showLegend?: boolean }) {
  const content = (
    <div>
      <div className="mb-1 font-semibold">
        Why {attention.name} scores {attention.score}/100
      </div>
      <table className="w-full">
        <tbody>
          {attention.factors.map((f) => (
            <tr key={f.key} className="align-top">
              <td className="pr-2">
                <span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: FACTOR_COLOR[f.key] }} />
                {f.label}
              </td>
              <td className="pr-2 text-slate-300">{f.rawLabel}</td>
              <td className="text-right font-semibold tabular-nums">+{f.points.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1 text-slate-400">Points = 100 × weight × normalised factor (0–1).</div>
    </div>
  );
  return (
    <div className="w-full">
      <Tip content={content} width={380} className="w-full">
        <div className="flex h-2.5 w-full cursor-help gap-[2px] overflow-hidden rounded-full bg-slate-100" aria-label={`Score breakdown for ${attention.name}`}>
          {attention.factors.filter((f) => f.points > 0.2).map((f) => (
            <div key={f.key} style={{ width: `${f.points}%`, background: FACTOR_COLOR[f.key] }} />
          ))}
        </div>
      </Tip>
      {showLegend && <FactorLegend />}
    </div>
  );
}

export function FactorLegend() {
  const items: [keyof typeof FACTOR_COLOR, string][] = [
    ['coverageGap', 'Coverage gap'],
    ['slaBreach', 'SLA breach'],
    ['anomalies', 'Anomalies'],
    ['disbursementFailure', 'Payment failures'],
    ['remoteness', 'Remoteness'],
  ];
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
      {items.map(([k, l]) => (
        <span key={k} className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm" style={{ background: FACTOR_COLOR[k] }} />
          {l}
        </span>
      ))}
    </div>
  );
}

export function SyntheticBadge({ className }: { className?: string }) {
  return (
    <Tip content="All beneficiary, application and payment records in this prototype are synthetic, generated with a fixed seed. District populations are Census-2011-based estimates. No real person's data is shown.">
      <span className={cx('inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-300', className)}>
        <FlaskConical className="h-3 w-3" /> Synthetic demo data
      </span>
    </Tip>
  );
}

// ---------- States ----------
export function Loading({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div className={cx('flex items-center justify-center gap-2 py-12 text-sm text-slate-500', className)}>
      <Loader2 className="h-4 w-4 animate-spin text-teal-600" /> {label}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-lg bg-slate-200/70', className)} />;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50/60 px-4 py-8 text-center text-sm text-red-800">
      <AlertTriangle className="h-5 w-5" />
      <div>{msg}</div>
      {onRetry && (
        <button onClick={onRetry} className="mt-1 inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1 text-xs font-medium text-red-800 ring-1 ring-red-200 hover:bg-red-50">
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-10 text-center text-sm text-slate-500">
      <Inbox className="h-6 w-6 text-slate-300" />
      <div className="font-medium text-slate-600">{title}</div>
      {children}
    </div>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ui] render error', error, info);
  }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error)
      return (
        <div className="m-6">
          <ErrorState error={new Error('This view hit an unexpected problem. Other pages still work.')} onRetry={() => this.setState({ error: null })} />
        </div>
      );
    return this.props.children;
  }
}

export function Button({ children, variant = 'primary', className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  const styles = {
    primary: 'bg-navy-900 text-white hover:bg-navy-800 disabled:bg-slate-400',
    secondary: 'bg-white text-navy-900 ring-1 ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
    ghost: 'text-slate-600 hover:bg-slate-100',
  }[variant];
  return (
    <button {...rest} className={cx('inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed', styles, className)}>
      {children}
    </button>
  );
}

export function Select({ label, value, onChange, options, className }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string }) {
  return (
    <label className={cx('flex flex-col gap-0.5 text-[11px] font-medium text-slate-500', className)}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
