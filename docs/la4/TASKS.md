# LA-4: Book of Business (the money spine)

**Module 4.** This completes the **Ledger** tier ($99, code `basic`). See the [roadmap](../roadmap/ROADMAP.md).

**Phase gate:** a real CSV or XLSX carrier statement produces an "owed to you" figure that a person can trace back to the arithmetic, plus a printable dispute letter.

**Already built** (verified 2026-10-02, about 40% of the module):
- Policies (`/app/policies`) and CSV statement import. Column-mapping memory is in `tenant_statement_column_mappings`.
- Exact policy-number + carrier matching: `proposeExactMatches`, accepted by a person.
- Per-policy reconciliation: `reconcileStatements`, returning agrees / short / over / unpriced, with a $1 tolerance.
- The commission ledger, computed from carrier schedules including advances and clawbacks (`lib/ledger/compute.ts`).
- The appointment vault.

**Missing:**
- The original statement file is never stored (only its name and sha).
- No Excel on the server, and no PDF path.
- No name matching.
- No discrepancy store, engine or page.
- No persistency.
- No "owed" figure.
- No policy money panel.
- The ledger read is unpaged, so it silently stops at 1,000 rows.
- There is no reliable lapse date (`updated_at` is used instead).

**Decisions:**
- CSV and XLSX are parsed. PDFs are stored and lines are typed in by hand, with **no AI or provider calls**.
- Plan display names change to Ledger / Basic / Advanced as data only; `plans.code` stays.

**Rules for every task in this phase:**
- Gating:
  - pages use `guardPage(feature)`;
  - API routes use `requireFeature(feature, { write: true })` for every write;
  - every new route goes into `lib/entitlements/agentApiPolicy.ts`.
- Money routes are for owner, producer (own policies only) and bookkeeper. Assistants get a 403 (`lib/tenantAuth/moneyRoutes.test.mjs`).
- Every new audit action goes into `lib/audit/actions.ts`.
- UI follows [UI-CONSISTENCY.md](../design/UI-CONSISTENCY.md).
- Database:
  - migrations end with a `do $$` self-check;
  - no session `SET` on the pooler;
  - every service-role query filters `tenant_id`.
- A read-only (suspended) subscription can read everything here, and every write returns `read_only`.

**Progress:**
- **2026-10-02: LA-4.1–4.3 built.** The migration is `20261002100000_la_4_1_4_3_statement_files_entry_matching.sql` and has **not been applied yet**.
- Until it is applied, CSV import works exactly as before (checked live).
- PDF storage, original-file links, name matching, re-matching and re-processing switch on once it is applied.
- **2026-10-02: migration 20261002100000 applied and verified live.** 25 checks pass (store, download, Excel, PDF entry, exact and name match, re-process). Re-match never re-proposes a pairing a person rejected.
- **2026-10-02: LA-4.4–4.6 built.** This covers the engine, store, page, letter, dashboard tile and checklist step. The migration is `20261002110000_la_4_4_commission_discrepancies.sql`, **not yet applied**. Until it is, the page and tile say a database update is needed, and statements work as before.
- **2026-10-02: LA-4.7–4.9 built.**
  - 4.7: `tenant_policies.status_changed_at` (migration `20261002120000_la_4_7_policy_status_changed_at.sql`, **not yet applied**) and a paged book read (`readBook`). Until it is applied, the lapse date falls back to `updated_at` as before.
  - 4.8: `/app/persistency` (months 3/6/9/13, by carrier and by lead source, cells under 5 policies show "—"). Checked live on the demo agency. Every demo policy is "Unattributed" because none came through a closed sale.
  - 4.9: `/app/policies/[id]`, linked from the insured's name on Policies. Checked live: the advance figure matches hand arithmetic, and an unknown id is not found.
- **2026-10-03: migrations 20261002110000 and 20261002120000 applied and verified live** (catalog verifier).
  - Discrepancies: the API, the page and the dashboard agree to the cent. The Foresters dispute letter adds up ($994.00 + $333.90 + $64.35 = $1,392.25). The policy page shows its open finding.
  - Status dates: all 120 demo policies are dated (22 ended ones from `updated_at`, 98 live ones from `created_at`).
  - **Fixed a false positive in "never paid".** It used to claim every entry expected since issue, up to the last statement, so a 2025 advance counted against a May–July 2026 statement. Now it claims only entries whose payment window (due date to +45 days) a statement reported.
  - Live effect: 21 findings / $9,397.27 became 18 / $6,817.42. The three no longer supported are "cleared", not deleted.
