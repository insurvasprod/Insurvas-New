# LA-3 schema plan

Every table LA-3 creates or alters, per build step. Status: **approved** 2026-09-28 (the Step 0
questions were settled on the recommendations marked **Decided** below). Statuses and outcomes come
from `docs/la3/STATUS-MODEL.md` and are not redefined here.

## Decisions log (Step 0)

| # | Question | Decided |
|---|---|---|
| Q1 | `submitting` status | dropped — nothing writes it (STATUS-MODEL §2) |
| Q2 | legacy case statuses | nothing writes them; kept valid, unused (STATUS-MODEL §5) |
| Q3 | sync moves without a disposition | allowed, `disposition_key = null` like `owner_fix` (STATUS-MODEL §6) |
| Q4 | spouse case completion | `won` once ≥ 1 issued and no live attempt remains for either insured (STATUS-MODEL §7) |
| Q5 | `kind` on the template tables | approved; Step 2's design lists every reader and every `on conflict (tenant_id, product_code)` first |
| Q6 | medication autocomplete source | a curated Final Expense list (~500 names) taken from RxNorm display names — public domain (NLM) — with free entry always allowed |
| Q7 | payout formula | the repo's `commission_schedules.rate_bp` + `advance_rules`, not LA-3.6's percentages; the Notion example is re-expressed as schedule rows |
| Q8 | `deal_flow.draft_date` | left null by LA-3 — the first draft date depends on the carrier's issue date, which we do not know at submission. An existing manual value is never overwritten. The draft day is shown from the attempt. |
| Q9 | tenant settings store | none general; the repo's convention is one `tenant_<domain>_settings` table (`tenant_queue_sla_settings`, `tenant_scoring_settings`, `tenant_booking_settings`), so `tenant_sales_settings` follows it |
| Q10 | dropped `'inbound'` stage source | fixed **separately, first** — `20260926000100_stage_history_source_restores_inbound.sql`. Live, the pending `20260925709850` (not applied, checked 2026-09-28) would also restore it, since 711300 is already live; the new file makes the final state right in any order, including a fresh replay where 711300 sorts after 709850 |
| Q11 | welcome-pack PDF | `pdf-lib` (no native binary, runs in the Node runtime); added in Step 20, not before |
| — | extension token lifetime | **60 minutes**, fixed (decision 1 range, settled value) |

---

## 0. Conventions every LA-3 migration follows

Taken from the repo, not invented:

- **Filename:** `YYYYMMDDHHMMSS_la_3_<n>_<what>.sql`. The latest file today is
  `20260925711600_…`, so LA-3 starts at `20260926100000` and steps up by `000100`.
- **Types:** text + CHECK for every status (no `CREATE TYPE`). Money is `bigint` cents with a
  `>= 0` CHECK. Dates that are dates are `date`.
- **RLS:** enabled on every new table. Tenant tables get one policy
  `<table>_tenant_scoped for all to tenant_app using / with check
  (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)`. Child tables
  without `tenant_id` scope through the parent with `exists (select 1 from parent p where p.id = … and
  p.tenant_id = <setting>)`. Platform tables get `<table>_service_role_only for all to service_role
  using (true)`. There are no RLS helper functions in this repo; none are added.
- **Writes** go through the service client or `security definer` RPCs granted to `service_role`.
  `tenant_app` gets `select` only. Because the service client bypasses RLS, **every service-layer
  query carries an explicit `.eq("tenant_id", …)`** — including embeds (see memory
  *service-role embeds need a tenant filter*).
- **Assertions:** each migration ends with the repo's `do $$ … $$` block that checks the objects it
  made and skips itself when the role has no CREATE right.
- **Applying:** this environment has no DDL authority. Each step's migration is handed to you as one
  script for the SQL editor, with a catalog check you run afterwards. Down-migrations are written in
  the step doc next to the up.
