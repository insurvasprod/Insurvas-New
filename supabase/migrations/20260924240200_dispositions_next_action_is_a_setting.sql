-- ---------------------------------------------------------------------------
-- Settings → Dispositions · the "Next action" column becomes a setting the dialer honours.
--
-- The board's Next action reads "Next cadence attempt", "Retry in 20 minutes", "Rest 90 days",
-- "Book a time · required". The screen could only show one of four phrases derived from the key
-- and `ends_call`, and none of them could be changed. This adds the setting and makes
-- `complete_existing_dial_disposition` act on it.
--
--   next_action   next_action_minutes   what the dialer does after the outcome
--   cadence       null                  the tenant's retry cadence (schedule_next_attempt)
--   retry         1 … 525600            back in the queue after exactly that long; the cadence's
--                                       attempt ceiling still applies
--   rest          1 … 525600            off the dialer for that long, then served again as a
--                                       nurture lead
--   close         null                  closed, no further attempts
--   callback      null                  callback_scheduled only: a callback is booked
--   suppress      null                  do_not_call only: suppressed and closed
--
-- `ends_call` (20260924140000) stays, and a trigger keeps it consistent with the next action:
-- close, rest, callback and suppress end dialing; cadence and retry do not. An older writer that
-- changes only `ends_call` still works: the next action is re-derived from it (close / cadence).
--
-- Every existing row is seeded from exactly what the dialer does for it today, so nothing changes
-- until a tenant edits an outcome. A key with no row (the dialer's no answer / voicemail / busy)
-- still falls back to the built-in behaviour; a tenant that adds an outcome with that key gets its
-- own setting read.
--
-- Requires 20260924140000. The function body below is derived from that file's body, not retyped:
-- only the flag read, the rest branch, the retry timing, the routing set and the queue status for a
-- rest change. Additive and idempotent; lib/dispositions reads the columns tolerantly.
-- ---------------------------------------------------------------------------

alter table public.dispositions add column if not exists next_action text;
alter table public.dispositions add column if not exists next_action_minutes integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dispositions_next_action_known') then
    alter table public.dispositions
      add constraint dispositions_next_action_known
      check (next_action is null or next_action in ('cadence', 'retry', 'rest', 'close', 'callback', 'suppress'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dispositions_next_action_minutes_shape') then
    -- A delay belongs to retry and rest, and only to them; a year is the longest.
    alter table public.dispositions
      add constraint dispositions_next_action_minutes_shape
      check (
        (next_action in ('retry', 'rest') and next_action_minutes between 1 and 525600)
        or (next_action is distinct from 'retry' and next_action is distinct from 'rest' and next_action_minutes is null)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dispositions_fixed_next_actions') then
    -- The two compliance branches the dialer runs first cannot be configured away, and no other
    -- outcome can claim them.
    alter table public.dispositions
      add constraint dispositions_fixed_next_actions
      check (
        next_action is null
        or (disposition_key = 'do_not_call' and next_action = 'suppress')
        or (disposition_key = 'callback_scheduled' and next_action = 'callback')
        or (disposition_key not in ('do_not_call', 'callback_scheduled') and next_action not in ('suppress', 'callback'))
      );
  end if;
end $$;

create or replace function public.disposition_default_next_action(p_disposition_key text, p_ends_call boolean)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case
    when p_disposition_key = 'do_not_call' then 'suppress'
    when p_disposition_key = 'callback_scheduled' then 'callback'
    when coalesce(p_ends_call, public.disposition_default_ends_call(p_disposition_key)) then 'close'
    else 'cadence'
  end
$$;

revoke all on function public.disposition_default_next_action(text, boolean) from public, anon, authenticated;
grant execute on function public.disposition_default_next_action(text, boolean) to tenant_app, service_role;

-- Runs after dispositions_fill_ends_call (triggers fire in name order), so ends_call is already set.
create or replace function public.dispositions_keep_next_action()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'UPDATE'
     and new.next_action is not distinct from old.next_action
     and new.ends_call is distinct from old.ends_call then
    -- Only the flag changed: an older writer. Follow it.
    new.next_action := public.disposition_default_next_action(new.disposition_key, new.ends_call);
    new.next_action_minutes := null;
  elsif new.next_action is null then
    new.next_action := public.disposition_default_next_action(new.disposition_key, new.ends_call);
    new.next_action_minutes := null;
  end if;
  new.ends_call := new.next_action in ('close', 'rest', 'callback', 'suppress');
  return new;
end;
$$;

drop trigger if exists dispositions_keep_next_action on public.dispositions;
create trigger dispositions_keep_next_action before insert or update on public.dispositions
  for each row execute function public.dispositions_keep_next_action();

-- Seed and describe the columns. Inside a block only so a parse-check run, which cannot add the
-- columns, does not trip on them; applied for real, the columns exist and this always runs.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'dispositions' and column_name = 'next_action') then
    update public.dispositions
       set next_action = public.disposition_default_next_action(disposition_key, ends_call)
     where next_action is null;

    comment on column public.dispositions.next_action is
      'What the dialer does after this outcome: cadence, retry (after next_action_minutes), rest (for next_action_minutes), close, callback (callback_scheduled only), suppress (do_not_call only).';
    comment on column public.dispositions.next_action_minutes is
      'The retry delay or rest period, in minutes. Set only for retry and rest.';
  end if;
end $$;

-- ── the dialer honours it ──────────────────────────────────────────────────
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
  v_next_action text;
  v_next_minutes integer;
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
  -- And its next action (20260924240200): a fixed retry delay, or a rest period, instead of the
  -- cadence's own timing. A key with no row has no next action and behaves exactly as before.
  select d.ends_call, d.next_action, d.next_action_minutes into v_ends_call, v_next_action, v_next_minutes
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
  elsif v_ends_call and v_next_action = 'rest' and v_next_minutes is not null then
    -- Rest: the lead leaves the dialer for the configured period and is then served again, as a
    -- nurture lead (serve_next_lead tier 6 once next_dial_after has passed). Not closed: a rested
    -- lead is one the agency still wants to call, later.
    v_new_state := 'nurture';
    v_due_at := v_now + make_interval(mins => v_next_minutes);
    v_reason := format('Resting until %s. The lead is served again after that.', to_char(v_due_at, 'Dy DD Mon'));
    update public.agent_leads set lead_state = 'nurture', next_dial_after = v_due_at, next_preferred_slot = null where id = v_lead.id;
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
      v_due_at := v_sched.due_at;
      v_due_slot := v_sched.slot;
      -- A fixed retry delay replaces the cadence's timing but not its ceiling: the exhausted branch
      -- above has already run, so "Retry in 20 minutes" cannot retry for ever. The slot is the one
      -- the retry falls in, so serve_next_lead's slot rule serves it when it comes due.
      if v_next_action = 'retry' and v_next_minutes is not null then
        v_due_at := v_now + make_interval(mins => v_next_minutes);
        v_due_slot := coalesce(current_slot_for_state(v_lead.values->>'state', v_due_at), v_sched.slot);
      end if;
      v_reason := format('Attempt %s scheduled for %s in the %s slot.', v_sched.attempt_number, to_char(v_due_at, 'Dy DD Mon HH24:MI'), replace(v_due_slot, '_', ' '));
      update public.agent_leads set lead_state = 'retry', next_dial_after = v_due_at, next_preferred_slot = v_due_slot where id = v_lead.id;
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
  -- 'nurture' (a rest) routes like the other outcomes that take the lead off the cadence.
  if v_new_state in ('closed', 'exhausted', 'working', 'nurture') then
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
     -- A rested lead stays unclaimed so it can be served when the rest ends.
     set status = case when v_new_state in ('retry', 'nurture') then 'unclaimed' else 'completed' end,
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
  -- A parse-check run cannot add the columns or replace the function; there is nothing to verify.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'dispositions' and column_name = 'next_action') then
    raise notice 'dispositions.next_action is not present; skipping the dialer body check';
    return;
  end if;

  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_existing_dial_disposition';
  if v_count <> 1 then
    raise exception 'expected exactly one complete_existing_dial_disposition, found %', v_count;
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_existing_dial_disposition';

  if strpos(v_src, 'd.next_action') = 0 then raise exception 'the dialer does not read the next action'; end if;
  if strpos(v_src, 'd.ends_call') = 0 then raise exception 'the dialer does not read the ends_call setting'; end if;
  if strpos(v_src, 'disposition_default_ends_call') = 0 then raise exception 'a key with no row lost its default'; end if;
  if strpos(v_src, $q$v_new_state in ('closed', 'exhausted', 'working', 'nurture')$q$) = 0 then raise exception 'pipeline routing was lost'; end if;
  if strpos(v_src, $q$'working', 'nurture', 'retry')$q$) > 0 then raise exception 'a retry now moves pipeline'; end if;
  if strpos(v_src, 'v_sched.exhausted') = 0 then raise exception 'a fixed retry escaped the attempt ceiling'; end if;
  if strpos(v_src, 'inbound_return_call') = 0 then raise exception 'the inbound return branch was lost'; end if;
  if strpos(v_src, 'suppress_phone') = 0 then raise exception 'the do-not-call write was lost'; end if;
  if strpos(v_src, 'coalesce(v_stage_id') = 0 then raise exception 'the work item no longer follows the lead'; end if;

  raise notice 'Settings: the next action is now a per-tenant outcome setting the dialer reads';
end $$;
