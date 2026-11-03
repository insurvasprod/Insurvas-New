-- LA-4.17 (Notion sprint) · carrier rules and retention windows: one place for every per-carrier
-- number a countdown, an alert or an expected figure depends on. Nothing is hard-coded.
--
--   · carrier_retention_rule: how many days a carrier gives for each kind of save (first payment,
--     ongoing payment, reinstatement, conservation, a cancellation request), its grace and redrafts.
--     tenant_id null is the platform default; an agency's own row overrides it. Rules are EFFECTIVE-
--     DATED and append-only: a change is a new row from a date, never an edit, so what a past
--     retention action was measured against stays as it was. An agency can clear its override (back
--     to the platform's); nothing ever falls back to an invented default — no rule is null, and a
--     null window means a null countdown (LA-4.7) and a labelled group on the board (LA-4.16).
--     Every rule says where it came from (the carrier's agreement, a phone call, or observed) and
--     who verified it; an unverified rule is used, and shown as unverified wherever it appears.
--   · carrier_operating_settings: the carrier's other settings, one row per carrier (platform, then
--     the agency's own): when commission triggers and how long it lags (LA-4.13), the minimum payout
--     and the tolerance (LA-4.13/4.15), how often files arrive (LA-4.19) and in what format.
--   · in_force_policy_counts: an agency's in-force policies per carrier, from its latest snapshots —
--     what the coverage screen says each missing rule affects.
--
-- Seeded from the spec, marked observed and unverified: a 45-day ongoing-payment window for Aetna
-- (Aflac and American Home Life share it, but are not in the carrier library yet) and Americo's
-- first-payment window of about eight days. Everything else ships absent, visibly.
--
-- Additive. Requires 20261008140000 (policy_snapshot).
--
-- Rollback:
--   drop function if exists public.in_force_policy_counts(uuid);
--   drop table if exists public.carrier_operating_settings, public.carrier_retention_rule;

create table if not exists public.carrier_retention_rule (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  rule_type text not null,
  window_days integer,
  grace_days integer,
  redraft_attempts integer,
  redraft_interval_days integer,
  notes text,
  source text,
  effective_from date not null default current_date,
  cleared boolean not null default false,
  created_by uuid references public.users(id) on delete set null,
  created_by_admin uuid references public.admin_users(id) on delete set null,
  verified_by uuid references public.users(id) on delete set null,
  verified_by_admin uuid references public.admin_users(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint carrier_retention_rule_type check (rule_type in ('first_payment', 'ongoing_payment', 'reinstatement', 'conservation', 'cancellation_request')),
  constraint carrier_retention_rule_days check (
    (window_days is null or window_days between 0 and 730) and (grace_days is null or grace_days between 0 and 730)
    and (redraft_attempts is null or redraft_attempts between 0 and 12) and (redraft_interval_days is null or redraft_interval_days between 0 and 90)
  ),
  constraint carrier_retention_rule_source check (source is null or source in ('carrier_agreement', 'phone_call', 'observed')),
  -- A rule says where it came from; clearing an override says nothing but "use the platform's".
  constraint carrier_retention_rule_sourced check (cleared or source is not null),
  constraint carrier_retention_rule_cleared check (
    not cleared or (tenant_id is not null and window_days is null and grace_days is null and redraft_attempts is null and redraft_interval_days is null)
  ),
  constraint carrier_retention_rule_has_value check (cleared or window_days is not null or grace_days is not null or redraft_attempts is not null),
  constraint carrier_retention_rule_verified check ((verified_at is null) = (verified_by is null and verified_by_admin is null)),
  constraint carrier_retention_rule_notes check (notes is null or char_length(notes) <= 1000)
);
-- The rule in force on a date: the latest effective_from on or before it, the newest row of that day.
create index if not exists carrier_retention_rule_version_idx
  on public.carrier_retention_rule (carrier_id, rule_type, tenant_id, effective_from desc, created_at desc);
create index if not exists carrier_retention_rule_lookup_idx on public.carrier_retention_rule (carrier_id, rule_type, effective_from desc);
create index if not exists carrier_retention_rule_tenant_idx on public.carrier_retention_rule (tenant_id);
create index if not exists carrier_retention_rule_created_by_idx on public.carrier_retention_rule (created_by);
create index if not exists carrier_retention_rule_created_by_admin_idx on public.carrier_retention_rule (created_by_admin);
create index if not exists carrier_retention_rule_verified_by_idx on public.carrier_retention_rule (verified_by);
create index if not exists carrier_retention_rule_verified_by_admin_idx on public.carrier_retention_rule (verified_by_admin);

-- Append-only: a rule is never edited or removed. The one change allowed is verifying it, once.
create or replace function public.carrier_retention_rule_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A carrier rule is never removed; add a new one from a date, or clear the override.' using errcode = 'P0001';
  end if;
  if old.verified_at is null and new.verified_at is not null
     and (to_jsonb(new) - 'verified_by' - 'verified_by_admin' - 'verified_at') = (to_jsonb(old) - 'verified_by' - 'verified_by_admin' - 'verified_at') then
    return new;
  end if;
  raise exception 'A carrier rule is never edited; add a new one from a date.' using errcode = 'P0001';
end;
$$;
drop trigger if exists carrier_retention_rule_guard on public.carrier_retention_rule;
create trigger carrier_retention_rule_guard before update or delete on public.carrier_retention_rule
  for each row execute function public.carrier_retention_rule_guard();

create table if not exists public.carrier_operating_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  commission_trigger text,
  expected_lag_days integer,
  minimum_payout_cents bigint,
  tolerance_cents bigint,
  expected_cadence text,
  statement_format text,
  updated_by uuid references public.users(id) on delete set null,
  updated_by_admin uuid references public.admin_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint carrier_operating_settings_trigger check (commission_trigger is null or commission_trigger in ('on_issue', 'on_first_draft')),
  constraint carrier_operating_settings_lag check (expected_lag_days is null or expected_lag_days between 0 and 365),
  constraint carrier_operating_settings_money check ((minimum_payout_cents is null or minimum_payout_cents >= 0) and (tolerance_cents is null or tolerance_cents between 0 and 100000)),
  constraint carrier_operating_settings_cadence check (expected_cadence is null or expected_cadence in ('daily', 'weekly', 'monthly', 'ad_hoc')),
  constraint carrier_operating_settings_format check (statement_format is null or statement_format in ('spreadsheet', 'pdf'))
);
create unique index if not exists carrier_operating_settings_scope_key
  on public.carrier_operating_settings (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), carrier_id);
create index if not exists carrier_operating_settings_carrier_idx on public.carrier_operating_settings (carrier_id);
create index if not exists carrier_operating_settings_tenant_idx on public.carrier_operating_settings (tenant_id);
create index if not exists carrier_operating_settings_updated_by_idx on public.carrier_operating_settings (updated_by);
create index if not exists carrier_operating_settings_updated_by_admin_idx on public.carrier_operating_settings (updated_by_admin);

-- An agency's in-force policies per carrier: each policy's latest current snapshot, active or at risk.
create or replace function public.in_force_policy_counts(p_tenant_id uuid)
returns table (carrier_id uuid, policies bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select latest.carrier_id, count(*)
    from (
      select distinct on (s.carrier_id, s.policy_number) s.carrier_id, s.status_normalized
        from public.policy_snapshot s
       where s.tenant_id = p_tenant_id and not s.superseded
       order by s.carrier_id, s.policy_number, s.snapshot_date desc
    ) latest
   where latest.status_normalized in ('active', 'at_risk')
   group by latest.carrier_id;
$$;
revoke all on function public.in_force_policy_counts(uuid) from public, anon, authenticated;
grant execute on function public.in_force_policy_counts(uuid) to service_role;

alter table public.carrier_retention_rule enable row level security;
alter table public.carrier_operating_settings enable row level security;
drop policy if exists carrier_retention_rule_read on public.carrier_retention_rule;
create policy carrier_retention_rule_read on public.carrier_retention_rule for select to tenant_app
  using (tenant_id is null or tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists carrier_operating_settings_read on public.carrier_operating_settings;
create policy carrier_operating_settings_read on public.carrier_operating_settings for select to tenant_app
  using (tenant_id is null or tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.carrier_retention_rule, public.carrier_operating_settings from public, anon, authenticated;
revoke delete, truncate on public.carrier_retention_rule from service_role, tenant_app;
revoke truncate on public.carrier_operating_settings from service_role, tenant_app;
grant select, insert, update on public.carrier_retention_rule to service_role;
grant select, insert, update, delete on public.carrier_operating_settings to service_role;
grant select on public.carrier_retention_rule, public.carrier_operating_settings to tenant_app;

-- ─── the spec's observed seeds, unverified ─────────────────────────────────────────────────────
insert into public.carrier_retention_rule (carrier_id, rule_type, window_days, source, effective_from, notes)
select c.id, 'ongoing_payment', 45, 'observed', date '2026-10-05',
       'Seeded from the Module 4 BRD: 45 days after the paid-to date (shared by Aetna, Aflac and AHL). Unverified.'
  from public.carriers c where c.code = 'aetna'
   and not exists (select 1 from public.carrier_retention_rule r where r.carrier_id = c.id and r.tenant_id is null and r.rule_type = 'ongoing_payment');
insert into public.carrier_retention_rule (carrier_id, rule_type, window_days, source, effective_from, notes)
select c.id, 'first_payment', 8, 'observed', date '2026-10-05',
       'Seeded from the Module 4 BRD: about eight days for the first payment. Unverified.'
  from public.carriers c where c.code = 'americo'
   and not exists (select 1 from public.carrier_retention_rule r where r.carrier_id = c.id and r.tenant_id is null and r.rule_type = 'first_payment');

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'carrier_retention_rule_guard' and not tgisinternal) then
    raise exception '20261008150000: carrier rules are not append-only';
  end if;
  if has_table_privilege('service_role', 'public.carrier_retention_rule', 'DELETE') then
    raise exception '20261008150000: carrier rules can be deleted';
  end if;
  if not exists (select 1 from pg_proc where proname = 'in_force_policy_counts' and prosecdef) then
    raise exception '20261008150000: in_force_policy_counts is missing';
  end if;
  if exists (select 1 from public.carrier_retention_rule where verified_at is not null and created_at > now() - interval '1 minute') then
    raise exception '20261008150000: a seeded rule must not arrive verified';
  end if;
end $$;
