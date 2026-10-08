# SevaLens — demo script (4 minutes, plus a 90-second cut)

**Before going on stage**
- **The night before, on good Wi-Fi:** `npm run db:seed && npm run build`, then warm the AI cache so nothing is generated live on venue Wi-Fi:
  - with `ANTHROPIC_API_KEY` set: `npm run ai:warm` (AI briefs for every district in this script plus the Ask suggestions; exits non-zero if anything fell back), or
  - without a key: `npm run cache:warm` (caches the template briefs for all 16 districts).
- **At the venue:** `npm run preflight` and confirm it prints ✅ READY. Warnings about the AI key or ping are fine: the app falls back to its offline mode. Then `npm start` (single process on :4000) or `npm run dev` (:5173).
- **The CSV upload changes the data.** After every rehearsal: stop the server, `npm run db:seed`, warm again, restart. The server caches analytics in memory, so a re-seed only shows up after a restart.
- Browser at **1366×768**, zoom 100%, full screen (F11), at http://localhost:5173 (or :4000 for `npm start`). Close other tabs.
- Have `samples/new_applications_demo.csv` ready in the file picker's last-used folder (Downloads or Desktop).
- No internet? Everything still works. The map shows the offline outline and the AI features use their rule-based fallbacks (labelled "Template (offline)" / "Keyword matcher (offline)").
- Numbers below are from the deterministic seed (data as of **8 Oct 2026**).

---

## Full demo — 4:00

| Time | Section | Length |
|---|---|---|
| 0:00 | Hook | 15 s |
| 0:15 | Sign in | 10 s |
| 0:25 | State overview | 35 s |
| 1:00 | Imphal West: why red, brief, action | 45 s |
| 1:45 | 60-day forecast | 15 s |
| 2:00 | Pendency | 15 s |
| 2:15 | Anomalies + human review | 40 s |
| 2:55 | Field actions board | 10 s |
| 3:05 | CSV upload, live re-score | 25 s |
| 3:30 | Ask SevaLens | 15 s |
| 3:45 | Trust close | 15 s |

### 0:00 — Hook (15 s)
> "Officers in Manipur's Social Welfare Department can't easily see who welfare *isn't* reaching, or where applications are piling up. SevaLens shows them where to act first, and turns that into an assigned task. Everything here is synthetic data, as the badge says."

### 0:15 — Sign in (10 s)
Click **State admin** → **Sign in**.
> "Role-based: a state admin sees all 16 districts. A district officer sees only their own, enforced on the server."

### 0:25 — State overview (35 s)
The first screen tells the story without scrolling:
- **Areas needing attention** (left): **Churachandpur 56, Imphal West 51, Pherzawl 51**, then Kamjong 48 and Noney 46. Each row says *why* in one line, e.g. Imphal West: "SLA breach: 323 of 524 open cases past SLA". Hover Imphal West's bar to show the five-factor breakdown.
- KPI row: **73.8% coverage**, **16,779 eligible people not reached**, **920 open applications, 42.5% past SLA**, **26 anomalies (13 high)**, **3 open field actions (1 overdue)**. Hover the ⓘ on *Est. eligible*: "every number explains how it's computed."
- **Map** (right): red circles in the south-west and east. "Size is the coverage gap, colour is the Attention Score."
> "Five districts are red, for different reasons. The score is transparent: five weighted factors, no black box."

### 1:00 — District drill-down: Imphal West (45 s)
Click **Imphal West** in the attention list.
- **Why is Imphal West red?** SLA breach +20 and anomalies +20 drive the score.
- Scroll to **Officer brief**. It is already there if you warmed the cache (otherwise click **Generate officer brief**): top 3 issues, actions, **Visit first: Lamshang** (313 of 473 open cases past SLA). Point at the footer: "AI-generated, verify before action, with the data date and the factors it used."
- In the *Visit first* box, click **Create action**. Title, block and a due date are prefilled, so just click **Create action** in the dialog. "The insight is now a task assigned to an officer, and it's audited."

### 1:45 — 60-day pendency forecast (15 s)
Scroll down one card.
- Banner: **"Imphal West will have ~640 cases past SLA by 7 Dec (up from 323 today); clearing it needs ~11 extra verifications per day."**
- "Dashed is the forecast, the band is an 80% range. It's simple trend smoothing and the method is in the ⓘ, not a black box." *(Optional: switch **Area** to **Lamshang**.)*

