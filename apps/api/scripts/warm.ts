/**
 * Pre-generates the AI output used in the demo and stores it in insights_cache, so
 * nothing on stage waits on a live model call. Run after `npm run db:seed` (which
 * clears the cache):  npm run ai:warm
 *
 * - Officer briefs for every district named in DEMO.md (refreshed).
 * - Ask SevaLens: the suggested questions, as state admin and as the Ukhrul officer.
 * Exits non-zero if any item fell back to the template, so a bad key is caught early.
 */
import 'dotenv/config';
import { getSnapshot } from '../src/services/snapshot';
import { BRIEF_MAX_WORDS, briefWords, generateBrief } from '../src/ai/brief';
import { ask } from '../src/ai/ask';
import { aiEnabled, aiModel, setAiTimeout } from '../src/ai/llm';

const DEMO_DISTRICTS = ['Churachandpur', 'Imphal West', 'Pherzawl', 'Kamjong', 'Noney', 'Ukhrul', 'Thoubal'];
const DEMO_QUESTIONS = [
  'Which blocks in Ukhrul have the most pending widow pension cases?',
  'Where is old age pension coverage lowest?',
  'Which blocks have the highest payment failure rates?',
  'Which scheme has the most SLA breaches?',
  'Which blocks have the most pending widow pension cases?',
  'Which blocks have the lowest coverage?',
];

if (!aiEnabled()) {
  console.error('[ai:warm] ANTHROPIC_API_KEY is not set; nothing to warm. The demo will use the offline templates.');
  process.exit(1);
}

// Off stage we can wait for a slow response rather than cache a fallback.
setAiTimeout(60_000);
const s = getSnapshot();
console.log(`[ai:warm] model ${aiModel()}, data as of ${s.asOf}`);
let failures = 0;

for (const name of DEMO_DISTRICTS) {
  const d = s.districts.find((x) => x.name === name);
  if (!d) { console.error(`  ✗ brief  ${name}: district not found`); failures++; continue; }
  const t0 = Date.now();
  const b = await generateBrief(s, d.id, true);
  const words = briefWords(b);
  const ok = b.source === 'llm' && words <= BRIEF_MAX_WORDS;
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} brief  ${name.padEnd(14)} ${b.source.padEnd(8)} ${String(words).padStart(3)} words  visit first: ${b.visitFirst.blockName}  (${Date.now() - t0} ms)${b.fallbackReason ? `  ${b.fallbackReason}` : ''}`);
}

const ukhrul = s.districts.find((x) => x.name === 'Ukhrul')?.id ?? null;
for (const [label, scope] of [['state', null], ['ukhrul', ukhrul]] as const) {
  for (const q of DEMO_QUESTIONS) {
    const t0 = Date.now();
    const r = await ask(s, q, scope);
    const ok = r.source === 'llm' && !r.fallbackReason;
    if (!ok) failures++;
    console.log(`  ${ok ? '✓' : '✗'} ask    [${label}] ${q}  -> ${r.intent}  (${Date.now() - t0} ms)${r.fallbackReason ? `  ${r.fallbackReason}` : ''}`);
  }
}

console.log(failures ? `[ai:warm] ${failures} item(s) not warmed; re-run, or the demo will show offline templates for them.` : '[ai:warm] all demo AI output cached.');
process.exit(failures ? 1 : 0);