- **Sensitive values** (SSN, routing, account, card): never plain text. App-side AES-256-GCM, the
  pattern already in `lib/agencyProfile/crypto.ts`, stored as `<field>_ciphertext text` plus
  `<field>_last4 text`. The key is **per tenant**: HKDF-SHA256 over a new master key
  `APPLICATION_DATA_ENCRYPTION_KEY` with the tenant id as salt, plus a `key_version smallint` so a
  rotation can re-encrypt. **No column named `cvv`, `cvc` or `security_code` exists anywhere** —
  asserted by a migration test.

---

## Step 1 — 3.7 Application record + 3.19 Payment methods

### ALTER `tenant_application_cases` — extends the LA-2.14 case (one open per lead) because 3.16's "case" is exactly this row

| Change | Detail |
|---|---|
| status CHECK | add `'won','lost'`; keep `'open','submitted','closed','abandoned'` (legacy, STATUS-MODEL §5) |
| `outcome_reason_code text` | null unless `status = 'lost'` |
| `outcome_reason_text text` | ≤ 2000 |
| `closed_by uuid → users` | nullable |

The partial unique index `tenant_application_cases_one_open_idx` is untouched. `start_application_from_lead` is untouched.

### NEW `tenant_applications` — one attempt per insured per carrier. New because nothing holds an attempt today; the case row holds no payload.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk default gen_random_uuid() | |
| `tenant_id` | uuid not null → tenants on delete cascade | |
| `case_id` | uuid not null → tenant_application_cases on delete cascade | |
| `lead_id` | uuid not null → agent_leads on delete cascade | denormalised for lists |
| `insured_role` | text not null default 'primary' | CHECK in ('primary','spouse') — STATUS-MODEL §7 |
| `attempt_no` | int not null CHECK > 0 | |
| `supersedes_application_id` | uuid → tenant_applications on delete restrict | nullable |
| `carrier_id` | uuid → carriers on delete restrict | nullable until a quote is selected |
| `product_code` | text → products(code) | nullable until a quote is selected |
| `carrier_product_id` | uuid | FK added in Step 5 |
| `quote_id` | uuid | FK added in Step 6 |
| `field_set_template_id`, `field_set_revision` | uuid, int | the field set version this attempt started on (Step 1 uses the platform FE set) |
| `status` | text not null default 'draft' | STATUS-MODEL §2 CHECK, all six values now |
| `outcome` | text | STATUS-MODEL §3 CHECK, all six values now |
| `outcome_reason_code`, `outcome_reason_text` | text | |
| `outcome_recorded_at`, `outcome_recorded_by` | timestamptz, uuid → users | |
| `draft_day` | smallint CHECK between 1 and 28 | written by Step 8 |
| `created_by` | uuid not null → users | |
| `created_at`, `updated_at`, `submitted_at`, `closed_at` | timestamptz | |

Constraints and indexes:
- `unique (case_id, insured_role, attempt_no)`
- CHECK `(status = 'closed') = (outcome is not null)`
- partial unique `(case_id, insured_role) where status <> 'closed'` — one live attempt per insured
- `(tenant_id, status, updated_at desc)` for the Applications list
- `(tenant_id, lead_id)`

RLS: `tenant_applications_tenant_scoped`.

### NEW `tenant_application_values` — one row per canonical field (3.7). New: key/value so a new carrier field needs no migration.

| Column | Type | Notes |
|---|---|---|
| `application_id` | uuid → tenant_applications on delete cascade | PK part |
| `field_key` | text CHECK `~ '^[a-z]+\.[a-z0-9_]+$'` | PK part — `insured.dob`, `addr.zip` … |
| `tenant_id` | uuid not null | denormalised for RLS and filters |
| `value` | jsonb | non-sensitive values |
| `value_ciphertext`, `value_last4`, `key_version` | text, text, smallint | sensitive values only (`insured.ssn`) |
| `source` | text not null CHECK in ('lead','interview','quote','manual','carried_forward','household') | 3.7 prefill marking |
| `reviewed_at`, `reviewed_by` | timestamptz, uuid | for the QA "prefilled, never reviewed" warning |
| `updated_at`, `updated_by` | | |

CHECK: exactly one of `value` / `value_ciphertext` is non-null. Payment fields do **not** live here —
3.19 moves them to their own typed table.

### NEW `tenant_application_payment_methods` — typed payment (3.19). New, replacing 3.7's flat `bank.*` keys.

