-- Callbacks, per LA-1.22 (Module 1) and LA-2.10 (Module 2) — one implementation for both.
--
-- 1. LA-1.22-9 / M1:W4.5 — "Completing a callback re-opens the lead for a fresh disposition"
--    ("returns the lead to a workable state with a fresh disposition").
--    · run_callback_due reopened a due callback's work item only when agent_leads.lead_state was
--      'working'. That is the OUTBOUND dialer's state; an inbound partner transfer stays 'fresh', so an
--      inbound callback that came due never came back to its agent. It now reopens either.
--    · complete_callback (done by hand) only stamped the callback: the work item stayed completed and
--      an outbound lead stayed 'working', which no serving tier reads. It now reopens the lead exactly
--      as a cancel does since 20260925711300 — both go through callback_reopen_lead():
--        the work item back to the callback's assignee, undispositioned (the pool for an outbound item
--        whose assignee has left; an inbound item never goes to the pool), and an outbound lead back
--        on its cadence ('retry', due now; 'fresh' if never dialled).
--
-- 2. LA-1.22-9 — another producer could complete a colleague's callback. complete, cancel and
--    reschedule now require callback_actor_may_manage(): the assignee, whoever booked it, an owner or
--    an assistant (the role that keeps the calendar). Refused with CALLBACK_NOT_YOURS (403 in the app).
--
-- 3. LA-1.22-6 / LA-2.10-7 — "Reminder at a configurable lead time". The lead time was the platform
--    setting callbacks.reminder_lead_minutes for every agency. tenant_booking_settings gains
--    callback_reminder_minutes (5–1440, null = the platform default), edited in Settings › Calendar &
--    availability beside the agency's daily cap, and read by both reminder paths: the in-app job
--    (run_callback_in_app_reminders, pg_cron) and the email job's claim (claim_callback_reminders).
--
-- In-place patches read the live body, normalise CRLF, refuse to run without their anchor, and are
-- no-ops when their [711600] marker is already present.

set local lock_timeout = '5s';

-- ── 3a · the setting ─────────────────────────────────────────────────────────────────────────
alter table public.tenant_booking_settings
  add column if not exists callback_reminder_minutes integer
    check (callback_reminder_minutes is null or callback_reminder_minutes between 5 and 1440);

