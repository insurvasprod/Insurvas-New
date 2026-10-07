# LA-4 Book of Business: the Notion sprint (governing spec)

**Source of truth:**
- The tasks: the Notion "Insurvas Sprint" database, Module = LA-4, 20 tasks (created 2026-10-05).
- The design: the Notion doc "📘 Module 4 — Book of Business".

The repo's [TASKS.md](TASKS.md) (11 tasks, 2026-10-02) is the earlier, smaller spec. It is built and closed (commit `3e2bdfe`); read it as history.

**Owner decisions (2026-10-07):**
- **The pipeline:** built fresh, beside today's statements and discrepancies. Those are retired once the new pipeline covers them.
- **Storage:** a StorageAdapter on Supabase Storage first; DigitalOcean Spaces later, as a second implementation.
- **AI:** the deterministic parts are built first. The AI steps (4.4, 4.8, the 4.3/4.5 guardian, 4.19) wait behind a "not configured" state until a provider is chosen.
- **Email-in:** Postmark inbound.
- **Seed data:** comes only from real carrier sample files, which the owner will provide. Nothing is guessed.

## Progress

| Task | State |
|---|---|
| 4.1 Storage adapter, file registry, three doors | **Done 2026-10-07.** Migration `20261008100000` live, and all three doors verified live (below). Production still needs the Postmark and Vault setup. |
| 4.2 Raw layer, reprocessing | **Done 2026-10-07.** Migration `20261008110000` live and verified (below). Reprocessing rebuilds nothing until 4.6/4.7 register their stages. |
| 4.3 Parser framework, layout maps | **Framework done 2026-10-07.** Migration `20261008120000` live and verified (below). No carrier map is seeded until the sample files arrive. |
| 4.4 PDF extraction (OCR, AI, balance gate) | Not started (needs an AI provider) |
| 4.5 Status map, unknown-status gate | **Framework done 2026-10-07.** Migration `20261008130000` live and verified (below). No real status seeded until the sample files arrive. |
| 4.6 Snapshots, change detection | Not started |
| 4.7 Current-state table | Not started |
| 4.8 Policy ↔ CRM matching with AI | Not started (needs an AI provider) |
| 4.9 Exception queues | Not started |
| 4.10 Existing-book import | Not started |
| 4.11 Policy list and detail | Partial: earlier screens exist; to be rebuilt on 4.7 |
| 4.12 Commission ledger | Partial: computed ledger exists; `commission_entry` not built |
| 4.13 Expected commission | Partial: schedules exist; trigger and lag not built |
| 4.14 Orphans, carrier balances | Partial: unmatched lines kept; balances not built |
| 4.15 Discrepancies, letters | Partial: 5 of 9 types, letter and PDF; to be rebuilt on 4.12–4.14 |
| 4.16 Retention board | Not started |
| 4.17 Carrier rules | Partial (small): commissions address only. The 45-day grace is still hard-coded. |
| 4.18 Scorecards, persistency, AI summary | Partial: count-based persistency only |
| 4.19 Daily run, AI agents | Not started |
| 4.20 Traceability | Partial: original download (now logged), arithmetic on findings |

## LA-4.1: how it is built

**The data (`supabase/migrations/20261008100000_la_4_1_file_registry.sql`):**
- `file_registry`: the Notion columns plus `path_agency`, `file_kind`, `email_from` and `email_message_id`.
  - `agency_id` is nullable. No agencies table exists yet; the agency is the tenant today.
  - Identity columns are locked by a trigger. Delete is revoked.
  - One current file per carrier, type and day.
- `file_registry_skips`: every skipped duplicate, with a pointer to the file already held.
- `register_carrier_file`: dedup and reissue (supersede) in one locked transaction.
- `tenant_inbound_addresses` and `carrier_inbound_senders`: the email door's address and sender lookup. Sender matching is exact: an address, or a whole `@domain`.
- `list_unregistered_carrier_drops`: what scripts dropped that hasn't been registered.
- `trigger_carrier_file_poll`: the job pg_cron runs every 5 minutes, through pg_net.

