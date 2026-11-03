-- AG-0.1 (Notion sprint, Agency Module 0) · the agency record, the producer record, and the plan audience.
--
-- An agency is ONE tenant with many producers inside it (module doc §2.1). Nothing expressed that until now.
--
--   tenant_plan_audience(tenant)  'individual' | 'agency' | null. Derived from the plan_type the tenant's
--                     current plan already carries (individual / agency_no_teams / agency_with_teams), so
--                     there is no second "audience" column to drift from it (docs/agency/AGENCY-BUILD-PROMPT.md
--                     D2). 'management' (the IMO product we are not building) and a tenant with no plan
--                     answer null: absent, not guessed.
--   agency            one row per agency-audience tenant. unique(tenant_id) is enforced HERE, not in code.
--                     ein_last4 only — a full EIN is never stored (the full tax id stays sealed in
--                     agency_profiles).
--   producer          one row per person who writes business, unique on (tenant_id, user_id). The spec's
--                     "producer_id" on business rows is this person's USER id in the attribution column each
--                     table already carries (agent_user_id, producer_user_id, owner_user_id …) — decision D1.
--                     A producer row exists from the moment of the invite (status 'invited', AG-0.6).
--   can_submit        defaults false and has NO insert or update grant for any application role. Only the
--                     licence gate (AG-1.10 / LA-6.2) writes it, through a security-definer function that
--                     DERIVES the value. A producer who can write business before anyone checked his licence
--                     is a compliance incident.
--   agency_id         already exists (no FK, always null) on 16 LA-4…LA-7 tables. From here on a BEFORE INSERT
--                     trigger fills it from the tenant's agency row; for an individual tenant it stays null,
--                     so solo agents pay one indexed lookup and nothing else.
--
-- Existing agency-typed tenants (today only the two private QA plans) get their agency row here; their
-- producer rows come from AG-0.8's upgrade function, which is the one place that backfills.
--
-- Additive. Requires 20260911135000 (tenant_current_plan), 20260924100000 (agency_profiles).
--
-- Rollback:
--   drop trigger if exists fill_agency_id on public.<each table in the loop below>;
--   drop function if exists public.fill_agency_id(); drop function if exists public.tenant_agency_id(uuid);
--   drop table if exists public.producer; drop table if exists public.agency;
--   drop function if exists public.tenant_plan_audience(uuid);

