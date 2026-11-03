-- ---------------------------------------------------------------------------
-- Callbacks · a callback counts when the call comes back (LA-1 §6.3)
--
-- User decisions (2026-09-25, Callbacks concept audit):
--
--   KEPT     A contact outcome on a dial of that lead, placed from 15 minutes before the callback
--            was due to the end of the customer's day (in the customer's own timezone), closes the
--            callback automatically. A no-answer (any non-contact outcome) keeps it open.
--   MANUAL   "Mark done" stays as an override, is recorded as manual, and no longer reopens the
--            work item — where the lead goes next is the call's outcome, not the button.
--   REBOOK   A new callback booked on a lead replaces the one still open on it (history
--            'replaced'), so a missed callback leaves Overdue when it is rebooked, and a rebook on
--            the same work item no longer collides with tenant_callbacks_active_work_item_idx.
--
-- Objects:
--   tenant_callbacks          + completed_via ('manual' | 'call'), kept_attempt_id, missed_at,
--                               reopened_at, reopened_from, released_at, in_app_reminded_at
--   callback_history          + via; actor_user_id nullable (the system closes and reopens
--                               callbacks too); actions + 'reopened', 'released', 'replaced'
--   tenant_call_attempts_keeps_callback  AFTER INSERT OR UPDATE OF disposition on
--                               tenant_call_attempts (distinct from Activity's
--                               tenant_call_attempt_record_activity)
--   tenant_callbacks_before_update_callbacks  when a reopened callback stops being due, its work
--                               item goes back to how the outcome left it if nobody has dialled it;
--                               a moved time re-arms the in-app reminder
--   tenant_callbacks_replace_open_one  BEFORE INSERT on tenant_callbacks
--   complete_callback         restated from 20260913160000 (its latest definition)
--   callback_work_item_holder(tenant, work_item)   the booked agent while a due callback holds the
--                               work item — for the Dialer's serve_next_lead (not edited here)
--   callback_tier_due(tenant, work_item, now)      whether the work item is a due callback nobody
--                               has dialled since it came due — likewise offered to the Dialer
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.tenant_callbacks') is null then
    raise exception 'tenant_callbacks does not exist; apply 20260913160000 before this file';
  end if;
  if to_regprocedure('public.is_contact_disposition(text)') is null then
    raise exception 'is_contact_disposition does not exist; apply 20260913390000 before this file';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tenant_call_attempts' and column_name = 'dial_clicked_at') then
    raise exception 'tenant_call_attempts.dial_clicked_at does not exist; apply 20260913350000 before this file';
  end if;
end $$;

-- ── columns ────────────────────────────────────────────────────────────────
alter table public.tenant_callbacks
  add column if not exists completed_via text,
  add column if not exists kept_attempt_id uuid references public.tenant_call_attempts(id) on delete set null,
  add column if not exists missed_at timestamptz,
  add column if not exists reopened_at timestamptz,
  add column if not exists reopened_from jsonb,
  add column if not exists released_at timestamptz,
  add column if not exists in_app_reminded_at timestamptz;

alter table public.tenant_callbacks drop constraint if exists tenant_callbacks_completed_via_check;
alter table public.tenant_callbacks add constraint tenant_callbacks_completed_via_check
  check (completed_via is null or completed_via in ('manual', 'call'));

-- completed_via  how a completed callback was closed: 'call' (a contact outcome on a dial of the
--                lead inside the kept window) or 'manual' (Mark done).
-- missed_at      when the customer's calling window closed on the due day with no kept call. Never
--                cleared, so a missed callback that is later rebooked still counts as missed once.
-- reopened_from  the work item as the outcome left it, kept while a due callback holds the work
--                item for its agent, so it can be put back if nobody dials it.

-- The kept trigger and the rebook trigger both look callbacks up by lead.
create index if not exists tenant_callbacks_open_lead_idx
  on public.tenant_callbacks (tenant_id, lead_id)
  where status in ('scheduled', 'due', 'missed');
-- The due job scans every tenant by time.
create index if not exists tenant_callbacks_open_time_idx
  on public.tenant_callbacks (scheduled_at_utc)
  where status in ('scheduled', 'due');

alter table public.callback_history alter column actor_user_id drop not null;
alter table public.callback_history add column if not exists via text;
alter table public.callback_history drop constraint if exists callback_history_via_check;
alter table public.callback_history add constraint callback_history_via_check
  check (via is null or via in ('manual', 'call', 'system'));
alter table public.callback_history drop constraint if exists callback_history_action_check;
alter table public.callback_history add constraint callback_history_action_check
  check (action in ('scheduled', 'rescheduled', 'cancelled', 'completed', 'missed', 'reopened', 'released', 'replaced'));

