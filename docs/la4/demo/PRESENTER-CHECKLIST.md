# LA-4 team presentation: presenter checklist (4.1–4.20)

About 35 minutes: 6 minutes of slides, 20 minutes of live demo, then questions. Everything is already loaded from the end-to-end run on 2026-10-08 (see `E2E-RUN-2026-10-08.md`); you walk the screens, with one live upload.

## What you'll have open

| What | Where | What it's for |
|---|---|---|
| The deck | https://claude.ai/artifact/VBYz5BVDES1YrsZ3D99VLB | Slides with speaker notes. |
| The demo guide | https://claude.ai/artifact/GthEJmaRA3h88fa9nXfeej | What to say and click on each screen, 4.1–4.20, with the screenshots. |
| The app | `http://localhost:3000` | The live demo, on the demo agency. |
| Sample files | `docs/la4/demo/sample-files/` | `demo-la14-live-update.csv` for the live moment. The others are already in. |
| Screenshots | `docs/la4/demo/shots/` | `01`–`37`, if the demo fails. |
| Run report | `docs/la4/demo/E2E-RUN-2026-10-08.md` | What was loaded and every figure you'll see. |

Both pages are **private**. Share them from each page's Share menu before you send the links.

## The day before

1. Read the guide's **Say** lines once.
2. Check you can sign in as the **demo agency owner** and as **staff** (`/admin`). If you can't, ask Claude to set the sessions up.
3. **Policies, Commission ledger and Discrepancies each have a Source filter.** The demo agency also holds older test data entered by hand, so open those three with `?source=carrier` (the tab list below does), or set **Source: From carrier files**. Without it, the figures include the old data: 128 policies, 152 ledger lines, $6,330 owed.
4. **The real-client spreadsheet and two test leftovers are still on the demo agency** (see the run report, finding 8). Either have them removed, or keep Carrier files **filtered to LA14 Market** throughout, which hides them, and don't open staff Layout maps' "Americno" draft.

## 30 minutes before

1. Start the app: `npm run dev`, then open `http://localhost:3000`.
2. The test carrier LA14 and `chargeback_radar` are already on (left on after the run). If either was reset, run in the Supabase SQL editor:
   ```sql
   update public.carriers set is_active = true where id = '6671c092-edff-49b6-982f-1923941f0dfc';
   update public.feature_switches set state = 'on' where feature_key = 'chargeback_radar';
   ```
3. Sign in as the demo owner. **Import your book** should read LA14 "8 policies, $377/mo. 2 at risk" and **Advances at risk $1,281.78**.
4. Open these tabs, in this order:
   - Carrier files (filter: LA14 Market)
   - `/admin/layout-maps`, then `/admin/status-maps`
   - Import your book
   - Policies: `/app/policies?source=carrier`, then DEMO-1002
   - Commission ledger: `/app/ledger?source=carrier`
   - Rate card
   - Discrepancies: `/app/discrepancies?source=carrier`
   - Lapse risk
   - Book scorecards
   - Carrier rules, Policy matching, Exceptions

## During: the running order

**Part 1 (4.1–4.10), as before:** files and doors, layouts, status maps, the import, rules, matching, exceptions.

**The live moment (4.19 / 4.6 / 4.16):** in Carrier files, upload `demo-la14-live-update.csv` for LA14 Market as a **policy file**, dated **today**. Today must be after Oct 8: a file of the same carrier, type and day replaces the earlier one.
- **Runs:** a new run, every stage, a few seconds.
- **Import your book:** at risk drops from **2 to 1**.
- **Lapse risk:** DEMO-1005 leaves the call list, and its logged voicemail is judged **saved**, so the save rate reads 100%.

**Part 2 (4.11–4.20):**
1. **4.11 Policies (Source: From carrier files) → DEMO-1002:** timeline, then Money.
   - **Money:** advance $400.00 (row 3), still at risk **$177.78**.
   - **Expected:** **$621.00 · $465.75 as an advance**.
   - Open **Source**: each field names its file and row.
