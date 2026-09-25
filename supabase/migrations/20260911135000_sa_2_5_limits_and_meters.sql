-- SA-2.5 · Plan limits & metered credits
--
-- Notion is emphatic that these are two different things and must not be confused:
--   LIMIT — a fixed ceiling that does not reset. Seats. Carriers. Publishers.
--   METER — an allowance that resets every billing period and is consumed. TCPA checks, minutes.
-- They get two different tables and two different enforcement paths here for that reason.
--
-- The acceptance criteria that shape the design:
--   * the same usage event posted twice counts once          -> unique idempotency_key
--   * usage events are never deleted; corrections are        -> no delete path; negative qty
--     new negative events
--   * the aggregate can be fully rebuilt from the event log  -> rebuild_usage_totals()
--   * allowances reset at the start of each BILLING period,  -> period comes from
--     not the calendar month                                    subscriptions.current_period_start
--   * at 100% of a hard-capped meter the action is blocked   -> check_meter_capacity(), called
--     server-side, not just a hidden button                     before the action

-- --------------------------------------------------------------------------
-- Catalogue
-- --------------------------------------------------------------------------

create table if not exists public.meters (
  meter_key        text primary key,
  unit             text not null,
  label            text not null,
  default_hard_cap boolean not null default true,
  sort_order       integer not null default 0
);

comment on table public.meters is
  'SA-2.5 · Every consumable allowance in the product. default_hard_cap is what a new plan gets '
  'unless it overrides it in plan_meters.';

create table if not exists public.plan_meters (
  plan_id      uuid not null,
  meter_key    text not null,
  included_qty integer,
  hard_cap     boolean not null default true,
  constraint plan_meters_pkey primary key (plan_id, meter_key)
);

comment on column public.plan_meters.included_qty is
  'null = unlimited. 0 = explicitly none. No row at all = this plan sets no ceiling on the meter.';

create table if not exists public.plan_limits (
  plan_id                 uuid primary key,
  max_seats               integer,
  max_carriers            integer,
  max_publishers          integer,
  max_marketing_partners  integer,
  max_affiliates          integer,
  max_buffer_seats        integer,
  max_partner_users       integer
);

comment on table public.plan_limits is
  'SA-2.5 · Fixed ceilings for one plan version. null means unlimited, matching the Entitlement '
  'type in lib/entitlements/types.ts.';

do $$ begin
  alter table public.plan_meters add constraint plan_meters_plan_id_fkey
    foreign key (plan_id) references public.plans (id) on delete cascade;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.plan_meters add constraint plan_meters_meter_key_fkey
    foreign key (meter_key) references public.meters (meter_key) on update cascade;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.plan_meters add constraint plan_meters_included_non_negative
    check (included_qty is null or included_qty >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.plan_limits add constraint plan_limits_plan_id_fkey
    foreign key (plan_id) references public.plans (id) on delete cascade;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.plan_limits add constraint plan_limits_non_negative check (
    coalesce(max_seats, 0) >= 0 and coalesce(max_carriers, 0) >= 0
    and coalesce(max_publishers, 0) >= 0 and coalesce(max_marketing_partners, 0) >= 0
    and coalesce(max_affiliates, 0) >= 0 and coalesce(max_buffer_seats, 0) >= 0
    and coalesce(max_partner_users, 0) >= 0
  );
exception when duplicate_object then null; end $$;

-- --------------------------------------------------------------------------
-- Usage: an append-only event log and a rebuildable aggregate
-- --------------------------------------------------------------------------

create table if not exists public.usage_events (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  meter_key       text not null,
  qty             integer not null,
  ts              timestamptz not null default now(),
  ref             text,
  idempotency_key text not null,
  period_start    timestamptz not null
);

comment on table public.usage_events is
  'SA-2.5 · Append-only. Never updated, never deleted — an over-count is corrected by recording a '
  'NEGATIVE event, so the log stays a truthful history and usage_totals stays rebuildable.';

comment on column public.usage_events.idempotency_key is
  'Must be stable for the underlying real-world event (a call id, a webhook delivery id). The '
  'unique index on it is what makes a retried call a no-op rather than a double charge.';

do $$ begin
  alter table public.usage_events add constraint usage_events_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id) on delete cascade;