**The code (`lib/ingestion/`):**
- `storage.ts`: the adapter interface. It names no provider.
- `supabaseStorage.ts`: the only file that touches Supabase Storage.
- `path.ts`: attribution from `<date>/<agency>/<carrier>/<Policies|Commissions>/<file>`, synthetic paths for uploads and emails, and filename pre-fill.
- `pipeline.ts`: one door-agnostic flow. Its dependencies are injected, so it is tested with fakes.
- `inboundEmail.ts`: reads Postmark's inbound payload and matches the sender to a carrier.
- `registry.ts`: the server wiring for the three doors, the list, downloads, the address and senders.

**The three doors:**

| Door | Route | How it is checked |
|---|---|---|
| Upload | `POST /api/app/carrier-files` | Owner or bookkeeper, a write |
| Email | `POST /api/webhooks/postmark-inbound` | HTTP Basic credentials in the webhook URL |
| Bucket | `POST /api/internal/carrier-files/poll` | `Bearer CARRIER_FILES_POLL_SECRET` |

**The screen:** Book of Business › Carrier files (`/app/carrier-files`).
- A list of every file, with filters for carrier, type, status and door, and a Download button.
- An "Email and bucket" tab: the agency's address, its known senders, the bucket folder and the carrier codes.

**Acceptance (Notion), and what proves it:**

| Criterion | Proof |
|---|---|
| Identical row from each door, apart from `source` and `uploaded_by` | `ingestion.test.mjs` |
| Attributed from the path, unopened; a corrupt file is still attributed | `ingestion.test.mjs`: a corrupt `.xlsx` drop is attributed and `failed` |
| Byte-identical re-upload skipped, skip recorded | Unit test, plus the migration's function run on the real Postgres (temp copy, rolled back) |
| Changed file for the same day supersedes; old row readable | Unit test, plus the same rolled-back database check |
| Failed file holds `failed` with `error_detail`, visible in the UI | Database constraint; listed with its reason on Carrier files |
| Adapter has no provider types; swapping changes nothing outside it | `ingestion.test.mjs`: only `supabaseStorage.ts` touches Supabase Storage |
| `agency_id` present and nullable | Migration self-check plus test |

**Verified live, 2026-10-07** (the owner applied the migration):
- **The catalog:**
  - every table, function, trigger and index is present;
  - delete is revoked on the registry and the skips;
  - `register_carrier_file` runs as the service role only;
  - `agency_id` is nullable;
  - the bucket is private, at 25 MB;
  - `pg_net` is installed and `la4-carrier-file-poll` is scheduled and active. The Vault secrets aren't set yet, so each run does nothing.
- **27 checks against the running app** on the fixture tenant "Isolation Test A". A temporary entitlement row was removed afterwards; the registry rows stay, by design, labelled "LA-4.1 live check".
  - **Upload:**
    - a new file is received with a synthetic path;
    - the same bytes again are skipped and the skip recorded;
    - a corrected file supersedes the first, which stays listed and downloads byte-identical, with the download audited;
    - a broken workbook is registered `failed` with the reason;
    - a mislabelled file is refused with a 400.
  - **Email:**
    - the agency's address is created once;
    - wrong credentials get a 401;
    - the carrier comes from the known sender, and the type and date from the file name;
    - a logo attachment is ignored;
    - an unknown sender's file is kept as `failed` with the reason;
    - a retried message registers nothing twice.
  - **Bucket:**
    - a wrong token gets a 401;
    - the poll registers a drop attributed from its path, and fails an unknown carrier code while keeping its date;
    - a second poll finds nothing.
  - **Across the doors:**
    - all three write the same shape of row;
    - a read-only account gets 403 `read_only` on upload and can still list.
- **In the browser:** the page, the upload dialog's pre-fill (Mutual of Omaha, Policies, Oct 5, 2026) and the "Email and bucket" tab.

