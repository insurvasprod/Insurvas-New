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
| 4.3 Parser framework, layout maps | Not started (needs sample files) |
| 4.4 PDF extraction (OCR, AI, balance gate) | Not started (needs an AI provider) |
| 4.5 Status map, unknown-status gate | Not started (needs sample files) |
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