-- ─── the audience ──────────────────────────────────────────────────────────────────────────────────
create or replace function public.tenant_plan_audience(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case p.plan_type::text
           when 'individual' then 'individual'
           when 'agency_no_teams' then 'agency'
           when 'agency_with_teams' then 'agency'
           else null
         end
    from public.plans p
   where p.id = public.tenant_current_plan(p_tenant_id);
$$;
revoke all on function public.tenant_plan_audience(uuid) from public, anon, authenticated;
grant execute on function public.tenant_plan_audience(uuid) to service_role, tenant_app;

-- ─── the agency ────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.agency (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  legal_name text not null,
  dba_name text,
  npn text,
  ein_last4 text,
  primary_state text,
  seat_band text not null default 'to_50',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agency_one_per_tenant unique (tenant_id),
  -- The composite target for producer.(agency_id, tenant_id): a producer can only belong to his own
  -- tenant's agency.
  constraint agency_id_tenant unique (id, tenant_id),
  constraint agency_legal_name_present check (length(btrim(legal_name)) between 1 and 200),
  constraint agency_ein_last4 check (ein_last4 is null or ein_last4 ~ '^[0-9]{4}$'),
  constraint agency_primary_state check (primary_state is null or primary_state ~ '^[A-Z]{2}$'),
  constraint agency_seat_band check (seat_band in ('to_50', 'to_150', 'over_150'))
);

-- ─── the producer ──────────────────────────────────────────────────────────────────────────────────
create table if not exists public.producer (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  agency_id uuid not null,
  -- Writer attribution is permanent (AG-0.7): a producer's user cannot be removed out from under his book.
  user_id uuid not null references public.users(id) on delete restrict,
  display_name text not null,
  npn text,
  status text not null default 'invited',
  hired_on date,
  offboarded_on date,
  can_submit boolean not null default false,
  -- Why can_submit is what it is, in words the Sell module shows ("E&O certificate missing").
  can_submit_reason text,
  can_submit_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint producer_agency_fk foreign key (agency_id, tenant_id) references public.agency (id, tenant_id) on delete cascade,
  constraint producer_one_per_member unique (tenant_id, user_id),
  constraint producer_id_tenant unique (id, tenant_id),
  constraint producer_status check (status in ('invited', 'onboarding', 'active', 'suspended', 'offboarded')),
  constraint producer_display_name_present check (length(btrim(display_name)) between 1 and 200),
  constraint producer_offboarded_dated check ((status = 'offboarded') = (offboarded_on is not null)),
  -- A producer who cannot work cannot submit, whatever the gate last said.
  constraint producer_can_submit_only_when_working check (not can_submit or status in ('active', 'onboarding'))
);
create index if not exists producer_tenant_status on public.producer (tenant_id, status);
create index if not exists producer_user on public.producer (user_id);

-- ─── grants: the app writes the agency and the producer's profile, never can_submit ────────────────
revoke all on public.agency, public.producer from public, anon, authenticated;
-- service_role is given ALL on every new table by default on this project; take back what it must not have.
revoke insert, update, delete, truncate on public.agency, public.producer from service_role, tenant_app;
grant select on public.agency, public.producer to service_role, tenant_app;
grant insert (tenant_id, legal_name, dba_name, npn, ein_last4, primary_state, seat_band) on public.agency to service_role;
grant update (legal_name, dba_name, npn, ein_last4, primary_state, updated_at) on public.agency to service_role;
-- seat_band follows the plan (AG-0.12) and is written by the band change, not by an agency settings form.
-- status moves only through AG-0.6 (accept) and AG-0.7 (suspend / offboard / reactivate) functions.
grant insert (tenant_id, agency_id, user_id, display_name, npn, hired_on) on public.producer to service_role;
grant update (display_name, npn, hired_on, updated_at) on public.producer to service_role;

alter table public.agency enable row level security;
alter table public.producer enable row level security;
drop policy if exists agency_tenant_read on public.agency;
create policy agency_tenant_read on public.agency for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
-- AG-0.4 narrows this to the visible producers; until then a tenant_app session sees its own tenant.
drop policy if exists producer_tenant_read on public.producer;
create policy producer_tenant_read on public.producer for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- ─── agency_id starts being populated ──────────────────────────────────────────────────────────────
create or replace function public.tenant_agency_id(p_tenant_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.id from public.agency a where a.tenant_id = p_tenant_id;
$$;
revoke all on function public.tenant_agency_id(uuid) from public, anon, authenticated;
grant execute on function public.tenant_agency_id(uuid) to service_role, tenant_app;

create or replace function public.fill_agency_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.agency_id is null then
    new.agency_id := public.tenant_agency_id(new.tenant_id);
  end if;
  return new;
end;
$$;
revoke all on function public.fill_agency_id() from public, anon, authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'bank_account', 'carrier_account_statement', 'commission_account_entry', 'commission_entry', 'cost_entry',
    'expense', 'file_registry', 'payout_run', 'policy_current', 'policy_snapshot', 'producer_ledger_entry',
    'producer_payout_run', 'producer_split', 'reinstatement_case', 'servicing_request', 'vendor_invoice'
  ] loop
    if to_regclass('public.' || v_table) is not null then
      execute format('drop trigger if exists fill_agency_id on public.%I', v_table);
      execute format('create trigger fill_agency_id before insert on public.%I for each row execute function public.fill_agency_id()', v_table);
    end if;
  end loop;
end;
$$;

-- ─── agency rows for tenants already on an agency-typed plan ──────────────────────────────────────
insert into public.agency (tenant_id, legal_name, dba_name, npn, primary_state)
select t.id,
       coalesce(nullif(btrim(ap.legal_name), ''), t.name),
       nullif(btrim(ap.dba), ''),
       nullif(btrim(ap.npn), ''),
       case when upper(ap.state) ~ '^[A-Z]{2}$' then upper(ap.state) end
  from public.tenants t
  left join public.agency_profiles ap on ap.tenant_id = t.id
 where public.tenant_plan_audience(t.id) = 'agency'
on conflict (tenant_id) do nothing;

-- ─── self-check (runs against the database it is applied to) ──────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_agency uuid;
begin
  -- 1. A second agency row for one tenant is refused by the database.
  select tenant_id, id into v_tenant, v_agency from public.agency limit 1;
  if v_tenant is null then
    select id into v_tenant from public.tenants limit 1;
  end if;
  if v_tenant is not null then
    begin
      insert into public.agency (tenant_id, legal_name) values (v_tenant, 'AG-0.1 probe');
      insert into public.agency (tenant_id, legal_name) values (v_tenant, 'AG-0.1 probe 2');
      raise exception 'AG-0.1: a second agency row for one tenant was accepted';
    exception when unique_violation then
      null; -- expected; the subtransaction rolls the probe back
    end;
  end if;
  -- 2. No application role may write can_submit, on insert or on update.
  if has_column_privilege('service_role', 'public.producer', 'can_submit', 'UPDATE')
     or has_column_privilege('service_role', 'public.producer', 'can_submit', 'INSERT')
     or has_column_privilege('tenant_app', 'public.producer', 'can_submit', 'UPDATE')
     or has_column_privilege('tenant_app', 'public.producer', 'can_submit', 'INSERT') then
    raise exception 'AG-0.1: an application role can still write producer.can_submit';
  end if;
  if has_table_privilege('service_role', 'public.producer', 'DELETE') or has_table_privilege('service_role', 'public.agency', 'DELETE') then
    raise exception 'AG-0.1: service_role can still delete agency or producer rows';
  end if;
  -- 3. Every agency-typed tenant has its one agency row.
  if exists (select 1 from public.tenants t where public.tenant_plan_audience(t.id) = 'agency'
              and not exists (select 1 from public.agency a where a.tenant_id = t.id)) then
    raise exception 'AG-0.1: an agency-plan tenant has no agency row';
  end if;
end;
$$;
