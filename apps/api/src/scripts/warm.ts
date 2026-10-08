/**
 * Pre-generates the officer brief for every district into insights_cache, so the demo
 * never waits on (or depends on) the network. Run after `npm run db:seed`, ideally on
 * good Wi-Fi with ANTHROPIC_API_KEY set; without a key the template briefs are cached.
 */
import 'dotenv/config';
import { getSnapshot } from '../services/snapshot';
import { generateBrief } from '../ai/brief';
import { aiEnabled, aiModel } from '../ai/llm';

const s = getSnapshot();
console.log(`[warm] ${s.districts.length} district briefs for data as of ${s.asOf} — AI ${aiEnabled() ? `on (${aiModel()})` : 'off (template briefs)'}`);
const ids = s.districts.map((d) => d.id);
const results: { name: string; source: string; reason?: string }[] = [];
for (let i = 0; i < ids.length; i += 4) {
  const batch = await Promise.all(ids.slice(i, i + 4).map((id) => generateBrief(s, id, false)));
  for (const b of batch) {
    results.push({ name: b.districtName, source: b.source, reason: b.fallbackReason });
    console.log(`  ${b.source === 'llm' ? 'AI      ' : 'template'} ${b.districtName}${b.fallbackReason ? ` (${b.fallbackReason})` : ''}`);
  }
}
const llm = results.filter((r) => r.source === 'llm').length;
console.log(`[warm] done: ${llm} AI, ${results.length - llm} template`);
