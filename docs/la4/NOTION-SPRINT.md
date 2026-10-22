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
| 4.6 Snapshots, change detection | **Done 2026-10-07.** Migration `20261008140000` live and verified (below). |
| 4.7 Current-state table | **Done 2026-10-07.** Migration `20261008160000` live and verified (below). Money fields wait for 4.12; contact links for 4.8. |
| 4.8 Policy ↔ CRM matching with AI | **Non-AI parts done 2026-10-07.** Migration `20261008170000` live and verified (below). The AI reviewer waits for a provider; a person decides step 3 meanwhile. |
| 4.9 Exception queues | **Done 2026-10-07.** Migrations `20261008180000` and follow-up `20261008180100` live and verified (below). |
| 4.10 Existing-book import | **Done 2026-10-07.** Migration `20261008190000` live and verified (below). Portal guidance ships empty, for staff to write. |
| 4.11 Policy list and detail | **Done 2026-10-07.** Migration `20261008210000` live and verified (below). Money figures and their ledger links wait for 4.12. |
| 4.12 Commission ledger | **Done 2026-10-07.** Migration `20261008220000` live and verified against the live function (below). No commission layout exists yet, so the ledger is empty until one is written from a real carrier file. |
| 4.13 Expected commission | **Done 2026-10-08.** Migration `20261008230000` live and verified against the live function (below). No agency has rates or product families yet, so no figure exists until they are entered. |
| 4.14 Orphan queue and carrier accounts | **Done 2026-10-08.** Migration `20261008240000` live and verified against the live objects (below). |
| 4.15 Discrepancies, letters | **Done 2026-10-08.** Migration `20261008250000` live and verified against the live functions (below). Rebuilt on 4.12–4.14; the earlier module stays as "From imported statements". |
| 4.16 Retention board | **Done 2026-10-08.** Migration `20261008260000` live and verified against the live functions (below). The call list is the new default tab on Lapse risk; the earlier board stays as "Recorded signals". |
| 4.17 Carrier rules | **Done 2026-10-07.** Migration `20261008150000` live and verified (below). Rules, settings, coverage screen (below). The old statements engine still hard-codes 45 days; it retires with that code. |
| 4.18 Scorecards, persistency, AI summary | **Done 2026-10-08.** Migration `20261008270000` live and verified (below). New page Insight › Book scorecards. The summary is written from templates; AI prose waits for a provider, behind a figure-and-prediction gate. |
| 4.19 Daily run, AI agents | **Done 2026-10-08 (deterministic parts).** Migration `20261008280000` live and verified (below). The orchestrated run, stage records and resume, the file monitor, the agent role and contract, prompt safety, batching, accuracy. The model-backed agents wait for an AI provider. |
| 4.20 Traceability | **Done 2026-10-08.** Migration `20261008290000` live and verified (below). Every figure to its file row in the product; discrepancies with a broken trace withheld; the daily trace health check; the build fails on an unregistered screen. The cropped PDF region waits for 4.4. |

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

## LA-4.6: how it is built

**The data (`supabase/migrations/20261008140000_la_4_6_policy_snapshots.sql`):**
- **`policy_snapshot`:** one row per policy per policy file, with the Notion columns.
  - `snapshot_date` is the file's date, and every row carries `file_id` and `raw_row_id`. The pair is a foreign key to `raw_rows (file_id, id)`.
  - `extra` keeps the fields the map read that have no column, and the columns the map didn't read, so nothing is dropped.
  - One current snapshot per agency, carrier, policy and file date: a unique index where not superseded. The spec's key adds the agency, because two agencies can each receive a file listing the same policy.
  - **Immutable:** a trigger refuses every edit. The one move allowed is being marked superseded by a reissue.
- **`policy_change`:** derived and disposable, for the 11 tracked fields.
  - Both dates are file dates, with no default.
  - `from_file_id` and `to_file_id` are kept.
  - A change must move a value and go forward in date.
- **`policy_event`:** `first_seen`, once per policy.
- **Writing Layer 2:** only through two security-definer functions. Insert, update and delete are revoked from the app roles.
  - `replace_file_snapshots` swaps in one file's snapshots, marks a replaced file's ones superseded, and returns what changed by content and every policy touched.
  - `replace_policy_changes` swaps in the history of exactly those policies.
- **`file_registry.derived_at`:** when a file's derived layers were last written. A policy file that parsed but wasn't derived is retried by the sweep.

**The code:**
- **`lib/ingestion/snapshots.ts` (pure):** typed row → snapshot; one per policy per file, keeping the first row of a repeated policy (and recording a finding); the content text used to tell what changed; `historyOf`, which orders each policy's snapshots by file date then arrival and diffs each consecutive pair whatever the gap; and the "between the files of X and Y" wording.
- **`lib/ingestion/snapshotStore.ts`:** build the snapshots, replace them, recompute only the touched policies' history, and set `derived_at`. Also the change list for the screen.
- **`lib/ingestion/stages.ts`:** `REPROCESS_STAGES = [policy_snapshot]`, the first real stage. A door and the sweep run it after a parse (`deriveFile`), with the rows that passed 4.5's gate; a reprocess runs it after re-parsing.
- **On screen:** Carrier files › **Policy changes**. Each change says when it happened as precisely as the files allow: "between the files of Sep 5 and Oct 5", or "corrected in a reissued file of Oct 5". That is the plain statement the spec asks for about monthly accuracy.

**Acceptance (Notion):**

| Criterion | Status |
|---|---|
| One snapshot per policy per file date; the unique constraint prevents duplicates | **Met:** unique index, verified on temp copies. |
| active → lapsed makes exactly one change row with the right from/to dates | **Met:** `snapshots.test.mjs`. |
| The diff works across 1-day and 31-day gaps, with no "yesterday" | **Met:** test, plus a check that the engine has no clock. |
| A first-time policy is a first-seen event with no change rows | **Met.** |
| A back-dated file recomputes the changes around it, for that policy only | **Met:** the test moves the lapse to the window the late file reveals; only the touched policies are recomputed. |
| from/to are always file dates | **Met.** |
| Change rows can be deleted and rebuilt from snapshots | **Met:** a rebuild in any order gives identical rows; the replace is verified on temp copies. |
| Every snapshot carries `file_id` and `raw_row_id` | **Met:** foreign key, verified. |

**4.6 verified live, 2026-10-07** (the owner applied the migration):
- **The catalog:** the one-per-day index, the raw-row foreign key and the guard; both functions are security definer and can't be called by `authenticated`; `service_role` can't insert or update snapshots, or delete changes; `derived_at` exists. The verifier reports applied.
- **The setup:** "Isolation Test A", with the deactivated test carrier "LA14 Market" and a tenant-scoped map (policy, status, paid-to date, premium).
- **16 checks with no new mapping:**
  - one snapshot per policy, dated by the file and pointing at its raw row;
  - a row held by the status gate gets no snapshot;
  - first-seen events with no changes;
  - two months apart, the paid-to date and a premium change are each dated by the two files;
  - a policy first seen in November is first seen in November;
  - **a late October file** recomputes the history around it (paid-to Sep → Oct → Nov; the premium change moves to Oct → Nov) and leaves a policy it doesn't list untouched;
  - **a corrected November file** takes the day, keeps the replaced snapshot superseded, and records the correction as a change on that day;
  - reprocessing rebuilds with 0 changed and the same history;
  - the app's role can't edit snapshots or delete changes;
  - `derived_at` is set.
- **The page:** the "Policy changes" tab's data carries every change with its file dates. The fixture's owner hasn't accepted the terms, so the rendered table couldn't be seen; its wording is unit-tested.
- **The lapse (owner-approved):** "Active" → active and "Lapsed" → lapsed were mapped on the test carrier only, which leaves two more permanent mappings that no agency uses. Two files a month apart give exactly one `status_normalized` change, active → lapsed, from 2026-09-05 to 2026-10-05 with both file ids, plus the carrier's own word changing, and nothing else.
  - Approving "Active" also released the 2 fixture files that held "Active" rows, and reprocessed them automatically.

## LA-4.17: how it is built

**The data (`supabase/migrations/20261008150000_la_4_17_carrier_rules.sql`):**
- **`carrier_retention_rule`:** how many days a carrier gives for each kind of save (first payment, ongoing payment, reinstatement, conservation, cancellation request), plus grace, redraft attempts and the days between them.
  - `tenant_id` null is the platform's rule; an agency's own row overrides it.
  - **Effective-dated and append-only:** a change is a new row from a date. A trigger refuses every edit and every delete; the one change allowed is verifying a rule, once. Delete and truncate are also revoked.
  - Every rule says where it came from (carrier agreement, phone call, observed). Verification is recorded with who did it.
  - An agency can **clear** its override, which is a row with no numbers, handing the rule back to the platform's.
  - **No default anywhere:** no column default for a window or a grace, and nothing in the code falls back to one.
- **`carrier_operating_settings`:** one platform row and one agency row per carrier: commission trigger (on issue / on first draft), payment lag, minimum payout, tolerance, file cadence, statement format. Each setting resolves agency → platform → null.
- **`in_force_policy_counts(tenant)`:** each policy's latest live snapshot, active or at risk, counted per carrier. Security definer, service role only.
- **Seeds (observed, unverified):** Aetna ongoing payment 45 days; Americo first payment 8 days. Both from the Module 4 BRD, dated 2026-10-05, guarded so a re-run adds nothing. Aflac and American Home Life share Aetna's window but aren't in the carrier library, so they ship absent.

**The code:**
- **`lib/ingestion/carrierRules.ts` (pure):** `resolveRule` (agency unless cleared, then platform, then null; the latest rule on or before the date, the newest row of that day), `daysUntilCarrierCloses` (null with no window, which LA-4.7 uses), `coverageGaps` (the coverage sentence), `resolveSettings`.
- **`lib/ingestion/carrierRulesStore.ts` / `carrierRulesHttp.ts`:** load per carrier (rules, gaps, in-force count, settings, and the settings kept elsewhere: commissions address, layout map, portal, reference pattern); add a rule, clear an override, verify, save settings. Each write is audited (`carrier_rule.added`, `.override_cleared`, `.verified`, `carrier_settings.saved`).
- **Routes:** `/api/app/carrier-rules` (owner, bookkeeper; `statement_ingestion`) and `/api/admin/carrier-rules` (the carriers configuration section).
- **On screen:** Book of Business › **Carrier rules** for an agency, and **Carrier rules** in the admin Catalog for the platform. One row per carrier with each kind of save's window ("Not set" when absent), whose rule it is, and "unverified" where it is. An agency also sees in-force counts and three tiles: carriers missing a rule, policies with no save window, unverified rules. The editor adds a rule from a date, verifies, clears an override and saves settings.

**Acceptance (Notion):**

