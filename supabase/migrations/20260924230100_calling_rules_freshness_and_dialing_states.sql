-- ---------------------------------------------------------------------------
-- Settings · Calling windows — "Last refreshed …", and a stale feed refuses the dial
--
-- The board: "Last refreshed 22 September, 04:10. A stale feed refuses the dial rather than
-- guessing." The state rules (`calling_window_state_rules`) and the holiday calendar
-- (`calling_window_holidays`) are platform data with no record of when they were last loaded, so
-- neither half could be said.
--
-- 1. A FRESHNESS STAMP. `calling_window_rules_feed` is a single row: when the rules were last
--    refreshed, by what, and how old they may get before they are stale (400 days by default — the
--    statutes change rarely, but a calendar that was never renewed runs out of holidays). It is
--    stamped automatically by any write to either table (a statement trigger, so a bulk load is
--    one stamp), and by `mark_calling_window_rules_refreshed(source)`, which a platform job or an
--    operator calls after confirming the set is still current without changing it.
--
--    Seeded at apply time. That is the honest reading of "last refreshed" on the day it is
--    applied: the rules in the table are the set loaded by 20260913340000 and nothing has changed
--    them since — the seed says so in `source` rather than pretending a feed ran.
--
-- 2. THE REFUSAL. `tenant_can_dial_now` — the one function every dial path asks (serving, the
--    dialer's pre-flight, callbacks, booking) — returns false when the stamp is older than
--    `stale_after`, or missing. Fail closed: a state rule nobody has vouched for is not a rule to
--    dial under. `calling_window_rules_freshness()` lets the dialer and the settings screen say
--    that this, and not the clock, is why.
--
-- 3. THE STATES YOU DIAL. The board's "State rules in force" lists the states the agency works in,
--    including those whose law is simply the federal window. `tenant_dialing_states` returns the
--    states of the tenant's live leads, with counts, for the screen to list.
--
-- 4. THREE CORRECTIONS TO 20260924121000's `tenant_can_dial_now` (applied live 2026-09-24, so
--    corrected here rather than in that file):
--
--    a. Federal holidays belong to the agency switch. 121000 made the STATE rule's holiday check
--       include the NULL-coded federal calendar. Every seeded state rule has `block_holidays =
--       true` (a seed default, not a statute), so that blocks federal holidays for every tenant in
--       every state, and "No federal holidays" does nothing when off. The state rule now reads
--       that state's own holidays (its state_code, or '*'); federal holidays only the switch.
--    b. `v_local` is a `timestamp`. It holds the customer's wall clock; as a `timestamptz` it was
--       re-read in the session's zone before the hour and weekday were taken from it.
--    c. The campaign window is read with the tenant's id beside the campaign's, so another
--       tenant's campaign id cannot narrow — or be probed through — this tenant's window.
--
-- `tenant_can_dial_now` is otherwise reproduced from 20260924121000; the additions are the
-- freshness check at the top and the three corrections above.
-- ---------------------------------------------------------------------------

-- ── the stamp ──────────────────────────────────────────────────────────────
create table if not exists public.calling_window_rules_feed (
  id boolean primary key default true check (id),
  last_refreshed_at timestamptz not null,
  source text not null check (char_length(source) between 1 and 300),
  stale_after interval not null default interval '400 days' check (stale_after > interval '0'),
  updated_at timestamptz not null default now()
);

alter table public.calling_window_rules_feed enable row level security;
-- Platform data, read by the tenant plane (the settings screen and the dial check both run there),
-- written only by the platform. No tenant can move its own staleness clock.
drop policy if exists calling_window_rules_feed_read on public.calling_window_rules_feed;
create policy calling_window_rules_feed_read on public.calling_window_rules_feed
  for select to tenant_app using (true);

revoke all on public.calling_window_rules_feed from anon, authenticated, public;
grant select on public.calling_window_rules_feed to tenant_app;
grant select, insert, update, delete on public.calling_window_rules_feed to service_role;

insert into public.calling_window_rules_feed (id, last_refreshed_at, source)
values (true, now(), 'Stamped when 20260924230100 was applied, over the state statutes loaded by 20260913340000')
on conflict (id) do nothing;

