# SevaLens — 4-minute demo script

**Before going on stage**
- `npm run db:seed` (resets data, reviews and audit log to a clean state), then `npm run dev` (or `npm start` for single-process mode).
- Browser at **1366×768**, zoom 100%, at http://localhost:5173. Close other tabs.
- No internet? Everything still works. The map shows the offline outline and the AI features use their rule-based fallbacks (label: "Template (offline)" / "Keyword matcher (offline)").
- Numbers below are from the deterministic seed (data as of **8 Oct 2026**).

---

### 0:00 — Hook (15 s)
> "Officers in Manipur's Social Welfare Department can't easily see who welfare *isn't* reaching, or where applications are piling up. SevaLens shows them where to act first. Everything here is synthetic data, as the badge says."

### 0:15 — Sign in (10 s)
Click **State admin** → **Sign in**.
> "Role-based: a state admin sees all 16 districts. A district officer sees only their own, and that's enforced on the server."

### 0:25 — State overview (40 s)
- KPI row: **73.8% coverage**, **16,779 eligible people not reached**, **920 open applications, 42.5% past SLA**, **26 anomalies (13 high)**. Hover the ⓘ on *Est. eligible*: "every number explains how it's computed."
- **Map:** big red circles in the south-west and east. "Size is the coverage gap, colour is the Attention Score."
- **Areas needing attention:** Churachandpur 56, Imphal West 51, Pherzawl 51, Kamjong 48, Noney 46. Hover Kamjong's bar to show the breakdown.
> "Five districts are red, for different reasons. The score is transparent: five weighted factors, no black box."

**Planted pattern 1 — low coverage in remote districts:** scroll to the **District scorecard**: Kamjong **18%**, Pherzawl **25%**, Noney **27%** coverage.

### 1:05 — District drill-down: Imphal West (50 s)
Click **Imphal West**.
- "Why is Imphal West red?" → SLA breach +20 and anomalies +20 drive the score.
- **Pendency ageing:** 168 cases at 31–60 days and 160 at 60+ days. **Applications per month:** received jumps from ~150 to ~280 while decisions stay flat.
- **Blocks table:** **Lamshang**, 313 of 473 open cases past SLA.
- Click **Generate officer brief** → situation, top 3 issues, actions, **Visit first: Lamshang**. Point at the footer: "AI-generated, verify before action. Here's the data date and the factors it used."

**Planted pattern 2 — pendency spike in an Imphal West block.**

### 1:55 — Pendency (25 s)
Click **Pendency** in the sidebar.
- Heatmap: Lamshang's row is dark across the 31–60 and 60+ columns.
- **Stage bottlenecks:** the long red bar is **Field verification**.
- "Export CSV gives the block officer the overdue list. Names are masked and the export is audited."

### 2:20 — Anomalies (60 s)
Click **Anomalies**.
- **Payment failure spikes (pattern 4):** Churachandpur blocks show 100–190 failed payments/month against a usual 9–18 (robust z-score). "Probably a PFMS or bank-seeding failure in the last two months."
- **Possible duplicates (pattern 3):** **Thoubal block: 50 pairs.** 30 share the same Aadhaar hash and 20 have near-identical names with the same DOB, mostly enrolled in both the central and state old-age pensions. Click **View records**, then a record ID, to open the full beneficiary view ("this access is now in the audit log").
- **Officer outliers (pattern 6):** Officer **OFF-BPR-023 (Moirang)**: **97% approved, median 9 hours** vs peers at 74% and ~15 days. "A statistical flag for a sample audit, not an accusation."
- **Paid after death (pattern 5):** **40 beneficiaries across 11 districts, ₹97,900** paid after the recorded date of death.
- **Human in the loop:** on the low-severity *Thoubal payment failure* card, click **False positive** and type "volume grew with new enrolments", then **Save**. "Reviews are stored and audited, and false positives drop out of the Attention Score immediately."

### 3:20 — Ask SevaLens (25 s)
Click **Ask SevaLens**, then the suggestion *"Which blocks in Ukhrul have the most pending widow pension cases?"*
- Answer: **Chingai, 27 open, 19 past SLA, mostly at sanction.**
- "The AI never writes SQL. It picks one of six whitelisted queries; you can see the query and filters it used right here."

### 3:45 — Trust close (15 s)
Click **Data & privacy**, then scroll to *What is sent to the AI*.
> "This is the exact payload the AI sees: district aggregates only, no names, Aadhaar or birth dates. A unit test enforces it. And with no internet or API key the whole system still runs, as you've just seen."

*(If time allows: sign out, sign in as **District officer**. The sidebar now says "Ukhrul district", the overview covers Ukhrul only, and opening `/districts/1` returns "outside your jurisdiction".)*

---

### Recovery tips
- **Page shows an error card:** click **Retry**. Only that page is affected.
- **Logged out after a restart:** sessions persist in SQLite, so this only happens after `db:seed`. Sign in again.
- **Data looks changed after rehearsal:** `npm run db:seed` resets everything in about 3 seconds.
