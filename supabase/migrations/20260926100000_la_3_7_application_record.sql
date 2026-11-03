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