create or replace function public.stamp_calling_window_rules_feed()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.calling_window_rules_feed (id, last_refreshed_at, source, updated_at)
  values (true, now(), left('Rules changed: ' || tg_table_name || ' ' || lower(tg_op), 300), now())
  on conflict (id) do update
    set last_refreshed_at = excluded.last_refreshed_at,
        source = excluded.source,
        updated_at = excluded.updated_at;
  return null;
end;
$function$;

revoke all on function public.stamp_calling_window_rules_feed() from public, anon, authenticated, tenant_app;

drop trigger if exists calling_window_state_rules_feed_stamp on public.calling_window_state_rules;
create trigger calling_window_state_rules_feed_stamp
  after insert or update or delete on public.calling_window_state_rules
  for each statement execute function public.stamp_calling_window_rules_feed();

drop trigger if exists calling_window_holidays_feed_stamp on public.calling_window_holidays;
create trigger calling_window_holidays_feed_stamp
  after insert or update or delete on public.calling_window_holidays
  for each statement execute function public.stamp_calling_window_rules_feed();

-- A refresh that confirms the set without changing it — the platform job, or an operator who has
-- checked the statutes. Service role only.
create or replace function public.mark_calling_window_rules_refreshed(p_source text)
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_at timestamptz := now();
begin
  if p_source is null or btrim(p_source) = '' then
    raise exception 'CALLING_RULES_REFRESH_SOURCE_REQUIRED';
  end if;
  insert into public.calling_window_rules_feed (id, last_refreshed_at, source, updated_at)
  values (true, v_at, left(btrim(p_source), 300), v_at)
  on conflict (id) do update
    set last_refreshed_at = excluded.last_refreshed_at,
        source = excluded.source,
        updated_at = excluded.updated_at;
  return v_at;
end;
$function$;

revoke all on function public.mark_calling_window_rules_refreshed(text) from public, anon, authenticated, tenant_app;
grant execute on function public.mark_calling_window_rules_refreshed(text) to service_role;

-- Stale when the stamp is older than its own limit — or absent, which is the same as never.
create or replace function public.calling_window_rules_stale(p_at timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select p_at - f.last_refreshed_at > f.stale_after from public.calling_window_rules_feed f where f.id),
    true
  );
$function$;

revoke all on function public.calling_window_rules_stale(timestamptz) from public, anon, authenticated;
grant execute on function public.calling_window_rules_stale(timestamptz) to tenant_app, service_role;

