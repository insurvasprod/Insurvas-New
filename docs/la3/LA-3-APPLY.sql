-- ============================================================================
-- Pending migrations — 23 files, each in its own transaction
-- Generated 2026-09-28 by scripts/build-pending-bundle.mjs. Do not hand-edit; regenerate.
--
-- HOW TO RUN: Supabase dashboard → SQL editor → paste this whole file → Run.
-- Each file is begin … commit on its own. The SQL editor STOPS at the first error: that file is
-- rolled back, the files before it stay applied, and nothing after it runs. Fix the named file,
-- regenerate, and run the whole script again — re-running is safe: the files use
-- create-or-replace / if-not-exists, and history rows use on-conflict-do-nothing.
--
-- AFTERWARDS: node --env-file=.env.local scripts/verify-applied-migrations.mjs
--
-- Files, in order:
--    1. 20260926000100_stage_history_source_restores_inbound.sql
--    2. 20260926100000_la_3_7_application_record.sql
--    3. 20260926100100_la_3_1_sales_templates.sql
--    4. 20260926100200_la_3_2_interview.sql
--    5. 20260926100300_la_3_6_carrier_products.sql
--    6. 20260926100400_la_3_5_quotes.sql
--    7. 20260926100500_la_3_8_beneficiaries.sql
--    8. 20260926100600_la_3_10_disclosures.sql
--    9. 20260926100700_la_3_15_submissions.sql
--   10. 20260926100800_la_3_12_extension_and_maps.sql
--   11. 20260926100900_la_3_16_attempts.sql
--   12. 20260926101000_la_3_17_23_settings_and_sync.sql
--   13. 20260926101100_la_3_18_26_20_22_after_submit.sql
--   14. 20260926101200_la_3_21_sales_report.sql
--   15. 20260926102200_la_3_18_requirement_callbacks.sql
--   16. 20260926102210_la_3_26_counteroffer_expiry.sql
--   17. 20260926102220_la_3_20_welcome_pack_delivery.sql
--   18. 20260926102230_la_3_24_household_draft_day.sql
--   19. 20260926102300_la_3_18_requirement_chased_by.sql
--   20. 20260926102400_la_3_17_tenant_carrier_settings.sql
--   21. 20260926102410_la_3_6_carrier_product_copies.sql
--   22. 20260926102500_la_3_10_disclosure_versions_frozen.sql
--   23. 20260926102510_la_3_13_staff_map_approvers.sql
-- ============================================================================

-- ─── [1/23] 20260926000100_stage_history_source_restores_inbound.sql ──────────────
begin;

-- Stage history accepts 'inbound' again, after 20260925711300 dropped it.
--
--   20260925709850 widened tenant_lead_stage_events.source to include 'inbound' (LA-1.12-10), and
--   restated 'dialer' so it and 711300 could be applied in either order. 711300 then restated the
--   check with 'dialer' only. Applied by filename, 711300 runs second and the inbound source is gone,
--   while 20260925709870's inbound disposition patch writes source 'inbound' — every inbound
--   disposition that moves a stage would fail the check.
--
--   Live on 2026-09-28: 711300 is applied, 709850 and 709870 are not, and the constraint allows
--   board, table, list, lead_detail, owner_fix, dialer. Nothing writes 'inbound' yet, so nothing fails
--   today. This file makes the final state right in either order: before 709850, after it, or on a
--   fresh replay.
--
--   LA-3 (20260926100000 onward) adds 'application_sync' to this same check and keeps 'inbound'.
--
-- Down: re-run 20260925711300's section 0 (the check without 'inbound'). Only safe while no row has
-- source = 'inbound'.

alter table public.tenant_lead_stage_events
  drop constraint if exists tenant_lead_stage_events_source_check,
  add constraint tenant_lead_stage_events_source_check
    check (source = any (array['board', 'table', 'list', 'lead_detail', 'owner_fix', 'dialer', 'inbound'])) not valid;
alter table public.tenant_lead_stage_events validate constraint tenant_lead_stage_events_source_check;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_lead_stage_events_source_check'
                  and pg_get_constraintdef(oid) like '%''inbound''%'
                  and pg_get_constraintdef(oid) like '%''dialer''%'
                  and pg_get_constraintdef(oid) like '%''owner_fix''%'
                  and convalidated) then
    raise exception '20260926000100: stage history does not accept inbound, dialer and owner_fix';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260926000100', 'stage_history_source_restores_inbound') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [2/23] 20260926100000_la_3_7_application_record.sql ──────────────────────────
begin;

-- LA-3 step 1 — the application record (LA-3.7) and typed payment methods (LA-3.19).
--
-- docs/la3/STATUS-MODEL.md is the specification for every status and outcome here, and
-- docs/la3/SCHEMA-PLAN.md "Step 1" for every table. In short:
--
--   tenant_application_cases      EXTENDED  (LA-2.14's case is LA-3.16's case) + won/lost
--   tenant_applications           NEW       one attempt per insured per carrier tried
--   tenant_application_values     NEW       one row per canonical field — never a wide table
--   tenant_application_payment_methods NEW  typed payment; no CVV column exists, anywhere
--   tenant_sensitive_access_log   NEW       every reveal of an SSN / account / card number
--   application_transition()      NEW       the only writer of status and outcome
--   features                      +3 flags  ai_assistant, carrier_extension, sales_report
--
-- Sensitive values are encrypted by the APPLICATION (AES-256-GCM, per-tenant key derived from
-- APPLICATION_DATA_ENCRYPTION_KEY) before they reach this database; the columns hold ciphertext
-- and a last-four for display. Nothing here can decrypt them.
--
-- Down (only while no row exists in the new tables):
--   drop function public.application_transition(uuid, uuid, uuid, text, text, text, text);
--   drop table public.tenant_sensitive_access_log, public.tenant_application_payment_methods,
--              public.tenant_application_values, public.tenant_applications;
--   alter table public.tenant_application_cases drop column outcome_reason_code,
--     drop column outcome_reason_text, drop column closed_by;
--   restore tenant_application_cases_status_check to ('open','submitted','closed','abandoned');
--   delete from public.plan_features where feature_key in ('ai_assistant','carrier_extension','sales_report');
--   delete from public.features where feature_key in ('ai_assistant','carrier_extension','sales_report');

-- ── 0 · feature flags ───────────────────────────────────────────────────────
insert into public.features (feature_key, label, module, sort_order) values
  ('ai_assistant',      'AI underwriting assistant', 'sell', 6),
  ('carrier_extension', 'Carrier autofill extension', 'sell', 7),
  ('sales_report',      'Sales performance report',   'sell', 8)
on conflict (feature_key) do nothing;

-- Granted to exactly the plans that already hold `applications`, whatever those are live.
insert into public.plan_features (plan_id, feature_key)
select pf.plan_id, f.key
  from public.plan_features pf
  cross join (values ('ai_assistant'), ('carrier_extension'), ('sales_report')) as f(key)
 where pf.feature_key = 'applications'
on conflict do nothing;

-- ── 1 · the case: won / lost ────────────────────────────────────────────────
alter table public.tenant_application_cases
  add column if not exists outcome_reason_code text,
  add column if not exists outcome_reason_text text check (outcome_reason_text is null or char_length(outcome_reason_text) <= 2000),
  add column if not exists closed_by uuid references public.users(id) on delete set null;

-- LA-3 writes open / won / lost. submitted, closed, abandoned stay valid and unused (nothing writes
-- them — STATUS-MODEL §5, checked 2026-09-28), so existing rows keep validating.
alter table public.tenant_application_cases
  drop constraint if exists tenant_application_cases_status_check,
  add constraint tenant_application_cases_status_check
    check (status in ('open', 'won', 'lost', 'submitted', 'closed', 'abandoned')) not valid;
alter table public.tenant_application_cases validate constraint tenant_application_cases_status_check;

alter table public.tenant_application_cases
  drop constraint if exists tenant_application_cases_lost_reason,
  add constraint tenant_application_cases_lost_reason
    check (status <> 'lost' or outcome_reason_code is not null) not valid;
alter table public.tenant_application_cases validate constraint tenant_application_cases_lost_reason;

-- ── 2 · the attempt ─────────────────────────────────────────────────────────
create table if not exists public.tenant_applications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  case_id uuid not null references public.tenant_application_cases(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  insured_role text not null default 'primary' check (insured_role in ('primary', 'spouse')),
  attempt_no integer not null check (attempt_no > 0),
  supersedes_application_id uuid references public.tenant_applications(id) on delete restrict,
  carrier_id uuid references public.carriers(id) on delete restrict,
  product_code text references public.products(code) on delete restrict,
  carrier_product_id uuid,
  quote_id uuid,
  field_set_template_id uuid,
  field_set_revision integer check (field_set_revision is null or field_set_revision > 0),
  status text not null default 'draft'
    check (status in ('draft', 'ready', 'submitted', 'pending_carrier', 'counteroffer_pending', 'closed')),
  outcome text
    check (outcome is null or outcome in ('issued', 'declined', 'postponed', 'withdrawn', 'declined_by_client', 'offer_expired')),
  outcome_reason_code text,
  outcome_reason_text text check (outcome_reason_text is null or char_length(outcome_reason_text) <= 2000),
  outcome_recorded_at timestamptz,
  outcome_recorded_by uuid references public.users(id) on delete set null,
  draft_day smallint check (draft_day is null or draft_day between 1 and 28),
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  closed_at timestamptz,
  constraint tenant_applications_attempt_unique unique (case_id, insured_role, attempt_no),
  constraint tenant_applications_closed_has_outcome check ((status = 'closed') = (outcome is not null)),
  constraint tenant_applications_reason_when_needed
    check (outcome is null or outcome not in ('declined', 'postponed', 'withdrawn') or outcome_reason_code is not null)
);

-- One live attempt per insured per case: a new try is a new attempt, only once the last one closed.
create unique index if not exists tenant_applications_one_live_idx
  on public.tenant_applications (case_id, insured_role) where status <> 'closed';
create index if not exists tenant_applications_list_idx
  on public.tenant_applications (tenant_id, status, updated_at desc);
create index if not exists tenant_applications_lead_idx
  on public.tenant_applications (tenant_id, lead_id);
create index if not exists tenant_applications_carrier_idx
  on public.tenant_applications (carrier_id) where carrier_id is not null;
create index if not exists tenant_applications_supersedes_idx
  on public.tenant_applications (supersedes_application_id) where supersedes_application_id is not null;

alter table public.tenant_applications enable row level security;
drop policy if exists tenant_applications_tenant_scoped on public.tenant_applications;
create policy tenant_applications_tenant_scoped on public.tenant_applications
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_applications to tenant_app;
grant select, insert, update on public.tenant_applications to service_role;

-- ── 3 · one row per canonical field ─────────────────────────────────────────
create table if not exists public.tenant_application_values (
  application_id uuid not null references public.tenant_applications(id) on delete cascade,
  field_key text not null check (field_key ~ '^[a-z]+\.[a-z0-9_]+$'),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  value jsonb,
  value_ciphertext text,
  value_last4 text check (value_last4 is null or value_last4 ~ '^[0-9]{1,4}$'),
  key_version smallint,
  source text not null check (source in ('lead', 'interview', 'quote', 'manual', 'carried_forward', 'household')),
  linked_to_primary boolean not null default false,
  reviewed_at timestamptz,
  reviewed_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  primary key (application_id, field_key),
  constraint tenant_application_values_one_form check ((value is null) <> (value_ciphertext is null)),
  constraint tenant_application_values_cipher_versioned check (value_ciphertext is null or key_version is not null),
  -- A health answer is never shared between spouses (LA-3.24), and only household keys can be.
  constraint tenant_application_values_link_household
    check (not linked_to_primary or field_key like 'addr.%' or field_key like 'contact.%')
);
create index if not exists tenant_application_values_tenant_idx on public.tenant_application_values (tenant_id);

alter table public.tenant_application_values enable row level security;
drop policy if exists tenant_application_values_tenant_scoped on public.tenant_application_values;
create policy tenant_application_values_tenant_scoped on public.tenant_application_values
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
-- tenant_app never reads ciphertext; the service reads it only inside the reveal path.
grant select (application_id, field_key, tenant_id, value, value_last4, source, linked_to_primary, reviewed_at, updated_at)
  on public.tenant_application_values to tenant_app;
grant select, insert, update, delete on public.tenant_application_values to service_role;

-- ── 4 · typed payment method (LA-3.19) ──────────────────────────────────────
create table if not exists public.tenant_application_payment_methods (
  application_id uuid primary key references public.tenant_applications(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  method text not null check (method in ('ach', 'direct_express', 'debit_card', 'credit_card', 'direct_bill')),
  routing_ciphertext text,
  routing_last4 text check (routing_last4 is null or routing_last4 ~ '^[0-9]{4}$'),
  account_ciphertext text,
  account_last4 text check (account_last4 is null or account_last4 ~ '^[0-9]{1,4}$'),
  account_type text check (account_type is null or account_type in ('checking', 'savings')),
  bank_name text check (bank_name is null or char_length(bank_name) <= 120),
  name_on_account text check (name_on_account is null or char_length(name_on_account) <= 160),
  card_ciphertext text,
  card_last4 text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  card_exp_month smallint check (card_exp_month is null or card_exp_month between 1 and 12),
  card_exp_year smallint check (card_exp_year is null or card_exp_year between 2000 and 2100),
  card_brand text check (card_brand is null or card_brand in ('visa', 'mastercard', 'discover', 'amex')),
  name_on_card text check (name_on_card is null or char_length(name_on_card) <= 160),
  billing_frequency text check (billing_frequency is null or billing_frequency in ('monthly', 'quarterly', 'semiannual', 'annual')),
  billing_address_same_as_insured boolean,
  draft_income_type text check (draft_income_type is null or draft_income_type in ('ssa', 'ssi', 'ssa_ssi', 'pension', 'payroll', 'va', 'none')),
  draft_income_inputs jsonb not null default '{}'::jsonb check (jsonb_typeof(draft_income_inputs) = 'object'),
  draft_day_recommended smallint check (draft_day_recommended is null or draft_day_recommended between 1 and 28),
  draft_day_override_reason text check (draft_day_override_reason is null or char_length(draft_day_override_reason) <= 500),
  draft_day_overridden_by uuid references public.users(id) on delete set null,
  draft_day_overridden_at timestamptz,
  key_version smallint,
  linked_to_primary boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  -- Card data belongs to card methods, bank data to ACH, and neither to direct bill: a card number
  -- in the account-number field is the corruption LA-3.19 exists to prevent.
  constraint payment_ach_only_bank check (method = 'ach' or (routing_ciphertext is null and account_ciphertext is null)),
  constraint payment_card_only_card check (method in ('direct_express', 'debit_card', 'credit_card') or card_ciphertext is null),
  constraint payment_bill_only_frequency check (method = 'direct_bill' or billing_frequency is null),
  constraint payment_cipher_versioned check ((routing_ciphertext is null and account_ciphertext is null and card_ciphertext is null) or key_version is not null)
);
create index if not exists tenant_application_payment_methods_tenant_idx on public.tenant_application_payment_methods (tenant_id);

alter table public.tenant_application_payment_methods enable row level security;
drop policy if exists tenant_application_payment_methods_tenant_scoped on public.tenant_application_payment_methods;
create policy tenant_application_payment_methods_tenant_scoped on public.tenant_application_payment_methods
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select (application_id, tenant_id, method, routing_last4, account_last4, account_type, bank_name, name_on_account,
              card_last4, card_exp_month, card_exp_year, card_brand, name_on_card, billing_frequency,
              billing_address_same_as_insured, draft_income_type, draft_income_inputs, draft_day_recommended,
              draft_day_override_reason, linked_to_primary, updated_at)
  on public.tenant_application_payment_methods to tenant_app;
grant select, insert, update, delete on public.tenant_application_payment_methods to service_role;

-- ── 5 · every look at a sensitive value ─────────────────────────────────────
create table if not exists public.tenant_sensitive_access_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  application_id uuid references public.tenant_applications(id) on delete set null,
  field_key text not null,
  action text not null check (action in ('reveal', 'extension_read', 'copy')),
  surface text not null check (surface in ('web', 'extension', 'copy_assist')),
  at timestamptz not null default now(),
  ip inet
);
create index if not exists tenant_sensitive_access_log_app_idx on public.tenant_sensitive_access_log (tenant_id, application_id, at desc);

alter table public.tenant_sensitive_access_log enable row level security;
drop policy if exists tenant_sensitive_access_log_tenant_scoped on public.tenant_sensitive_access_log;
create policy tenant_sensitive_access_log_tenant_scoped on public.tenant_sensitive_access_log
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_sensitive_access_log to tenant_app;
-- Append-only: nobody updates or deletes an access record.
grant select, insert on public.tenant_sensitive_access_log to service_role;
revoke update, delete, truncate on public.tenant_sensitive_access_log from service_role, tenant_app;

-- ── 6 · updated_at ──────────────────────────────────────────────────────────
create or replace function public.la3_touch_updated_at()
returns trigger language plpgsql as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists tenant_applications_touch on public.tenant_applications;
create trigger tenant_applications_touch before update on public.tenant_applications
  for each row execute function public.la3_touch_updated_at();
drop trigger if exists tenant_application_values_touch on public.tenant_application_values;
create trigger tenant_application_values_touch before update on public.tenant_application_values
  for each row execute function public.la3_touch_updated_at();
drop trigger if exists tenant_application_payment_methods_touch on public.tenant_application_payment_methods;
create trigger tenant_application_payment_methods_touch before update on public.tenant_application_payment_methods
  for each row execute function public.la3_touch_updated_at();

-- ── 7 · the only writer of status and outcome (STATUS-MODEL §4) ─────────────
--
-- The QA guard for `ready` and `submitted` is evaluated by the service (lib/applications/qa.ts)
-- before it calls this; this function owns the graph, so no route can invent a transition.
create or replace function public.application_transition(
  p_tenant_id uuid,
  p_application_id uuid,
  p_actor uuid,
  p_to text,
  p_outcome text default null,
  p_reason_code text default null,
  p_reason_text text default null
)
returns table(application_id uuid, status text, outcome text, case_status text)
language plpgsql
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  a record;
  v_ok boolean;
  v_case_status text;
begin
  select * into a from tenant_applications t
   where t.id = p_application_id and t.tenant_id = p_tenant_id
   for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;
  if a.status = 'closed' then raise exception 'APPLICATION_CLOSED'; end if;

  v_ok := case
    when p_to = 'ready'                then a.status = 'draft'
    when p_to = 'draft'                then a.status = 'ready'
    when p_to = 'submitted'            then a.status = 'ready'
    when p_to = 'pending_carrier'      then a.status in ('submitted', 'counteroffer_pending')
    when p_to = 'counteroffer_pending' then a.status in ('submitted', 'pending_carrier')
    when p_to = 'closed' then case p_outcome
      when 'issued'             then a.status in ('submitted', 'pending_carrier')
      when 'declined'           then a.status in ('submitted', 'pending_carrier')
      when 'postponed'          then a.status in ('submitted', 'pending_carrier')
      when 'declined_by_client' then a.status = 'counteroffer_pending'
      when 'offer_expired'      then a.status = 'counteroffer_pending'
      when 'withdrawn'          then true
      else false end
    else false
  end;
  if not v_ok then raise exception 'APPLICATION_TRANSITION_INVALID'; end if;
  if p_to = 'closed' and p_outcome in ('declined', 'postponed', 'withdrawn') and nullif(btrim(coalesce(p_reason_code, '')), '') is null then
    raise exception 'APPLICATION_OUTCOME_REASON_REQUIRED';
  end if;

  update tenant_applications t set
    status = p_to,
    outcome = case when p_to = 'closed' then p_outcome else null end,
    outcome_reason_code = case when p_to = 'closed' then p_reason_code else null end,
    outcome_reason_text = case when p_to = 'closed' then nullif(btrim(coalesce(p_reason_text, '')), '') else null end,
    outcome_recorded_at = case when p_to = 'closed' then now() else null end,
    outcome_recorded_by = case when p_to = 'closed' then p_actor else null end,
    submitted_at = case when p_to = 'submitted' then now() else t.submitted_at end,
    closed_at = case when p_to = 'closed' then now() else null end
   where t.id = a.id;

  -- The case is won once an attempt is issued and neither insured has a live attempt left (Q4).
  select c.status into v_case_status from tenant_application_cases c where c.id = a.case_id for update;
  if v_case_status = 'open'
     and exists (select 1 from tenant_applications x where x.case_id = a.case_id and x.outcome = 'issued')
     and not exists (select 1 from tenant_applications x where x.case_id = a.case_id and x.status <> 'closed') then
    update tenant_application_cases set status = 'won', closed_at = now(), closed_by = p_actor, updated_at = now()
     where id = a.case_id;
    v_case_status := 'won';
  end if;

  return query select a.id, p_to, case when p_to = 'closed' then p_outcome else null end, v_case_status;
end;
$function$;

revoke all on function public.application_transition(uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.application_transition(uuid, uuid, uuid, text, text, text, text) to service_role;

-- ── 8 · checks ──────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_application_cases_status_check'
                  and pg_get_constraintdef(oid) like '%''won''%' and pg_get_constraintdef(oid) like '%''abandoned''%') then
    raise exception '20260926100000: the case status check lost won or a legacy value';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public'
                and table_name in ('tenant_application_payment_methods', 'tenant_application_values')
                and column_name ~* '(cvv|cvc|security_code)') then
    raise exception '20260926100000: a card security code column exists';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'tenant_applications_one_live_idx') then
    raise exception '20260926100000: one live attempt per insured is not enforced';
  end if;
  if (select count(*) from public.features where feature_key in ('ai_assistant', 'carrier_extension', 'sales_report')) <> 3 then
    raise exception '20260926100000: the three LA-3 feature flags are missing';
  end if;
  if has_function_privilege('tenant_app', 'public.application_transition(uuid, uuid, uuid, text, text, text, text)', 'execute') then
    raise exception '20260926100000: application_transition is callable by tenant_app';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260926100000', 'la_3_7_application_record') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [3/23] 20260926100100_la_3_1_sales_templates.sql ─────────────────────────────
begin;

-- LA-3 step 2 — sales templates: underwriting (LA-3.1), quotation (LA-3.4), application field sets (LA-3.7).
--
-- docs/la3/SCHEMA-PLAN.md "Step 2", the note "Revised 2026-09-28", is the specification. In short:
--
--   sales_templates   NEW   a registry beside LA-1.4's templates, never a second engine
--   4 platform rows   SEED  FE general intake, Term Life standard, FE generic quotation, FE field set
--
-- `templates` / `tenant_templates` and every function that writes them are NOT touched: replacing
-- their UNIQUE (tenant_id, product_code) would break the three live `on conflict (tenant_id,
-- product_code)` targets (admin template apply among them). The definition is exactly LA-1.4's
-- {fields: TemplateField[], form_definition: TemplateFormDefinition} shape, validated by Zod in the
-- app, plus `age_basis` for quotation and `required` / `optional` for a field set. Knockouts
-- (`is_knockout`, `knockout_when`, `knockout_note`) sit on the form fields beside `show_when`;
-- the five persistency questions carry `"persistency": true` on their field.
--
-- A published (or retired) row is immutable: editing makes version N + 1. Draft rows are editable.
--
-- Down (only while nothing references a row — tenant_uw_interviews and tenant_quotes point here):
--   drop table public.sales_templates;
--   drop function public.sales_templates_guard_published();