2. **4.20, follow a number down:** from the advance's "row 3" → the raw row (every column, "400.00" → 40000 cents, layout v1) → "The whole file" → **Download the original** (a 60-second link, logged).
3. **4.12 Commission ledger (Source: From carrier files):** 10 lines, each with its file row. Net **$3,032** after the $5 fee. If asked about a carrier with no file: **Import statement** at the top; those lines join the same list.
4. **4.14 Carrier accounts tab:** the Oct 6 statement **adds up**, plus **$300 for 1 policy** no file has shown yet.
5. **4.13 Rate card:** 1 of 1 carrier, **100%** of premium covered, **$4,520** expected. The other contracted carriers are listed as *No policies yet*. **Edit** on LA14 shows the product mapping, the rate and the **advance rule** (9 months at 75%, 12-month prorated clawback); close it without saving.
6. **4.15 Discrepancies (Source: From carrier files):** 2 open. DEMO-1002 **paid short $65.75** (tolerance $1.00), and DEMO-1003 **chargeback coming −$233.40**: it lapsed inside the clawback window, so **Coming back** reads $233.40. Don't spend it.
   - **Why** shows the explanation and the line's row.
   - Tick it → **Draft letter**: the dispute letter, figure for figure. Close it **without saving**.
7. **4.16 Lapse risk:** the call list with advance at risk (on Policies, DEMO-1005 and DEMO-1006 read **Critical**: at risk inside the clawback window); the save rate after the live upload.
8. **4.18 Book scorecards:**
   - Today's summary: "1 chargeback was recorded, $265.50".
   - Net commission by week: **$3,031.85**.
   - Chargeback ratio, then persistency "Building", and why.
   - Click any figure to open its rows.
9. **4.19 Carrier files › Runs:** both earlier runs and the live one, stage by stage. **Agent findings:** switch to "Any status".
10. **4.17 Carrier rules:** LA14 30 days, yours, unverified. Pays on the first draft, 21-day lag.

**If anything breaks:** use the screenshots (`shots/`).

## After

1. Turn the test carrier off, and `chargeback_radar` too if it shouldn't stay on for every agency:
   ```sql
   update public.carriers set is_active = false where id = '6671c092-edff-49b6-982f-1923941f0dfc';
   update public.feature_switches set state = 'off' where feature_key = 'chargeback_radar';
   ```
2. Write down the decisions you got:
   - the AI provider;
   - real carrier files;
   - the five missing carriers;
   - the Americo window;
   - removing the test leftovers.

## Questions you may get

- **"Is the money real?"** No: a made-up statement for eight made-up clients on a test carrier, built to show one short payment, one chargeback, one unpaid policy and one line for a policy not yet seen.
- **"Why is DEMO-1008 not flagged as missing?"** Its expected row was priced before today's fix to the first-draft trigger, so it reads "due by Oct 26". Priced rows are never rewritten, by design.
- **"How does it know DEMO-1003's advance is coming back?"** The carrier calls the product "FE Level"; the rate card maps that to final expense, whose advance rule claws back for 9 months. DEMO-1003 lapsed in month 3, so the unearned part, $233.40, is expected back.
- **"What is 'Entered by hand' in the Source filter?"** Policies and statements an agency types in or imports itself, for a carrier that sends no file. They sit in the same lists as the carrier files' data; the filter tells them apart. On the demo agency it's older test data.
- **"Why does persistency say Building?"** It only counts policies issued since the agency's first file (Sep 5). Older policies were only seen if they survived, which would flatter the figure.
- **"Can the AI write the dispute letter or the daily summary?"** Not yet: both are templates over the records. When an AI provider is chosen, its prose must pass a check that refuses any figure not in its input, and any prediction.
- **"Where does a number come from?"** Click it. Every figure opens its rows, and every row opens the line of the carrier file it came from.