create or replace function public.calling_window_rules_freshness()
returns table(last_refreshed_at timestamptz, source text, stale_after_days integer, stale boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select f.last_refreshed_at,
         f.source,
         (extract(epoch from f.stale_after) / 86400)::integer,
         now() - f.last_refreshed_at > f.stale_after
    from public.calling_window_rules_feed f
   where f.id;
$function$;

revoke all on function public.calling_window_rules_freshness() from public, anon, authenticated;
grant execute on function public.calling_window_rules_freshness() to tenant_app, service_role;

-- ── the window, refusing on a stale feed ───────────────────────────────────
create or replace function public.tenant_can_dial_now(
  p_tenant_id uuid,
  p_state text,
  p_campaign_id uuid,
  p_at timestamptz default now()
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_zone text;
  -- The customer's wall clock: `p_at at time zone v_zone` is a local timestamp.
  v_local timestamp;
  v_minute integer;
  v_dow integer;
  v_start integer := 8 * 60;   -- federal floor, in minutes of the customer's day
  v_end integer := 21 * 60;
  v_rule record;
  v_tenant record;
  v_options record;
  v_campaign record;
  v_campaigns_apply boolean := true;
begin
  -- A lead with no state has no timezone and is not dialable. Absence of data is not permission.
  if p_state is null or p_state !~ '^[A-Za-z]{2}$' then return false; end if;

  -- A stale rules feed refuses the dial rather than guessing. Checked against now(), not p_at: the
  -- question is whether the rules can be trusted today, whatever instant is being asked about.
  if public.calling_window_rules_stale(now()) then return false; end if;

  select timezone into v_zone from public.state_timezones where state = upper(p_state);
  if v_zone is null then return false; end if;

  v_local := p_at at time zone v_zone;
  v_minute := extract(hour from v_local)::integer * 60 + extract(minute from v_local)::integer;
  v_dow := extract(dow from v_local)::integer;

  -- Each layer may only narrow. max(start), min(end) is the only operation, so a row that tries to
  -- widen is a no-op rather than a privilege escalation.
  select * into v_rule from public.calling_window_rules_in_force(v_local::date)
   where state = upper(p_state);
  if found then
    v_start := greatest(v_start, v_rule.start_hour * 60);
    v_end := least(v_end, v_rule.end_hour * 60);
    if v_rule.no_sunday and v_dow = 0 then return false; end if;
    -- The STATE's own holidays. Federal holidays (state_code NULL) are the agency switch's, below.
    if v_rule.no_holidays and exists (
      select 1 from public.calling_window_holidays h
       where h.holiday_date = v_local::date
         and h.state_code in ('*', upper(p_state))
    ) then return false; end if;
  end if;

  select * into v_tenant from public.tenant_calling_windows where tenant_id = p_tenant_id;
  if found then
    v_start := greatest(v_start, coalesce(v_tenant.start_minute, v_tenant.start_hour * 60));
    v_end := least(v_end, coalesce(v_tenant.end_minute, v_tenant.end_hour * 60));
  end if;

  select * into v_options from public.tenant_calling_window_options where tenant_id = p_tenant_id;
  if found then
    if v_options.no_sunday and v_dow = 0 then return false; end if;
    if v_options.no_federal_holidays and exists (
      select 1 from public.calling_window_holidays h
       where h.holiday_date = v_local::date
         and (h.state_code is null or h.state_code = '*')
    ) then return false; end if;
    v_campaigns_apply := coalesce(v_options.campaign_overrides_enabled, true);
  end if;

  if p_campaign_id is not null and v_campaigns_apply then
    select coalesce(calling_window_start_minute, calling_window_start_hour * 60) as s,
           coalesce(calling_window_end_minute, calling_window_end_hour * 60) as e
      into v_campaign from public.tenant_campaigns
     where id = p_campaign_id and tenant_id = p_tenant_id;
    if found and v_campaign.s is not null then v_start := greatest(v_start, v_campaign.s); end if;
    if found and v_campaign.e is not null then v_end := least(v_end, v_campaign.e); end if;
  end if;

  if v_start >= v_end then return false; end if;
  return v_minute >= v_start and v_minute < v_end;
end;
$function$;

revoke all on function public.tenant_can_dial_now(uuid, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.tenant_can_dial_now(uuid, text, uuid, timestamptz) to tenant_app, service_role;

-- ── the states this tenant dials ───────────────────────────────────────────
create or replace function public.tenant_dialing_states(p_tenant_id uuid)
returns table(state text, leads bigint)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select upper(btrim(l.values->>'state')) as state, count(*) as leads
    from public.agent_leads l
   where l.tenant_id = p_tenant_id
     and l.lead_state in ('fresh', 'working', 'retry', 'nurture')
     and upper(btrim(coalesce(l.values->>'state', ''))) ~ '^[A-Z]{2}$'
   group by 1
   order by 2 desc, 1
   limit 60;
$function$;

revoke all on function public.tenant_dialing_states(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_dialing_states(uuid) to service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'tenant_can_dial_now';
  if v_def !~ 'calling_window_rules_stale' then
    raise exception 'tenant_can_dial_now does not refuse on a stale rules feed';
  end if;
  if v_def !~ 'calling_window_rules_in_force' or v_def !~ 'tenant_calling_windows'
     or v_def !~ 'tenant_calling_window_options' or v_def !~ 'tenant_id = p_tenant_id' then
    raise exception 'tenant_can_dial_now lost a layer in the rewrite';
  end if;
  if public.calling_window_rules_stale(now()) then
    raise exception 'the rules feed is stale the moment it was stamped';
  end if;
  if not has_function_privilege('tenant_app', 'public.calling_window_rules_freshness()', 'execute') then
    raise exception 'tenant_app cannot read the rules feed stamp';
  end if;
end $$;
