import { useQuery } from '@tanstack/react-query';
import { Database, ShieldCheck, Sparkles, Scale, AlertTriangle, Lock, Eye, ServerCog } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useMeta } from '../lib/queries';
import { fmtDate } from '../lib/format';
import { FACTOR_COLOR } from '../lib/theme';
import { Card, ErrorState, Loading, PageHeader, SyntheticBadge } from '../components/ui';

const FACTOR_LABEL: Record<string, string> = { coverageGap: 'Coverage gap', slaBreach: 'SLA breach', anomalies: 'Anomalies', disbursementFailure: 'Payment failures', remoteness: 'Remoteness' };

export default function Privacy() {
  const { user } = useAuth();
  const meta = useMeta();
  const previewDistrict = user?.districtId ?? meta.data?.districts[0]?.id;
  const preview = useQuery({
    queryKey: ['payload-preview', previewDistrict],
    queryFn: () => api.get<{ aiEnabled: boolean; model: string | null; payload: unknown }>(`/ai/payload-preview/${previewDistrict}`),
    enabled: !!previewDistrict,
  });
  const m = meta.data;
  return (
    <div className="space-y-4">
      <PageHeader title="Data & privacy" subtitle="Where the data comes from, what the AI can see, how scores are computed, and the limits of this prototype" actions={<SyntheticBadge />} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={<span className="flex items-center gap-1.5"><Database className="h-4 w-4 text-teal-600" /> Data sources</span>}>
          <ul className="space-y-2 text-sm text-slate-700">
            <li><b>Beneficiaries, applications, disbursements, officers</b> — <span className="text-amber-800">synthetic</span>, generated with a fixed random seed (~50k beneficiaries, ~15k applications, 18 months of payments). No real person's data is used.</li>
            <li><b>District population & demographic shares</b> — approximate Census-2011-based estimates re-apportioned to 16 districts; remoteness index is an illustrative terrain/access estimate.</li>
            <li><b>Scheme rules</b> — IGNOAPS, IGNWPS, IGNDPS, PMMVY, Post-Matric Scholarship, State Social Security Pension, with eligibility fields and processing SLAs.</li>
            <li><b>Production path</b> — scheduled ingestion from scheme MIS / DBT / PFMS exports into Postgres; the same analytics run unchanged.</li>
          </ul>
          {m && <p className="mt-3 text-xs text-slate-500">Data as of {fmtDate(m.dataAsOf)} · analytics computed {fmtDate(m.computedAt)}</p>}
        </Card>

        <Card title={<span className="flex items-center gap-1.5"><Lock className="h-4 w-4 text-teal-600" /> Security & access</span>}>
          <ul className="space-y-2 text-sm text-slate-700">
            <li><b>Role-based access, enforced on the server</b> — state admins see all districts; district officers only their own. Every query is scoped server-side, not just hidden in the UI.</li>
            <li><b>Masked PII</b> — Aadhaar is stored only as last-4 digits plus a salted hash (for de-duplication). List views show masked names; full records open only in an audited detail view.</li>
            <li><b>Audit trail</b> — sign-ins, beneficiary record views, AI brief generation, Ask queries, exports and anomaly reviews are logged.</li>
            <li><b>Hardening</b> — bcrypt passwords, HTTP-only session cookies, security headers (helmet), rate limits on sign-in and AI, input validation on every endpoint, no stack traces returned to the browser.</li>
          </ul>
        </Card>

        <Card title={<span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-teal-600" /> What is sent to the AI</span>} info="Generated live from the server's sanitiser for the district shown.">
          <div className="mb-3 rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-900 ring-1 ring-teal-200">
            <b>Only aggregated, de-identified statistics.</b> Never names, Aadhaar numbers, dates of birth, villages or record IDs. A whitelist sanitiser (<code className="text-xs">toLLMPayload()</code>) drops every other field and redacts ID-like text; a unit test proves PII cannot pass through.
          </div>
          <ul className="mb-3 space-y-1 text-sm text-slate-700">
            <li>• The AI never writes SQL — it picks one of 6 whitelisted query types; the server runs the safe query.</li>
            <li>• Every AI output is labelled “verify before action”, with the data date and the factors used.</li>
            <li>• Works fully offline: without an API key, rule-based templates and a keyword matcher are used.</li>
            <li>• AI status: <b>{m?.ai.enabled ? `enabled (${m.ai.model})` : 'not configured — offline fallbacks active'}</b></li>
          </ul>
          <div className="text-xs font-medium text-slate-500"><Eye className="mr-1 inline h-3.5 w-3.5" />Exact payload for an officer brief ({m?.districts.find((d) => d.id === previewDistrict)?.name}):</div>
          {preview.isError ? <div className="mt-1"><ErrorState error={preview.error} onRetry={() => preview.refetch()} /></div> : preview.data ? (
            <pre className="mt-1 max-h-72 overflow-auto rounded-lg bg-navy-950 p-3 text-[11px] leading-relaxed text-teal-100">{JSON.stringify(preview.data.payload, null, 2)}</pre>
          ) : <Loading />}
        </Card>

        <div className="space-y-4">
          <Card title={<span className="flex items-center gap-1.5"><Scale className="h-4 w-4 text-teal-600" /> Attention Score weights</span>} info="Defined in one config object on the server (apps/api/src/analytics/config.ts) and returned with every score.">
            {m ? (
              <>
                <div className="space-y-2">
                  {Object.entries(m.weights).map(([k, w]) => (
                    <div key={k} className="flex items-center gap-2 text-sm">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: FACTOR_COLOR[k as keyof typeof FACTOR_COLOR] }} />
                      <span className="w-36 text-slate-700">{FACTOR_LABEL[k]}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${w * 100 / 0.3}%`, background: FACTOR_COLOR[k as keyof typeof FACTOR_COLOR] }} /></div>
                      <span className="w-10 text-right font-semibold tabular-nums">{Math.round(w * 100)}%</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-slate-500">Score = 100 × Σ weight × normalised factor (0–1, fixed scales). High ≥ {m.levels.high}, medium ≥ {m.levels.medium}. Remoteness raises attention because remote areas need more outreach effort — it is a geographic factor only.</p>
              </>
            ) : meta.isError ? <ErrorState error={meta.error} onRetry={() => meta.refetch()} /> : <Loading />}
          </Card>

          <Card title={<span className="flex items-center gap-1.5"><ServerCog className="h-4 w-4 text-teal-600" /> Anomaly methods</span>}>
            {m && (
              <ul className="space-y-1.5 text-sm text-slate-700">
                <li><b>Duplicates</b> — same salted Aadhaar hash, or same block + DOB + name similarity ≥ {m.anomalyConfig.fuzzyNameThreshold} (Jaro-Winkler / Levenshtein).</li>
                <li><b>Payments after death</b> — rule: successful payment dated after recorded death.</li>
                <li><b>Spikes</b> — robust z-score (median/MAD) of the latest {m.anomalyConfig.testMonths} months vs earlier months; flagged when |z| &gt; {m.anomalyConfig.zThreshold}.</li>
                <li><b>Officer outliers</b> — approval rate & decision time vs peers with ≥ {m.anomalyConfig.officerMinDecisions} decisions (robust z).</li>
                <li><b>SLA backlog</b> — overdue cases per block vs all blocks (robust z).</li>
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card title={<span className="flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-amber-600" /> Limitations & responsible use</span>}>
        <ul className="grid gap-2 text-sm text-slate-700 md:grid-cols-2">
          <li>• Eligible-population figures are <b>estimates</b> from census shares; coverage % is indicative, not a headcount.</li>
          <li>• Anomalies are <b>statistical flags for human review</b>, not findings. Officers mark each as reviewed or false positive; false positives stop counting toward scores.</li>
          <li>• AI text can be wrong. It is generated only from the numbers shown and must be verified before action.</li>
          <li>• No individual is scored or ranked. Scores apply to districts and blocks; areas are described only by geography and terrain.</li>
          <li>• This prototype uses synthetic data; thresholds and weights must be validated with the department on real data before deployment.</li>
          <li>• SQLite is used for a zero-dependency demo; production would use Postgres with encrypted storage and SSO.</li>
        </ul>
      </Card>
    </div>
  );
}
