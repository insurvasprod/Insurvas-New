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
| 4.8 Policy ↔ CRM matching with AI | Not started (needs an AI provider) |
| 4.9 Exception queues | Not started |
| 4.10 Existing-book import | Not started |
| 4.11 Policy list and detail | Partial: earlier screens exist; to be rebuilt on 4.7 |
| 4.12 Commission ledger | Partial: computed ledger exists; `commission_entry` not built |
| 4.13 Expected commission | Partial: schedules exist; trigger and lag not built |
| 4.14 Orphans, carrier balances | Partial: unmatched lines kept; balances not built |
| 4.15 Discrepancies, letters | Partial: 5 of 9 types, letter and PDF; to be rebuilt on 4.12–4.14 |
| 4.16 Retention board | Not started |
| 4.17 Carrier rules | **Done 2026-10-07.** Migration `20261008150000` live and verified (below). Rules, settings, coverage screen (below). The old statements engine still hard-codes 45 days; it retires with that code. |
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