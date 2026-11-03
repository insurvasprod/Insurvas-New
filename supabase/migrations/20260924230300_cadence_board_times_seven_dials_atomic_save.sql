-- ---------------------------------------------------------------------------
-- Settings · Dialing cadence — the four things the board says and the scheduler did not do
--
-- 1. THE BOARD'S TIMES OF DAY. A rule could prefer one of six fixed slots. The board offers three
--    preferences a person actually thinks in — "opposite half of the day", "morning", "evening" —
--    and they are now real values of `preferred_slot`, honoured by `schedule_next_attempt`:
--
--      morning        the customer's local 00:00–12:00 (the legal window starts it at 8 or later)
--      evening        the customer's local 17:00 onward (the legal window ends it)
--      opposite_half  the other half of the day from the previous dial, in the customer's zone:
--                     a morning dial is retried after noon, an afternoon dial before it
--
--    The delay is still a FLOOR. From there the scheduler walks forward in 15-minute steps (at most
--    eight days) to the first instant that is inside the preferred part of the day AND inside the
--    legal window (`tenant_can_dial_now`, so federal, state, agency and campaign limits all apply).
--    Within the preferred part it takes a slot this lead has not failed in if one comes up within a
--    day of the first match, otherwise the first match. `next_dial_after` becomes that instant and
--    `next_preferred_slot` the slot it falls in, so the serving query's existing condition
--    (`current_slot_for_state(...) = next_preferred_slot`) admits the lead exactly then. No change
--    to `serve_next_lead` is needed, which matters because other work is touching it.
--
--    Preference chooses inside the window; it never moves the edge. When no legal instant in the
--    preferred part exists within eight days (a 9–5 agency asking for "evening"), the rule falls
--    back to ordinary slot rotation from the floor instead of never calling.
--
--    The six fixed slots stay valid values, so every stored rule keeps meaning what it meant.
--
-- 2. SEVEN DIALS. Comparing `v_made` with the ceiling minus one, with `attempts_made` already incremented made the
--    SIXTH dial the last, while the ceiling constant, the engine and the board all say seven. The
--    check is now `v_made >= v_ceiling`: the seventh dial is the last, then the lead rests. A lead
--    that was exhausted at six stays exhausted — this only changes what the scheduler decides next.
--
-- 3. A CAMPAIGN CADENCE REPLACES THE TENANT DEFAULT ENTIRELY. The board: "A campaign cadence
--    replaces this one entirely; the two are never merged." The lookup used to merge them attempt
--    by attempt (`campaign_id = v_campaign or campaign_id is null`, campaign row first). Now, if the
--    lead's campaign has ANY rule, only that campaign's rules are read; attempts it does not cover
--    use the built-in delay. A campaign with no rules still runs the tenant default.
--
-- 4. AN ATOMIC SAVE. The editor deleted a scope's rules and then inserted the new set in two
--    requests, so for the length of a round trip the dialer read the built-in cadence — and a
--    failed insert relied on a best-effort restore. `replace_cadence_rules` does both in one
--    transaction, refuses a campaign that is not the tenant's, and serialises concurrent saves of
--    the same scope. The scheduler reads the old rows until the new ones commit.
--
-- `schedule_next_attempt` is reproduced from 20260917144000 (the latest definition); the LRU
-- fallback, the null-slot guard and the advance-by-attempt rotation are unchanged.
-- ---------------------------------------------------------------------------

-- ── the board's preferences are storable ────────────────────────────────────
alter table public.tenant_cadence_rules
  drop constraint if exists tenant_cadence_rules_preferred_slot_check;
alter table public.tenant_cadence_rules
  drop constraint if exists tenant_cadence_rules_preferred_slot_known;
alter table public.tenant_cadence_rules
  add constraint tenant_cadence_rules_preferred_slot_known
  check (preferred_slot is null or preferred_slot in (
    'opposite_half', 'morning', 'evening',
    'early_morning', 'late_morning', 'afternoon', 'early_evening', 'late_evening', 'weekend'));

-- ── the scheduler ──────────────────────────────────────────────────────────
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
  select coalesce(attempts_made, 0), campaign_id, values->>'state'
    into v_made, v_campaign, v_state
    from agent_leads where id = p_lead_id and tenant_id = p_tenant_id;

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

-- ── the atomic save ────────────────────────────────────────────────────────
--
-- `p_rows` is a JSON array of {attemptNumber, delayInterval, preferredSlot, dispositionScope}. The
-- route has already validated every field (parseInterval, the slot vocabulary, no duplicates, no
-- gaps); the table's own checks and unique constraint still apply here, and any violation rolls the
-- whole save back, leaving the previous rules exactly as they were.
create or replace function public.replace_cadence_rules(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_rows jsonb
)
returns setof public.tenant_cadence_rules
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_tenant_id is null then
    raise exception 'CADENCE_TENANT_REQUIRED';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'CADENCE_ROWS_INVALID';
  end if;
  if p_campaign_id is not null and not exists (
    select 1 from tenant_campaigns c where c.id = p_campaign_id and c.tenant_id = p_tenant_id
  ) then
    raise exception 'CADENCE_CAMPAIGN_NOT_FOUND';
  end if;

  -- Two owners saving the same scope at once get one result each, in order, never an interleaving.
  perform pg_advisory_xact_lock(
    hashtextextended('cadence:' || p_tenant_id::text || ':' || coalesce(p_campaign_id::text, 'default'), 0)
  );

  delete from tenant_cadence_rules r
   where r.tenant_id = p_tenant_id
     and r.campaign_id is not distinct from p_campaign_id;

  insert into tenant_cadence_rules
    (tenant_id, campaign_id, attempt_number, delay_interval, preferred_slot, disposition_scope)
  select p_tenant_id,
         p_campaign_id,
         (e->>'attemptNumber')::integer,
         (e->>'delayInterval')::interval,
         nullif(e->>'preferredSlot', ''),
         nullif(btrim(coalesce(e->>'dispositionScope', '')), '')
    from jsonb_array_elements(p_rows) as e;

  return query
  select r.* from tenant_cadence_rules r
   where r.tenant_id = p_tenant_id
     and r.campaign_id is not distinct from p_campaign_id
   order by r.attempt_number, r.disposition_scope nulls first;
end;
$function$;

revoke all on function public.replace_cadence_rules(uuid, uuid, jsonb) from public, anon, authenticated, tenant_app;
grant execute on function public.replace_cadence_rules(uuid, uuid, jsonb) to service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'schedule_next_attempt';

  -- The fixes from 20260917144000 must survive this rewrite.
  if v_def !~ 'order by max\(ca\.attempted_at\) asc' then
    raise exception 'LA-2.7: the all-slots-used fallback is no longer least-recently-used';
  end if;
  if v_def ~ 'v_slot := v_tried\[1\]' then
    raise exception 'LA-2.7: the non-deterministic v_tried[1] fallback came back';
  end if;
  if v_def ~ 'v_ceiling - 1' then
    raise exception 'cadence: the scheduler still stops one dial short of the ceiling';
  end if;
  if v_def !~ 'opposite_half' or v_def !~ 'tenant_can_dial_now' then
    raise exception 'cadence: the board''s times of day are not honoured by the scheduler';
  end if;
  if v_def ~ 'r\.campaign_id = v_campaign or r\.campaign_id is null' then
    raise exception 'cadence: a campaign cadence is still merged with the tenant default';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tenant_cadence_rules'::regclass
       and conname = 'tenant_cadence_rules_preferred_slot_known'
  ) then
    raise exception 'cadence: the preferred-time vocabulary constraint is missing';
  end if;
end $$;
