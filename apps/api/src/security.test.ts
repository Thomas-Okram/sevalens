/**
 * Security regression tests (see docs/SECURITY_REVIEW.md). Runs the real Express app
 * against a freshly seeded throw-away database, so the demo DB and audit log are untouched.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const apiRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sevalens-sec-'));
const dbFile = path.join(tmp, 'test.db');

const UKHRUL = 8;
const IMPHAL_WEST = 1;
const PASSWORD = 'Demo@2026';

let server: Server;
let base = '';
let sqlite: import('better-sqlite3').Database;
let officer = '';
let admin = '';

async function login(email: string, password = PASSWORD) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  return { status: r.status, cookie: (r.headers.get('set-cookie') ?? '').split(';')[0], headers: r.headers, body: await r.json() };
}

async function call(cookie: string, url: string, init: RequestInit = {}) {
  const r = await fetch(`${base}${url}`, { ...init, headers: { cookie, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const text = await r.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* csv */ }
  return { status: r.status, body: body as any, text, headers: r.headers };
}

const lastAudit = (action: string) => sqlite.prepare('SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1').get(action) as { details: string | null; user_email: string; entity_id: string | null } | undefined;

beforeAll(async () => {
  const env = { ...process.env, DATABASE_PATH: dbFile };
  const tsx = path.join(apiRoot, '../../node_modules/.bin/tsx');
  execFileSync(tsx, ['src/db/migrate.ts'], { cwd: apiRoot, env, stdio: 'ignore' });
  execFileSync(tsx, ['src/db/seed.ts'], { cwd: apiRoot, env, stdio: 'ignore' });
  process.env.DATABASE_PATH = dbFile;
  delete process.env.ANTHROPIC_API_KEY; // AI paths use their deterministic fallbacks, no network
  const { createApp } = await import('./app');
  sqlite = (await import('./db/client')).sqlite;
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  officer = (await login('dist.ukhrul@sevalens.demo')).cookie;
  admin = (await login('state@sevalens.demo')).cookie;
}, 60_000);