- **2026-10-03: LA-4.10 built.**
  - Read-only: every Book of Business write handler refuses a read-only account and every read stays open. This is pinned by a test over all 15 handlers. The pages were already disabling controls with a reason.
  - Plan names: migration `20261003100000_la_4_10_plan_display_names.sql` (live, verified 2026-10-06). It renames `plans.name` (basic → Ledger, pro → Basic, advance → Advanced; codes unchanged) and puts `plan_name` in the entitlement blob, patched in place and CRLF-safe (backlog #75). A rename refreshes the affected tenants. The agent app shows the blob's name and falls back to the tidied code.
- **2026-10-06: LA-4.1 completion pass.** All 4.1 acceptance criteria are met.
  - **Fixed:** the import preview's duplicate check never fired for Excel files. It now uses the original file's hash.
  - **Fixed:** any storage error other than a missing bucket used to import the statement without its original. Now it stops the import.
  - **Fixed:** the stale comment in `xlsx.ts`, and the "Import 1 lines" copy.
  - **Tests:** a behaviour test reads a real workbook into the same lines as the equivalent CSV (with a hidden first sheet and leading zeros), plus checks for the preview hash and the store-before-write order.
  - **Verified live on the demo tenant:**
    - a stored Excel original downloads byte-identical to its recorded SHA-256;
    - the preview flags a duplicate when given the original file's hash, and does not without it;
    - the dialog sends that hash;
    - ten bad uploads each get a 400 with an actionable sentence, before anything is stored: wrong type, empty, over 4 MB, a mislabelled PDF, a mislabelled Excel file, a binary "CSV", no file, no carrier, an unreadable mapping, a backwards period;
    - "Original file" shows only when an original was kept, and its link saves under the carrier's file name;
    - the live catalog matches the migration:
      - the bucket is private, capped at 10 MB, and accepts CSV, XLSX and PDF only;
      - `import_commission_statement_v2` is executable by `service_role` only;
      - all five file columns exist.
    
    Nothing was imported.
  - **Design spec:** [02-AGENT-APP §23a](../design/02-AGENT-APP.md). The tracker row is 177.
- **2026-10-06: LA-4.2 completion pass.** All 4.2 acceptance criteria are met.
  - **Fixed: read-only.** A read-only account was shown the entry grid with its inputs disabled. Now it sees the PDF and one warning line, never the grid. The list's row button reads "Open", not "Enter lines", for that account.
  - **Fixed: one reader.** Typed lines were read by a hand copy of the CSV rules. Both now go through one shared reader, `readStatementLine` in `statementParse.ts`, so they cannot drift. A test feeds the same six lines through both paths and gets identical results: a positive chargeback, kind from the sign, a `$1,000.00` amount, a US date, an unreadable amount and date, and no amount.
  - **Added: drafts.** Typed lines are kept as a draft in the browser until they are recorded (`usePersistedState`). Leaving the page loses nothing, a failed record keeps the draft, and Clear asks first.
  - **Added: the count.** The page's "To review" tile counts PDFs waiting for their lines.
  - **Removed:** the explanatory paragraph under the grid (UI-CONSISTENCY §3). Its rules are the column headers' titles.
  - **Verified in the browser,** through a temporary route rendering the real component against the demo tenant's voided PDF statement (since deleted):
    - lines are checked as they are typed;
    - the draft survives a reload with no hydration error;
    - Record against a statement not awaiting entry gets the 409 sentence and keeps the draft;
    - read-only shows the PDF and the reason, with no grid.

    Nothing was written. The demo tenant has no statement awaiting entry.
  - **Design spec:** [02-AGENT-APP §23b](../design/02-AGENT-APP.md). The tracker row is 178.
- **2026-10-06: LA-4.3 completion pass.**
  - **Decision (option c).** Re-match covers lines a person left unmatched only when they tick "Include N left unmatched", which is off by default, on the statement and on the Unmatched lines tab. This replaces the spec's "always include" and the code's "never include".
  - **Migration `20261006100000_la_4_3_rematch_left_unmatched.sql`** (**live**, verified 2026-10-06):
    - `rematch_commission_statement_lines` gains `p_include_left_unmatched boolean default false`, replacing the 3-argument form;
    - the database itself now refuses to re-propose a rejected (line, policy) pair;
    - the result logs each line's previous state (`was`);
    - it ends with a self-check.
  - **Until it is applied,** plain re-match works exactly as before, because it still sends 3 arguments. Ticking the box returns "Re-matching the lines you left unmatched needs a database update…" (503).
  - **Shared component.** `ToolbarCheckbox` was added to `components/ui/data-toolbar.tsx`: a 36px option row for the toolbar.
  - **Tests.** The name-match tests moved into `statementMatch.test.mjs` as the spec asks (ambiguous name, other carrier, unique name, amount tie-break). New tests pin the opt-in end to end: migration, service, schema, both routes' audit metadata, and both screens.
  - **Verified live, read-only:**
    - the Unmatched lines tab holds 10 lines, equal to the statement summaries' total, statement by statement;
    - the 2 lines left unmatched (Foresters) stay out of the queue;
    - the statement page shows "Re-match 0" disabled with its reason, and "Re-match 2" when ticked;
    - the tab shows "Re-match 10", and "Re-match 12" when ticked;
    - a non-boolean option gets a 400.
    
    Re-match itself was not pressed, because it writes proposals on shared demo data.
  - **Re-process.** It was verified live on 2026-10-02 (it voids and keeps the original, and links `reprocessed_from`) and is unchanged.
  - **Name-match reason text.** It stays as built ("Insured name[, carrier and amount] match … Check before accepting"), which is more precise than the spec's "name + amount".
- **2026-10-06: LA-4.4 completion pass.** Three defects fixed:
  - **A resolved finding hid repeats.** `never_paid` and both chargeback kinds were keyed by policy alone, so a resolved finding hid the same kind on that policy forever.
  - **Disputes were lost.** `short_paid` and `mis_rated` were keyed by every period reported, so each new statement replaced the finding and its dispute (seen live: a dispute is cleared and an "open" twin appears).
  - **Only the last change was kept.** A single `status_changed_by/at` instead of who and when for every change.

  The changes:
  - **Fingerprints v2**, anchored where the problem started:
    - `never_paid|policy|issue:<date>`;
    - `<kind>|policy|from:<first period>` for short-paid, wrong rate and duplicate chargebacks;
    - `unexpected_chargeback|policy|<start>~<end>`, one per chargeback period.

    A later statement now grows the same finding.
  - **Reopen when worse.** A resolved or written-off finding reopens when the carrier owes at least $1 more than when it was decided (`planRefresh`, pure). The decision covers the money it was made about.
  - **History.** A `history` jsonb column, append-only by trigger, holds every status change by a person or by the refresh. The finding's dialog shows it.
  - **Migration `20261006110000_la_4_4_discrepancy_fingerprints_history.sql`** (**live**, verified 2026-10-06) adds history, backfills it, and re-keys the stored rows to v2. On a collision, the finding still being worked keeps the key. It ends with a self-check.
  - **Until it is applied,** the app keeps computing v1 fingerprints. It detects the migration by the `history` column, so nothing churns in between.
  - **Upsert safety.** Every upserted row now carries every status column. A batch writes the union of its keys, so a missing one would null what a person recorded.
  - **Tests:**
    - a September statement keeps August's short-paid key;
    - v1 is reproduced exactly;
    - one unexpected chargeback per period;
    - the duplicate's anchor;
    - the refresh rules (open, reopen, keep decided, reopen only when worse, clear);
    - idempotence (plan, apply, plan again: nothing changes);
    - the migration's shape.
  - **Verified live, nothing committed:**
    - a dry run of the re-key over all 21 stored findings (18 open, 3 cleared): every one maps, with no collisions and no open finding left on a v1 key;
    - both new functions compile, and the re-key and backfill queries plan, against the real database in a rolled-back transaction;
    - before the migration, opening /app/discrepancies (which refreshes) left all 21 rows byte-identical, at $6,817.42 owed.
  - **Not changed:** the five rules, the coverage and grace guards, and the reading of the book, which stays a separate reader from `readBook`.
- **2026-10-06: LA-4.5 completion pass.**
  - **Decision (option a): the page only reads.**
    - Opening /app/discrepancies, `GET /api/app/discrepancies` (its `?refresh=1` is removed) and opening a letter write nothing, for any account.
    - The findings are recomputed after every change to their facts. Statements already did this in 4.4. Policy create, edit and import, a lapse resolved on Lapse risk, contract levels, commission schedules and advance rules now do too, through `after(() => refreshDiscrepanciesQuietly(tenantId))`, so the change is never slowed.
  - **API completed to the spec:**
    - `GET /api/app/discrepancies/[id]`, which returns one finding with its history (404 for another workspace's);
    - `PATCH /api/app/discrepancies` `{ ids, status, note? }`, one decision on up to 200 findings. Each finding gets its own audit row, and cleared or foreign ones are skipped and reported.

    The page's decisions now go through it, so a bulk "Mark disputed" is one request, not N.
  - **The letter.**
    - Opening or reloading it no longer writes an audit row.
    - Print calls the new `POST /api/app/discrepancies/letter` (registered; reading, so a read-only account may), which records one `tenant.dispute_letter_generated` with exactly what the letter lists.
    - For accounts that can decide, Print can also mark the letter's open findings disputed. It is on by default, and that is what "disputed" means.
    - What a letter lists is one shared rule, `letterItems`, used by both the page and the route.
    - The recipient is editable and remembered per carrier in the browser, because the carrier library has no commissions-department address.
    - It prints black on white.
    - Its two `text-[Npx]` offenders are gone, and the ratchet is lowered 2 → 0.
    - No pdf-lib PDF: the print dialog's "Save as PDF" covers it, and email stays out, per the spec.
  - **Verified live:**
    - opening the page, `GET` on the list and on one finding, and opening a two-finding letter left all 21 stored findings byte-identical (`last_seen_at` included), with the letter audit count unchanged (3 → 3);
    - the letter's total equals the sum of its rows ($544.00 + $5.20 = $549.20);
    - another carrier's finding on a letter → 404, nothing recorded;
    - an empty selection → 400;
    - "cleared" cannot be set → 400;
    - an unknown id → 404.

    Print's success path, which writes an audit row and possibly disputes demo findings, was not pressed on shared data.
  - **Design spec:** [02-AGENT-APP §23c](../design/02-AGENT-APP.md). The tracker rows are 179 and 180.
- **2026-10-06: LA-4.6 completion pass.**
  - **Fixed: the tile's figure.** It rounded to whole dollars ("$6,817") while the Discrepancies page shows "$6,817.42", so the acceptance "the figure equals the page total" failed on cents. It now uses the page's own `statementMoney`.
  - **Fixed: a false all-clear.** With statements imported but none reviewed, the tile read "$0 · Every accepted statement line agrees with your contract", a $0 claim with nothing behind it. It now reads "— · review your statement". "$0.00" appears only when reviewed statements agree, and it notes any still to review.
  - **Tests added (the spec's missing ones):** `book.owed` is visible to owner and bookkeeper, hidden from producer, assistant and setter, and hidden without `discrepancy_report` even for an owner. The figure uses the page's formatter, and the two no-$0 states are pinned. The checklist test (statement step → `/app/statements?import=1`, done once a statement stands) was already there.
  - **Verified live:** the demo dashboard tile reads "$6,817.42 · 18 items", equal to the Discrepancies page and API total (681742 cents), with no overflow.
  - **Spec:** the dashboard section (§1) of [02-AGENT-APP](../design/02-AGENT-APP.md) now covers the tile and the checklist step.
  - **Decided 2026-10-06: only a reviewed statement is evidence.**
    - An unreviewed statement (in review, or a PDF waiting for its lines) is no coverage for "never paid".
    - The days it covers are not judged at all, for its carrier: `computeDiscrepancies({ pending })` drops expected and received money dated inside them. An undecided line can therefore neither hide a payment nor make the carrier look short.
    - An accepted line still counts as received wherever it sits.
    - Dry run on the demo before the next refresh: $6,817.42 → $6,264.72.
      - 3 short-paid findings that rested on months still under review clear ($544.00, $5.20, $15.70).
      - 3 Americo findings show their true March–June shortfall (+$5.90, +$4.32, +$1.98). July–August, still under review, had been masking it with a small overpayment.
    - 3 new engine tests cover it.
  - **Both 2026-10-06 migrations are live** (`20261006100000`, `20261006110000`; catalog verifier). The finding dialog's History was checked on the live page.
  - **Incident, put right:** a check script's selector fell back to a row's first button and marked demo finding QA-D1-0040 ($994.00) resolved. With the user's agreement it was reopened at once through the app, with a note. Its history shows both changes, and the total is back to $6,817.42.
- **2026-10-06: LA-4.7 completion pass.** Both acceptance criteria are now proven by behaviour, not by reading the source.
  - **A 2,500-policy book is read in full.**
    - The paging loop moved into a pure `lib/supabase/readPaged.ts`, which `readBook` uses.
    - `readPaged.test.mjs` runs it against a fake PostgREST that caps every answer at 1,000 rows:
      - 2,500 rows come back in order in three pages;
      - an exact 2,000 asks once more and stops on the empty page;
      - 0, 1 and 999 rows are one request each;
      - an error mid-read is returned, never passed off as a short book.
    - The order (`effective_date desc, id`) is served by the live index `(tenant_id, effective_date DESC)`.
  - **Editing a lapsed policy's premium does not move its lapse date.**
    - Proven on the real database server, nothing committed: the LIVE trigger function's own body, attached to a temporary table inside a rolled-back transaction.
    - A premium edit keeps 2026-03-15. An edit that sends a different date keeps it. Re-saving the same status keeps it.
    - A status change, or an insert without a date, stamps `now()`.
    - The live function equals the migration's, and the trigger is enabled, BEFORE INSERT OR UPDATE.
  - **Also:** the stale `LedgerPolicy.statusChangedAt` comment, which named `updated_at`, is fixed.
  - **Verified live:** the ledger reads all 120 demo policies (`policiesRead` 120 = the book), and persistency answers 200.
- **2026-10-06: LA-4.8 completion pass.**
  - **Added: by issue cohort,** which the goal names and the page lacked: `issueCohort` gives the calendar quarter. A quarter rather than a month, so a typical book's cells reach the 5-policy minimum. One row per quarter, newest first, judged by the same rules. Tests pin the quarter boundaries and that every policy sits in exactly one row.
  - **Fixed: small cells.** A cell under 5 policies showed "—" with "2/3" printed beside it. It now shows the dash alone, with the counts and the reason in its title and `aria-label`.
  - **Fixed: silent lead-source failures.** A failed lead-source read became "Unattributed" for every policy (`.catch(() => [])`). Now a missing table is honestly empty, a real failure is logged and said in one warning line, and the policy page reads "unavailable right now" instead of "Unattributed".
  - **Fixed: lead-source matching.** The join used `trim().toUpperCase()`. It now uses `normalisePolicyNumber`, the statement matcher's, so "MO-1001" and "mo 1001" are one policy.
  - **Tables:** each breakdown is a `PersistencyTable`, a `TableCard` with a `DataToolbar` (search, Clear, Refresh) and the shared `Pager`.
  - **Caught live:** the server page called a formatter exported from the client file, which crashed it (typecheck passes this). The formatter moved to `compute.ts`, and a test pins that only the component crosses.
  - **Verified live:** the three tabs (cohort 7, carrier 7, lead source 1) and the month-9 strip "77% · 33/43 · carriers look for 65%". 2026 Q3, too young, shows dashes. Small cells have the dash alone with "2 of 2 in force at month 3; a rate needs 5 policies" on hover. The policy page still reads "lead source Unattributed".
  - **Design spec:** [02-AGENT-APP §23d](../design/02-AGENT-APP.md). The tracker row is 181.
- **2026-10-06: LA-4.9 completion pass.**
  - **Fixed: the page read the whole tenant.** For one policy it read the entire statement ledger (every accepted line, plus the whole book again to scope them), every discrepancy, and every issued record, vendor and campaign. It now reads only this policy's:
    - `getPolicyStatementLines`: one query filtered by tenant and policy;
    - `listDiscrepancies({ policyId })`;
    - `leadSourceOf`, which asks for the issued records whose number matches a pattern on this policy's letters and digits, confirms each with the same normalisation the report uses, then reads one vendor or campaign.
  - **Fixed: a failed discrepancy read looked like none.** It was `.catch(() => ({ available: false, items: [] }))`, so an error read as "no open discrepancy". It is now one warning line.
  - **Tests:** the per-policy reads, the tenant filter on every persistency-service read, and no swallowed failure.
  - **Verified live on QA-D1-0040:** the page equals that policy's ledger rows ($1,192.80 earned, $198.80 paid from 2 accepted lines, no advance, $994.00 open short-paid). The tabs read 1 / 1 / 2, an unknown id renders Not found, and the lead source reads.
  - **Design spec:** [02-AGENT-APP §23e](../design/02-AGENT-APP.md). The tracker row is 182.
- **2026-10-06: LA-4.10 completion pass.** Both acceptance criteria are met.
  - **Read-only, server.** A new test covers every route registered under the five Ledger-plan features: 48 files and 72 handlers. Every GET stays readable, and every write requires `write: true`. The three body-carrying POSTs that write nothing (statement preview, template preview, letter record) are allowlisted, and the test proves they make no insert, update or RPC. The old hand-kept list of 10 files is kept beside it.
  - **Read-only, screens.**
    - Policies, statements, the statement page, the ledger and discrepancies already disabled their writes with a reason.
    - **Fixed: appointments** hid editing from a read-only owner without saying why. It now shows one line.
    - **Fixed: Settings**, which holds the carrier library, contract levels, licences and every other panel, had no read-only handling. Now one notice shows and one `<fieldset disabled>` disables every control in the panel, so no panel can forget. The navigation rail and **Billing** stay usable, since Billing is how the account is reactivated.
    - Checked in the browser through a temporary route (since deleted) rendering the real Settings with `readOnly`: the notice shows, all 8 controls in the panel are disabled, the 30 rail tabs work, and Billing has no fieldset and keeps its link.
  - **Plan names (live):** `basic` → Ledger, `pro` → Basic, `advance` → Advanced, with codes unchanged.
    - The entitlement record carries `plan_name` for every tenant with a subscription.
    - The 10 real-plan records without one are QA fixtures with no subscription, which the migration rightly skipped.
    - Coupons reference plans by id.
    - The Whop provider maps by code (`whop_plans`), never by name.
  - **Copied names, decision for the owner:** 38 issued `platform_invoice_lines` read "Basic v1 — monthly". They are invoices for the plan now called Ledger, and "Basic" now names the $249 plan. Issued invoices are financial records, so they are left as issued. New invoices use the new names.
  - **`verify-entitlements` passes.** It was run with the owner's approval against production, using a throwaway tenant, and cleaned up; no leftover tenant was confirmed.
    - The first run showed `pro` and `advance` with 3 more features than the verifier's reviewed lists: `ai_assistant`, `carrier_extension`, `sales_report`.
    - LA-3's migration (20260926100000) granted those on purpose to the plans holding `applications`, so the verifier's lists were updated with that citation.
    - The second run: "All entitlement checks passed". That includes suspended → `read_only` with features kept, and cancelled → `none`.
    - `lib/features/planSeed.test.mjs`, which keeps the verifier's lists equal to the migrations, read only the SA-2.x seed. It now also applies later migrations' "grant to the plans holding X" rules and later catalog inserts. That is why the verifier's LA-3 drift had gone unnoticed.
- **2026-10-06: LA-4.11 closing audit.**
  - **Routes:** every Book of Business route on disk is in `agentApiPolicy.ts`. That is 16, under statements, discrepancies (now with `discrepancies/letter`), persistency, ledger and policies. `moneyRoutes.test.mjs` fails the build on any drift, either way, and on roles that disagree with the source.
  - **Audit actions:** all 19 the LA-4 routes and pages write are declared in `lib/audit/actions.ts`.
  - **Tests:** each test the spec names exists:
    - `statementFile.test.mjs`;
    - `statementMatch.test.mjs`, extended in 4.3 with the name-match cases;
    - `discrepancies/compute.test.mjs`;
    - `persistency/compute.test.mjs`;
    - the checklist and tile tests.

    The read-only coverage the plan asked about (C4) was settled in 4.10.
  - **Migrations:** every LA-4 migration is live (catalog verifier, prefix `202610`): `20261002100000`, `20261002110000`, `20261002120000`, `20261003100000`, `20261006100000`, `20261006110000`. No bundle is left to hand over.
  - **Feature check (`npm run check:features`):** OK for every agent API guard. Its one failure is outside LA-4: two LA-3 Sell features (`ai_assistant`, `carrier_extension`) have no menu node, and both are blocked on roadmap decisions 1 and 4. It was raised as a separate follow-up.
  - **Production build:** `next build` (webpack) succeeds for every route. It ran in a throwaway copy, so the shared dev server's `.next` was not touched. Google Fonts were stubbed in the copy only, because the sandbox has no network. This is the check the typecheck misses (the client/server boundary, as in 4.8).
  - **UI:** the last LA-4 offender (the policies form fields at `h-10`) is now 36px. The ratchet is lowered, and no LA-4 file is left in `uiOffenders.json`.
  - **Specs:** §22 Policies and §23 Commission ledger, which still described the product before LA-4, are rewritten. With §23a–§23e and the dashboard's §1, every LA-4 screen has a current spec.
- **2026-10-06: the LA-4 phase gate, end to end, passed** on the demo tenant with the owner's approval. Everything went through the real UI and routes.
  - **CSV:** a Transamerica August 2026 statement (3 lines) was imported through the dialog. The preview read $1,396.00 net, with 2 exact proposals and an admin-fee line with no policy.
    - While it was in review it produced no finding: only reviewed statements are evidence.
    - A person then accepted 2 lines and left the fee unmatched.
    - **"Owed to you" traced to the arithmetic:** a short-paid $101.55 (expected $521.55 − received $420.00, planted), and a real never-paid $504.45 (QA-D1-0087, issued 26 June, advance due within the window August covers).
    - The total moved $6,264.72 → $6,870.72, exactly +$606.00.
  - **XLSX:** a real Excel Foresters September 2026 statement (2 lines) was read on the server: the sheet name, Excel date cells and $431.31.
    - The typo'd "QA-D1-0O32" was proposed by insured name ("by insured name, check it").
    - Both lines were accepted, with no new finding, because they were paid exactly. The existing never-paid QA-D1-0031 grew in place ("2 statements … cover").
    - The original downloaded byte-identical (6,706 bytes, same SHA-256).
  - **Dispute letter:** Transamerica, WN-1002, 2 rows, **total $606.00 = $504.45 + $101.55**.
    - The real Print button (with the print dialog stubbed) recorded the letter and marked both findings disputed. History: "open → disputed · Demo Agent · Dispute letter printed".
    - The dashboard tile read "$6,870.72 · 17 items", equal to the page.
  - **Cleanup:** both test statements were voided with a labelled reason. The demo is back to $6,264.72 and 15 open: the test findings are cleared with their history kept, QA-D1-0031 is back to one statement, and nothing from the tests is posted. The two statements remain, voided, as every statement does.
  - **Side effect, as forecast:** the first import ran the first refresh under the "only reviewed statements are evidence" rule. That took the demo from $6,817.42 to $6,264.72, which is the dry run's figure.
- **LA-4.11:** the registries are complete; the API registry test enforces every route and audit action. Only the one migration above is left to apply, so no bundle is needed.
- **2026-10-06: the follow-up pass** (the 14 items open after the gate). The owner decided:
  - keep 45 days' grace;
  - persistency joins the Ledger plan;
  - a tenant suspension keeps its lockout;
  - mis-rated stays limited to files with a rate or premium column (backlog #214).
  - **Built:**
    - **Persistency on Ledger:** migration `20261007100000` grants `cohort_persistency` to every plan with `statement_ingestion`, and refreshes their tenants. The dry run gave basic and pro the feature and refreshed 295 tenants. `verify-entitlements` now expects it.
    - **Carrier commissions address:** migration `20261007110000` adds `tenant_carrier_commission_contacts`, and the route `GET/PUT /api/app/discrepancies/carrier-contact` reads and saves it. The saved address starts every letter to that carrier.
    - **Letter as a real PDF:** `POST /api/app/discrepancies/letter/pdf`, built with pdf-lib from the same `getDisputeLetter` as the page, and audited with format "pdf".
    - **One import path:** the v1 fallback is gone from the code, and migration `20261007120000` drops `import_commission_statement`.
    - **Checklist wording:** each step now says what its link does. Found live: every row said "Open settings tab", even the statement import and lead sources.
    - **The letter prints on white in dark mode:** `body:has([data-print-paper])`. Before, the page around the white letter printed near-black.
  - **Live checks** (demo tenant unless named; every test row was voided or restored):
    - **PDF manual entry:** passed on a stored PDF statement; statement `03818372` voided afterwards.
    - **Re-match with left-unmatched lines:** 0 proposals without the option, 1 by insured name with it. QA-D1-0090's insured name was put back.
    - **Re-process from the stored original:** new statement `227eeae7` has `reprocessedFrom` = `ee7e6ae2`, same file, new mapping. The old statement was voided with "Re-processed from the stored original file", then the new one was voided too. The demo is still $6,264.72 across 15 open.
    - **Suspended-account writes:** Isolation Test A ran with a temporary suspended Ledger entitlement, and the row was deleted afterwards.
      - Import, bulk decide, saving a carrier address and void all returned 403 `read_only`.
      - The two list GETs returned 200.
      - With full access, the same calls passed the gate.
    - **Checklist step on an unfinished setup:** Isolation Test A's onboarding was set to `pending` for the render, then restored. The page showed "0 of 5" and an unticked "Upload a carrier statement", linking to `/app/statements?import=1`. A statement that stands ticks the step even before setup is finished; that is covered by `checklist.test.mjs`.
    - **Brand pass:** computed WCAG contrast for every visible text node, light and dark, on the Statements list, the Unmatched tab, a statement in review, a reviewed statement, Discrepancies, an open finding dialog with its History, Persistency, a policy's detail page, the dashboard and the letter (on screen, and with its print rules applied). **0 failures**, and the audit flagged a planted 1.73:1 probe. No orange or amber in any LA-4 file. The print check found the dark-mode page colour above, now fixed.
  - **Tests:** 2,042 of 2,042 pass; tsc is clean.
  - **Migrations `20261007100000`, `20261007110000` and `20261007120000` are live** (applied by the owner and verified 2026-10-07):
    - The catalog verifier says `110000` is applied.
    - **100000, read-only check:** every plan with `statement_ingestion` grants `cohort_persistency` (basic, pro, advance and the two QA plans). Of the 295 tenants on them, 39 have it in their blob, 256 have access `none`, and none lack it.
    - **120000:** only `import_commission_statement_v2` is left.
    - `verify-entitlements` (owner-approved): "All entitlement checks passed", including basic at 6 features and pro at 20.
    - **Carrier address, live (owner-approved):** a labelled test address saved for Foresters on the demo tenant (200), read back, and started the letter ("saved commissions address"). It was then overwritten with "Commissions Department / Foresters". The table allows no empty address and no delete, so a row stays. Both saves wrote `tenant.carrier_commission_contact_saved`.

**QA gates inside the phase:**
1. after 4.1–4.3 (import);
2. after 4.4–4.6 (activation);
3. after 4.7–4.9 (insight);
4. then 4.10–4.11.

---

## LA-4.1: Keep the original statement file (CSV, XLSX, PDF)

**Goal:** every statement's original bytes are kept forever and can be downloaded. Reprocessing is possible when the parser improves.

**Scope:**
- POST `/api/app/statements` becomes `multipart/form-data`, with these parts: `file`, `carrier_id`, period, and `mapping` as JSON.
- The server computes sha256 over the original bytes and uploads to a private bucket `commission-statements` at `{tenantId}/statements/{statementId}/{sha}.{ext}`. This follows the pattern in `lib/applications/confirmations.ts`.
- XLSX is converted on the server with exceljs and `rowsToCsv`. It reads the first sheet, and `sheet_name` is recorded.
- Preview stays JSON, using the browser's `readXlsxAsCsv`.
- New GET `statements/[id]/file` returns a 60-second signed URL.

**Files:**
- `lib/ledger/statementHttp.ts`
- `lib/ledger/statementService.ts` (`importStatement` takes `{bytes, kind}`)
- new `lib/ledger/statementFile.ts`: pure; kind detection, size and MIME checks
- `components/app/statement-import.tsx` (accepts `.csv` and `XLSX_TYPES`)
- `app/api/app/statements/[id]/file/route.ts`

**DB (`la_4_1_statement_files`):**
- The bucket.
- On `tenant_commission_statements`: `file_kind` (`csv`/`xlsx`/`pdf`), `storage_path`, `file_bytes`, `content_type`, `sheet_name`.
- `import_commission_statement` is recreated with these arguments, keeping its grants.

**As built (2026-10-06):**
- **Storage path.** It is content-addressed as `{tenantId}/statements/{sha}.{ext}`, with no statement id. The same bytes are one object, so a re-process stores nothing new.
- **Import function.** The original `import_commission_statement` was kept as the pre-migration fallback, and `import_commission_statement_v2` was added alongside it instead of recreating it.
- **Excel sheet.** The first *visible* sheet is read.
- **Preview hash.** The preview checks duplicates against the original file's SHA-256, which the browser computes. Before this, it hashed the CSV text, which never matched an Excel file. The import does not trust that value: it hashes the bytes it receives.
- **Storage failures.** Only a missing bucket, which happens before the migration, imports without the original. Any other storage error stops the import with a 502 before a statement row is written.

**Acceptance:**
- An XLSX statement imports with the same lines as the equivalent CSV, and its download is byte-identical to the upload.
- The duplicate check uses the original file's sha.
- A file over the size limit or of the wrong type gets a 400 with a sentence the person can act on.
- A failed upload leaves no statement row, and a failed database write removes the uploaded object.
- The size cap fits the host's request-body limit, or the file goes up by signed direct upload and the server then finalises it.

## LA-4.2: PDF statements go to a manual-entry queue

**Goal:** a PDF is accepted and stored, and a person types its lines in. There is no parsing and no AI.

**Scope:**
- A PDF creates a statement with `status='awaiting_entry'` and no lines.
- `statements/[id]` shows the PDF (signed URL) beside a line-entry grid with: policy number, insured, amount, kind, date.
- Entered lines go through the same `parseAmountCents` / `parseStatementKind` validation and the same matching.

**Files:**
- `app/api/app/statements/[id]/lines/route.ts` (action `add_manual_lines`)
- `components/app/statement-review.tsx`

**DB (`la_4_2_statement_manual_entry`):**
- Status `awaiting_entry`.
- `entry_source` (`file`/`manual`) on lines.
- RPC `add_manual_statement_lines(p_tenant_id, p_actor, p_statement_id, p_lines)`, which moves the statement to `review`.
- The guard trigger is relaxed so lines can be appended only while the statement is `awaiting_entry`.

**Audit:** `tenant.statement_lines_entered_manually`.

**Acceptance:**
- A PDF upload never parses the file.
- Manually entered lines are matched exactly like CSV lines.
- A statement not in `awaiting_entry` refuses new lines with 409.
- A read-only account sees the queue but not the entry form.

## LA-4.3: Name matching, re-matching and re-processing

**Goal:** match by policy number first, then by insured name + carrier + amount. The unmatched queue can be re-run whenever the book changes.

**Scope:**
- **Fallback matching:** pure `proposeFallbackMatches(lines, policies, carrier, expected)` in `lib/ledger/statementMatch.ts`.
  - It proposes a policy only when exactly one policy for that carrier has a normalised name equal to the line's insured name.
  - Amount within `RECONCILE_TOLERANCE_CENTS` of an expected ledger entry is the tie-break.
  - A name match is always a proposal and is never accepted automatically. Its reason reads "name + amount".
- **Re-match:** re-propose matches for `unmatched` and `left_unmatched` lines against the current book.
- **Re-process:** void the statement and re-import from the stored original with a new mapping. The new statement is linked by `reprocessed_from`, and the old one is kept.
- **Unmatched lines tab:** a cross-statement tab on `/app/statements`, in a TableCard with DataToolbar.
- **Mapping:** optional `premium` and `rate` fields (`STATEMENT_FIELDS`, `mappingSchema`).

**DB (`la_4_3_statement_matching`):**
- Match method `'name'`, allowed as `proposed`.
- `premium_cents` and `rate_bp` on lines.
- `reprocessed_from` on statements.

**Audit:** `tenant.statement_lines_rematched`, `tenant.commission_statement_reprocessed`.

**Acceptance:**
- Unit tests:
  - an ambiguous name produces no proposal;
  - a carrier mismatch produces no proposal;
  - a unique name with a matching amount produces a proposal.
- Re-processing keeps the voided original and links the new statement to it.
- The unmatched-tab counts equal the existing statement summaries.

## LA-4.4: Discrepancy engine and its store

**Goal:** detect the money the carrier owes Ray, by type, and keep each item's dispute state.

**Scope:** a pure `lib/discrepancies/compute.ts`. Its inputs are:
- `LedgerResult` (`computeLedger`);
- accepted statement entries;
- statement coverage per carrier;
- policy status.

Each finding has a deterministic `fingerprint` (type, policy, period key) and an arithmetic breakdown `{expected, received, rate}`.

| Type | Rule | Owed |
|---|---|---|
| `never_paid` | An active policy past issue date + grace, where a non-voided statement from that carrier covers a period ending after issue + grace, and no accepted line exists | The expected entries in the covered periods |
| `short_paid` | `reconcileStatements` status `short` | Expected − received |
| `mis_rated` | Short, and the line's rate (or received ÷ premium) differs from the schedule rate by more than 1 bp | The arithmetic difference |
| `duplicate_chargeback` | Two or more accepted chargeback lines on one policy totalling more than the computed chargeback (or the advance received) | The excess |
| `unexpected_chargeback` | A chargeback line on a policy whose status is active | The line amount |

`lib/discrepancies/service.ts`: `refreshDiscrepancies(tenantId)`:
- upserts by fingerprint and closes findings that no longer apply;
- snapshots `owed_cents`;
- runs after import, decide, void and manual entry.

**DB (`la_4_4_discrepancies`):** table `tenant_commission_discrepancies`, with:
- `fingerprint`, unique per tenant;
- `kind`, `policy_id`, `carrier_id`, `period_start`, `period_end`, `owed_cents`, `detail` (jsonb);
- `status` (`open`/`disputed`/`resolved`/`written_off`/`cleared`), plus who and when for each status change, and `note`;
- `first_seen_at`, `last_seen_at`.

RLS uses the `tenant_app` pattern. The service role gets select, insert and update.

**Acceptance:**
- One unit test per type, plus false-positive guards:
  - no statement coverage means no `never_paid`;
  - a lapsed policy's chargeback is not unexpected;
  - pending policies are excluded.
- A refresh is idempotent.
- Every figure traces back to schedule rows and line ids.

## LA-4.5: The `/app/discrepancies` page and dispute letter

**Goal:** Ray sees "You appear to be owed $X" broken down by type, works each item, and prints a letter to the carrier.

**Scope:**
- **Page:** `app/app/(shell)/discrepancies/page.tsx` with `guardPage("discrepancy_report")` and the statements-view role check.
  - One PageHeader.
  - A StatStrip of the buckets.
  - A TableCard with DataToolbar, filtered by type, carrier and status.
- **API:** GET/PATCH `app/api/app/discrepancies/route.ts` and `[id]/route.ts`, for status changes and a note.
- **Letter:** a print page `app/app/discrepancies/letter/page.tsx?carrier=&ids=`, outside the shell like the quotes print page. It shows:
  - the agency profile and the carrier's commission department;
  - a table of policy numbers with expected, received and difference;
  - the total, and a print button.
  - An optional PDF through `pdf-lib`. No email.
- Menu item `book.discrepancies` gets `built: true`.

**Audit:** `tenant.discrepancy_status_changed`, `tenant.dispute_letter_generated`.

**Acceptance:**
- The ComingSoon fallback is no longer reached for this item.
- An assistant gets a 403 and sees RoleGateNotice.
- The letter lists only the selected items for one carrier, and its total equals the sum of its rows.
- A read-only account can view and print, but not change status.

## LA-4.6: "Owed to you" on the dashboard and setup checklist (activation)

**Goal:** the activation moment, in the first session after the first statement.

**Scope:**
- **Tile:** `book.owed` in `DASHBOARD_TILES` (feature `discrepancy_report`, owner and bookkeeper).
  - `tileMetric("book.owed")` sums the open and disputed `owed_cents`, with no ledger recompute, so the dashboard stays within its one-second budget.
  - A summary card shows the split by type and links to `/app/discrepancies`.
- **Checklist:** the statement step points to `/app/statements?import=1` and is done once any non-voided statement exists (`lib/dashboard/checklist.ts`).

**Acceptance:**
- Before any statement, the card says what to do next and makes no $0 claim.
- After an import, the figure equals the discrepancies page total.
- Checklist tests are updated.
- The tile is hidden for producers and assistants.

## LA-4.7: Correct inputs (lapse date, paged ledger)

**Goal:** persistency and chargeback timing are computed from the right data.

**Scope:**
- `tenant_policies.status_changed_at`, set by a BEFORE UPDATE trigger only when the status changes, and backfilled from `updated_at` for lapsed and cancelled rows.
- `lib/ledger/service.ts` reads `status_changed_at` and pages with `readAll`.

**DB:** `la_4_7_policy_status_changed_at`.

**Acceptance:**
- Editing a lapsed policy's premium does not move its lapse date.
- A book of 2,500 policies is read in full.

## LA-4.8: Persistency page

**Goal:** the share of policies still alive at months 3, 6, 9 and 13, by issue cohort, carrier and lead source.

**Scope:**
- **Calculation:** pure `lib/persistency/compute.ts`.
  - The denominator is policies issued at least N months ago and not pending.
  - The numerator is those not lapsed or cancelled before `addMonths(issue, N)`.
- **Lead source:** from `tenant_issued_policies` (vendor and campaign), joined on `(tenant_id, policy_number)`, else "Unattributed".
- **Page:** `app/app/(shell)/persistency/page.tsx` with `guardPage("cohort_persistency")`.
  - A StatStrip of M9 against the 65% target.
  - Two TableCards: by carrier and by lead source.
  - Producers are scoped to their own policies.
- **API:** `app/api/app/persistency/route.ts`.

**Acceptance:**
- Tests cover month clamping, cohorts too young to count (excluded) and a lapse on the boundary.
- Cells with n < 5 show "—".
- The menu item is `built`.

## LA-4.9: Money panel on policy detail

**Goal:** everything about one policy's money on one page.

**Scope:**
- New `app/app/(shell)/policies/[id]/page.tsx`; rows in `policies-workspace.tsx` link to it.
- The panel is built from `computeLedger([policy])`: advance, earned to date, chargeback exposure and the date the window ends.
- It also shows accepted statement lines, open discrepancies and lead source.

**Acceptance:**
- The figures equal the ledger page rows for that policy.
- Another tenant's id returns `notFound()`.
- A producer sees only their own policies, and an assistant sees no money panel.

## LA-4.10: Read-only pass and plan display names

**Scope:**
- Audit every Phase 1 page and route: reads open, writes behind `write:true`, and controls disabled with a reason when `access==='read_only'`.
- Rename plans through the admin plan editor (`plans.name` only): `basic` → Ledger, `pro` → Basic, `advance` → Advanced.
- Check other places a plan name may be copied: invoices, coupons, the Whop provider.

**Acceptance:**
- A suspended subscription can open policies, statements, ledger and discrepancies, and every write returns `read_only`.
- `plans.code` is unchanged and `verify-entitlements` passes.

## LA-4.11: Registries, tests and the migration bundle

**API policy entries:**
- `statements/[id]/file`
- `statements/[id]/lines` (the new action)
- `discrepancies`
- `discrepancies/[id]`
- `discrepancies/letter`
- `persistency`

**Audit actions:** the five above.

**Tests:**
- `statementFile.test.mjs`
- `statementMatch.test.mjs`, extended
- `discrepancies/compute.test.mjs`
- `persistency/compute.test.mjs`
- checklist and tile updates

**Migrations, in order, handed over as one script:** `la_4_1` → `la_4_2` → `la_4_3` → `la_4_4` → `la_4_7`.

---

**Open items for this phase** (see the roadmap, §5):
- The grace period before "never paid" (45 days proposed).
- Whether persistency belongs in Ledger.
- Whether a tenant suspension (not just a subscription suspension) keeps read access.
- "Mis-rated" works only when the carrier sends a premium or rate column.
