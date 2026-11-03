-- Activity · the call log learns the dial and the outcome.
--
-- THE DEFECT. tenant_lead_activity (20260913460000) was told about a call by one trigger, AFTER
-- INSERT on tenant_call_attempts. The dialer inserts the attempt EMPTY when it prepares the call
-- (lib/dialerScripts/service.ts, startAttempt) and only later UPDATEs dial_clicked_at (the Dial
-- press) and disposition (complete_existing_dial_disposition). So the one trigger always copied two
-- nulls, and no activity row ever carried a click or an outcome: Dials, Logged and the contact rate
-- read zero on the Activity page and on the agent scorecard behind it. Confirmed live 2026-09-25:
-- 53 activity rows, 0 clicked, 0 logged; 11 attempts dialled, 9 with an outcome.
--
-- THE FIX. The same trigger now also fires on UPDATE OF dial_clicked_at, disposition, and links
-- the attempt to the card it belongs to:
--   1. a row already linked to this attempt (call_attempt_id, new here);
--   2. else the latest card served for the attempt's work item, to the same agent, at or before the
--      attempt, that has no outcome yet;
--   3. else the latest such card for the same lead and agent.
-- A card linked to an earlier attempt that never got an outcome (prepared, dialled, abandoned) can
-- be re-linked by the next attempt on it; one with an outcome never is.
--
-- INBOUND RETURN CALLS STAY UNMATCHED. They were never served (decision 1 of 20260917145000): an
-- attempt with no work item is inbound by construction (an outbound attempt requires a claim), so
-- it is never matched. One started while the agent held a claim is matched at the Dial press like
-- any call, and un-matched again the moment it is recorded as `inbound_return_call`.
--
-- The link never blocks a dial. Any error inside it is raised as a WARNING and the dialer's own
-- transaction carries on: the call log is evidence, not a gate.

alter table public.tenant_lead_activity
  add column if not exists call_attempt_id uuid references public.tenant_call_attempts(id) on delete set null;

create index if not exists tenant_lead_activity_call_attempt_idx
  on public.tenant_lead_activity (call_attempt_id) where call_attempt_id is not null;
create index if not exists tenant_lead_activity_work_item_served_idx
  on public.tenant_lead_activity (tenant_id, work_item_id, served_at desc) where work_item_id is not null;
create index if not exists tenant_lead_activity_lead_agent_served_idx
  on public.tenant_lead_activity (tenant_id, lead_id, agent_user_id, served_at desc);