-- ── the call closes the callback ───────────────────────────────────────────
create or replace function public.tenant_call_attempts_keeps_callback()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_at timestamptz;
  r record;
begin
  if new.disposition is null or not public.is_contact_disposition(new.disposition) then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.disposition is not null then
    return new;
  end if;
  -- When the call was placed: the dial press when there was one, else when the attempt began.
  v_at := coalesce(new.dial_clicked_at, new.attempted_at);

  for r in
    with o as (
      select cb.id, cb.status as old_status
        from public.tenant_callbacks cb
       where cb.tenant_id = new.tenant_id
         and cb.lead_id = new.lead_id
         and cb.status in ('scheduled', 'due', 'missed')
         and v_at >= cb.scheduled_at_utc - interval '15 minutes'
         and v_at < (((cb.scheduled_at_utc at time zone cb.customer_timezone)::date + 1)::timestamp
                     at time zone cb.customer_timezone)
       for update
    )
    update public.tenant_callbacks cb
       set status = 'completed', completed_at = now(), completed_via = 'call',
           kept_attempt_id = new.id, updated_at = now()
      from o
     where cb.id = o.id
    returning cb.id, cb.lead_id, cb.work_item_id, cb.scheduled_at_utc, o.old_status
  loop
    insert into public.callback_history
      (tenant_id, callback_id, lead_id, actor_user_id, action, old_scheduled_at_utc, old_status, new_status, note, via)
    values
      (new.tenant_id, r.id, r.lead_id, new.agent_id, 'completed', r.scheduled_at_utc, r.old_status, 'completed',
       'Kept: the customer was reached on this call', 'call');
    insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
    values ((case when new.agent_id is null then 'system' else 'tenant' end)::public.audit_actor_type,
            new.agent_id, 'tenant.callback_completed', 'callback', r.id::text,
            jsonb_build_object('tenantId', new.tenant_id, 'leadId', r.lead_id, 'workItemId', r.work_item_id,
                               'via', 'call', 'attemptId', new.id, 'disposition', new.disposition));
  end loop;
  return new;
end;
$function$;

revoke all on function public.tenant_call_attempts_keeps_callback() from public, anon, authenticated, tenant_app;

drop trigger if exists tenant_call_attempts_keeps_callback on public.tenant_call_attempts;
create trigger tenant_call_attempts_keeps_callback
after insert or update of disposition on public.tenant_call_attempts
for each row execute function public.tenant_call_attempts_keeps_callback();

-- ── a reopened callback that stops being due gives its work item back ─────
--
-- run_callback_due (20260925708700) hands a dispositioned work item back to the booked agent when
-- the callback comes due, and keeps what the outcome had written in reopened_from. When the
-- callback then stops being due WITHOUT a kept call — Mark done, cancelled, rebooked for later,
-- missed — and nobody has dialled the lead since, the work item goes back exactly as the outcome
-- left it. A dial in between wrote its own outcome to the work item (disposition not null), and
-- that outcome stands. A lead the reclaim already returned to the cadence (lead_state no longer
-- 'working') is not touched either.
create or replace function public.tenant_callbacks_before_update_callbacks()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_owner uuid;
begin
  if new.scheduled_at_utc is distinct from old.scheduled_at_utc then
    new.in_app_reminded_at := null;
  end if;

  if old.reopened_at is null or new.status = 'due' then
    return new;
  end if;

  if coalesce(new.completed_via, '') <> 'call' and old.reopened_from is not null then
    update public.lead_queue q
       set status = coalesce(old.reopened_from->>'status', 'completed'),
           disposition = old.reopened_from->>'disposition',
           disposition_at = nullif(old.reopened_from->>'disposition_at', '')::timestamptz,
           disposition_by = nullif(old.reopened_from->>'disposition_by', '')::uuid,
           owner_user_id = nullif(old.reopened_from->>'owner_user_id', '')::uuid,
           claimed_by = nullif(old.reopened_from->>'claimed_by', '')::uuid,
           claimed_at = nullif(old.reopened_from->>'claimed_at', '')::timestamptz,
           owner_role = old.reopened_from->>'owner_role',
           locked_until = null,
           updated_at = now()
     where q.id = old.work_item_id
       and q.tenant_id = old.tenant_id
       and q.status in ('claimed', 'unclaimed')
       and q.disposition is null
       and (q.locked_until is null or q.locked_until < now())
       and exists (select 1 from public.agent_leads l
                    where l.id = q.lead_id and l.tenant_id = q.tenant_id and l.lead_state = 'working')
    returning q.owner_user_id into v_owner;
    -- The capacity trigger refreshes only the NEW owner; the agent who held it is refreshed here.
    if found and to_regprocedure('public.refresh_agent_capacity_for_user(uuid, uuid)') is not null then
      perform public.refresh_agent_capacity_for_user(old.tenant_id, old.assigned_to);
    end if;
  end if;

  new.reopened_at := null;
  new.reopened_from := null;
  new.released_at := null;
  return new;
