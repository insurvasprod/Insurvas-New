-- Settings → Dispositions · "ends dialing" becomes the tenant's setting instead of a key list.
--
-- The Dispositions board shows four flags per outcome. Three were columns already
-- (counts_as_work_completed, closes_as, is_active). The fourth — whether recording the outcome on the
-- dialer closes the lead or puts it back on the cadence — was two hardcoded `in (...)` lists inside
-- `complete_existing_dial_disposition` (20260923150000:18-27). A tenant could not change it, and the
-- settings screen could not show it truthfully.
--
-- This adds `dispositions.ends_call`, seeds every existing row from exactly those lists, fills new
-- rows the same way, and makes the dialer read the row. Behaviour for every key that exists today is
-- identical until a tenant changes the flag:
--
--     do_not_call          closed + suppressed — not governed by the flag (compliance, always)
--     callback_scheduled   working — not governed by the flag (a callback is its own branch)
--     wrong_number, disconnected                         ends_call = true -> closed, vendor credit
--     not_interested, did_not_qualify, application_submitted,
--     sent_to_underwriting, no_payment_method            ends_call = true -> closed
--     anything else (no_answer, voicemail, busy, call_dropped, tenant-created)
--                                                        ends_call = false -> the cadence
--
-- A key with no row in `dispositions` (the dialer's attempt outcomes are not tenant dispositions)
-- falls back to the same built-in default, so nothing that has no row can change behaviour.
--
-- The function body is derived from the deployed 20260923160000 body, not retyped: only the
-- declaration of v_ends_call, the read of the flag, and the branch order around it change.
-- `20260923170000` (the dialer callback) calls this function and is unaffected.
--
-- Additive and idempotent. The read path in lib/dispositions tolerates the column being absent.

-- ── the built-in default, once ────────────────────────────────────────────
create or replace function public.disposition_default_ends_call(p_disposition_key text)
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select coalesce(p_disposition_key in (
    'do_not_call', 'callback_scheduled',
    'wrong_number', 'disconnected',
    'not_interested', 'did_not_qualify', 'application_submitted', 'sent_to_underwriting', 'no_payment_method'
  ), false)
$$;

revoke all on function public.disposition_default_ends_call(text) from public, anon, authenticated;
grant execute on function public.disposition_default_ends_call(text) to tenant_app, service_role;

-- ── the column ────────────────────────────────────────────────────────────
alter table public.dispositions add column if not exists ends_call boolean;

-- ~1,000 rows (125 tenants × 8 at 2026-09-22); one statement is fine.
update public.dispositions
   set ends_call = public.disposition_default_ends_call(disposition_key)
 where ends_call is null;

-- New rows (the tenant seed, and outcomes created from Settings without the flag) get the default.
create or replace function public.dispositions_fill_ends_call()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  if new.ends_call is null then
    new.ends_call := public.disposition_default_ends_call(new.disposition_key);
  end if;
  return new;
end;
$$;

drop trigger if exists dispositions_fill_ends_call on public.dispositions;
create trigger dispositions_fill_ends_call before insert or update on public.dispositions
  for each row execute function public.dispositions_fill_ends_call();

-- Compliance keys cannot be switched off: a do-not-call that put the lead back on the cadence, or a
-- callback that also retried, would contradict the branch that handles them first.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dispositions_fixed_keys_end_call') then
    alter table public.dispositions
      add constraint dispositions_fixed_keys_end_call
      check (ends_call is distinct from false or disposition_key not in ('do_not_call', 'callback_scheduled'));
  end if;
end $$;

comment on column public.dispositions.ends_call is
  'Recorded on the dialer, this outcome closes the lead (true) or returns it to the retry cadence (false). do_not_call and callback_scheduled are fixed.';

-- ── the dialer reads the flag ─────────────────────────────────────────────
create or replace function public.complete_existing_dial_disposition(
  p_tenant_id uuid,
  p_attempt_id uuid,
  p_agent_user_id uuid,
  p_disposition text,
  p_dial_clicked_at timestamptz default null,
  p_provider_call_id text default null
)
returns table(lead_state text, next_dial_after timestamptz, next_slot text, suppressed boolean, reason text)
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_attempt public.tenant_call_attempts;
  v_item public.lead_queue;
  v_lead public.agent_leads;
  v_phone text;
  v_slot text;
  v_now timestamptz := clock_timestamp();
  v_sched record;
  v_due_at timestamptz;
  v_due_slot text;
  v_stage_id uuid;
  v_stage_pipeline uuid;
  v_new_state text;
  v_suppressed boolean := false;
  v_reason text;
  v_existing_next_dial_after timestamptz;
  v_existing_next_slot text;
  v_ends_call boolean;
begin
  select * into v_attempt
    from public.tenant_call_attempts
   where id = p_attempt_id and tenant_id = p_tenant_id and agent_id = p_agent_user_id
   for update;
  if not found then raise exception 'CALL_ATTEMPT_NOT_FOUND'; end if;

  -- An inbound return call has no work item by design: it did not come from the queue, so nothing
  -- was ever claimed. Every other disposition still requires one, because every other disposition
  -- moves the queue row it belongs to.
  if v_attempt.work_item_id is null and p_disposition <> 'inbound_return_call' then
    raise exception 'CALL_ATTEMPT_WORK_ITEM_MISSING';
  end if;

  if v_attempt.disposition is not null then
    if v_attempt.disposition <> p_disposition then raise exception 'CALL_ATTEMPT_ALREADY_DISPOSITIONED'; end if;
    select l.lead_state, l.next_dial_after, l.next_preferred_slot
      into v_new_state, v_existing_next_dial_after, v_existing_next_slot
      from public.agent_leads l where l.id = v_attempt.lead_id and l.tenant_id = p_tenant_id;
    return query select v_new_state, v_existing_next_dial_after, v_existing_next_slot, false, 'Disposition was already recorded for this attempt.';
    return;
  end if;
  if v_attempt.disclosure_confirmed_at is null then raise exception 'DISCLOSURE_NOT_CONFIRMED'; end if;
  if coalesce(v_attempt.dial_clicked_at, p_dial_clicked_at) is null then raise exception 'DIAL_NOT_RECORDED'; end if;

  select * into v_lead from public.agent_leads
   where id = v_attempt.lead_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'LEAD_NOT_FOUND'; end if;

  -- ── the inbound return call, handled before anything is mutated ──────────
  --
  -- Records the call and returns the lead's cadence EXACTLY as it already stood. No
  -- `attempts_made` increment, no `schedule_next_attempt`, no `lead_queue` write. The lead's place
  -- in the queue, its retry timer and its next slot are all left where the outbound cadence put
  -- them, which is decision 1's whole requirement.
  if p_disposition = 'inbound_return_call' then
    update public.tenant_call_attempts
       set disposition = p_disposition,
           dial_clicked_at = coalesce(dial_clicked_at, p_dial_clicked_at, v_now),
           provider_call_id = coalesce(provider_call_id, p_provider_call_id)
     where id = v_attempt.id;

    insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
    values ('tenant', p_agent_user_id, 'tenant.dial_dispositioned', 'tenant_call_attempts', v_attempt.id::text,
            jsonb_build_object('leadId', v_lead.id, 'disposition', p_disposition,
                               'leadState', v_lead.lead_state, 'countsTowardCadence', false));

    return query select v_lead.lead_state, v_lead.next_dial_after, v_lead.next_preferred_slot, false,
                        'Logged as an inbound return call. The outbound cadence is unchanged and no attempt was used.';
    return;
  end if;

  select * into v_item from public.lead_queue
   where id = v_attempt.work_item_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'WORK_ITEM_NOT_FOUND'; end if;

  v_phone := v_lead.values->>'phone';
  v_slot := coalesce(v_attempt.slot, current_slot_for_state(v_lead.values->>'state', v_now), 'late_morning');
  update public.tenant_call_attempts
     set disposition = p_disposition,
         dial_clicked_at = coalesce(dial_clicked_at, p_dial_clicked_at),
         provider_call_id = coalesce(provider_call_id, p_provider_call_id)
   where id = v_attempt.id;
  update public.agent_leads set attempts_made = coalesce(attempts_made, 0) + 1 where id = v_lead.id;

  -- The tenant's "ends dialing" flag, read from its own outcome row. A key with no row (the
  -- dialer's attempt outcomes: no answer, voicemail, busy) falls back to the built-in default, so a
  -- tenant that has changed nothing gets exactly the behaviour it had before this migration.
  select d.ends_call into v_ends_call
    from public.dispositions d
   where d.tenant_id = p_tenant_id and d.disposition_key = p_disposition;
  v_ends_call := coalesce(v_ends_call, public.disposition_default_ends_call(p_disposition));

  if p_disposition = 'do_not_call' then
    if v_phone is not null then
      perform suppress_phone(p_tenant_id, v_phone, 'internal', 'Agent recorded do not call on the dialer', 'disposition', p_agent_user_id);
      v_suppressed := true;
    end if;
    v_new_state := 'closed';
    v_reason := 'Added to the do-not-call list permanently. This lead will never be served again.';
  elsif p_disposition = 'callback_scheduled' then
    v_new_state := 'working';
    v_reason := 'A callback is scheduled; the cadence does not apply.';
  elsif v_ends_call and p_disposition in ('wrong_number', 'disconnected') then
    v_new_state := 'closed';
    v_reason := 'Closed and flagged for a vendor credit claim.';
  elsif v_ends_call then
    v_new_state := 'closed';
    v_reason := 'Closed. No further attempts.';
  else
    select * into v_sched from schedule_next_attempt(p_tenant_id, v_lead.id, p_disposition, v_now);
    if v_sched.exhausted then
      v_new_state := 'exhausted';
      v_reason := format('Attempt %s reached the ceiling. Moved to nurture and no longer served.', coalesce(v_lead.attempts_made, 0) + 1);
      update public.agent_leads set lead_state = 'exhausted', next_dial_after = null, next_preferred_slot = null where id = v_lead.id;
    else
      v_new_state := 'retry';
      v_reason := format('Attempt %s scheduled for %s in the %s slot.', v_sched.attempt_number, to_char(v_sched.due_at, 'Dy DD Mon HH24:MI'), replace(v_sched.slot, '_', ' '));
      v_due_at := v_sched.due_at;
      v_due_slot := v_sched.slot;
      update public.agent_leads set lead_state = 'retry', next_dial_after = v_sched.due_at, next_preferred_slot = v_sched.slot where id = v_lead.id;
    end if;
  end if;

  if v_new_state in ('closed', 'working') then
    update public.agent_leads set lead_state = v_new_state, next_dial_after = null, next_preferred_slot = null where id = v_lead.id;
  end if;

  -- Route a TERMINAL outcome to the pipeline reserved for it.
  --
  -- 'closed', 'exhausted' and 'working'. Everything except 'retry'.
  --
  -- 'working' is reached by exactly one disposition, callback_scheduled, which is mapped to
  -- "Needs Callback" — a dedicated pipeline for that outcome is the whole point, and the lead
  -- is coming back at a time the customer named rather than on the dialer's cadence.
  --
  -- 'retry' is the one that must never be here. That lead is going back into the queue for the
  -- next attempt, and relocating it would take it off the board the dialer serves from —
  -- a worse failure than not routing at all, and a silent one.
  --
  -- The lookup is deliberately not confined to the lead's current pipeline: the destination is a
  -- DIFFERENT pipeline, reserved for that disposition. An unmapped disposition leaves both ids
  -- null and the lead where it is, so this is opt-in per disposition and a tenant that has
  -- configured nothing sees no change at all.
  if v_new_state in ('closed', 'exhausted', 'working') then
    select ps.id, ps.pipeline_id into v_stage_id, v_stage_pipeline
      from public.stage_dispositions sd
      join public.tenant_pipeline_stages ps on ps.id = sd.stage_id
     where sd.tenant_id = p_tenant_id
       and sd.disposition_key = p_disposition
       and not ps.is_archived
     limit 1;
    if v_stage_id is not null then
      update public.agent_leads
         set stage_id = v_stage_id, pipeline_id = v_stage_pipeline
       where id = v_lead.id and tenant_id = p_tenant_id;
    end if;
  end if;
  update public.lead_queue
     set status = case when v_new_state = 'retry' then 'unclaimed' else 'completed' end,
         claimed_by = null, owner_user_id = null, locked_until = null,
         -- coalesce so an unmapped disposition leaves the work item alone. The lead and its
         -- queue row move together or not at all: a board renders from both, and a lead in
         -- pipeline A displaying a stage from pipeline B appears in no column.
         stage_id = coalesce(v_stage_id, stage_id),
         pipeline_id = coalesce(v_stage_pipeline, pipeline_id),
         disposition = p_disposition, disposition_at = v_now, disposition_by = p_agent_user_id,
         updated_at = v_now
   where id = v_item.id and tenant_id = p_tenant_id;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_agent_user_id, 'tenant.dial_dispositioned', 'tenant_call_attempts', v_attempt.id::text,
          jsonb_build_object('workItemId', v_item.id, 'leadId', v_lead.id, 'disposition', p_disposition, 'leadState', v_new_state));
  -- Say where it went. The agent is told the lead closed; without this they are not told it
  -- also left their board.
  if v_stage_id is not null then
    v_reason := v_reason || format(' Moved to %s.',
      (select ps.name from public.tenant_pipeline_stages ps where ps.id = v_stage_id));
  end if;

  return query select v_new_state,
                      v_due_at,
                      v_due_slot,
                      v_suppressed, v_reason;
