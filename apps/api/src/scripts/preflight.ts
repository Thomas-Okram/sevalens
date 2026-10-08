/**
 * `npm run preflight` — demo-morning checklist. Prints ✅ / ⚠️ / ❌ per check and exits
 * non-zero if any hard check fails. Warnings (AI key / live AI ping, a running server
 * on the port, a stale web build) never fail the run: the app works offline.
 */
import 'dotenv/config';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

type Status = 'pass' | 'warn' | 'fail';
const ICON: Record<Status, string> = { pass: '✅', warn: '⚠️ ', fail: '❌' };
const results: { label: string; status: Status; detail: string; fix?: string }[] = [];

function report(label: string, status: Status, detail: string, fix?: string) {
  results.push({ label, status, detail, fix });
  console.log(`${ICON[status]} ${label} — ${detail}${fix && status !== 'pass' ? `\n     → ${fix}` : ''}`);
}

async function check(label: string, fn: () => Promise<void> | void) {
  try {
    await fn();
  } catch (e) {
    report(label, 'fail', `check crashed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = path.resolve(apiRoot, '../..');
const dbPath = path.resolve(apiRoot, process.env.DATABASE_PATH ?? 'data/sevalens.db');
const port = Number(process.env.PORT ?? 4000);

console.log(`\nSevaLens preflight — ${new Date().toLocaleString()}\n`);

// ---------- Node ----------
await check('Node version', () => {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) report('Node version', 'pass', `v${process.versions.node}`);
  else report('Node version', 'fail', `v${process.versions.node} (need >= 20)`, 'install Node 20 LTS or newer');
});

// ---------- database ----------
let dbOk = false;
await check('Database', async () => {
  if (!fs.existsSync(dbPath)) return report('Database', 'fail', `not found at ${path.relative(repoRoot, dbPath)}`, 'npm run setup');
  const { sqlite } = await import('../db/client');
  const { EXPECTED_COUNTS, tableCounts } = await import('../db/seedChecks');
  const counts = tableCounts(sqlite);
  const off = (Object.keys(EXPECTED_COUNTS) as (keyof typeof EXPECTED_COUNTS)[]).filter((t) => counts[t] !== EXPECTED_COUNTS[t]);
  const summary = Object.entries(counts).map(([t, n]) => `${t}=${n}`).join(' ');
  if (off.length) return report('Database seed counts', 'fail', `${off.map((t) => `${t} ${counts[t]} ≠ ${EXPECTED_COUNTS[t]}`).join(', ')}`, 'npm run db:seed');
  dbOk = true;
  report('Database seed counts', 'pass', summary);
});

// ---------- planted patterns ----------
if (dbOk) {
  await check('Planted patterns', async () => {
    const { sqlite } = await import('../db/client');
    const { plantedPatternChecks } = await import('../db/seedChecks');
    for (const c of plantedPatternChecks(sqlite)) report(`Pattern ${c.id}: ${c.label}`, c.ok ? 'pass' : 'fail', c.detail, 'npm run db:seed');
    // the anomaly engine must actually surface them, not just the raw data
    const { getSnapshot } = await import('../services/snapshot');
    const types = new Set<string>(getSnapshot().anomalies.map((a) => a.type));
    const need = ['duplicate_beneficiary', 'deceased_paid', 'disbursement_failure_spike', 'officer_outlier', 'pendency_backlog'];
    const missing = need.filter((t) => !types.has(t));
    report('Anomaly engine detects patterns', missing.length ? 'fail' : 'pass', missing.length ? `missing: ${missing.join(', ')}` : `${need.length}/${need.length} anomaly types present`, 'npm run db:seed');
  });
} else {
  report('Planted patterns', 'fail', 'skipped — database not ready', 'npm run setup');
}

// ---------- port ----------
await check(`Port ${port}`, async () => {
  const free = await new Promise<boolean>((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port);
  });
  if (free) return report(`Port ${port}`, 'pass', 'free');
  // in use — fine if it is SevaLens itself
  const health = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) }).then((r) => r.json() as Promise<{ ok?: boolean }>).catch(() => null);
  if (health?.ok) report(`Port ${port}`, 'warn', 'in use by a running SevaLens server (health OK)', 'fine if that is the demo server; restart it after reseeding');
  else report(`Port ${port}`, 'fail', 'in use by another process', `lsof -i :${port}  — stop it, or set PORT in .env`);
});

// ---------- web build ----------
await check('Web build', () => {
  const index = path.join(repoRoot, 'apps/web/dist/index.html');
  if (!fs.existsSync(index)) return report('Web build', 'fail', 'apps/web/dist missing', 'npm run build');
  const built = fs.statSync(index).mtimeMs;
  const newest = (dir: string): number =>
    fs.readdirSync(dir, { withFileTypes: true }).reduce((m, e) => Math.max(m, e.isDirectory() ? newest(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).mtimeMs), 0);
  const src = Math.max(newest(path.join(repoRoot, 'apps/web/src')), newest(path.join(repoRoot, 'packages/shared/src')));
  if (src > built) report('Web build', 'warn', `exists but older than source (built ${new Date(built).toLocaleString()})`, 'npm run build');
  else report('Web build', 'pass', `built ${new Date(built).toLocaleString()}`);
});

// ---------- AI (warn only) ----------
await check('AI key + live ping', async () => {
  const { aiEnabled, aiModel } = await import('../ai/llm');
  if (!aiEnabled()) return report('AI key', 'warn', 'ANTHROPIC_API_KEY not set — offline template/keyword fallbacks will be used', 'add ANTHROPIC_API_KEY to .env for live AI');
  report('AI key', 'pass', `present (model ${aiModel()})`);
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const t0 = Date.now();
  try {
    await new Anthropic({ timeout: 8000, maxRetries: 0 }).messages.create({ model: aiModel(), max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] });
    report('AI live ping', 'pass', `1-token call OK in ${Date.now() - t0} ms`);
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? e.message.slice(0, 140) : e instanceof Error ? e.message : String(e);
    report('AI live ping', 'warn', `failed after ${Date.now() - t0} ms: ${msg}`, 'demo still works — the UI labels fallback output as "offline"');
  }
});

// ---------- insights cache ----------
if (dbOk) {
  await check('Brief cache', async () => {
    const { sqlite } = await import('../db/client');
    const { aiEnabled } = await import('../ai/llm');
    const asOf = (sqlite.prepare(`SELECT value FROM meta WHERE key = 'data_as_of'`).get() as { value: string }).value;
    const districts = (sqlite.prepare('SELECT COUNT(*) AS n FROM districts').get() as { n: number }).n;
    const rows = sqlite.prepare(`SELECT source FROM insights_cache WHERE kind = 'brief' AND key LIKE ?`).all(`brief:%:${asOf}`) as { source: string }[];
    const llm = rows.filter((r) => r.source === 'llm').length;
    if (rows.length < districts) return report('insights_cache warm', 'fail', `${rows.length}/${districts} district briefs cached for ${asOf}`, 'npm run cache:warm');
    if (aiEnabled() && llm < rows.length) return report('insights_cache warm', 'warn', `${rows.length}/${districts} cached, but ${rows.length - llm} are template briefs — with a key set these regenerate live on first open`, 'npm run cache:warm (on good Wi-Fi)');
    report('insights_cache warm', 'pass', `${rows.length}/${districts} briefs cached (${llm} AI, ${rows.length - llm} template)`);
  });
} else {
  report('insights_cache warm', 'fail', 'skipped — database not ready', 'npm run setup && npm run cache:warm');
}

// ---------- tests ----------
await check('Test suite', () => {
  const t0 = Date.now();
  const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vitest', 'run'], { cwd: apiRoot, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } });
  const out = `${r.stdout}\n${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, '');
  const line = (label: string) => out.split('\n').find((l) => l.trim().startsWith(label))?.trim().replace(/\s+/g, ' ');
  const detail = `${line('Test Files') ?? ''}; ${line('Tests') ?? ''} (${((Date.now() - t0) / 1000).toFixed(1)}s)`;
  if (r.status === 0) report('Test suite', 'pass', detail);
  else {
    report('Test suite', 'fail', detail, 'npm test');
    console.log(out.split('\n').filter((l) => /FAIL|AssertionError|Error:|✗|×/.test(l)).slice(0, 15).map((l) => `     ${l}`).join('\n'));
  }
});

// ---------- verdict ----------
const fails = results.filter((r) => r.status === 'fail').length;
const warns = results.filter((r) => r.status === 'warn').length;
console.log(`\n${fails ? '❌ NOT READY' : '✅ READY'} — ${results.length - fails - warns} passed, ${warns} warning(s), ${fails} failure(s)\n`);
process.exit(fails ? 1 : 0);