-- One attempt → its card. Returns the activity row it wrote to, or null when there is none.
-- `p_dispositioned_at` is when the outcome was recorded: now() from the trigger, the audit time
-- from the backfill. It is only used the first time a card gets an outcome.
create or replace function public.link_call_attempt_to_activity(
  p_attempt public.tenant_call_attempts,
  p_dispositioned_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_target uuid;
begin
  -- An inbound return call is not an outbound card's call. Undo a link made at its Dial press.
  if p_attempt.disposition = 'inbound_return_call' then
    update public.tenant_lead_activity
       set call_attempt_id = null, clicked_at = null, updated_at = now()
     where call_attempt_id = p_attempt.id and tenant_id = p_attempt.tenant_id and disposition is null;
    return null;
  end if;

  -- Nothing to say yet (prepared, not dialled), or an inbound attempt with no claim.
  if p_attempt.dial_clicked_at is null and p_attempt.disposition is null then return null; end if;
  if p_attempt.work_item_id is null then return null; end if;

  select a.id into v_target
    from public.tenant_lead_activity a
   where a.call_attempt_id = p_attempt.id and a.tenant_id = p_attempt.tenant_id
   limit 1;

  if v_target is null then
    select a.id into v_target
      from public.tenant_lead_activity a
     where a.tenant_id = p_attempt.tenant_id
       and a.work_item_id = p_attempt.work_item_id
       and a.lead_id = p_attempt.lead_id
       and (p_attempt.agent_id is null or a.agent_user_id = p_attempt.agent_id)
       and a.disposition is null
       and a.served_at <= p_attempt.attempted_at
       and (a.call_attempt_id is null or exists (
             select 1 from public.tenant_call_attempts o
              where o.id = a.call_attempt_id and o.id <> p_attempt.id
                and o.disposition is null and o.attempted_at <= p_attempt.attempted_at))
     order by a.served_at desc, a.id desc
     limit 1
     for update of a;
  end if;

  if v_target is null then
    select a.id into v_target
      from public.tenant_lead_activity a
     where a.tenant_id = p_attempt.tenant_id
       and a.lead_id = p_attempt.lead_id
       and (p_attempt.agent_id is null or a.agent_user_id = p_attempt.agent_id)
       and a.disposition is null
       and a.served_at <= p_attempt.attempted_at
       and (a.call_attempt_id is null or exists (
             select 1 from public.tenant_call_attempts o
              where o.id = a.call_attempt_id and o.id <> p_attempt.id
                and o.disposition is null and o.attempted_at <= p_attempt.attempted_at))
     order by a.served_at desc, a.id desc
     limit 1
     for update of a;
  end if;

  if v_target is null then return null; end if;

  update public.tenant_lead_activity a
     set call_attempt_id = p_attempt.id,
         -- The card's first Dial press. A re-link after an abandoned attempt keeps the earlier one.
         clicked_at = coalesce(a.clicked_at, p_attempt.dial_clicked_at),
         dispositioned_at = case
           when a.disposition is null and p_attempt.disposition is not null
             then coalesce(a.dispositioned_at, p_dispositioned_at, clock_timestamp())
           else a.dispositioned_at end,
         disposition = coalesce(a.disposition, p_attempt.disposition),
         updated_at = now()
   where a.id = v_target;
  return v_target;
end;
$function$;

revoke all on function public.link_call_attempt_to_activity(public.tenant_call_attempts, timestamptz) from public, anon, authenticated, tenant_app;
grant execute on function public.link_call_attempt_to_activity(public.tenant_call_attempts, timestamptz) to service_role;

-- Restated from 20260913460000 (its only definition). Same name, same trigger name, so nothing
-- else that refers to either changes.
create or replace function public.record_lead_attempt_activity()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $function$
begin
  if tg_op = 'UPDATE'
     and new.dial_clicked_at is not distinct from old.dial_clicked_at
     and new.disposition is not distinct from old.disposition then
    return new;
  end if;
  begin
    perform public.link_call_attempt_to_activity(
      new,
      case when new.disposition is not null and (tg_op = 'INSERT' or old.disposition is null) then clock_timestamp() end
    );
  exception when others then
    -- Evidence, not a gate: a failed link must never undo the dial or the outcome it describes.
    raise warning 'tenant_lead_activity link failed for attempt %: %', new.id, sqlerrm;
  end;
  return new;
end;
$function$;

drop trigger if exists tenant_call_attempt_record_activity on public.tenant_call_attempts;
create trigger tenant_call_attempt_record_activity
  after insert or update of dial_clicked_at, disposition on public.tenant_call_attempts
  for each row execute function public.record_lead_attempt_activity();

-- ── one-time backfill ─────────────────────────────────────────────────────────
-- Oldest attempt first, so each takes the card it was made on before a later one looks. The
-- outcome time is the audit row complete_existing_dial_disposition writes for that attempt, then
-- the work item's disposition time, then the Dial press, then the attempt itself.
-- Idempotent: a second run finds every attempt already linked and changes nothing.
do $$
declare
  r public.tenant_call_attempts;
  v_at timestamptz;
begin
  -- Same guard as the checks below: a role that could not create the function cannot run it.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925705000: backfill skipped, % cannot create in public', current_user;
    return;
  end if;
  for r in
    select * from public.tenant_call_attempts
     where dial_clicked_at is not null or disposition is not null
     order by attempted_at, id
  loop
    v_at := null;
    if r.disposition is not null then
      select min(al.ts) into v_at
        from public.audit_log al
       where al.action = 'tenant.dial_dispositioned' and al.target_id::text = r.id::text;
      if v_at is null and r.work_item_id is not null then
        select q.disposition_at into v_at
          from public.lead_queue q
         where q.id = r.work_item_id and q.disposition is not distinct from r.disposition;
      end if;
      v_at := coalesce(v_at, r.dial_clicked_at, r.attempted_at);
    end if;
    perform public.link_call_attempt_to_activity(r, v_at);
  end loop;
end $$;

do $$
declare
  v_matchable integer;
  v_linked integer;
  v_outcomes integer;
begin
  -- A role that cannot create objects cannot have applied anything above either (scripts/
  -- check-migrations.mjs parse-checks with such a role); a real apply always reaches the checks.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925705000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tenant_lead_activity' and column_name = 'call_attempt_id') then
    raise exception 'tenant_lead_activity.call_attempt_id is missing';
  end if;
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'tenant_call_attempts' and t.tgname = 'tenant_call_attempt_record_activity'
       and not t.tgisinternal and (t.tgtype & 16) = 16  -- fires on UPDATE
  ) then
    raise exception 'tenant_call_attempt_record_activity does not fire on update';
  end if;

  -- "Where it can": an outbound outcome is matchable when its agent was served a card for that
  -- lead after the agent's previous outcome on it and at or before this attempt. Every one of
  -- those must now carry the outcome on a linked card.
  with outcomes as (
    select ca.*,
           lag(ca.attempted_at) over (partition by ca.tenant_id, ca.lead_id, ca.agent_id order by ca.attempted_at, ca.id) as prev_at
      from public.tenant_call_attempts ca
     where ca.disposition is not null and ca.disposition <> 'inbound_return_call'
       and ca.work_item_id is not null and ca.agent_id is not null
  )
  select count(*) filter (where exists (
           select 1 from public.tenant_lead_activity a
            where a.tenant_id = o.tenant_id and a.lead_id = o.lead_id and a.agent_user_id = o.agent_id
              and a.served_at <= o.attempted_at and (o.prev_at is null or a.served_at > o.prev_at))),
         count(*) filter (where exists (
           select 1 from public.tenant_lead_activity a
            where a.call_attempt_id = o.id and a.disposition = o.disposition)),
         count(*)
    into v_matchable, v_linked, v_outcomes
    from outcomes o;

  raise notice '20260925705000: % outbound outcomes, % matchable to a served card, % linked', v_outcomes, v_matchable, v_linked;
  if v_linked < v_matchable then
    raise exception 'backfill linked % of % matchable outcomes to their served card', v_linked, v_matchable;
  end if;

  if exists (select 1 from public.tenant_lead_activity a
               join public.tenant_call_attempts ca on ca.id = a.call_attempt_id
              where ca.disposition = 'inbound_return_call' or ca.work_item_id is null) then
    raise exception 'an inbound return call is linked to a served card';
  end if;
end $$;
