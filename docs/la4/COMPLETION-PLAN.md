# LA-4 Book of Business: completion plan

**Written:** 2026-10-06, from:
- [TASKS.md](TASKS.md);
- the roadmap and [BUSINESS-CONTEXT.md](../roadmap/BUSINESS-CONTEXT.md);
- the design docs;
- a file-by-file audit of the code on `redesign/brand-green`.

## Where LA-4 stands

**Built:** all eleven tasks (4.1–4.11), the phase gate and the follow-up pass are done (2026-10-06). Every LA-4 migration is live, including the three follow-ups, verified 2026-10-07: `20261007100000` (persistency on Ledger), `20261007110000` (carrier commissions addresses) and `20261007120000` (drop the v1 import).

**What is left is three kinds of work:**
- **A. Design:** the LA-4 screens have no design spec, no board and no tracker row, and the existing Policies and Ledger specs describe the product as it was before LA-4.
- **B. Spec gaps:** small differences between TASKS.md and the code.
- **C. Proof:** acceptance criteria that are checked only by regex over the source, or not at all.

Work the items in order. Each item is one change you can review on its own, with its own acceptance check.

**Concurrency:** another session is editing the Statements and Book-of-Business view files (`book-of-business-views.tsx`, `view-tabs.tsx`, `statements/page.tsx`, `statements/[id]/page.tsx`). Before starting on any of those, commit that work or coordinate with that session.

---

## Progress

| Task | State |
|---|---|
| LA-4.1 Keep the original file | **Done 2026-10-06.** Fixes, tests, live checks and the §23a spec: see TASKS.md, Progress. |
| LA-4.2 PDF manual entry | **Done 2026-10-06.** Read-only hides the grid, one shared line reader, drafts, §23b spec. |
| LA-4.3 Name match, re-match, re-process | **Done 2026-10-06** (option c: opt-in "Include left unmatched"). Migration `20261006100000` **live** (verified 2026-10-06). |
| LA-4.4 Discrepancy engine | **Done 2026-10-06.** Stable fingerprints, reopen-when-worse, status history. Migration `20261006110000` **live** (verified 2026-10-06). |
| LA-4.5 Discrepancies page and letter | **Done 2026-10-06** (option a: the page only reads; every change to the facts recomputes). No migration. |
| LA-4.6 "Owed to you" tile and checklist | **Done 2026-10-06.** Exact figure (cents), no unchecked $0, role tests; only reviewed statements are evidence (decided). |
| LA-4.7 Lapse date, paged ledger | **Done 2026-10-06.** Behaviour test for a 2,500-row book (`readPaged`); trigger proven on the real server, nothing committed. |
| LA-4.8 Persistency page | **Done 2026-10-06.** By issue cohort, dash-only small cells, honest lead-source failures, standard toolbar and pager. |
| LA-4.9 Policy money panel | **Done 2026-10-06.** Per-policy reads only, failed reads said, figures equal the ledger. |
| LA-4.10 Read-only pass and plan names | **Done 2026-10-06.** All 72 Ledger-plan handlers tested; Settings and appointments say read-only; verify-entitlements passes. |
| LA-4.11 Registries, tests, migrations | **Done 2026-10-06.** Registry, audit actions, tests, migrations all verified; production build passes. |

## A. Design

The rules are [UI-CONSISTENCY.md](../design/UI-CONSISTENCY.md) for layout and [BRAND.md](../design/BRAND.md) for colour, type and logo. They are the 2026 green brand; no orange.

**A1. Write page specs into `docs/design/02-AGENT-APP.md`.** **Done:** §22 and §23 rewritten, §23a–§23e added, dashboard §1 extended.
- Use the existing eight-part format: Files, Mockup, Gate, Purpose, Must do, Controls, Layout, Must not.
- Rewrite §22 (Policies) and §23 (Commission ledger). Both still say statement ingestion "does not exist" and that the ledger "has no data source".
- Add new sections for:

| Screen | Route | Gate |
|---|---|---|
| Statements: list, Unmatched lines tab, Import | `/app/statements` | `statement_ingestion` · owner, bookkeeper |
| Statement review: matching, manual PDF entry, re-match, re-process, void | `/app/statements/[id]` | same |
| Discrepancies | `/app/discrepancies` | `discrepancy_report` · owner, bookkeeper |
| Dispute letter (print page, outside the shell) | `/app/discrepancies/letter` | same, and it stays read-only-viewable |
| Persistency | `/app/persistency` | `cohort_persistency` · owner, producer (own policies), bookkeeper |
| Policy detail: money panel | `/app/policies/[id]` | `book_of_business`; assistants see no money |
| Dashboard "Owed to you" tile and checklist step | `/app/dashboard` | `discrepancy_report` · owner, bookkeeper |

**A2. Add boards and tracker rows.** **Done:** tracker rows 177–182 (boards stay "NONE — design from foundation" until mockups exist).
- Add a row to `docs/REDESIGN-TRACKER.csv` for each of the five screens without one: statements, statement review, discrepancies, letter, persistency, policy detail.
- Add the boards to `docs/redesign/boards.tsv`.
- Until real mockups exist, use "NONE — design from foundation".

**A3. Bring the screens up to the UI standard.** **Done 2026-10-06.** No LA-4 file is left in `uiOffenders.json`:
- the policies form fields went from `h-10` to 36px, the last one, and the baseline is lowered;
- the persistency tables got the toolbar in 4.8;
- the letter's text sizes went in 4.5;
- the statement review's `Pager` came with the other session's redesign;
- the statements header-actions row is that redesign's deliberate layout, specified in §23a;
- the policy-detail tables are read-only lists inside one page and need no toolbar (§23e).

The original list:
- `statement-review.tsx`: replace "Show N more" with `Pager`.
- `statement-manual-entry.tsx`: **done in 4.2.**
  - `SectionLoading` replaced the loading text;
  - the helper paragraph is gone;
  - read-only hides the form.
- Persistency and policy-detail tables: add a `DataToolbar` and a `RefreshButton` where the data can change.
- Letter page: remove the two `text-[Npx]` offenders, then lower `uiOffenders.json`.
- Statements page: keep the header actions inside `PageHeader` once statements exist. The current working-tree edit moves them to a separate row.
- Lower the `tall-control` baseline for `statements/page.tsx` once the tab change lands.

**A4. Brand pass.** **Done 2026-10-06:** computed contrast on every LA-4 screen in light and dark mode found 0 failures. The letter's print rules give black on white in both themes; dark mode used to print a near-black page around it, now fixed with `data-print-paper`. See TASKS.md, Progress, "the follow-up pass". The original checks:
- the status chips on discrepancies and statements;
- the StatStrip;
- the letter's print styles (the letter must print in black on white).

## B. Spec gaps (code)

**B1. Re-match should include `left_unmatched` lines.** **Done in 4.3 (option c, 2026-10-06):** an opt-in "Include N left unmatched" checkbox, backed by migration `20261006100000` (live).

**B2. Add a period key to the remaining fingerprints.** **Done in 4.4.** The audit found half of it. short_paid and mis_rated were keyed by every period, which lost disputes each month. Fingerprints v2 anchor every kind where its problem started, a resolved finding reopens when it gets worse, and migration `20261006110000` re-keys the stored rows (live).

**B3. Stop GET requests writing data.** **Done in 4.5 (option a):** the page and GET only read, and every change to the facts recomputes after the response.
- Today, opening `/app/discrepancies` and calling `GET /api/app/discrepancies?refresh=1` both upsert rows, including on read-only accounts.
- Options:
  - (a) rely on the refreshes that already run after import, decide, void and manual entry, and make the page read-only;
  - (b) move the refresh behind `requireFeature(..., { write: true })` as a POST.

**B4. Dispute letter:** **Done in 4.5,** and finished in the follow-up pass: a pdf-lib PDF (`letter/pdf`), and a commissions address saved per carrier (migration `20261007110000`, live 2026-10-07).
- Write the `dispute_letter_generated` audit once per print or generate, not on every render or reload.
- Give the carrier block a real commission-department address when carrier data has one, and keep the generic line as the fallback.
- Optional: a PDF through `pdf-lib`, which is already a dependency.

