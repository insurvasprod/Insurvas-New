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
  - Plan names: migration `20261003100000_la_4_10_plan_display_names.sql` (**not yet applied**). It renames `plans.name` (basic → Ledger, pro → Basic, advance → Advanced; codes unchanged) and puts `plan_name` in the entitlement blob, patched in place and CRLF-safe (backlog #75). A rename refreshes the affected tenants. The agent app shows the blob's name and falls back to the tidied code.
- **LA-4.11:** the registries are complete; the API registry test enforces every route and audit action. Only the one migration above is left to apply, so no bundle is needed.

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