-- ── 1 · the registry ────────────────────────────────────────────────────────
create table if not exists public.sales_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('underwriting', 'quotation', 'application_field_set')),
  product_code text not null references public.products(code) on delete restrict,
  carrier_id uuid references public.carriers(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  version integer not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  definition jsonb not null default '{}'::jsonb check (jsonb_typeof(definition) = 'object'),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  constraint sales_templates_published_dated check (status = 'draft' or published_at is not null)
);

create unique index if not exists sales_templates_version_unique
  on public.sales_templates (
    coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    kind,
    product_code,
    coalesce(carrier_id, '00000000-0000-0000-0000-000000000000'::uuid),
    version
  );
create index if not exists sales_templates_lookup_idx
  on public.sales_templates (tenant_id, kind, product_code, status);
create index if not exists sales_templates_carrier_idx
  on public.sales_templates (carrier_id) where carrier_id is not null;

-- Platform rows (tenant_id null) are readable by every tenant; a tenant writes only its own rows.
alter table public.sales_templates enable row level security;
drop policy if exists sales_templates_tenant_read on public.sales_templates;
create policy sales_templates_tenant_read on public.sales_templates
  for select to tenant_app
  using (tenant_id is null or tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists sales_templates_tenant_scoped on public.sales_templates;
create policy sales_templates_tenant_scoped on public.sales_templates
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.sales_templates to tenant_app;
grant select, insert, update, delete on public.sales_templates to service_role;

-- ── 2 · published rows are immutable ────────────────────────────────────────
--
-- Allowed on a published row: published → retired (status and updated_at only). Nothing on a
-- retired row changes, and neither can be deleted — an interview or quote records the version it
-- was taken on, so the version it names has to stay what it was.
create or replace function public.sales_templates_guard_published()
returns trigger language plpgsql as $function$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'SALES_TEMPLATE_PUBLISHED_IMMUTABLE: % v% is %, it cannot be deleted', old.name, old.version, old.status;
    end if;
    return old;
  end if;

  if old.status in ('published', 'retired') then
    if new.definition is distinct from old.definition
       or (new.tenant_id, new.kind, new.product_code, new.carrier_id, new.version, new.name, new.published_at)
          is distinct from (old.tenant_id, old.kind, old.product_code, old.carrier_id, old.version, old.name, old.published_at) then
      raise exception 'SALES_TEMPLATE_PUBLISHED_IMMUTABLE: % v% is %; edit a new version instead', old.name, old.version, old.status;
    end if;
    if new.status is distinct from old.status and not (old.status = 'published' and new.status = 'retired') then
      raise exception 'SALES_TEMPLATE_PUBLISHED_IMMUTABLE: % v% cannot go from % to %', old.name, old.version, old.status, new.status;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists sales_templates_guard_published on public.sales_templates;
create trigger sales_templates_guard_published before update or delete on public.sales_templates
  for each row execute function public.sales_templates_guard_published();
drop trigger if exists sales_templates_touch on public.sales_templates;
create trigger sales_templates_touch before update on public.sales_templates
  for each row execute function public.la3_touch_updated_at();

-- ── 3 · seed: platform defaults, published, version 1 ───────────────────────

-- (a) Final Expense — general intake (underwriting). The five persistency questions first, then
-- health with knockouts and follow-ups, medications, notes. `existing_cash_value` is the follow-up
-- the 1035_EXCHANGE disclosure rule reads (20260926100600).
insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'underwriting', p.code, null, 'Final Expense — general intake', 1, 'published', $def${
  "fields": [
    {"field_key": "ss_deposit_day", "label": "When does your Social Security arrive?", "type": "single_select", "is_required": true,
     "options": ["2nd Wednesday", "3rd Wednesday", "4th Wednesday", "The 3rd", "The 1st (SSI)", "Not on Social Security"],
     "sort_order": 10, "help_text": "Sets the draft date — the biggest lever on month-4 lapse.", "persistency": true},
    {"field_key": "deposit_account", "label": "Is the account you'll pay from the one it lands in?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 20, "help_text": null, "persistency": true},
    {"field_key": "decision_maker", "label": "Does anyone else need to be on this call?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 30, "help_text": null, "persistency": true},
    {"field_key": "existing_coverage", "label": "Do you have any life insurance now?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 40, "help_text": "A yes brings up the replacement notice.", "persistency": true},
    {"field_key": "existing_cash_value", "label": "Does that policy have a cash value you plan to move to the new one?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 45, "help_text": "A yes brings up the 1035 exchange form."},
    {"field_key": "can_receive_text", "label": "Can you get a text or email without hanging up?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 50, "help_text": null, "persistency": true},
    {"field_key": "oxygen", "label": "In the last 2 years, have you used oxygen equipment?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 100, "help_text": null},
    {"field_key": "dialysis", "label": "Are you on kidney dialysis?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 110, "help_text": null},
    {"field_key": "cancer", "label": "Have you been diagnosed with or treated for cancer in the last 3 years?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 120, "help_text": null},
    {"field_key": "cancer_when", "label": "When was it diagnosed?", "type": "date", "is_required": false,
     "options": [], "sort_order": 121, "help_text": null},
    {"field_key": "cancer_type", "label": "What type?", "type": "text", "is_required": false,
     "options": [], "sort_order": 122, "help_text": null},
    {"field_key": "heart", "label": "Have you had heart failure, a heart attack or heart surgery in the last 2 years?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 130, "help_text": null},
    {"field_key": "diabetes", "label": "Do you have diabetes?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 140, "help_text": null},
    {"field_key": "diabetes_insulin", "label": "Do you use insulin?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 141, "help_text": null},
    {"field_key": "medications", "label": "Medications", "type": "medication_list", "is_required": false,
     "options": [], "sort_order": 200, "help_text": "Name, dose, since when and what it is for."},
    {"field_key": "notes", "label": "Anything else the carrier should know", "type": "long_text", "is_required": false,
     "options": [], "sort_order": 300, "help_text": null}
  ],
  "form_definition": {"sections": [
    {"section_key": "before", "label": "Before we start", "sort_order": 10, "fields": [
      {"field_key": "ss_deposit_day", "is_required": true, "show_when": null},
      {"field_key": "deposit_account", "is_required": true, "show_when": null},
      {"field_key": "decision_maker", "is_required": false, "show_when": null},
      {"field_key": "existing_coverage", "is_required": true, "show_when": null},
      {"field_key": "existing_cash_value", "is_required": false, "show_when": {"field_key": "existing_coverage", "equals": "true"}},
      {"field_key": "can_receive_text", "is_required": false, "show_when": null}
    ]},
    {"section_key": "health", "label": "Health", "sort_order": 20, "fields": [
      {"field_key": "oxygen", "is_required": true, "show_when": null,
       "is_knockout": true, "knockout_when": {"equals": "true"}, "knockout_note": "Most carriers decline oxygen use in the last 2 years or offer guaranteed issue only."},
      {"field_key": "dialysis", "is_required": true, "show_when": null,
       "is_knockout": true, "knockout_when": {"equals": "true"}, "knockout_note": "Most carriers decline applicants on dialysis; guaranteed issue only."},
      {"field_key": "cancer", "is_required": true, "show_when": null},
      {"field_key": "cancer_when", "is_required": false, "show_when": {"field_key": "cancer", "equals": "true"}},
      {"field_key": "cancer_type", "is_required": false, "show_when": {"field_key": "cancer", "equals": "true"}},
      {"field_key": "heart", "is_required": true, "show_when": null},
      {"field_key": "diabetes", "is_required": true, "show_when": null},
      {"field_key": "diabetes_insulin", "is_required": false, "show_when": {"field_key": "diabetes", "equals": "true"}}
    ]},
    {"section_key": "medications", "label": "Medications", "sort_order": 30, "fields": [
      {"field_key": "medications", "is_required": false, "show_when": null}
    ]},
    {"section_key": "notes", "label": "Notes", "sort_order": 40, "fields": [
      {"field_key": "notes", "is_required": false, "show_when": null}
    ]}
  ]}
}$def$::jsonb, now()
  from public.products p
 where p.code = 'final_expense'
on conflict do nothing;

-- (b) Term Life — standard (underwriting): build chart, driving, aviation and avocations, travel,
-- family history before 60, financial justification, and the same five persistency questions.
insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'underwriting', p.code, null, 'Term Life — standard', 1, 'published', $def${
  "fields": [
    {"field_key": "ss_deposit_day", "label": "When does your Social Security arrive?", "type": "single_select", "is_required": true,
     "options": ["2nd Wednesday", "3rd Wednesday", "4th Wednesday", "The 3rd", "The 1st (SSI)", "Not on Social Security"],
     "sort_order": 10, "help_text": "Sets the draft date — the biggest lever on month-4 lapse.", "persistency": true},
    {"field_key": "deposit_account", "label": "Is the account you'll pay from the one it lands in?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 20, "help_text": null, "persistency": true},
    {"field_key": "decision_maker", "label": "Does anyone else need to be on this call?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 30, "help_text": null, "persistency": true},
    {"field_key": "existing_coverage", "label": "Do you have any life insurance now?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 40, "help_text": "A yes brings up the replacement notice.", "persistency": true},
    {"field_key": "existing_cash_value", "label": "Does that policy have a cash value you plan to move to the new one?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 45, "help_text": "A yes brings up the 1035 exchange form."},
    {"field_key": "can_receive_text", "label": "Can you get a text or email without hanging up?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 50, "help_text": null, "persistency": true},
    {"field_key": "height_in", "label": "Height (inches)", "type": "number", "is_required": true,
     "options": [], "sort_order": 100, "help_text": "Read against the carrier's build chart."},
    {"field_key": "weight_lb", "label": "Weight (pounds)", "type": "number", "is_required": true,
     "options": [], "sort_order": 110, "help_text": "Read against the carrier's build chart."},
    {"field_key": "weight_change", "label": "Have you gained or lost more than 20 pounds in the last 12 months?", "type": "boolean", "is_required": false,
     "options": [], "sort_order": 120, "help_text": null},
    {"field_key": "driving_dui", "label": "Any DUI or DWI in the last 5 years?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 200, "help_text": null},
    {"field_key": "driving_violations", "label": "How many moving violations in the last 3 years?", "type": "number", "is_required": true,
     "options": [], "sort_order": 210, "help_text": null},
    {"field_key": "driving_suspended", "label": "Has your driver's license been suspended or revoked in the last 5 years?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 220, "help_text": null},
    {"field_key": "aviation", "label": "Do you fly as a pilot, student pilot or crew member (other than as a fare-paying passenger)?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 300, "help_text": null},
    {"field_key": "aviation_details", "label": "Aircraft, hours flown per year and certificates held", "type": "long_text", "is_required": false,
     "options": [], "sort_order": 301, "help_text": null},
    {"field_key": "hazardous_avocations", "label": "Do you take part in scuba diving, skydiving, climbing, motor racing or other hazardous activities?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 310, "help_text": null},
    {"field_key": "hazardous_avocations_details", "label": "Which activities, and how often?", "type": "long_text", "is_required": false,
     "options": [], "sort_order": 311, "help_text": null},
    {"field_key": "foreign_travel", "label": "Do you plan to travel or live outside the United States in the next 2 years?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 320, "help_text": null},
    {"field_key": "foreign_travel_details", "label": "Where, and for how long?", "type": "long_text", "is_required": false,
     "options": [], "sort_order": 321, "help_text": null},
    {"field_key": "family_cardiac_before_60", "label": "Has a parent or sibling died of, or been diagnosed with, heart disease before age 60?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 400, "help_text": null},
    {"field_key": "family_cancer_before_60", "label": "Has a parent or sibling died of, or been diagnosed with, cancer before age 60?", "type": "boolean", "is_required": true,
     "options": [], "sort_order": 410, "help_text": null},
    {"field_key": "annual_income", "label": "Annual earned income", "type": "currency", "is_required": true,
     "options": [], "sort_order": 500, "help_text": "Carriers cap face amount at a multiple of income."},
    {"field_key": "net_worth", "label": "Household net worth", "type": "currency", "is_required": false,
     "options": [], "sort_order": 510, "help_text": null},
    {"field_key": "coverage_purpose", "label": "What is the coverage for?", "type": "single_select", "is_required": true,
     "options": ["Income replacement", "Mortgage protection", "Debt payoff", "Final expenses", "Business or key person", "Estate planning"],
     "sort_order": 520, "help_text": null},
    {"field_key": "medications", "label": "Medications", "type": "medication_list", "is_required": false,
     "options": [], "sort_order": 600, "help_text": "Name, dose, since when and what it is for."},
    {"field_key": "notes", "label": "Anything else the carrier should know", "type": "long_text", "is_required": false,
     "options": [], "sort_order": 700, "help_text": null}
  ],
  "form_definition": {"sections": [
    {"section_key": "before", "label": "Before we start", "sort_order": 10, "fields": [
      {"field_key": "ss_deposit_day", "is_required": true, "show_when": null},
      {"field_key": "deposit_account", "is_required": true, "show_when": null},
      {"field_key": "decision_maker", "is_required": false, "show_when": null},
      {"field_key": "existing_coverage", "is_required": true, "show_when": null},
      {"field_key": "existing_cash_value", "is_required": false, "show_when": {"field_key": "existing_coverage", "equals": "true"}},
      {"field_key": "can_receive_text", "is_required": false, "show_when": null}
    ]},
    {"section_key": "build", "label": "Height and weight", "sort_order": 20, "fields": [
      {"field_key": "height_in", "is_required": true, "show_when": null},
      {"field_key": "weight_lb", "is_required": true, "show_when": null},
      {"field_key": "weight_change", "is_required": false, "show_when": null}
    ]},
    {"section_key": "driving", "label": "Driving record", "sort_order": 30, "fields": [
      {"field_key": "driving_dui", "is_required": true, "show_when": null},
      {"field_key": "driving_violations", "is_required": true, "show_when": null},
      {"field_key": "driving_suspended", "is_required": true, "show_when": null}
    ]},
    {"section_key": "lifestyle", "label": "Aviation, avocations and travel", "sort_order": 40, "fields": [
      {"field_key": "aviation", "is_required": true, "show_when": null},
      {"field_key": "aviation_details", "is_required": false, "show_when": {"field_key": "aviation", "equals": "true"}},
      {"field_key": "hazardous_avocations", "is_required": true, "show_when": null},
      {"field_key": "hazardous_avocations_details", "is_required": false, "show_when": {"field_key": "hazardous_avocations", "equals": "true"}},
      {"field_key": "foreign_travel", "is_required": true, "show_when": null},
      {"field_key": "foreign_travel_details", "is_required": false, "show_when": {"field_key": "foreign_travel", "equals": "true"}}
    ]},
    {"section_key": "family", "label": "Family history", "sort_order": 50, "fields": [
      {"field_key": "family_cardiac_before_60", "is_required": true, "show_when": null},
      {"field_key": "family_cancer_before_60", "is_required": true, "show_when": null}
    ]},
    {"section_key": "financial", "label": "Financial justification", "sort_order": 60, "fields": [
      {"field_key": "annual_income", "is_required": true, "show_when": null},
      {"field_key": "net_worth", "is_required": false, "show_when": null},
      {"field_key": "coverage_purpose", "is_required": true, "show_when": null}
    ]},
    {"section_key": "medications", "label": "Medications", "sort_order": 70, "fields": [
      {"field_key": "medications", "is_required": false, "show_when": null}
    ]},
    {"section_key": "notes", "label": "Notes", "sort_order": 80, "fields": [
      {"field_key": "notes", "is_required": false, "show_when": null}
    ]}
  ]}
}$def$::jsonb, now()
  from public.products p
 where p.code = 'term_life'
on conflict do nothing;

-- (c) Final Expense — generic quotation, no carrier. Face amount is currency, held in cents.
insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'quotation', p.code, null, 'Final Expense — generic', 1, 'published', $def${
  "age_basis": "nearest",
  "fields": [
    {"field_key": "dob", "label": "Date of birth", "type": "date", "is_required": true, "options": [], "sort_order": 10, "help_text": null},
    {"field_key": "gender", "label": "Gender", "type": "single_select", "is_required": true, "options": ["Male", "Female"], "sort_order": 20, "help_text": null},
    {"field_key": "state", "label": "State", "type": "single_select", "is_required": true,
     "options": ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"],
     "sort_order": 30, "help_text": null},
    {"field_key": "tobacco", "label": "Tobacco or nicotine in the last 12 months", "type": "boolean", "is_required": true, "options": [], "sort_order": 40, "help_text": null},
    {"field_key": "face_amount", "label": "Face amount", "type": "currency", "is_required": true, "options": [], "sort_order": 50, "help_text": null},
    {"field_key": "tier", "label": "Tier", "type": "single_select", "is_required": true, "options": ["level", "graded", "modified", "gi"], "sort_order": 60, "help_text": null},
    {"field_key": "riders", "label": "Riders", "type": "multi_select", "is_required": false,
     "options": ["Accidental death", "Child rider", "Grandchild rider", "Terminal illness", "Waiver of premium"], "sort_order": 70, "help_text": null}
  ],
  "form_definition": {"sections": [
    {"section_key": "quote", "label": "Quote", "sort_order": 10, "fields": [
      {"field_key": "dob", "is_required": true, "show_when": null},
      {"field_key": "gender", "is_required": true, "show_when": null},
      {"field_key": "state", "is_required": true, "show_when": null},
      {"field_key": "tobacco", "is_required": true, "show_when": null},
      {"field_key": "face_amount", "is_required": true, "show_when": null},
      {"field_key": "tier", "is_required": true, "show_when": null},
      {"field_key": "riders", "is_required": false, "show_when": null}
    ]}
  ]}
}$def$::jsonb, now()
  from public.products p
 where p.code = 'final_expense'
on conflict do nothing;

-- (d) Final Expense — platform default application field set: canonical keys (LA-3.7).
insert into public.sales_templates (tenant_id, kind, product_code, carrier_id, name, version, status, definition, published_at)
select null, 'application_field_set', p.code, null, 'Final Expense — platform default', 1, 'published', $def${
  "required": ["insured.first_name", "insured.last_name", "insured.dob", "insured.gender", "insured.ssn", "insured.height_in",
               "insured.weight_lb", "insured.tobacco", "contact.phone", "addr.line1", "addr.city", "addr.state", "addr.zip"],
  "optional": ["insured.middle_initial", "insured.birth_state", "contact.email", "addr.line2", "addr.years_at",
               "owner.same_as_insured", "owner.first_name", "owner.last_name", "owner.dob", "owner.relationship"]
}$def$::jsonb, now()
  from public.products p
 where p.code = 'final_expense'
on conflict do nothing;

-- ── 4 · checks ──────────────────────────────────────────────────────────────
do $$
declare
  v_id uuid;
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'sales_templates_version_unique') then
    raise exception '20260926100100: one row per (tenant, kind, product, carrier, version) is not enforced';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'sales_templates_guard_published' and not tgisinternal) then
    raise exception '20260926100100: published sales templates are not guarded';
  end if;
  if (select count(*) from public.sales_templates
       where tenant_id is null and status = 'published' and version = 1
         and (kind, product_code, name) in (('underwriting', 'final_expense', 'Final Expense — general intake'),
                                             ('underwriting', 'term_life', 'Term Life — standard'),
                                             ('quotation', 'final_expense', 'Final Expense — generic'),
                                             ('application_field_set', 'final_expense', 'Final Expense — platform default'))) <> 4 then
    raise exception '20260926100100: the four platform sales templates are missing';
  end if;
  if exists (select 1 from public.sales_templates t
              where t.tenant_id is null and t.kind = 'underwriting' and t.version = 1
                and (select count(*) from jsonb_array_elements(t.definition->'fields') f
                      where f->>'persistency' = 'true'
                        and f->>'field_key' in ('ss_deposit_day', 'deposit_account', 'decision_maker', 'existing_coverage', 'can_receive_text')) <> 5) then
    raise exception '20260926100100: a platform underwriting template lacks the five persistency questions';
  end if;
  if (select definition->>'age_basis' from public.sales_templates
       where tenant_id is null and kind = 'quotation' and product_code = 'final_expense' and version = 1) is distinct from 'nearest' then
    raise exception '20260926100100: the FE quotation template has no nearest-age basis';
  end if;

  -- A published definition cannot be edited (the update is rolled back with the sub-block).
  select id into v_id from public.sales_templates where tenant_id is null and status = 'published' limit 1;
  begin
    update public.sales_templates set definition = definition || '{"probe": true}'::jsonb where id = v_id;
    raise exception '20260926100100: a published sales template was edited';
  exception when others then
    if sqlerrm not like 'SALES_TEMPLATE_PUBLISHED_IMMUTABLE%' then raise; end if;
  end;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260926100100', 'la_3_1_sales_templates') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [4/23] 20260926100200_la_3_2_interview.sql ───────────────────────────────────
begin;

-- LA-3 step 3 — the underwriting interview and medications (LA-3.2).
--
-- docs/la3/SCHEMA-PLAN.md "Step 3" is the specification. In short:
--
--   tenant_uw_interviews      NEW  one per insured per CASE, so it carries across attempts uncopied
--   tenant_uw_answers         NEW  one row per question; hidden follow-ups are pruned on save
--   tenant_uw_answer_changes  NEW  post-call amend audit, append-only
--   tenant_medications        NEW  the medication list, "prescribed for: unknown" is explicit
--   medication_names          NEW  platform autocomplete list (generic names), free entry always allowed
--
-- The interview points at sales_templates (20260926100100) — the Revised Step 2 registry — and
-- records the version it was taken on. Step 11 freezes answers and medications onto the submission
-- row, because the interview is shared by every attempt on the case.
--
-- Down (only while no row exists in the new tables):
--   drop table public.tenant_medications, public.tenant_uw_answer_changes, public.tenant_uw_answers,
--              public.tenant_uw_interviews, public.medication_names;

-- ── 1 · the interview ───────────────────────────────────────────────────────
create table if not exists public.tenant_uw_interviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  case_id uuid not null references public.tenant_application_cases(id) on delete cascade,
  insured_role text not null default 'primary' check (insured_role in ('primary', 'spouse')),
  sales_template_id uuid not null references public.sales_templates(id) on delete restrict,
  template_version integer not null check (template_version > 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  started_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint tenant_uw_interviews_one_per_insured unique (case_id, insured_role),
  constraint tenant_uw_interviews_completed_after_start check (completed_at is null or completed_at >= started_at)
);
create index if not exists tenant_uw_interviews_tenant_idx on public.tenant_uw_interviews (tenant_id, case_id);
create index if not exists tenant_uw_interviews_template_idx on public.tenant_uw_interviews (sales_template_id);

alter table public.tenant_uw_interviews enable row level security;
drop policy if exists tenant_uw_interviews_tenant_scoped on public.tenant_uw_interviews;
create policy tenant_uw_interviews_tenant_scoped on public.tenant_uw_interviews
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_uw_interviews to tenant_app;
grant select, insert, update on public.tenant_uw_interviews to service_role;

-- ── 2 · answers ─────────────────────────────────────────────────────────────
create table if not exists public.tenant_uw_answers (
  interview_id uuid not null references public.tenant_uw_interviews(id) on delete cascade,
  question_key text not null check (question_key ~ '^[a-z][a-z0-9_]*$'),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  value jsonb,
  notes text check (notes is null or char_length(notes) <= 2000),
  answered_at timestamptz not null default now(),
  answered_by uuid references public.users(id) on delete set null,
  primary key (interview_id, question_key)
);
create index if not exists tenant_uw_answers_tenant_idx on public.tenant_uw_answers (tenant_id);

alter table public.tenant_uw_answers enable row level security;
drop policy if exists tenant_uw_answers_tenant_scoped on public.tenant_uw_answers;
create policy tenant_uw_answers_tenant_scoped on public.tenant_uw_answers
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_uw_answers to tenant_app;
-- delete: a hidden follow-up's value is removed on save (pruneHiddenTemplateValues).
grant select, insert, update, delete on public.tenant_uw_answers to service_role;

-- ── 3 · post-call amendments (written only once completed_at is set) ────────
create table if not exists public.tenant_uw_answer_changes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  interview_id uuid not null references public.tenant_uw_interviews(id) on delete cascade,
  question_key text not null check (question_key ~ '^[a-z][a-z0-9_]*$'),
  old_value jsonb,
  new_value jsonb,
  changed_by uuid references public.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  reason text check (reason is null or char_length(reason) <= 500)
);
create index if not exists tenant_uw_answer_changes_interview_idx on public.tenant_uw_answer_changes (interview_id, changed_at desc);
create index if not exists tenant_uw_answer_changes_tenant_idx on public.tenant_uw_answer_changes (tenant_id);

alter table public.tenant_uw_answer_changes enable row level security;
drop policy if exists tenant_uw_answer_changes_tenant_scoped on public.tenant_uw_answer_changes;
create policy tenant_uw_answer_changes_tenant_scoped on public.tenant_uw_answer_changes
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_uw_answer_changes to tenant_app;
-- Append-only, like tenant_sensitive_access_log.
grant select, insert on public.tenant_uw_answer_changes to service_role;
revoke update, delete, truncate on public.tenant_uw_answer_changes from service_role, tenant_app, anon, authenticated;

-- ── 4 · medications ─────────────────────────────────────────────────────────
create table if not exists public.tenant_medications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  interview_id uuid not null references public.tenant_uw_interviews(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  dose text check (dose is null or char_length(dose) <= 100),
  since text check (since is null or char_length(since) <= 40),
  prescribed_for text check (prescribed_for is null or char_length(prescribed_for) <= 200),
  prescribed_for_unknown boolean not null default false,
  notes text check (notes is null or char_length(notes) <= 1000),
  sort_order integer not null default 0,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- "Unknown" is an answer, not a blank: it cannot sit beside a stated reason.
  constraint tenant_medications_unknown_has_no_reason check (not prescribed_for_unknown or prescribed_for is null)
);
create index if not exists tenant_medications_interview_idx on public.tenant_medications (interview_id, sort_order);
create index if not exists tenant_medications_tenant_idx on public.tenant_medications (tenant_id);

alter table public.tenant_medications enable row level security;
drop policy if exists tenant_medications_tenant_scoped on public.tenant_medications;
create policy tenant_medications_tenant_scoped on public.tenant_medications
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_medications to tenant_app;
grant select, insert, update, delete on public.tenant_medications to service_role;

drop trigger if exists tenant_uw_interviews_touch on public.tenant_uw_interviews;
create trigger tenant_uw_interviews_touch before update on public.tenant_uw_interviews
  for each row execute function public.la3_touch_updated_at();
drop trigger if exists tenant_medications_touch on public.tenant_medications;
create trigger tenant_medications_touch before update on public.tenant_medications
  for each row execute function public.la3_touch_updated_at();

-- ── 5 · the autocomplete list (platform) ────────────────────────────────────
--
-- Generic names as RxNorm displays them (lowercase ingredient names; combinations joined by "/").
-- The app matches case-insensitively and always accepts free text — a name missing here is still
-- a valid answer.
create table if not exists public.medication_names (
  name text primary key check (char_length(btrim(name)) between 1 and 120 and name = btrim(name)),
  generic_of text check (generic_of is null or char_length(generic_of) <= 120),
  rxcui text check (rxcui is null or rxcui ~ '^[0-9]{1,10}$')
);
create unique index if not exists medication_names_lower_idx on public.medication_names (lower(name) text_pattern_ops);

alter table public.medication_names enable row level security;
drop policy if exists medication_names_service_role_only on public.medication_names;
create policy medication_names_service_role_only on public.medication_names
  for all to service_role using (true) with check (true);
drop policy if exists medication_names_tenant_read on public.medication_names;
create policy medication_names_tenant_read on public.medication_names
  for select to tenant_app using (true);
grant select on public.medication_names to tenant_app;
grant select, insert, update, delete on public.medication_names to service_role;

insert into public.medication_names (name) values
  -- cardiac and blood pressure
  ('lisinopril'), ('enalapril'), ('ramipril'), ('benazepril'), ('quinapril'), ('fosinopril'), ('captopril'),
  ('perindopril'), ('trandolapril'), ('moexipril'), ('losartan'), ('valsartan'), ('irbesartan'), ('olmesartan'),
  ('telmisartan'), ('candesartan'), ('azilsartan'), ('sacubitril/valsartan'), ('amlodipine'), ('nifedipine'),
  ('felodipine'), ('diltiazem'), ('verapamil'), ('metoprolol tartrate'), ('metoprolol succinate'), ('atenolol'),
  ('carvedilol'), ('bisoprolol'), ('propranolol'), ('nebivolol'), ('labetalol'), ('nadolol'), ('sotalol'),
  ('hydrochlorothiazide'), ('chlorthalidone'), ('indapamide'), ('furosemide'), ('bumetanide'), ('torsemide'),
  ('spironolactone'), ('eplerenone'), ('triamterene/hydrochlorothiazide'), ('amiloride'), ('metolazone'),
  ('clonidine'), ('hydralazine'), ('minoxidil'), ('methyldopa'), ('doxazosin'), ('terazosin'), ('prazosin'),
  ('isosorbide mononitrate'), ('isosorbide dinitrate'), ('nitroglycerin'), ('ranolazine'), ('digoxin'),
  ('amiodarone'), ('dronedarone'), ('flecainide'), ('propafenone'), ('dofetilide'), ('ivabradine'), ('midodrine'),
  -- anticoagulants and antiplatelets
  ('warfarin'), ('apixaban'), ('rivaroxaban'), ('dabigatran'), ('edoxaban'), ('enoxaparin'), ('heparin'),
  ('clopidogrel'), ('prasugrel'), ('ticagrelor'), ('aspirin'), ('cilostazol'), ('dipyridamole'), ('pentoxifylline'),
  -- lipids
  ('atorvastatin'), ('simvastatin'), ('rosuvastatin'), ('pravastatin'), ('lovastatin'), ('pitavastatin'),
  ('ezetimibe'), ('fenofibrate'), ('gemfibrozil'), ('niacin'), ('icosapent ethyl'), ('omega-3-acid ethyl esters'),
  ('colesevelam'), ('evolocumab'), ('alirocumab'), ('bempedoic acid'),
  -- diabetes
  ('metformin'), ('glipizide'), ('glyburide'), ('glimepiride'), ('pioglitazone'), ('sitagliptin'), ('linagliptin'),
  ('saxagliptin'), ('alogliptin'), ('empagliflozin'), ('dapagliflozin'), ('canagliflozin'), ('ertugliflozin'),
  ('liraglutide'), ('semaglutide'), ('dulaglutide'), ('exenatide'), ('tirzepatide'), ('insulin glargine'),
  ('insulin detemir'), ('insulin degludec'), ('insulin lispro'), ('insulin aspart'), ('insulin glulisine'),
  ('insulin regular'), ('insulin isophane'), ('repaglinide'), ('nateglinide'), ('acarbose'),
  -- respiratory
  ('albuterol'), ('levalbuterol'), ('ipratropium'), ('tiotropium'), ('umeclidinium'), ('aclidinium'),
  ('salmeterol'), ('formoterol'), ('fluticasone'), ('fluticasone/salmeterol'), ('budesonide/formoterol'),
  ('fluticasone/umeclidinium/vilanterol'), ('budesonide'), ('mometasone'), ('beclomethasone'), ('ciclesonide'),
  ('montelukast'), ('theophylline'), ('roflumilast'), ('benzonatate'), ('guaifenesin'), ('cetirizine'),
  ('loratadine'), ('fexofenadine'), ('azelastine'), ('pirfenidone'), ('nintedanib'),
  -- pulmonary hypertension
  ('sildenafil'), ('tadalafil'), ('bosentan'), ('ambrisentan'), ('macitentan'), ('riociguat'),
  -- corticosteroids
  ('prednisone'), ('prednisolone'), ('methylprednisolone'), ('dexamethasone'), ('hydrocortisone'), ('fludrocortisone'),
  -- psychiatric
  ('sertraline'), ('fluoxetine'), ('paroxetine'), ('citalopram'), ('escitalopram'), ('fluvoxamine'),
  ('venlafaxine'), ('desvenlafaxine'), ('duloxetine'), ('bupropion'), ('mirtazapine'), ('trazodone'),
  ('amitriptyline'), ('nortriptyline'), ('imipramine'), ('doxepin'), ('vortioxetine'), ('vilazodone'),
  ('lithium'), ('quetiapine'), ('olanzapine'), ('risperidone'), ('aripiprazole'), ('ziprasidone'),
  ('haloperidol'), ('clozapine'), ('lurasidone'), ('paliperidone'), ('brexpiprazole'), ('cariprazine'),
  ('alprazolam'), ('lorazepam'), ('clonazepam'), ('diazepam'), ('temazepam'), ('buspirone'), ('hydroxyzine'),
  ('zolpidem'), ('eszopiclone'), ('methylphenidate'), ('dextroamphetamine/amphetamine'), ('atomoxetine'),
  ('naltrexone'), ('buprenorphine'), ('buprenorphine/naloxone'), ('disulfiram'), ('acamprosate'), ('varenicline'),
  -- neurological
  ('gabapentin'), ('pregabalin'), ('levetiracetam'), ('lamotrigine'), ('phenytoin'), ('carbamazepine'),
  ('oxcarbazepine'), ('divalproex sodium'), ('valproic acid'), ('topiramate'), ('lacosamide'), ('zonisamide'),
  ('phenobarbital'), ('primidone'), ('donepezil'), ('memantine'), ('rivastigmine'), ('galantamine'),
  ('carbidopa/levodopa'), ('pramipexole'), ('ropinirole'), ('rasagiline'), ('selegiline'), ('amantadine'),
  ('benztropine'), ('entacapone'), ('baclofen'), ('tizanidine'), ('cyclobenzaprine'), ('methocarbamol'),
  ('sumatriptan'), ('rizatriptan'), ('riluzole'), ('dalfampridine'), ('meclizine'),
  -- pain, gout and inflammation
  ('tramadol'), ('hydrocodone/acetaminophen'), ('oxycodone'), ('oxycodone/acetaminophen'), ('morphine'),
  ('hydromorphone'), ('fentanyl'), ('methadone'), ('tapentadol'), ('codeine'), ('acetaminophen'), ('ibuprofen'),
  ('naproxen'), ('meloxicam'), ('celecoxib'), ('diclofenac'), ('etodolac'), ('nabumetone'), ('indomethacin'),
  ('ketorolac'), ('lidocaine'), ('allopurinol'), ('febuxostat'), ('colchicine'), ('probenecid'), ('naloxone'),
  -- thyroid and hormones
  ('levothyroxine'), ('liothyronine'), ('thyroid'), ('methimazole'), ('propylthiouracil'), ('estradiol'),
  ('conjugated estrogens'), ('medroxyprogesterone'), ('progesterone'), ('testosterone'), ('desmopressin'),
  -- renal and urological
  ('sevelamer'), ('calcium acetate'), ('lanthanum carbonate'), ('cinacalcet'), ('calcitriol'), ('paricalcitol'),
  ('sodium bicarbonate'), ('epoetin alfa'), ('darbepoetin alfa'), ('ferric citrate'), ('patiromer'),
  ('sodium zirconium cyclosilicate'), ('sodium polystyrene sulfonate'), ('tamsulosin'), ('alfuzosin'),
  ('silodosin'), ('finasteride'), ('dutasteride'), ('oxybutynin'), ('tolterodine'), ('solifenacin'),
  ('mirabegron'), ('trospium'), ('bethanechol'),
  -- oncology and supportive care
  ('tamoxifen'), ('anastrozole'), ('letrozole'), ('exemestane'), ('leuprolide'), ('bicalutamide'),
  ('enzalutamide'), ('abiraterone'), ('capecitabine'), ('methotrexate'), ('hydroxyurea'), ('imatinib'),
  ('lenalidomide'), ('ibrutinib'), ('palbociclib'), ('cyclophosphamide'), ('pembrolizumab'), ('nivolumab'),
  ('trastuzumab'), ('rituximab'), ('megestrol'), ('ondansetron'), ('prochlorperazine'), ('promethazine'),
  ('filgrastim'), ('pegfilgrastim'),
  -- gastrointestinal and liver
  ('omeprazole'), ('esomeprazole'), ('pantoprazole'), ('lansoprazole'), ('rabeprazole'), ('dexlansoprazole'),
  ('famotidine'), ('sucralfate'), ('metoclopramide'), ('dicyclomine'), ('docusate'), ('sennosides'),
  ('polyethylene glycol 3350'), ('lactulose'), ('loperamide'), ('mesalamine'), ('rifaximin'), ('ursodiol'),
  ('linaclotide'), ('bisacodyl'),
  -- anti-infectives, HIV and hepatitis
  ('amoxicillin'), ('amoxicillin/clavulanate'), ('azithromycin'), ('ciprofloxacin'), ('levofloxacin'),
  ('doxycycline'), ('cephalexin'), ('sulfamethoxazole/trimethoprim'), ('nitrofurantoin'), ('metronidazole'),
  ('clindamycin'), ('valacyclovir'), ('acyclovir'), ('fluconazole'),
  ('bictegravir/emtricitabine/tenofovir alafenamide'), ('emtricitabine/tenofovir disoproxil fumarate'),
  ('dolutegravir'), ('sofosbuvir/velpatasvir'), ('entecavir'),
  -- immune and rheumatology
  ('hydroxychloroquine'), ('sulfasalazine'), ('leflunomide'), ('adalimumab'), ('etanercept'), ('infliximab'),
  ('tofacitinib'), ('tacrolimus'), ('mycophenolate mofetil'), ('cyclosporine'), ('azathioprine'),
  -- bone
  ('alendronate'), ('risedronate'), ('ibandronate'), ('zoledronic acid'), ('denosumab'), ('raloxifene'),
  ('teriparatide'),
  -- eye
  ('latanoprost'), ('timolol'), ('brimonidine'), ('dorzolamide'),
  -- vitamins, minerals and electrolytes
  ('cyanocobalamin'), ('folic acid'), ('ferrous sulfate'), ('potassium chloride'), ('magnesium oxide'),
  ('cholecalciferol'), ('ergocalciferol'), ('calcium carbonate'),
  -- smoking cessation
  ('nicotine')
on conflict do nothing;

-- ── 6 · checks ──────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_uw_interviews_one_per_insured' and contype = 'u') then
    raise exception '20260926100200: one interview per insured per case is not enforced';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_medications_unknown_has_no_reason' and contype = 'c') then
    raise exception '20260926100200: "prescribed for: unknown" can sit beside a stated reason';
  end if;
  if has_table_privilege('service_role', 'public.tenant_uw_answer_changes', 'UPDATE')
     or has_table_privilege('service_role', 'public.tenant_uw_answer_changes', 'DELETE') then
    raise exception '20260926100200: the amend audit is not append-only';
  end if;
  if (select count(*) from public.medication_names) < 300 then
    raise exception '20260926100200: the medication autocomplete list is short (% names)', (select count(*) from public.medication_names);
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260926100200', 'la_3_2_interview') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [5/23] 20260926100300_la_3_6_carrier_products.sql ────────────────────────────
begin;

-- LA-3 steps 4, 5 and 23 — appointments detail (LA-3.6), carrier products (LA-3.4) and the term-life
-- product columns (LA-3.25), in one file so no step re-migrates carrier_products.
--
-- docs/la3/SCHEMA-PLAN.md "Step 4", "Step 5" and "Step 23" are the specification. In short:
--
--   tenant_carriers     +2 columns  upline_name, notes (everything else in 3.6 already exists)
--   carriers            +3 columns  portal_origin (https origin), reference_pattern, billing_descriptor
--   carrier_products    NEW         platform rows (tenant_id null) plus tenant rows; FE and term limits
--   tenant_applications +FK         carrier_product_id → carrier_products (the column is from step 1)
--
-- The payout strip is computed from commission_schedules / advance_rules (Q7) — no table here.
-- premium_per_1000_band_* are numeric(6,2) dollars per $1,000 of face: a plausibility band, not money.
--
-- Down (only while no row exists in carrier_products):
--   alter table public.tenant_applications drop constraint tenant_applications_carrier_product_fkey;
--   drop table public.carrier_products;
--   alter table public.carriers drop column portal_origin, drop column reference_pattern, drop column billing_descriptor;
--   alter table public.tenant_carriers drop column upline_name, drop column notes;

-- ── 1 · appointments detail (3.6) ───────────────────────────────────────────
alter table public.tenant_carriers
  add column if not exists upline_name text check (upline_name is null or char_length(upline_name) <= 160),
  add column if not exists notes text check (notes is null or char_length(notes) <= 2000);

-- ── 2 · carrier portal facts (3.12, 3.15, 3.20) ─────────────────────────────
alter table public.carriers
  add column if not exists portal_origin text
    constraint carriers_portal_origin_https check (portal_origin is null or portal_origin ~ '^https://[^/]+$'),
  add column if not exists reference_pattern text
    constraint carriers_reference_pattern_length check (reference_pattern is null or char_length(reference_pattern) between 1 and 200),
  add column if not exists billing_descriptor text
    constraint carriers_billing_descriptor_length check (billing_descriptor is null or char_length(billing_descriptor) between 1 and 60);

-- ── 3 · carrier products ────────────────────────────────────────────────────
create table if not exists public.carrier_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  product_code text not null references public.products(code) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  tiers text[] not null default '{}'::text[]
    check (tiers <@ array['level', 'graded', 'modified', 'gi']::text[]),
  issue_age_min smallint check (issue_age_min is null or issue_age_min between 0 and 120),
  issue_age_max smallint check (issue_age_max is null or issue_age_max between 0 and 120),
  face_min_cents bigint check (face_min_cents is null or face_min_cents >= 0),
  face_max_cents bigint check (face_max_cents is null or face_max_cents >= 0),
  premium_per_1000_band_min numeric(6,2) check (premium_per_1000_band_min is null or premium_per_1000_band_min >= 0),
  premium_per_1000_band_max numeric(6,2) check (premium_per_1000_band_max is null or premium_per_1000_band_max >= 0),
  accepted_payment_methods text[] not null default '{}'::text[]
    check (accepted_payment_methods <@ array['ach', 'direct_express', 'debit_card', 'credit_card', 'direct_bill']::text[]),
  is_active boolean not null default true,
  -- Term life (Step 23). Null on final expense products.
  term_lengths smallint[] check (term_lengths is null or (cardinality(term_lengths) > 0 and 1 <= all (term_lengths) and 40 >= all (term_lengths))),
  health_classes text[] check (health_classes is null or cardinality(health_classes) > 0),
  face_bands jsonb check (face_bands is null or jsonb_typeof(face_bands) = 'array'),
  exam_required_above_face_cents bigint check (exam_required_above_face_cents is null or exam_required_above_face_cents >= 0),
  convertible boolean,
  conversion_deadline_rule text check (conversion_deadline_rule is null or char_length(conversion_deadline_rule) <= 200),
  renewal_type text check (renewal_type is null or renewal_type in ('annual_renewable', 'level')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint carrier_products_age_range check (issue_age_min is null or issue_age_max is null or issue_age_min <= issue_age_max),
  constraint carrier_products_face_range check (face_min_cents is null or face_max_cents is null or face_min_cents <= face_max_cents),
  constraint carrier_products_band_range check (premium_per_1000_band_min is null or premium_per_1000_band_max is null
                                                or premium_per_1000_band_min <= premium_per_1000_band_max)
);

create unique index if not exists carrier_products_name_unique
  on public.carrier_products (
    coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    carrier_id,
    product_code,
    name
  );
create index if not exists carrier_products_carrier_idx on public.carrier_products (carrier_id, product_code);
create index if not exists carrier_products_tenant_idx on public.carrier_products (tenant_id) where tenant_id is not null;
create index if not exists carrier_products_product_idx on public.carrier_products (product_code);

alter table public.carrier_products enable row level security;
drop policy if exists carrier_products_tenant_read on public.carrier_products;
create policy carrier_products_tenant_read on public.carrier_products
  for select to tenant_app
  using (tenant_id is null or tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists carrier_products_tenant_scoped on public.carrier_products;
create policy carrier_products_tenant_scoped on public.carrier_products
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.carrier_products to tenant_app;
grant select, insert, update, delete on public.carrier_products to service_role;

drop trigger if exists carrier_products_touch on public.carrier_products;
create trigger carrier_products_touch before update on public.carrier_products
  for each row execute function public.la3_touch_updated_at();

-- ── 4 · the attempt's carrier product (column from step 1) ──────────────────
alter table public.tenant_applications
  drop constraint if exists tenant_applications_carrier_product_fkey,
  add constraint tenant_applications_carrier_product_fkey
    foreign key (carrier_product_id) references public.carrier_products(id) on delete restrict not valid;
alter table public.tenant_applications validate constraint tenant_applications_carrier_product_fkey;
create index if not exists tenant_applications_carrier_product_idx
  on public.tenant_applications (carrier_product_id) where carrier_product_id is not null;

-- ── 5 · checks ──────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'carrier_products'
         and column_name in ('term_lengths', 'health_classes', 'face_bands', 'exam_required_above_face_cents',
                             'convertible', 'conversion_deadline_rule', 'renewal_type')) <> 7 then
    raise exception '20260926100300: carrier_products lacks a term-life column';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'carrier_products'
                and column_name like '%cents' and data_type <> 'bigint') then
    raise exception '20260926100300: a carrier_products money column is not bigint cents';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'carrier_products_name_unique') then
    raise exception '20260926100300: one carrier product per (tenant, carrier, product, name) is not enforced';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_applications_carrier_product_fkey' and contype = 'f' and convalidated) then
    raise exception '20260926100300: tenant_applications.carrier_product_id has no validated foreign key';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'tenant_carriers' and column_name in ('upline_name', 'notes')) <> 2 then
    raise exception '20260926100300: tenant_carriers lacks upline_name or notes';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'carriers'
         and column_name in ('portal_origin', 'reference_pattern', 'billing_descriptor')) <> 3 then
    raise exception '20260926100300: carriers lacks a portal column';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'carriers_portal_origin_https' and contype = 'c') then
    raise exception '20260926100300: the carrier portal origin is not constrained to an https origin';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260926100300', 'la_3_6_carrier_products') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [6/23] 20260926100400_la_3_5_quotes.sql ──────────────────────────────────────
begin;

-- LA-3 steps 6 and 23 — quotes (LA-3.5) with the term-life quote columns (LA-3.25) in place now.
--
-- docs/la3/SCHEMA-PLAN.md "Step 6" and "Step 23" are the specification. In short:
--
--   tenant_quotes        NEW  one row per quote shown; replaces deal_flow.initial_quote free text
--   tenant_applications  +FK  quote_id → tenant_quotes (the column is from step 1)
--
-- Money is bigint cents. A monthly premium at or above the face amount is rejected by CHECK (3.5);
-- an out-of-band per-$1,000 premium is only a warning, held in `warnings`. At most one selected
-- quote per attempt. Nothing deletes a quote: service_role has no DELETE.
--
-- Down (only while no row exists in tenant_quotes):
--   alter table public.tenant_applications drop constraint tenant_applications_quote_fkey;
--   drop table public.tenant_quotes;

create table if not exists public.tenant_quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  case_id uuid not null references public.tenant_application_cases(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  insured_role text not null default 'primary' check (insured_role in ('primary', 'spouse')),
  application_id uuid references public.tenant_applications(id) on delete set null,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  carrier_product_id uuid references public.carrier_products(id) on delete restrict,
  product_code text not null references public.products(code) on delete restrict,
  quotation_template_id uuid references public.sales_templates(id) on delete restrict,
  template_revision integer check (template_revision is null or template_revision > 0),
  tier text check (tier is null or tier in ('level', 'graded', 'modified', 'gi')),
  face_amount_cents bigint not null check (face_amount_cents > 0),
  monthly_premium_cents bigint not null check (monthly_premium_cents > 0),
  annual_premium_cents bigint check (annual_premium_cents is null or annual_premium_cents > 0),
  age_used smallint check (age_used is null or age_used between 0 and 120),
  term_length smallint check (term_length is null or term_length between 1 and 40),
  assumed_health_class text check (assumed_health_class is null or char_length(assumed_health_class) between 1 and 60),
  rating_inputs jsonb not null default '{}'::jsonb check (jsonb_typeof(rating_inputs) = 'object'),
  riders jsonb not null default '[]'::jsonb check (jsonb_typeof(riders) = 'array'),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  status text not null default 'draft' check (status in ('draft', 'presented', 'selected', 'discarded')),
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_quotes_premium_below_face check (monthly_premium_cents < face_amount_cents)
);

-- One selected quote per attempt.
create unique index if not exists tenant_quotes_one_selected_idx
  on public.tenant_quotes (application_id) where status = 'selected';
create index if not exists tenant_quotes_case_idx on public.tenant_quotes (tenant_id, case_id, created_at desc);
create index if not exists tenant_quotes_lead_idx on public.tenant_quotes (tenant_id, lead_id);
create index if not exists tenant_quotes_application_idx on public.tenant_quotes (application_id) where application_id is not null;
create index if not exists tenant_quotes_carrier_idx on public.tenant_quotes (carrier_id);
create index if not exists tenant_quotes_carrier_product_idx on public.tenant_quotes (carrier_product_id) where carrier_product_id is not null;
create index if not exists tenant_quotes_template_idx on public.tenant_quotes (quotation_template_id) where quotation_template_id is not null;

alter table public.tenant_quotes enable row level security;
drop policy if exists tenant_quotes_tenant_scoped on public.tenant_quotes;
create policy tenant_quotes_tenant_scoped on public.tenant_quotes
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_quotes to tenant_app;
grant select, insert, update on public.tenant_quotes to service_role;
-- Default privileges in public hand service_role, anon and authenticated everything on a new table;
-- a GRANT alone does not make "nothing deletes a quote" true.
revoke delete, truncate on public.tenant_quotes from service_role, tenant_app, anon, authenticated;

drop trigger if exists tenant_quotes_touch on public.tenant_quotes;
create trigger tenant_quotes_touch before update on public.tenant_quotes
  for each row execute function public.la3_touch_updated_at();

-- The attempt's selected quote. NO ACTION (checked at statement end), not RESTRICT: a case delete
-- cascades to both the attempt and its quotes in one statement.
alter table public.tenant_applications
  drop constraint if exists tenant_applications_quote_fkey,
  add constraint tenant_applications_quote_fkey
    foreign key (quote_id) references public.tenant_quotes(id) on delete no action not valid;
alter table public.tenant_applications validate constraint tenant_applications_quote_fkey;
create index if not exists tenant_applications_quote_idx
  on public.tenant_applications (quote_id) where quote_id is not null;

-- ── checks ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_quotes_premium_below_face' and contype = 'c') then
    raise exception '20260926100400: a monthly premium at or above the face amount is not rejected';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'tenant_quotes_one_selected_idx'
                  and indexdef like '%UNIQUE%' and indexdef like '%selected%') then
    raise exception '20260926100400: more than one quote can be selected per attempt';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'tenant_quotes'
                and column_name like '%cents' and data_type <> 'bigint') then
    raise exception '20260926100400: a quote money column is not bigint cents';
  end if;
  if has_table_privilege('service_role', 'public.tenant_quotes', 'DELETE') then
    raise exception '20260926100400: quotes can be deleted';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_applications_quote_fkey' and contype = 'f' and convalidated) then
    raise exception '20260926100400: tenant_applications.quote_id has no validated foreign key';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260926100400', 'la_3_5_quotes') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [7/23] 20260926100500_la_3_8_beneficiaries.sql ───────────────────────────────
begin;

-- LA-3 step 7 — beneficiaries (LA-3.8).
--
-- docs/la3/SCHEMA-PLAN.md "Step 7" is the specification. In short:
--
--   tenant_application_beneficiaries  NEW  one row per beneficiary per attempt
--
-- Shares are integer hundredths of a percent (`share_bp`: 3334 is 33.34%), so a tier's total is an
-- exact integer sum and 33.34 + 33.33 + 33.33 is exactly 10 000. The 100.00 totals are checked by
-- the QA engine and the `ready` guard (lib/applications/beneficiaries.ts), not by a row CHECK — a
-- total is not a property of one row. An estate, trust or funeral home is named in last_name.
--
-- Down (only while no row exists): drop table public.tenant_application_beneficiaries;

create table if not exists public.tenant_application_beneficiaries (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.tenant_applications(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tier text not null check (tier in ('primary', 'contingent')),
  first_name text check (first_name is null or char_length(btrim(first_name)) between 1 and 80),
  last_name text not null check (char_length(btrim(last_name)) between 1 and 160),
  relationship text not null
    check (relationship in ('spouse', 'child', 'parent', 'sibling', 'grandchild', 'estate', 'trust', 'funeral_home', 'other')),
  relationship_other text check (relationship_other is null or char_length(btrim(relationship_other)) between 1 and 80),
  dob date,
  share_bp integer not null check (share_bp > 0 and share_bp <= 10000),
  phone text check (phone is null or char_length(phone) <= 32),
  address jsonb check (address is null or jsonb_typeof(address) = 'object'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  constraint tenant_application_beneficiaries_other_named check (relationship <> 'other' or relationship_other is not null),
  -- A person has a first name; an estate, trust or funeral home does not need one.
  constraint tenant_application_beneficiaries_person_named
    check (relationship in ('estate', 'trust', 'funeral_home') or first_name is not null)
);
create index if not exists tenant_application_beneficiaries_app_idx
  on public.tenant_application_beneficiaries (application_id, tier, sort_order);
create index if not exists tenant_application_beneficiaries_tenant_idx
  on public.tenant_application_beneficiaries (tenant_id);

alter table public.tenant_application_beneficiaries enable row level security;
drop policy if exists tenant_application_beneficiaries_tenant_scoped on public.tenant_application_beneficiaries;
create policy tenant_application_beneficiaries_tenant_scoped on public.tenant_application_beneficiaries
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_application_beneficiaries to tenant_app;
grant select, insert, update, delete on public.tenant_application_beneficiaries to service_role;

drop trigger if exists tenant_application_beneficiaries_touch on public.tenant_application_beneficiaries;
create trigger tenant_application_beneficiaries_touch before update on public.tenant_application_beneficiaries
  for each row execute function public.la3_touch_updated_at();

-- ── checks ──────────────────────────────────────────────────────────────────
do $$
begin
  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'tenant_application_beneficiaries' and column_name = 'share_bp') is distinct from 'integer' then
    raise exception '20260926100500: beneficiary shares are not integer hundredths of a percent';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'tenant_application_beneficiaries'
                and data_type in ('real', 'double precision', 'numeric')) then
    raise exception '20260926100500: a beneficiary column is fractional';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_application_beneficiaries_other_named' and contype = 'c') then
    raise exception '20260926100500: an "other" relationship can be left unnamed';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260926100500', 'la_3_8_beneficiaries') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [8/23] 20260926100600_la_3_10_disclosures.sql ────────────────────────────────
begin;

-- LA-3 step 9 — application disclosures (LA-3.10).
--
-- docs/la3/SCHEMA-PLAN.md "Step 9" is the specification. In short:
--
--   application_disclosures          NEW   the disclosure library (tenant_id null = platform)
--   application_disclosure_rules     NEW   when one is required: ANDed {field, op, value} clauses
--   tenant_application_disclosures   NEW   per attempt: required / acknowledged / not applicable
--   REPLACEMENT_NOTICE, 1035_EXCHANGE SEED  platform, published, with their rules
--
-- Separate from state_disclosures (LA-2.23 call scripts). The seeded bodies are plain generic text:
-- the carrier's and the state's own replacement forms are still the ones the client signs, and a
-- tenant publishes its own version (version N + 1, or a tenant row) with the exact wording it uses.
-- Rule fields name interview answers as `health.<question_key>` (20260926100100's
-- existing_coverage and existing_cash_value).
--
-- Down (only while no row exists in tenant_application_disclosures):
--   drop table public.tenant_application_disclosures, public.application_disclosure_rules,
--              public.application_disclosures;

-- ── 1 · the library ─────────────────────────────────────────────────────────
create table if not exists public.application_disclosures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_]{1,63}$'),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  body_markdown text not null check (char_length(body_markdown) between 1 and 20000),
  attachment_path text check (attachment_path is null or char_length(attachment_path) <= 500),
  states text[],
  carrier_ids uuid[],
  version integer not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists application_disclosures_version_unique
  on public.application_disclosures (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), code, version);
create index if not exists application_disclosures_tenant_idx
  on public.application_disclosures (tenant_id, status) where tenant_id is not null;

alter table public.application_disclosures enable row level security;
drop policy if exists application_disclosures_tenant_read on public.application_disclosures;
create policy application_disclosures_tenant_read on public.application_disclosures
  for select to tenant_app
  using (tenant_id is null or tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists application_disclosures_tenant_scoped on public.application_disclosures;
create policy application_disclosures_tenant_scoped on public.application_disclosures
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.application_disclosures to tenant_app;
grant select, insert, update, delete on public.application_disclosures to service_role;

-- ── 2 · rules ───────────────────────────────────────────────────────────────
create table if not exists public.application_disclosure_rules (
  id uuid primary key default gen_random_uuid(),
  disclosure_id uuid not null references public.application_disclosures(id) on delete cascade,
  clauses jsonb not null,
  created_at timestamptz not null default now(),
  constraint application_disclosure_rules_clauses_shape check (
    jsonb_typeof(clauses) = 'array'
    and jsonb_array_length(clauses) > 0
    and not jsonb_path_exists(clauses,
      '$[*] ? (!exists(@.field) || !(@.field.type() == "string") || !exists(@.value) || !(@.op == "eq" || @.op == "neq" || @.op == "in" || @.op == "not_in" || @.op == "gt" || @.op == "lt"))')
  )
);
create index if not exists application_disclosure_rules_disclosure_idx on public.application_disclosure_rules (disclosure_id);

-- No tenant_id: scoped through the disclosure it belongs to.
alter table public.application_disclosure_rules enable row level security;
drop policy if exists application_disclosure_rules_tenant_read on public.application_disclosure_rules;
create policy application_disclosure_rules_tenant_read on public.application_disclosure_rules
  for select to tenant_app
  using (exists (select 1 from public.application_disclosures d
                  where d.id = application_disclosure_rules.disclosure_id
                    and (d.tenant_id is null or d.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)));
drop policy if exists application_disclosure_rules_tenant_scoped on public.application_disclosure_rules;
create policy application_disclosure_rules_tenant_scoped on public.application_disclosure_rules
  for all to tenant_app
  using (exists (select 1 from public.application_disclosures d
                  where d.id = application_disclosure_rules.disclosure_id
                    and d.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid))
  with check (exists (select 1 from public.application_disclosures d
                       where d.id = application_disclosure_rules.disclosure_id
                         and d.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid));
grant select on public.application_disclosure_rules to tenant_app;
grant select, insert, update, delete on public.application_disclosure_rules to service_role;

-- ── 3 · per attempt ─────────────────────────────────────────────────────────
create table if not exists public.tenant_application_disclosures (
  application_id uuid not null references public.tenant_applications(id) on delete cascade,
  disclosure_id uuid not null references public.application_disclosures(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  disclosure_version integer not null check (disclosure_version > 0),
  status text not null default 'required' check (status in ('required', 'acknowledged', 'not_applicable')),
  method text check (method is null or method in ('read_aloud', 'emailed', 'mailed')),
  note text check (note is null or char_length(note) <= 1000),
  acknowledged_by uuid references public.users(id) on delete set null,
  acknowledged_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (application_id, disclosure_id),
  constraint tenant_application_disclosures_na_has_note
    check (status <> 'not_applicable' or nullif(btrim(coalesce(note, '')), '') is not null),
  constraint tenant_application_disclosures_ack_has_method
    check (status <> 'acknowledged' or method is not null)
);
create index if not exists tenant_application_disclosures_disclosure_idx on public.tenant_application_disclosures (disclosure_id);
create index if not exists tenant_application_disclosures_tenant_idx on public.tenant_application_disclosures (tenant_id, status);

alter table public.tenant_application_disclosures enable row level security;
drop policy if exists tenant_application_disclosures_tenant_scoped on public.tenant_application_disclosures;
create policy tenant_application_disclosures_tenant_scoped on public.tenant_application_disclosures
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_application_disclosures to tenant_app;
grant select, insert, update, delete on public.tenant_application_disclosures to service_role;

drop trigger if exists application_disclosures_touch on public.application_disclosures;
create trigger application_disclosures_touch before update on public.application_disclosures
  for each row execute function public.la3_touch_updated_at();
drop trigger if exists tenant_application_disclosures_touch on public.tenant_application_disclosures;
create trigger tenant_application_disclosures_touch before update on public.tenant_application_disclosures
  for each row execute function public.la3_touch_updated_at();

-- ── 4 · seed ────────────────────────────────────────────────────────────────
insert into public.application_disclosures (tenant_id, code, title, body_markdown, version, status) values
  (null, 'REPLACEMENT_NOTICE', 'Notice regarding replacement of life insurance', $body$
You told us you have life insurance now. If the policy we are applying for will **replace** that
coverage, or if you plan to let it lapse, surrender it or borrow against it to pay for the new one,
this is a replacement.

Before you decide:

- Keep your current policy in force until the new policy is issued and you have accepted it.
- A new policy may have a new contestability and suicide period, and a waiting period on the
  full death benefit, that your current policy has already passed.
- Your premium on a new policy is based on your age and health today.
- You may lose benefits, cash value or guarantees you have under your current policy.
- You have the right to a free-look period after the new policy is delivered.

The carrier's own replacement form, where your state requires one, is part of this application
and must be completed and signed. Ask any question you have before we continue.
$body$, 1, 'published'),
  (null, '1035_EXCHANGE', 'Section 1035 exchange of an existing policy', $body$
You told us your current policy has a cash value that you plan to move to the new policy. Moving it
directly from one insurer to another can be done as a **Section 1035 exchange**, which lets the
value transfer without it being treated as a taxable withdrawal.

Before you decide:

- The exchange is requested on the carrier's own 1035 exchange and absolute assignment forms, which
  you sign; the current insurer releases the value directly to the new one.
- Your current insurer may charge a surrender charge, and any outstanding policy loan may reduce
  the amount transferred or be taxable.
- The new policy's coverage and costs are not the same as your current policy's.
- This is not tax advice. Talk to a tax professional if you are unsure how the exchange affects you.

The replacement notice also applies and must be acknowledged.
$body$, 1, 'published')
on conflict do nothing;

insert into public.application_disclosure_rules (disclosure_id, clauses)
select d.id, '[{"field": "health.existing_coverage", "op": "eq", "value": true}]'::jsonb
  from public.application_disclosures d
 where d.tenant_id is null and d.code = 'REPLACEMENT_NOTICE' and d.version = 1
   and not exists (select 1 from public.application_disclosure_rules r where r.disclosure_id = d.id);

insert into public.application_disclosure_rules (disclosure_id, clauses)
select d.id, '[{"field": "health.existing_coverage", "op": "eq", "value": true},
               {"field": "health.existing_cash_value", "op": "eq", "value": true}]'::jsonb
  from public.application_disclosures d
 where d.tenant_id is null and d.code = '1035_EXCHANGE' and d.version = 1
   and not exists (select 1 from public.application_disclosure_rules r where r.disclosure_id = d.id);

-- ── 5 · checks ──────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from public.application_disclosures
       where tenant_id is null and status = 'published' and version = 1
         and code in ('REPLACEMENT_NOTICE', '1035_EXCHANGE')) <> 2 then
    raise exception '20260926100600: the two platform disclosures are missing';
  end if;
  if not exists (select 1 from public.application_disclosure_rules r
                   join public.application_disclosures d on d.id = r.disclosure_id
                  where d.tenant_id is null and d.code = 'REPLACEMENT_NOTICE'
                    and r.clauses @> '[{"field": "health.existing_coverage", "op": "eq", "value": true}]'::jsonb) then
    raise exception '20260926100600: the replacement notice has no existing-coverage rule';
  end if;
  if not exists (select 1 from public.application_disclosure_rules r
                   join public.application_disclosures d on d.id = r.disclosure_id
                  where d.tenant_id is null and d.code = '1035_EXCHANGE' and jsonb_array_length(r.clauses) = 2
                    and r.clauses @> '[{"field": "health.existing_cash_value", "op": "eq", "value": true}]'::jsonb) then
    raise exception '20260926100600: the 1035 exchange has no existing-coverage-and-cash-value rule';
  end if;
  -- A malformed clause is refused.
  begin
    insert into public.application_disclosure_rules (disclosure_id, clauses)
    select id, '[{"field": "health.x", "op": "contains", "value": 1}]'::jsonb
      from public.application_disclosures where code = 'REPLACEMENT_NOTICE' limit 1;
    raise exception '20260926100600: a rule with an unknown operator was accepted';
  exception when check_violation then
    null;
  end;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260926100600', 'la_3_10_disclosures') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [9/23] 20260926100700_la_3_15_submissions.sql ────────────────────────────────
begin;

-- LA-3 step 11 — submission capture (LA-3.15).
--
-- docs/la3/SCHEMA-PLAN.md "Step 11" is the specification. In short:
--
--   tenant_application_submissions  NEW     one row per time submit was pressed; QA verdict and the
--                                           health picture frozen onto it
--   application-confirmations       BUCKET  private; png / jpeg / pdf; 10 MB
--
-- carrier_id is denormalised from the attempt so the duplicate-reference warning is one index probe.
-- The reference may be empty at capture (the attempt then sits on Missing reference); policy_number
-- is filled in later without touching carrier_reference. Nothing deletes a submission.
--
-- The bucket has no storage.objects policy (none exists anywhere in the repo): only the service role
-- reads or writes it, and the app serves short-lived signed URLs after checking the tenant. Objects
-- live at <tenant_id>/<application_id>/<submission_id>.<ext>, which the path CHECK enforces.
--
-- Down (only while no row or object exists):
--   drop table public.tenant_application_submissions;
--   delete from storage.buckets where id = 'application-confirmations';

create table if not exists public.tenant_application_submissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  application_id uuid not null references public.tenant_applications(id) on delete cascade,
  attempt_no integer not null check (attempt_no > 0),
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  carrier_reference text check (carrier_reference is null or char_length(btrim(carrier_reference)) between 1 and 60),
  reference_kind text check (reference_kind is null or reference_kind in ('application_no', 'policy_no')),
  policy_number text check (policy_number is null or char_length(btrim(policy_number)) between 1 and 60),
  submitted_at timestamptz not null default now(),
  submitted_via text not null check (submitted_via in ('extension', 'copy_assist', 'carrier_portal_manual')),
  confirmation_path text,
  qa_verdict jsonb not null check (jsonb_typeof(qa_verdict) = 'object'),
  health_snapshot jsonb not null check (jsonb_typeof(health_snapshot) = 'object'),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_application_submissions_reference_kind check (carrier_reference is null or reference_kind is not null),
  constraint tenant_application_submissions_confirmation_path check (
    confirmation_path is null
    or (starts_with(confirmation_path, tenant_id::text || '/' || application_id::text || '/' || id::text || '.')
        and confirmation_path ~ '\.(png|jpe?g|pdf)$')
  )
);
-- The duplicate-reference warning: same carrier, same reference, anywhere in the tenant.
create index if not exists tenant_application_submissions_reference_idx
  on public.tenant_application_submissions (tenant_id, carrier_id, carrier_reference) where carrier_reference is not null;
create index if not exists tenant_application_submissions_app_idx
  on public.tenant_application_submissions (application_id, submitted_at desc);
create index if not exists tenant_application_submissions_carrier_idx
  on public.tenant_application_submissions (carrier_id);
-- Missing reference list.
create index if not exists tenant_application_submissions_missing_ref_idx
  on public.tenant_application_submissions (tenant_id, submitted_at desc) where carrier_reference is null;

alter table public.tenant_application_submissions enable row level security;
drop policy if exists tenant_application_submissions_tenant_scoped on public.tenant_application_submissions;
create policy tenant_application_submissions_tenant_scoped on public.tenant_application_submissions
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_application_submissions to tenant_app;
grant select, insert, update on public.tenant_application_submissions to service_role;
-- Default privileges would otherwise leave DELETE with service_role, anon and authenticated.
revoke delete, truncate on public.tenant_application_submissions from service_role, tenant_app, anon, authenticated;

drop trigger if exists tenant_application_submissions_touch on public.tenant_application_submissions;
create trigger tenant_application_submissions_touch before update on public.tenant_application_submissions
  for each row execute function public.la3_touch_updated_at();

-- ── storage ─────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'application-confirmations',
  'application-confirmations',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'application/pdf']::text[]
)
on conflict (id) do nothing;

-- ── checks ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'tenant_application_submissions_reference_idx') then
    raise exception '20260926100700: the duplicate carrier reference lookup has no index';
  end if;
  if has_table_privilege('service_role', 'public.tenant_application_submissions', 'DELETE') then
    raise exception '20260926100700: submissions can be deleted';
  end if;
  if not exists (select 1 from storage.buckets where id = 'application-confirmations' and public = false) then
    raise exception '20260926100700: the application-confirmations bucket is missing or public';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260926100700', 'la_3_15_submissions') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [10/23] 20260926100800_la_3_12_extension_and_maps.sql ─────────────────────────
begin;

-- LA-3 steps 12, 13 and 14 — extension grants (LA-3.12), copy-assist ticks (LA-3.14) and carrier
-- field maps (LA-3.13: storage, review and fill — no AI yet).
--
-- docs/la3/SCHEMA-PLAN.md "Step 12", "Step 13" and "Step 14" are the specification. In short:
--
--   tenant_extension_grants   NEW  one row per token (id = jti); 60-minute lifetime by CHECK;
--                                  revocation is read from here on every extension request
--   tenant_extension_events   NEW  every grant, read, rejection and revocation; append-only
--   tenant_copy_assist_ticks  NEW  shared between the web pop-out and the extension; a new attempt
--                                  has a new application_id, so ticks reset by construction
--   carrier_field_map         NEW  versioned map per carrier (product); tenant_id null = platform
--   carrier_field_map_step    NEW  one per carrier portal page
--   carrier_field_map_entry   NEW  one per filled field
--   carrier_field_map_events  NEW  map misses and fill rates; append-only
--
-- Table names are the ones lib/carriers/cancelledAutofillStaysCancelled.test.mjs allows (the LA-3.13
-- design, not the cancelled outbound one). Two triggers enforce LA-3.13's rules:
--   · publish guard — a map cannot become `published` while any SSN or bank / card number entry is
--     unverified, and cannot be inserted already published;
--   · immutability — once published, a map, its steps and its entries never change; the only moves
--     left are published ↔ needs_review and → retired. Editing makes version N + 1.
-- proposal_source = 'ai' is the seam for decision 4; nothing writes it yet.
--
-- Down (only while no row exists in the new tables):
--   drop table public.carrier_field_map_events, public.carrier_field_map_entry,
--              public.carrier_field_map_step, public.carrier_field_map,
--              public.tenant_copy_assist_ticks, public.tenant_extension_events, public.tenant_extension_grants;
--   drop function public.carrier_field_map_guard(), public.carrier_field_map_child_guard();

-- ── 1 · extension grants (3.12) ─────────────────────────────────────────────
create table if not exists public.tenant_extension_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  application_id uuid not null references public.tenant_applications(id) on delete cascade,
  carrier_origin text not null check (carrier_origin ~ '^https://[^/]+$'),
  scope text not null default 'read_application_fields' check (scope in ('read_application_fields')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason is null or char_length(revoked_reason) between 1 and 200),
  field_reads integer not null default 0 check (field_reads >= 0),
  -- Decision 1, settled at 60 minutes. Not a range: every token lives exactly this long.
  constraint tenant_extension_grants_lifetime check (expires_at - issued_at = interval '60 minutes'),
  constraint tenant_extension_grants_revoked_reason check (revoked_at is null or revoked_reason is not null)
);
create index if not exists tenant_extension_grants_live_idx
  on public.tenant_extension_grants (tenant_id, user_id) where revoked_at is null;
-- ready → draft revokes every live grant for the attempt.
create index if not exists tenant_extension_grants_app_idx
  on public.tenant_extension_grants (application_id) where revoked_at is null;
create index if not exists tenant_extension_grants_user_idx on public.tenant_extension_grants (user_id);

alter table public.tenant_extension_grants enable row level security;
drop policy if exists tenant_extension_grants_tenant_scoped on public.tenant_extension_grants;
create policy tenant_extension_grants_tenant_scoped on public.tenant_extension_grants
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_extension_grants to tenant_app;
grant select, insert, update on public.tenant_extension_grants to service_role;

create table if not exists public.tenant_extension_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  grant_id uuid references public.tenant_extension_grants(id) on delete set null,
  kind text not null check (kind in ('granted', 'read', 'rejected', 'revoked', 'expired')),
  field_key text check (field_key is null or field_key ~ '^[a-z]+\.[a-z0-9_]+$'),
  origin text check (origin is null or char_length(origin) <= 300),
  status_code smallint check (status_code is null or status_code between 100 and 599),
  at timestamptz not null default now()
);
create index if not exists tenant_extension_events_tenant_idx on public.tenant_extension_events (tenant_id, at desc);
create index if not exists tenant_extension_events_grant_idx on public.tenant_extension_events (grant_id) where grant_id is not null;

alter table public.tenant_extension_events enable row level security;
drop policy if exists tenant_extension_events_tenant_scoped on public.tenant_extension_events;
create policy tenant_extension_events_tenant_scoped on public.tenant_extension_events
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_extension_events to tenant_app;
grant select, insert on public.tenant_extension_events to service_role;
revoke update, delete, truncate on public.tenant_extension_events from service_role, tenant_app, anon, authenticated;

-- ── 2 · copy-assist ticks (3.14) ────────────────────────────────────────────
create table if not exists public.tenant_copy_assist_ticks (
  application_id uuid not null references public.tenant_applications(id) on delete cascade,
  field_key text not null check (field_key ~ '^[a-z]+\.[a-z0-9_]+$'),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  copied_at timestamptz not null default now(),
  copied_by uuid references public.users(id) on delete set null,
  surface text not null check (surface in ('web', 'popout', 'extension')),
  primary key (application_id, field_key)
);
create index if not exists tenant_copy_assist_ticks_tenant_idx on public.tenant_copy_assist_ticks (tenant_id);

alter table public.tenant_copy_assist_ticks enable row level security;
drop policy if exists tenant_copy_assist_ticks_tenant_scoped on public.tenant_copy_assist_ticks;
create policy tenant_copy_assist_ticks_tenant_scoped on public.tenant_copy_assist_ticks
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_copy_assist_ticks to tenant_app;
grant select, insert, update, delete on public.tenant_copy_assist_ticks to service_role;

-- ── 3 · carrier field maps (3.13) ───────────────────────────────────────────
create table if not exists public.carrier_field_map (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  carrier_product_id uuid references public.carrier_products(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'in_review', 'published', 'retired', 'needs_review')),
  origin text check (origin is null or origin ~ '^https://[^/]+$'),
  created_by uuid references public.users(id) on delete set null,
  approved_by uuid references public.users(id) on delete set null,
  approved_at timestamptz,
  proposal_source text not null default 'manual' check (proposal_source in ('manual', 'ai')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint carrier_field_map_published_approved check (status <> 'published' or (approved_by is not null and approved_at is not null))
);
create unique index if not exists carrier_field_map_version_unique
  on public.carrier_field_map (
    coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    carrier_id,
    coalesce(carrier_product_id, '00000000-0000-0000-0000-000000000000'::uuid),
    version
  );
create index if not exists carrier_field_map_carrier_idx on public.carrier_field_map (carrier_id, status);
create index if not exists carrier_field_map_product_idx on public.carrier_field_map (carrier_product_id) where carrier_product_id is not null;
create index if not exists carrier_field_map_tenant_idx on public.carrier_field_map (tenant_id) where tenant_id is not null;

create table if not exists public.carrier_field_map_step (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.carrier_field_map(id) on delete cascade,
  page_key text not null check (page_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  url_pattern text not null check (char_length(url_pattern) between 1 and 500),
  sort_order integer not null default 0,
  constraint carrier_field_map_step_page_unique unique (map_id, page_key)
);

create table if not exists public.carrier_field_map_entry (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references public.carrier_field_map_step(id) on delete cascade,
  field_key text not null check (field_key ~ '^[a-z]+\.[a-z0-9_]+$'),
  selector text not null check (char_length(selector) between 1 and 1000),
  selector_fallback text check (selector_fallback is null or char_length(selector_fallback) <= 1000),
  input_kind text not null check (input_kind in ('text', 'select', 'radio', 'checkbox', 'date', 'masked')),
  value_transform text check (value_transform is null or char_length(value_transform) <= 60),
  option_map jsonb check (option_map is null or jsonb_typeof(option_map) = 'object'),
  confidence numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  verified boolean not null default false,
  verified_by uuid references public.users(id) on delete set null,
  constraint carrier_field_map_entry_field_unique unique (step_id, field_key),
  constraint carrier_field_map_entry_verified_by check (not verified or verified_by is not null)
);
create index if not exists carrier_field_map_entry_verified_by_idx on public.carrier_field_map_entry (verified_by) where verified_by is not null;

create table if not exists public.carrier_field_map_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  map_id uuid not null references public.carrier_field_map(id) on delete cascade,
  step_id uuid references public.carrier_field_map_step(id) on delete set null,
  application_id uuid references public.tenant_applications(id) on delete set null,
  kind text not null check (kind in ('map_miss', 'fill_rate')),
  field_key text check (field_key is null or field_key ~ '^[a-z]+\.[a-z0-9_]+$'),
  fields_filled integer check (fields_filled is null or fields_filled >= 0),
  fields_total integer check (fields_total is null or fields_total >= 0),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  at timestamptz not null default now(),
  constraint carrier_field_map_events_fill_rate check (kind <> 'fill_rate' or (fields_filled is not null and fields_total is not null and fields_filled <= fields_total))
);
create index if not exists carrier_field_map_events_map_idx on public.carrier_field_map_events (map_id, at desc);
create index if not exists carrier_field_map_events_tenant_idx on public.carrier_field_map_events (tenant_id, at desc);
create index if not exists carrier_field_map_events_step_idx on public.carrier_field_map_events (step_id) where step_id is not null;
create index if not exists carrier_field_map_events_app_idx on public.carrier_field_map_events (application_id) where application_id is not null;

-- RLS: platform maps are readable by every tenant; a tenant writes only its own. Steps and entries
-- have no tenant_id and scope through their map.
alter table public.carrier_field_map enable row level security;
drop policy if exists carrier_field_map_tenant_read on public.carrier_field_map;
create policy carrier_field_map_tenant_read on public.carrier_field_map
  for select to tenant_app
  using (tenant_id is null or tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists carrier_field_map_tenant_scoped on public.carrier_field_map;
create policy carrier_field_map_tenant_scoped on public.carrier_field_map
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.carrier_field_map to tenant_app;
grant select, insert, update, delete on public.carrier_field_map to service_role;

alter table public.carrier_field_map_step enable row level security;
drop policy if exists carrier_field_map_step_tenant_read on public.carrier_field_map_step;
create policy carrier_field_map_step_tenant_read on public.carrier_field_map_step
  for select to tenant_app
  using (exists (select 1 from public.carrier_field_map m
                  where m.id = carrier_field_map_step.map_id
                    and (m.tenant_id is null or m.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)));
drop policy if exists carrier_field_map_step_tenant_scoped on public.carrier_field_map_step;
create policy carrier_field_map_step_tenant_scoped on public.carrier_field_map_step
  for all to tenant_app
  using (exists (select 1 from public.carrier_field_map m
                  where m.id = carrier_field_map_step.map_id
                    and m.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid))
  with check (exists (select 1 from public.carrier_field_map m
                       where m.id = carrier_field_map_step.map_id
                         and m.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid));
grant select on public.carrier_field_map_step to tenant_app;
grant select, insert, update, delete on public.carrier_field_map_step to service_role;

alter table public.carrier_field_map_entry enable row level security;
drop policy if exists carrier_field_map_entry_tenant_read on public.carrier_field_map_entry;
create policy carrier_field_map_entry_tenant_read on public.carrier_field_map_entry
  for select to tenant_app
  using (exists (select 1 from public.carrier_field_map_step s
                   join public.carrier_field_map m on m.id = s.map_id
                  where s.id = carrier_field_map_entry.step_id
                    and (m.tenant_id is null or m.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)));
drop policy if exists carrier_field_map_entry_tenant_scoped on public.carrier_field_map_entry;
create policy carrier_field_map_entry_tenant_scoped on public.carrier_field_map_entry
  for all to tenant_app
  using (exists (select 1 from public.carrier_field_map_step s
                   join public.carrier_field_map m on m.id = s.map_id
                  where s.id = carrier_field_map_entry.step_id
                    and m.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid))
  with check (exists (select 1 from public.carrier_field_map_step s
                        join public.carrier_field_map m on m.id = s.map_id
                       where s.id = carrier_field_map_entry.step_id
                         and m.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid));
grant select on public.carrier_field_map_entry to tenant_app;
grant select, insert, update, delete on public.carrier_field_map_entry to service_role;

alter table public.carrier_field_map_events enable row level security;
drop policy if exists carrier_field_map_events_tenant_scoped on public.carrier_field_map_events;
create policy carrier_field_map_events_tenant_scoped on public.carrier_field_map_events
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.carrier_field_map_events to tenant_app;
grant select, insert on public.carrier_field_map_events to service_role;
revoke update, delete, truncate on public.carrier_field_map_events from service_role, tenant_app, anon, authenticated;

-- ── 4 · publish guard and immutability ──────────────────────────────────────
--
-- A map is frozen once it has been published: status published or retired, or needs_review after
-- an approval (a published map a miss has flagged). A draft or in-review map is freely editable.
create or replace function public.carrier_field_map_guard()
returns trigger language plpgsql as $function$
declare
  v_unverified text;
  v_frozen boolean;
begin
  if tg_op = 'INSERT' then
    if new.status = 'published' then
      raise exception 'CARRIER_FIELD_MAP_PUBLISH_ON_INSERT: insert the map as a draft, add its entries, then publish it';
    end if;
    return new;
  end if;

  v_frozen := old.status in ('published', 'retired') or (old.status = 'needs_review' and old.approved_at is not null);

  if tg_op = 'DELETE' then
    if v_frozen then
      raise exception 'CARRIER_FIELD_MAP_PUBLISHED_IMMUTABLE: map v% has been published and cannot be deleted', old.version;
    end if;
    return old;
  end if;

  if v_frozen then
    if (new.tenant_id, new.carrier_id, new.carrier_product_id, new.version, new.origin, new.created_by,
        new.approved_by, new.approved_at, new.proposal_source)
       is distinct from
       (old.tenant_id, old.carrier_id, old.carrier_product_id, old.version, old.origin, old.created_by,
        old.approved_by, old.approved_at, old.proposal_source) then
      raise exception 'CARRIER_FIELD_MAP_PUBLISHED_IMMUTABLE: map v% has been published; edit a new version instead', old.version;
    end if;
    if new.status is distinct from old.status
       and not ((old.status = 'published' and new.status in ('needs_review', 'retired'))
             or (old.status = 'needs_review' and new.status in ('published', 'retired'))) then
      raise exception 'CARRIER_FIELD_MAP_PUBLISHED_IMMUTABLE: map v% cannot go from % to %', old.version, old.status, new.status;
    end if;
    return new;
  end if;

  if new.status = 'published' and old.status is distinct from 'published' then
    select string_agg(distinct e.field_key, ', ' order by e.field_key) into v_unverified
      from public.carrier_field_map_entry e
      join public.carrier_field_map_step s on s.id = e.step_id
     where s.map_id = new.id
       and e.field_key in ('insured.ssn', 'pay.routing_number', 'pay.account_number', 'pay.card_number')
       and not e.verified;
    if v_unverified is not null then
      raise exception 'CARRIER_FIELD_MAP_SENSITIVE_UNVERIFIED: verify % before publishing', v_unverified;
    end if;
  end if;
  return new;
end;
$function$;

-- Steps and entries of a frozen map cannot be added, changed or removed.
create or replace function public.carrier_field_map_child_guard()
returns trigger language plpgsql as $function$
declare
  v_map_ids uuid[];
begin
  if tg_table_name = 'carrier_field_map_step' then
    v_map_ids := array_remove(array[
      case when tg_op <> 'INSERT' then old.map_id end,
      case when tg_op <> 'DELETE' then new.map_id end], null);
  else
    select array_agg(s.map_id) into v_map_ids
      from public.carrier_field_map_step s
     where s.id in (case when tg_op <> 'INSERT' then old.step_id end,
                    case when tg_op <> 'DELETE' then new.step_id end);
  end if;

  if exists (select 1 from public.carrier_field_map m
              where m.id = any (coalesce(v_map_ids, '{}'::uuid[]))
                and (m.status in ('published', 'retired') or (m.status = 'needs_review' and m.approved_at is not null))) then
    raise exception 'CARRIER_FIELD_MAP_PUBLISHED_IMMUTABLE: this map has been published; edit a new version instead';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

drop trigger if exists carrier_field_map_guard on public.carrier_field_map;
create trigger carrier_field_map_guard before insert or update or delete on public.carrier_field_map
  for each row execute function public.carrier_field_map_guard();
drop trigger if exists carrier_field_map_touch on public.carrier_field_map;
create trigger carrier_field_map_touch before update on public.carrier_field_map
  for each row execute function public.la3_touch_updated_at();
drop trigger if exists carrier_field_map_step_guard on public.carrier_field_map_step;
create trigger carrier_field_map_step_guard before insert or update or delete on public.carrier_field_map_step
  for each row execute function public.carrier_field_map_child_guard();
drop trigger if exists carrier_field_map_entry_guard on public.carrier_field_map_entry;
create trigger carrier_field_map_entry_guard before insert or update or delete on public.carrier_field_map_entry
  for each row execute function public.carrier_field_map_child_guard();

-- ── 5 · checks ──────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_extension_grants_lifetime' and contype = 'c'
                  and pg_get_constraintdef(oid) ~ '(01:00:00|60 minutes|1 hour)') then
    raise exception '20260926100800: the extension grant lifetime is not fixed at 60 minutes';
  end if;
  if has_table_privilege('service_role', 'public.tenant_extension_events', 'UPDATE')
     or has_table_privilege('service_role', 'public.carrier_field_map_events', 'DELETE') then
    raise exception '20260926100800: an extension or field-map event log is not append-only';
  end if;
  if (select count(*) from information_schema.tables
       where table_schema = 'public'
         and table_name in ('carrier_field_map', 'carrier_field_map_step', 'carrier_field_map_entry', 'carrier_field_map_events')) <> 4 then
    raise exception '20260926100800: a LA-3.13 field-map table is missing';
  end if;
  if (select count(*) from pg_trigger
       where not tgisinternal
         and tgname in ('carrier_field_map_guard', 'carrier_field_map_step_guard', 'carrier_field_map_entry_guard')) <> 3 then
    raise exception '20260926100800: the field-map publish guard or immutability trigger is missing';
  end if;
  if position('insured.ssn' in (select prosrc from pg_proc where proname = 'carrier_field_map_guard' limit 1)) = 0 then
    raise exception '20260926100800: the publish guard does not cover the SSN';
  end if;
end $$;

-- The guard, exercised: an unverified SSN entry blocks publishing, and a published map's entries
-- are frozen. Everything the probe writes is undone by the sentinel exception.
do $$
declare
  v_carrier uuid := (select id from public.carriers order by created_at limit 1);
  v_user uuid := (select id from public.users order by created_at limit 1);
  v_map uuid;
  v_step uuid;
begin
  if v_carrier is null or v_user is null then
    raise notice '20260926100800: no carrier or user to probe the publish guard with; skipped';
    return;
  end if;
  begin
    insert into public.carrier_field_map (tenant_id, carrier_id, version, status)
    values (null, v_carrier, 999999, 'draft') returning id into v_map;
    insert into public.carrier_field_map_step (map_id, page_key, url_pattern)
    values (v_map, 'probe', '/probe') returning id into v_step;
    insert into public.carrier_field_map_entry (step_id, field_key, selector, input_kind)
    values (v_step, 'insured.ssn', '#ssn', 'masked');

    begin
      update public.carrier_field_map set status = 'published', approved_by = v_user, approved_at = now() where id = v_map;
      raise exception '20260926100800: a map with an unverified SSN entry was published';
    exception when others then
      if sqlerrm not like 'CARRIER_FIELD_MAP_SENSITIVE_UNVERIFIED%' then raise; end if;
    end;

    update public.carrier_field_map_entry set verified = true, verified_by = v_user where step_id = v_step;
    update public.carrier_field_map set status = 'published', approved_by = v_user, approved_at = now() where id = v_map;

    begin
      update public.carrier_field_map_entry set selector = '#changed' where step_id = v_step;
      raise exception '20260926100800: an entry of a published map was edited';
    exception when others then
      if sqlerrm not like 'CARRIER_FIELD_MAP_PUBLISHED_IMMUTABLE%' then raise; end if;
    end;

    raise exception 'la3_probe_rollback';
  exception when others then
    if sqlerrm <> 'la3_probe_rollback' then raise; end if;
  end;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260926100800', 'la_3_12_extension_and_maps') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [11/23] 20260926100900_la_3_16_attempts.sql ───────────────────────────────────
begin;

-- LA-3 step 15 — attempts (LA-3.16): structured outcome reasons and the next-attempt function.
--
-- docs/la3/SCHEMA-PLAN.md "Step 15" and docs/la3/STATUS-MODEL.md §3–§4 are the specification. In short:
--
--   application_outcome_reasons  NEW       platform list (tenant_id null), extendable per tenant and
--                                          optionally scoped to one carrier; seeded per STATUS-MODEL §3
--   open_next_attempt()          NEW       attempt N + 1 after a declined / postponed / refused /
--                                          expired attempt on an open case
--
-- application_transition() (step 1) stays the only writer of status and outcome; open_next_attempt
-- only inserts a new draft attempt beside a closed one.
--
-- What carries forward: tenant_application_values in the insured / contact / addr / owner groups,
-- as source 'carried_forward' and unreviewed; the beneficiaries; the payment method's non-secret
-- columns. What does NOT: quotes, disclosures, QA, copy-assist ticks, the carrier — and no
-- ciphertext at all. Ciphertext is bound by AES-GCM associated data to the application id it was
-- written for, so a copied SSN, routing, account or card number would never decrypt on the new
-- attempt; the app re-encrypts carried sensitive values itself.
--
-- Down:
--   drop function public.open_next_attempt(uuid, uuid, uuid);
--   drop table public.application_outcome_reasons;

-- ── 1 · outcome reasons ─────────────────────────────────────────────────────
create table if not exists public.application_outcome_reasons (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[a-z][a-z0-9_]{0,63}$'),
  tenant_id uuid references public.tenants(id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 120),
  valid_outcomes text[] not null
    check (cardinality(valid_outcomes) > 0
           and valid_outcomes <@ array['issued', 'declined', 'postponed', 'withdrawn', 'declined_by_client', 'offer_expired']::text[]),
  carrier_id uuid references public.carriers(id) on delete cascade,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists application_outcome_reasons_code_unique
  on public.application_outcome_reasons (
    coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    code,
    coalesce(carrier_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
create index if not exists application_outcome_reasons_tenant_idx
  on public.application_outcome_reasons (tenant_id) where tenant_id is not null;
create index if not exists application_outcome_reasons_carrier_idx
  on public.application_outcome_reasons (carrier_id) where carrier_id is not null;

alter table public.application_outcome_reasons enable row level security;
drop policy if exists application_outcome_reasons_tenant_read on public.application_outcome_reasons;
create policy application_outcome_reasons_tenant_read on public.application_outcome_reasons
  for select to tenant_app
  using (tenant_id is null or tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists application_outcome_reasons_tenant_scoped on public.application_outcome_reasons;
create policy application_outcome_reasons_tenant_scoped on public.application_outcome_reasons
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.application_outcome_reasons to tenant_app;
grant select, insert, update, delete on public.application_outcome_reasons to service_role;

drop trigger if exists application_outcome_reasons_touch on public.application_outcome_reasons;
create trigger application_outcome_reasons_touch before update on public.application_outcome_reasons
  for each row execute function public.la3_touch_updated_at();

-- STATUS-MODEL §3, the LA-3.16 Final Expense set (lib/applications/constants.ts OUTCOME_REASONS).
-- `other` requires free text; the service enforces that, as application_transition takes the text.
insert into public.application_outcome_reasons (code, tenant_id, label, valid_outcomes, carrier_id, sort_order) values
  ('medication',                null, 'Medication disclosed',          array['declined', 'postponed'],              null, 10),
  ('recent_hospitalisation',    null, 'Recent hospitalisation',        array['declined', 'postponed'],              null, 20),
  ('height_weight',             null, 'Height / weight (build chart)', array['declined'],                           null, 30),
  ('prior_decline',             null, 'Prior decline',                 array['declined'],                           null, 40),
  ('banking_nsf',               null, 'Banking / NSF',                 array['declined', 'withdrawn'],              null, 50),
  ('incomplete_application',    null, 'Incomplete application',        array['declined'],                           null, 60),
  ('replacement_not_disclosed', null, 'Replacement not disclosed',     array['declined'],                           null, 70),
  ('client_changed_mind',       null, 'Client changed their mind',     array['withdrawn'],                          null, 80),
  ('client_unreachable',        null, 'Client unreachable',            array['withdrawn'],                          null, 90),
  ('other',                     null, 'Other',                         array['declined', 'postponed', 'withdrawn'], null, 1000)
on conflict do nothing;

-- ── 2 · the next attempt ────────────────────────────────────────────────────
create or replace function public.open_next_attempt(
  p_tenant_id uuid,
  p_application_id uuid,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a record;
  v_case_status text;
  v_new uuid;
begin
  select * into a from tenant_applications t
   where t.id = p_application_id and t.tenant_id = p_tenant_id
   for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;

  -- Only a carrier decision (or the client refusing / letting a counteroffer lapse) earns a retry;
  -- issued is a sale and withdrawn is the client or agent walking away.
  if a.status <> 'closed' or a.outcome not in ('declined', 'postponed', 'declined_by_client', 'offer_expired') then
    raise exception 'NEXT_ATTEMPT_NOT_ALLOWED: the attempt is not closed as declined, postponed, declined_by_client or offer_expired';
  end if;

  select c.status into v_case_status from tenant_application_cases c
   where c.id = a.case_id and c.tenant_id = p_tenant_id
   for update;
  if v_case_status is distinct from 'open' then
    raise exception 'NEXT_ATTEMPT_NOT_ALLOWED: the case is not open';
  end if;

  -- The retry follows the insured's latest attempt, and only once nothing is live for them.
  if exists (select 1 from tenant_applications x
              where x.case_id = a.case_id and x.insured_role = a.insured_role
                and (x.status <> 'closed' or x.attempt_no > a.attempt_no)) then
    raise exception 'NEXT_ATTEMPT_NOT_ALLOWED: this is not the latest attempt, or one is already live';
  end if;

  insert into tenant_applications (tenant_id, case_id, lead_id, insured_role, attempt_no, supersedes_application_id,
                                   field_set_template_id, field_set_revision, status, draft_day, created_by)
  values (a.tenant_id, a.case_id, a.lead_id, a.insured_role, a.attempt_no + 1, a.id,
          a.field_set_template_id, a.field_set_revision, 'draft', a.draft_day, p_actor)
  returning id into v_new;

  -- Plain values only: a ciphertext row is bound to the old application id and is re-encrypted by
  -- the app. Carried values are unreviewed, so QA's "prefilled, never reviewed" warning applies.
  insert into tenant_application_values (application_id, field_key, tenant_id, value, source, linked_to_primary, updated_by)
  select v_new, v.field_key, v.tenant_id, v.value, 'carried_forward', v.linked_to_primary, p_actor
    from tenant_application_values v
   where v.application_id = a.id
     and v.tenant_id = p_tenant_id
     and v.value_ciphertext is null
     and (v.field_key like 'insured.%' or v.field_key like 'contact.%'
          or v.field_key like 'addr.%' or v.field_key like 'owner.%');

  insert into tenant_application_beneficiaries (application_id, tenant_id, tier, first_name, last_name, relationship,
                                                relationship_other, dob, share_bp, phone, address, sort_order, updated_by)
  select v_new, b.tenant_id, b.tier, b.first_name, b.last_name, b.relationship,
         b.relationship_other, b.dob, b.share_bp, b.phone, b.address, b.sort_order, p_actor
    from tenant_application_beneficiaries b
   where b.application_id = a.id and b.tenant_id = p_tenant_id;

  -- The payment method without any ciphertext, last-four or key version: the app asks for (or
  -- re-encrypts) the numbers, so a last-four never points at a number that is not there.
  insert into tenant_application_payment_methods (application_id, tenant_id, method, account_type, bank_name, name_on_account,
                                                  card_exp_month, card_exp_year, card_brand, name_on_card,
                                                  billing_frequency, billing_address_same_as_insured,
                                                  draft_income_type, draft_income_inputs, draft_day_recommended,
                                                  draft_day_override_reason, draft_day_overridden_by, draft_day_overridden_at,
                                                  linked_to_primary, updated_by)
  select v_new, m.tenant_id, m.method, m.account_type, m.bank_name, m.name_on_account,
         m.card_exp_month, m.card_exp_year, m.card_brand, m.name_on_card,
         m.billing_frequency, m.billing_address_same_as_insured,
         m.draft_income_type, m.draft_income_inputs, m.draft_day_recommended,
         m.draft_day_override_reason, m.draft_day_overridden_by, m.draft_day_overridden_at,
         m.linked_to_primary, p_actor
    from tenant_application_payment_methods m
   where m.application_id = a.id and m.tenant_id = p_tenant_id;

  return v_new;
end;
$function$;

revoke all on function public.open_next_attempt(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.open_next_attempt(uuid, uuid, uuid) to service_role;

-- ── 3 · checks ──────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from public.application_outcome_reasons where tenant_id is null and carrier_id is null
        and code in ('medication', 'recent_hospitalisation', 'height_weight', 'prior_decline', 'banking_nsf',
                     'incomplete_application', 'replacement_not_disclosed', 'client_changed_mind',
                     'client_unreachable', 'other')) <> 10 then
    raise exception '20260926100900: the ten platform outcome reasons are missing';
  end if;
  if exists (select 1 from public.application_outcome_reasons where 'issued' = any (valid_outcomes)) then
    raise exception '20260926100900: an outcome reason is offered for issued';
  end if;
  if not exists (select 1 from pg_proc where proname = 'open_next_attempt' and prosecdef) then
    raise exception '20260926100900: open_next_attempt is missing or not security definer';
  end if;
  if has_function_privilege('tenant_app', 'public.open_next_attempt(uuid, uuid, uuid)', 'execute') then
    raise exception '20260926100900: open_next_attempt is callable by tenant_app';
  end if;
  if position('value_ciphertext is null' in (select prosrc from pg_proc where proname = 'open_next_attempt' limit 1)) = 0 then
    raise exception '20260926100900: open_next_attempt may copy ciphertext bound to the old application';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260926100900', 'la_3_16_attempts') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [12/23] 20260926101000_la_3_17_23_settings_and_sync.sql ───────────────────────
begin;

-- LA-3 steps 16 and 17 — sales settings (LA-3.17) and pipeline sync (LA-3.23).
--
-- docs/la3/SCHEMA-PLAN.md "Step 16" and "Step 17", and docs/la3/STATUS-MODEL.md §6, are the
-- specification. In short:
--
--   tenant_sales_settings          NEW    one row per tenant (Q9: one tenant_<domain>_settings table),
--                                         validated by Zod in lib/salesSettings/schema.ts
--   tenant_application_stage_map   NEW    sync_key → the tenant's own pipeline stage; unmapped moves nothing
--   tenant_lead_stage_events       CHECK  source gains 'application_sync', keeps 'inbound'
--
-- The stage-history CHECK is restated with every current value, 'inbound' included, so this file is
-- right whether it runs before or after 20260925709850 (the same reasoning as 20260926000100).
-- A sync move writes actor_user_id = null and disposition_key = null (Q3).
--
-- Down:
--   restore tenant_lead_stage_events_source_check without 'application_sync' (20260926000100's
--   statement) — only safe while no row has source = 'application_sync';
--   drop table public.tenant_application_stage_map, public.tenant_sales_settings;
--   drop function public.tenant_application_stage_map_same_tenant();

-- ── 1 · sales settings ──────────────────────────────────────────────────────
create table if not exists public.tenant_sales_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);

alter table public.tenant_sales_settings enable row level security;
drop policy if exists tenant_sales_settings_tenant_scoped on public.tenant_sales_settings;
create policy tenant_sales_settings_tenant_scoped on public.tenant_sales_settings
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_sales_settings to tenant_app;
grant select, insert, update on public.tenant_sales_settings to service_role;

drop trigger if exists tenant_sales_settings_touch on public.tenant_sales_settings;
create trigger tenant_sales_settings_touch before update on public.tenant_sales_settings
  for each row execute function public.la3_touch_updated_at();

-- ── 2 · application → pipeline stage map (STATUS-MODEL §6) ──────────────────
create table if not exists public.tenant_application_stage_map (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sync_key text not null
    check (sync_key in ('quoted', 'application_started', 'submitted', 'pending_requirements', 'issued', 'requoting', 'lost')),
  stage_id uuid not null references public.tenant_pipeline_stages(id) on delete cascade,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  primary key (tenant_id, sync_key)
);
create index if not exists tenant_application_stage_map_stage_idx on public.tenant_application_stage_map (stage_id);

alter table public.tenant_application_stage_map enable row level security;
drop policy if exists tenant_application_stage_map_tenant_scoped on public.tenant_application_stage_map;
create policy tenant_application_stage_map_tenant_scoped on public.tenant_application_stage_map
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_application_stage_map to tenant_app;
grant select, insert, update, delete on public.tenant_application_stage_map to service_role;

-- tenant_pipeline_stages has no tenant_id, so the FK alone would let one tenant map another's stage.
create or replace function public.tenant_application_stage_map_same_tenant()
returns trigger language plpgsql as $function$
begin
  if not exists (select 1 from public.tenant_pipeline_stages s
                   join public.tenant_pipelines p on p.id = s.pipeline_id
                  where s.id = new.stage_id and p.tenant_id = new.tenant_id) then
    raise exception 'STAGE_MAP_FOREIGN_STAGE: stage % is not in a pipeline of tenant %', new.stage_id, new.tenant_id;
  end if;
  return new;
end;
$function$;

drop trigger if exists tenant_application_stage_map_same_tenant on public.tenant_application_stage_map;
create trigger tenant_application_stage_map_same_tenant before insert or update on public.tenant_application_stage_map
  for each row execute function public.tenant_application_stage_map_same_tenant();
drop trigger if exists tenant_application_stage_map_touch on public.tenant_application_stage_map;
create trigger tenant_application_stage_map_touch before update on public.tenant_application_stage_map
  for each row execute function public.la3_touch_updated_at();

-- ── 3 · stage history accepts the sync source ───────────────────────────────
alter table public.tenant_lead_stage_events
  drop constraint if exists tenant_lead_stage_events_source_check,
  add constraint tenant_lead_stage_events_source_check
    check (source = any (array['board', 'table', 'list', 'lead_detail', 'owner_fix', 'dialer', 'inbound', 'application_sync'])) not valid;
alter table public.tenant_lead_stage_events validate constraint tenant_lead_stage_events_source_check;

-- ── 4 · checks ──────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_application_stage_map_pkey' and contype = 'p') then
    raise exception '20260926101000: one stage per sync key per tenant is not enforced';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tenant_application_stage_map_same_tenant' and not tgisinternal) then
    raise exception '20260926101000: a tenant can map another tenant''s stage';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_lead_stage_events_source_check'
                  and pg_get_constraintdef(oid) like '%''application_sync''%'
                  and pg_get_constraintdef(oid) like '%''inbound''%'
                  and pg_get_constraintdef(oid) like '%''dialer''%'
                  and pg_get_constraintdef(oid) like '%''owner_fix''%'
                  and convalidated) then
    raise exception '20260926101000: stage history does not accept application_sync alongside inbound, dialer and owner_fix';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260926101000', 'la_3_17_23_settings_and_sync') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [13/23] 20260926101100_la_3_18_26_20_22_after_submit.sql ──────────────────────
begin;

-- LA-3 steps 18–21 and 23 — after submission: carrier requirements (LA-3.18, with the LA-3.25 exam
-- columns), counteroffers (LA-3.26), welcome packs (LA-3.20) and the carrier portal register (LA-3.22).
--
-- docs/la3/SCHEMA-PLAN.md "Step 18", "Step 19", "Step 20", "Step 21" and "Step 23" are the
-- specification. In short:
--
--   tenant_application_requirements  NEW  what the carrier asked for, who it waits on, when it is due;
--                                         paramed exam dates only on a paramed_exam row
--   tenant_application_counteroffers NEW  different terms offered; one pending per attempt; never deleted
--   tenant_welcome_packs             NEW  one per attempt; household_group ties both spouses' packs
--   tenant_carrier_portal_accounts   NEW  where and as whom the agency logs in — never how: no
--                                         password, secret, token, PIN or credential column exists
--
-- The pending_client → expired job (and closing the attempt as offer_expired) is scheduled in its
-- own step with the pg_cron check block; it is not in this file.
--
-- Down (only while no row exists in the new tables):
--   drop table public.tenant_carrier_portal_accounts, public.tenant_welcome_packs,
--              public.tenant_application_counteroffers, public.tenant_application_requirements;

-- ── 1 · requirements (3.18, exam columns 3.25) ──────────────────────────────
create table if not exists public.tenant_application_requirements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  application_id uuid not null references public.tenant_applications(id) on delete cascade,
  kind text not null
    check (kind in ('aps', 'phone_interview', 'voice_verification', 'missing_info', 'amendment', 'paramed_exam', 'counteroffer', 'other')),
  description text check (description is null or char_length(btrim(description)) between 1 and 1000),
  waiting_on text not null check (waiting_on in ('client', 'carrier', 'agent', 'third_party')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'satisfied', 'waived', 'expired')),
  raised_at date not null default current_date,
  due_at date,
  satisfied_at date,
  last_chased_at timestamptz,
  chase_count integer not null default 0 check (chase_count >= 0),
  callback_id uuid references public.tenant_callbacks(id) on delete set null,
  note text check (note is null or char_length(note) <= 2000),
  exam_vendor text check (exam_vendor is null or char_length(btrim(exam_vendor)) between 1 and 120),
  exam_ordered_on date,
  exam_scheduled_on date,
  exam_completed_on date,
  exam_results_on date,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_application_requirements_other_described check (kind <> 'other' or description is not null),
  constraint tenant_application_requirements_due_after_raised check (due_at is null or due_at >= raised_at),
  constraint tenant_application_requirements_satisfied_dated
    check ((status in ('satisfied', 'waived')) or satisfied_at is null),
  constraint tenant_application_requirements_exam_only_paramed check (
    kind = 'paramed_exam'
    or (exam_vendor is null and exam_ordered_on is null and exam_scheduled_on is null
        and exam_completed_on is null and exam_results_on is null)
  )
);
create index if not exists tenant_application_requirements_app_idx
  on public.tenant_application_requirements (application_id, status);
-- Ageing: open requirements by due date across the tenant.
create index if not exists tenant_application_requirements_ageing_idx
  on public.tenant_application_requirements (tenant_id, status, due_at);
create index if not exists tenant_application_requirements_callback_idx
  on public.tenant_application_requirements (callback_id) where callback_id is not null;

alter table public.tenant_application_requirements enable row level security;
drop policy if exists tenant_application_requirements_tenant_scoped on public.tenant_application_requirements;
create policy tenant_application_requirements_tenant_scoped on public.tenant_application_requirements
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_application_requirements to tenant_app;
grant select, insert, update on public.tenant_application_requirements to service_role;

-- ── 2 · counteroffers (3.26) ────────────────────────────────────────────────
create table if not exists public.tenant_application_counteroffers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  application_id uuid not null references public.tenant_applications(id) on delete cascade,
  received_at timestamptz not null default now(),
  offered_tier text check (offered_tier is null or offered_tier in ('level', 'graded', 'modified', 'gi')),
  offered_health_class text check (offered_health_class is null or char_length(btrim(offered_health_class)) between 1 and 60),
  offered_face_cents bigint check (offered_face_cents is null or offered_face_cents > 0),
  offered_monthly_premium_cents bigint check (offered_monthly_premium_cents is null or offered_monthly_premium_cents > 0),
  offered_annual_premium_cents bigint check (offered_annual_premium_cents is null or offered_annual_premium_cents > 0),
  reason_code text check (reason_code is null or reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  reason_text text check (reason_text is null or char_length(reason_text) <= 2000),
  expires_at timestamptz,
  status text not null default 'pending_client' check (status in ('pending_client', 'accepted', 'rejected', 'expired')),
  responded_at timestamptz,
  responded_by uuid references public.users(id) on delete set null,
  client_response_note text check (client_response_note is null or char_length(client_response_note) <= 2000),
  requirement_id uuid references public.tenant_application_requirements(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_application_counteroffers_premium_below_face
    check (offered_face_cents is null or offered_monthly_premium_cents is null or offered_monthly_premium_cents < offered_face_cents),
  constraint tenant_application_counteroffers_expires_after_received check (expires_at is null or expires_at > received_at),
  constraint tenant_application_counteroffers_response_dated
    check (status not in ('accepted', 'rejected') or responded_at is not null)
);
-- One open counteroffer per attempt: the attempt has one counteroffer_pending state.
create unique index if not exists tenant_application_counteroffers_one_pending_idx
  on public.tenant_application_counteroffers (application_id) where status = 'pending_client';
create index if not exists tenant_application_counteroffers_app_idx
  on public.tenant_application_counteroffers (application_id, received_at desc);
-- The expiry job's scan.
create index if not exists tenant_application_counteroffers_expiry_idx
  on public.tenant_application_counteroffers (expires_at) where status = 'pending_client';
create index if not exists tenant_application_counteroffers_tenant_idx
  on public.tenant_application_counteroffers (tenant_id, received_at desc);
create index if not exists tenant_application_counteroffers_requirement_idx
  on public.tenant_application_counteroffers (requirement_id) where requirement_id is not null;

alter table public.tenant_application_counteroffers enable row level security;
drop policy if exists tenant_application_counteroffers_tenant_scoped on public.tenant_application_counteroffers;
create policy tenant_application_counteroffers_tenant_scoped on public.tenant_application_counteroffers
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_application_counteroffers to tenant_app;
grant select, insert, update on public.tenant_application_counteroffers to service_role;
-- Nothing deletes a counteroffer (default privileges would otherwise leave DELETE in place).
revoke delete, truncate on public.tenant_application_counteroffers from service_role, tenant_app, anon, authenticated;

-- ── 3 · welcome packs (3.20) ────────────────────────────────────────────────
create table if not exists public.tenant_welcome_packs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  application_id uuid not null references public.tenant_applications(id) on delete cascade,
  attempt_no integer not null check (attempt_no > 0),
  pdf_path text check (pdf_path is null or starts_with(pdf_path, tenant_id::text || '/')),
  recipient_email text check (recipient_email is null
    or (char_length(recipient_email) <= 254 and recipient_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  email_status text not null default 'not_sent' check (email_status in ('not_sent', 'queued', 'sent', 'bounced', 'review')),
  sent_at timestamptz,
  bounced_at timestamptz,
  bounce_reason text check (bounce_reason is null or char_length(bounce_reason) <= 500),
  household_group uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_welcome_packs_once_per_attempt unique (application_id),
  constraint tenant_welcome_packs_sent_dated check (email_status <> 'sent' or sent_at is not null),
  constraint tenant_welcome_packs_bounced_dated check (email_status <> 'bounced' or bounced_at is not null),
  constraint tenant_welcome_packs_addressed check (email_status not in ('queued', 'sent', 'bounced') or recipient_email is not null)
);
create index if not exists tenant_welcome_packs_tenant_idx on public.tenant_welcome_packs (tenant_id, email_status);
create index if not exists tenant_welcome_packs_household_idx on public.tenant_welcome_packs (household_group) where household_group is not null;

alter table public.tenant_welcome_packs enable row level security;
drop policy if exists tenant_welcome_packs_tenant_scoped on public.tenant_welcome_packs;
create policy tenant_welcome_packs_tenant_scoped on public.tenant_welcome_packs
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_welcome_packs to tenant_app;
grant select, insert, update on public.tenant_welcome_packs to service_role;

-- ── 4 · carrier portal register (3.22) ──────────────────────────────────────
create table if not exists public.tenant_carrier_portal_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  portal_url text not null check (char_length(portal_url) <= 500 and portal_url ~ '^https://[^/]+'),
  username text check (username is null or char_length(btrim(username)) between 1 and 200),
  writing_number text check (writing_number is null or char_length(btrim(writing_number)) between 1 and 120),
  mfa_type text not null default 'none' check (mfa_type in ('none', 'sms', 'app', 'email')),
  notes text check (notes is null or char_length(notes) <= 2000),
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);
create index if not exists tenant_carrier_portal_accounts_carrier_idx on public.tenant_carrier_portal_accounts (tenant_id, carrier_id);
create index if not exists tenant_carrier_portal_accounts_carrier_fk_idx on public.tenant_carrier_portal_accounts (carrier_id);

alter table public.tenant_carrier_portal_accounts enable row level security;
drop policy if exists tenant_carrier_portal_accounts_tenant_scoped on public.tenant_carrier_portal_accounts;
create policy tenant_carrier_portal_accounts_tenant_scoped on public.tenant_carrier_portal_accounts
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_carrier_portal_accounts to tenant_app;
grant select, insert, update, delete on public.tenant_carrier_portal_accounts to service_role;

drop trigger if exists tenant_application_requirements_touch on public.tenant_application_requirements;
create trigger tenant_application_requirements_touch before update on public.tenant_application_requirements
  for each row execute function public.la3_touch_updated_at();
drop trigger if exists tenant_application_counteroffers_touch on public.tenant_application_counteroffers;
create trigger tenant_application_counteroffers_touch before update on public.tenant_application_counteroffers
  for each row execute function public.la3_touch_updated_at();
drop trigger if exists tenant_welcome_packs_touch on public.tenant_welcome_packs;
create trigger tenant_welcome_packs_touch before update on public.tenant_welcome_packs
  for each row execute function public.la3_touch_updated_at();
drop trigger if exists tenant_carrier_portal_accounts_touch on public.tenant_carrier_portal_accounts;
create trigger tenant_carrier_portal_accounts_touch before update on public.tenant_carrier_portal_accounts
  for each row execute function public.la3_touch_updated_at();

-- ── 5 · checks ──────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'tenant_carrier_portal_accounts') then
    raise exception '20260926101100: tenant_carrier_portal_accounts is missing';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'tenant_carrier_portal_accounts'
                and column_name ~* '(pass|secret|token|pin|credential)') then
    raise exception '20260926101100: the portal register has a password, secret, token, PIN or credential column';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_application_requirements_exam_only_paramed' and contype = 'c') then
    raise exception '20260926101100: exam dates can sit on a requirement that is not a paramed exam';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_welcome_packs_once_per_attempt' and contype = 'u') then
    raise exception '20260926101100: more than one welcome pack per attempt is possible';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public'
                and table_name in ('tenant_application_counteroffers', 'tenant_application_requirements')
                and column_name like '%cents' and data_type <> 'bigint') then
    raise exception '20260926101100: a money column is not bigint cents';
  end if;
  if has_table_privilege('service_role', 'public.tenant_application_counteroffers', 'DELETE') then
    raise exception '20260926101100: counteroffers can be deleted';
  end if;
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = 'public.tenant_application_requirements'::regclass and c.contype = 'f'
                    and c.confrelid = 'public.tenant_callbacks'::regclass and c.confdeltype = 'n') then
    raise exception '20260926101100: requirement.callback_id is not a set-null foreign key to tenant_callbacks';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260926101100', 'la_3_18_26_20_22_after_submit') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [14/23] 20260926101200_la_3_21_sales_report.sql ───────────────────────────────
begin;

-- LA-3 step 24 — the sales report (LA-3.21).
--
-- docs/la3/SCHEMA-PLAN.md "Step 24" is the specification. In short:
--
--   mv_la3_funnel               MATVIEW  per tenant, local day, carrier, product, case source, campaign,
--                                        producer: quoted leads, attempts reaching ready, submitted, issued
--   mv_la3_declines             MATVIEW  per tenant, local day, carrier, outcome, reason code: closed attempts
--                                        that did not issue
--   mv_la3_counteroffers        MATVIEW  per tenant, local day, carrier, status: counteroffers received
--   la3_sales_report()          NEW      security definer reader, filtered by tenant; service_role only
--   la3_refresh_sales_report()  NEW      refreshes all three concurrently; service_role only
--
-- Materialised views cannot carry RLS, so they are revoked from tenant_app, anon and authenticated
-- and read only through la3_sales_report(), which filters on the tenant it is given. Each view has a
-- plain unique index over its grouping columns (NULLS NOT DISTINCT, PostgreSQL 15+) so it can be
-- refreshed concurrently. Scheduling the refresh (pg_cron, with the check block that runs the job
-- once — memory: pg_cron jobs fail silently) is left to the step that turns the report on;
-- mv_la3_timing is not built yet.
--
-- Counting rules, stated because the data has no status history:
--   · "local day" is the tenant's agency_profiles.timezone when it is a real zone name, else UTC;
--   · a quoted lead counts once, on the day and against the carrier / product / producer of its
--     FIRST quote, so a day's or a carrier's counts add up to the tenant's total exactly;
--   · "reached ready" is inferred — nothing records the moment an attempt became ready. An attempt
--     counts if it is ready or later, or was ever submitted, on its submission day (or, while it is
--     still ready, the day it was last updated). An attempt that was ready and then withdrawn
--     without submitting is not counted;
--   · the producer is the user who created the quote or the attempt;
--   · "placed" (first draft collected) is NOT computed: no first-draft result exists anywhere yet.
--     la3_sales_report returns placed = null and lists it under `partial`.
--
-- Down:
--   drop function public.la3_sales_report(uuid, date, date), public.la3_refresh_sales_report();
--   drop materialized view public.mv_la3_counteroffers, public.mv_la3_declines, public.mv_la3_funnel;

-- ── 1 · funnel ──────────────────────────────────────────────────────────────
create materialized view if not exists public.mv_la3_funnel as
with tz as (
  select t.id as tenant_id, coalesce(z.name, 'UTC') as tz
    from public.tenants t
    left join public.agency_profiles ap on ap.tenant_id = t.id
    left join pg_catalog.pg_timezone_names z on z.name = ap.timezone
),
first_quote as (
  select distinct on (q.tenant_id, q.lead_id)
         q.tenant_id, q.case_id, q.carrier_id, q.product_code, q.created_by as producer_id, q.created_at as at
    from public.tenant_quotes q
   order by q.tenant_id, q.lead_id, q.created_at, q.id
),
events as (
  select fq.tenant_id, fq.at, fq.carrier_id, fq.product_code, fq.case_id, fq.producer_id,
         1 as quoted, 0 as ready, 0 as submitted, 0 as issued
    from first_quote fq
  union all
  select a.tenant_id, coalesce(a.submitted_at, a.updated_at), a.carrier_id, a.product_code, a.case_id, a.created_by,
         0, 1, 0, 0
    from public.tenant_applications a
   where a.submitted_at is not null
      or a.status in ('ready', 'submitted', 'pending_carrier', 'counteroffer_pending')
  union all
  select a.tenant_id, a.submitted_at, a.carrier_id, a.product_code, a.case_id, a.created_by,
         0, 0, 1, 0
    from public.tenant_applications a
   where a.submitted_at is not null
  union all
  select a.tenant_id, a.outcome_recorded_at, a.carrier_id, a.product_code, a.case_id, a.created_by,
         0, 0, 0, 1
    from public.tenant_applications a
   where a.status = 'closed' and a.outcome = 'issued' and a.outcome_recorded_at is not null
)
select e.tenant_id,
       (e.at at time zone tz.tz)::date as day,
       e.carrier_id,
       e.product_code,
       c.source as case_source,
       c.campaign_id,
       e.producer_id,
       sum(e.quoted)::bigint as quoted_leads,
       sum(e.ready)::bigint as reached_ready,
       sum(e.submitted)::bigint as submitted,
       sum(e.issued)::bigint as issued
  from events e
  join tz on tz.tenant_id = e.tenant_id
  join public.tenant_application_cases c on c.id = e.case_id
 group by e.tenant_id, (e.at at time zone tz.tz)::date, e.carrier_id, e.product_code, c.source, c.campaign_id, e.producer_id
with data;

create unique index if not exists mv_la3_funnel_key
  on public.mv_la3_funnel (tenant_id, day, carrier_id, product_code, case_source, campaign_id, producer_id) nulls not distinct;

-- ── 2 · declines (every closed attempt that did not issue) ──────────────────
create materialized view if not exists public.mv_la3_declines as
with tz as (
  select t.id as tenant_id, coalesce(z.name, 'UTC') as tz
    from public.tenants t
    left join public.agency_profiles ap on ap.tenant_id = t.id
    left join pg_catalog.pg_timezone_names z on z.name = ap.timezone
)
select a.tenant_id,
       (a.outcome_recorded_at at time zone tz.tz)::date as day,
       a.carrier_id,
       a.outcome,
       a.outcome_reason_code as reason_code,
       count(*)::bigint as attempts
  from public.tenant_applications a
  join tz on tz.tenant_id = a.tenant_id
 where a.status = 'closed' and a.outcome <> 'issued' and a.outcome_recorded_at is not null
 group by a.tenant_id, (a.outcome_recorded_at at time zone tz.tz)::date, a.carrier_id, a.outcome, a.outcome_reason_code
with data;

create unique index if not exists mv_la3_declines_key
  on public.mv_la3_declines (tenant_id, day, carrier_id, outcome, reason_code) nulls not distinct;

-- ── 3 · counteroffers ───────────────────────────────────────────────────────
create materialized view if not exists public.mv_la3_counteroffers as
with tz as (
  select t.id as tenant_id, coalesce(z.name, 'UTC') as tz
    from public.tenants t
    left join public.agency_profiles ap on ap.tenant_id = t.id
    left join pg_catalog.pg_timezone_names z on z.name = ap.timezone
)
select o.tenant_id,
       (o.received_at at time zone tz.tz)::date as day,
       a.carrier_id,
       o.status,
       count(*)::bigint as counteroffers,
       coalesce(sum(o.offered_face_cents), 0)::bigint as offered_face_cents
  from public.tenant_application_counteroffers o
  join public.tenant_applications a on a.id = o.application_id and a.tenant_id = o.tenant_id
  join tz on tz.tenant_id = o.tenant_id
 group by o.tenant_id, (o.received_at at time zone tz.tz)::date, a.carrier_id, o.status
with data;

create unique index if not exists mv_la3_counteroffers_key
  on public.mv_la3_counteroffers (tenant_id, day, carrier_id, status) nulls not distinct;

-- No RLS on a materialised view: nobody but the owner and service_role reads these directly.
revoke all on public.mv_la3_funnel from public, anon, authenticated, tenant_app;
revoke all on public.mv_la3_declines from public, anon, authenticated, tenant_app;
revoke all on public.mv_la3_counteroffers from public, anon, authenticated, tenant_app;

-- ── 4 · the reader ──────────────────────────────────────────────────────────
create or replace function public.la3_sales_report(p_tenant_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_report jsonb;
begin
  if p_tenant_id is null or p_from is null or p_to is null or p_from > p_to then
    raise exception 'SALES_REPORT_RANGE_INVALID';
  end if;

  select jsonb_build_object(
    'tenant_id', p_tenant_id,
    'from', p_from,
    'to', p_to,
    'totals', (
      select jsonb_build_object(
        'quoted_leads', coalesce(sum(f.quoted_leads), 0),
        'reached_ready', coalesce(sum(f.reached_ready), 0),
        'submitted', coalesce(sum(f.submitted), 0),
        'issued', coalesce(sum(f.issued), 0),
        'placed', null)
        from mv_la3_funnel f
       where f.tenant_id = p_tenant_id and f.day between p_from and p_to),
    'funnel', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day', f.day, 'carrier_id', f.carrier_id, 'product_code', f.product_code,
               'case_source', f.case_source, 'campaign_id', f.campaign_id, 'producer_id', f.producer_id,
               'quoted_leads', f.quoted_leads, 'reached_ready', f.reached_ready,
               'submitted', f.submitted, 'issued', f.issued, 'placed', null)
             order by f.day, f.carrier_id, f.product_code, f.producer_id)
        from mv_la3_funnel f
       where f.tenant_id = p_tenant_id and f.day between p_from and p_to), '[]'::jsonb),
    'declines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day', d.day, 'carrier_id', d.carrier_id, 'outcome', d.outcome,
               'reason_code', d.reason_code, 'attempts', d.attempts)
             order by d.day, d.carrier_id, d.outcome, d.reason_code)
        from mv_la3_declines d
       where d.tenant_id = p_tenant_id and d.day between p_from and p_to), '[]'::jsonb),
    'counteroffers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day', o.day, 'carrier_id', o.carrier_id, 'status', o.status,
               'counteroffers', o.counteroffers, 'offered_face_cents', o.offered_face_cents)
             order by o.day, o.carrier_id, o.status)
        from mv_la3_counteroffers o
       where o.tenant_id = p_tenant_id and o.day between p_from and p_to), '[]'::jsonb),
    'placed', null,
    'partial', jsonb_build_array('placed')
  ) into v_report;

  return v_report;
