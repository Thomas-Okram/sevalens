import { Sparkles, AlertTriangle, Cpu, FileText } from 'lucide-react';
import { fmtDate } from '../lib/format';
import { Tip } from './ui';

/** Shown on every AI output: disclaimer, data timestamp, source and factors used. */
export function AiProvenance({ source, model, dataAsOf, factors, fallbackReason }: { source: 'llm' | 'template' | 'keyword'; model: string | null; dataAsOf: string; factors?: string[]; fallbackReason?: string }) {
  const isLlm = source === 'llm';
  return (
    <div className="space-y-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1 font-semibold text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5" /> {isLlm ? 'AI-generated' : 'Auto-generated'} — verify before action
        </span>
        <span>Data as of <b>{fmtDate(dataAsOf)}</b></span>
        <Tip content={isLlm ? `Written by ${model} from aggregated, de-identified statistics only. No names, Aadhaar or dates of birth were sent.` : `Built by SevaLens's deterministic rules from the same statistics (no AI call).${fallbackReason ? ` Reason: ${fallbackReason}.` : ''}`}>
          <span className="inline-flex cursor-help items-center gap-1 rounded bg-white px-1.5 py-0.5 ring-1 ring-slate-200">
            {isLlm ? <Sparkles className="h-3 w-3 text-teal-600" /> : source === 'keyword' ? <Cpu className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
            {isLlm ? model : source === 'keyword' ? 'Keyword matcher (offline)' : 'Template (offline)'}
          </span>
        </Tip>
      </div>
      {factors && factors.length > 0 && (
        <div>
          <span className="font-medium text-slate-700">Factors used: </span>
          {factors.join(' · ')}
        </div>
      )}
    </div>
  );
}
