-- ---------------------------------------------------------------------------
-- Dialer · "Open until 8:00 PM CT", and a DNC row that says what was actually checked
--
-- 1. tenant_dial_window(tenant, state, campaign, at) — the EXPLAINER. The board's calling-window row
--    reads "Open until 8:00 PM CT"; tenant_can_dial_now answers only yes or no, so the dialer could
--    say "open" but never until when, nor why a closed window is closed. This returns the same
--    decision with its working: allowed, the window's start and end in minutes of the customer's
--    day, the zone, the customer's current minute, and a reason code.
--
--    It is a SECOND COPY of tenant_can_dial_now's rules, on purpose and under protest:
--    tenant_can_dial_now (latest body 20260924230100) belongs to another session's unapplied work
--    and is not redefined here. The copy is built from that body — the 400-day rules-feed
--    freshness refusal, the tenant-filtered campaign read, `v_local` as a `timestamp`, and federal
--    holidays only when the agency opts in — and the assertion at the end runs both functions over
--    every state, two instants an hour for eight days, the empty tenant and up to three real ones,
--    and refuses to apply if they disagree once. The dial itself still asks tenant_can_dial_now;
--    this function only explains. When tenant_can_dial_now is next rewritten, the natural end state
--    is for it to call this one and return `allowed`.
--
-- 2. tenant_dial_dnc_checks — one row per DNC lookup made at the moment of dialing
--    (markDialClicked), per lead and attempt. The dialer's DNC row showed "clear" when the only
--    thing checked was that a DNC vendor was configured and healthy — no number had been looked
--    up. The panel now says "Checked when you call" and the last recorded result from this log.
--    A lookup per panel load would cost a vendor fee per glance, so there is none.
--
-- Requires 20260924230100 (calling_window_rules_stale, and tenant_can_dial_now's current rules).
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regprocedure('public.calling_window_rules_stale(timestamp with time zone)') is null then
    raise exception 'calling_window_rules_stale does not exist; apply 20260924230100 before this file';
  end if;
end $$;

-- ── the explainer ──────────────────────────────────────────────────────────
create or replace function public.tenant_dial_window(
  p_tenant_id uuid,
  p_state text,
  p_campaign_id uuid,
  p_at timestamptz default now()
)
returns table(allowed boolean, start_minute integer, end_minute integer, zone text, local_minute integer, reason text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_zone text;
  v_local timestamp;
  v_minute integer;
  v_dow integer;
  v_start integer := 8 * 60;
  v_end integer := 21 * 60;
  v_rule record;
  v_tenant record;
  v_options record;
  v_campaign record;
  v_campaigns_apply boolean := true;
begin
  if p_state is null or p_state !~ '^[A-Za-z]{2}$' then
    return query select false, null::integer, null::integer, null::text, null::integer, 'no_state'::text;
    return;
  end if;

  if public.calling_window_rules_stale(now()) then
    return query select false, null::integer, null::integer, null::text, null::integer, 'rules_stale'::text;
    return;
  end if;

  select st.timezone into v_zone from public.state_timezones st where st.state = upper(p_state);
  if v_zone is null then
    return query select false, null::integer, null::integer, null::text, null::integer, 'no_zone'::text;
    return;
  end if;

  v_local := p_at at time zone v_zone;
  v_minute := extract(hour from v_local)::integer * 60 + extract(minute from v_local)::integer;
  v_dow := extract(dow from v_local)::integer;

  select * into v_rule from public.calling_window_rules_in_force(v_local::date) r
   where r.state = upper(p_state);
  if found then
    v_start := greatest(v_start, v_rule.start_hour * 60);
    v_end := least(v_end, v_rule.end_hour * 60);
    if v_rule.no_sunday and v_dow = 0 then
      return query select false, v_start, v_end, v_zone, v_minute, 'state_no_sunday'::text;
      return;
    end if;
    if v_rule.no_holidays and exists (
      select 1 from public.calling_window_holidays h
       where h.holiday_date = v_local::date
         and h.state_code in ('*', upper(p_state))
    ) then
      return query select false, v_start, v_end, v_zone, v_minute, 'state_holiday'::text;
      return;
    end if;
  end if;

  select * into v_tenant from public.tenant_calling_windows w where w.tenant_id = p_tenant_id;
  if found then
    v_start := greatest(v_start, coalesce(v_tenant.start_minute, v_tenant.start_hour * 60));
    v_end := least(v_end, coalesce(v_tenant.end_minute, v_tenant.end_hour * 60));
  end if;

  select * into v_options from public.tenant_calling_window_options o where o.tenant_id = p_tenant_id;
  if found then
    if v_options.no_sunday and v_dow = 0 then
      return query select false, v_start, v_end, v_zone, v_minute, 'agency_no_sunday'::text;
      return;
    end if;
    if v_options.no_federal_holidays and exists (
      select 1 from public.calling_window_holidays h
       where h.holiday_date = v_local::date
         and (h.state_code is null or h.state_code = '*')
    ) then
      return query select false, v_start, v_end, v_zone, v_minute, 'federal_holiday'::text;
      return;
    end if;
    v_campaigns_apply := coalesce(v_options.campaign_overrides_enabled, true);
  end if;

  if p_campaign_id is not null and v_campaigns_apply then
    select coalesce(c.calling_window_start_minute, c.calling_window_start_hour * 60) as s,
           coalesce(c.calling_window_end_minute, c.calling_window_end_hour * 60) as e
      into v_campaign from public.tenant_campaigns c
     where c.id = p_campaign_id and c.tenant_id = p_tenant_id;
    if found and v_campaign.s is not null then v_start := greatest(v_start, v_campaign.s); end if;
    if found and v_campaign.e is not null then v_end := least(v_end, v_campaign.e); end if;
  end if;

  if v_start >= v_end then
    return query select false, v_start, v_end, v_zone, v_minute, 'no_window'::text;
    return;
  end if;
  if v_minute < v_start then
    return query select false, v_start, v_end, v_zone, v_minute, 'before_open'::text;
    return;
  end if;
  if v_minute >= v_end then
    return query select false, v_start, v_end, v_zone, v_minute, 'after_close'::text;
    return;
  end if;
  return query select true, v_start, v_end, v_zone, v_minute, 'open'::text;
end;
$function$;

revoke all on function public.tenant_dial_window(uuid, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.tenant_dial_window(uuid, text, uuid, timestamptz) to tenant_app, service_role;

-- ── the DNC check log ──────────────────────────────────────────────────────
create table if not exists public.tenant_dial_dnc_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  attempt_id uuid references public.tenant_call_attempts(id) on delete set null,
  -- clear: every enabled list and vendor answered and none listed the number.
  -- listed: the agency's own list or a vendor listed it; the dial was refused.
  -- unavailable: no vendor could answer; the dial was refused (fail closed).
  result text not null check (result in ('clear', 'listed', 'unavailable')),
  checked_at timestamptz not null default now(),
  checked_by uuid references public.users(id) on delete set null
);

create index if not exists tenant_dial_dnc_checks_lead_idx
  on public.tenant_dial_dnc_checks (tenant_id, lead_id, checked_at desc);
create index if not exists tenant_dial_dnc_checks_attempt_idx
  on public.tenant_dial_dnc_checks (attempt_id) where attempt_id is not null;
create index if not exists tenant_dial_dnc_checks_checked_by_idx
  on public.tenant_dial_dnc_checks (checked_by) where checked_by is not null;

alter table public.tenant_dial_dnc_checks enable row level security;

drop policy if exists tenant_dial_dnc_checks_tenant_scoped on public.tenant_dial_dnc_checks;
create policy tenant_dial_dnc_checks_tenant_scoped on public.tenant_dial_dnc_checks
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

-- Evidence: appended, never edited.
revoke all on public.tenant_dial_dnc_checks from anon, authenticated, public;
grant select, insert on public.tenant_dial_dnc_checks to tenant_app;
grant select, insert, update, delete on public.tenant_dial_dnc_checks to service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_tenants uuid[];
  v_campaigns uuid[];
  v_states text[];
  v_some_states constant text[] := array['CA', 'TX', 'FL', 'NY', 'AZ', 'IN', 'HI', 'AK', 'MA', 'PA', 'XX', null];
  v_state_set text[];
  v_tenant uuid;
  v_campaign uuid;
  v_state text;
  v_hour integer;
  v_at timestamptz;
  v_base constant timestamptz := timestamptz '2026-09-20 00:00:00+00';  -- a Sunday, UTC
  v_explained boolean;
  v_decided boolean;
  v_checked integer := 0;
begin
  -- The empty tenant (no agency rows: federal floor and state rules only) and up to three real
  -- tenants that have narrowed their window or set options.
  select array_agg(t) into v_tenants from (
    select '00000000-0000-0000-0000-000000000000'::uuid as t
    union all
    (select w.tenant_id from public.tenant_calling_windows w
     union select o.tenant_id from public.tenant_calling_window_options o
     limit 3)
  ) x;
  select coalesce(array_agg(st.state order by st.state), array[]::text[]) || array['XX', 'tx', null]
    into v_states from public.state_timezones st;

  foreach v_tenant in array v_tenants loop
    -- No campaign, and one campaign of this tenant that carries its own window, if any.
    select array[null::uuid] || coalesce(array_agg(c.id), array[]::uuid[]) into v_campaigns
      from (select c.id from public.tenant_campaigns c
             where c.tenant_id = v_tenant
               and (c.calling_window_start_hour is not null or c.calling_window_end_hour is not null)
             limit 1) c;
    -- Every state for the empty tenant; a spread of zones for the real ones, to bound the run.
    v_state_set := case when v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then v_states else v_some_states end;
    foreach v_campaign in array v_campaigns loop
      foreach v_state in array v_state_set loop
        for v_hour in 0 .. (8 * 24 - 1) loop
          foreach v_at in array array[v_base + make_interval(hours => v_hour),
                                      v_base + make_interval(hours => v_hour, mins => 59)] loop
            select w.allowed into v_explained from public.tenant_dial_window(v_tenant, v_state, v_campaign, v_at) w;
            v_decided := public.tenant_can_dial_now(v_tenant, v_state, v_campaign, v_at);
            if v_explained is distinct from coalesce(v_decided, false) then
              raise exception 'tenant_dial_window disagrees with tenant_can_dial_now for tenant %, state %, campaign %, at %: % vs %',
                v_tenant, v_state, v_campaign, v_at, v_explained, v_decided;
            end if;
            v_checked := v_checked + 1;
          end loop;
        end loop;
      end loop;
    end loop;
  end loop;

  if not exists (select 1 from pg_class where oid = 'public.tenant_dial_dnc_checks'::regclass and relrowsecurity) then
    raise exception 'tenant_dial_dnc_checks has no row level security';
  end if;
  if not has_function_privilege('tenant_app', 'public.tenant_dial_window(uuid, text, uuid, timestamptz)', 'execute') then
    raise exception 'tenant_app cannot execute tenant_dial_window';
  end if;
  raise notice 'tenant_dial_window agrees with tenant_can_dial_now on % inputs', v_checked;
end $$;
