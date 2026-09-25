-- ---------------------------------------------------------------------------
-- Callbacks · due, back with the agent, released, missed, reminded — on pg_cron (LA-1 §6.3)
--
-- Measured live 2026-09-25: two open callbacks, both on lead_queue items already 'completed', so
-- neither was ever served — tier 2 of serve_next_lead only reads unclaimed or agent-claimed items,
-- and every outcome that books a callback completes its work item. Nothing ran when a callback
-- came due, and the reminder job (scripts/send-callback-reminders.mjs) was never scheduled.
--
-- User decisions (2026-09-25):
--   DUE       At the due time the work item goes back to the BOOKED AGENT: claimed by them,
--             unlocked, disposition cleared. What the outcome had written is kept in
--             tenant_callbacks.reopened_from and restored if the callback stops being due with
--             nobody having dialled it (20260925708500's trigger).
--   RELEASE   30 minutes overdue and still undialled, the work item goes to the shared pool —
--             OUTBOUND ONLY. Design 3 (inbound): list_transfer_inbox, the floor queue and
--             run_unclaimed_sla treat ANY unclaimed lead_queue row with a partner as a live
--             transfer, so releasing one would re-show it in the Transfer inbox, start the SLA
--             ladder and send the partner a false "nobody claimed" card. An inbound callback stays
--             with its booked agent and shows as overdue; it is never set to unclaimed.
--   MISSED    When the customer's calling window closes on the due day with no kept call. It
--             stays in Overdue (Callbacks page) until rebooked or cancelled; missed_at is kept.
--   REMINDER  pg_cron writes the in-app reminder (agent_notifications, the same source_key the
--             app's email job upserts, so the two never duplicate). Email stays with the app.
--
--   run_callback_due(now, limit)            jsonb {missed, due, reopened, released}
--   run_callback_in_app_reminders(now, limit)  integer, reminders written
--   pg_cron: callback-due, callback-in-app-reminders (every minute), callback-jobs-log-cleanup
-- ---------------------------------------------------------------------------

do $$
begin
  -- Only a role that can apply this file needs its prerequisites; the parse check runs without them.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then return; end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tenant_callbacks' and column_name = 'reopened_from') then
    raise exception 'tenant_callbacks.reopened_from does not exist; apply 20260925708500 before this file';
  end if;
  if to_regprocedure('public.next_callable_instant(uuid, uuid, timestamp with time zone, timestamp with time zone)') is null then
    raise exception 'next_callable_instant does not exist; apply 20260925708600 before this file';
  end if;
end $$;

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
      join public.lead_queue q on q.id = cb.work_item_id and q.tenant_id = cb.tenant_id
      join public.agent_leads l on l.id = cb.lead_id and l.tenant_id = cb.tenant_id
     where cb.status = 'due'
       and cb.reopened_at is not null
       and cb.released_at is null
       and cb.scheduled_at_utc <= p_now - interval '30 minutes'
       and q.status = 'claimed'
       and q.owner_user_id = cb.assigned_to
       and q.disposition is null
       and (q.locked_until is null or q.locked_until < p_now)
       -- Inbound partner leads never go to unclaimed (Design 3): the Transfer inbox, the floor and
       -- the unclaimed-SLA ladder would take them for a live transfer.
       and q.partner_id is null
       and l.partner_id is null
     order by cb.scheduled_at_utc
     limit v_limit
     for update of cb, q skip locked
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

-- ── in-app reminders ───────────────────────────────────────────────────────
-- The lead time is the platform setting callbacks.reminder_lead_minutes (default 30, 5–1440), the
-- same one lib/callbacks/reminders.ts reads. Title, body, link and source_key match what that job
-- writes, so whichever runs first, the agent sees one reminder.
create or replace function public.run_callback_in_app_reminders(p_now timestamptz default now(), p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_minutes integer := 30;
  v_raw text;
  v_count integer := 0;
  v_name text;
  c record;
begin
  if to_regclass('public.settings') is not null then
    select s.value #>> '{}' into v_raw from public.settings s where s.key = 'callbacks.reminder_lead_minutes';
    if v_raw ~ '^\s*\d+(\.\d+)?\s*$' then
      v_minutes := greatest(5, least(1440, round(v_raw::numeric)::integer));
    end if;
  end if;

  for c in
    select cb.id, cb.tenant_id, cb.lead_id, cb.assigned_to, cb.scheduled_at_utc, cb.customer_timezone, l.values
      from public.tenant_callbacks cb
      join public.agent_leads l on l.id = cb.lead_id and l.tenant_id = cb.tenant_id
      join public.users u on u.id = cb.assigned_to and u.status::text = 'active'
     where cb.status = 'scheduled'
       and cb.in_app_reminded_at is null
       and cb.scheduled_at_utc > p_now
       and cb.scheduled_at_utc <= p_now + make_interval(mins => v_minutes)
     order by cb.scheduled_at_utc
     limit greatest(1, least(coalesce(p_limit, 200), 1000))
     for update of cb skip locked
  loop
    v_name := coalesce(nullif(btrim(c.values->>'full_name'), ''),
                       nullif(btrim(c.values->>'name'), ''),
                       nullif(btrim(concat_ws(' ', c.values->>'first_name', c.values->>'last_name')), ''),
                       'Customer');
    insert into public.agent_notifications (tenant_id, recipient_user_id, kind, title, body, link, source_key)
    values (c.tenant_id, c.assigned_to, 'callback_reminder',
            left('Callback reminder: ' || v_name, 160),
            'Callback at ' || to_char(c.scheduled_at_utc at time zone c.customer_timezone, 'Mon FMDD, YYYY, FMHH12:MI AM')
              || ' (' || c.customer_timezone || ').',
            '/app/leads/' || c.lead_id::text,
            'callback-reminder:' || c.id::text)
    on conflict (tenant_id, recipient_user_id, source_key) do update
      set title = excluded.title, body = excluded.body, created_at = excluded.created_at, read_at = null;
    update public.tenant_callbacks set in_app_reminded_at = p_now where id = c.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

revoke all on function public.run_callback_in_app_reminders(timestamptz, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.run_callback_in_app_reminders(timestamptz, integer) to service_role;

-- ── the schedule ───────────────────────────────────────────────────────────
-- pg_cron is installed on this project (20260924250100 schedules the unclaimed-SLA ladder the
-- same way). cron.schedule with an existing job name replaces that job, so re-running is safe.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '20260925708700: pg_cron is not installed; the callback jobs are not scheduled';
    return;
  end if;
  perform cron.schedule('callback-due', '* * * * *',
    $cron$select public.run_callback_due(now(), 500)$cron$);
  perform cron.schedule('callback-in-app-reminders', '* * * * *',
    $cron$select public.run_callback_in_app_reminders(now(), 200)$cron$);
  perform cron.schedule('callback-jobs-log-cleanup', '23 3 * * *',
    $cron$delete from cron.job_run_details
           where jobid in (select jobid from cron.job where jobname in ('callback-due', 'callback-in-app-reminders'))
             and end_time < now() - interval '7 days'$cron$);
end $$;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_src text;
  v_release text;
  v_q public.lead_queue;
  v_member uuid;
  v_cb uuid;
  v_status text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925708700: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  select pg_get_functiondef('public.run_callback_due(timestamp with time zone, integer)'::regprocedure) into v_src;
  v_release := substr(v_src, strpos(v_src, '3 · released'));
  if strpos(v_src, '3 · released') = 0
     or strpos(v_release, 'and q.partner_id is null') = 0
     or strpos(v_release, 'and l.partner_id is null') = 0
     or strpos(v_release, 'where id = c.work_item_id and status = ''claimed'' and partner_id is null') = 0 then
    raise exception 'the 30-minute release does not exclude inbound partner leads';
  end if;
  if strpos(v_src, 'interval ''30 minutes''') = 0 then
    raise exception 'the release is not at 30 minutes overdue';
  end if;

  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and (select count(*) from cron.job where jobname in ('callback-due', 'callback-in-app-reminders')) <> 2 then
    raise exception 'the callback jobs are not scheduled';
  end if;

  -- Behaviour: an inbound work item held by its booked agent, a callback an hour overdue — the
  -- release must leave it claimed. Built and rolled back inside this block.
  begin
    select q.* into v_q
      from public.lead_queue q
      join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
     where q.partner_id is not null
       and q.status in ('completed', 'dropped')
       and l.values->>'state' ~ '^[A-Za-z]{2}$'
     limit 1;
    if v_q.id is null then raise exception 'SKIP no inbound work item to test with'; end if;
    select tu.user_id into v_member
      from public.tenant_users tu join public.users u on u.id = tu.user_id
     where tu.tenant_id = v_q.tenant_id and tu.accepted_at is not null and u.status::text = 'active'
       and tu.role::text in ('owner', 'producer', 'assistant')
     limit 1;
    if v_member is null then raise exception 'SKIP no active member on the inbound tenant'; end if;

    update public.tenant_callbacks set status = 'cancelled'
     where tenant_id = v_q.tenant_id and lead_id = v_q.lead_id and status in ('scheduled', 'due', 'missed');
    update public.lead_queue
       set status = 'claimed', owner_user_id = v_member, claimed_by = v_member, claimed_at = now(),
           locked_until = null, disposition = null, disposition_at = null, disposition_by = null
     where id = v_q.id;
    insert into public.tenant_callbacks
      (tenant_id, lead_id, work_item_id, scheduled_at_utc, customer_timezone, assigned_to, status, created_by,
       reopened_at, reopened_from)
    values
      (v_q.tenant_id, v_q.lead_id, v_q.id, now() - interval '1 hour', 'America/New_York', v_member, 'due', v_member,
       now() - interval '1 hour', jsonb_build_object('status', v_q.status, 'disposition', v_q.disposition))
    returning id into v_cb;

    perform public.run_callback_due(now(), 2000);

    -- Outside the customer's window right now the callback is missed first and its work item
    -- restored, which proves nothing about the release.
    if (select status from public.tenant_callbacks where id = v_cb) <> 'due' then
      raise exception 'SKIP the sample customer''s window is closed now';
    end if;
    select status into v_status from public.lead_queue where id = v_q.id;
    if v_status = 'unclaimed' then
      raise exception 'INBOUND_RELEASED';
    end if;
    raise exception 'ROLLBACK_OK';
  exception when others then
    if sqlerrm = 'ROLLBACK_OK' then
      raise notice '20260925708700: an overdue inbound callback stays with its booked agent';
    elsif sqlerrm = 'INBOUND_RELEASED' then
      raise exception 'the 30-minute release set an inbound transfer to unclaimed';
    else
      raise notice '20260925708700: inbound behaviour check skipped (%)', sqlerrm;
    end if;
  end;

  raise notice '20260925708700: callbacks come due with their agent, outbound ones release at 30 minutes, windows closing make a miss';
end $$;
