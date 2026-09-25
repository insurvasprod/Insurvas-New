-- ---------------------------------------------------------------------------
-- Two defects in LA-2.8 and LA-2.9, found by re-running their suites after LA-2.13
--
-- Neither is a regression from LA-2.13. Both are faults the existing suites only catch under
-- conditions that had stopped holding, which is its own lesson: a green suite is evidence about the
-- run, not about the code, and both of these went green on fixture state rather than on behaviour.
--
-- ── ONE · a reclaimed lead is returned to a pool it can never be drawn from ──
--
-- LA-2.8 criterion 3 is "an abandoned lock returns the lead to the pool". The reclaim at the top of
-- serve_next_lead does return the WORK ITEM: status goes back to `unclaimed`, the lock is cleared.
-- Probed directly:
--
--   served first time                     73527921-...
--   lead_state after serve                working
--   re-served after abandoned lock        0
--   queue status after reclaim attempt    unclaimed
--
-- The lead itself is left in `lead_state = 'working'`, and no tier in serve_next_lead matches a
-- working lead. So the work item sits in the queue, visible, unclaimed, and permanently unservable.
-- An agent who claims a lead and walks away does not release it back to his colleagues; he destroys
-- it, quietly, and the queue reports itself as having work it will never hand out.
--
-- The reclaim now restores the lead as well as the work item. A lead nobody dialled goes back to
-- `fresh`, because nothing happened to it. A lead with attempts on it goes back to `retry`, due
-- immediately — it had already earned a place in the cadence, and the abandoned call is not an
-- attempt.
--
-- ── TWO · the cadence proposes the same slot forever ────────────────────────
--
-- LA-2.9 criterion 3 requires that a lead is never retried into a slot it has already failed in
-- while an unused slot remains. Re-running its suite:
--
--   attempt 2 was scheduled into early_morning, which it has already failed in
--
-- `schedule_next_attempt` built its "already tried" list from `tenant_call_attempts`, which records
-- the slot each call ACTUALLY HAPPENED IN — and six dispositions recorded in a loop all happen in
-- the same real-world slot. The slot it PROPOSED last time was never written down anywhere it would
-- read back, so it proposed the first unused slot, which is the same one, every time.
--
-- The suite passed previously because `tenant_cadence_rules` held fixture rows with a preferred
-- slot per attempt number, and those rows supplied the variation. There are zero cadence rules in
-- the database today, so the default path runs — and the default path could never rotate. A tenant
-- who has not configured a cadence, which is every tenant on the day this ships, gets the same slot
-- proposed on every attempt.
--
-- The fix advances through the unused slots by attempt number rather than always taking the first.
-- A configured preference still wins while it is unused, and a slot that has been dialled is still
-- never proposed while an undialled one remains — both of those are unchanged.
-- ---------------------------------------------------------------------------

-- ── ONE ────────────────────────────────────────────────────────────────────
do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'serve_next_lead';
  if v_src is null then raise exception 'serve_next_lead does not exist'; end if;
  if v_src ~ 'reclaimed' then
    raise notice 'serve_next_lead already restores the lead on reclaim';
    return;
  end if;

  v_new := replace(
    v_src,
    E'  update lead_queue q\n'
    || E'     set status = ''unclaimed'', claimed_by = null, owner_user_id = null, locked_until = null\n'
    || E'   where q.tenant_id = p_tenant_id\n'
    || E'     and q.status = ''claimed''\n'
    || E'     and q.locked_until is not null\n'
    || E'     and q.locked_until < v_now;',
    E'  with reclaimed as (\n'
    || E'    update lead_queue q\n'
    || E'       set status = ''unclaimed'', claimed_by = null, owner_user_id = null, locked_until = null\n'
    || E'     where q.tenant_id = p_tenant_id\n'
    || E'       and q.status = ''claimed''\n'
    || E'       and q.locked_until is not null\n'
    || E'       and q.locked_until < v_now\n'
    || E'    returning q.lead_id\n'
    || E'  )\n'
    || E'  update agent_leads l\n'
    || E'     set lead_state = case when coalesce(l.attempts_made, 0) = 0 then ''fresh'' else ''retry'' end,\n'
    || E'         next_dial_after = case when coalesce(l.attempts_made, 0) = 0 then l.next_dial_after\n'
    || E'                                else least(coalesce(l.next_dial_after, v_now), v_now) end,\n'
    || E'         updated_at = v_now\n'
    || E'   from reclaimed rc\n'
    || E'  where l.id = rc.lead_id\n'
    || E'    and l.tenant_id = p_tenant_id\n'
    || E'    and l.lead_state = ''working'';'
  );

  if v_new = v_src then
    raise exception 'serve_next_lead does not contain the expected reclaim block';
  end if;
  execute v_new;
  raise notice 'serve_next_lead now returns the LEAD to the pool, not just the work item';