end;
$function$;

revoke all on function public.la3_sales_report(uuid, date, date) from public, anon, authenticated, tenant_app;
grant execute on function public.la3_sales_report(uuid, date, date) to service_role;

create or replace function public.la3_refresh_sales_report()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  refresh materialized view concurrently public.mv_la3_funnel;
  refresh materialized view concurrently public.mv_la3_declines;
  refresh materialized view concurrently public.mv_la3_counteroffers;
end;
$function$;

revoke all on function public.la3_refresh_sales_report() from public, anon, authenticated, tenant_app;
grant execute on function public.la3_refresh_sales_report() to service_role;

-- ── 5 · checks ──────────────────────────────────────────────────────────────
do $$
declare
  v_report jsonb := public.la3_sales_report('00000000-0000-0000-0000-000000000000'::uuid, current_date - 30, current_date);
begin
  if not (v_report ? 'totals' and v_report ? 'funnel' and v_report ? 'declines' and v_report ? 'counteroffers')
     or v_report->'placed' <> 'null'::jsonb
     or v_report->'totals'->'placed' <> 'null'::jsonb then
    raise exception '20260926101200: la3_sales_report does not return the report shape with placed = null';
  end if;
  if (select count(*) from pg_index i join pg_class c on c.oid = i.indexrelid
       where c.relname in ('mv_la3_funnel_key', 'mv_la3_declines_key', 'mv_la3_counteroffers_key')
         and i.indisunique and i.indpred is null and i.indexprs is null) <> 3 then
    raise exception '20260926101200: a sales report view cannot be refreshed concurrently';
  end if;
  if has_table_privilege('tenant_app', 'public.mv_la3_funnel', 'SELECT')
     or has_table_privilege('anon', 'public.mv_la3_declines', 'SELECT')
     or has_table_privilege('authenticated', 'public.mv_la3_counteroffers', 'SELECT') then
    raise exception '20260926101200: a sales report view is readable without the tenant filter';
  end if;
  if has_function_privilege('tenant_app', 'public.la3_sales_report(uuid, date, date)', 'execute') then
    raise exception '20260926101200: la3_sales_report is callable by tenant_app';
  end if;
  if (select count(*) from pg_matviews where schemaname = 'public'
        and matviewname in ('mv_la3_funnel', 'mv_la3_declines', 'mv_la3_counteroffers')) <> 3 then
    raise exception '20260926101200: a sales report materialised view is missing';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260926101200', 'la_3_21_sales_report') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [15/23] 20260926102200_la_3_18_requirement_callbacks.sql ──────────────────────