| Column | Type | Notes |
|---|---|---|
| `application_id` | uuid pk → tenant_applications on delete cascade | one method per attempt |
| `tenant_id` | uuid not null | |
| `method` | text not null CHECK in ('ach','direct_express','debit_card','credit_card','direct_bill') | |
| `routing_ciphertext`, `routing_last4`, `account_ciphertext`, `account_last4` | text | ACH only |
| `account_type` | text CHECK in ('checking','savings') | ACH only |
| `bank_name`, `name_on_account` | text | ACH only |
| `card_ciphertext`, `card_last4` | text | cards and Direct Express |
| `card_exp_month` smallint 1..12, `card_exp_year` smallint | | |
| `card_brand` | text CHECK in ('visa','mastercard','discover','amex') | |
| `name_on_card` | text | |
| `billing_frequency` | text CHECK in ('monthly','quarterly','semiannual','annual') | direct bill only |
| `billing_address_same_as_insured` | boolean | direct bill only |
| `key_version` | smallint not null | |
| `linked_to_primary` | boolean not null default false | Step 22, spouse sharing |
| `updated_at`, `updated_by` | | |

Per-method CHECKs: ACH requires routing + account + type; cards require card + expiry + brand; direct
bill requires frequency and has no draft day. No CVV column, asserted by test.

### NEW `tenant_sensitive_access_log` — 3.7/3.12/3.14 audit. New: there is no reveal audit table today (the existing reveal writes a generic `audit_log` row).

`id, tenant_id, user_id, application_id, field_key, action ('reveal','extension_read','copy'),
surface ('web','extension','copy_assist'), at timestamptz default now(), ip inet`. Append-only:
service_role gets insert + select only, following `tenant_lead_stage_events`. The reveal service
writes this row **and** the existing `audit()` call, in that order, and returns the value only after
both succeed.

### Seed
Platform-default Final Expense **application field set** — see Step 2, it is a template kind.

---

## Step 2 — 3.1 Underwriting templates (decision 2: the LA-1.4 engine)

