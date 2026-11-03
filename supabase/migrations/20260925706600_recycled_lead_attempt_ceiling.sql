-- ---------------------------------------------------------------------------
-- Dialing cadence · a recycled lead stops at its batch's attempt ceiling
--
-- A recycle batch (20260925706500) sets agent_leads.attempt_ceiling on every lead it clears — the
-- board's "Attempts this pass", default 3. schedule_next_attempt is where a lead becomes exhausted,
-- so it is the one place that reads it: `v_ceiling := coalesce(v_lead_ceiling, 7)`. A lead with no
-- ceiling (every lead that was never recycled through a batch) behaves exactly as before.
--
-- The body is 20260924230300's, character for character, apart from the declaration, the select
-- and the one assignment marked 20260925706600. Signature, return type and grants unchanged.
-- complete_existing_dial_disposition (Dialer's) calls this and is not touched.
-- ---------------------------------------------------------------------------

alter table public.agent_leads add column if not exists attempt_ceiling integer;

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

  -- 20260925706600: a recycled lead carries its batch's ceiling for this pass (default 3); every
  -- other lead has none and keeps the cadence's seven.
  v_ceiling := coalesce(v_lead_ceiling, v_ceiling);

  v_next := v_made + 1;

  -- The seventh dial is the last. `v_made` already counts the dial that was just dispositioned, so
  -- `v_made >= v_ceiling` means "seven dials have happened"; the old ceiling-minus-one stopped at six.
  -- The ceiling terminates rather than schedules: a date far in the future would still be served
  -- eventually by a queue that only checks whether the timer has elapsed.
  if v_made >= v_ceiling then
    return query select null::timestamptz, v_next, null::text, true;
    return;
  end if;

  -- A campaign cadence replaces the tenant default entirely; the two are never merged.
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

  -- The default table from the task, front-loaded, used when no rule covers this attempt.
  if v_delay is null then
    v_delay := case v_next
      when 1 then interval '2 hours'
      when 2 then interval '1 day'
      when 3 then interval '1 day'
      when 4 then interval '2 days'
      when 5 then interval '3 days'
      else interval '5 days'
    end;
    if v_next = 4 then v_preferred := 'weekend'; end if;
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

do $$
declare
  v_src text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925706600: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'schedule_next_attempt'
     and pg_get_function_identity_arguments(p.oid) = 'p_tenant_id uuid, p_lead_id uuid, p_disposition text, p_at timestamp with time zone';
  if v_src is null then
    raise exception 'schedule_next_attempt is missing';
  end if;
  if v_src !~ 'v_ceiling := coalesce\(v_lead_ceiling, v_ceiling\)' or v_src !~ 'if v_made >= v_ceiling then' then
    raise exception 'schedule_next_attempt does not read the lead''s attempt ceiling';
  end if;
  -- 20260924230300's fixes survive.
  if v_src !~ 'tenant_can_dial_now\(p_tenant_id, v_state, v_campaign, v_t\)'
     or v_src !~ 'order by max\(ca\.attempted_at\) asc'
     or v_src ~ 'v_made >= v_ceiling - 1' then
    raise exception 'schedule_next_attempt lost a 20260924230300 fix';
  end if;
end $$;