begin;

-- LA-3.18 — a carrier requirement books a callback that links back to it.
--
-- tenant_callbacks has exactly one creator today, complete_disposition_with_callback(), and it only
-- works as the outcome of a claimed dial (it completes the disposition too). A requirement chase is
-- not a dial outcome, so this is the second creator: the same validation (timezone, future time,
-- active assignee, note length), the same history row and the same audit action, and it writes the
-- new callback's id onto the requirement (callback_id, set-null FK from 20260926101100).
--
--   la3_requirement_callback(tenant, requirement, actor, local time, customer timezone, note)
--       -> (callback_id, scheduled_at_utc)
--
-- The callback sits on the case's work item (tenant_application_cases.work_item_id), or the lead's
-- newest one when the case has none. tenant_callbacks_replace_open_one (20260925708500) already
-- cancels any other open callback on the lead with a 'replaced' history row, so booking here never
-- trips tenant_callbacks_active_work_item_idx.
--
-- Down:
--   drop function public.la3_requirement_callback(uuid, uuid, uuid, timestamp without time zone, text, text);

create or replace function public.la3_requirement_callback(
  p_tenant_id uuid,
  p_requirement_id uuid,
  p_actor uuid,
  p_callback_local timestamp without time zone,
  p_customer_timezone text,
  p_note text default null
)
returns table(callback_id uuid, scheduled_at_utc timestamptz)
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
#variable_conflict use_column
declare
  r record;
  v_case record;
  v_work_item uuid;
  v_scheduled_at timestamptz;
  v_callback public.tenant_callbacks;
  v_note text;
