# SevaLens API: security review

**Scope:** `apps/api`: every Express route, the Ask SevaLens intent executor, the session and cookie setup, the error handling and the audit log.
**Method:** I read every route and middleware. I then probed the running app with automated tests: the real Express app runs against a freshly seeded, throw-away SQLite database, signed in as the district officer `dist.ukhrul@sevalens.demo` (Ukhrul, district 8) and as the state admin.
**Date:** 9 Oct 2026, commit following `80c797f`.
**Regression suite:** [`apps/api/src/security.test.ts`](../apps/api/src/security.test.ts) has 21 tests. They run with `npm test` and with `npm run preflight`.

Summary: **RBAC held on every route and every Ask intent.** No cross-district read was possible. I found **9 issues**, mostly in logging, error handling and hardening. All 9 are fixed, and each fix has a regression test that failed before the fix and passes after it.

---

## 1. What was checked

### 1.1 RBAC: can `dist.ukhrul` read another district's data?

I tried each endpoint with an explicit foreign district (Imphal West, id 1) and also with no filter. For the no-filter case I checked that the response holds only Ukhrul data.

| Endpoint | Attack tried | Result |
|---|---|---|
| all `/api/*` except `/auth/*` and `/health` | no session | ✅ 401 |
| `GET /api/meta` | none (list) | ✅ only Ukhrul district and blocks |
| `GET /api/overview` | none (list) | ✅ only Ukhrul in districts and attention |
| `GET /api/attention` | `?districtId=1`; `?level=block` | ✅ 403; only Ukhrul blocks |
| `GET /api/districts/:id` | `/districts/1` | ✅ 403 |
| `GET /api/pendency` | `?districtId=1`; `?blockId=<Imphal West block>` | ✅ 403; 0 items, empty heatmap and summary (scope stays pinned) |
| `GET /api/pendency/export.csv` | `?districtId=1`; `?blockId=<foreign>` | ✅ 403; header row only |
| `GET /api/anomalies` | `?districtId=1`; `?includeDismissed=true` | ✅ 403; only Ukhrul |
| `GET /api/anomalies/:key` | every one of the 20+ non-Ukhrul anomaly keys | ✅ 403 for each |
| `POST /api/anomalies/:key/review` | mark every foreign anomaly `false_positive` | ✅ 403 for each, nothing written |
| `GET /api/beneficiaries/:id` | an Imphal West beneficiary id | ✅ 403 (full-PII view) |
| `GET /api/audit` | officer role | ✅ 403 (state admin only) |
| `GET/POST /api/ai/brief/:id` | `/brief/1` | ✅ 403 |
| `GET /api/ai/payload-preview/:id` | `/payload-preview/1` | ✅ 403 |
| `POST /api/ai/ask` | 6 questions, one per whitelisted intent, each naming another district ("…in Imphal West", "…in Thoubal", "…in Churachandpur") | ✅ every answer is filtered to Ukhrul; every row's district or block belongs to Ukhrul; a note says access is limited |
| `executeIntent()` directly | all 6 intents (and both `level`s), with a foreign district | ✅ pinned to the caller's scope |

**Why it holds:** scope comes only from the server-side session (`districtScope()`), never from the request. Officers are pinned in `effectiveDistrict()` and `assertInScope()`. The Ask intent executor overrides any district the LLM or the keyword matcher chose. The LLM never sees or writes SQL.

### 1.2 PII in responses and logs
- I compared list, pendency, CSV and district-detail responses, and the duplicate-anomaly detail, against the raw names, applicant names and Aadhaar hashes in the DB. None appear: names are masked and no 12-digit numbers appear. ✅
- Full PII exists only in `GET /beneficiaries/:id`. That route is scoped and every view is written to the audit log. ✅
- The LLM payload goes through the whitelist sanitiser, which has existing tests in `ai.test.ts`. ✅
- Audit log and server console: **issues found** (see F1, F2 and F3).

### 1.3 Input validation (zod)
Every route parses `params`, `query` and `body` through a zod schema: id params, pendency and anomaly queries, review body, ask body, brief body, audit limit, anomaly-key regex. LLM output is validated a second time with zod before use. I tested bad ids, enums, limits, path-traversal-style keys, over-long questions and wrong body types: all return 400 with no stack trace. ✅ There was no gap in zod coverage. The gaps were unknown ids and body-parser errors (see F4 and F5).

### 1.4 Rate limits
- `/api/auth/login`: 20 requests per 15 minutes per IP. `/api/ai/*`: 30 requests per minute per IP. ✅ Both are present and tested.
- **Issue found:** successful logins counted against the limit (see F6).
- Analytics endpoints have no per-route limit. They require a session, are read-only and are served from an in-memory snapshot, so I accept this for the prototype. For production, add a per-user limiter at the gateway.

### 1.5 Error responses
- `HttpError` messages are user-facing strings. Any other error becomes a generic 500 with no stack trace or internals. ✅
- **Issues found:** malformed or oversized JSON returned 500 instead of 4xx (see F2), and an unknown district returned 500 or 200 (see F5).

### 1.6 Sessions and cookies
- `HttpOnly` ✅, `SameSite=Lax` ✅ (blocks cross-site POSTs; all state changes are JSON POSTs), 8-hour expiry ✅, session id regenerated at login so session fixation is not possible ✅, store in SQLite rather than MemoryStore ✅, timing-equalised login for unknown emails ✅.
- `Secure` is set only when `NODE_ENV=production` and `COOKIE_SECURE=true`. This is intentional because the demo may run over plain HTTP on a LAN. **Production must serve HTTPS and set both variables.**
- **Issues found:** the session secret (F7) and logout leaving the cookie in place (F8).

