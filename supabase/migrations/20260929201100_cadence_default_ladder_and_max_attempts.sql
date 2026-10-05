-- ---------------------------------------------------------------------------
-- LA-2.7-3 / LA-2.7-6 / LA-2.7-8 · the built-in ladder the spec gives, one meaning for "rule N",
-- and max attempts as a setting
--
-- 1. One meaning. schedule_next_attempt runs after a dial is dispositioned, with attempts_made
--    already counting it, and reads the rule for attempt_number = attempts_made + 1. So "rule N"
--    is the WAIT BEFORE DIAL N, counted from dial N-1. That is what every saved tenant rule has
--    always meant to the dialer, and the editor and the lead record already say so ("2 hours after
--    #1"). It stays, so no tenant's saved cadence changes behaviour.
--
--    The built-in fallback was one step out of it: its "attempt 1 = 2 hours" was never read, so
--    the ladder the dialer walked was +1d, +1d, +2d, +3d, +5d, +5d. It now walks the spec's
--    +2h, +1d, +1d, +2d (weekend), +3d, +5d: rule 2 = 2 hours, 3 = 1 day, 4 = 1 day,
--    5 = 2 days preferring the weekend, 6 = 3 days, 7 and later = 5 days.
--    lib/cadence/engine.ts DEFAULT_CADENCE and lib/cadence/ladder.ts builtInRule carry the same
--    table, attempt numbers 2 to 7.
--
-- 2. Max attempts. The ceiling was the literal 7. tenant_cadence_limits holds it per tenant, with a
--    per-campaign override, because the cadence itself is scoped that way. The order is
--    the lead's own recycle ceiling (20260925706600) > the campaign's > the tenant's > 7.
--    cadence_max_attempts() answers it for any reader. The scheduler's exhaustion is unchanged:
--    a lead at the ceiling becomes 'exhausted', which stamps nurture_entered_at
--    (stamp_lead_nurture_entry) and is never served.
-- ---------------------------------------------------------------------------

create table if not exists public.tenant_cadence_limits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- NULL is the tenant default. A campaign row overrides it for that campaign only.
  campaign_id uuid references public.tenant_campaigns(id) on delete cascade,
  max_attempts integer not null check (max_attempts between 1 and 20),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  constraint tenant_cadence_limits_one_per_scope unique nulls not distinct (tenant_id, campaign_id)
);

alter table public.tenant_cadence_limits enable row level security;
drop policy if exists tenant_cadence_limits_tenant_scoped on public.tenant_cadence_limits;
create policy tenant_cadence_limits_tenant_scoped on public.tenant_cadence_limits
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_cadence_limits from anon, authenticated, public;
grant select on public.tenant_cadence_limits to tenant_app;
grant select, insert, update, delete on public.tenant_cadence_limits to service_role;

-- The ceiling for a lead in this campaign, before the lead's own recycle ceiling.
create or replace function public.cadence_max_attempts(p_tenant_id uuid, p_campaign_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select l.max_attempts from public.tenant_cadence_limits l
      where l.tenant_id = p_tenant_id and p_campaign_id is not null and l.campaign_id = p_campaign_id),
    (select l.max_attempts from public.tenant_cadence_limits l
      where l.tenant_id = p_tenant_id and l.campaign_id is null),
    7
  );
$function$;