afterAll(() => {
  server?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('RBAC — dist.ukhrul cannot read another district', () => {
  const foreign = () => {
    const iwBlock = (sqlite.prepare('SELECT id FROM blocks WHERE district_id = ? ORDER BY id LIMIT 1').get(IMPHAL_WEST) as { id: number }).id;
    const iwBen = (sqlite.prepare('SELECT id FROM beneficiaries WHERE district_id = ? ORDER BY id LIMIT 1').get(IMPHAL_WEST) as { id: number }).id;
    return { iwBlock, iwBen };
  };

  it('every unauthenticated API route returns 401', async () => {
    for (const u of ['/api/meta', '/api/overview', '/api/attention', `/api/districts/${UKHRUL}`, '/api/pendency', '/api/pendency/export.csv', '/api/anomalies', '/api/anomalies/dup:block:1', '/api/beneficiaries/1', '/api/audit', `/api/ai/brief/${UKHRUL}`, `/api/ai/payload-preview/${UKHRUL}`]) {
      expect((await call('', u)).status, u).toBe(401);
    }
    expect((await call('', '/api/ai/ask', { method: 'POST', body: JSON.stringify({ question: 'pending cases' }) })).status).toBe(401);
  });

  it('explicit foreign district ids are refused with 403', async () => {
    const { iwBen } = foreign();
    const denied = [
      `/api/attention?districtId=${IMPHAL_WEST}`,
      `/api/districts/${IMPHAL_WEST}`,
      `/api/pendency?districtId=${IMPHAL_WEST}`,
      `/api/pendency/export.csv?districtId=${IMPHAL_WEST}`,
      `/api/anomalies?districtId=${IMPHAL_WEST}`,
      `/api/beneficiaries/${iwBen}`,
      `/api/ai/brief/${IMPHAL_WEST}`,
      `/api/ai/payload-preview/${IMPHAL_WEST}`,
      '/api/audit',
    ];
    for (const u of denied) expect((await call(officer, u)).status, u).toBe(403);
    expect((await call(officer, `/api/ai/brief/${IMPHAL_WEST}`, { method: 'POST', body: '{}' })).status).toBe(403);
  });

  it('foreign anomalies cannot be read or reviewed', async () => {
    const res = await call(admin, '/api/anomalies');
    const foreignKeys = (res.body.anomalies as { key: string; districtId: number }[]).filter((a) => a.districtId !== UKHRUL).map((a) => a.key);
    expect(foreignKeys.length).toBeGreaterThan(5);
    for (const key of foreignKeys) {
      expect((await call(officer, `/api/anomalies/${encodeURIComponent(key)}`)).status, key).toBe(403);
      expect((await call(officer, `/api/anomalies/${encodeURIComponent(key)}/review`, { method: 'POST', body: JSON.stringify({ status: 'false_positive' }) })).status, key).toBe(403);
    }
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM anomaly_reviews').get()).toEqual({ n: 0 });
  });

  it('unfiltered list endpoints only contain Ukhrul data', async () => {
    const { iwBlock } = foreign();
    const meta = await call(officer, '/api/meta');
    expect(meta.body.districts.map((d: { id: number }) => d.id)).toEqual([UKHRUL]);
    expect(meta.body.blocks.every((b: { districtId: number }) => b.districtId === UKHRUL)).toBe(true);

    const ov = await call(officer, '/api/overview');
    expect(ov.body.districts.map((d: { id: number }) => d.id)).toEqual([UKHRUL]);
    expect(ov.body.attention.every((a: { districtName: string }) => a.districtName === 'Ukhrul')).toBe(true);

    const att = await call(officer, '/api/attention?level=block');
    expect(att.body.scores.length).toBeGreaterThan(0);
    expect(att.body.scores.every((a: { districtName: string }) => a.districtName === 'Ukhrul')).toBe(true);

    const pend = await call(officer, '/api/pendency?limit=500');
    expect(pend.body.items.length).toBeGreaterThan(0);
    expect(pend.body.items.every((i: { districtId: number }) => i.districtId === UKHRUL)).toBe(true);
    expect(pend.body.heatmap.every((r: { districtName: string }) => r.districtName === 'Ukhrul')).toBe(true);

    // a foreign block id does not widen the scope
    const viaBlock = await call(officer, `/api/pendency?blockId=${iwBlock}`);
    expect(viaBlock.body.total).toBe(0);
    expect(viaBlock.body.heatmap).toEqual([]);
    expect(viaBlock.body.summary.open).toBe(0);
    const csv = await call(officer, `/api/pendency/export.csv?blockId=${iwBlock}`);
    expect(csv.text.trim().split('\n')).toHaveLength(2); // banner + header only

    const an = await call(officer, '/api/anomalies?includeDismissed=true');
    expect(an.body.anomalies.length).toBeGreaterThan(0);
    expect(an.body.anomalies.every((a: { districtId: number }) => a.districtId === UKHRUL)).toBe(true);
  });

  it('Ask SevaLens: every intent naming another district stays pinned to Ukhrul', async () => {
    const questions = [
      'Which blocks in Imphal West have the most pending widow pension cases?',
      'Where is coverage lowest in Thoubal blocks?',
      'Which blocks in Churachandpur need attention?',
      'Show duplicate beneficiaries in Thoubal',
      'payment failures by block in Churachandpur',
      'Which scheme has the most SLA breach in Imphal West?',
    ];
    const blockDistrict = new Map((sqlite.prepare('SELECT b.name AS b, d.name AS d FROM blocks b JOIN districts d ON d.id = b.district_id').all() as { b: string; d: string }[]).map((r) => [r.b, r.d]));
    const intents = new Set<string>();
    for (const question of questions) {
      const r = await call(officer, '/api/ai/ask', { method: 'POST', body: JSON.stringify({ question }) });
      expect(r.status, question).toBe(200);
      intents.add(r.body.intent);
      expect(r.body.filters.district, question).toBe('Ukhrul');
      for (const row of r.body.rows as Record<string, string>[]) {
        if (row.district) expect(row.district, question).toBe('Ukhrul');
        if (row.block) expect(blockDistrict.get(row.block), question).toBe('Ukhrul');
      }
    }
    expect(intents.size).toBe(6);
  });

  it('executeIntent pins every whitelisted intent to the caller scope', async () => {
    const { executeIntent } = await import('./ai/ask');
    const { getSnapshot } = await import('./services/snapshot');
    const s = getSnapshot();
    const ukhrulBlocks = new Set(s.blocks.filter((b) => b.districtId === UKHRUL).map((b) => b.name));
    const params = [
      { intent: 'pending_by_block', district: 'Imphal West' },
      { intent: 'coverage_gap', district: 'Imphal West', level: 'block' },
      { intent: 'coverage_gap', district: null, level: 'district' },
      { intent: 'attention_ranking', district: 'Imphal West', level: 'block' },
      { intent: 'anomalies_list', district: 'Thoubal' },
      { intent: 'disbursement_failures', district: 'Churachandpur' },
      { intent: 'sla_breach_by_scheme', district: 'Imphal West' },
    ] as const;
    for (const p of params) {
      const ex = executeIntent(s, p as never, UKHRUL);
      expect(ex.filters.district, p.intent).toBe('Ukhrul');
      for (const row of ex.rows) {
        if (row.district != null) expect(row.district, p.intent).toBe('Ukhrul');
        if (row.block != null) expect(ukhrulBlocks.has(String(row.block)), p.intent).toBe(true);
      }
    }
  });

  it('cross-jurisdiction attempts are written to the audit log', async () => {
    await call(officer, `/api/districts/${IMPHAL_WEST}`);
    const row = lastAudit('access.denied');
    expect(row?.user_email).toBe('dist.ukhrul@sevalens.demo');
    expect(JSON.parse(row!.details!)).toMatchObject({ districtId: IMPHAL_WEST, path: `/api/districts/${IMPHAL_WEST}` });
  });
});

describe('PII in responses and logs', () => {
  it('list and anomaly-detail responses never carry raw names, Aadhaar or hashes', async () => {
    const names = (sqlite.prepare('SELECT name FROM beneficiaries WHERE block_id IN (SELECT id FROM blocks WHERE district_id = 4) LIMIT 200').all() as { name: string }[]).map((r) => r.name);
    const appNames = (sqlite.prepare('SELECT applicant_name AS name FROM applications WHERE district_id = ? LIMIT 200').all(UKHRUL) as { name: string }[]).map((r) => r.name);
    const hashes = (sqlite.prepare('SELECT aadhaar_hash AS h FROM beneficiaries LIMIT 50').all() as { h: string }[]).map((r) => r.h);
    const dup = (await call(admin, '/api/anomalies')).body.anomalies.find((a: { type: string }) => a.type === 'duplicate_beneficiary').key;
    const bodies = [
      (await call(admin, `/api/anomalies/${encodeURIComponent(dup)}`)).text,
      (await call(officer, '/api/pendency?limit=500')).text,
      (await call(officer, '/api/pendency/export.csv')).text,
      (await call(officer, `/api/districts/${UKHRUL}`)).text,
    ].join('\n');
    for (const n of [...names, ...appNames]) expect(bodies).not.toContain(n);
    for (const h of hashes) expect(bodies).not.toContain(h);
    expect(bodies).not.toMatch(/\b\d{12}\b/);
  });

  it('Ask questions are scrubbed of identifiers before they reach the audit log', async () => {
    await call(officer, '/api/ai/ask', { method: 'POST', body: JSON.stringify({ question: 'pending case of 2345 6789 0123 ref SW/UKL/2026/000123 born 1950-01-01' }) });
    const details = lastAudit('ai.ask')!.details!;
    expect(details).not.toContain('2345 6789 0123');
    expect(details).not.toContain('000123');
    expect(details).not.toContain('1950-01-01');
    expect(details).toContain('[redacted-id]');
  });

  it('anomaly review notes are scrubbed in the audit log', async () => {
    const key = (await call(officer, '/api/anomalies')).body.anomalies[0].key;
    const r = await call(officer, `/api/anomalies/${encodeURIComponent(key)}/review`, { method: 'POST', body: JSON.stringify({ status: 'reviewed', note: 'checked Aadhaar 234567890123 with the BDO' }) });
    expect(r.status).toBe(200);
    expect(lastAudit('anomaly.review')!.details).not.toContain('234567890123');
  });

  it('a malformed login body is a 400 and the raw body (password) is never logged', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email":"state@sevalens.demo","password":"Hunter2-secret"' });
    const logged = spy.mock.calls.map((c) => c.map((x) => (x instanceof Error ? `${x.stack} ${JSON.stringify(x)}` : String(x))).join(' ')).join('\n');
    spy.mockRestore();
    expect(r.status).toBe(400);
    const body = await r.text();
    expect(body).not.toContain('Hunter2');
    expect(body).not.toMatch(/at \w+ \(|node_modules|SyntaxError/);
    expect(logged).not.toContain('Hunter2');
  });
});

describe('validation and error handling', () => {
  it('bad params are rejected with 400 and no stack trace', async () => {
    for (const u of ['/api/districts/abc', '/api/districts/-1', '/api/attention?level=state', '/api/pendency?limit=100000', '/api/pendency?stage=x', '/api/anomalies/..%2F..%2Fetc', '/api/audit?limit=0', '/api/beneficiaries/1.5']) {
      const r = await call(admin, u);
      expect(r.status, u).toBe(400);
      expect(r.text, u).not.toMatch(/at \w+ \(|node_modules|\.ts:\d+/);
    }
    const bad = [
      ['/api/ai/ask', { question: 'x' }],
      ['/api/ai/ask', { question: 'a'.repeat(301) }],
      [`/api/ai/brief/${UKHRUL}`, { refresh: 'yes' }],
      ['/api/anomalies/dup:block:1/review', { status: 'approved' }],
    ] as const;
    for (const [u, b] of bad) expect((await call(admin, u, { method: 'POST', body: JSON.stringify(b) })).status, u).toBe(400);
  });

  it('an unknown district is a 404, not a 500', async () => {
    for (const u of ['/api/districts/999', '/api/ai/brief/999', '/api/ai/payload-preview/999']) expect((await call(admin, u)).status, u).toBe(404);
    expect((await call(admin, '/api/ai/brief/999', { method: 'POST', body: '{}' })).status).toBe(404);
  });

  it('an oversized body is a 413 with a generic message', async () => {
    const r = await call(admin, '/api/ai/ask', { method: 'POST', body: JSON.stringify({ question: 'x'.repeat(1_100_000) }) });
    expect(r.status).toBe(413);
    expect(r.body).toEqual({ error: expect.any(String) });
  });
});

describe('sessions and cookies', () => {
  it('session cookie is HttpOnly + SameSite=Lax, and logout clears it', async () => {
    const l = await login('dist.ukhrul@sevalens.demo');
    const sc = l.headers.get('set-cookie')!;
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=Lax/i);
    const out = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie: l.cookie } });
    expect(out.headers.get('set-cookie') ?? '').toMatch(/sevalens\.sid=;.*Expires=Thu, 01 Jan 1970/i);
    expect((await call(l.cookie, '/api/meta')).status).toBe(401);
  });

  it('login rotates the session id (no fixation)', async () => {
    const a = await login('dist.ukhrul@sevalens.demo');
    const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: a.cookie }, body: JSON.stringify({ email: 'dist.ukhrul@sevalens.demo', password: PASSWORD }) });
    expect((r.headers.get('set-cookie') ?? '').split(';')[0]).not.toBe(a.cookie);
  });

  it('refuses to start in production with a missing or published session secret', async () => {
    const { createApp } = await import('./app');
    const prev = { env: process.env.NODE_ENV, secret: process.env.SESSION_SECRET };
    try {
      process.env.NODE_ENV = 'production';
      for (const s of [undefined, 'change-me-in-production', 'sevalens-demo-secret-change-me']) {
        if (s === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = s;
        expect(() => createApp(), String(s)).toThrow(/SESSION_SECRET/);
      }
      process.env.SESSION_SECRET = 'a-long-random-secret-for-this-test-only';
      expect(() => createApp()).not.toThrow();
    } finally {
      process.env.NODE_ENV = prev.env;
      if (prev.secret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = prev.secret;
    }
  });
});

