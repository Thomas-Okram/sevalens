import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Lock, ShieldCheck, Loader2 } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Logo } from '../components/Layout';
import { SyntheticBadge } from '../components/ui';

const DEMO = [
  { email: 'state@sevalens.demo', label: 'State admin', hint: 'All 16 districts' },
  { email: 'dist.ukhrul@sevalens.demo', label: 'District officer', hint: 'Ukhrul only' },
];

export default function Login() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState(DEMO[0].email);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-[radial-gradient(ellipse_at_top,_#132c50,_#0B1F3A_60%)] p-4">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl md:grid-cols-2">
        <div className="hidden flex-col justify-between bg-navy-900 p-8 text-slate-200 md:flex">
          <Logo light />
          <div>
            <h1 className="text-2xl font-semibold leading-snug text-white">See who welfare isn't reaching — and where to act first.</h1>
            <ul className="mt-5 space-y-2.5 text-sm text-slate-300">
              <li>• Coverage gaps by district, block and scheme</li>
              <li>• Pendency & SLA breaches with stage bottlenecks</li>
              <li>• Explainable anomaly detection with human review</li>
              <li>• Attention Score: where officers should look first</li>
            </ul>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <ShieldCheck className="h-4 w-4 text-teal-500" /> Role-based access · masked PII · full audit trail
          </div>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4 p-8">
          <div className="md:hidden"><Logo /></div>
          <div>
            <h2 className="text-lg font-semibold text-navy-900">Sign in</h2>
            <p className="text-sm text-slate-500">Social Welfare Department, Government of Manipur</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {DEMO.map((d) => (
              <button type="button" key={d.email} onClick={() => { setEmail(d.email); setPassword('Demo@2026'); }}
                className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${email === d.email ? 'border-teal-500 bg-teal-50/60' : 'border-slate-200 hover:border-slate-300'}`}>
                <div className="font-semibold text-navy-900">{d.label}</div>
                <div className="text-slate-500">{d.hint}</div>
              </button>
            ))}
          </div>
          <label className="text-xs font-medium text-slate-600">
            Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username" required
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20" />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Password
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" required
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20" />
          </label>
          {error && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">{error}</div>}
          <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-lg bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-800 disabled:opacity-70">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} Sign in
          </button>
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span>Demo password: <code className="rounded bg-slate-100 px-1">Demo@2026</code></span>
            <SyntheticBadge />
          </div>
        </form>
      </div>
    </div>
  );
}
