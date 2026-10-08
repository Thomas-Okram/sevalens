import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Loader2, MapPin, Printer, RefreshCw, Sparkles } from 'lucide-react';
import type { Brief } from '@sevalens/shared';
import { api } from '../lib/api';
import { fmtDate } from '../lib/format';
import { AiProvenance } from './AiProvenance';
import { Button, Card, ErrorState } from './ui';

export function BriefPanel({ districtId, districtName }: { districtId: number; districtName: string }) {
  const qc = useQueryClient();
  const cached = useQuery({ queryKey: ['brief', districtId], queryFn: () => api.get<{ brief: Brief | null }>(`/ai/brief/${districtId}`) });
  const gen = useMutation({
    mutationFn: (refresh: boolean) => api.post<{ brief: Brief }>(`/ai/brief/${districtId}`, { refresh }),
    onSuccess: (d) => qc.setQueryData(['brief', districtId], d),
  });
  const brief = cached.data?.brief ?? null;

  return (
    <Card
      title={<span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-teal-600" /> Officer brief</span>}
      subtitle={brief ? `Generated ${fmtDate(brief.generatedAt)} · cached for this data snapshot` : `A one-page action note for ${districtName}: situation, top issues, actions, where to visit first`}
      info="Built from aggregated, de-identified statistics only (coverage, pendency, payment failures, anomalies, attention factors). Uses the AI model when configured; otherwise a deterministic template from the same data."
      actions={
        brief ? (
          <>
            <Button variant="secondary" className="!py-1 text-xs" onClick={() => window.print()}><Printer className="h-3.5 w-3.5" /> Print</Button>
            <Button variant="secondary" className="!py-1 text-xs" disabled={gen.isPending} onClick={() => gen.mutate(true)}>
              {gen.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Regenerate
            </Button>
          </>
        ) : null
      }
    >
      {gen.isError && <div className="mb-3"><ErrorState error={gen.error} /></div>}
      {!brief ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <FileText className="h-8 w-8 text-slate-300" />
          <Button onClick={() => gen.mutate(false)} disabled={gen.isPending || cached.isLoading}>
            {gen.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Generate officer brief
          </Button>
          <p className="text-xs text-slate-500">Takes a few seconds · falls back to a rule-based brief if AI is unavailable</p>
        </div>
      ) : (
        <article className="space-y-4 text-sm leading-relaxed text-slate-700" id="officer-brief">
          <div>
            <h3 className="text-base font-semibold text-navy-900">{brief.title}</h3>
            <p className="mt-1">{brief.situation}</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Top issues</h4>
              <ol className="space-y-2">
                {brief.topIssues.map((t, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-navy-900 text-[11px] font-semibold text-white">{i + 1}</span>
                    <div><div className="font-medium text-navy-900">{t.title}</div><div className="text-slate-600">{t.detail}</div></div>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Recommended actions</h4>
              <ul className="list-disc space-y-1 pl-5">{brief.actions.map((a, i) => <li key={i}>{a}</li>)}</ul>
              <div className="mt-3 flex gap-2 rounded-lg bg-teal-50 px-3 py-2 ring-1 ring-teal-200">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
                <div><span className="font-semibold text-teal-900">Visit first: {brief.visitFirst.blockName}</span> <span className="text-teal-900/80">— {brief.visitFirst.reason}</span></div>
              </div>
            </div>
          </div>
          <AiProvenance source={brief.source} model={brief.model} dataAsOf={brief.dataAsOf} factors={brief.factorsUsed} fallbackReason={brief.fallbackReason} />
        </article>
      )}
    </Card>
  );
}