describe('rate limits', () => {
  it('successful sign-ins do not use up the login limit (shared venue Wi-Fi)', async () => {
    for (let i = 0; i < 25; i++) expect((await login('state@sevalens.demo')).status, `login ${i}`).toBe(200);
  });

  it('failed sign-ins are limited to 20 per 15 minutes per IP', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) statuses.push((await login('state@sevalens.demo', 'wrong-password')).status);
    expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(20)).toEqual([429, 429]);
  });

  it('AI endpoints are limited to 30 requests per minute', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 32; i++) statuses.push((await call(officer, `/api/ai/payload-preview/${UKHRUL}`)).status);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(1);
  });
});

describe('CSV export', () => {
  it('neutralises spreadsheet formulas in exported cells', async () => {
    sqlite.prepare(`UPDATE applications SET applicant_name = '=HYPERLINK("http://x")' WHERE id = (SELECT id FROM applications WHERE district_id = ? AND decided_at IS NULL ORDER BY submitted_at LIMIT 1)`).run(UKHRUL);
    const { invalidateAll } = await import('./services/snapshot');
    invalidateAll();
    const csv = (await call(officer, '/api/pendency/export.csv')).text;
    expect(csv).not.toMatch(/(^|,)"[=+\-@]/m);
    expect(csv).toContain(`"'=H`);
  });
});