begin
  select q.id, q.application_id, q.status, q.kind, a.case_id, a.lead_id
    into r
    from tenant_application_requirements q
    join tenant_applications a on a.id = q.application_id and a.tenant_id = q.tenant_id
   where q.id = p_requirement_id and q.tenant_id = p_tenant_id
   for update of q;
  if not found then raise exception 'REQUIREMENT_NOT_FOUND'; end if;
  if r.status not in ('open', 'in_progress') then raise exception 'REQUIREMENT_CLOSED'; end if;

  if p_callback_local is null then raise exception 'CALLBACK_DATE_REQUIRED'; end if;
  if not exists (select 1 from pg_timezone_names where name = btrim(coalesce(p_customer_timezone, ''))) then
    raise exception 'CALLBACK_TIMEZONE_INVALID';
  end if;
  v_scheduled_at := p_callback_local at time zone btrim(p_customer_timezone);
  if v_scheduled_at <= now() then raise exception 'CALLBACK_DATE_PAST'; end if;
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 1000 then raise exception 'CALLBACK_NOTE_INVALID'; end if;
  if not exists (
    select 1 from tenant_users tu join users u on u.id = tu.user_id
     where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and tu.accepted_at is not null and u.status = 'active'
  ) then raise exception 'CALLBACK_ASSIGNEE_INVALID'; end if;

  select c.work_item_id into v_case from tenant_application_cases c where c.id = r.case_id and c.tenant_id = p_tenant_id;
  v_work_item := v_case.work_item_id;
  if v_work_item is null then
    select lq.id into v_work_item from lead_queue lq
     where lq.tenant_id = p_tenant_id and lq.lead_id = r.lead_id
     order by lq.created_at desc limit 1;
  end if;
  if v_work_item is null then raise exception 'REQUIREMENT_CALLBACK_NO_WORK_ITEM'; end if;

  insert into tenant_callbacks (tenant_id, lead_id, work_item_id, scheduled_at_utc, customer_timezone, assigned_to, note, status, created_by)
  values (p_tenant_id, r.lead_id, v_work_item, v_scheduled_at, btrim(p_customer_timezone), p_actor, v_note, 'scheduled', p_actor)
  returning * into v_callback;

  insert into callback_history (tenant_id, callback_id, lead_id, actor_user_id, action, new_scheduled_at_utc, new_status, note)
  values (p_tenant_id, v_callback.id, r.lead_id, p_actor, 'scheduled', v_callback.scheduled_at_utc, v_callback.status, v_callback.note);

  update tenant_application_requirements q
     set callback_id = v_callback.id, last_chased_at = now(), chase_count = q.chase_count + 1
   where q.id = r.id;

  insert into audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_actor, 'tenant.callback_scheduled', 'callback', v_callback.id::text,
          jsonb_build_object('leadId', r.lead_id, 'workItemId', v_work_item, 'scheduledAtUtc', v_callback.scheduled_at_utc,
                             'customerTimezone', v_callback.customer_timezone, 'requirementId', r.id, 'applicationId', r.application_id));

  return query select v_callback.id, v_callback.scheduled_at_utc;