**Limits, said plainly:**
- **Request size:** an upload, or an email's attachments, travel in one request body (about 4.5 MB on a serverless host). Upload is capped at 4 MB, and an email over about 3 MB of attachments must use the bucket door.
- **Missing carriers:** six carriers in the Notion sample set aren't in the carrier library yet: American Amicable, Aflac, American Home Life, Corebridge, Sentinel Security Life and RNA. A file under their codes fails with "No carrier in the library has the code …".
- **Unknown senders:** an emailed file from an unknown sender is still kept, but `failed` until its sender is added.
- **Nothing reads rows yet:** files are registered as `received` and wait for the LA-4.3 parsers.

**Setup after applying the migration:**
1. **App environment:**
   - `CARRIER_FILES_POLL_SECRET`: 24 or more random characters.
   - `POSTMARK_INBOUND_USER`: 8 or more characters.
   - `POSTMARK_INBOUND_PASSWORD`: 16 or more characters.
   - One of:
     - `CARRIER_FILES_INBOUND_DOMAIN`, e.g. `in.insurvas.com`, which gives addresses like `<token>@in.insurvas.com`;
     - `CARRIER_FILES_INBOUND_ADDRESS`, Postmark's own address, which gives `<hash>+<token>@inbound.postmarkapp.com`.
2. **Postmark:**
   - Create an inbound stream.
   - If you use your own domain, add an MX record for the inbound domain.
   - Set the webhook URL to `https://<user>:<password>@<app host>/api/webhooks/postmark-inbound`.
3. **Supabase Vault** (for the 5-minute poll):
   - `app_base_url`: the deployed app's `https://…` address, with no trailing slash.
   - `carrier_files_poll_secret`: the same value as `CARRIER_FILES_POLL_SECRET`.

   The migration enables `pg_net` and schedules `la4-carrier-file-poll`. Without the vault secrets the job does nothing, and any other scheduler can call the poll route instead.

## LA-4.2: how it is built

**The data (`supabase/migrations/20261008110000_la_4_2_raw_rows.sql`):**
- **`raw_rows`:** one row per data line of a spreadsheet. `payload` is keyed by the file's own headers, verbatim (spelling, spacing, case).
  - Blank cells are kept as `""`, and blank lines are rows; nothing is filtered.
  - `row_number` is the physical line in the source file.
  - The primary key is `(file_id, row_number)`, and `(file_id, id)` is unique for later layers to point at.
  - It is partitioned 16 ways by hash of `file_id`.
- **Immutability:** UPDATE, DELETE and TRUNCATE are revoked from `service_role` and `tenant_app`. A trigger refuses them for everyone else, the table owner included. A corrected file is a new file (the 4.1 supersede path).
- **New columns on `file_registry`:** `sheet_name`, `raw_header_row`, `raw_columns` (column letter, header, key), `raw_preamble` (every line above the header), `raw_extracted_at`, `raw_error`.
  - Together with the rows, they rebuild the whole grid.
  - Once a file's rows are sealed, none of these can change.
- **Writing a file's rows:**
  - `insert_raw_rows` writes in chunks and skips a row that is already there, so a retry is safe.
  - `finalize_raw_extraction` seals the file, writing `row_count` only when the stored rows number exactly that.
- **`reprocess_runs`:** every reprocess, with its trigger, scope, parser version, files, rows read and changed, per-stage counts and result. No delete.

