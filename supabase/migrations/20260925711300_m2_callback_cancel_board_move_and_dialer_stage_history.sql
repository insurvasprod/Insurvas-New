-- Module 2 fails resolved "per the documentation" (user, 2026-09-25). Three changes:
--
-- 1. LA-2.9-4 — cancelling a callback stranded the lead.
--    Spec: LA-2.9 "Every disposition schedules or terminates the lead — none leaves it in limbo";
--    LA-1.22 "Completing a callback re-opens the lead for a fresh disposition" and "returns the lead
--    to a workable state"; LA-2.10 "Reschedule and cancel, both recorded".
--    cancel_callback only flipped the callback's status. The work item stayed 'completed' and an
--    outbound lead stayed 'working' — a state no serving tier reads — so nothing ever served it.
--    Now a cancel does what the callback-due job does when a callback comes due (run_callback_due,
--    "back with the agent who booked it"), and puts an outbound lead back on its cadence:
--      · the work item reopens to the callback's assignee, undispositioned, for a fresh disposition;
--        if that person can no longer work here, an outbound item goes to the pool (an inbound
--        partner item never does — same rule as run_callback_due's release step);
--      · an outbound lead becomes 'retry', due now (or 'fresh' if it was never dialled), so the
--        dialer serves it under the usual slot rule;
--      · the history row records where the lead went.
--
-- 2. LA-2-PIPE-1 — a pipeline-board move did not act as the disposition it names.
--    Spec: LA-1.9 "recording a disposition moves the lead to the mapped stage"; decided 2026-09-24
--    "move = disposition" (board, table and list go through apply_lead_disposition_move).
--    The move set the stage and the work item's disposition only; a board "Not interested" left an
--    outbound lead fresh and servable. For OUTBOUND leads the move now applies the same lead-state
--    effect the dialer applies (complete_existing_dial_disposition): do-not-call suppresses the
--    number and closes; a rest moves to nurture until it ends; any other call-ending outcome closes;
--    a non-ending outcome is scheduled by the cadence. callback_scheduled is refused on the board —
--    a callback needs a time, which only the callback picker collects. Inbound (partner) leads keep
--    exactly today's behaviour: Module 1 owns their lifecycle.
--
-- 3. LA-2-PIPE-1 / W1.9 — the dialer's own moves were incomplete.
--    · A mapped outcome that sends the lead back to the cadence (e.g. call_dropped → Incomplete
--      Transfer) never moved it: the routing skipped 'retry' on the theory that it would take the
--      lead "off the board the dialer serves from". The serving query has no pipeline filter, so
--      that cannot happen; LA-1.9 says a recorded disposition moves the lead. Mapping stays opt-in
--      per disposition, so an agency that mapped nothing sees no change.
--    · A dialer move wrote no stage-history row; only board moves did. It now writes one, with the
--      new source 'dialer' (the table's source check is widened for it).
--
-- Every in-place patch reads the live body, normalises CRLF (bodies pasted through the SQL editor
-- keep it), refuses to run if its anchor is missing, and is a no-op when its [711300] marker is
-- already present.

set local lock_timeout = '5s';

-- ── 0 · the history table accepts the dialer as a source ────────────────────────────────────
alter table public.tenant_lead_stage_events
  drop constraint if exists tenant_lead_stage_events_source_check,
  add constraint tenant_lead_stage_events_source_check
    check (source = any (array['board', 'table', 'list', 'lead_detail', 'owner_fix', 'dialer'])) not valid;
alter table public.tenant_lead_stage_events validate constraint tenant_lead_stage_events_source_check;

-- ── 1 · cancel_callback ─────────────────────────────────────────────────────────────────────
create or replace function public.cancel_callback(p_tenant_id uuid, p_callback_id uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  c public.tenant_callbacks;
  v_old_status text;
  q public.lead_queue;
  v_lead public.agent_leads;
  v_outbound boolean := false;
  v_holder_ok boolean := false;
  v_back text := 'none';   -- where the lead went: 'agent', 'pool' or 'none' (already being worked elsewhere)
begin
  select * into c from public.tenant_callbacks where id = p_callback_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'CALLBACK_NOT_FOUND'; end if;
  if not exists (select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and tu.accepted_at is not null and u.status = 'active') then raise exception 'CALLBACK_ACTOR_INVALID'; end if;
  if c.status = 'completed' then raise exception 'CALLBACK_ALREADY_COMPLETED'; end if;
  if c.status = 'cancelled' then return jsonb_build_object('id', c.id, 'status', c.status, 'duplicate', true); end if;
  v_old_status := c.status;
  update public.tenant_callbacks set status = 'cancelled', updated_at = now() where id = c.id returning * into c;

  -- [711300] Back to a workable state (LA-2.9: none leaves it in limbo).
  select * into v_lead from public.agent_leads where id = c.lead_id and tenant_id = p_tenant_id for update;
  select * into q from public.lead_queue where id = c.work_item_id and tenant_id = p_tenant_id for update;
  if v_lead.id is not null and q.id is not null
     -- Not already being worked through another work item.
     and not exists (select 1 from public.lead_queue o
                      where o.tenant_id = p_tenant_id and o.lead_id = c.lead_id and o.id <> q.id
                        and o.status in ('unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active')) then
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
    if v_back = 'pool' and to_regprocedure('public.refresh_agent_capacity_for_user(uuid, uuid)') is not null and c.assigned_to is not null then
      perform public.refresh_agent_capacity_for_user(p_tenant_id, c.assigned_to);
    end if;
  end if;

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

-- ── 2 · apply_lead_disposition_move ─────────────────────────────────────────────────────────
create or replace function public.apply_lead_disposition_move(p_tenant_id uuid, p_lead_id uuid, p_disposition_key text, p_actor uuid, p_source text)
returns table(lead_id uuid, from_stage_id uuid, to_pipeline_id uuid, to_stage_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_destination record;
  v_lead record;
  v_ends_call boolean;
  v_next_action text;
  v_next_minutes integer;
  v_sched record;
  v_new_state text;
  v_queue_status text;
begin
  if p_source not in ('board', 'table', 'list', 'lead_detail') then
    raise exception 'invalid_move_source';
  end if;

  -- The outcome must exist and still be pickable.
  if not exists (
    select 1 from public.dispositions d
     where d.tenant_id = p_tenant_id and d.disposition_key = p_disposition_key and d.is_active
  ) then
    raise exception 'disposition_not_active';
  end if;

  -- Its one stage, which must be live and in a live pipeline.
  select s.pipeline_id, s.id as stage_id into v_destination
    from public.stage_dispositions m
    join public.tenant_pipeline_stages s on s.id = m.stage_id
    join public.tenant_pipelines p on p.id = s.pipeline_id and p.tenant_id = m.tenant_id
   where m.tenant_id = p_tenant_id
     and m.disposition_key = p_disposition_key
     and not s.is_archived
     and p.status = 'live';
  if not found then raise exception 'disposition_not_mapped'; end if;

  select l.pipeline_id, l.stage_id, l.partner_id, l.values->>'phone' as phone into v_lead
    from public.agent_leads l
   where l.id = p_lead_id and l.tenant_id = p_tenant_id
   for update;
  if not found then raise exception 'lead_not_found'; end if;

  -- [711300] A callback is a promise of a TIME; the board has no way to take one.
  if v_lead.partner_id is null and p_disposition_key = 'callback_scheduled' then
    raise exception 'callback_needs_time';
  end if;

  update public.agent_leads
     set pipeline_id = v_destination.pipeline_id, stage_id = v_destination.stage_id, updated_at = now()
   where id = p_lead_id and tenant_id = p_tenant_id;
  update public.lead_queue
     set pipeline_id = v_destination.pipeline_id, stage_id = v_destination.stage_id,
         disposition = p_disposition_key, disposition_at = now(), disposition_by = p_actor, updated_at = now()
   where lead_queue.lead_id = p_lead_id and lead_queue.tenant_id = p_tenant_id;
  update public.deal_flow
     set pipeline_id = v_destination.pipeline_id, stage_id = v_destination.stage_id, updated_at = now()
   where deal_flow.lead_id = p_lead_id and deal_flow.tenant_id = p_tenant_id;

  insert into public.tenant_lead_stage_events
    (tenant_id, lead_id, from_pipeline_id, from_stage_id, to_pipeline_id, to_stage_id, disposition_key, source, actor_user_id)
  values
    (p_tenant_id, p_lead_id, v_lead.pipeline_id, v_lead.stage_id, v_destination.pipeline_id, v_destination.stage_id, p_disposition_key, p_source, p_actor);

  -- [711300] Move = disposition: an OUTBOUND lead gets the lead-state effect the dialer applies
  -- for this outcome (complete_existing_dial_disposition), so the board and the queue agree.
  if v_lead.partner_id is null then
    select d.ends_call, d.next_action, d.next_action_minutes into v_ends_call, v_next_action, v_next_minutes
      from public.dispositions d
     where d.tenant_id = p_tenant_id and d.disposition_key = p_disposition_key;
    v_ends_call := coalesce(v_ends_call, public.disposition_default_ends_call(p_disposition_key));

    if p_disposition_key = 'do_not_call' then
      if v_lead.phone is not null then
        perform public.suppress_phone(p_tenant_id, v_lead.phone, 'internal', 'Recorded do not call from the pipeline', 'disposition', p_actor);
      end if;
      v_new_state := 'closed';
    elsif v_ends_call and v_next_action = 'rest' and v_next_minutes is not null then
      v_new_state := 'nurture';
      update public.agent_leads
         set lead_state = 'nurture', next_dial_after = now() + make_interval(mins => v_next_minutes), next_preferred_slot = null
       where id = p_lead_id and tenant_id = p_tenant_id;
    elsif v_ends_call then
      v_new_state := 'closed';
    else
      select * into v_sched from public.schedule_next_attempt(p_tenant_id, p_lead_id, p_disposition_key, now());
      if v_sched.exhausted then
        v_new_state := 'exhausted';
        update public.agent_leads set lead_state = 'exhausted', next_dial_after = null, next_preferred_slot = null
         where id = p_lead_id and tenant_id = p_tenant_id;
      else
        v_new_state := 'retry';
        update public.agent_leads
           set lead_state = 'retry',
               next_dial_after = case when v_next_action = 'retry' and v_next_minutes is not null
                                      then now() + make_interval(mins => v_next_minutes) else v_sched.due_at end,
               next_preferred_slot = v_sched.slot
         where id = p_lead_id and tenant_id = p_tenant_id;
      end if;
    end if;
    if v_new_state = 'closed' then
      update public.agent_leads set lead_state = 'closed', next_dial_after = null, next_preferred_slot = null
       where id = p_lead_id and tenant_id = p_tenant_id;
    end if;

    -- As the dialer does: back to the pool for another attempt or a rest, otherwise done.
    v_queue_status := case when v_new_state in ('retry', 'nurture') then 'unclaimed' else 'completed' end;
    update public.lead_queue
       set status = v_queue_status, claimed_by = null, owner_user_id = null, locked_until = null, updated_at = now()
     where lead_queue.lead_id = p_lead_id and lead_queue.tenant_id = p_tenant_id
       and lead_queue.status in ('unclaimed', 'claimed');
  end if;

  return query select p_lead_id, v_lead.stage_id, v_destination.pipeline_id, v_destination.stage_id;
end;
$function$;

-- ── 3 · complete_existing_dial_disposition: route mapped retry outcomes; write stage history ─
do $patch$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef('public.complete_existing_dial_disposition(uuid,uuid,uuid,text,timestamp with time zone,text)'::regprocedure)
    into v_src;
  v_src := replace(v_src, E'\r\n', E'\n');

  if v_src like '%[711300]%' then
    raise notice 'complete_existing_dial_disposition already patched by 711300';
    return;
  end if;

  v_new := replace(
    v_src,
    E'  if v_new_state in (''closed'', ''exhausted'', ''working'', ''nurture'') then\n',
    E'  -- [711300] ''retry'' routes too: LA-1.9 says a recorded disposition moves the lead to its mapped\n'
    || E'  -- stage, and the serving query has no pipeline filter, so a retry lead stays servable.\n'
    || E'  if v_new_state in (''closed'', ''exhausted'', ''working'', ''nurture'', ''retry'') then\n'
  );
  if v_new = v_src then
    raise exception 'complete_existing_dial_disposition: the routing condition this patch anchors on was not found';
  end if;

  v_src := v_new;
  v_new := replace(
    v_src,
    E'    if v_stage_id is not null then\n      update public.agent_leads\n         set stage_id = v_stage_id, pipeline_id = v_stage_pipeline\n       where id = v_lead.id and tenant_id = p_tenant_id;\n    end if;\n',
    E'    if v_stage_id is not null then\n      update public.agent_leads\n         set stage_id = v_stage_id, pipeline_id = v_stage_pipeline\n       where id = v_lead.id and tenant_id = p_tenant_id;\n'
    || E'      -- [711300] The dialer''s move is recorded like a board move (it wrote no history before).\n'
    || E'      if v_stage_id is distinct from v_lead.stage_id then\n'
    || E'        insert into public.tenant_lead_stage_events\n'
    || E'          (tenant_id, lead_id, from_pipeline_id, from_stage_id, to_pipeline_id, to_stage_id, disposition_key, source, actor_user_id)\n'
    || E'        values\n'
    || E'          (p_tenant_id, v_lead.id, v_lead.pipeline_id, v_lead.stage_id, v_stage_pipeline, v_stage_id, p_disposition, ''dialer'', p_agent_user_id);\n'
    || E'      end if;\n'
    || E'    end if;\n'
  );
  if v_new = v_src then
    raise exception 'complete_existing_dial_disposition: the stage update this patch anchors on was not found';
  end if;

  execute v_new;
  raise notice 'complete_existing_dial_disposition now routes mapped retry outcomes and records dialer moves';
end;
$patch$;

-- ── Nothing earlier was lost ─────────────────────────────────────────────────────────────────
do $check$
declare v_src text;
begin
  select replace(pg_get_functiondef('public.complete_existing_dial_disposition(uuid,uuid,uuid,text,timestamp with time zone,text)'::regprocedure), E'\r\n', E'\n') into v_src;
  if v_src not like '%suppress_phone%' or v_src not like '%schedule_next_attempt%' or v_src not like '%next_action%' or v_src not like '%callback_scheduled%' then
    raise exception '711300 check: complete_existing_dial_disposition lost an earlier branch';
  end if;
  if v_src not like '%[711300]%' or v_src not like '%''dialer''%' then raise exception '711300 check: dialer patch missing'; end if;
  -- The scoring trigger from 711000 is untouched by this file, but the dialer path it hangs off is.
  if not exists (select 1 from pg_trigger where tgname = 'tenant_call_attempts_score_outcome') then
    raise exception '711300 check: the 711000 scoring trigger is missing';
  end if;
end;
$check$;