---

## 2. Findings and fixes

| # | Severity | Finding | Fix | Regression test |
|---|---|---|---|---|
| **F1** | Medium | **Ask questions were written raw to `audit_log`.** If an officer typed an Aadhaar number, an application reference or a DOB into Ask SevaLens, it was stored permanently and shown on the Audit page. The LLM copy was already scrubbed; the audit copy was not. | The audit details now go through the same `scrub()` used by the LLM sanitiser (Aadhaar-like numbers, full dates and `SW/…` refs become `[redacted-…]`). | *Ask questions are scrubbed of identifiers before they reach the audit log* |
| **F2** | Medium | **A malformed JSON body logged the raw request body, including passwords.** body-parser attaches the raw body to its `SyntaxError`, and the error handler `console.error`'d the whole object. A truncated login POST therefore printed `"password":"…"` in plaintext to the server log, and also returned 500. | The error handler recognises body-parser errors (`err.type`, 4xx `err.status`), returns 400 or 413 with a generic message, and does not log them. Other unexpected errors log only `err.stack`. | *a malformed login body is a 400 and the raw body (password) is never logged*; *an oversized body is a 413* |
| **F3** | Low | **Anomaly review notes were written raw to the audit log.** Same class of problem as F1, for free-text notes. | Notes are scrubbed in the audit entry. The review record itself keeps the officer's note, which is scoped and shown only to authorised users. | *anomaly review notes are scrubbed in the audit log* |
| **F4** | Low | **Cross-jurisdiction attempts were not audited.** A district officer probing other districts left no trace. Only successful actions were logged (OWASP A09). | `assertInScope`, `effectiveDistrict` and `requireRole` now write an `access.denied` entry (user, path, district) before returning 403. The Audit page shows it as "Access denied". | *cross-jurisdiction attempts are written to the audit log* |
| **F5** | Low | **Unknown district → 500 or 200.** `POST /ai/brief/999` and `/ai/payload-preview/999` threw a plain `Error` (500). `GET /ai/brief/999` returned `200 {brief:null}`. | `briefFacts()` throws `HttpError(404)`, and `GET /ai/brief/:id` checks that the district exists. | *an unknown district is a 404, not a 500* |
| **F6** | Medium (availability) | **Successful sign-ins used up the login rate limit.** On shared venue Wi-Fi every judge and presenter has the same public IP. The limit is 20 per 15 minutes, and the demo switches between the state and district roles. A full room could lock everyone out, including the presenter. | `skipSuccessfulRequests: true`: only failed attempts count, so brute-force protection stays the same. | *successful sign-ins do not use up the login limit*; *failed sign-ins are limited to 20 per 15 minutes per IP* |
| **F7** | Medium | **The production session secret could be public.** With `SESSION_SECRET` unset, the app used a hard-coded secret from the repo. `.env.example` ships `change-me-in-production`. Anyone who knows the secret can forge session cookies. | In production (`NODE_ENV=production`) the app refuses to start if the secret is missing, under 16 characters, or one of the published values. In dev/demo it warns, as before. | *refuses to start in production with a missing or published session secret* |
| **F8** | Low | **Logout destroyed the server session but did not clear the cookie.** | `res.clearCookie('sevalens.sid')` on logout. | *session cookie is HttpOnly + SameSite=Lax, and logout clears it* |
| **F9** | Low | **CSV formula injection.** The pendency export wrote cells verbatim. An applicant name starting with `=`, `+`, `-` or `@` (masking keeps the first two characters) would run as a formula when the file is opened in Excel. | Text cells starting with `= + - @ \t \r` get a leading `'`. Cells are still quoted. | *neutralises spreadsheet formulas in exported cells* |

I also added tests to lock in the controls that already worked: the RBAC matrix above, 401 on every route, PII-free responses, zod 400s, session-id rotation at login, cookie flags, and the AI rate limit.

---

## 3. Accepted risks and production recommendations

- **Non-`Secure` cookie on HTTP** is a demo-only setting. In production, terminate TLS and set `NODE_ENV=production` and `COOKIE_SECURE=true`. Consider adding HSTS, which helmet already supports.
- **403 vs 404 on `/beneficiaries/:id`** shows an officer that an id exists in another district. The ids are sequential and nothing else is revealed. Every such attempt is now audited (F4).
- **No CSRF token.** `SameSite=Lax` plus JSON-only state-changing endpoints is enough for this prototype. Add a token or double-submit cookie if cross-site embedding is ever needed.
- **Per-IP rate limits.** Behind a reverse proxy, set `trust proxy` correctly (it is currently `loopback`), or every client shares one IP. In production, prefer per-user limits.
- **Free-text review notes** are stored as written. Officers should be trained not to paste identifiers into them.
- **Dependency audit (`npm audit`, 9 Oct 2026):** the API's runtime dependencies are clean. The only runtime advisory is in the web app: `react-router-dom` 6.x has 2 moderate advisories, an open redirect via backslash in `<Link>`/`useNavigate` and an SSR hydration issue. SevaLens builds its links only from static routes and numeric ids, and it does not use SSR. The fix is a major-version upgrade to v7, so I deferred it until after the demo. The remaining advisories (faker, vitest/tinypool, esbuild via drizzle-kit) are in dev, test or seed tooling, which never runs in the request path.