end;
$function$;

revoke all on function public.la3_requirement_callback(uuid, uuid, uuid, timestamp without time zone, text, text) from public, anon, authenticated;
grant execute on function public.la3_requirement_callback(uuid, uuid, uuid, timestamp without time zone, text, text) to service_role;

-- ── checks ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'la3_requirement_callback' and prosecdef) then
    raise exception '20260926102200: la3_requirement_callback is missing or not security definer';
  end if;
  if has_function_privilege('tenant_app', 'public.la3_requirement_callback(uuid, uuid, uuid, timestamp without time zone, text, text)', 'execute') then
    raise exception '20260926102200: la3_requirement_callback is callable by tenant_app';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260926102200', 'la_3_18_requirement_callbacks') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [16/23] 20260926102210_la_3_26_counteroffer_expiry.sql ────────────────────────
begin;

-- LA-3.26 — counteroffers: the effective dates the delta view compares, and the expiry sweep.
--
--   tenant_application_counteroffers  +2 columns  applied_effective_on, offered_effective_on — the
--                                                 policy date the client applied for and the one the
--                                                 carrier offered, read off the carrier's notice
--   la3_expire_counteroffers()        NEW         every pending_client offer past expires_at →
--                                                 counteroffer 'expired', its waiting-on-client
--                                                 requirement 'expired', and the attempt closed as
--                                                 offer_expired through application_transition()
--
-- The function is callable by service_role only and is not scheduled here (no pg_cron job): the
-- app or a later step runs it. It never deletes a counteroffer (DELETE is revoked on the table).
--
-- Down:
--   drop function public.la3_expire_counteroffers();
--   alter table public.tenant_application_counteroffers drop column applied_effective_on, drop column offered_effective_on;

