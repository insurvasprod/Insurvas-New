-- ---------------------------------------------------------------------------
-- Settings · Calling windows — minute precision, three agency switches, a reason per campaign
--
-- What the screen shows and the database could not hold, each enforced in `tenant_can_dial_now`
-- (the one function the serving query, booking and every other dial path ask):
--
--   1. MINUTES. The tenant and campaign windows were whole hours (`start_hour`, `end_hour`). An
--      agency that stops at 7:30 pm could not say so. New nullable minute-of-day columns sit beside
--      the hour columns; when set they win, and the hour columns keep being written (rounded
--      inward) so anything still reading hours sees a window no wider than the real one.
--
--   2. THREE SWITCHES, in `tenant_calling_window_options` (a row may exist with no hours set):
--        no_sunday                   nothing dials on a Sunday in the customer's zone, any state
--        no_federal_holidays         nothing dials on a date in the federal holiday calendar
--        campaign_overrides_enabled  off = per-campaign narrowing is ignored (it can only narrow,
--                                    so turning it off can only restore the agency's own window)
--
--   3. A REASON for each campaign's narrowing (`tenant_campaigns.calling_window_reason`), so the
--      next owner knows why a campaign stops at 6pm.
--
-- One correction, and it NARROWS: the holiday check read `state_code in ('*', <state>)`, but the
-- federal holidays in `calling_window_holidays` are stored with state_code NULL (verified on the
-- live table: all eight rows). So a state whose rule says "no holidays" — every state — was never
-- actually blocked on Thanksgiving or Christmas. The check now includes NULL.
--
-- `tenant_can_dial_now` is reproduced from 20260913330000 (the only migration that defines it);
-- every existing layer is kept, in the same order, with the same fail-closed guards.
-- ---------------------------------------------------------------------------

-- ── minutes on the tenant window ───────────────────────────────────────────
alter table public.tenant_calling_windows
  add column if not exists start_minute integer,
  add column if not exists end_minute integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_calling_windows_minutes_sane') then
    alter table public.tenant_calling_windows
      add constraint tenant_calling_windows_minutes_sane
      check ((start_minute is null or start_minute between 0 and 1439)
             and (end_minute is null or end_minute between 1 and 1440)
             and (start_minute is null or end_minute is null or start_minute < end_minute));
  end if;
end $$;

-- ── minutes and a reason on the campaign window ────────────────────────────
alter table public.tenant_campaigns
  add column if not exists calling_window_start_minute integer,
  add column if not exists calling_window_end_minute integer,
  add column if not exists calling_window_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_campaigns_calling_window_minutes_sane') then
    alter table public.tenant_campaigns
      add constraint tenant_campaigns_calling_window_minutes_sane
      check ((calling_window_start_minute is null or calling_window_start_minute between 0 and 1439)
             and (calling_window_end_minute is null or calling_window_end_minute between 1 and 1440)
             and (calling_window_start_minute is null or calling_window_end_minute is null
                  or calling_window_start_minute < calling_window_end_minute)
             and (calling_window_reason is null or char_length(calling_window_reason) <= 200));
  end if;
end $$;

-- ── the agency's switches ──────────────────────────────────────────────────
create table if not exists public.tenant_calling_window_options (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  no_sunday boolean not null default false,
  no_federal_holidays boolean not null default false,
  campaign_overrides_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);

alter table public.tenant_calling_window_options enable row level security;
drop policy if exists tenant_calling_window_options_tenant_scoped on public.tenant_calling_window_options;
create policy tenant_calling_window_options_tenant_scoped on public.tenant_calling_window_options
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_calling_window_options from anon, authenticated, public;
grant select, insert, update on public.tenant_calling_window_options to tenant_app;
grant select, insert, update, delete on public.tenant_calling_window_options to service_role;

-- ── the window, in minutes ─────────────────────────────────────────────────
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
  v_local timestamptz;
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
    -- Federal holidays are stored with state_code NULL; '*' is kept for any row written that way.
    if v_rule.no_holidays and exists (
      select 1 from public.calling_window_holidays h
       where h.holiday_date = v_local::date
         and (h.state_code is null or h.state_code in ('*', upper(p_state)))
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
      into v_campaign from public.tenant_campaigns where id = p_campaign_id;
    if found and v_campaign.s is not null then v_start := greatest(v_start, v_campaign.s); end if;
    if found and v_campaign.e is not null then v_end := least(v_end, v_campaign.e); end if;
  end if;

  if v_start >= v_end then return false; end if;
  return v_minute >= v_start and v_minute < v_end;
end;
$function$;

revoke all on function public.tenant_can_dial_now(uuid, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.tenant_can_dial_now(uuid, text, uuid, timestamptz) to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'tenant_can_dial_now';
  if v_def !~ 'calling_window_rules_in_force' or v_def !~ 'tenant_calling_windows'
     or v_def !~ 'tenant_calling_window_options' or v_def !~ 'h\.state_code is null' then
    raise exception 'tenant_can_dial_now lost a layer in the rewrite';
  end if;
  if not has_table_privilege('tenant_app', 'public.tenant_calling_window_options', 'select') then
    raise exception 'tenant_app cannot read the calling-window options';
  end if;
end $$;