**B5. Persistency:** **Done in 4.8.**
- Add the "by issue cohort" table the goal names. Today there are only by-carrier and by-lead-source tables.
- In cells under 5 policies, don't print `alive/eligible` beneath the "—".
- Join lead sources with `normalisePolicyNumber`, not `trim().toUpperCase()`.
- Read errors on vendors, campaigns and issued policies are currently swallowed with `.catch(() => [])`. Surface them; they must not turn into "Unattributed".

**B6. Discrepancy status history.** **Done in 4.4:** an append-only `history` column, kept by a trigger and shown in the finding's dialog.

**B7. Policy detail load.** **Done in 4.9.** The page loads the tenant's whole statement ledger, discrepancy list and lead-source index for one policy. Filter each read by `policy_id` or policy number.

**B8. Smaller drift.**
- Done in 4.1:
  - the storage path, and `import_commission_statement_v2` alongside v1, are recorded in the spec as built;
  - the `xlsx.ts` comment is fixed.
- Done since:
  - the name-match reason reads "Insured name, carrier and amount match" when the amount decides it;
  - v1 of the import is gone from the code, and migration `20261007120000` drops the function (live 2026-10-07).

## C. Proof (tests and checks)

**C1. Tile test.** **Done in 4.6.** Add `book.owed` to `lib/dashboard/tiles.test.mjs`: it is hidden for producers and assistants, and needs `discrepancy_report`.

**C2. Name-match tests.** **Done in 4.3.** Move the fallback-match tests into `lib/ledger/statementMatch.test.mjs`, where the spec puts them.

**C3. Behaviour tests in place of regex checks:** **done.**
- the XLSX download is byte-identical to the upload: proven live in 4.1;
- a failed upload leaves no statement row: the store-before-write order is pinned in 4.1;
- a 2,500-policy book is read in full: the `readPaged` behaviour test in 4.7;
- an edit to a lapsed policy doesn't move `status_changed_at`: the live trigger body was run in a rolled-back transaction in 4.7.

**C4. Read-only test coverage.** **Done in 4.10:** `statements/preview` and two other no-write POSTs are allowlisted, with a test proving they write nothing. Decide whether `statements/preview` belongs in the read-only handler test (`lib/persistency/insight.test.mjs`). It is a POST, but it writes nothing.

**C5. Unverified items from 4.10:** **Done in 4.10.**
- check invoices, coupons and the Whop provider for copied plan names;
- run `verify-entitlements`;
- check that the sidebar label reads Ledger / Basic / Advanced from the blob.

**C6. The phase gate, end to end.** **Passed 2026-10-06** (CSV + XLSX imported, owed traced, letter total = rows; test statements voided). See TASKS.md, Progress. In the browser pane on the demo tenant:
- import a real carrier CSV and a real XLSX;
- confirm that "owed to you" traces to the arithmetic;
- print one carrier's letter and check that its total equals the sum of its rows.

Keep it read-only on shared production rows; see the memory note on LA-4 live checks.

## Open decisions (they block or shape items above)

These are from ROADMAP §5 and backlog #206–214. All but 4 were decided on 2026-10-06:

1. **Grace before "never paid":** keep 45 days.
2. **Persistency:** it joins the Ledger plan (migration `20261007100000`, live 2026-10-07).
3. **Tenant suspension:** keep the lockout. Only a subscription suspension leaves read access.
4. **PDF statements:** they stay manual until an AI or document provider is chosen (backlog 206). Still open.
5. **"Mis-rated":** accepted. It works only when the carrier's file has a premium or rate column (backlog #214).
6. B1 (option c) and B3 (option a).

## Suggested order

1. A1 and A2: specs and tracker. These are docs only, and they unblock design work.
2. C1, C2 and C5: quick, with no UI risk.
3. B2 and B3: correctness, and B2 includes a migration.
4. A3, after the other session's Statements work is committed.
5. B1, B4, B5, B7 and C3.
6. A4: the brand pass, then the C6 gate walk.