**The code:**
- **`lib/ingestion/grid.ts` (pure):** a CSV reader that keeps every line, a header-row guess (the first line as wide as the widest; 4.3's layout maps will replace it), the raw rows, and the round trip back to the grid.
- **`lib/ingestion/rawLayer.ts`:** extraction from the stored original.
  - CSV is decoded as UTF-8 when valid, otherwise as Windows-1252; never lossily.
  - Excel uses its first visible sheet.
  - It also holds the sweep, paged reads, and the reprocess wiring with `REPROCESS_STAGES`, which is empty until 4.6/4.7.
- **`lib/ingestion/reprocess.ts`:** the orchestrator. It reads each file's raw rows, checks their count against the registry, hands them to every stage in order, and records the run.
- **When rows are extracted:**
  - Upload and email extract after the response (`after()`).
  - The 5-minute poll registers bucket drops, then sweeps every spreadsheet still waiting.
  - A file whose rows can't be read gets `raw_error` and is not retried. A file still `received` also becomes `failed`.
- **`POST/GET /api/app/carrier-files/reprocess`:** start a run for one file or for a carrier and date range, or list recent runs. Owner and bookkeeper; starting a run is a write and is audited.
- **On screen:** Carrier files shows each file's **Rows**.

**Acceptance (Notion):**

| Criterion | Status |
|---|---|
| Every parsed file has exactly `row_count` raw rows | **Met.** `finalize_raw_extraction` refuses to seal otherwise, and a reprocess re-checks it. Verified on temp copies. |
| The payload round-trips every column, ignored and blank ones included | **Met.** `rawLayer.test.mjs` rebuilds the grid. |
| UPDATE/DELETE fail for the application role | **Met:** revoked, checked in the self-check, refused by trigger (verified). |
| Reprocessing rebuilds Layers 2 and 3, idempotent across two runs | **Framework met:** the orchestrator is tested idempotent with two stages. No real stage exists until 4.6/4.7. |
| A newer parser version picks up an ignored column with no new upload | **Data half met:** every column is in the payload. The parser half waits for 4.3. |
| A run is recorded with trigger, scope, parser version and rows affected | **Met.** |

**Verified live, 2026-10-07:**
- **The catalog:**
  - 16 partitions, `raw_rows_p00` to `p15`;
  - no UPDATE or DELETE for `service_role` or `tenant_app`, and no direct insert into a partition;
  - both triggers, both security-definer functions, all six new `file_registry` columns.
  - The catalog verifier reports "table raw_rows_p missing". That is a false alarm: it reads the `raw_rows_p%s` name template as a table name.
- **31 checks on the fixture tenant "Isolation Test A".** Its rows stay (raw rows never delete); a temporary entitlement row was removed afterwards.
  - **The sweep:** the poll extracted the 4 waiting 4.1 spreadsheets (the replaced one included), and a second sweep found nothing.
  - **Each extracted file:** `row_count` equals its raw rows, and the stored layer rebuilds the original bytes' grid exactly. The 3 failed files have no rows, and each says why.
  - **Locked:** UPDATE and DELETE through the app's role get "permission denied". A sealed file's row count can't change, and a sealed file takes no more rows.
  - **Reprocess:** one file, then one carrier's month twice. The same 3 files and rows both times, with nothing changed. Every run is recorded with trigger, scope, who, files and rows. A backwards date range gets a 400.
  - **Harder files, through the upload door:**
    - a 1,200-row CSV with a title line and a blank line in the middle: 1,200 rows sealed across chunks, the header at line 2, the title kept as preamble, the blank line kept as a row, a header with spaces kept verbatim, a quoted comma kept;
    - a real Excel workbook with a hidden first sheet: the visible sheet was read and its name kept, with blank cells kept;
    - a Windows-1252 CSV: "José" kept exactly, not replaced.

**Storage growth (the spec asks for this to be written down):**
- A raw row costs about the size of its cell text, plus its header keys, plus about 60 bytes of overhead.
- A 46-column policy file of 400 rows is about 400 × 2.5 KB, or roughly 1 MB.
- A solo agent with 6 carriers sending monthly files adds about 6–10 MB a year.
- An agency on daily feeds (8 carriers, about 1,000 policies) adds about 8 × 2.5 MB × 250 working days, or roughly 5 GB a year. That is the case the hash partitions are for.
- Raw rows are never pruned. They belong in a full tenant export (SA-6.3, not yet built) and not in routine exports.

**Header-row note:** until 4.3 the header row is a guess. If a carrier's file puts the header somewhere unusual, its rows are keyed by the wrong line. Nothing is lost (the preamble and column letters keep the whole grid), but the keys would be wrong. 4.3's layout maps fix this for files read after them.

## LA-4.3: how it is built

It follows LA-3.13's carrier field maps on purpose: the same statuses, the same frozen-once-published guard, staff approvers, and `proposal_source` as the place AI will plug in.

**The data (`supabase/migrations/20261008120000_la_4_3_layout_maps.sql`):**
- **`carrier_layout_map`:** one layout (`layout_key`) is a series of numbered versions: draft, in review, published, retired.
  - It holds the header row, the sheet, the row-count swing threshold, and, for commission files, the total row.
  - `tenant_id` null means a platform map; a set `tenant_id` is an agency's override.
  - A published version can't be edited, have columns added, or be deleted. A change means starting version N+1.
  - Only one version per layout is live at a time.
  - `publish_layout_map` publishes the draft and retires the version before it, in one step.
- **`carrier_layout_map_entry`:** the source column (its header, verbatim), the field it becomes, its type, one named transform, whether it is required, and (for enums) the carrier's word for each value. No code.
  - **Types:** `text`, `int_cents`, `date`, `basis_points`, `enum`, plus `integer`. `integer` is added for `months_advanced`; the spec's list had nothing to hold a whole number.
  - **Transforms:** `none`, `strip_currency`, `mmddyyyy`, `yyyymmdd`, `digits_only`, `negate`, `pct_to_bp`.
- **`carrier_layout_assignment`:** which layout a carrier's files of one type use, platform-wide or for one agency. This is how one layout serves Aetna, Aflac and AHL.
- **`agent_findings`:** the table spec'd in 4.19, created now for the deterministic parser guardian. It records the file, the map version, the kind, the severity, the reasoning and the payload, once per file, map version and kind. No delete.
- **`file_registry`:** `parser_id` now points at the map that read the file. New `parse_block` (`no_layout_map`) and `parsed_row_count` columns.

**The code:**
- **`lib/ingestion/layout.ts` (pure, no model, no network):** the target fields per file type, `convertCell` (integer cents and basis points, real dates, enums that must match exactly), `mapProblems` (checked before publishing), `chooseLayoutMap` (the resolution order) and `parseWithMap`.
  - A required column missing: the file fails.
  - Stated totals that don't balance: the file fails, with the arithmetic.
  - An unknown column: a finding.
  - A row-count swing past the threshold: a finding.
  - An unreadable value: that row is held back, with a finding.
  - The map's header row re-reads the kept grid, so a wrong guess in 4.2 is corrected without touching the raw rows.
- **`lib/ingestion/parser.ts`:** resolution, then the parse, the findings, and the parser record on the file.
  - A file with no layout map waits ("Waiting for a layout") and is parsed once a map is published or assigned.
  - The poll sweeps every sealed file. The doors extract and then parse after their response.
- **`lib/ingestion/reprocessRuns.ts`:** a reprocess now parses each file with its CURRENT map before the stages run, and records that map version. This is the parser half of 4.2's "a newer version picks up an ignored column".
- **Admin plane:** Catalog › **Layout maps** (`/admin/layout-maps`), for super_admin and platform_config.
  - Create a layout, edit its draft, publish, start N+1, retire, and assign carriers.
  - Routes are under `/api/admin/layout-maps`. Every write is audited (`layout_map.*`, `layout_assignment.*`).

**Acceptance (Notion):**

| Criterion | Status |
|---|---|
| A map has no code; a known layout for a new carrier is one row set and zero code changes, shown with a test carrier | **Met:** `layout.test.mjs` assigns a test carrier to an existing layout. |
| The Aetna/Aflac/AHL layout exists once, referenced by three carriers | **Structure met and tested.** The real map is written from the sample files. |
| A published map can't be edited in place; editing makes N+1 | **Met:** trigger, verified on temp copies. |
| Every file records the map id and version that parsed it | **Met:** `parser_id` (foreign key) and `parser_version`. |
| An unknown extra column parses and raises a finding | **Met.** |
| A missing required column fails and writes nothing to Layer 2 | **Met.** |
| A row-count swing past the threshold raises a finding without blocking | **Met.** |
| No AI provider call during a parse, shown by test | **Met:** `layout.ts` has only relative imports and no network or provider. |
| Agency override maps resolve ahead of platform defaults | **Met:** `chooseLayoutMap` tests. |

**Verified live, 2026-10-07:**
- **The catalog:** both guards; the one-published, version and assignment indexes; `publish_layout_map` runs as its owner and can't be called by `authenticated`; findings can't be deleted; `parser_id` points at the maps; both new columns exist; nothing seeded.
- **15 checks on "Isolation Test A", with maps scoped to that tenant** (keys `qa_isolation_a_*`, so the platform library is untouched). Those published maps and findings stay, by design.
  - **No map yet:** its 6 sealed spreadsheets wait ("Waiting for a layout") and don't fail.
  - **Publishing and assigning a map** parses the 1,200-row Mutual of Omaha file: 1,199 typed rows (the blank line skipped), `parser_id` and v1 recorded, and an unknown-column finding for "Insured Name" and " Notes ".
  - **v1 is frozen:** its settings and columns refuse changes. Publishing v2 retired v1.
  - **Reprocessing the same raw rows with v2:** the file and the run record v2, and "Insured Name" is no longer unknown. Nothing was uploaded.
  - **A missing required column** fails the file, naming the columns, with a blocking finding.
  - **Commission totals:** a balanced file parses (2 lines). A $10 mismatch fails with "the lines sum to $120.00, the file states $130.00".
  - **A 2-row file after a 1,199-row one** parses, with a row-count swing finding.
- **The admin screen:** loads its real tables with no platform layouts and the 8 active carriers (the deactivated test carrier hidden). Nothing was created there.

**Not done here, by decision:**
- **The guardian's AI half:** proposing a draft entry for an unknown column. It waits for a provider; the `proposal_source='ai'` hook is ready.
- **The seeded maps** (AMAM, the shared Aetna/Aflac/AHL layout, Mutual of Omaha, Americo, Corebridge, SSL): they wait for the sample files.
- **An agency screen for writing its own overrides:** resolution supports them; only staff can write maps today.
- **The unmappable-status rule:** belongs to 4.5. `carrier_status_raw` is carried verbatim.

## LA-4.5: how it is built

**The vocabulary:** nine statuses, each with its money meaning (`lib/ingestion/statuses.ts`): submitted, declined, withdrawn, approved_unpaid, not_taken, active, at_risk, lapsed, paid_up. The carrier's own word is always kept beside ours.

**The data (`supabase/migrations/20261008130000_la_4_5_status_map.sql`):**
- **`carrier_status_map`:** platform data, because a carrier's word means the same for every agency. One row per carrier, file type and word: `UNIQUE (carrier_id, file_type, carrier_status_raw)`.
  - A mapping takes effect only once approved.
  - An approved mapping is never changed or removed, because files were read with it. A proposal keeps its carrier word.
  - `proposal_source` is the place AI will plug in.
- **`unmapped_status_queue`:** one row per agency, carrier, type and word, with `first_seen_file_id`, the proposal fields (for AI later), `notified_at` and the resolution.
  - `unmapped_status_occurrences` keeps each file's count, so a re-parse replaces its own count instead of adding to it. The queue's count is their sum.
- **`record_unmapped_statuses`:** records what one parse found and returns which words are new.
- **`approve_status_mapping`:** makes a mapping take effect, resolves every agency's queue entry for that word, and returns the files to reprocess.
- **`file_registry.held_row_count`:** how many of a file's rows are held.

**The gate (`lib/ingestion/parser.ts`):**
- After a policy file parses, a row passes only if its `carrier_status_raw` is character for character a word with an approved mapping. It then carries both the carrier's word and `status_normalized`.
- Unmapped rows go nowhere downstream; reprocess hands stages the passed rows only. Each such word is:
  - queued, with its row count;
  - recorded as a blocking `unmapped_status` finding by the parser guardian;
  - emailed, once per new word, to the agency's owners and bookkeepers (template `carrier_files.unmapped_status`).
- Carrier files shows a notice listing the waiting words, and each file's held count.
- **Exact matching:** 4.3's reader now keeps `carrier_status_raw` verbatim. It is the one field that isn't trimmed. So "ACTIVE " stays "ACTIVE " and is queued as its own word.

**Mapping a word (admin plane):** Catalog › **Status maps** (`/admin/status-maps`), with carrier-library access.
- The queue gathers each word across agencies, shown with its spaces visible ("ACTIVE·").
- Staff choose one of the nine statuses and map it, which approves it.
- Approval reprocesses every held file from its raw rows; nothing is uploaded again.
- Proposals can be approved or discarded. Every write is audited (`status_map.*`).

**The second path to `at_risk`:** `effectiveStatus` is the helper 4.7 will use. It turns an active policy whose paid-to date is past the carrier's grace into `at_risk`, the same value a carrier word mapped to `at_risk` gives. With no grace configured (null, per 4.17), nothing is derived.

**Acceptance (Notion):**

| Criterion | Status |
|---|---|
| A mapped status reaches Layer 2 with both the raw and normalized values | **Met** for what goes downstream (passed rows carry both). Layer 2 itself is 4.6. |
| An unmapped status writes nothing further; one queue row per distinct word with the right count; notifications sent | **Met:** gate, queue and counts verified on temp copies; finding plus email. |
| Approving a mapping reprocesses held rows without a re-upload | **Met:** approval returns the held files, which are reprocessed from raw rows. |
| Matching is exact; a trailing space makes its own queue entry | **Met:** tests, and the verbatim reader. |
| A mapping can't take effect without `approved_by` | **Met:** constraint, and the gate reads approved mappings only. |
| Explicit and derived `at_risk` give the same value, shown by test | **Met:** `statuses.test.mjs`. |
| Seeds cover every status in the sample files, and no others | **Waiting** for the sample files. |

**Verified live, 2026-10-07** (the owner applied the migration):
- **The catalog:**
  - the guard is in place;
  - both functions run as their owner and can't be called by `authenticated`;
  - queue rows can't be deleted;
  - `held_row_count` exists.
- **The setup:** "Isolation Test A", with the deactivated test carrier "LA14 Market" and a tenant-scoped layout map. A 7-row policy file used the words `Active` ×2, `Active ` (trailing space), `ACTIVE` and `Pending UW` ×3.
- **The gate, before any approval:**
  - parsed 7, held 7;
  - 4 queue rows, one per word with the right counts: the trailing-space word is its own entry, and `ACTIVE` is separate from `Active`;
  - each entry records the first file it appeared in;
  - a blocking guardian finding;
  - exactly one email to the owner (logged as skipped, because delivery is off on the development machine), and every entry marked notified.
  - A reprocess replaced the counts rather than doubling them, and emailed no one again.
  - The agency's list shows "7 held". The page notice names the 4 words with their counts. The staff queue lists all 4.
- **Approval (owner-approved, on the test carrier only):** `Pending UW` → submitted, through `/api/admin/status-maps`.
  - It is approved by the QA staff account, with the word kept exactly.
  - The automatic reprocess (trigger `status_map_approval`) re-read the 7 raw rows: held went from 7 to 4.
  - The entry is resolved by that mapping; the other 3 words stay open.
  - Changing the mapping is refused, and mapping the word again gets a 409. The approval is audited, and the queue no longer lists it.
  - This leaves one permanent mapping, on the test carrier, which no agency uses.
- **The catalog verifier** reports 20261008130000 as applied.

**Not done here:**
- **The guardian's AI proposal:** waits for a provider. The `proposed_*` columns are ready.
- **Notification channel:** by email and a page notice, not the live alert feed. That feed drops a row with no lead link after about 10 minutes and plays sounds, which doesn't suit a status that waits for staff.
