-- ---------------------------------------------------------------------------
-- Callbacks · the callback-due job fails every minute: "column reference q.id is ambiguous"
--
-- Found live 2026-09-25 (cron.job_run_details, pasted by the user): every run of pg_cron job
-- callback-due since 20260925708700 was applied failed with
--   ERROR: column reference "q.id" is ambiguous  LINE 3: join public.lead_queue q ...
-- run_callback_due declares a PL/pgSQL variable `q public.lead_queue` (step 2) and step 3's query
-- also aliased lead_queue as `q`. Inside PL/pgSQL `q.id` then names both. The failure rolls the
-- whole run back, so steps 1 and 2 never landed either: the two live callbacks due 23 and 24 Sep
-- were never marked missed, and no callback has come due since.
--
-- The fix, and nothing else: step 3's alias is `wq`. The function is restated verbatim from
-- 20260925708700 otherwise (generated from that file, not retyped). The pg_cron jobs call it by
-- name, so they pick up the new body on their next run; the schedule is unchanged.
--
-- 708700's check block compiled and inspected the function but never ran it, so the error only
-- surfaced under pg_cron. The block below runs it once and rolls the run back.
-- ---------------------------------------------------------------------------

create or replace function public.run_callback_due(p_now timestamptz default now(), p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 2000));
  v_stale boolean := false;
  v_missed integer := 0;
  v_due integer := 0;
  v_reopened integer := 0;
  v_released integer := 0;
  v_day_end timestamptz;
  v_next timestamptz;
  c record;
  q public.lead_queue;
begin
  -- A stale rules feed makes tenant_can_dial_now refuse every instant. That must not read as
  -- "the window has closed": while it is stale only the end of the customer's day makes a miss.
  if to_regprocedure('public.calling_window_rules_stale(timestamp with time zone)') is not null then
    v_stale := public.calling_window_rules_stale(now());
  end if;

  -- ── 1 · missed: the customer's window has closed on the due day ────────
  for c in
    select cb.id, cb.tenant_id, cb.lead_id, cb.status, cb.scheduled_at_utc, cb.customer_timezone,
           l.values->>'state' as lead_state_code, l.campaign_id as lead_campaign
      from public.tenant_callbacks cb
      join public.agent_leads l on l.id = cb.lead_id and l.tenant_id = cb.tenant_id
     where cb.status in ('scheduled', 'due')
       and cb.scheduled_at_utc < p_now
     order by cb.scheduled_at_utc
     limit v_limit
     for update of cb skip locked
  loop
    v_day_end := (((c.scheduled_at_utc at time zone c.customer_timezone)::date + 1)::timestamp
                  at time zone c.customer_timezone);
    v_next := null;
    if p_now < v_day_end and not v_stale
       and not public.tenant_can_dial_now(c.tenant_id, c.lead_state_code, c.lead_campaign, p_now) then
      v_next := public.next_callable_instant(c.tenant_id, c.lead_id, p_now, v_day_end);
    end if;
    if p_now >= v_day_end
       or (not v_stale
           and not public.tenant_can_dial_now(c.tenant_id, c.lead_state_code, c.lead_campaign, p_now)
           and (v_next is null or v_next >= v_day_end)) then
      update public.tenant_callbacks
         set status = 'missed', missed_at = coalesce(missed_at, p_now), updated_at = p_now
       where id = c.id;
      insert into public.callback_history
        (tenant_id, callback_id, lead_id, actor_user_id, action, old_scheduled_at_utc, old_status, new_status, note, via)
      values
        (c.tenant_id, c.id, c.lead_id, null, 'missed', c.scheduled_at_utc, c.status, 'missed',
         'The customer''s calling window closed on the due day with no kept call', 'system');
      insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
      values ('system', null, 'tenant.callback_missed', 'callback', c.id::text,
              jsonb_build_object('tenantId', c.tenant_id, 'leadId', c.lead_id, 'scheduledAtUtc', c.scheduled_at_utc));
      v_missed := v_missed + 1;
    end if;
  end loop;

  -- ── 2 · due: back with the agent who booked it ─────────────────────────
  for c in
    select cb.*
      from public.tenant_callbacks cb
     where cb.status = 'scheduled'
       and cb.scheduled_at_utc <= p_now
     order by cb.scheduled_at_utc
     limit v_limit
     for update skip locked
  loop
    select * into q from public.lead_queue
     where id = c.work_item_id and tenant_id = c.tenant_id
     for update;
    if found
       and q.status in ('completed', 'dropped')
       and q.disposition is not null
       and exists (select 1 from public.agent_leads l
                    where l.id = c.lead_id and l.tenant_id = c.tenant_id and l.lead_state = 'working')
       -- The lead is not already being worked through another work item.
       and not exists (select 1 from public.lead_queue o
                        where o.tenant_id = c.tenant_id and o.lead_id = c.lead_id and o.id <> q.id
                          and o.status in ('unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active'))
       -- The agent can still take work here.
       and exists (select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id
                    where tu.tenant_id = c.tenant_id and tu.user_id = c.assigned_to
                      and tu.accepted_at is not null and u.status::text = 'active')
    then
      update public.lead_queue
         set status = 'claimed', owner_user_id = c.assigned_to, claimed_by = c.assigned_to, claimed_at = p_now,
             locked_until = null, disposition = null, disposition_at = null, disposition_by = null,
             updated_at = p_now
       where id = q.id;
      update public.tenant_callbacks
         set status = 'due', reopened_at = p_now, released_at = null, updated_at = p_now,
             reopened_from = jsonb_build_object(
               'status', q.status, 'disposition', q.disposition, 'disposition_at', q.disposition_at,
               'disposition_by', q.disposition_by, 'owner_user_id', q.owner_user_id, 'claimed_by', q.claimed_by,
               'claimed_at', q.claimed_at, 'owner_role', q.owner_role)
       where id = c.id;
      insert into public.callback_history
        (tenant_id, callback_id, lead_id, actor_user_id, action, old_scheduled_at_utc, old_status, new_status, note, via)
      values
        (c.tenant_id, c.id, c.lead_id, null, 'reopened', c.scheduled_at_utc, 'scheduled', 'due',
         'Due: the lead is back with the agent who booked it', 'system');
      v_reopened := v_reopened + 1;
    else
      update public.tenant_callbacks set status = 'due', updated_at = p_now where id = c.id;
    end if;
    v_due := v_due + 1;
  end loop;

  -- ── 3 · released: 30 minutes overdue, undialled, OUTBOUND ONLY ─────────
  for c in
    select cb.id, cb.tenant_id, cb.lead_id, cb.work_item_id, cb.assigned_to, cb.scheduled_at_utc
      from public.tenant_callbacks cb
      join public.lead_queue wq on wq.id = cb.work_item_id and wq.tenant_id = cb.tenant_id
      join public.agent_leads l on l.id = cb.lead_id and l.tenant_id = cb.tenant_id
     where cb.status = 'due'
       and cb.reopened_at is not null
       and cb.released_at is null
       and cb.scheduled_at_utc <= p_now - interval '30 minutes'
       and wq.status = 'claimed'
       and wq.owner_user_id = cb.assigned_to
       and wq.disposition is null
       and (wq.locked_until is null or wq.locked_until < p_now)
       -- Inbound partner leads never go to unclaimed (Design 3): the Transfer inbox, the floor and
       -- the unclaimed-SLA ladder would take them for a live transfer.
       and wq.partner_id is null
       and l.partner_id is null
     order by cb.scheduled_at_utc
     limit v_limit
     for update of cb, wq skip locked
  loop
    update public.lead_queue
       set status = 'unclaimed', owner_user_id = null, claimed_by = null, claimed_at = null,
           locked_until = null, updated_at = p_now
     where id = c.work_item_id and status = 'claimed' and partner_id is null;
    if found then
      update public.tenant_callbacks set released_at = p_now, updated_at = p_now where id = c.id;
      insert into public.callback_history
        (tenant_id, callback_id, lead_id, actor_user_id, action, old_scheduled_at_utc, old_status, new_status, note, via)
      values
        (c.tenant_id, c.id, c.lead_id, null, 'released', c.scheduled_at_utc, 'due', 'due',
         'Thirty minutes overdue: released to the shared queue', 'system');
      if to_regprocedure('public.refresh_agent_capacity_for_user(uuid, uuid)') is not null then
        perform public.refresh_agent_capacity_for_user(c.tenant_id, c.assigned_to);
      end if;
      v_released := v_released + 1;
    end if;
  end loop;

  return jsonb_build_object('missed', v_missed, 'due', v_due, 'reopened', v_reopened, 'released', v_released);