| Criterion | Status |
|---|---|
| Agency rule overrides the platform's; absent is null, never a default | **Met:** `carrierRules.test.mjs`; no default in the schema (static test and temp copies). |
| Effective-dated; a past action keeps the rule it used | **Met:** append-only, verified on temp copies; resolution by date is tested. |
| A null window gives a null countdown | **Met:** tested; LA-4.7 consumes it. |
| Coverage screen: "X — window not set. N policies in force…" | **Met:** wording tested; counts from `in_force_policy_counts` (verified on temp copies). |
| Every rule has a source; unverified is shown as unverified | **Met:** check constraint; the screen marks it. |
| Nothing in LA-4 hard-codes a window, grace or lag | **Met for `lib/ingestion`** (grep test). The old statements engine's `NEVER_PAID_GRACE_DAYS` retires with that code. |

**Before the migration (2026-10-07):** 24 checks on rolled-back temp copies, including the seeds, no edits or deletes, verify once, the constraints, one settings row per scope, and the in-force count (latest live snapshot only, this agency only). Both pages show only "Carrier rules need a database update (20261008150000)"; the APIs answer `available: false`.

**4.17 verified live, 2026-10-07** (the owner applied the migration):
- **The catalog:** the verifier reports applied. The append-only trigger is on; no role can delete or truncate rules; `tenant_app` only reads, through one read policy per table; `in_force_policy_counts` is security definer and runs as `service_role` only; no column defaults for window, grace or redrafts; one settings row per carrier per scope. 19 of 19 read-only checks pass.
- **The seeds:** exactly two, as written: Aetna ongoing payment 45 days and Americo first payment 8 days, both observed, unverified, from 2026-10-05. No settings rows ship. `tenant_app` can't edit or delete a rule (checked in a rolled-back transaction).
- **In-force counts:** the fixture's count (2, on LA14 Market) matches a count done by hand from its latest live snapshots.
- **The pages:** the agency page (demo agency) lists the 8 active carriers, the two seeds as "platform · unverified" and every other window as "Not set", with tiles 8 / 0 / 2. An agency gets no "Mark verified" on a platform rule. The admin page shows the same grid without in-force counts. Refused writes (no source, out of range, an unknown field, verifying something that isn't the agency's, a platform "clear", no session) return 400/409/401 and store nothing.
- **The write path (owner-approved):** on "Isolation Test A", with LA14 Market reactivated only for the test (and a temporary entitlement), both removed in a finally block.
  - While deactivated, the carrier is refused.
  - An owner adds a 10-day first-payment rule (3 d grace, 2 redrafts), shown as theirs and unverified; it stops being a gap. They verify it once; a second verify is refused. It is stored with who created and verified it.
  - Clearing the override takes it back to null (no platform rule, no default); both rows are kept.
  - Settings save and save again into one row, as the agency's.
  - All five writes are in the audit log with the fixture's tenant.
  - Left behind, permanently and on the fixture only: two rule rows and one settings row for LA14 Market.

## LA-4.7: how it is built