end;
$function$;

revoke all on function public.tenant_callbacks_before_update_callbacks() from public, anon, authenticated, tenant_app;

drop trigger if exists tenant_callbacks_before_update_callbacks on public.tenant_callbacks;
create trigger tenant_callbacks_before_update_callbacks
before update on public.tenant_callbacks
for each row execute function public.tenant_callbacks_before_update_callbacks();

-- ── one open callback per lead: a new booking replaces the old one ────────
create or replace function public.tenant_callbacks_replace_open_one()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  r record;
begin
  if new.status not in ('scheduled', 'due') then
    return new;
  end if;
  for r in
    with o as (
      select cb.id, cb.status as old_status
        from public.tenant_callbacks cb
       where cb.tenant_id = new.tenant_id
         and cb.lead_id = new.lead_id
         and cb.id <> new.id
         and cb.status in ('scheduled', 'due', 'missed')
       for update
    )
    update public.tenant_callbacks cb
       set status = 'cancelled', updated_at = now()
      from o
     where cb.id = o.id
    returning cb.id, cb.lead_id, cb.work_item_id, cb.scheduled_at_utc, o.old_status
  loop
    insert into public.callback_history
      (tenant_id, callback_id, lead_id, actor_user_id, action, old_scheduled_at_utc, new_scheduled_at_utc, old_status, new_status, note, via)
    values
      (new.tenant_id, r.id, r.lead_id, new.created_by, 'replaced', r.scheduled_at_utc, new.scheduled_at_utc, r.old_status, 'cancelled',
       'Replaced by a new callback on the same lead', 'system');
    insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
    values ('tenant', new.created_by, 'tenant.callback_replaced', 'callback', r.id::text,
            jsonb_build_object('tenantId', new.tenant_id, 'leadId', r.lead_id, 'workItemId', r.work_item_id,
                               'replacedBy', new.id, 'oldStatus', r.old_status));
  end loop;
  return new;
end;
$function$;

revoke all on function public.tenant_callbacks_replace_open_one() from public, anon, authenticated, tenant_app;

drop trigger if exists tenant_callbacks_replace_open_one on public.tenant_callbacks;
create trigger tenant_callbacks_replace_open_one
before insert on public.tenant_callbacks
for each row execute function public.tenant_callbacks_replace_open_one();

-- ── Mark done: manual, and it no longer moves the work item ───────────────
-- Restated from 20260913160000 (its latest definition; 20260913360000 patched only
-- reschedule_callback and complete_disposition_with_callback). Changes: completed_via = 'manual',
-- the real old status in history, and NO lead_queue write — the old body reopened a dispositioned
-- work item to 'unclaimed', which put a 'working' lead in the pool on no tier. A work item that
-- run_callback_due had handed back is returned by tenant_callbacks_before_update_callbacks.
create or replace function public.complete_callback(p_tenant_id uuid, p_callback_id uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare c public.tenant_callbacks; v_old_status text;
begin
  select * into c from public.tenant_callbacks where id = p_callback_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'CALLBACK_NOT_FOUND'; end if;
  if not exists (select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and tu.accepted_at is not null and u.status = 'active') then raise exception 'CALLBACK_ACTOR_INVALID'; end if;
  if c.status = 'completed' then return jsonb_build_object('id', c.id, 'status', c.status, 'duplicate', true); end if;
  if c.status = 'cancelled' then raise exception 'CALLBACK_NOT_ACTIVE'; end if;
  v_old_status := c.status;
  update public.tenant_callbacks set status = 'completed', completed_at = now(), completed_via = 'manual', updated_at = now() where id = c.id returning * into c;
  insert into public.callback_history (tenant_id, callback_id, lead_id, actor_user_id, action, old_scheduled_at_utc, old_status, new_status, note, via)
  values (p_tenant_id, c.id, c.lead_id, p_actor, 'completed', c.scheduled_at_utc, v_old_status, c.status, c.note, 'manual');
  update public.agent_leads set callback_subtype = null, updated_at = now() where id = c.lead_id and tenant_id = p_tenant_id;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_actor, 'tenant.callback_completed', 'callback', c.id::text, jsonb_build_object('tenantId', p_tenant_id, 'leadId', c.lead_id, 'workItemId', c.work_item_id, 'via', 'manual', 'oldStatus', v_old_status));
  return jsonb_build_object('id', c.id, 'status', c.status, 'work_item_id', c.work_item_id, 'via', 'manual', 'duplicate', false);
