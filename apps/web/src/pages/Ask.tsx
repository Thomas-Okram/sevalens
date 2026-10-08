import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Send, Loader2, MessageSquareText, ShieldCheck, Filter } from 'lucide-react';
import type { AskResult } from '@sevalens/shared';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { AiProvenance } from '../components/AiProvenance';
import { ErrorState, PageHeader } from '../components/ui';

const SUGGESTIONS_STATE = [
  'Which blocks in Ukhrul have the most pending widow pension cases?',
  'Where is old age pension coverage lowest?',
  'Which blocks have the highest payment failure rates?',
  'Show suspected duplicate beneficiaries',
  'Which scheme has the most SLA breaches?',
  'Top 5 blocks that need attention',
];
const SUGGESTIONS_DISTRICT = [
  'Which blocks have the most pending widow pension cases?',
  'Which blocks have the lowest coverage?',
  'Which scheme has the most SLA breaches?',
  'Show active anomalies',
];

interface Turn { q: string; result?: AskResult; error?: unknown }

export default function Ask() {
  const { user } = useAuth();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const m = useMutation({ mutationFn: (question: string) => api.post<AskResult>('/ai/ask', { question }) });
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  const submit = async (question: string) => {
    const text = question.trim();
    if (text.length < 3 || m.isPending) return;
    setQ('');
    setTurns((t) => [...t, { q: text }]);
    try {
      const result = await m.mutateAsync(text);
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, result } : x)));
    } catch (error) {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error } : x)));
    }
  };
  const onSubmit = (e: FormEvent) => { e.preventDefault(); submit(q); };
  const suggestions = user?.role === 'STATE_ADMIN' ? SUGGESTIONS_STATE : SUGGESTIONS_DISTRICT;

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      <PageHeader title="Ask SevaLens" subtitle="Plain-language questions answered from a fixed set of safe, audited queries — the AI never writes SQL or sees personal data" />
      <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          {turns.length === 0 && (
            <div className="mx-auto max-w-2xl py-6 text-center">
              <MessageSquareText className="mx-auto h-8 w-8 text-teal-600" />
              <h2 className="mt-2 text-base font-semibold text-navy-900">What would you like to know?</h2>
              <p className="mt-1 text-sm text-slate-500">Try one of these:</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {suggestions.map((s) => (
                  <button key={s} onClick={() => submit(s)} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-700 ring-1 ring-slate-200 hover:bg-teal-50 hover:ring-teal-300">{s}</button>
                ))}
              </div>
              <p className="mt-4 inline-flex items-center gap-1 text-[11px] text-slate-500"><ShieldCheck className="h-3.5 w-3.5 text-teal-600" /> Please don't type names or ID numbers — ask about areas, schemes and trends.</p>
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className="space-y-2">
              <div className="flex justify-end"><div className="max-w-[80%] rounded-2xl rounded-br-sm bg-navy-900 px-3.5 py-2 text-sm text-white">{t.q}</div></div>
              {!t.result && !t.error && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin text-teal-600" /> Working out which query to run…</div>}
              {t.error ? <ErrorState error={t.error} /> : null}
              {t.result && <Answer r={t.result} />}
            </div>
          ))}
          <div ref={end} />
        </div>
        <form onSubmit={onSubmit} className="flex gap-2 border-t border-slate-200 p-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={300} placeholder="e.g. Which blocks in Ukhrul have the most pending widow pension cases?" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20" aria-label="Question" />
          <button disabled={m.isPending || q.trim().length < 3} className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:bg-slate-400">
            {m.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Ask
          </button>
        </form>
      </div>
    </div>
  );
}

function Answer({ r }: { r: AskResult }) {
  return (
    <div className="max-w-[95%] space-y-2 rounded-2xl rounded-bl-sm border border-slate-200 bg-white p-3.5">
      <p className="text-sm leading-relaxed text-slate-800">{r.answer}</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="inline-flex items-center gap-1 font-medium text-slate-500"><Filter className="h-3 w-3" /> Query used:</span>
        <span className="rounded bg-teal-50 px-1.5 py-0.5 font-mono text-teal-800 ring-1 ring-teal-200">{r.intent}</span>
        <span className="text-slate-500">({r.intentLabel})</span>
        {Object.entries(r.filters).map(([k, v]) => (
          <span key={k} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">{k}: <b>{String(v)}</b></span>
        ))}
      </div>
      {r.rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
              <tr>{r.columns.map((c) => <th key={c.key} className="whitespace-nowrap px-3 py-1.5">{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {r.rows.map((row, i) => (
                <tr key={i} className="border-t border-slate-100">
                  {r.columns.map((c) => <td key={c.key} className="px-3 py-1.5 tabular-nums">{String(row[c.key] ?? '')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AiProvenance source={r.source} model={r.model} dataAsOf={r.dataAsOf} fallbackReason={r.fallbackReason} />
    </div>
  );
}
