# ROLE & CONTEXT
You are setting up and building a hackathon prototype in this empty repo. Hard deadline: a working, demo-ready app by 9:00 AM IST today (≈8 hours). Judges want a LIVE working demo, not slides. Optimise for: works offline, never crashes on stage, clear story. No over-engineering.

Hackathon: "National Innovation Challenge on AI & Digital Governance – Manipur" (AI4SEVA).
Problem: SW-04 — AI-Based Welfare Service Gap & Coverage Analysis (Social Welfare Department, Govt. of Manipur).
- Government-side problem: Officials find it hard to identify areas where eligible beneficiaries are not being reached, or where applications and services are piling up.
- Ask: An AI analytics system that analyses beneficiary and service-delivery data to identify (1) coverage gaps, (2) unusual patterns, (3) pending cases, (4) geographic areas needing greater administrative attention.

Judging (design every feature to score here):
- Technical Trust 35%: working prototype, architecture, effective AI, data handling, security & privacy, reliability, responsible AI.
- Government Relevance 30%: problem understanding, dept relevance, practical usefulness, feasibility in govt context, adoption potential.
- Industry Potential 35%: problem–solution fit, innovation, UX, scalability, deployment potential.

Product name: **SevaLens** — "Welfare Coverage Intelligence for Manipur".

# STACK (fixed — do not re-ask)
- npm workspaces monorepo: `apps/api`, `apps/web`, `packages/shared` (shared TS types + zod schemas).
- API: Node 20 + Express + TypeScript (tsx for dev), Drizzle ORM, **SQLite via better-sqlite3** (file DB — zero network dependency on demo day; schema written so it can be swapped to Postgres later — mention this in README), zod validation, cookie sessions (express-session), helmet, express-rate-limit.
- Web: React 18 + Vite + TypeScript + Tailwind v4, React Router, TanStack Query, Recharts, react-leaflet + Leaflet, lucide-react.
- AI: `@anthropic-ai/sdk`, model from env `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`). LLM is OPTIONAL — every AI feature must have a deterministic fallback when `ANTHROPIC_API_KEY` is missing or the call fails/times out (8s). Analytics (scoring, anomaly detection) are pure TypeScript and never depend on the LLM.
- Root scripts: `npm run setup` (install + migrate + seed), `npm run dev` (api + web via concurrently), `npm test`.

# DESIGN
"Harbor" look: navy (#0B1F3A) + teal (#14B8A6) on light slate background, white cards, rounded-xl, subtle borders, Inter font. Dense but clean government-dashboard feel. Desktop-first (projector at 1366×768 must look good), responsive enough for tablet. Severity colours: green/amber/red, colour-blind safe (always pair with a label/icon). Every number on screen has a tooltip explaining how it is computed.

# DATA (synthetic, clearly labelled)
Real public data at beneficiary level is unavailable, so generate realistic synthetic data with a fixed seed (faker + seeded RNG). Show a persistent "Synthetic demo data" badge in the UI.

Geography — all 16 districts of Manipur: Imphal East, Imphal West, Bishnupur, Thoubal, Kakching, Senapati, Kangpokpi, Ukhrul, Kamjong, Tamenglong, Noney, Churachandpur, Pherzawl, Chandel, Tengnoupal, Jiribam. 3–5 blocks/sub-divisions per district (plausible names), each with lat/lng near the real district HQ. District table holds approximate Census-2011-based population, % elderly 60+, % widows, % PwD, % rural, and a terrain/remoteness index (0–1). Mark these as estimates in the seed file.

Schemes (6): IGNOAPS (old age pension), IGNWPS (widow pension), IGNDPS (disability pension), PMMVY (maternity benefit), Post-Matric Scholarship (SC/ST/OBC), State Social Security Pension. Each has eligibility rule fields and SLA days for processing.

Tables (Drizzle): districts, blocks, schemes, beneficiaries (masked Aadhaar = last 4 only + salted hash for dedupe, name, gender, DOB, block_id, village, scheme_id, status active/suspended/deceased, enrolled_at), applications (scheme, block, submitted_at, status submitted/verified/approved/rejected/pending, decided_at, officer_id, pending_stage), disbursements (monthly, beneficiary_id, amount, status success/failed/returned, paid_at), officers, users (role: STATE_ADMIN | DISTRICT_OFFICER with district_id scope), audit_log, insights_cache.

Volume: ~50k beneficiaries, ~15k applications and 18 months of disbursements (keep seed < 30s; batch inserts in transactions).

PLANT these patterns so the demo has a story (keep language neutral — "remote/difficult terrain", never community or political framing):
1. Low coverage in 2–3 remote districts (e.g. Kamjong, Pherzawl, Noney) — enrolled far below estimated eligible.
2. Pendency spike in one Imphal West block in the last 3 months (applications stuck at "verification" stage, SLA breached).
3. Duplicate-beneficiary cluster in one Thoubal block (same Aadhaar hash or near-identical name+DOB+village across schemes that shouldn't overlap).
4. Disbursement failure spike in Churachandpur for the last 2 months.
5. "Deceased but still paid" — ~40 beneficiaries with status deceased and successful payments after the date.
6. One officer with an approval rate/speed far outside peers (approvals in <1 day).

# ANALYTICS ENGINE (apps/api/src/analytics — pure functions, unit-tested)
1. Coverage Gap: estimated_eligible = population × scheme-specific ratio; coverage = active_beneficiaries / estimated_eligible; gap = eligible − enrolled. Per district × scheme and per block.
2. Pendency: open applications, ageing buckets (0–15, 16–30, 31–60, 60+ days), SLA breach %, stuck-stage breakdown, trend vs previous 90 days.
3. Anomaly detection (explainable, no black box):
   - Duplicates: exact hash match + fuzzy name (normalised Levenshtein / Jaro-Winkler) + same DOB + same block.
   - Deceased-still-paid: rule check.
   - Time-series spikes: robust z-score (median/MAD) on monthly applications, rejections, failed disbursements per block; flag |z| > 3.5.
   - Officer outliers: approval rate & median decision time vs peers (robust z).
   Each anomaly record: type, severity, entity, metric, expected vs observed, plain-English reason, count, link to drill-down.
4. Attention Score (0–100) per district and block = weighted, normalised combination of coverage gap, SLA breach %, anomaly severity, disbursement failure rate, remoteness. Weights in one config object and returned with every score as a factor breakdown ("why is this district red?").
Unit tests (vitest) ONLY for the analytics module — coverage math, robust z, duplicate matcher, attention score. Skip tests for UI/CRUD; there is no time.

# AI LAYER (apps/api/src/ai)
- PRIVACY RULE (put in README + show in UI): only aggregated, de-identified statistics are ever sent to the LLM. No names, no Aadhaar, no DOB. Enforce with a `toLLMPayload()` sanitiser that whitelists fields + a unit test proving PII never passes through.
- Features:
  a) District Briefing — "Generate officer brief" button: LLM turns district aggregates + anomalies + attention factors into a 1-page action note (situation, top 3 issues, recommended actions, which block to visit first). Cache in insights_cache. Fallback: template-built brief from the same data.
  b) Ask SevaLens — natural-language question box (e.g. "Which blocks in Ukhrul have the most pending widow pension cases?"). The LLM does NOT write SQL: it maps the question to a fixed set of whitelisted query intents with zod-validated params (tool use / JSON output), the API runs the safe query, then the LLM summarises the result. Fallback: keyword-based intent matcher. Show which intent + filters were used (transparency).