exception when duplicate_object or undefined_table then null; end $$;

do $$ begin
  alter table public.usage_events add constraint usage_events_meter_key_fkey
    foreign key (meter_key) references public.meters (meter_key) on update cascade;
exception when duplicate_object then null; end $$;

-- THE idempotency guarantee. Scoped per tenant so two tenants cannot collide on a shared
-- external id.
create unique index if not exists usage_events_idempotency_idx
  on public.usage_events (tenant_id, idempotency_key);

create index if not exists usage_events_rollup_idx
  on public.usage_events (tenant_id, meter_key, period_start);

create table if not exists public.usage_totals (
  tenant_id    uuid not null,
  meter_key    text not null,
  period_start timestamptz not null,
  used_qty     integer not null default 0,
  updated_at   timestamptz not null default now(),
  constraint usage_totals_pkey primary key (tenant_id, meter_key, period_start)
);

comment on table public.usage_totals is
  'SA-2.5 · Running aggregate, derived. Fully reconstructible from usage_events by '
  'rebuild_usage_totals(); never the source of truth.';

-- --------------------------------------------------------------------------
-- Period and plan resolution
-- --------------------------------------------------------------------------

create or replace function public.tenant_current_plan(p_tenant_id uuid)
returns uuid
language sql
stable
security invoker
set search_path = public
as $$
  select s.plan_id
    from public.subscriptions s
   where s.tenant_id = p_tenant_id and s.status <> 'cancelled'
   order by s.started_at desc
   limit 1;
$$;

create or replace function public.tenant_current_period_start(p_tenant_id uuid)
returns timestamptz
language sql
stable
security invoker
set search_path = public
as $$
  -- The billing period, not the calendar month (SA-2.5 acceptance criterion 5). A tenant with no
  -- subscription — every LA-0 bridge tenant — falls back to the month so usage still aggregates
  -- somewhere sensible instead of failing.
  select coalesce(
    (select s.current_period_start
       from public.subscriptions s
      where s.tenant_id = p_tenant_id and s.status <> 'cancelled'
      order by s.started_at desc
      limit 1),
    date_trunc('month', now())
  );
$$;

create or replace function public.tenant_seats_used(p_tenant_id uuid)
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)::integer from public.tenant_users where tenant_id = p_tenant_id;
$$;

comment on function public.tenant_seats_used(uuid) is
  'SA-2.5 / LA-0.2 · Seats consumed by this tenant. Reported to the owner; enforcement against '
  'max_seats is deliberately out of scope (SA-00 declined list).';

-- --------------------------------------------------------------------------
-- check_meter_capacity — the metering counterpart to requireFeature()
--
-- Fails OPEN on configuration gaps and CLOSED only on an explicit ceiling. This is deliberate:
-- this function answers "how much is left", not "are you allowed in" — access is requireFeature's
-- job. Blocking a tenant because an admin has not configured a meter yet would take dialing down
-- for a paying customer over a missing row.
-- --------------------------------------------------------------------------