end;
$function$;

revoke all on function public.complete_existing_dial_disposition(uuid, uuid, uuid, text, timestamptz, text) from public, anon, authenticated, tenant_app;
grant execute on function public.complete_existing_dial_disposition(uuid, uuid, uuid, text, timestamptz, text) to service_role;

do $$
declare
  v_src text;
  v_count integer;
begin
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_existing_dial_disposition';
  if v_count <> 1 then
    raise exception 'expected exactly one complete_existing_dial_disposition, found %', v_count;
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_existing_dial_disposition';

  if strpos(v_src, 'd.ends_call') = 0 then raise exception 'the dialer does not read the ends_call setting'; end if;
  if strpos(v_src, 'disposition_default_ends_call') = 0 then raise exception 'a key with no row lost its default'; end if;
  -- Everything the earlier migrations guarded, still here.
  if strpos(v_src, $q$v_new_state in ('closed', 'exhausted', 'working')$q$) = 0 then raise exception 'pipeline routing was lost'; end if;
  if strpos(v_src, $q$v_new_state in ('closed', 'exhausted', 'working', 'retry')$q$) > 0 then raise exception 'a retry now moves pipeline'; end if;
  if strpos(v_src, 'inbound_return_call') = 0 then raise exception 'the inbound return branch was lost'; end if;
  if strpos(v_src, 'suppress_phone') = 0 then raise exception 'the do-not-call write was lost'; end if;
  if strpos(v_src, 'coalesce(v_stage_id') = 0 then raise exception 'the work item no longer follows the lead'; end if;

  raise notice 'Settings: ends dialing is now a per-tenant outcome setting the dialer reads';
end $$;