- Every AI output shows: "AI-generated — verify before action", the data timestamp, and the factors it used.

# SECURITY & TRUST
- Login with 2 seeded users: `state@sevalens.demo` (STATE_ADMIN, all districts) and `dist.ukhrul@sevalens.demo` (DISTRICT_OFFICER, Ukhrul only). Password `Demo@2026`, bcrypt-hashed. RBAC middleware enforces district scope on every query server-side (not just in UI).
- Masked PII everywhere in UI (Aadhaar XXXX-XXXX-1234, name partially masked for district list views; full view only on beneficiary detail for authorised role).
- audit_log on login, beneficiary detail views, brief generation, exports. Admin page lists audit entries.
- helmet, rate-limit on /auth and /ai, zod on every input, no stack traces to client.

# SCREENS (apps/web)
1. Login.
2. State Overview: KPI tiles (estimated eligible, enrolled, coverage %, open applications, SLA breach %, active anomalies), Manipur map with district markers (circle size = gap, colour = attention score; try a district GeoJSON if one is reachable, otherwise centroid circles — DO NOT block on GeoJSON), ranked "Areas needing attention" table with factor breakdown.
3. District drill-down: scheme-wise coverage bars, block table, pendency ageing chart, trend lines, anomalies list, "Generate officer brief" button.
4. Pendency: filterable table of stuck applications, ageing heatmap (block × age bucket), stage bottleneck chart.
5. Anomalies: cards grouped by type with severity, reason, expected vs observed, drill-down to records; mark as "Reviewed / False positive" (stored + audited — human-in-the-loop).
6. Ask SevaLens: chat-style panel.
7. Data & Privacy page: data sources, synthetic-data notice, what is sent to AI, model limitations, scoring weights.
8. Bonus only if time remains: CSV upload of new applications that re-runs analytics.

# EXECUTION ORDER (time-boxed — work through without stopping to ask me)
Phase 0 (15 min): Scaffold monorepo, configs, scripts, .env.example, README skeleton. Commit.
Phase 1 (60 min): Drizzle schema + migrations + seed with planted patterns. Print a seed summary verifying each planted pattern exists. Commit.
Phase 2 (75 min): Analytics engine + vitest tests + REST endpoints (`/api/overview`, `/api/districts/:id`, `/api/pendency`, `/api/anomalies`, `/api/attention`). Commit.
Phase 3 (120 min): Web screens 1–5 with real API data. Commit.
Phase 4 (60 min): AI layer (brief + Ask) with fallbacks + PII sanitiser test. Commit.
Phase 5 (30 min): Auth/RBAC/audit polish, Data & Privacy page, error boundaries, loading/empty states. Commit.
Phase 6 (20 min): README (problem, architecture diagram in Mermaid, how to run, judging-criteria mapping, privacy, scaling path: Postgres + scheduled ingestion from scheme MIS/DBT portals + district-level deployment), and `DEMO.md` — a 4-minute click-by-click demo script that walks through each planted pattern.

Rules:
- After each phase run typecheck + tests + start the app and hit the endpoints; fix before moving on. Commit after each phase with a clear message.
- If something is slow or risky (GeoJSON, fancy charts), use the simpler fallback and note it in README.
- The app must start with `npm run setup && npm run dev` on a fresh clone with NO internet and NO API key, and still demo every screen.
- Begin with Phase 0 now.