### 2:00 — Pendency (15 s)
Click **Pendency** in the sidebar.
- Heatmap: **Lamshang** is dark across 31–60 days (166) and 60+ days (152).
- **Stage bottlenecks:** the long red bar is **Field verification**.
- "Export CSV gives the block officer the overdue list. Names are masked and the export is audited."

### 2:15 — Anomalies (40 s)
Click **Anomalies**.
- **Payment failure spikes:** Churachandpur blocks show 105–174 failed payments a month against a usual 9–18 (robust z-score). "Probably a PFMS or bank-seeding failure."
- **Possible duplicates:** **Thoubal block: 50 pairs.** 30 share an Aadhaar hash and 20 have near-identical names with the same DOB. Click **View records**, then a record ID, to open the full beneficiary view ("this access is now in the audit log"). Close it.
- **Officer outlier:** **OFF-BPR-023 (Moirang)**: **97% approved, median 9 hours** vs peers at 74% and ~15 days. "A flag for a sample audit, not an accusation."
- **Human in the loop:** on the low-severity *Thoubal* payment-failure card, click **False positive**, type "volume grew with new enrolments", **Save**. "False positives drop out of the Attention Score immediately."

### 2:55 — Field actions (10 s)
Click **Field actions**.
- The Lamshang visit you just raised sits in **Open** next to the seeded tasks. The overdue Lamshang backlog task is outlined in red.
> "Every anomaly card and every brief has a *Create action* button, so nothing stops at a dashboard."

### 3:05 — CSV upload, live re-score (25 s)
Click **Data ingest** → choose `samples/new_applications_demo.csv` → **Upload and validate**.
- **300 rows: 296 accepted, 4 rejected**, each with its row number and reason (unknown block code, bad date, bad status, malformed Aadhaar). "Aadhaar is hashed on arrival and never stored."
- **Impact on attention scores:** **Kakching 23 → 53 High.** Click **Open state overview →**: Kakching is now **#2** in *Areas needing attention*.
> "New data from the scheme MIS is re-scored in seconds."

### 3:30 — Ask SevaLens (15 s)
Click **Ask SevaLens**, then the suggestion *"Which blocks in Ukhrul have the most pending widow pension cases?"*
- Answer: **Chingai, 27 open, 19 past SLA, mostly at sanction.**
- "The AI never writes SQL. It picks one of six whitelisted queries; you can see the query and filters here."

### 3:45 — Trust close (15 s)
Click **Data & privacy**, then scroll to *What is sent to the AI*.
> "This is the exact payload the AI sees: district aggregates only, no names, Aadhaar or birth dates. A unit test enforces it. And with no internet or API key the whole system still runs."

*(If time allows: sign out, sign in as **District officer**. The page now says "Ukhrul overview" and lists Ukhrul's blocks, Chingai first. Opening `/districts/1` returns "This district is outside your jurisdiction".)*

---

## 90-second cut

Same setup. Sign in before you start, so the overview is already on screen.

| Time | Do | Say |
|---|---|---|
| 0:00 | Overview on screen. Point at **Areas needing attention**. | "SevaLens shows Manipur's welfare officers where to act first. Churachandpur, Imphal West and Pherzawl are the top three, each with its reason. 16,779 eligible people aren't reached and 42.5% of open applications are past SLA. Synthetic data." (20 s) |
| 0:20 | Click **Imphal West**. Point at *Why is Imphal West red?*, scroll to the **Officer brief**. | "SLA breaches and anomalies drive the score. The brief says visit Lamshang first: 313 of 473 cases past SLA." (15 s) |
| 0:35 | Click **Create action** in *Visit first* → **Create action**. | "That's now an assigned, audited task." (10 s) |
| 0:45 | Scroll to the **forecast** banner. | "At this rate it's ~640 overdue by 7 Dec. Clearing it needs ~11 extra verifications a day." (10 s) |
| 0:55 | **Data ingest** → upload `new_applications_demo.csv`. | "296 rows accepted, 4 rejected with reasons. Kakching jumps from 23 to 53, re-scored live." (20 s) |
| 1:15 | **Data & privacy** → *What is sent to the AI*. | "The AI only sees aggregates, never names or Aadhaar, and everything works offline." (15 s) |

---

### Recovery tips
- **Page shows an error card:** click **Retry**. Only that page is affected.
- **Brief or Ask is slow:** the AI call has an 8-second deadline, then falls back to the offline template automatically. Keep talking.
- **Logged out after a restart:** sessions persist in SQLite, so this only happens after `db:seed`. Sign in again.
- **Data looks changed after rehearsal (e.g. Kakching is #2 before the upload):** stop the server, `npm run db:seed`, warm the cache again, restart, then `npm run preflight`.