> **Revised 2026-09-28 during the build (supersedes the ALTER below).** Listing the readers, as Q5
> required, found that `on conflict (tenant_id, product_code)` is the conflict target inside three
> live functions — `admin_apply_tenant_template` (`20260912230000`), the product-configuration seed
> (`20260901130000:94`) and the LA-1.4 apply (`20260902130000:184`). Replacing that unique key makes
> all three raise at runtime ("no unique or exclusion constraint matching the ON CONFLICT
> specification"), i.e. admin template apply breaks. Their live bodies may also differ from the repo
> (SQL-editor patches), so rewriting them blind is the riskier path. Rule 1 wins:
>
> **`sales_templates`** is a separate registry — `id, tenant_id (null = platform), kind
> ('underwriting','quotation','application_field_set'), product_code → products, carrier_id →
> carriers (nullable), name, version, status ('draft','published','retired'), definition jsonb`
> (exactly LA-1.4's `{fields: TemplateField[], form_definition: TemplateFormDefinition}` shape plus
> `age_basis` for quotation), `created_by, published_at`. Published rows are immutable (trigger);
> editing makes version N+1. It is **not** a second engine: the definition format, field types,
> `lib/templates/schemas.ts` validation, `visibility.ts` conditional logic and the renderer are the
> LA-1.4 ones. `tenant_templates` and every function that writes it are untouched.
>
> The field-type CHECK change below is also dropped — `sales_templates.definition` is validated by
> Zod, which gains `medication_list`, so the lead-intake type CHECKs are not touched.

### ALTER `templates` and `tenant_templates` — extends the LA-1.4 engine; decision 2 forbids new `uw_templates`/`uw_questions`.

| Change | Detail |
|---|---|
| `kind text not null default 'lead_intake'` | CHECK in ('lead_intake','underwriting','quotation','application_field_set') — all four now, so Steps 5 and 1's field set never re-migrate |
| `carrier_id uuid → carriers` | nullable. Null = general (per product only) |
| `tenant_templates` unique | replace `UNIQUE (tenant_id, product_code)` with a unique index on `(tenant_id, product_code, kind, coalesce(carrier_id, '00000000-0000-0000-0000-000000000000'))` |

**This is the widest change in the plan (Q5, approved):** `UNIQUE (tenant_id, product_code)`
is the conflict target of the template copy/apply RPCs (`0010`, `20260912210000`,
`20260912260000`, `20260913110000`) and is assumed by `lib/agentTemplates/service.ts:234` and
`lib/templates/usage.ts:61`. The default `'lead_intake'` keeps every existing row valid, but every
existing reader and every `on conflict (tenant_id, product_code)` has to gain `kind = 'lead_intake'`
in the same migration, or it will start matching underwriting rows. Step 2's design doc lists every
one before any SQL is written.

The three child tables (`tenant_template_fields/stages/forms`) carry a `tenant_id` column that exists
only in the live database (schema drift, `20260912230000`). Step 2 does not touch them, but a fresh
replay of the repo fails at `20260912250000` — out of scope, noted.

### ALTER field type CHECK on `template_fields` and `tenant_template_fields`
Add `'medication_list'` to both lists (3.2). Keep every existing value, including the legacy hyphenated spellings.

### No migration for question metadata
Knockout flags and follow-ups live in `form_definition` jsonb, beside the existing `show_when`:
`is_knockout boolean`, `knockout_when {equals}`, `knockout_note text`. Zod in
`lib/templates/schemas.ts` and types in `lib/templates/constants.ts` change; `visibility.ts`'s
single-equality `show_when` already covers "cancer? yes → when / type / treated".

### Seed
Platform `templates` rows of kind `underwriting` for `final_expense`, each with the five survival
questions (SS deposit date, is this the account, anyone else on the call, existing coverage, can you
get a text now).

---

## Step 3 — 3.2 Interview and medications

### NEW `tenant_uw_interviews` — new: no interview record exists. One per insured per case, so it carries across attempts without copying (3.16).

`id, tenant_id, case_id → tenant_application_cases, insured_role, tenant_template_id,
template_revision int, started_at, completed_at, started_by → users`.
Unique `(case_id, insured_role)`.

### NEW `tenant_uw_answers`
PK `(interview_id, question_key)`. `value jsonb`, `notes text`, `answered_at`, `answered_by`.
Values of hidden follow-ups are deleted on save (`pruneHiddenTemplateValues`), matching the
existing forms behaviour.

### NEW `tenant_uw_answer_changes` — post-call amend audit (3.2)
`id, interview_id, question_key, old_value jsonb, new_value jsonb, changed_by, changed_at, reason`.
Written only when the interview is `completed_at is not null`.

### NEW `tenant_medications`
`id, interview_id → tenant_uw_interviews on delete cascade, name text not null, dose text,
since text (year or date as said), prescribed_for text, prescribed_for_unknown boolean not null
default false, notes, sort_order, created_by, updated_at`. CHECK: `prescribed_for` is null when
`prescribed_for_unknown`.

### NEW `medication_names` (platform) — autocomplete list
`name text pk, generic_of text, rxcui text`. Seeded with ~500 curated names from RxNorm (Q6).

### Snapshot at submission
Because the interview is shared across attempts, Step 11 freezes the answers and medications onto
the submission row, so a declined attempt keeps the health picture it was submitted with.

---

## Step 4 — 3.6 Appointments + payout strip

**Most of Part 1 already exists — no new appointment table.**

| 3.6 asks for | Already in |
|---|---|
| carrier + states + status + dates | `appointments (carrier_id, state, status, effective_from, terminated_at, expires_at)` — one row per state |
| writing number | `tenant_carriers.writing_number` |
| commission level | `tenant_carriers.contract_level_bp` |
| advance months | `advance_rules.advance_months` (+ `advance_pct_bp`) |
| year-one rate per product | `commission_schedules.rate_bp` where `policy_year = 1` |

### ALTER `tenant_carriers`
Add `upline_name text` and `notes text` (≤ 2000). Nothing else.

### No other migration
The payout strip is computed: `annual = monthly_premium_cents × 12`; `fyc = annual × rate_bp / 10000`
using the schedule row for (carrier, product, the tenant's `contract_level_bp`, year 1);
`advance = fyc × advance_pct_bp / 10000 × advance_months / 12`, all integer cents with explicit
rounding (half-up, at the last step only). This uses the repo's schedule model instead of LA-3.6's
`commission_level_pct × product_fyc_pct` formula (Q7). The Notion worked example becomes the
acceptance test as schedule rows: `rate_bp = 10500` (105% × 100%), `advance_pct_bp = 10000`,
`advance_months = 9` → annual 82 080¢, FYC 86 184¢, advance 64 638¢ — the same $820.80 / $861.84 /
$646.38.

Appointments are agency-level; there is no per-agent appointment. "Appointed?" checks the agency
appointment for (carrier, client state), and the agent's licence via `tenant_user_licensed_states`.

---

## Step 5 — 3.4 Quotation templates

Uses Step 2's `kind = 'quotation'` with `carrier_id` set — no template table.
`age_basis` ('nearest' | 'last') lives at the top of `form_definition` (Zod change only).

### NEW `carrier_products` (platform, with tenant rows allowed) — new: nothing in the repo pairs a carrier with a product, and every limit 3.4/3.5/3.11/3.25 needs is per carrier product.

| Column | Type |
|---|---|
| `id` | uuid pk |
| `tenant_id` | uuid nullable → tenants (null = platform default, mirroring `carriers.organization_id`) |
| `carrier_id` | uuid not null → carriers |
| `product_code` | text not null → products(code) |
| `name` | text not null |
| `tiers` | text[] (FE: level, graded, modified, gi) |
| `issue_age_min`, `issue_age_max` | smallint |
| `face_min_cents`, `face_max_cents` | bigint |
| `premium_per_1000_band_min`, `_max` | numeric(6,2) — per-product plausibility band (3.25) |
| `accepted_payment_methods` | text[] (3.19) |
| `is_active` | boolean |

Unique `(coalesce(tenant_id, zero-uuid), carrier_id, product_code, name)`. Term columns come in Step 23.

### ALTER `carriers`
`portal_origin text` (https origin CHECK), `reference_pattern text` (regex, 3.15),
`billing_descriptor text` (3.20).

---

## Step 6 — 3.5 Quotes

### NEW `tenant_quotes` — new: quotes today are `deal_flow.initial_quote` free text.

`id, tenant_id, case_id, lead_id, insured_role, application_id (nullable, set when an attempt is
opened from it), carrier_id, carrier_product_id, product_code, quotation_template_id,
template_revision, tier, face_amount_cents bigint, monthly_premium_cents bigint, age_used smallint,
rating_inputs jsonb, riders jsonb, warnings jsonb, status ('draft','presented','selected','discarded'),
created_by, created_at`.

CHECKs: `monthly_premium_cents > 0`; `monthly_premium_cents < face_amount_cents`.
Partial unique `(application_id) where status = 'selected'`. Nothing deletes a quote.

ALTER `tenant_applications`: add FK `quote_id → tenant_quotes`.

---

## Step 7 — 3.8 Beneficiaries

### NEW `tenant_application_beneficiaries`
`id, application_id, tenant_id, tier ('primary','contingent'), first_name, last_name, relationship
('spouse','child','parent','sibling','grandchild','estate','trust','funeral_home','other'),
relationship_other, dob date, share_bp integer CHECK 0 < x ≤ 10000 (hundredths of a percent — 3334 is
33.34%, so totals are exact integer sums), phone, address jsonb,
sort_order`. CHECK: `relationship <> 'other' or relationship_other is not null`. The 100.00 totals are
checked by the QA engine and the `ready` guard, not a row CHECK (a total is not a row property).

---

## Step 8 — 3.9 Draft dates

> **Built in Step 1 instead:** these columns live on `tenant_application_payment_methods` (the
> draft is a property of how they pay, and a spouse sharing the payment shares the draft), and
> `tenant_applications.draft_day` mirrors the chosen day for lists.

### (was) ALTER `tenant_applications`
`draft_income_type text` ('ssa','ssi','ssa_ssi','pension','payroll','va','none'),
`draft_income_inputs jsonb` (birth day, pre-1997 flag, pay frequency, anchor date),
`draft_day_recommended smallint`, `draft_day_override_reason text`, `draft_day_overridden_by uuid`,
`draft_day_overridden_at timestamptz`. CHECK: override reason present when `draft_day` ≠
`draft_day_recommended`.

Federal holidays are computed in `lib/draftDates/holidays.ts` from the 11 fixed and floating rules
in 5 U.S.C. § 6103 (with the Saturday → Friday / Sunday → Monday observance rule). No table, no API.

---

## Step 9 — 3.10 Disclosures

Separate from `state_disclosures` (LA-2.23 call scripts, platform-level, no tenant).

- **NEW `application_disclosures`** — `id, tenant_id (null = platform), code, title,
  body_markdown, attachment_path, states text[], carrier_ids uuid[], version, status
  ('draft','published','retired'), created_by`. Unique `(coalesce(tenant_id), code, version)`.
- **NEW `application_disclosure_rules`** — `id, disclosure_id, clauses jsonb` (array of
  `{field, op in ('eq','neq','in','not_in','gt','lt'), value}`, ANDed).
- **NEW `tenant_application_disclosures`** — `application_id, disclosure_id, disclosure_version,
  status ('required','acknowledged','not_applicable'), method ('read_aloud','emailed','mailed'),
  note, acknowledged_by, acknowledged_at`. PK `(application_id, disclosure_id)`. CHECK:
  `not_applicable` requires a note; `acknowledged` requires method.
- **Seed:** `REPLACEMENT_NOTICE`, `1035_EXCHANGE`.

---

## Step 10 — 3.11 QA engine

No table. `lib/applications/qa.ts` returns the verdict. The verdict is persisted on the submission
(Step 11). Tenant QA preferences live in Step 16's settings row; until then, code defaults.

---

## Step 11 — 3.15 Submission capture

### NEW `tenant_application_submissions`
`id, tenant_id, application_id, attempt_no, carrier_reference text, reference_kind
('application_no','policy_no'), policy_number text, submitted_at, submitted_via
('extension','copy_assist','carrier_portal_manual'), confirmation_path text, qa_verdict jsonb not
null, health_snapshot jsonb not null, notes, created_by`. Index `(tenant_id, carrier_id,
carrier_reference)` for the duplicate warning (carrier_id denormalised). `policy_number` is added
later without touching `carrier_reference`.

### Storage
NEW private bucket `application-confirmations` (image/png, image/jpeg, application/pdf; 10 MB).
No `storage.objects` policy exists anywhere in the repo; access is service-role only, served through
short-lived signed URLs from an API route that checks the tenant. Path
`<tenant_id>/<application_id>/<submission_id>.<ext>`.

### Writes into existing tables
- On issue (Step 15): `mark_deal_policy_issued` (existing RPC) → `tenant_issued_policies`. That
  table's `carrier` is **text**, so the carrier name is written, and its unique
  `(tenant_id, carrier, policy_number)` becomes the duplicate guard at issue.
- On submit: update the existing `deal_flow` row from `start_application_from_lead` — `carrier`,
  `product_type`, `monthly_premium_cents`, `face_amount_cents`. `draft_date` is **not** written (Q8).

---

## Step 12 — 3.12 Extension auth

- **NEW `tenant_extension_grants`** — `id (jti), tenant_id, user_id, application_id,
  carrier_origin, scope ('read_application_fields'), issued_at, expires_at, revoked_at,
  revoked_reason, field_reads int default 0`. CHECK `expires_at - issued_at = interval '60 minutes'`
  (decision 1, settled at 60). Index `(tenant_id, user_id) where revoked_at is null`.
- **NEW `tenant_extension_events`** — every grant, read, rejection: `id, tenant_id, grant_id,
  kind, field_key, origin, status_code, at`. Append-only.
- Tokens are JWTs signed with `jose` (already a dependency) under a new
  `EXTENSION_GRANT_SIGNING_KEY`; revocation is read from `tenant_extension_grants` on every request.
- The guard test `lib/carriers/cancelledAutofillStaysCancelled.test.mjs` is updated first.

---

## Step 13 — 3.14 Copy-assist

### NEW `tenant_copy_assist_ticks`
`application_id, field_key, copied_at, copied_by, surface`. PK `(application_id, field_key)`.
A table rather than browser storage because the web pop-out and the extension are different
origins and 3.14 wants the ticks shared. A new attempt has a new `application_id`, so ticks reset by
construction.

---

## Step 14 — 3.13 Field maps (storage, review, fill — no AI)

Names are the ones the guard test allows:

- **NEW `carrier_field_map`** — `id, tenant_id (null = platform), carrier_id, carrier_product_id,
  version, status ('draft','in_review','published','retired','needs_review'), origin,
  created_by, approved_by, approved_at, proposal_source ('manual','ai')`.
- **NEW `carrier_field_map_step`** — `id, map_id, page_key, url_pattern, sort_order`.
- **NEW `carrier_field_map_entry`** — `id, step_id, field_key, selector, selector_fallback,
  input_kind, value_transform, option_map jsonb, confidence numeric, verified boolean, verified_by`.
- **NEW `carrier_field_map_events`** — `map_miss` and fill-rate events.
- Publish guard (a trigger): every entry whose `field_key` is sensitive must be `verified`.
  Published rows are immutable (trigger).

`proposal_source = 'ai'` is the seam for decision 4; nothing writes it until then.

---

## Step 15 — 3.16 Attempts (UI; schema from Step 1)

- **NEW `application_outcome_reasons`** — `code, tenant_id (null = platform), label,
  valid_outcomes text[], carrier_id nullable, is_active`. Seeded per STATUS-MODEL §3.
- **NEW function `application_transition(p_application_id, p_to_status, p_outcome, …)`** —
  the only writer of `status` / `outcome` (STATUS-MODEL §4).
- **NEW function `open_next_attempt(p_application_id)`** — copies `tenant_application_values`
  rows whose group is carried (`insured.*`, `addr.*`, `owner.*`) with source `carried_forward`, plus
  beneficiaries and the payment method. Never quotes, disclosures, QA or ticks.

---

## Step 16 — 3.17 Sales settings

### NEW `tenant_sales_settings`
`tenant_id pk, settings jsonb not null, updated_at, updated_by`, validated by a Zod schema in
`lib/salesSettings/schema.ts` (per-$1,000 band default, appointment warn/block, draft buffer 2–4,
requirement ageing N, welcome-pack auto/review, AI on/off). Every change writes `audit()` with old and
new values. This follows the repo's one-settings-table-per-domain convention (Q9).

---

## Step 17 — 3.23 Pipeline sync

- **ALTER `tenant_lead_stage_events`** source CHECK: add `'application_sync'`, keeping `'inbound'`.
  `'inbound'` itself is restored earlier and separately (Q10) by
  `20260926000100_stage_history_source_restores_inbound.sql`: `20260925711300` rewrote the CHECK
  without it, and the live constraint (read 2026-09-28) allows only
  `board, table, list, lead_detail, owner_fix, dialer`. No live function writes `'inbound'` yet, so
  nothing fails today — but `20260925709870` (unapplied) adds that writer, and every inbound
  disposition that moves a stage would fail the moment it lands.
- **NEW `tenant_application_stage_map`** — `tenant_id, sync_key, stage_id → tenant_pipeline_stages`.
  PK `(tenant_id, sync_key)`. STATUS-MODEL §6.

---

## Step 18 — 3.18 Requirements

### NEW `tenant_application_requirements`
`id, tenant_id, application_id, kind ('aps','phone_interview','voice_verification','missing_info',
'amendment','paramed_exam','counteroffer','other'), description, waiting_on ('client','carrier',
'agent','third_party'), status ('open','in_progress','satisfied','waived','expired'), raised_at date,
due_at date, satisfied_at date, last_chased_at timestamptz, chase_count int default 0, callback_id →
tenant_callbacks (nullable), note, created_by`. Exam columns come in Step 23. `counteroffer` is
added so Step 19 can raise one without a CHECK change.

---

## Step 19 — 3.26 Counteroffers

### NEW `tenant_application_counteroffers`
`id, tenant_id, application_id, received_at, offered_tier, offered_health_class,
offered_face_cents bigint, offered_monthly_premium_cents bigint, offered_annual_premium_cents
bigint, reason_code, reason_text, expires_at timestamptz, status ('pending_client','accepted',
'rejected','expired'), responded_at, responded_by, client_response_note, requirement_id →
tenant_application_requirements`. Nothing deletes a row. A scheduled job moves `pending_client` past
`expires_at` to `expired` and closes the attempt as `offer_expired` — scheduled through pg_cron
with the check block that runs the job once (memory: *pg_cron jobs fail silently*).

---

## Step 20 — 3.20 Welcome pack

### NEW `tenant_welcome_packs`
`id, tenant_id, application_id, attempt_no, pdf_path, recipient_email, email_status ('not_sent',
'queued','sent','bounced','review'), sent_at, bounced_at, bounce_reason, household_group uuid
(Step 22: one email covering both spouses)`. Unique `(application_id)` — once per attempt.
Template body goes in `tenant_sales_settings.settings.welcome_pack`.

The PDF is generated with `pdf-lib`, added to `package.json` in this step (Q11).

---

## Step 21 — 3.22 Portal register

### NEW `tenant_carrier_portal_accounts`
`id, tenant_id, carrier_id, portal_url, username, writing_number, mfa_type ('none','sms','app',
'email'), notes, last_verified_at`. **No password or secret column**; a migration test asserts that
no column name matches `/pass|secret|token|pin|credential/i`.

---

## Step 22 — 3.24 Spouse

No new table (STATUS-MODEL §7). `insured_role` exists from Step 1; `linked_to_primary` already on the
payment table. ALTER `tenant_application_values`: add `linked_to_primary boolean not null default
false`, valid only for the `addr.*`, `contact.*` groups (CHECK on `field_key`). A health key can never
be linked — CHECK `not (linked_to_primary and field_key like 'health.%')`, and the interview is per
insured by its unique key.

---

## Step 23 — 3.25 Term life

- ALTER `carrier_products`: `term_lengths smallint[]`, `health_classes text[]`, `face_bands
  jsonb`, `exam_required_above_face_cents bigint`, `convertible boolean`,
  `conversion_deadline_rule text`, `renewal_type ('annual_renewable','level')`. Product type comes
  from `product_code` (`final_expense` vs `term_life`, both already seeded).
- ALTER `tenant_quotes`: `term_length smallint`, `assumed_health_class text`,
  `annual_premium_cents bigint`.
- ALTER `tenant_application_requirements`: `exam_vendor, exam_ordered_on, exam_scheduled_on,
  exam_completed_on, exam_results_on` (dates), CHECK they are null unless `kind = 'paramed_exam'`.
- Seed a platform `underwriting` template for `term_life`.

---

## Step 24 — 3.21 Report

Materialised views `mv_la3_funnel`, `mv_la3_declines`, `mv_la3_counteroffers`,
`mv_la3_timing`, refreshed by pg_cron. Materialised views cannot carry RLS, so they are revoked
from `tenant_app` and read only through a `security definer` function that filters on the caller's
tenant. "Placed" is computed only where a first-draft result exists — nothing supplies one yet, so
it ships labelled partial.

---

## Step 25 — 3.3 AI assistant — blocked on decision 4

Planned shape only: `tenant_ai_suggestions (id, tenant_id, application_id, interview_id, kind,
input_redacted jsonb, output text, provider, model, accepted_at, dismissed_at, created_at)`. The
redaction test asserts no sensitive key and no `contact.*` key is in `input_redacted`. Nothing is
written until the provider is chosen.

---

## Step 26 — Extension package

No schema beyond Steps 12–14.

---

## New feature flags (Step 1 migration)

Insert into `features` (module `sell`) and grant to the plans that already hold `applications`
(`pro`, `advance` per `20260911132000`): `ai_assistant`, `carrier_extension`, `sales_report`.
Each new API route is registered in `lib/entitlements/agentApiPolicy.ts` so
`npm run check:features` covers it.