-- ── 2 · who may change a callback ────────────────────────────────────────────────────────────
create or replace function public.callback_actor_may_manage(p_tenant_id uuid, p_callback_id uuid, p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select exists (
    select 1
      from public.tenant_callbacks c
      join public.tenant_users tu on tu.tenant_id = c.tenant_id and tu.user_id = p_actor and tu.accepted_at is not null
     where c.id = p_callback_id and c.tenant_id = p_tenant_id
       and (tu.role::text in ('owner', 'assistant') or c.assigned_to = p_actor or c.created_by = p_actor)
  );
$function$;
revoke all on function public.callback_actor_may_manage(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.callback_actor_may_manage(uuid, uuid, uuid) to tenant_app, service_role;

-- ── 1 · back to a workable state, shared by cancel and complete ──────────────────────────────
create or replace function public.callback_reopen_lead(p_tenant_id uuid, p_callback_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  c public.tenant_callbacks;
  q public.lead_queue;
  v_lead public.agent_leads;
  v_outbound boolean := false;
  v_holder_ok boolean := false;
  v_back text := 'none';   -- 'agent', 'pool', or 'none' (already being worked through another item)
begin
  select * into c from public.tenant_callbacks where id = p_callback_id and tenant_id = p_tenant_id;
  if not found then return 'none'; end if;
  select * into v_lead from public.agent_leads where id = c.lead_id and tenant_id = p_tenant_id for update;
  select * into q from public.lead_queue where id = c.work_item_id and tenant_id = p_tenant_id for update;
  if v_lead.id is null or q.id is null then return 'none'; end if;
  if exists (select 1 from public.lead_queue o
              where o.tenant_id = p_tenant_id and o.lead_id = c.lead_id and o.id <> q.id
                and o.status in ('unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active')) then
    return 'none';
  end if;

  v_outbound := v_lead.partner_id is null and q.partner_id is null;
  v_holder_ok := c.assigned_to is not null and exists (
    select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id
     where tu.tenant_id = p_tenant_id and tu.user_id = c.assigned_to and tu.accepted_at is not null and u.status::text = 'active');

  if q.status in ('completed', 'dropped') then
    if v_holder_ok then
      update public.lead_queue
         set status = 'claimed', owner_user_id = c.assigned_to, claimed_by = c.assigned_to, claimed_at = now(),
             locked_until = null, disposition = null, disposition_at = null, disposition_by = null, updated_at = now()
       where id = q.id;
      v_back := 'agent';
    elsif v_outbound then
      update public.lead_queue
         set status = 'unclaimed', owner_user_id = null, claimed_by = null, claimed_at = null,
             locked_until = null, disposition = null, disposition_at = null, disposition_by = null, updated_at = now()
       where id = q.id;
      v_back := 'pool';
    end if;
  elsif q.status = 'claimed' and q.disposition is null then
    v_back := 'agent';   -- the due job had already given it back to the agent
  elsif q.status = 'unclaimed' then
    v_back := 'pool';    -- released after 30 minutes overdue
  end if;

  if v_outbound and v_back <> 'none' and v_lead.lead_state = 'working' then
    update public.agent_leads
       set lead_state = case when coalesce(attempts_made, 0) = 0 then 'fresh' else 'retry' end,
           next_dial_after = case when coalesce(attempts_made, 0) = 0 then null else now() end,
           callback_subtype = null, updated_at = now()
     where id = v_lead.id and tenant_id = p_tenant_id;
  elsif v_lead.callback_subtype is not null then
    update public.agent_leads set callback_subtype = null, updated_at = now()
     where id = v_lead.id and tenant_id = p_tenant_id;
  end if;
  if v_back = 'pool' and c.assigned_to is not null and to_regprocedure('public.refresh_agent_capacity_for_user(uuid, uuid)') is not null then
    perform public.refresh_agent_capacity_for_user(p_tenant_id, c.assigned_to);
  end if;
  return v_back;
end;
$function$;
revoke all on function public.callback_reopen_lead(uuid, uuid) from public, anon, authenticated;
grant execute on function public.callback_reopen_lead(uuid, uuid) to service_role;

create or replace function public.cancel_callback(p_tenant_id uuid, p_callback_id uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  c public.tenant_callbacks;
  v_old_status text;
  v_back text;
begin
  select * into c from public.tenant_callbacks where id = p_callback_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'CALLBACK_NOT_FOUND'; end if;
  if not exists (select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and tu.accepted_at is not null and u.status = 'active') then raise exception 'CALLBACK_ACTOR_INVALID'; end if;
  -- [711600] a colleague's callback is theirs
  if not public.callback_actor_may_manage(p_tenant_id, c.id, p_actor) then raise exception 'CALLBACK_NOT_YOURS'; end if;
  if c.status = 'completed' then raise exception 'CALLBACK_ALREADY_COMPLETED'; end if;
  if c.status = 'cancelled' then return jsonb_build_object('id', c.id, 'status', c.status, 'duplicate', true); end if;
  v_old_status := c.status;
  update public.tenant_callbacks set status = 'cancelled', updated_at = now() where id = c.id returning * into c;
  -- [711300] Back to a workable state (LA-2.9: none leaves it in limbo).
  v_back := public.callback_reopen_lead(p_tenant_id, c.id);
  insert into public.callback_history (tenant_id, callback_id, lead_id, actor_user_id, action, old_scheduled_at_utc, old_status, new_status, note)
  values (p_tenant_id, c.id, c.lead_id, p_actor, 'cancelled', c.scheduled_at_utc, v_old_status, c.status,
          case v_back
            when 'agent' then 'Cancelled. The lead is back with the agent who booked it, for a fresh disposition.'
            when 'pool' then 'Cancelled. The lead is back in the shared queue.'
            else coalesce(c.note, 'Cancelled.') end);
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_actor, 'tenant.callback_cancelled', 'callback', c.id::text,
          jsonb_build_object('leadId', c.lead_id, 'workItemId', c.work_item_id, 'leadReturnedTo', v_back, 'oldStatus', v_old_status));
  return jsonb_build_object('id', c.id, 'status', c.status, 'duplicate', false, 'lead_returned_to', v_back);
end;
$function$;

create or replace function public.complete_callback(p_tenant_id uuid, p_callback_id uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  c public.tenant_callbacks;
  v_old_status text;
  v_back text;
begin
  select * into c from public.tenant_callbacks where id = p_callback_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'CALLBACK_NOT_FOUND'; end if;
  if not exists (select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and tu.accepted_at is not null and u.status = 'active') then raise exception 'CALLBACK_ACTOR_INVALID'; end if;
  -- [711600] a colleague's callback is theirs
  if not public.callback_actor_may_manage(p_tenant_id, c.id, p_actor) then raise exception 'CALLBACK_NOT_YOURS'; end if;
  if c.status = 'completed' then return jsonb_build_object('id', c.id, 'status', c.status, 'duplicate', true); end if;
  if c.status = 'cancelled' then raise exception 'CALLBACK_NOT_ACTIVE'; end if;
  v_old_status := c.status;
  update public.tenant_callbacks set status = 'completed', completed_at = now(), completed_via = 'manual', updated_at = now() where id = c.id returning * into c;
  insert into public.callback_history (tenant_id, callback_id, lead_id, actor_user_id, action, old_scheduled_at_utc, old_status, new_status, note, via)
  values (p_tenant_id, c.id, c.lead_id, p_actor, 'completed', c.scheduled_at_utc, v_old_status, c.status, c.note, 'manual');
  -- [711600] LA-1.22: completing re-opens the lead for a fresh disposition.
  v_back := public.callback_reopen_lead(p_tenant_id, c.id);
  update public.agent_leads set callback_subtype = null, updated_at = now() where id = c.lead_id and tenant_id = p_tenant_id and callback_subtype is not null;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_actor, 'tenant.callback_completed', 'callback', c.id::text, jsonb_build_object('tenantId', p_tenant_id, 'leadId', c.lead_id, 'workItemId', c.work_item_id, 'via', 'manual', 'oldStatus', v_old_status, 'leadReturnedTo', v_back));
  return jsonb_build_object('id', c.id, 'status', c.status, 'work_item_id', c.work_item_id, 'via', 'manual', 'duplicate', false, 'lead_returned_to', v_back);
end;
$function$;

-- ── in place: reschedule's ownership, the due job's inbound reopen, the in-app reminder lead ─
do $patch$
declare
  v_sig text;
  v_src text;
  v_new text;
begin
  -- reschedule_callback: the same ownership rule as complete and cancel
  select p.oid::regprocedure::text into v_sig
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'reschedule_callback'
     and pg_get_function_identity_arguments(p.oid) like 'p_tenant_id%';
  select replace(pg_get_functiondef(v_sig::regprocedure), E'\r\n', E'\n') into v_src;
  if v_src not like '%[711600]%' then
    v_new := replace(v_src,
      E'raise exception ''CALLBACK_ACTOR_INVALID''; end if;\n',
      E'raise exception ''CALLBACK_ACTOR_INVALID''; end if;\n'
      || E'  -- [711600] a colleague''s callback is theirs\n'
      || E'  if not public.callback_actor_may_manage(p_tenant_id, c.id, p_actor) then raise exception ''CALLBACK_NOT_YOURS''; end if;\n');
    if v_new = v_src then raise exception 'reschedule_callback: actor check anchor not found'; end if;
    execute v_new;
  end if;

  -- run_callback_due: an inbound lead reopens too (it never enters the outbound 'working' state)
  select replace(pg_get_functiondef('public.run_callback_due(timestamp with time zone,integer)'::regprocedure), E'\r\n', E'\n') into v_src;
  if v_src not like '%[711600]%' then
    v_new := replace(v_src,
      E'                    where l.id = c.lead_id and l.tenant_id = c.tenant_id and l.lead_state = ''working'')\n',
      E'                    -- [711600] an inbound partner lead is never ''working'' (that is the outbound dialer''s state)\n'
      || E'                    where l.id = c.lead_id and l.tenant_id = c.tenant_id and (l.lead_state = ''working'' or l.partner_id is not null))\n');
    if v_new = v_src then raise exception 'run_callback_due: working-state anchor not found'; end if;
    execute v_new;
  end if;

  -- run_callback_in_app_reminders: the agency's own lead time, the platform setting otherwise
  select replace(pg_get_functiondef('public.run_callback_in_app_reminders(timestamp with time zone,integer)'::regprocedure), E'\r\n', E'\n') into v_src;
  if v_src not like '%[711600]%' then
    v_new := replace(v_src,
      E'      join public.users u on u.id = cb.assigned_to and u.status::text = ''active''\n',
      E'      join public.users u on u.id = cb.assigned_to and u.status::text = ''active''\n'
      || E'      -- [711600] the agency''s own reminder lead time (Settings › Calendar & availability)\n'
      || E'      left join public.tenant_booking_settings bs on bs.tenant_id = cb.tenant_id\n');
    v_new := replace(v_new,
      E'       and cb.scheduled_at_utc <= p_now + make_interval(mins => v_minutes)\n',
      E'       and cb.scheduled_at_utc <= p_now + make_interval(mins => coalesce(bs.callback_reminder_minutes, v_minutes))\n');
    if v_new = v_src or v_new not like '%coalesce(bs.callback_reminder_minutes, v_minutes)%' or v_new not like '%left join public.tenant_booking_settings bs%' then
      raise exception 'run_callback_in_app_reminders: an anchor was not found';
    end if;
    execute v_new;
  end if;
end;
$patch$;

-- ── 3b · the email job's claim honours the agency's lead time too ────────────────────────────
create or replace function public.claim_callback_reminders(p_now timestamp with time zone, p_until timestamp with time zone, p_limit integer default 100)
returns setof public.tenant_callbacks
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare c public.tenant_callbacks;
begin
  -- p_until is the platform lead time from the caller; an agency with its own [711600] uses that.
  for c in
    select cb.*
      from public.tenant_callbacks cb
      left join public.tenant_booking_settings bs on bs.tenant_id = cb.tenant_id
     where cb.status = 'scheduled' and cb.reminder_sent_at is null and cb.scheduled_at_utc > p_now
       and cb.scheduled_at_utc <= case when bs.callback_reminder_minutes is not null
                                       then p_now + make_interval(mins => bs.callback_reminder_minutes)
                                       else p_until end
     order by cb.scheduled_at_utc
     for update of cb skip locked
     limit greatest(1, least(p_limit, 500))
  loop
    update public.tenant_callbacks set reminder_sent_at = p_now, updated_at = p_now where id = c.id returning * into c;
    return next c;
  end loop;
end;
$function$;

-- ── Nothing earlier was lost ─────────────────────────────────────────────────────────────────
do $check$
declare v_src text;
begin
  select replace(pg_get_functiondef('public.run_callback_due(timestamp with time zone,integer)'::regprocedure), E'\r\n', E'\n') into v_src;
  if v_src not like '%[711600]%' or v_src not like '%''missed''%' or v_src not like '%''released''%' or v_src not like '%partner_id is null%' then
    raise exception '711600 check: run_callback_due lost its missed/released steps or the inbound guard on release';
  end if;
  select replace(pg_get_functiondef('public.run_callback_in_app_reminders(timestamp with time zone,integer)'::regprocedure), E'\r\n', E'\n') into v_src;
  if v_src not like '%callbacks.reminder_lead_minutes%' or v_src not like '%in_app_reminded_at%' then
    raise exception '711600 check: run_callback_in_app_reminders lost the platform default or its stamp';
  end if;
  if not exists (select 1 from pg_attribute where attrelid = 'public.tenant_booking_settings'::regclass and attname = 'callback_reminder_minutes') then
    raise exception '711600 check: the reminder column is missing';
  end if;
end;
$check$;