revoke all on function public.cadence_max_attempts(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cadence_max_attempts(uuid, uuid) to tenant_app, service_role;

-- The one writer. The campaign is checked against the tenant here, because the service client that
-- calls it bypasses RLS. p_max NULL clears the scope back to what it inherits.
create or replace function public.set_cadence_max_attempts(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_max integer,
  p_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_tenant_id is null then raise exception 'CADENCE_TENANT_REQUIRED'; end if;
  if p_campaign_id is not null and not exists (
    select 1 from public.tenant_campaigns c where c.id = p_campaign_id and c.tenant_id = p_tenant_id
  ) then
    raise exception 'CADENCE_CAMPAIGN_NOT_FOUND';
  end if;
  if p_max is null then
    delete from public.tenant_cadence_limits l
     where l.tenant_id = p_tenant_id and l.campaign_id is not distinct from p_campaign_id;
  else
    if p_max < 1 or p_max > 20 then raise exception 'CADENCE_MAX_ATTEMPTS_RANGE'; end if;
    insert into public.tenant_cadence_limits (tenant_id, campaign_id, max_attempts, updated_at, updated_by)
    values (p_tenant_id, p_campaign_id, p_max, now(), p_user_id)
    on conflict on constraint tenant_cadence_limits_one_per_scope
    do update set max_attempts = excluded.max_attempts, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  end if;
  return public.cadence_max_attempts(p_tenant_id, p_campaign_id);
end;
$function$;

revoke all on function public.set_cadence_max_attempts(uuid, uuid, integer, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.set_cadence_max_attempts(uuid, uuid, integer, uuid) to service_role;

-- ── the scheduler, restated from its live body (20260925706600) ─────────────
-- Two changes, each marked 201100: the ceiling reads the setting, and the built-in table is the
-- spec's ladder in the scheduler's own numbering. Signature, return type and grants unchanged.
create or replace function public.schedule_next_attempt(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_disposition text,
  p_at timestamptz default now()
)
returns table(due_at timestamptz, attempt_number integer, slot text, exhausted boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_made integer;
  v_next integer;
  v_ceiling integer := 7;
  v_lead_ceiling integer;
  v_campaign uuid;
  v_state text;
  v_delay interval;
  v_preferred text;
  v_slot text;
  v_tried text[];
  v_unused text[];
  v_available text[] := array['early_morning','late_morning','afternoon','early_evening','late_evening','weekend'];
  v_campaign_owns boolean := false;
  v_due timestamptz;
  v_zone text;
  v_last timestamptz;
  v_last_hour integer;
  v_from integer;
  v_to integer;
  v_t timestamptz;
  v_hour integer;
  v_here text;
  v_first timestamptz;
  v_first_slot text;
  v_found timestamptz;
  v_found_slot text;
  v_step integer;
begin
  select coalesce(attempts_made, 0), campaign_id, values->>'state', attempt_ceiling
    into v_made, v_campaign, v_state, v_lead_ceiling
    from agent_leads where id = p_lead_id and tenant_id = p_tenant_id;

  -- [201100] Max attempts is a setting: the campaign's, else the tenant's, else seven.
  v_ceiling := coalesce(public.cadence_max_attempts(p_tenant_id, v_campaign), v_ceiling);
  -- 20260925706600: a recycled lead carries its batch's ceiling for this pass (default 3), and it
  -- still wins over the setting. Every other lead has none.
  v_ceiling := coalesce(v_lead_ceiling, v_ceiling);

  v_next := v_made + 1;

  -- `v_made` already counts the dial that was just dispositioned, so `v_made >= v_ceiling` means
  -- "the ceiling's worth of dials have happened". The ceiling terminates rather than schedules: a
  -- date far in the future would still be served eventually by a queue that only checks whether
  -- the timer has elapsed.
  if v_made >= v_ceiling then
    return query select null::timestamptz, v_next, null::text, true;
    return;
  end if;

  -- A campaign cadence replaces the tenant default entirely. The two are never merged.
  if v_campaign is not null then
    select exists (
      select 1 from tenant_cadence_rules r
       where r.tenant_id = p_tenant_id and r.campaign_id = v_campaign
    ) into v_campaign_owns;
  end if;

  -- A disposition-specific row beats the catch-all. "No-answer and voicemail should not behave
  -- identically."
  select r.delay_interval, r.preferred_slot into v_delay, v_preferred
    from tenant_cadence_rules r
   where r.tenant_id = p_tenant_id
     and r.attempt_number = v_next
     and (case when v_campaign_owns then r.campaign_id = v_campaign else r.campaign_id is null end)
     and (r.disposition_scope = p_disposition or r.disposition_scope is null)
   order by (r.disposition_scope is not null) desc
   limit 1;

  -- [201100] The spec's front-loaded ladder, +2h, +1d, +1d, +2d (weekend), +3d, +5d, in the
  -- scheduler's numbering: the rule for attempt N is the wait before dial N. Attempt 1 is the
  -- first dial and is never looked up here.
  if v_delay is null then
    v_delay := case v_next
      when 2 then interval '2 hours'
      when 3 then interval '1 day'
      when 4 then interval '1 day'
      when 5 then interval '2 days'
      when 6 then interval '3 days'
      else interval '5 days'
    end;
    if v_next = 5 then v_preferred := 'weekend'; end if;
  end if;

  v_due := p_at + v_delay;

  -- Slots this lead has already been DIALLED in. `slot` is NOT NULL on the attempts table, but the
  -- filter is explicit anyway: a single null would make `not (s = any(v_tried))` evaluate to null
  -- for every candidate and silently empty `v_unused`, which would turn slot rotation off across
  -- the whole tenant without any error.
  select coalesce(array_agg(distinct ca.slot), array[]::text[]) into v_tried
    from tenant_call_attempts ca
   where ca.tenant_id = p_tenant_id and ca.lead_id = p_lead_id and ca.slot is not null;

  -- ── the board's three preferences: a part of the day, found inside the legal window ──
  if v_preferred in ('morning', 'evening', 'opposite_half') then
    select timezone into v_zone from state_timezones where state = upper(coalesce(v_state, ''));

    if v_zone is not null then
      select max(ca.attempted_at) into v_last
        from tenant_call_attempts ca
       where ca.tenant_id = p_tenant_id and ca.lead_id = p_lead_id;
      v_last_hour := extract(hour from (coalesce(v_last, p_at) at time zone v_zone))::integer;

      v_from := case v_preferred
        when 'morning' then 0
        when 'evening' then 17
        else case when v_last_hour < 12 then 12 else 0 end
      end;
      v_to := case v_preferred
        when 'morning' then 12
        when 'evening' then 24
        else case when v_last_hour < 12 then 24 else 12 end
      end;

      v_t := v_due;
      -- 8 days of 15-minute steps. The legal-window check runs only on steps already inside the
      -- preferred hours, so an "evening" search asks it about 28 times a day, not 96.
      for v_step in 0 .. 768 loop
        v_hour := extract(hour from (v_t at time zone v_zone))::integer;
        if v_hour >= v_from and v_hour < v_to
           and tenant_can_dial_now(p_tenant_id, v_state, v_campaign, v_t) then
          v_here := current_slot_for_state(v_state, v_t);
          if v_first is null then
            v_first := v_t;
            v_first_slot := v_here;
          end if;
          -- Rotation still applies inside the preference: an untried slot wins if one comes up
          -- within a day of the first legal match.
          if v_here is not null and not (v_here = any(v_tried)) then
            v_found := v_t;
            v_found_slot := v_here;
            exit;
          end if;
          exit when v_t > v_first + interval '1 day';
        end if;
        -- The next quarter hour on the clock, so later steps land on :00, :15, :30, :45.
        v_t := date_trunc('hour', v_t)
               + make_interval(mins => ((floor(extract(minute from v_t) / 15)::integer + 1) * 15));
      end loop;

      if v_found is not null then
        return query select v_found, v_next, v_found_slot, false;
        return;
      elsif v_first is not null and v_first_slot is not null then
        return query select v_first, v_next, v_first_slot, false;
        return;
      end if;
    end if;

    -- No legal instant in the preferred part of the day within eight days, or no timezone for the
    -- lead's state: fall through to ordinary rotation from the floor rather than never calling.
    v_preferred := null;
  end if;

  -- A preference is honoured only while it is unused: a stored preference must not override the
  -- evidence that it already failed.
  if v_preferred is not null and not (v_preferred = any(v_tried)) then
    v_slot := v_preferred;
  else
    select coalesce(array_agg(s order by ord), array[]::text[]) into v_unused
      from unnest(v_available) with ordinality as u(s, ord)
     where not (u.s = any(v_tried));

    if array_length(v_unused, 1) is null then
      -- Every slot has been dialled. Decision 2: take the LEAST RECENTLY USED slot rather than
      -- blocking. `ca.slot` breaks ties so the answer is deterministic.
      select ca.slot into v_slot
        from tenant_call_attempts ca
       where ca.tenant_id = p_tenant_id and ca.lead_id = p_lead_id and ca.slot is not null
       group by ca.slot
       order by max(ca.attempted_at) asc, ca.slot asc
       limit 1;
      v_slot := coalesce(v_slot, v_available[1]);
    else
      -- ADVANCE BY ATTEMPT NUMBER rather than always taking the first unused slot. Every call in a
      -- single working day happens in the same real-world slot, so `v_tried` barely moves between
      -- attempts, and taking the first unused entry proposed the same hour over and over.
      v_slot := v_unused[((v_next - 1) % array_length(v_unused, 1)) + 1];
    end if;
  end if;

  -- The delay is a FLOOR, not an appointment: the serving query holds the lead back until the
  -- chosen slot actually arrives.
  return query select v_due, v_next, v_slot, false;
end;
$function$;

revoke all on function public.schedule_next_attempt(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.schedule_next_attempt(uuid, uuid, text, timestamptz) to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_src text;
  v_lead record;
  v_sched record;
  v_at constant timestamptz := timestamptz '2026-10-06 15:00:00+00';
  v_state text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929201100: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  select pg_get_functiondef('public.schedule_next_attempt(uuid,uuid,text,timestamp with time zone)'::regprocedure) into v_src;
  if strpos(v_src, 'cadence_max_attempts(p_tenant_id, v_campaign)') = 0 then
    raise exception 'the scheduler does not read max attempts';
  end if;
  if strpos(v_src, 'v_ceiling := coalesce(v_lead_ceiling, v_ceiling)') = 0 then
    raise exception 'the recycled lead ceiling no longer wins';
  end if;
  if strpos(v_src, 'when 1 then interval') > 0 then
    raise exception 'the built-in table still carries an attempt-1 row the scheduler never reads';
  end if;

  -- Behaviour, built and rolled back. A lead on a tenant with no cadence rules and no limits, in a
  -- state with a timezone, with no recycle ceiling.
  begin
    select l.id, l.tenant_id into v_lead
      from public.agent_leads l
     where l.attempt_ceiling is null
       and l.values->>'state' ~ '^[A-Za-z]{2}$'
       and not exists (select 1 from public.tenant_cadence_rules r where r.tenant_id = l.tenant_id)
       and not exists (select 1 from public.tenant_cadence_limits m where m.tenant_id = l.tenant_id)
       and not exists (select 1 from public.tenant_call_attempts ca where ca.lead_id = l.id)
     limit 1;
    if v_lead.id is null then raise exception 'SKIP no lead to test with'; end if;
    update public.agent_leads set campaign_id = null where id = v_lead.id;

    -- After dial 1 the built-in wait is two hours (the spec's first step).
    update public.agent_leads set attempts_made = 1 where id = v_lead.id;
    select * into v_sched from public.schedule_next_attempt(v_lead.tenant_id, v_lead.id, 'no_answer', v_at);
    if v_sched.exhausted or v_sched.attempt_number <> 2 or v_sched.due_at <> v_at + interval '2 hours' then
      raise exception 'after dial 1 the built-in ladder waits % (attempt %), not 2 hours', v_sched.due_at - v_at, v_sched.attempt_number;
    end if;
    -- After dial 4, two days (the weekend step), after dial 6 five days.
    update public.agent_leads set attempts_made = 4 where id = v_lead.id;
    select * into v_sched from public.schedule_next_attempt(v_lead.tenant_id, v_lead.id, 'no_answer', v_at);
    if v_sched.due_at <> v_at + interval '2 days' or v_sched.slot <> 'weekend' then
      raise exception 'after dial 4 the built-in ladder gives % in %, not 2 days in the weekend slot', v_sched.due_at - v_at, v_sched.slot;
    end if;
    update public.agent_leads set attempts_made = 6 where id = v_lead.id;
    select * into v_sched from public.schedule_next_attempt(v_lead.tenant_id, v_lead.id, 'no_answer', v_at);
    if v_sched.exhausted or v_sched.due_at <> v_at + interval '5 days' then
      raise exception 'after dial 6 the built-in ladder gives %, not 5 days', v_sched.due_at - v_at;
    end if;
    -- Dial 7 is the last by default.
    update public.agent_leads set attempts_made = 7 where id = v_lead.id;
    select * into v_sched from public.schedule_next_attempt(v_lead.tenant_id, v_lead.id, 'no_answer', v_at);
    if not v_sched.exhausted then raise exception 'the seventh dial did not exhaust the lead'; end if;

    -- A tenant setting of 3 ends it after the third.
    perform public.set_cadence_max_attempts(v_lead.tenant_id, null, 3, null);
    update public.agent_leads set attempts_made = 3 where id = v_lead.id;
    select * into v_sched from public.schedule_next_attempt(v_lead.tenant_id, v_lead.id, 'no_answer', v_at);
    if not v_sched.exhausted then raise exception 'max attempts 3 did not exhaust after the third dial'; end if;
    -- The lead's own recycle ceiling still wins over the setting.
    update public.agent_leads set attempt_ceiling = 5 where id = v_lead.id;
    select * into v_sched from public.schedule_next_attempt(v_lead.tenant_id, v_lead.id, 'no_answer', v_at);
    if v_sched.exhausted then raise exception 'the per-lead recycle ceiling no longer wins over max attempts'; end if;
    -- Exhausting stamps nurture_entered_at (LA-2.7-6).
    update public.agent_leads set lead_state = 'exhausted', nurture_entered_at = null where id = v_lead.id;
    if (select nurture_entered_at from public.agent_leads where id = v_lead.id) is null then
      raise exception 'exhausting a lead did not stamp nurture_entered_at';
    end if;

    raise exception using errcode = 'P0099', message = '20260929201100 probe rollback';
  exception
    when sqlstate 'P0099' then null;
    when raise_exception then
      if sqlerrm like 'SKIP%' then raise notice '20260929201100: %', sqlerrm; else raise; end if;
  end;

  if has_function_privilege('tenant_app', 'public.set_cadence_max_attempts(uuid, uuid, integer, uuid)', 'execute') then
    raise exception 'tenant_app can set max attempts directly';
  end if;
  raise notice '20260929201100: built-in ladder is +2h +1d +1d +2d +3d +5d, max attempts is a setting';
end $$;