alter table public.tenant_application_counteroffers
  add column if not exists applied_effective_on date,
  add column if not exists offered_effective_on date;

create or replace function public.la3_expire_counteroffers()
returns table(counteroffer_id uuid, application_id uuid)
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
#variable_conflict use_column
declare
  o record;
begin
  for o in
    select c.id, c.tenant_id, c.application_id, c.requirement_id
      from tenant_application_counteroffers c
      join tenant_applications a on a.id = c.application_id and a.tenant_id = c.tenant_id
     where c.status = 'pending_client'
       and c.expires_at is not null
       and c.expires_at < now()
       and a.status = 'counteroffer_pending'
     order by c.expires_at
     for update of c skip locked
  loop
    update tenant_application_counteroffers set status = 'expired' where id = o.id;
    if o.requirement_id is not null then
      update tenant_application_requirements set status = 'expired' where id = o.requirement_id and status in ('open', 'in_progress');
    end if;
    -- The system closes it: no actor, the outcome says why (STATUS-MODEL §3, offer_expired).
    perform public.application_transition(o.tenant_id, o.application_id, null, 'closed', 'offer_expired', null, null);
    insert into audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
    values ('system', null, 'tenant.application_transitioned', 'tenant_application', o.application_id::text,
            jsonb_build_object('tenantId', o.tenant_id, 'to', 'closed', 'outcome', 'offer_expired', 'counterofferId', o.id));
    counteroffer_id := o.id;
    application_id := o.application_id;
    return next;
  end loop;
end;
$function$;

revoke all on function public.la3_expire_counteroffers() from public, anon, authenticated;
grant execute on function public.la3_expire_counteroffers() to service_role;

-- ── checks ──────────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'tenant_application_counteroffers'
         and column_name in ('applied_effective_on', 'offered_effective_on')) <> 2 then
    raise exception '20260926102210: the counteroffer effective-date columns are missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'la3_expire_counteroffers' and prosecdef) then
    raise exception '20260926102210: la3_expire_counteroffers is missing or not security definer';
  end if;
  if has_function_privilege('tenant_app', 'public.la3_expire_counteroffers()', 'execute') then
    raise exception '20260926102210: la3_expire_counteroffers is callable by tenant_app';
  end if;
  if position('delete' in lower((select prosrc from pg_proc where proname = 'la3_expire_counteroffers' limit 1))) > 0 then
    raise exception '20260926102210: la3_expire_counteroffers deletes something';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260926102210', 'la_3_26_counteroffer_expiry') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [17/23] 20260926102220_la_3_20_welcome_pack_delivery.sql ──────────────────────
begin;

-- LA-3.20 — welcome pack delivery state the application shows.
--
--   tenant_welcome_packs  +4 columns
--     send_note      why an email did not go out (no email on file, auto-send off, a locked fact
--                    missing, mail delivery disabled) — shown on the application, never a secret
--     pdf_version    1 for the pack generated on submit; +1 each time an accepted counteroffer
--                    reissues it (LA-3.26). Each version is its own object, so no PDF is altered.
--     reissued_at    when the latest version was generated after the first
--     generated_at   when the current PDF was written
--     sent_version   which pdf_version the client was emailed; an automatic send happens once per
--                    attempt, and only an agent's explicit "send the updated pack" mails a later one
--
-- The one-row-per-attempt constraint (tenant_welcome_packs_once_per_attempt) stays: a resubmission
-- to another carrier is a new attempt and so a new row, and the old attempt's row is untouched.
--
-- Down:
--   alter table public.tenant_welcome_packs drop column send_note, drop column pdf_version,
--     drop column reissued_at, drop column generated_at, drop column sent_version;

alter table public.tenant_welcome_packs
  add column if not exists send_note text check (send_note is null or char_length(send_note) <= 500),
  add column if not exists pdf_version integer not null default 1 check (pdf_version > 0),
  add column if not exists reissued_at timestamptz,
  add column if not exists generated_at timestamptz,
  add column if not exists sent_version integer check (sent_version is null or sent_version > 0);

-- Nothing deletes a welcome pack: it is the record of what the client was told.
revoke delete, truncate on public.tenant_welcome_packs from service_role, tenant_app, anon, authenticated;

-- ── checks ──────────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'tenant_welcome_packs'
         and column_name in ('send_note', 'pdf_version', 'reissued_at', 'generated_at', 'sent_version')) <> 5 then
    raise exception '20260926102220: the welcome pack delivery columns are missing';
  end if;
  if has_table_privilege('service_role', 'public.tenant_welcome_packs', 'DELETE') then
    raise exception '20260926102220: welcome packs can be deleted';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260926102220', 'la_3_20_welcome_pack_delivery') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [18/23] 20260926102230_la_3_24_household_draft_day.sql ────────────────────────
begin;

-- LA-3.24 — a spouse's draft day can follow the primary insured's.
--
-- Address and contact values carry tenant_application_values.linked_to_primary and the payment
-- method carries tenant_application_payment_methods.linked_to_primary (20260926100000). The draft
-- day lives on tenant_applications.draft_day, which had no link of its own, so "Both premiums leave
-- on the same day" had nowhere to be remembered — and nothing to detach.
--
--   tenant_applications  +1 column  draft_day_linked — spouse attempts only; the app copies the
--                                   primary's draft_day onto the spouse while it is true
--
-- Down:
--   alter table public.tenant_applications drop column draft_day_linked;

alter table public.tenant_applications
  add column if not exists draft_day_linked boolean not null default false;

alter table public.tenant_applications
  drop constraint if exists tenant_applications_draft_day_linked_spouse,
  add constraint tenant_applications_draft_day_linked_spouse
    check (not draft_day_linked or insured_role = 'spouse') not valid;
alter table public.tenant_applications validate constraint tenant_applications_draft_day_linked_spouse;