end $$;

-- ── TWO ────────────────────────────────────────────────────────────────────
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
begin
  select coalesce(attempts_made, 0), campaign_id, values->>'state'
    into v_made, v_campaign, v_state
    from agent_leads where id = p_lead_id and tenant_id = p_tenant_id;

  v_next := v_made + 1;

  -- The ceiling terminates rather than schedules. Returning a date far in the future would have
  -- been the easy way to say "stop" and the wrong one: a queue that only checks whether the timer
  -- has elapsed would serve it eventually.
  if v_made >= v_ceiling - 1 then
    return query select null::timestamptz, v_next, null::text, true;
    return;
  end if;

  -- A disposition-specific row beats the catch-all, and a campaign row beats the tenant default.
  -- "No-answer and voicemail should not behave identically."
  select r.delay_interval, r.preferred_slot into v_delay, v_preferred
    from tenant_cadence_rules r
   where r.tenant_id = p_tenant_id
     and r.attempt_number = v_next
     and (r.campaign_id = v_campaign or r.campaign_id is null)
     and (r.disposition_scope = p_disposition or r.disposition_scope is null)
   order by (r.campaign_id is not null) desc, (r.disposition_scope is not null) desc
   limit 1;

  -- The default table from the task, front-loaded, used when the tenant has defined nothing.
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

  -- Slots this lead has already been DIALLED in.
  select coalesce(array_agg(distinct ca.slot), array[]::text[]) into v_tried
    from tenant_call_attempts ca
   where ca.tenant_id = p_tenant_id and ca.lead_id = p_lead_id;

  -- A preference is honoured only while it is unused: a stored preference must not override the
  -- evidence that it already failed.
  if v_preferred is not null and not (v_preferred = any(v_tried)) then
    v_slot := v_preferred;
  else
    select coalesce(array_agg(s order by ord), array[]::text[]) into v_unused
      from unnest(v_available) with ordinality as u(s, ord)
     where not (u.s = any(v_tried));

    if array_length(v_unused, 1) is null then
      -- Everything has been dialled: still call, just without a fresh hypothesis. The criterion is
      -- "never retried into a slot it has already failed in WHILE AN UNUSED SLOT REMAINS".
      v_slot := v_tried[1];
    else
      -- ADVANCE BY ATTEMPT NUMBER rather than always taking the first unused slot. Every call in a
      -- single working day happens in the same real-world slot, so `v_tried` barely moves between
      -- attempts, and taking the first unused entry proposed the same hour over and over. The
      -- proposal is a hypothesis about when this person answers; repeating one that has already
      -- been made is not a hypothesis.
      v_slot := v_unused[((v_next - 1) % array_length(v_unused, 1)) + 1];
    end if;
  end if;

  return query select p_at + v_delay, v_next, v_slot, false;
end;
$function$;

revoke all on function public.schedule_next_attempt(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.schedule_next_attempt(uuid, uuid, text, timestamptz) to tenant_app, service_role;

do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'serve_next_lead'
         and pg_get_functiondef(p.oid) ~ 'reclaimed') <> 1 then
    raise exception 'the reclaim fix did not land';
  end if;
  raise notice 'LA-2.8/2.9: reclaimed leads are servable again, and the cadence rotates its proposal';
end $$;