end;
$$;

revoke all on function public.complete_callback(uuid, uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.complete_callback(uuid, uuid, uuid) to service_role;

-- ── for the Dialer's serving query (offered, not wired in here) ───────────
-- Who holds a work item while a due callback has handed it back to its agent. Null otherwise, and
-- null once the callback was released to the shared pool.
create or replace function public.callback_work_item_holder(p_tenant_id uuid, p_work_item_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  select cb.assigned_to
    from public.tenant_callbacks cb
   where cb.tenant_id = p_tenant_id
     and cb.work_item_id = p_work_item_id
     and cb.status = 'due'
     and cb.reopened_at is not null
     and cb.released_at is null
   order by cb.scheduled_at_utc desc
   limit 1;
$function$;

revoke all on function public.callback_work_item_holder(uuid, uuid) from public, anon, authenticated;
grant execute on function public.callback_work_item_holder(uuid, uuid) to tenant_app, service_role;

-- Whether a work item is a callback that is due and has not been dialled since it came due (from
-- 15 minutes before). A no-answer keeps the callback open but must not make it tier 2 again on the
-- very next serve: after a dial, the call's own outcome decides when the lead is next served.
create or replace function public.callback_tier_due(p_tenant_id uuid, p_work_item_id uuid, p_now timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  select exists (
    select 1
      from public.tenant_callbacks cb
     where cb.tenant_id = p_tenant_id
       and cb.work_item_id = p_work_item_id
       and cb.status in ('scheduled', 'due')
       and cb.scheduled_at_utc <= p_now
       and not exists (
         select 1 from public.tenant_call_attempts ca
          where ca.tenant_id = p_tenant_id
            and ca.lead_id = cb.lead_id
            and ca.attempted_at >= cb.scheduled_at_utc - interval '15 minutes'
       )
  );
$function$;

revoke all on function public.callback_tier_due(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.callback_tier_due(uuid, uuid, timestamptz) to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_src text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925708500: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'tenant_callbacks'
         and column_name in ('completed_via', 'kept_attempt_id', 'missed_at', 'reopened_at', 'reopened_from', 'released_at', 'in_app_reminded_at')) <> 7 then
    raise exception 'tenant_callbacks is missing a callback-lifecycle column';
  end if;

  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'tenant_call_attempts' and t.tgname = 'tenant_call_attempts_keeps_callback' and not t.tgisinternal) then
    raise exception 'the call-closes-callback trigger is not on tenant_call_attempts';
  end if;
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'tenant_callbacks' and t.tgname = 'tenant_callbacks_replace_open_one' and not t.tgisinternal) then
    raise exception 'the rebook trigger is not on tenant_callbacks';
  end if;
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'tenant_callbacks' and t.tgname = 'tenant_callbacks_before_update_callbacks' and not t.tgisinternal) then
    raise exception 'the work-item return trigger is not on tenant_callbacks';
  end if;

  select pg_get_functiondef('public.complete_callback(uuid, uuid, uuid)'::regprocedure) into v_src;
  if strpos(v_src, 'update public.lead_queue') > 0 then
    raise exception 'Mark done still moves the work item';
  end if;
  if strpos(v_src, 'completed_via = ''manual''') = 0 then
    raise exception 'Mark done is not recorded as manual';
  end if;

  -- The kept window: 15 minutes early is kept, 16 is not; the customer's day bounds the end.
  if not ((timestamptz '2026-09-24 17:45:00+00' >= timestamptz '2026-09-24 18:00:00+00' - interval '15 minutes')
          and not (timestamptz '2026-09-24 17:44:00+00' >= timestamptz '2026-09-24 18:00:00+00' - interval '15 minutes')) then
    raise exception 'kept window arithmetic is wrong';
  end if;
  if (((timestamptz '2026-09-24 18:00:00+00' at time zone 'America/Los_Angeles')::date + 1)::timestamp at time zone 'America/Los_Angeles')
     <> timestamptz '2026-09-25 07:00:00+00' then
    raise exception 'end of the customer''s day is computed in the wrong timezone';
  end if;

  raise notice '20260925708500: a contact on the call keeps the callback; Mark done is manual and leaves the work item alone';
end $$;