-- ── checks ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tenant_applications' and column_name = 'draft_day_linked') then
    raise exception '20260926102230: tenant_applications.draft_day_linked is missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_applications_draft_day_linked_spouse' and contype = 'c') then
    raise exception '20260926102230: a primary attempt could be linked to itself';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260926102230', 'la_3_24_household_draft_day') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [19/23] 20260926102300_la_3_18_requirement_chased_by.sql ──────────────────────
begin;

-- LA-3.18 — who logged the last chase on a carrier requirement.
--
-- The Pending cases board prints "Last chased · 25 Sep · Priya S."; tenant_application_requirements
-- (20260926101100) records when and how often, not who. This adds the one column. "Log a chase"
-- (app/api/app/pending/requirements/[id]/chase) sets chase_count + 1, last_chased_at = now() and
-- last_chased_by = the agent in one update. Until this is applied the route writes the first two and
-- the page shows the date alone.
--
-- Down (only while nothing reads it):
--   alter table public.tenant_application_requirements drop column last_chased_by;

alter table public.tenant_application_requirements
  add column if not exists last_chased_by uuid references public.users(id) on delete set null;

-- A chased-by without a chased-at is a chase nobody can date.
alter table public.tenant_application_requirements
  drop constraint if exists tenant_application_requirements_chased_by_dated,
  add constraint tenant_application_requirements_chased_by_dated
    check (last_chased_by is null or last_chased_at is not null) not valid;
alter table public.tenant_application_requirements validate constraint tenant_application_requirements_chased_by_dated;

create index if not exists tenant_application_requirements_chased_by_idx
  on public.tenant_application_requirements (last_chased_by) where last_chased_by is not null;

-- ── checks ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tenant_application_requirements'
                    and column_name = 'last_chased_by' and data_type = 'uuid') then
    raise exception '20260926102300: tenant_application_requirements.last_chased_by is missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_application_requirements_chased_by_dated' and convalidated) then
    raise exception '20260926102300: a chase can be attributed without a date';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260926102300', 'la_3_18_requirement_chased_by') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [20/23] 20260926102400_la_3_17_tenant_carrier_settings.sql ────────────────────
begin;

-- LA-3.17 / 3.22 — the agency's own facts about a platform carrier, and one portal account per carrier.
--
-- `carriers` rows with organization_id null are the Insurvas library, shared by every tenant: a
-- tenant must never write one. `carriers.organization_id` is the organization-era CRM, not a tenant,
-- so there is no tenant-owned carrier row to use. The agency's portal origin, reference pattern and
-- billing descriptor therefore live here, one row per (tenant, carrier), and every reader prefers
-- this row's non-null value over the platform one (lib/salesSettings/carriers.ts effectiveCarrierFacts).
-- A row with all three null still means "this carrier is on the agency's list" (Settings › Sales ›
-- Carriers and products › Add a carrier).
--
--   tenant_carrier_settings                 NEW    (tenant_id, carrier_id) primary key
--   tenant_carrier_portal_accounts          INDEX  unique (tenant_id, carrier_id): one account per carrier
--
-- Down (only while nothing reads it):
--   drop index public.tenant_carrier_portal_accounts_one_per_carrier;
--   drop table public.tenant_carrier_settings;

-- ── 1 · tenant carrier settings ─────────────────────────────────────────────
create table if not exists public.tenant_carrier_settings (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  portal_origin text
    constraint tenant_carrier_settings_portal_origin_https check (portal_origin is null or portal_origin ~ '^https://[^/]+$'),
  reference_pattern text
    constraint tenant_carrier_settings_reference_pattern_length check (reference_pattern is null or char_length(reference_pattern) between 1 and 200),
  billing_descriptor text
    constraint tenant_carrier_settings_billing_descriptor_length check (billing_descriptor is null or char_length(billing_descriptor) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  primary key (tenant_id, carrier_id)
);
create index if not exists tenant_carrier_settings_carrier_idx on public.tenant_carrier_settings (carrier_id);

alter table public.tenant_carrier_settings enable row level security;
drop policy if exists tenant_carrier_settings_tenant_scoped on public.tenant_carrier_settings;
create policy tenant_carrier_settings_tenant_scoped on public.tenant_carrier_settings
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_carrier_settings to tenant_app;
grant select, insert, update on public.tenant_carrier_settings to service_role;
-- A setting is changed, never erased: the audit row holds what it was before.
revoke delete, truncate on public.tenant_carrier_settings from service_role, tenant_app;

drop trigger if exists tenant_carrier_settings_touch on public.tenant_carrier_settings;
create trigger tenant_carrier_settings_touch before update on public.tenant_carrier_settings
  for each row execute function public.la3_touch_updated_at();

-- A tenant setting may only name a platform carrier (organization_id null), never another
-- organization's private row.
create or replace function public.tenant_carrier_settings_platform_carrier()
returns trigger language plpgsql as $function$
begin
  if not exists (select 1 from public.carriers c where c.id = new.carrier_id and c.organization_id is null) then
    raise exception 'TENANT_CARRIER_NOT_PLATFORM: carrier % is not in the platform library', new.carrier_id;
  end if;
  return new;
end;
$function$;

drop trigger if exists tenant_carrier_settings_platform_carrier on public.tenant_carrier_settings;
create trigger tenant_carrier_settings_platform_carrier before insert or update of carrier_id on public.tenant_carrier_settings
  for each row execute function public.tenant_carrier_settings_platform_carrier();

-- ── 2 · one portal account per carrier (3.22) ───────────────────────────────
create unique index if not exists tenant_carrier_portal_accounts_one_per_carrier
  on public.tenant_carrier_portal_accounts (tenant_id, carrier_id);

-- ── 3 · checks ──────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'tenant_carrier_settings') then
    raise exception '20260926102400: tenant_carrier_settings is missing';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'tenant_carrier_settings'
         and column_name in ('portal_origin', 'reference_pattern', 'billing_descriptor')) <> 3 then
    raise exception '20260926102400: tenant_carrier_settings lacks a carrier fact column';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name in ('tenant_carrier_settings', 'tenant_carrier_portal_accounts')
                and column_name ~* '(pass|secret|token|pin|credential)') then
    raise exception '20260926102400: a carrier settings table has a password, secret, token, PIN or credential column';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_carrier_settings_portal_origin_https' and contype = 'c') then
    raise exception '20260926102400: the tenant portal origin is not constrained to an https origin';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'tenant_carrier_portal_accounts_one_per_carrier') then
    raise exception '20260926102400: more than one portal account per carrier is possible';
  end if;
  if has_table_privilege('service_role', 'public.tenant_carrier_settings', 'DELETE') then
    raise exception '20260926102400: tenant carrier settings can be deleted';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260926102400', 'la_3_17_tenant_carrier_settings') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [21/23] 20260926102410_la_3_6_carrier_product_copies.sql ──────────────────────
begin;

-- LA-3.6 / 3.25 — "Copy to my agency" for a platform carrier product.
--
-- Platform product rows (tenant_id null) are shared, so an agency that wants different issue ages,
-- face limits, a different per-$1,000 band or other payment methods copies the row and edits its copy.
-- `copied_from_id` names the platform row a tenant row replaces, so a reader can show the agency's
-- copy in its place instead of both (lib/salesSettings/carriers.ts preferTenantCopies). The platform
-- row is never changed by a copy.
--
--   carrier_products   +1 column   copied_from_id → carrier_products (tenant rows only, one copy per row)
--
-- Down (only while no row has copied_from_id set):
--   drop index public.carrier_products_one_copy_per_source;
--   alter table public.carrier_products drop column copied_from_id;

alter table public.carrier_products
  add column if not exists copied_from_id uuid references public.carrier_products(id) on delete restrict;

alter table public.carrier_products
  drop constraint if exists carrier_products_copy_is_tenant_row,
  add constraint carrier_products_copy_is_tenant_row
    check (copied_from_id is null or tenant_id is not null) not valid;
alter table public.carrier_products validate constraint carrier_products_copy_is_tenant_row;

create unique index if not exists carrier_products_one_copy_per_source
  on public.carrier_products (tenant_id, copied_from_id) where copied_from_id is not null;

-- The source of a copy must be a platform row of the same carrier and product line.
create or replace function public.carrier_products_copy_source()
returns trigger language plpgsql as $function$
begin
  if new.copied_from_id is not null and not exists (
    select 1 from public.carrier_products s
     where s.id = new.copied_from_id and s.tenant_id is null
       and s.carrier_id = new.carrier_id and s.product_code = new.product_code) then
    raise exception 'CARRIER_PRODUCT_COPY_SOURCE: % is not a platform product of this carrier and product line', new.copied_from_id;
  end if;
  return new;
end;
$function$;

drop trigger if exists carrier_products_copy_source on public.carrier_products;
create trigger carrier_products_copy_source before insert or update of copied_from_id, carrier_id, product_code on public.carrier_products
  for each row execute function public.carrier_products_copy_source();

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'carrier_products' and column_name = 'copied_from_id') then
    raise exception '20260926102410: carrier_products.copied_from_id is missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'carrier_products_copy_is_tenant_row' and contype = 'c' and convalidated) then
    raise exception '20260926102410: a platform product can claim to be a copy';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'carrier_products_one_copy_per_source') then
    raise exception '20260926102410: an agency can copy the same platform product twice';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260926102410', 'la_3_6_carrier_product_copies') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [22/23] 20260926102500_la_3_10_disclosure_versions_frozen.sql ─────────────────
begin;

-- LA-3.10 — a published disclosure version never changes (the library's half of "a new disclosure
-- version does not change the version recorded on an acknowledged application").
--
-- 20260926100600 made the library; this freezes what an acknowledgement points at. In short:
--
--   application_disclosures        GUARD  a published or retired row changes only published → retired;
--                                         only a draft can be deleted
--   application_disclosure_rules   GUARD  the rules of a published or retired row never change
--   application_disclosures        INDEX  created_by (every FK gets its index — 2026-09-23 perf pass)
--
-- Editing a published disclosure makes version N + 1 as a draft (lib/salesSettings/disclosures.ts),
-- and tenant_application_disclosures keeps pointing at the row — so the text — it was acknowledged
-- on. The same rule as sales_templates_guard_published (20260926100100).
--
-- A tenant being deleted still cascades: by the time its rows are removed the tenant row is gone,
-- and the guard lets that through.
--
-- Down:
--   drop trigger if exists application_disclosures_guard on public.application_disclosures;
--   drop trigger if exists application_disclosure_rules_guard on public.application_disclosure_rules;
--   drop function if exists public.application_disclosures_guard(), public.application_disclosure_rules_guard();
--   drop index if exists public.application_disclosures_created_by_idx;

-- ── 1 · the disclosure row ──────────────────────────────────────────────────
create or replace function public.application_disclosures_guard()
returns trigger language plpgsql as $function$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft'
       and (old.tenant_id is null or exists (select 1 from public.tenants t where t.id = old.tenant_id)) then
      raise exception 'DISCLOSURE_PUBLISHED_IMMUTABLE: % v% is %, it cannot be deleted', old.code, old.version, old.status;
    end if;
    return old;
  end if;

  if old.status in ('published', 'retired') then
    -- created_by is left out: a deleted user sets it null, and that is not an edit of the text.
    if (new.tenant_id, new.code, new.title, new.body_markdown, new.attachment_path, new.states, new.carrier_ids, new.version)
       is distinct from
       (old.tenant_id, old.code, old.title, old.body_markdown, old.attachment_path, old.states, old.carrier_ids, old.version) then
      raise exception 'DISCLOSURE_PUBLISHED_IMMUTABLE: % v% is %; edit a new version instead', old.code, old.version, old.status;
    end if;
    if new.status is distinct from old.status and not (old.status = 'published' and new.status = 'retired') then
      raise exception 'DISCLOSURE_PUBLISHED_IMMUTABLE: % v% cannot go from % to %', old.code, old.version, old.status, new.status;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists application_disclosures_guard on public.application_disclosures;
create trigger application_disclosures_guard before update or delete on public.application_disclosures
  for each row execute function public.application_disclosures_guard();

-- ── 2 · its rules ───────────────────────────────────────────────────────────
-- A rule row of a published or retired disclosure cannot be added, changed or removed. When the
-- disclosure itself is being deleted (a draft, or a tenant cascade) its row is already gone here.
create or replace function public.application_disclosure_rules_guard()
returns trigger language plpgsql as $function$
begin
  if exists (select 1 from public.application_disclosures d
              where d.id in (case when tg_op <> 'INSERT' then old.disclosure_id end,
                             case when tg_op <> 'DELETE' then new.disclosure_id end)
                and d.status in ('published', 'retired')) then
    raise exception 'DISCLOSURE_PUBLISHED_IMMUTABLE: the rules of a published disclosure cannot change; edit a new version instead';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

drop trigger if exists application_disclosure_rules_guard on public.application_disclosure_rules;
create trigger application_disclosure_rules_guard before insert or update or delete on public.application_disclosure_rules
  for each row execute function public.application_disclosure_rules_guard();

create index if not exists application_disclosures_created_by_idx
  on public.application_disclosures (created_by) where created_by is not null;

-- ── 3 · checks ──────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_trigger
       where not tgisinternal
         and tgname in ('application_disclosures_guard', 'application_disclosure_rules_guard')) <> 2 then
    raise exception '20260926102500: the disclosure version guard is missing';
  end if;
end $$;

-- The guard, exercised on the seeded replacement notice: its text, its rules and a delete are all
-- refused. Nothing the probe does survives (every statement is refused, and the sentinel rolls back).
do $$
declare
  v_id uuid := (select id from public.application_disclosures
                 where tenant_id is null and code = 'REPLACEMENT_NOTICE' and status = 'published' order by version limit 1);
begin
  if v_id is null then
    raise notice '20260926102500: no published platform disclosure to probe the guard with; skipped';
    return;
  end if;
  begin
    begin
      update public.application_disclosures set title = title || ' (edited)' where id = v_id;
      raise exception '20260926102500: a published disclosure''s text was edited';
    exception when others then
      if sqlerrm not like 'DISCLOSURE_PUBLISHED_IMMUTABLE%' then raise; end if;
    end;
    begin
      insert into public.application_disclosure_rules (disclosure_id, clauses)
      values (v_id, '[{"field": "addr.state", "op": "eq", "value": "TX"}]'::jsonb);
      raise exception '20260926102500: a rule was added to a published disclosure';
    exception when others then
      if sqlerrm not like 'DISCLOSURE_PUBLISHED_IMMUTABLE%' then raise; end if;
    end;
    begin
      delete from public.application_disclosures where id = v_id;
      raise exception '20260926102500: a published disclosure was deleted';
    exception when others then
      if sqlerrm not like 'DISCLOSURE_PUBLISHED_IMMUTABLE%' then raise; end if;
    end;
    raise exception 'la3_probe_rollback';
  exception when others then
    if sqlerrm <> 'la3_probe_rollback' then raise; end if;
  end;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260926102500', 'la_3_10_disclosure_versions_frozen') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [23/23] 20260926102510_la_3_13_staff_map_approvers.sql ────────────────────────
begin;

-- LA-3.13 — staff can verify and publish the platform field maps.
--
-- 20260926100800 made the approver columns reference public.users, which holds agency people only.
-- Staff are public.admin_users, so the admin console could edit a platform map but never verify an
-- entry or publish it (lib/extension/maps.ts refused with FIELD_MAP_STAFF_APPROVER_PENDING). In short:
--
--   carrier_field_map.approved_by_admin        NEW    uuid → admin_users; the staff approver
--   carrier_field_map_entry.verified_by_admin  NEW    uuid → admin_users; the staff verifier
--   carrier_field_map_published_approved       CHECK  approved_by OR approved_by_admin, and approved_at
--   carrier_field_map_entry_verified_by        CHECK  verified needs verified_by OR verified_by_admin
--   carrier_field_map_guard()                  FUNC   same signature; approved_by_admin is frozen with
--                                                     approved_by once a map is published
--
-- Both columns are `on delete restrict`: who approved a published map is a record of fact, and the
-- CHECKs above would refuse the null a `set null` would write anyway. Staff are deactivated, never
-- deleted (nothing in lib/ deletes an admin_users row).
--
-- Down (only while no row has either new column set):
--   restore both CHECKs and carrier_field_map_guard() from 20260926100800;
--   alter table public.carrier_field_map drop column approved_by_admin;
--   alter table public.carrier_field_map_entry drop column verified_by_admin;

-- ── 1 · columns ─────────────────────────────────────────────────────────────
alter table public.carrier_field_map
  add column if not exists approved_by_admin uuid references public.admin_users(id) on delete restrict;
alter table public.carrier_field_map_entry
  add column if not exists verified_by_admin uuid references public.admin_users(id) on delete restrict;

create index if not exists carrier_field_map_approved_by_admin_idx
  on public.carrier_field_map (approved_by_admin) where approved_by_admin is not null;
create index if not exists carrier_field_map_entry_verified_by_admin_idx
  on public.carrier_field_map_entry (verified_by_admin) where verified_by_admin is not null;
-- 20260926100800 indexed verified_by but not approved_by.
create index if not exists carrier_field_map_approved_by_idx
  on public.carrier_field_map (approved_by) where approved_by is not null;

-- ── 2 · either approver satisfies the CHECKs ────────────────────────────────
alter table public.carrier_field_map
  drop constraint if exists carrier_field_map_published_approved,
  add constraint carrier_field_map_published_approved
    check (status <> 'published' or ((approved_by is not null or approved_by_admin is not null) and approved_at is not null));

alter table public.carrier_field_map_entry
  drop constraint if exists carrier_field_map_entry_verified_by,
  add constraint carrier_field_map_entry_verified_by
    check (not verified or verified_by is not null or verified_by_admin is not null);

-- ── 3 · the publish guard, approved_by_admin frozen like approved_by ────────
--
-- Identical to 20260926100800's except the frozen tuple, which now carries approved_by_admin.
create or replace function public.carrier_field_map_guard()
returns trigger language plpgsql as $function$
declare
  v_unverified text;
  v_frozen boolean;
begin
  if tg_op = 'INSERT' then
    if new.status = 'published' then
      raise exception 'CARRIER_FIELD_MAP_PUBLISH_ON_INSERT: insert the map as a draft, add its entries, then publish it';
    end if;
    return new;
  end if;

  v_frozen := old.status in ('published', 'retired') or (old.status = 'needs_review' and old.approved_at is not null);

  if tg_op = 'DELETE' then
    if v_frozen then
      raise exception 'CARRIER_FIELD_MAP_PUBLISHED_IMMUTABLE: map v% has been published and cannot be deleted', old.version;
    end if;
    return old;
  end if;

  if v_frozen then
    if (new.tenant_id, new.carrier_id, new.carrier_product_id, new.version, new.origin, new.created_by,
        new.approved_by, new.approved_by_admin, new.approved_at, new.proposal_source)
       is distinct from
       (old.tenant_id, old.carrier_id, old.carrier_product_id, old.version, old.origin, old.created_by,
        old.approved_by, old.approved_by_admin, old.approved_at, old.proposal_source) then
      raise exception 'CARRIER_FIELD_MAP_PUBLISHED_IMMUTABLE: map v% has been published; edit a new version instead', old.version;
    end if;
    if new.status is distinct from old.status
       and not ((old.status = 'published' and new.status in ('needs_review', 'retired'))
             or (old.status = 'needs_review' and new.status in ('published', 'retired'))) then
      raise exception 'CARRIER_FIELD_MAP_PUBLISHED_IMMUTABLE: map v% cannot go from % to %', old.version, old.status, new.status;
    end if;
    return new;
  end if;

  if new.status = 'published' and old.status is distinct from 'published' then
    select string_agg(distinct e.field_key, ', ' order by e.field_key) into v_unverified
      from public.carrier_field_map_entry e
      join public.carrier_field_map_step s on s.id = e.step_id
     where s.map_id = new.id
       and e.field_key in ('insured.ssn', 'pay.routing_number', 'pay.account_number', 'pay.card_number')
       and not e.verified;
    if v_unverified is not null then
      raise exception 'CARRIER_FIELD_MAP_SENSITIVE_UNVERIFIED: verify % before publishing', v_unverified;
    end if;
  end if;
  return new;
end;
$function$;

-- ── 4 · checks ──────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public'
         and ((table_name = 'carrier_field_map' and column_name = 'approved_by_admin')
           or (table_name = 'carrier_field_map_entry' and column_name = 'verified_by_admin'))) <> 2 then
    raise exception '20260926102510: a staff approver column is missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'carrier_field_map_published_approved'
                  and pg_get_constraintdef(oid) like '%approved_by_admin%') then
    raise exception '20260926102510: a published map still needs an agency approver';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'carrier_field_map_entry_verified_by'
                  and pg_get_constraintdef(oid) like '%verified_by_admin%') then
    raise exception '20260926102510: a verified entry still needs an agency verifier';
  end if;
  if position('approved_by_admin' in (select prosrc from pg_proc where proname = 'carrier_field_map_guard' limit 1)) = 0
     or position('insured.ssn' in (select prosrc from pg_proc where proname = 'carrier_field_map_guard' limit 1)) = 0 then
    raise exception '20260926102510: the publish guard does not freeze the staff approver, or lost the SSN rule';
  end if;
end $$;

-- A staff member verifies and publishes a platform map; the unverified-SSN rule still holds and the
-- staff approver is frozen once published. Everything the probe writes is undone by the sentinel.
do $$
declare
  v_carrier uuid := (select id from public.carriers order by created_at limit 1);
  v_admin uuid := (select id from public.admin_users order by created_at limit 1);
  v_other uuid := (select id from public.admin_users order by created_at offset 1 limit 1);
  v_map uuid;
  v_step uuid;
begin
  if v_carrier is null or v_admin is null then
    raise notice '20260926102510: no carrier or staff member to probe the staff approver with; skipped';
    return;
  end if;
  begin
    insert into public.carrier_field_map (tenant_id, carrier_id, version, status)
    values (null, v_carrier, 999998, 'draft') returning id into v_map;
    insert into public.carrier_field_map_step (map_id, page_key, url_pattern)
    values (v_map, 'probe', '/probe') returning id into v_step;
    insert into public.carrier_field_map_entry (step_id, field_key, selector, input_kind)
    values (v_step, 'insured.ssn', '#ssn', 'masked');

    begin
      update public.carrier_field_map set status = 'published', approved_by_admin = v_admin, approved_at = now() where id = v_map;
      raise exception '20260926102510: a map with an unverified SSN entry was published by staff';
    exception when others then
      if sqlerrm not like 'CARRIER_FIELD_MAP_SENSITIVE_UNVERIFIED%' then raise; end if;
    end;

    update public.carrier_field_map_entry set verified = true, verified_by_admin = v_admin where step_id = v_step;
    update public.carrier_field_map set status = 'published', approved_by_admin = v_admin, approved_at = now() where id = v_map;

    begin
      update public.carrier_field_map set approved_by_admin = coalesce(v_other, v_admin), approved_at = now() - interval '1 day' where id = v_map;
      raise exception '20260926102510: the staff approver of a published map was changed';
    exception when others then
      if sqlerrm not like 'CARRIER_FIELD_MAP_PUBLISHED_IMMUTABLE%' then raise; end if;
    end;

    raise exception 'la3_probe_rollback';
  exception when others then
    if sqlerrm <> 'la3_probe_rollback' then raise; end if;
  end;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260926102510', 'la_3_13_staff_map_approvers') on conflict do nothing;
  end if;
end $bundle$;
commit;