end;
$function$;

revoke all on function public.run_callback_due(timestamptz, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.run_callback_due(timestamptz, integer) to service_role;


-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_src text;
  v_release text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709100: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  select pg_get_functiondef('public.run_callback_due(timestamp with time zone, integer)'::regprocedure) into v_src;
  if strpos(v_src, 'join public.lead_queue q ') > 0 or strpos(v_src, 'for update of cb, q ') > 0 then
    raise exception 'run_callback_due still aliases lead_queue as q, which collides with its variable q';
  end if;
  -- 708700's release rules survive under the new alias.
  v_release := substr(v_src, strpos(v_src, '3 · released'));
  if strpos(v_src, '3 · released') = 0
     or strpos(v_release, 'and wq.partner_id is null') = 0
     or strpos(v_release, 'and l.partner_id is null') = 0
     or strpos(v_release, 'where id = c.work_item_id and status = ''claimed'' and partner_id is null') = 0
     or strpos(v_release, 'interval ''30 minutes''') = 0 then
    raise exception 'the 30-minute outbound-only release did not survive the restatement';
  end if;

  -- Run it once, for real, and roll the run back: this is what 708700 never did.
  begin
    perform public.run_callback_due(now(), 500);
    raise exception using errcode = 'P0099', message = '20260925709100 probe rollback';
  exception
    when sqlstate 'P0099' then null;
  end;

  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and not exists (select 1 from cron.job where jobname = 'callback-due' and command like '%public.run_callback_due(%') then
    raise exception 'the callback-due job is not scheduled against public.run_callback_due';
  end if;
end $$;