**The data (`supabase/migrations/20261008160000_la_4_7_policy_current.sql`):**
- **`policy_current`:** one row per agency, carrier and policy (the spec's key plus the agency, as in 4.6). It holds the latest live snapshot's values (and `snapshot_id`), our links, and the computed fields. `status_reported` keeps the snapshot's own status; boards read `status_normalized`.
- **Derived and disposable.** One function writes it, `refresh_policy_current(tenant, carrier, policies, as_of)`. It deletes the rows in scope and re-inserts them, and the app roles can't write the table. No clock is stored in a row (only `as_of`), so a rebuild is identical.
- **Three ways in, one computation:**
  - incremental, after each parsed file, for the policies it touched (inside the snapshot stage, right after their history);
  - after a carrier rule changes (that carrier, for one agency or every agency);
  - daily, for every policy (pg_cron `la4-policy-current-daily`, 06:15 UTC). The migration runs that job once and checks one row per live policy.
- **"Today"** is the agency's day: `agency_profiles.timezone`, else UTC.

**The computed fields:**

| Field | How |
|---|---|
| `annualised_premium_cents` | premium × 12 / 4 / 2 / 1 by mode; null without a mode |
| `days_past_due` | `as_of − paid_to_date`, floored at 0; never from the file's date |
| `days_until_carrier_closes` | the 4.17 rule's window − days past due; **null with no rule**. First payment rule until a payment is on record, then ongoing. The rule used is in `retention_rule_id` |
| `status_normalized` | the snapshot's, except `active` past the rule's grace becomes `at_risk`, the same value the 4.5 map gives |
| `months_paid` | whole months from effective date to paid-to date (Postgres `age`) |
| `in_clawback_window` | months paid < the LA-0.4 advance rule's clawback months (matched on carrier and product); null with no rule |
| `risk_band` | from observed facts only, no threshold of its own: **critical** = at risk and (inside clawback or past the carrier's window); **at_risk**; **watch** = active with days past due; **none**. Unknown is never critical |
| `lapsed_on`, `issued_on` | from `policy_change`: the file that first showed the lapse / first showed it active after submitted or approved-unpaid |
| `application_id`, `case_id`, `campaign_id`, `vendor_id` | an LA-3 submission to the same carrier with the same policy number, its case, and the case's LA-2 attribution |

**Null until their task ships (never guessed):**
- `total_advanced_cents`, `total_earned_cents`, `total_charged_back_cents`, `unearned_advance_cents`: LA-4.12's ledger.
- `contact_id`, `household_id`: LA-4.8.
- `agent_user_id`: needs a map from a carrier's agent code to a user, which doesn't exist yet.
- `lead_cost_cents`: LA-2 derives a cost per lead and stores none per policy.

**The code:** `lib/ingestion/policyCurrent.ts` is the same arithmetic as plain functions, unit-tested (`policyCurrent.test.mjs`); the rehearsal checks SQL and TypeScript agree. `policyCurrentStore.ts` calls the refresh, and a missing function reads as a schema gap, so parsing keeps working before the migration. There is no new screen: the boards and lists that read this are 4.11 onwards.

**Acceptance (Notion):**

| Criterion | Status |
|---|---|
| Rebuildable from Layer 2 with identical results (drop-and-rebuild test) | **Met:** rehearsal, identical md5 over every row after drop + rebuild + rebuild. |
| `annualised_premium_cents` correct for all four modes | **Met:** unit test; SQL matches on 288 policies. |
| `days_past_due` from `paid_to_date`, advancing daily with no new file | **Met:** unit test and rehearsal (6 → 7 → 8 by moving `as_of`). |
| `days_until_carrier_closes` null, not zero or a default, with no rule | **Met:** unit test; no carrier without a rule gets a countdown; the migration's check refuses one. |
| `unearned_advance_cents` reconciles to the ledger | **Waiting on LA-4.12:** null until the ledger exists. |
| `risk_band` changes only with observed fields; nothing predictive readable | **Met:** derived from status, days past due, the window and clawback; a static test refuses any predictive column. |
| `lapsed_on` from the change log, matching the snapshot pair | **Met:** rehearsal (Sep 5 → Oct 5 pair gives Oct 5). |
| Derived and mapped `at_risk` indistinguishable downstream | **Met:** identical computed rows (unit test). |
| A dashboard query over 50,000 policies under 500 ms | **Met in rehearsal:** 303 ms for two queries with round trips; the 50,000 build takes 2 s. |

**Before the migration (2026-10-07):** 26 checks on rolled-back temp copies, including SQL = TypeScript across 288 policies, rule resolution, the clock, rebuild identity, incremental scope, the change-log dates, the LA-3 link, the agency's timezone and 50,000 policies. The first run found the timezone lookup re-evaluated per policy (29 s for 50,000); it is now computed once per agency.

**4.7 verified live, 2026-10-07** (the owner applied the migration):
- **The catalog:** the verifier reports applied. No app role can insert, update or delete `policy_current` (`service_role` and `tenant_app` read; `anon` and `authenticated` see nothing). Both functions are security definer and run as `service_role` only; the live function has the materialized timezone step. RLS is on with one read policy, and the six indexes exist. The daily job `la4-policy-current-daily` is scheduled (`15 6 * * *`) and active.
- **The rows:** 9 rows for the 9 live policies across every agency, each pointing at its policy's latest snapshot. Every row equals the TypeScript computed with the live carrier and advance rules. No countdown exists without a rule, and the money and contact fields are null.
- **The fixture:** the lapsed policy's `lapsed_on` (2026-10-05) is the change-log transition. A rebuild gives identical rows. Refreshed as of tomorrow with no new file, every days-past-due moves by one (36 → 37), and refreshing again restores today's rows exactly.
- **Access:** as `tenant_app` (rolled back), the fixture sees only its own 9 rows, and can neither delete nor call the refresh.
- 17 of 17 checks pass.
## LA-4.8: how it is built (non-AI parts)

**The data (`supabase/migrations/20261008170000_la_4_8_policy_matching.sql`):**
- **`policy_match`,** the link record, with the Notion columns plus `ladder_step`.
  - **Append-only:** a trigger refuses edits and deletes. The two allowed stamps are superseded (once) and confirmed (once). The app roles can't insert or update it directly.
  - **One way in:** `record_policy_match` supersedes the policy's current link and inserts the new one in one transaction (the self-reference is deferred). It also closes the open review it answers and takes the household from the contact. It refuses a client from another agency.
  - **Every link says how:** an `ai_review` link must carry model, prompt version, confidence and reasoning (a CHECK), and a non-AI link may carry none of them. Exact links carry no confidence. `provisional` ("no client found") points at nothing. One current link per policy.
  - `confirm_policy_match` stamps a person's confirmation, once.
- **`policy_match_review`:** the queue for step 3. One open review per policy, holding the carrier side (`carrier_row`) and the scored shortlist.
- **`carrier_agent_map`:** the carrier's agent string → our user, unique on the **exact** string, mapped once by a person. No fuzzy matching anywhere (a static test refuses levenshtein, similarity, trigram or ilike).
- **`policy_match_ladder`:** per file, how many policies each step resolved.
- **`refresh_policy_current` is re-created** to fill `contact_id` and `household_id` (from the current link) and `agent_user_id` (from the map). A test proves it is 4.7's function plus exactly those three edits.

**The ladder** (`lib/ingestion/policyMatchingStore.ts`), run in the snapshot stage before `policy_current` is refreshed:
1. **Already linked:** nothing to do.
2. **We hold the number:** an LA-3.15 submission (`submission_record`), or our own LA-2.17 issued policy (`policy_number_exact`, carrier compared by exact name or code). Linked with certainty, no AI.
3. **Otherwise, a shortlist:**
   - candidates are deal-flow entries and applications for the same carrier, dated up to 14 days before the file, and the mapped agent's own when the agent string resolves;
   - each is scored on surname 25, given name 15, DOB 25, phone 20, premium 10 and face 5;
   - "likely" needs 60 points **and** three agreeing fields, so **no single field decides** (a full name alone isn't enough either);
   - the best five go to the queue.

   **The AI reviewer isn't configured,** so a person picks a candidate or "none of these". That link is `human`, confirmed by them.
- A matching failure is logged and leaves the policies unlinked. It never loses the snapshots.

**The privacy payload** (`reviewPayload`, for when the AI arrives) is built field by field: name, DOB and phone, plus premium and face, for the carrier row and the shortlisted candidates only. A test slips an SSN, bank numbers, email, address and notes into a candidate and proves none of them comes out.

**On screen:** Book of Business › **Policy matching** (owner, bookkeeper).
- **Tiles:** waiting for a person; share linked by number; share needing review ("high means numbers aren't captured at submission"); AI accuracy over 7 days ("AI review isn't configured" until then); agent codes unmapped.
- **Tabs:**
  - **To review:** a field-by-field comparison with each candidate's score.
  - **Links:** how each was made, with "Reopen" to correct one.
  - **Agent codes:** map an exact string to a person, or unmap it.
- Every change is audited.

**Acceptance (Notion):**

| Criterion | Status |
|---|---|
| A policy-number match on an LA-3.15 submission links as `submission_record`, no AI | **Met:** ladder step 2; rehearsal. |
| No policy-number match → shortlist, scores, AI decision, confidence, reasoning | **Partly:** shortlist and scores are built and queued; **the AI decision waits for a provider** (a person decides meanwhile). The table already refuses an AI link without confidence and reasoning. |
| No single field can produce a match (surname-only test) | **Met:** tested for every field alone, and for a full name alone. |
| Every link carries its method; AI links carry model and prompt version | **Met:** NOT NULL and CHECK constraints, verified on temp copies. |
| Correcting a match supersedes and leaves the old one readable | **Met:** rehearsal. |
| Agent resolution is exact-only; unresolved goes to a queue | **Met:** a different-case string doesn't resolve; the Agent codes tab is the queue. |
| The payload has name, DOB and phone for shortlisted candidates only | **Met:** test. |
| Accuracy measured against human confirmations, weekly | **Built:** shown for the last 7 days; nothing to measure until AI links exist. |
| The share resolving at each ladder step is visible | **Met:** tiles from `policy_match_ladder`. |

**Not done here:** pre-filling the agent map from LA-0.4 writing numbers. Those are held per agency, not per agent, so they can't say which person a code belongs to.

**Before the migration (2026-10-07):** 23 checks on rolled-back temp copies pass. The page shows only "Policy matching needs a database update (20261008170000)"; the API answers `available: false`, and writes return 503. A parse before the migration skips matching (it reads as a schema gap).
**4.8 verified live, 2026-10-07** (the owner applied the migration):
- **The first two applies failed on the migration's own check, and rolled back whole.** Supabase grants `service_role` every privilege on a new table by default, and the first version revoked only delete and truncate on `policy_match`. The second apply was run from the earlier paste. The fix revokes insert, update, delete and truncate explicitly (as 4.7 does), a test pins it, and the error now names which privileges remain. The rehearsal couldn't catch this, because it strips grants.
- **The catalog (13/13):**
  - `service_role` can only read `policy_match`; `tenant_app` reads all four tables; `anon` and `authenticated` see nothing.
  - The queue and the map are writable by the server and never truncatable.
  - `record_policy_match`, `confirm_policy_match` and `refresh_policy_current` are security definer and run as `service_role` only.
  - The guard is on; the self-reference is deferred; the link checks, the one-current-link and one-open-review keys, the exact agent-code key and the issued-number index all exist; RLS is on all four tables.
  - The live refresh joins the current link and the exact agent string.
- **Through the app, on the fixture** (temporary entitlement; review and ladder rows deleted afterwards):
  - Reprocessing a 5-policy file runs the ladder: 5 open reviews, each with the carrier side dated by the file and an empty shortlist (the fixture has no deals or applications, so nothing is invented). The ladder row reads 0 / 0 / 5. No link is written.
  - Running it again keeps one open review per policy.
  - The page data shows 100% needing review, with AI not configured.
  - Picking a candidate that isn't on the shortlist is refused (400), and so is mapping a code to someone outside the agency.
  - The fixture files carry no agent codes, so map/unmap was proven only on the temp copies.
  - `policy_current` keeps every computed value. Only `snapshot_id` follows the fresh snapshot rows a reprocess writes, and the 4.7 parity check (17/17) still passes.
- **The link writer on the live tables,** in a block that ends by raising (so everything rolled back):
  - a link fills `policy_current`'s contact and household;
  - a correction supersedes, leaving one current link;
  - edit and delete are refused (P0001), and so are an unexplained AI link (23514) and a client from another agency (22023);
  - "none of these" clears the client.

  Afterwards: 0 links, 0 rehearsal contacts, 0 reviews.
- **The page** (demo agency) renders the five tiles and three tabs with nothing to review.
## LA-4.9: how it is built

**The data (`supabase/migrations/20261008180000_la_4_9_exception_queues.sql`):**
- **`contacts.provisional`,** plus `provisional_source` (which carrier file and policy it came from) and who confirmed it, and when.
- **`queue_assignment_rule`:** per agency and queue, the owner role, "raise after" days (queue 2), "escalate after" days and an optional escalate-to role. With no rows, the built-in defaults apply, so a solo agent configures nothing.
- **`queue_item`:** the Notion columns plus the subject (policy, sale or pair of clients), the item's age (`age_from`), and the resolution with who and what.
  - `assigned_to_user_id` is **NOT NULL**. Items are written only by `open_queue_item`, `resolve_queue_item` and `reassign_queue_item`; `service_role` and `tenant_app` can't insert, update or delete them.
  - One open item per subject per queue; the sweep never reopens a closed one.
- **`queue_owner`:**
  - **writing_agent** → the policy's mapped agent or the sale's agent, if they can open the screen (owner or producer);
  - **operations** → a bookkeeper; **retention** → a producer; **admin** → an owner.
  - A role with nobody in it → **the agency's owner**. An agency with no active owner is refused, never left unowned.
  - The codebase has no operations or retention roles, hence this mapping.
- **`sweep_exception_queues`** (pg_cron `la4-exception-queues-daily`, 06:30 UTC; the migration runs it once):
  - **Queue 2:** a sale (`deal_flow`, `application_submitted`, completed) at least N days old (default 5), at a carrier whose *parsed policy file dated at least N days after the sale* we hold, with no link. Without that file "no carrier has heard of it" can't be known, so nothing is raised.
  - **Escalation:** past the second threshold (default 10 days from the sale), plus a reassignment when the agency set an escalate-to role.
  - **Self-closing:** an item whose sale or policy has since been linked closes itself ("auto_linked", resolved by nobody).
- **`close_case_never_submitted`:** the sale's open application case becomes `abandoned` with reason `never_submitted`. The LA-2.17 funnel's "applied" step already excludes abandoned cases, so the number becomes honest.
- **Two new `policy_match` methods,** both step 3 with no confidence and with a client: `no_match` (linked to the provisional client) and `identity_exact` (an existing client with the exact same first name, last name and date of birth).

**The flow** (`lib/ingestion/exceptionQueuesStore.ts`, called from the 4.8 ladder):
- **A policy whose shortlist is empty** (or whose review a person answers "none of these"):
  - Exactly one existing client with the same first name, last name and date of birth → linked silently (`identity_exact`). This is the normal multi-policy case.
  - Otherwise a **provisional client** is made from the carrier's own name, date of birth, phone and address, through `save_contact`, so a shared address joins the existing household. That's how spouses become two clients in one household. It is linked `no_match`.
  - Either way, one **queue-1** item goes to the writing agent.
  - A provisional client that looks like someone on file but isn't certain (same surname plus a matching date of birth, phone or given name) gets a **queue-3** item for operations.
- **Before the migration,** nothing is created: the ladder keeps the 4.8 review.
- **Resolutions:**
  - **Queue 1:** confirm the client (clears provisional, with who and when), link an existing client, link the sale, or "not mine" (to operations, then the owner).
  - **Queue 2:** found the policy (link it to the sale), never submitted (with the reason; the case is abandoned), resubmitted elsewhere (an LA-3.16 attempt of the same client), or not mine.
  - **Queue 3:** same person (the provisional client's policies move to the existing client, and the provisional one is folded in), or different people.

**On screen:**
- **Book of Business › Exceptions** (owner, producer and bookkeeper, because items carry premiums; a money route).
  - Producers see the items they own; the owner and bookkeepers see all.
  - **Tiles:** sales no carrier has, policies with no sale, possibly one client, oldest open.
  - **Tabs:**
    - **Open:** one table per queue, oldest first, with the **age** as the first and largest thing on each row and "escalated" in red.
    - **Closed, 30 days:** how each was closed, and by whom.
    - **Who owns each queue:** owner only.
- **"Provisional" is shown** in the contact directory and its detail, the Exceptions screen, the Policy matching links, and a `provisional` column in the contact CSV export.

**Acceptance (Notion):**

| Criterion | Status |
|---|---|
| A policy with no match creates a provisional contact and one queue-1 item | **Met:** store path and tests; live check after the migration. |
| A provisional contact is marked everywhere it appears until confirmed | **Met** for every screen that lists contacts today (the surfaces above); lead screens show the lead's own name, not a contact's. |
| A sale with no policy after the threshold → queue-2 item to the writing agent, escalating past the second threshold | **Met:** rehearsal (raised at 6 days, escalated at exactly 10, not at 9). |
| "Never submitted" records the reason and shows in the LA-2.17 funnel | **Met:** the case is abandoned with the reason; the funnel excludes abandoned cases. |
| High-confidence multi-policy links resolve without a queue item | **Met:** an exact name and date of birth links silently; anything less asks operations. |
| A husband and wife at one address → two contacts, one household | **Met by construction:** different given names never match exactly, and `save_contact` joins the household by address. Live check after the migration. |
| `assigned_to_user_id` is never null; an empty role falls back to the owner | **Met:** NOT NULL, rehearsed for every case (unknown, inactive and wrong-role agents; no bookkeeper; no owner refused). |
| Rules are per-agency configurable; a solo agent needs none | **Met:** rehearsal and screen. |
| Every item shows its age; every resolution records who and what | **Met.** |

**Before the migration (2026-10-07):**
- 29 checks on rolled-back temp copies pass; 2,137 tests pass.
- The page shows only "The exception queues need a database update (20261008180000)", writes answer 503, and the contact directory still works (its provisional read tolerates the missing column).
- The first browser POST found a real bug: zod refuses six request branches sharing one discriminator. The request is now a nested union, in its own module, with a test that parses every shape.
**4.9 verified live, 2026-10-07** (the owner applied the migration):
- **The first apply failed** with "syntax error at or near begin" at line 414 of a 386-line file. The editor tab held about 28 extra lines in front of the script. The file itself parses (checked in a rolled-back transaction) and every DO block compiles. A clean tab applied it.
- **The catalog (16/16):**
  - `contacts` has `provisional` (NOT NULL, default false), its source, and who confirmed it, and when.
  - `service_role` only reads `queue_item`; `tenant_app` only reads both tables; `anon` and `authenticated` see nothing.
  - The six functions are security definer and run as `service_role` only. `assigned_to_user_id` is NOT NULL.
  - The one-open-item key and the provisional and identity indexes exist. `policy_match` accepts `no_match` and `identity_exact` only as step 3, with a client and no confidence.
  - The live `queue_owner` limits a writing agent to owner or producer and falls back to the owner. RLS is on.
  - The daily job `la4-exception-queues-daily` (`30 6 * * *`) is active.
  - The migration's own sweep created nothing (0 items, 0 provisional contacts).
- **Owners on real agencies:**
  - Fixture: an unknown agent and operations (no bookkeeper) both → its owner.
  - Demo: an unknown agent → an owner; operations → its bookkeeper.
- **On the live tables,** in blocks that end by raising (so everything rolled back):
  - Opening an item twice gives one item, owned; a null owner is refused (23502); a resolution records who and what, once.
  - **Queue 2 on the demo agency:** no item while no carrier file exists. With a later parsed file: exactly one item, for the producer, aged from the sale and escalated (12 days); a second sweep adds nothing. "Never submitted" abandons the case with `never_submitted` and who closed it.
  - **Provisional clients on the demo agency:** spouses saved at one address are **two contacts in one household**. The provisional flag carries its source, the link is `no_match` / step 3 / that client, and the queue-1 item is owned and for that client.
  - Afterwards: 0 items, 0 provisional contacts, and no rehearsal contacts or deals left.
- **Two findings:**
  - **A provisional contact could have no source.** The CHECK let `jsonb_typeof(null)` through. Fixed in `20261008180100`, applied and verified live: no source or a non-object source is refused (23514); a proper source and non-provisional contacts are accepted.
  - **`save_contact` fails for 556 of 565 agencies**, including the fixture: they have no legacy `organizations` row, and both `contacts` and `households` require one. This existing LA-0 bridge bug affects "Add contact" too, and is filed as a separate task. For 4.9, such an agency's no-match policy still gets its queue-1 item, with no client and the reason, so it is never silently lost (test pinned).
- **The page** (demo owner) shows the four tiles, the three tabs, and the ownership table with the defaults (writing agent; writing agent at 5/10 days; operations).
## LA-4.10: how it is built

**The data (`supabase/migrations/20261008190000_la_4_10_existing_book_import.sql`):**
- **`file_registry.is_initial_import`:** set by the import screen's upload. The file is otherwise ordinary: raw rows, parse, status gate, snapshots, current rows.
- **`carrier_portal_guidance`:** per carrier, where in the portal, what the report is called, which format, notes. It's platform content, edited by staff at Catalog › **Portal guidance** without a deploy. **It ships empty;** no portal instructions are invented. Until a carrier has some, the import shows a generic line ("Download the carrier's latest policy (in-force) report from its agent portal").
- **`book_import_carrier`:** per agency and carrier, imported or skipped. Skipping is reversible.
- **A fourth queue type, `initial_import`:** one summary item per imported file, owned by the agency's owner by default. `queue_owner` is re-created for this, otherwise unchanged from 4.9.

**What makes an import an import:**
1. The upload is the LA-4.1 upload door (`uploadCarrierFile`), then the file is marked `is_initial_import` before its processing starts, then it is parsed straight away.
2. **No phantom changes:** a policy's first snapshot already makes one first-seen event and no change row (LA-4.6). A test runs 400 policies through `historyOf`: 400 first-seen events, 0 changes.
3. **Bulk matching (`importedBook` in `policyMatchingStore.ts`):** policies linked by number still link (step 2). Every other policy gets its client (an exact-identity existing one, or a provisional one) through `noRecordPolicy(..., { bulk: true })`, with **no queue-1 or queue-3 item per client**. The file gets **one** summary item: "400 policies imported, 400 provisional clients created — review when you have time". The summary's numbers are counted from the file's live snapshots and their current links, so a file arriving in chunks, or reprocessed, gives the same summary, never a doubled one.

**On screen:** Book of Business › **Import your book** (owner, bookkeeper; a money route).
- **Tiles:** carriers done, policies, premium a month and at risk, **Persistency: "Building — needs 3 months of files"**, and **Advances at risk: "Unknown — until commission statements arrive"**. Never $0.00.
- **One row per carrier:**
  - Which carriers: the ones the agency writes (LA-0.4), plus any it adds.
  - Each row has the portal guidance, the file date, Upload (or drop the file on the row), "Skip for now" / "Undo skip", and the **result as soon as the file is read**: "112 policies, $8,420/mo. 3 at risk." The page looks again every 3 seconds while a file is being read.
  - Rows held by an unmapped status word say so.
- **"Look over imported clients"** goes to Exceptions, where the summary items are.
- The same screen is the "import later" path: a skipped carrier imported later goes through the same code, with the same outcome.

**Helpers:** `persistencyStatus` (building until 3 months of files) and `moneyOrUnknown` (null → "Unknown"; a real 0 is still $0.00), for 4.11 and 4.18 to use.

**Acceptance (Notion):**

| Criterion | Status |
|---|---|
| A dropped file gives policies, snapshots and current rows through the normal pipeline, with `is_initial_import` | **Met:** the same door and processing; live check after the migration. |
| First snapshots produce zero `policy_change` rows | **Met:** a 400-policy test. |
| 400 policies → one summary item, not 400 | **Met:** bulk mode plus one item per file. |
| Each carrier's result is shown inline before the next upload | **Met:** parsed straight after the upload; the row updates itself. |
| A skipped carrier imported later has the same outcome | **Met:** same screen, same path. |
| Persistency shows "building" until enough snapshots exist | **Met:** helper plus tile; the 4.18 persistency screens will use it. |
| `unearned_advance_cents` reads as unknown, never zero | **Met:** helper plus tile; 4.11 will use it on policies. |
| Portal guidance exists for every seeded carrier, editable without a deploy | **Partly:** the editor exists and saves live; **the content has to be written** by someone who knows each portal (it would otherwise be guessed). |
| A 400-policy, 6-carrier import completes in under 10 minutes | **Not measured yet:** needs the real carrier files. Bulk matching does a few round trips per policy (about 400 contact creations per 400-policy file). |

**Before the migration (2026-10-07):**
- 12 checks on rolled-back temp copies pass. The file parses and its DO block compiles. 2,145 tests pass.
- The import page and the staff guidance page show only "Importing a book needs a database update (20261008190000)". Skip and upload answer 503, and nothing is stored (the upload checks first).
**4.10 verified live, 2026-10-07** (the owner applied the migration):
- **The catalog:**
  - The verifier reports applied, and `file_registry.is_initial_import` is NOT NULL, default false.
  - Both queue constraints accept `initial_import`. The live `queue_owner` gives it to the owner and keeps 4.9's writing-agent rule. On the demo agency the summary resolves to `admin`.
  - The two new tables: `tenant_app` reads and can't write, `anon` and `authenticated` see nothing, the server writes but never truncates, and RLS is on with one read policy each. Both checks exist. No rows ship.
- **Through the app (demo agency and staff):**
  - **The import screen:** it lists the 8 carriers the agency writes, each "Not imported yet" with the generic guidance line. The tiles read 0 of 8, 0 policies, $0 a month, **Persistency Building (0 of 3 months)** and **Advances at risk Unknown**.
  - **Skip and undo:** skip → "skipped"; undo → "pending" again.
  - **Refused uploads:** a PDF is refused (a policy file must be CSV or Excel).
  - **Guidance:** a staff save is **seen by the agency on its next load**, and clearing removes it.
  - All six changes are audited, and none left a row behind.
- **The summary item on the live tables** (rolled back): opening it twice for one file gives one item, updated in place, owned by the agency's owner. "Looked over" closes it with who. An import status other than imported/skipped is refused, and so is empty guidance (both 23514).
- **Not run live:** a real carrier file through the import. It leaves permanent rows, and needs the raw carrier files. The pipeline it uses is the one verified in 4.1–4.9.
## LA-4.11 · Policy list and policy detail page

**Where:** Book of Business › Policies. One menu item, two views: **From carrier files** (new, the default; `policy_current`) and **Entered by hand** (the LA-0.7 list, unchanged, because the dashboard, ledger, lapse radar and search still read `tenant_policies`). Detail: `/app/policies/carrier/<carrierId>/<policyNumber>`.

**List** (`components/app/policy-book.tsx`, logic in `lib/ingestion/policyBook.ts`):
- Filters for carrier, status and risk in the toolbar. "More filters" holds product, agent (including "no agent mapped"), lead source (including "none"), agency (shown only when there is more than one) and an issue-date range.
- Every column sorts. A missing value sorts last in both directions. Within a risk band, the policy closest to closing comes first.
- The totals (policies, annual and monthly premium, at risk) are computed from exactly the filtered set. A policy without a premium is counted and named in a footnote, never added as $0.
- The filter lives in the address (`?carrier=…&risk=…&sort=…`), so a filtered list can be bookmarked or sent. A saved filter stores that same query string.
- **Export CSV** exports the filtered rows in the on-screen order. Cells that begin with `= + - @` are prefixed with `'`, because carrier files are outside input.
- The status column shows ours, with the carrier's own word on hover. Risk shows only for policies in force (active, at risk, approved unpaid); a lapsed policy shows "—", never "Low".
- A producer sees the policies credited to them (`agent_user_id`). An owner and a bookkeeper see the whole book.

**Detail** (`app/app/(shell)/policies/carrier/[carrierId]/[policyNumber]/page.tsx`, reads in `lib/ingestion/policyBookStore.ts`):
- **Header strip:** premium and mode, face amount, status (with the carrier's word), risk with the days until the carrier closes it, and the paid-to date with the date of the file it came from.
- **Policy facts:** issued, effective, payment method, draft day (from the LA-3 application), months paid, and the agent (or the unmapped code).
- **Timeline**, oldest first:
  - from LA-3: the application started, submitted or resubmitted, and its outcome;
  - from the carrier: issued, effective, first seen in a file;
  - every `policy_change`, with a forward paid-to move read as "Payment credited".
  - Commission entries join it with 4.12.
- **Source** (collapsed): each current value, when it last changed and from which file, plus the raw row exactly as the carrier sent it.
- **Money:** advanced, earned, charged back and exposure read "Unknown" until 4.12. The lead source comes from the LA-3 case, or from the agency's override, with the campaign's average cost per lead.
- **Other policies and household:** the client's other policies, linked. The household total is a monthly figure across policies in force or at risk, shown when the household holds more than one person.
- **Your notes:** notes and a lead-source override. Carrier fields are not editable anywhere. The contact link stays with Policy matching (4.8), and the page links there when no client is linked.

**Migration `20261008210000`:** `policy_saved_filter` (per user) and `policy_annotation` (keyed like `policy_current`, so it survives every refresh). RLS read-only for `tenant_app`, writes through the service, and truncate revoked. Rehearsed in a rolled-back transaction on 2026-10-07.

| Acceptance criterion | State |
|---|---|
| Header totals respond to the filter and match a hand count | **Met.** Demo agency: 8 policies, $377/mo, 2 at risk. Filtered to at-risk: $29.50 + $61.00 a month = $1,086 a year, as shown. |
| CSV matches the filtered, sorted set | **Met.** Unit test; the export is built from the same array as the table. |
| Normalized status with the raw word on hover | **Met.** |
| Every money figure links to its ledger entries | **Waiting on 4.12.** Figures read "Unknown" until the ledger exists. |
| Timeline merges changes, commission entries and LA-3 events in order | **Met for changes and LA-3 events.** Commission entries arrive with 4.12. |
| Source block names the file and row for every value | **Met.** For example: DEMO-1003, row 4 of the corrected Oct 5 file; the status last changed in the original Oct 5 file. |
| A contact with three policies shows the other two | **Built.** It reads `policy_current.contact_id`; no demo contact holds two policies. |
| A household with two insureds shows the combined monthly premium | **Built.** `household_id` is shown when the household holds more than one person; no demo household has two. |
| No carrier field is editable; our own fields are | **Met.** Only notes and lead source are written; a test checks the store never writes `policy_*`. |
| 5,000 policies with filters in under 1 s | **Client side met:** filter, sort, totals and CSV for 5,000 rows take about 200 ms (unit test). Server load at 5,000 has not been measured: there is no tenant that size, and making one would mean writing rows. |
**Live verification (2026-10-07, after the apply):**
- **The verifier** reports `20261008210000` as applied.
- **Grants, checked in the catalog on both tables:** RLS is on, there is one read policy scoped to `app.tenant_id`, `tenant_app` can select but not insert, `anon` can't read, and nobody can truncate.
- **A rolled-back block** confirmed:
  - an upsert keeps exactly one row per policy;
  - a duplicate filter name, a blank name, a note over 4,000 characters and an unknown vendor are each refused.
- **The app path, as producer Devin Okafor on the demo agency:**
  - A note was saved on DEMO-1005, survived a reload, and was then cleared with the Save button. The row is left with notes null, `updated_by` Devin, and two `policy.annotated` audit entries.
  - Writing to DEMO-1003 (not his) returns 404.
  - A foreign vendor, a blank filter name and someone else's filter are each refused.
  - A filter on `risk=at_risk` was saved as "QA at risk", recognised as the current filter, re-applied after clearing (the address and the risk dropdown both updated, showing his one at-risk policy), then removed. No saved filter is left.
## LA-4.12 · Commission ledger

**Table `commission_entry`** (migration `20261008220000`): one permanent row per line of a commission file.
- **Eight entry types**, amounts as **signed integer cents**: advance, earned, override and held are ≥ 0; chargeback, fee and advance interest are ≤ 0; a reversal can be either.
- **Traceable:** every row carries `file_id` and `raw_row_id`, with a foreign key to the exact raw row, plus the row number.
- **What each line is:** the carrier's action codes become entry types through the layout map's enum values (`entry_type` is now a required column for commission layouts). A new layout field, `payee_level`, records whether the line pays the writing agent or the upline.

**Never updated, never deleted.**
- `service_role` and `tenant_app` have their insert, update, delete and truncate rights revoked, and a trigger refuses UPDATE and DELETE for everyone. The migration fails if any of those grants survive.
- The only writer is `record_commission_entries(tenant, file, rows)`, which runs as a security-definer function under a per-file advisory lock.
- **Reading a file again:**
  - a line with the same row and fingerprint is kept;
  - a line that changed or vanished gets a reversal ("the file was read again and this line changed");
  - new lines are added;
  - a corrected reissue reverses every live line of the file it replaces;
  - a replaced file read again adds nothing.
- A reversal records `corrects_type`, so totals per type survive a reprocess. The rehearsal checked this: an advance changed from $552.95 to $600 shows as $600 advanced, not $1,152.95.

**Sign rules** (`lib/ingestion/commissionLedger.ts` → `normalizeLine`):
- Chargeback, fee and interest lines are made negative, whatever sign the carrier used.
- A negative advance, earned, override or held line is recorded as a reversal of that type.
- A line with no entry type, no amount or a fraction of a cent is refused with its reason, never rounded.

**Rollup:**
- The view `commission_policy_totals` (security invoker) and the TS function `rollup` compute the same arithmetic: advanced, earned, charged back, override, fees, interest, other reversals, held, and net received (everything except held).
- **Unearned advance** (`unearnedAdvance`):
  - The months advanced come from the LA-0.4 advance rule; failing that, from the statement line's own months advanced.
  - Prorated by months paid (from 4.7), or in full until the clawback months pass.
  - **At risk** = unearned, less what has already been charged back.
  - With no months or no months paid, the answer is null (Unknown), never 0.
  - Every input is returned as a trace and shown on the policy page.

**Stage:** `stages.ts` runs `commission_entry` after `policy_snapshot`. The underived-file sweep now retries commission files as well as policy files.

**Screens:**
- **Commission ledger › From carrier files** (the default tab; the earlier statement ledger is unchanged under "Statements you import"):
  - totals for advanced, earned, charged back, net received and held;
  - every line, with its type, amount, payee, file and row;
  - filters, and a CSV export (cents formatted by integer arithmetic).
  - A producer sees the lines credited to them.
- **Policy page › Money:** each figure opens the lines behind it. "Still at risk" shows its trace. Every ledger line appears in the timeline.

**Known gap: the advance rule's product key.** `advance_rules` is keyed by product family (`final_expense` and so on), while policies carry the carrier's own product code. So the rule rarely matches today, and the statement's months advanced is the usual source. This needs a mapping from carrier product to product family (the rate card, later).
**Live verification (2026-10-07, after the apply):**
- **The verifier** reports `20261008220000` as applied.
- **Catalog:**
  - `service_role` can select but not insert, update, delete or truncate; `tenant_app` can't update; `anon` can't read.
  - The writer is a security-definer function that only `service_role` can execute (not `anon`).
  - RLS is on, the guard trigger is present, and the view is `security_invoker=true`.
  - The stored function body has CRLF line endings from the editor paste. That's harmless; it only matters for in-place patches later.
- **A rolled-back block against the live function:**
  - Five lines inserted, then the same five again: all kept, nothing inserted.
  - The advance changed: one reversal and one insert. Advanced reads $600.00 and net $204.94, the hand-computed figure; held ($3.50) stays apart.
  - UPDATE and DELETE are refused by the trigger, and a wrong-signed chargeback by the check constraint.
  - The file called under another agency's id is refused (P0002).
  - A corrected file reverses all 5 live lines and inserts 1 (advanced back to $552.95), and the replaced file read again adds nothing.
- **Screens:** the ledger tab renders its empty state; the totals strip is hidden until there is a line, because no lines means unknown, not $0. The policy page's Money block reads Unknown with the reason. No console errors.
## LA-4.13 · Expected commission: rate card, trigger and lag

**The rate card is LA-0.4's `commission_schedules`**: carrier, product family, contract level, policy year and effective date. Migration `20261008230000` adds:
- **`commission_schedule_band`**: an age band (age_min..age_max, rate) on a schedule row. Bands on one row can't overlap (a trigger refuses it). This is a child table, not the spec's columns, so the existing unique key and both `save_commission_schedule` overloads keep working untouched.
- **`carrier_product_family`**: a carrier's own product code ("FE Level", "CCI") mapped to our product family (`products.code`), which rates are keyed by. Platform rows exist, and an agency's own row wins. Without it almost nothing could be priced, because carrier files carry carrier codes.
- **`expected_commission`**: one row per policy and policy year, written by `record_expected_commission` only.
  - Confidence is `exact`, `assumed_level` (no contract level set, but only one level has rates) or `no_rate_card` (no figure, with a reason; a check forbids a figure).
  - Each row records the schedule id, the schedule version (its effective date), the band, the rate, the commissionable premium, the expected amount, and the advance (months, %, cents) from the advance rule.
  - **Forward-only:** a row with a figure is never rewritten or deleted (a trigger refuses). A `no_rate_card` row is filled in once a rate exists.
- **Platform pay triggers**, seeded for the Module 4 list's carriers that are in the library: Americo and Mutual of Omaha on issue; Aetna and Transamerica on first draft.
  - Lags are seeded only where measured: Aetna 10 days and Americo 35, from the carrier knowledge doc. The rest are left empty, so nothing is called overdue on a guess.
  - AMAM, RNA, Corebridge, Aflac, AHL and SSL aren't in the library; they wait for the carrier-library decision.

**When the trigger occurs** (`lib/ingestion/expectedCommission.ts`, pure and tested):
- **On issue:** the issue date, or for carriers that send none, LA-4.7's `issued_on`.
- **On first draft:** the first file where `policy_change` shows the paid-to date moving past the effective date. A policy first seen already paid past its effective date had drafted by its first file.
- **Overdue from:** the trigger date plus the lag. With no lag set, nothing is called overdue.
- **Nothing is owed on an application:** submitted, declined and withdrawn policies get no row.

**Which rate applies:**
- The rate is the one in force on the trigger date (a later raise never reaches back), for the policy's product family, at the agency's contract level, for policy year 1.
- The age band is picked from the client's age at the effective date. With an unknown age, the base rate is used and the row says so.
- Money is computed by exact integer division (half up). Rates are typed as percentages and parsed from their digits (`percentToBp`).

**When it runs:**
- As the `expected_commission` stage after each policy file, for that carrier.
- After every rate-card change, for that carrier.
- Opening a page never writes.

**Screens:**
- **Book of Business › Rate card** (new menu item; owner and bookkeeper):
  - **Coverage:** carriers covered, the share of monthly premium covered, expected so far, and how many policies are past the usual lag.
  - **Per carrier:** policies, monthly premium, when it pays and the usual lag, your contract level, rates, and how many policies can be checked.
  - **Set up:** contract level (with writing number), product families for every product code in the book, rates with age bands, and a link to Carrier rules for the trigger and lag.
- **Policies list:** a one-line status, for example "N Americo policies, $X/mo, have no rate, so their commission can't be checked. Add rates".
- **Policy page:** the expected first-year commission and advance, the rate and premium it used, the trigger date and when it's due. Or "Unknown:" with the reason and a link to add the rate.
**Live verification (2026-10-08, after the apply):**
- **The verifier** reports `20261008230000` as applied.
- **Catalog:**
  - On `expected_commission`, `service_role` can select but not insert, update or delete; the function is executable by `service_role` only (not `anon`); `anon` can't read.
  - Product families and age bands are writable by the service.
  - Both guard triggers are present, along with 3 read policies.
  - Platform triggers are seeded: Americo on issue / 35 days, Mutual of Omaha on issue / no lag, Aetna on first draft / 10 days, Transamerica on first draft / no lag.
- **A rolled-back block against the live function:**
  - no_rate_card is inserted once, and repeating it changes nothing;
  - entering the rate fills it in ($1,061.40 at 145% of $732);
  - a later raise does not rewrite it (the version stays 2026-01-01);
  - another agency can't write a row for a policy it doesn't hold;
  - UPDATE, DELETE, a $0 for unknown, and an overlapping age band are each refused.
- **The Rate card page:**
  - 0 of 1 carriers covered, 0% of $377/mo.
  - "Expected so far" reads "—" until something is priced; it showed "$0" before, and that is fixed.
  - The setup dialog explains the demo's gap: "the carrier's file gives no product (8)".
  - No console errors. Nothing was saved: rates and contract levels are the agency's own data.
## LA-4.14 · Orphan queue and carrier account balances

**Orphans: nothing is written to claim them.** LA-4.12's entries are keyed by carrier and policy number and are never updated, so a line is an orphan exactly while no `policy_current` row has its carrier and number. It stops being one the moment the policy arrives, and every rollup is computed, so it follows by itself. The spec's `policy_id = null`, set later, would have meant updating a permanent ledger row; this gets the same outcome without that.
- **`commission_orphan_summary` (view):** per carrier, the orphan policies, lines, amount (held apart), the oldest date, and how many are past the threshold.
- **`sweep_orphan_commissions(tenant?, as_of?)`:**
  - opens one `orphan_commission` queue item (LA-4.9) per policy number still orphaned past `queue_assignment_rule.open_after_days`, default 60 days;
  - counts only new items (a second run refreshes, it doesn't recount);
  - closes items whose policy has arrived ("auto_linked").
- **When it runs:** daily by pg_cron at 06:45 (`la4-orphan-commissions-daily`), and as the `orphan_commission` stage after every policy or commission file.
- **In Exceptions:** owned by operations (a bookkeeper), falling back to the owner. Resolutions:
  - "Written under another writing number" (optional note);
  - "Raised with the carrier" (note required);
  - "Not mine".
- **On the ledger:** a line whose policy hasn't arrived reads "Policy not seen yet".

**Carrier accounts:**
- **`carrier_account_statement`:** one per agency, carrier and statement date. It holds the opening balance, activity, closing balance, a computed `debit_balance_cents` (the closing balance if negative), the amount paid, held, and the minimum payout, plus the commission file it heads (one statement per file).
- **The header is typed in from the statement.** Files carry it above the lines, where the layout map doesn't read.
- **`carrier_account_checks` (view):**
  - opening + activity = closing;
  - the file's lines sum to the stated activity (held excluded, since held is reported apart);
  - this opening = the previous closing (otherwise a statement is missing).
- **Flagged statements hold their lines:** `commission_policy_totals` and the app's rollups leave out the lines of a flagged statement until it's corrected. Each held line says so.

**Screen: Commission ledger › Carrier accounts** (new tab):
- **Totals:** debit balances (and to how many carriers), statements that don't add up, missing statements, and unattributed commission.
- **Per carrier, oldest first:** each statement's opening, activity, closing, change since the previous statement, paid/held, and checks with the reason in the statement's own numbers. "Debit growing" is flagged when the balance fell on the latest statement and is negative, with how many statements it has fallen for.
- **Commission for policies not seen yet,** per carrier.
- **"Add statement totals":** pick the carrier, optionally the commission file (its date becomes the statement date), then opening, activity, closing, paid, held and minimum payout. Amounts are parsed from their digits.
**Live verification (2026-10-08, after the apply):**
- **The verifier** reports `20261008240000` as applied.
- **Catalog:**
  - Statements can be inserted by `service_role` but not truncated; `anon` can't read them or the orphan summary.
  - The sweep is executable by `service_role` only.
  - The checks view and the totals view are `security_invoker`, and the totals view now refers to the checks (it holds flagged statements' lines).
  - The `la4-orphan-commissions-daily` cron is active at 06:45.
  - The live sweep is the version that counts only new items.
- **A rolled-back block on the live objects:**
  - **Orphan summary:** 2 policies, $319.00, oldest 2026-07-31, 1 past 60 days.
  - **The sweep:** the first run opened 1 item, assigned to the agency's bookkeeper (operations); the second run opened 0. The 1-week-old orphan got none.
  - **An item for an arrived policy** closed itself as `resolved/auto_linked`.
  - **A July statement** that doesn't add up flagged, and DEMO-1005's net went from $552.95 to nothing (held out).
  - **The August and October statements** each show the break before them, and August's −$228.05 is the debit.
- **The app:**
  - The Carrier accounts tab renders its empty state.
  - The API refused a fractional amount, a policy file offered as a statement ("Choose one of this agency's commission files."), a negative held amount and a bad carrier, each with a plain message (the negative-amount message was a raw zod string and is now worded).
  - Nothing was written.
## LA-4.15 · Discrepancy engine and dispute letters

**The engine** (`lib/ingestion/discrepancyEngine.ts`, a pure function with one positive and one negative test per type):
- **Missing** (no rate card needed): the pay trigger fired and the usual lag has passed (from 4.13's `expected_commission`), and there is no advance, earned or held line. With no rate, it still reports missing, with no invented amount and the reason.
- **Short-paid and over-paid** (need a rate):
  - the advance received against the expected advance;
  - or, with no advance and 12 or more months paid, earned against the year's expected commission;
  - only beyond the carrier's tolerance (LA-4.17 `tolerance_cents`, default $1.00), which is shown on the row.
- **Mis-rated** (needs a rate): a line paid at a rate other than the rate card's, or on a commissionable premium that differs beyond the tolerance. The wording names the honest explanations (contract level, age band, policy fee).
- **Duplicate chargeback:** two standing chargebacks of the same size within 90 days. A chargeback that a reprocess reversed and re-recorded counts once.
- **Unexpected chargeback:** a chargeback on a policy the latest file shows active. It lists all three causes (stale policy file, carrier error, wrong match) and asserts none.
- **Missing chargeback:** lapsed or not taken inside the clawback window, with an advance standing and no chargeback yet. It is a warning, not a claim: the amount still unearned, and "don't count on that money".
- **Held building up:** held money rising across the last two statements and below the minimum payout. Worded as "withheld, not missing… Nothing to chase."
- **Debit balance growing:** a negative balance that worsened on the latest statement (4.14).
- **Ledger lines from a statement that doesn't add up** stay held out (4.14).

**Stable rows:** `commission_discrepancy` holds one row per (agency, carrier, type, policy or `*` for the account, policy year).
- Rows are written only by `record_discrepancy_run` and `set_discrepancy_status`; the app can't insert, update or delete directly.
- Each run updates the figures and evidence on the same row.
- A problem not found again resolves itself, with a note such as "Resolved itself: the commission arrived."
- A dismissed row stays dismissed; a resolved row whose problem returns opens again.
- **Every row carries its evidence:** the expected figure with its rate row and version, the reported figure with the ledger entry ids (and so their file and row), the difference, the tolerance, and an explanation.

**Letters:** `commission_dispute`.
- The letter is a filled template (`lib/ingestion/disputeLetter.ts`), never AI prose: policy, problem, expected, paid and difference for each line, with the basis (rate, premium, schedule date, tolerance) under it, and the total.
- It covers only the disputable types for one carrier. Held money, debit balances, overpayments and chargebacks still to come are never argued.
- The body is frozen when drafted, and once sent the database refuses any change to it or its items. Insurvas never sends it: the agent downloads the PDF (Courier, so the figures line up), sends it, and records how (email, portal or post), any acknowledgement, and the outcome (accepted, rejected, or partial with the amount credited).
- Credited → its items are settled; rejected → they open again.
- **The dispute record per carrier:** settled letters won out of all settled, and amount credited out of amount claimed.

**When it runs:** as the `commission_discrepancy` stage after every carrier file (last), and from "Check now". Opening the page writes nothing.

**Screen: Discrepancies.**
- **From carrier files** (new, default):
  - **Totals:** you appear to be owed, coming back, held by carriers, open.
  - **Filters:** status, type and carrier.
  - **Each row:** expected, paid, difference with its tolerance, and status. "Why" opens the explanation, the causes, the dates and Dismiss (with a reason) or Open again.
  - **Letters:** tick open items of one carrier, then "Draft letter" for a preview, with the commissions address pre-filled from 4.4's saved contact; "Save letter" keeps it.
- **Letters:** each letter, read or download it as a PDF, mark it sent, acknowledged, or record the outcome.
- **From imported statements:** the earlier module, unchanged.
**Live verification (2026-10-08, after the apply):**
- **The verifier** reports `20261008250000` as applied.
- **Catalog:**
  - On `commission_discrepancy`, `service_role` can select but not insert, update or delete.
  - `commission_dispute` is updatable by the service, not truncatable, and not readable by `anon`.
  - The three functions are executable by `service_role` only (not `anon`).
  - The guard trigger, 2 read policies and the discrepancy → dispute foreign key are present.
  - The live writer counts reopened rows from their earlier status.
- **A rolled-back block against the live functions:**
  - Run 1 opened 2; run 2, with a moved figure, updated 2 (still 2 rows).
  - With both gone: missing resolved itself, and the dismissed debit item stayed dismissed.
  - With both back: missing reopened ("Found again after it had resolved."), and the dismissed one stayed dismissed.
  - A sent letter refused both an edit and a delete.
  - After a partial credit, a problem still in the files opens again.
- **The app, on the demo agency:**
  - "Check now" returned 200 with 0 findings and wrote nothing (no commission lines yet).
  - Refused: a letter from another agency's items (400), marking someone else's letter sent (404), dismissing someone else's item (409), and a fractional amount (400).
  - The Letters tab shows its empty state.
  - The totals strip is hidden until there's a finding, because nothing found yet is not "$0 owed"; that is fixed.

## LA-4.16 · Retention board

**Who is on it** (`lib/ingestion/retentionBoard.ts`, pure, with a positive and a negative test for each reason). One reason per policy, most urgent first:
- **Asked to cancel:** the carrier's raw status says a cancellation, termination or surrender was requested (not on a policy already gone).
- **Carrier conservation notice:** the carrier itself reports the policy at risk.
- **Draft bounced:** the paid-to date moved backwards in the latest file, or the carrier's status names a returned or NSF item.
- **First payment missed:** never paid, and later than the carrier's grace (LA-4.17).
- **Payment missed:** paid before, now past due beyond the grace.
- **Lapsed, can still be reinstated:** inside the carrier's reinstatement window. With no window configured, only a lapse in the latest file is listed, and nothing is guessed.
- **Mailed bill: convert to bank draft:** active and paid by direct bill (prevention).

**Order:** days left before the carrier closes it, soonest first, then the most advance at risk. Rows with no carrier window sit below in a labelled group linking to Carrier rules; prevention comes last. Days left: 3 or fewer are red, 7 or fewer amber. No value (window, grace, lag) is hard-coded; all come from the carrier's rules (the 4.17 test enforces it).

**Each row:** the client, the phone as a tap-to-call link, the carrier and policy (linking to the policy page from 4.11), the reason, the amount due, the days left, the unearned advance from the ledger (4.12; "Unknown" when there is none, never $0), and the last contact with its result.

**Logging a call:** one select per row: reached and promised to pay, refused, voicemail, wrong number, already paid, converting to bank draft.
- `retention_action` stores the call with the board as the server saw it (reason, paid-to, the file's date). A logged call never changes; the database refuses edits and deletes.
- **The next carrier file decides it** (`evaluate_retention_actions`, the `retentionResults` stage after every file, and a daily 07:00 run):
  - **lost** if the policy is lapsed or not taken;
  - **saved** if the paid-to date moved past where it stood;
  - otherwise **still at risk**, judged again on the following file.
- **Save rate** = saved ÷ (saved + lost), by reason, carrier and agent. Calls still at risk are shown as waiting.

**Screen: Lapse risk.**
- **Call list** (new, default): the stat strip (call today, advance at risk, save rate, carriers without a window), filters by reason and carrier, the list, and the save-rate card once calls exist.
- **Recorded signals:** the earlier board, unchanged.
- A producer sees only their own policies. Opening the page writes nothing.

**Before the apply (2026-10-08):**
- **A rolled-back rehearsal on production** created the table, guard and function, then logged four calls on the demo agency's test carrier:
  - DEMO-1001 (paid-to moved from 10-01 to 11-01) → saved;
  - DEMO-1003 (lapsed) → lost;
  - DEMO-1005 (paid-to unchanged) → still at risk;
  - DEMO-1007 (logged against the latest file) → waiting.
  - A second run moved nothing.
  - An edit and a delete were both refused.
- **`loadBoard` on the demo agency:** 3 rows in about 1 s:
  - DEMO-1005 and DEMO-1006, payment missed, 24 days left;
  - DEMO-1003, lapsed, in the no-window group.
  - Phones and clients are linked. The advance is "Unknown" (no commission layout yet).
  - Save rates report unavailable until the table exists.
- **The page itself is behind the platform switch** `chargeback_radar = off` (the demo seed's "being recalibrated" message), so it can't be opened in the browser until that switch is turned on.
- 2194 tests pass; `tsc` clean.

**Live verification (2026-10-08, after the apply):**
- **The first apply did not reach production** (nothing landed; the same file ran clean in a rolled-back block), so it was applied again.
- **The verifier** reports `20261008260000` as applied. The cron job `la4-retention-results-daily` (`0 7 * * *`) is active.
- **Catalog:**
  - On `retention_action`, `service_role` can select and insert, but not update, delete or truncate.
  - `tenant_app` can only select; `anon` and `authenticated` have no access.
  - RLS is on with 1 read policy; the guard trigger and 5 indexes are present.
  - `evaluate_retention_actions` is a security definer function, executable by `service_role` only.
- **A rolled-back block against the live functions:** saved, lost, still at risk and waiting came out exactly as in the rehearsal. A second run moved nothing. An edit, a delete and an unknown reason were all refused.
- **The app's read path:** `loadBoard` returns the same 3 rows. Save rates now report available with 0 calls.
- **Not exercised:** no call was logged for real, because a logged call is permanent.

## LA-4.18 · Scorecards, persistency and the daily summary

**Where:** Insight › **Book scorecards** (`/app/book-scorecards`, `cohort_persistency`; owner, producer for their own book, bookkeeper). The earlier Persistency page (the hand-entered book) is unchanged. Everything is read from 4.7's `policy_current` and 4.12's ledger; nothing is snapshotted, and opening the page writes nothing.

**Persistency** (`lib/ingestion/scorecards.ts`, pure):
- **Buckets:** 3, 6, 9 and 13 months after issue, the carrier's issue date or else the effective date.
- **Two measures:** by policy count and by annualised premium. Premium shares leave out policies with no premium and say how many.
- **Survivorship rule:** only policies issued since the agency's first carrier file are judged. Older policies were only seen if they survived to that file.
  - A bucket the history can't fill yet reads **Building**, with the date it becomes possible.
  - It is never computed from the policies that happen to be old enough.
- **Small samples:** below the agency's sample size (`book_insight_settings.min_sample`, default 10, owner-editable) a share prints as a count, "3 of 5".
- **Never in force:** submitted, declined, withdrawn, approved-unpaid and not-taken policies are placement's subject, not persistency's.
- **Lapse date:** the file that showed the lapse; a lapse on the mark day is not alive.

**Overview:**
- **Annualised premium:** with the in-force count.
- **Month-9 persistency:** against the 65% carriers look for.
- **Placement:** the 4.18 placed rule (issued and paid at least once). Submitted counts come from LA-3 and issued from submitted. "Issued, never paid" is the gap.
- **Chargeback ratio:** chargebacks over advances, by carrier, product, agent and lead source.
- **Today:** the daily summary.
- **Book of business:** by carrier, product, status, agent and agency.
- **Net commission by week:** advances, earned and overrides, less chargebacks, fees and advance interest, over the last 13 weeks. Held money is shown apart. It is summed in the database by `commission_week_totals`, with flagged statements held out (4.14).

**Scorecards:** by lead source, carrier, product, agent and agency.
- **Every scorecard:** policies, in force, premium, placement, month-9 persistency, chargeback ratio and net commission. Net commission is "—" when no ledger line exists, never $0.
- **Lead source also:** spend (the LA-2 report, net of credits, for the period), sales, cost per sale, and the **true cost per sale**, spend ÷ (sales × month-9 persistency), from the counts.
  - The Apex/Vertex example is a test: $564 becomes $696, and $482 becomes $817.
  - Spend isn't shown on a producer's own scorecard.

**Drill-through and CSV:**
- Every figure is a link (`?drill=`) to the rows behind it. They are computed by the same function that made the figure, so the count always reconciles. A test checks each policy figure (book, persistency, placement, chargeback, sales); the week drill was checked in the rehearsal.
- Policy rows link to the 4.11 policy page. A week's net opens its ledger lines (`commission_week_entries`).
- Every table, and every drill list, exports exactly what is shown as CSV, with formula escaping.

**The daily summary** (`lib/ingestion/dailySummary.ts`):
- **Input:** a structured object built from the newest files (lapsed, newly issued, moved to at risk), chargebacks recorded since yesterday, policies with 3 days or fewer before the carrier closes them, and month-9 persistency under the line on a full sample.
- **Lines:** each is a template over that object's figures and links through. A quiet day says "Nothing notable today."
- **AI prose waits for the provider** (LA-4.19's insights agent). `checkProse` is the gate it will have to pass: any figure not in the input, or any predictive word, refuses the prose. Tests assert the templates pass and an invented figure or a forecast fails.

**Speed (no batch job):**
- **Loader:** about 0.4–0.9 s for the overview on the demo agency. About 1.2 s for the scorecards view, which alone reads the LA-2 spend report (about 1 s; the report once took 5 s).
- **Computation:** 20,000 synthetic policies across every view take about 220 ms, after replacing a quadratic grouping and caching month marks.
- **Not yet proven at real volume:** reads page 1,000 policies at a time, so a book of tens of thousands would need the rollup the spec allows.
- **Indexes:** two new ones on `policy_current` (vendor, campaign) for the lead-source chain.

**Before the apply (2026-10-08):**
- **A rolled-back rehearsal on production:**
  - The weeks summed advance, chargeback and fee correctly. A fee with no statement date fell back to its transaction date.
  - The week's drill returned its 2 lines.
  - The sample setting upserted, refused 1, and can't be deleted.
- **The page on the demo agency** (8 policies, first file 2026-09-05):
  - Premium is $4,519.80 (7 of 8 in force), and placed is "8 of 8" (a count, under the sample).
  - All four buckets are Building (month 9 from Jun 5, 2027).
  - The 10 LA-3 submissions show, 0 of them issued.
  - Chargebacks show "—" with no advance on file. The weekly table names the pending migration.
  - The sales drill opened exactly 8 policies.
- 2203 tests pass; `tsc` clean.

**Live verification (2026-10-08, after the apply):**
- **The verifier** reports `20261008270000` as applied.
- **Catalog:**
  - On `book_insight_settings`, `service_role` can select, insert and update, but not delete or truncate.
  - `tenant_app` only reads, through 1 read policy; `anon` has no access.
  - Both ledger functions are security definer and run as `service_role` only.
  - The three indexes are present. No settings row exists yet.
- **A rolled-back block against the live functions:**
  - The weeks summed advance $400.00, chargeback −$250.00 and fee −$5.00 into the right weeks.
  - The week of 10-05 drilled to its 2 lines; one agent's weeks held only that agent's 2 lines.
  - The setting saved twice into one row (15), and a sample of 1 was refused.
- **The app, on the demo agency:**
  - Net commission by week now shows "No commission lines in the last 13 weeks".
  - The owner's sample-size control is live.
  - The API refused a sample of 1, a fractional sample, an unknown field and an unknown action (400, nothing stored).
  - Through the loader, the owner sees 8 policies and 14 vendors' spend. The credited producer sees only their 4 (DEMO-1001, -1002, -1005, -1007) and no spend.
  - No setting was saved for real: a settings row can't be removed.

## LA-4.19 · The orchestrated run and the agent framework

**The run** (`lib/ingestion/dailyRun.ts`, pure, tested against a fake world; wiring in `dailyRunStore.ts`):
- **Stages, per file:** collect, ingest, parse, store, match, reconcile. Then **analyse** once per agency.
- **Where it runs:** files run side by side, 4 at a time, with stages in order within each file.
- **What starts it:**
  - the five-minute poll (`/api/internal/carrier-files/poll`, trigger `file_arrival`);
  - each door right after a file arrives (upload, book import, email; `runArrival` for that one file);
  - **Run now** on Carrier files › Runs (`manual`).
- **Before the migration:** the earlier sweeps run instead, so files keep flowing either way.
- **What each stage does:**
  - **Collect:** the bucket poll.
  - **Ingest:** registration, hashing and dedup, which the doors already do; the stage records it.
  - **Parse:** raw rows, then the layout map, then the status gate.
  - **Store:** snapshots and the change log.
  - **Match:** client links, then current rows. `rebuildFileSnapshots` was split into `storeFileSnapshots` and `linkFilePolicies`; a reprocess still runs them together.
  - **Reconcile:** expected commission, retention results, commission lines, orphans and discrepancies (4.12–4.16).
  - **Analyse:** ties the run's findings to it and counts what is open. Boards are computed when opened; the written summary waits for a provider.
- **Records:**
  - `pipeline_run`: trigger, status (succeeded, partial or failed), and files total, succeeded and failed.
  - `pipeline_stage_run`: one row per file per stage (unique), with status, timings, rows in and out, the error, a note, and the findings raised.
  - When a file finishes every stage, `file_registry.pipeline_completed_at` is set. Existing derived files are back-filled, so nothing old runs again.
- **Failures and resume:**
  - A failure stops that file at that stage. Every earlier stage's output stays, and the later stages are recorded as "Not run: …".
  - A **blocked** parse (no layout map; a missing required column or totals that don't balance) stops the file. Held rows with an unmapped status stop only those rows.
  - A stopped file is picked up by the next run **after its last completed stage**. Stages already done read "Done in an earlier run". When a later stage needs the typed rows, parse reads them again from the raw rows "to resume".
  - A failed file is retried hourly, not every five minutes. A run still "running" after 15 minutes is marked failed by the next run.
- **Time limit:** a run stops starting files after about 40 s (the poll's limit is 60 s); the rest wait for the next run.
- **No double processing:** every stage is idempotent, and the unique keys on snapshots and ledger lines make a second run harmless. A test runs every stage twice on the same files and finds no duplicates.

**The file monitor** (`file_monitor_sweep`, SQL, deterministic; pg_cron `la4-file-monitor-daily` at 07:15 UTC):
- **Missing file:** a carrier the agency (or the platform) expects **daily** (business days), **weekly** or **monthly** that sent nothing by its due day raises one `missing_file` warning the next morning. Its reasoning reads: "X files every business day; the last file arrived on …, and none came by …".
  - One finding per missed due day.
  - An **ad-hoc** or unset carrier never raises one.
- **Late file:** when the file then arrives, the finding resolves itself and leaves a `late_file` note ("5 days late").
- **Duplicates:** every duplicate the doors skipped is noted once.

**The agent framework** (`lib/ingestion/agents.ts`):
- **The six agents:** what each watches and raises, and whether it needs a model.
  - Deterministic today: the file monitor and the parser guardian.
  - Waiting for a provider: the PDF extractor, the matching agent's AI step, the reconciler's explanations, and the insights analyst's prose.
- **The contract:** `findingRow` requires the reasoning (under 4,000 characters) and a confidence between 0 and 1.
  - A model-backed finding must name its model and prompt version; a deterministic one names neither.
  - `agent_findings` is now indexed by (agent, model id, prompt version) and tied to its run.
- **Prompt safety:** `assertPromptSafe` refuses any payload with an SSN (dashed anywhere, or 9 bare digits outside a policy number, phone or date), a bank account (by key), a routing number (ABA checksum), or a card number (Luhn). It checks keys and values, nested.
  - The matching exception (name, date of birth, phone) passes.
  - Every batch is checked before it leaves.
- **Batching and pacing:** `runBatched` sends batches at most N calls a minute. A test sends 55 rows in 3 calls, 10 s apart at 6 a minute.
- **Blocking stops the stage:** `stopsStage` holds the rule that a blocking finding stops its stage and a warning doesn't.
- **The agent role:** `insurvas_agent` (no login) reads what the agents watch and may only insert findings. UPDATE and DELETE on `raw_rows` and `commission_entry` fail for it; the migration proves this by taking the role.
- **Accuracy:** on Carrier files › Agent findings a person marks each open finding **Right** or **Wrong** (owner, bookkeeper). Approving executes nothing.
  - Accuracy is computed per agent per week from those marks (`weeklyAccuracy`, and the view `agent_accuracy_weekly`). Self-resolved and unmarked findings don't count.

**Screens:** Carrier files gets two tabs:
- **Runs:** each run, then each file with a chip per stage. Hovering shows rows, time, the note or error; a stopped stage says why. "Run now" is here.
- **Agent findings:** filters by agent and status; the agent, what it saw, severity and file; Right or Wrong; and accuracy by week.

**Not done, and why:**
- **The model-backed agents:** no AI provider has been chosen yet (owner decision 2026-10-07).
- **Autonomy that shrinks as accuracy drops:** every action needs approval today, so there is no autonomy to reduce yet. The accuracy is measured and shown.
- **"A 1,000-policy book across 8 carriers, stages 1–4 within the hour":** not measured; there is no such book yet. Each stage's timing is now recorded, so it can be.
- **No app code runs as `insurvas_agent` yet:** nothing model-backed exists to run.
- **The poll in production** still needs its Vault secrets (as in 4.1).

**Before the apply (2026-10-08):**
- **Rolled-back rehearsals on production:**
  - The agent role was refused an update and a delete on raw rows, an update on the ledger, and an edit of a finding. It could read raw rows.
  - The back-fill left no fully derived file pending.
  - Monitor, daily carrier on the demo agency (last file Wed Oct 7): nothing on Thursday; one missing-file finding on Friday morning; no second one on Monday for the same missed day. An earlier missing finding resolved itself when a file arrived and left "5 days late". After switching to ad hoc, nothing.
- **The pages:** Runs shows "Run history isn't available yet (20261008280000)". Agent findings shows the demo's "No findings yet", and through the store the fixture's 15 parser-guardian findings with their files.
- 2213 tests pass; `tsc` clean.
- **Three source-pinning tests updated** to the new door, poll and snapshot calls, with the same intent.
- **What the apply will write:** the migration's check runs the monitor once, which adds 4 duplicate-file notes (already resolved) for "LA-1.25 Alert Demo", and the back-fill stamps 13 completed files.

**Live verification (2026-10-08, after the apply):**
- **The verifier** reports `20261008280000` as applied. The cron job `la4-file-monitor-daily` (`15 7 * * *`) is active.
- **Catalog:**
  - The run tables: `service_role` can insert and update but not delete or truncate; `tenant_app` only reads; `anon` has no access.
  - `file_monitor_sweep` runs as `service_role` only. The `insurvas_agent` role exists without a login.
  - **Indexes:** the findings → run foreign key, and the model, run and open indexes.
  - **The accuracy view:** `agent_accuracy_weekly` is present.
- **What the apply wrote:** 13 files stamped complete, one parsed fixture commission file left pending, and 4 duplicate-file notes (resolved) for "LA-1.25 Alert Demo". No run exists yet.
- **A rolled-back block against the live objects:**
  - Taking `insurvas_agent` for real: updating or deleting raw rows, updating the ledger, and editing a finding were refused. Inserting a finding was allowed.
  - **The run records refused:** the same stage twice for one file, analyse with a file, a file stage without a file, and "failed" without a reason. `service_role` couldn't delete a run.
  - The monitor gave nothing on Oct 8, one missing file on Oct 9, and nothing new on Oct 12.
  - A finding marked right showed in `agent_accuracy_weekly` as file_monitor 1/1 for that week.
- **The app, on the demo agency:**
  - Runs shows "No run yet" with **Run now**.
  - The API refused a review of a finding that isn't open on the agency (409), a bad id or verdict (400), and an unknown action (400).
- **Not exercised:** a real run (Run now, the poll, or a door).
  - Run records are permanent, so none was started.
  - On the demo agency nothing is waiting, so a run would have 0 files and only Analyse.
  - On the fixture, the first run would read its pending commission file into the ledger.
  - The production poll calls the deployed app, which doesn't have this code yet.

## LA-4.20 · Traceability: every figure back to its source row

**The chain, in the product:**
1. **A figure:** each screen's drill-through (4.11–4.18) opens the policies or ledger lines behind it.
2. **The policy:** the policy page's **Source** block gives every current field the snapshot, file and row it is read from, and the file and row that last changed it, both as links. Computed fields (months paid, days past due, days until the carrier closes it, annualised premium) say what they are computed from.
3. **A commission line:** on the ledger, the policy page's money lines, a discrepancy's "Why" and the scorecards' weekly drill, each line opens its raw row.
4. **The raw row** (`/app/carrier-files/file/[fileId]/row/[n]`, new):
   - every original column in the file's order: letter, header, value as sent;
   - the field the layout map turned it into, with type, transform and whether it is required;
   - the value that was stored;
   - the map's name and version, and any field the map expects that this file lacks;
   - what the row became: the policy snapshot ("the policy's current values come from this row", or an earlier or replaced file), or the commission lines.
   It answers "did we parse this right?" without a database client.
5. **The file** (`/app/carrier-files/file/[fileId]`, new): carrier, date, type, how it arrived, format and size, status, the layout map and version, row counts, the SHA-256 hash, and every row (paged by 100) with what it became.
6. **The original:** "Download the original" gives a sixty-second signed link, owner and bookkeeper only. Every download is audited (`tenant.carrier_file_downloaded`). File names on Carrier files open the file page.

**The trace check** (`trace_problems`, SQL; one definition, used twice):
- **What it checks:**
  - **Policies:** the current row → its snapshot → the raw row → the file.
  - **Ledger:** each commission line → its raw row → the file.
  - **Rate card:** each expected figure → its rate-card row (and age band).
  - **Discrepancies, both sides:**
    - every reported line is in the ledger, and kinds that need lines have some;
    - the rate-card row it was priced from still exists;
    - its policy is in the book;
    - for account items, the carrier statement is on file.
- **Use 1, Discrepancies:** an item it lists is **not shown to the agent** and can't go on a letter. It is logged (server log) as a defect for us, and stays in the health check.
- **Use 2, the health check:** `run_trace_health_check()` records figures checked, figures untraceable, counts per screen and the first fifty problems in `trace_health_check` (internal, append-only). It runs daily at 07:45 UTC.

**The build:** `TRACE_SCREENS` registers every LA-4 screen with the tables its figures come from. `trace.test.mjs` fails:
- when a page under `app/app/(shell)` reads one of the carrier-data stores without being registered;
- when a registered source isn't covered by a check in `trace_problems`.
Together these mean a new screen can't ship an untraced figure without someone saying where it comes from.

**Not done:** the cropped page region for a PDF commission line. No PDF is extracted yet: 4.4 needs an AI provider. When it is built, the extraction must store the page and region with each line, and the raw-row page shows it.

**Before the apply (2026-10-08):**
- **A rolled-back rehearsal of `trace_problems` on production:** 17 policies, 0 ledger lines, 0 priced figures and 0 open discrepancies exist today. **0 untraceable**, in 188 ms.
- **The pages on the demo agency:**
  - File page: the corrected Oct 5 LA14 file, map v1, 8 rows each "Policy DEMO-…", with its hash.
  - Raw row 5: 15 columns. "Premium 44.25 → premium_cents 4425" and "Face 9000.00 → 900000". The insured columns read "used to match the client, not kept on the policy". It says "The policy's current values come from this row".
  - DEMO-1003's Source block: all 12 carrier fields link to the corrected file's row 4. Status links its last change to the Oct 5 file, row 4. Four computed fields say what they come from.
- 2220 tests pass; `tsc` clean.

**Live verification (2026-10-08, after the apply):**
- **The verifier** reports `20261008290000` as applied. The cron job `la4-trace-health-daily` (`45 7 * * *`) is active.
- **Catalog:**
  - On `trace_health_check`, `service_role` can select and insert, but not update or delete.
  - `tenant_app` and `anon` can't read it; RLS is on.
  - Both functions run as `service_role` only.
- **The first health check** ran in the migration: **17 figures checked, 0 untraceable**.
- **Write-time guarantees found on the way:**
  - A ledger line pointing at a raw row that doesn't exist is refused by the `commission_entry_source` foreign key.
  - A snapshot can't be edited, so a policy can't lose its raw row afterwards ("A policy snapshot is never edited").
  - The trace check stays as the second line of defence.
- **A rolled-back block against the live functions:** six discrepancies on the demo agency.
  - **Withheld, each with its reason:** a ghost ledger line ("a reported line is not in the ledger"), a mis-rate with no lines, held money with no statement on file, and a policy not in the book.
  - **Not withheld:** the traced one, and the dismissed one (not checked).
  - The health check then counted 23 figures, 4 untraceable, `{"discrepancies": 4}`.
- **The app:**
  - `untraceableDiscrepancies` returns an empty set on the demo and fixture agencies, and `loadDiscrepancies` runs through it.
  - `loadRowTrace` reads the corrected file's row 4 as DEMO-1003, the current row, with 15 columns and map v1.