create or replace function public.check_meter_capacity(
  p_tenant_id uuid,
  p_meter_key text,
  p_qty       integer default 1
)
returns table (
  allowed  boolean,
  used     integer,
  included integer,
  hard_cap boolean,
  pct_used numeric,
  reason   text
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_plan_id  uuid;
  v_period   timestamptz;
  v_meter    public.meters%rowtype;
  v_pm       public.plan_meters%rowtype;
  v_used     integer;
  v_included integer;
  v_hard_cap boolean;
begin
  select * into v_meter from public.meters where meter_key = p_meter_key;
  if v_meter.meter_key is null then
    -- Metering something the catalog does not know about. Surface it, do not block on it.
    return query select true, 0, null::integer, false, null::numeric, 'not_metered'::text;
    return;
  end if;

  v_plan_id := public.tenant_current_plan(p_tenant_id);
  v_period  := public.tenant_current_period_start(p_tenant_id);

  select coalesce(t.used_qty, 0) into v_used
    from public.usage_totals t
   where t.tenant_id = p_tenant_id and t.meter_key = p_meter_key and t.period_start = v_period;
  v_used := coalesce(v_used, 0);

  if v_plan_id is null then
    -- No subscription: LA-0 bridge tenants live here. Report it and let them through.
    return query select true, v_used, null::integer, false, null::numeric, 'no_subscription'::text;
    return;
  end if;

  select * into v_pm from public.plan_meters where plan_id = v_plan_id and meter_key = p_meter_key;

  if v_pm.plan_id is null or v_pm.included_qty is null then
    -- No row, or an explicit null allowance: this plan sets no ceiling on this meter.
    return query select true, v_used, null::integer, coalesce(v_pm.hard_cap, v_meter.default_hard_cap),
                        null::numeric, 'unlimited'::text;
    return;
  end if;

  v_included := v_pm.included_qty;
  v_hard_cap := v_pm.hard_cap;

  if v_included = 0 then
    return query select not v_hard_cap, v_used, 0, v_hard_cap, null::numeric, 'no_allowance'::text;
    return;
  end if;

  return query
    select
      case when v_hard_cap then (v_used + p_qty) <= v_included else true end,
      v_used,
      v_included,
      v_hard_cap,
      round((v_used::numeric / v_included) * 100, 2),
      case
        when (v_used + p_qty) > v_included then 'over_cap'
        -- Notify at 80% (SA-2.5 in scope). The caller decides what to do with the warning.
        when (v_used::numeric / v_included) >= 0.8 then 'near_cap'
        else 'ok'
      end::text;
end;
$$;

-- --------------------------------------------------------------------------
-- record_usage — exactly once
-- --------------------------------------------------------------------------

create or replace function public.record_usage(
  p_tenant_id       uuid,
  p_meter_key       text,
  p_qty             integer,
  p_idempotency_key text,
  p_ref             text default null
)
returns table (recorded boolean, new_total integer, billing_period_start timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_period   timestamptz;
  v_inserted boolean := false;
  v_total    integer;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency_key is required' using errcode = 'invalid_parameter_value';
  end if;

  v_period := public.tenant_current_period_start(p_tenant_id);

  insert into public.usage_events (tenant_id, meter_key, qty, ref, idempotency_key, period_start)
  values (p_tenant_id, p_meter_key, p_qty, p_ref, p_idempotency_key, v_period)
  on conflict (tenant_id, idempotency_key) do nothing;

  v_inserted := found;

  if v_inserted then
    insert into public.usage_totals (tenant_id, meter_key, period_start, used_qty, updated_at)
    values (p_tenant_id, p_meter_key, v_period, p_qty, now())
    on conflict (tenant_id, meter_key, period_start) do update
      set used_qty   = public.usage_totals.used_qty + excluded.used_qty,
          updated_at = now();
  end if;

  select coalesce(t.used_qty, 0) into v_total
    from public.usage_totals t
   where t.tenant_id = p_tenant_id and t.meter_key = p_meter_key and t.period_start = v_period;

  return query select v_inserted, coalesce(v_total, 0), v_period;
end;
$$;

comment on function public.record_usage(uuid, text, integer, text, text) is
  'SA-2.5 · Records usage exactly once. A retry with the same idempotency key returns '
  'recorded = false and leaves the total untouched. Pass a negative qty to correct an over-count.';

-- --------------------------------------------------------------------------
-- rebuild_usage_totals — the aggregate is derived, and provably so
-- --------------------------------------------------------------------------

create or replace function public.rebuild_usage_totals()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_rows integer;
begin
  -- Replaying the log is the only way to prove the aggregate was never wrong. Safe because
  -- usage_totals holds nothing that is not derivable from usage_events.
  delete from public.usage_totals;

  insert into public.usage_totals (tenant_id, meter_key, period_start, used_qty, updated_at)
  select e.tenant_id, e.meter_key, e.period_start, sum(e.qty)::integer, now()
    from public.usage_events e
   group by e.tenant_id, e.meter_key, e.period_start;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- --------------------------------------------------------------------------
-- Access
-- --------------------------------------------------------------------------

alter table public.meters       enable row level security;
alter table public.plan_meters  enable row level security;
alter table public.plan_limits  enable row level security;
alter table public.usage_events enable row level security;
alter table public.usage_totals enable row level security;

drop policy if exists meters_service_role_only on public.meters;
create policy meters_service_role_only on public.meters for all to service_role using (true) with check (true);
drop policy if exists plan_meters_service_role_only on public.plan_meters;
create policy plan_meters_service_role_only on public.plan_meters for all to service_role using (true) with check (true);
drop policy if exists plan_limits_service_role_only on public.plan_limits;
create policy plan_limits_service_role_only on public.plan_limits for all to service_role using (true) with check (true);
drop policy if exists usage_events_service_role_only on public.usage_events;
create policy usage_events_service_role_only on public.usage_events for all to service_role using (true) with check (true);
drop policy if exists usage_totals_service_role_only on public.usage_totals;
create policy usage_totals_service_role_only on public.usage_totals for all to service_role using (true) with check (true);

revoke all on public.meters, public.plan_meters, public.plan_limits, public.usage_events, public.usage_totals
  from public, anon, authenticated, tenant_app;
grant select, insert, update, delete
  on public.meters, public.plan_meters, public.plan_limits, public.usage_events, public.usage_totals
  to service_role;

-- usage_events is append-only: no update or delete, for anyone. Corrections are negative events.
revoke update, delete on public.usage_events from service_role;

revoke all on function public.check_meter_capacity(uuid, text, integer) from public, anon, authenticated, tenant_app;
revoke all on function public.record_usage(uuid, text, integer, text, text) from public, anon, authenticated, tenant_app;
revoke all on function public.rebuild_usage_totals() from public, anon, authenticated, tenant_app;
revoke all on function public.tenant_current_plan(uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.tenant_current_period_start(uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.tenant_seats_used(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.check_meter_capacity(uuid, text, integer) to service_role;
grant execute on function public.record_usage(uuid, text, integer, text, text) to service_role;
grant execute on function public.rebuild_usage_totals() to service_role;
grant execute on function public.tenant_current_plan(uuid) to service_role;
grant execute on function public.tenant_current_period_start(uuid) to service_role;
grant execute on function public.tenant_seats_used(uuid) to service_role;

-- --------------------------------------------------------------------------
-- Seed — the meter catalogue from SA-2.5
-- --------------------------------------------------------------------------

insert into public.meters (meter_key, unit, label, default_hard_cap, sort_order) values
  ('tcpa_checks',     'check',    'TCPA checks',     true,  1),
  ('dnc_lookups',     'lookup',   'DNC lookups',     true,  2),
  ('dialer_minutes',  'minute',   'Dialer minutes',  true,  3),
  ('sms_segments',    'segment',  'SMS segments',    true,  4),
  ('statement_pages', 'page',     'Statement pages', false, 5),
  ('esign_envelopes', 'envelope', 'E-sign envelopes', true, 6)
on conflict (meter_key) do nothing;

-- Seats only. SA-2.2 fixes an individual plan at one seat, so that number is specified rather
-- than invented. Every other ceiling and every meter allowance is a business figure that is not
-- pinned anywhere — they stay null (unlimited) until someone sets them, rather than being guessed
-- into a table that enforcement reads.
insert into public.plan_limits (plan_id, max_seats)
select p.id, 1 from public.plans p where p.plan_type = 'individual' and p.version = 1
on conflict (plan_id) do nothing;

-- --------------------------------------------------------------------------
-- The entitlement now carries real limits and meters
--
-- SA-2.8 built this function before plan_limits and plan_meters existed, so it hardcoded
-- max_seats and returned an empty meters object. Same contract, real sources.
-- --------------------------------------------------------------------------

create or replace function public.refresh_tenant_entitlement(p_tenant_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sub         public.subscriptions%rowtype;
  v_plan        public.plans%rowtype;
  v_limits      public.plan_limits%rowtype;
  v_features    jsonb;
  v_meters      jsonb;
  v_status      text;
  v_access      text;
  v_entitlement jsonb;
begin
  select s.* into v_sub
    from public.subscriptions s
   where s.tenant_id = p_tenant_id
   order by (s.status <> 'cancelled') desc, s.started_at desc
   limit 1;

  if v_sub.id is null then
    v_entitlement := public.la0_default_entitlement(p_tenant_id);
    if v_entitlement is null then
      raise exception 'tenant_not_found' using errcode = 'no_data_found';
    end if;
  else
    select p.* into v_plan from public.plans p where p.id = v_sub.plan_id;
    if v_plan.id is null then
      raise exception 'plan_not_found for subscription %', v_sub.id using errcode = 'foreign_key_violation';
    end if;

    select l.* into v_limits from public.plan_limits l where l.plan_id = v_plan.id;

    v_status := v_sub.status::text;
    v_access := public.entitlement_access_for_status(v_status);

    if v_status = 'cancelled' then
      v_features := '[]'::jsonb;
    else
      -- Archived features stay granted to existing subscribers (SA-2.1).
      select coalesce(jsonb_agg(pf.feature_key order by pf.feature_key), '[]'::jsonb)
        into v_features
        from public.plan_features pf
       where pf.plan_id = v_plan.id;
    end if;

    -- Only meters the plan actually caps appear. `used` is the live total for the current
    -- billing period, so the agent app can show "1,104 of 2,000" without a second query.
    select coalesce(jsonb_object_agg(pm.meter_key, jsonb_build_object(
             'included', pm.included_qty,
             'hard_cap', pm.hard_cap,
             'used',     coalesce(t.used_qty, 0)
           )), '{}'::jsonb)
      into v_meters
      from public.plan_meters pm
      left join public.usage_totals t
        on t.tenant_id = p_tenant_id
       and t.meter_key = pm.meter_key
       and t.period_start = v_sub.current_period_start
     where pm.plan_id = v_plan.id;

    v_entitlement := jsonb_build_object(
      'tenant_id',    p_tenant_id,
      'plan_code',    v_plan.code,
      'plan_version', v_plan.version,
      'status',       v_status,
      'access',       v_access,
      'computed_at',  now(),
      'features',     v_features,
      'meters',       v_meters,
      'limits',       jsonb_build_object(
                        'max_seats',              coalesce(v_limits.max_seats,
                                                    case when v_plan.plan_type = 'individual' then 1 else null end),
                        'max_publishers',         v_limits.max_publishers,
                        'max_marketing_partners', v_limits.max_marketing_partners,
                        'max_affiliates',         v_limits.max_affiliates,
                        'max_buffer_seats',       v_limits.max_buffer_seats,
                        'max_partner_users',      v_limits.max_partner_users
                      ),
      'period_start', v_sub.current_period_start
    );
  end if;

  insert into public.tenant_entitlements (tenant_id, entitlement, computed_at, version)
  values (p_tenant_id, v_entitlement, now(), 1)
  on conflict (tenant_id) do update
    set entitlement = excluded.entitlement,
        computed_at = excluded.computed_at,
        version     = public.tenant_entitlements.version + 1;

  return v_entitlement;
end;
$$;
