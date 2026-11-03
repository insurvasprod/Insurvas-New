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
