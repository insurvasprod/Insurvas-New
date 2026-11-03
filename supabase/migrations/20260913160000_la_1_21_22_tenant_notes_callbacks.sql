-- LA-1.21 and LA-1.22: move this application's notes and callbacks off the CRM's tables.
--
-- Sixth and seventh applications of the SA-3 rule, after invoices, pipelines, verification_sessions,
-- disposition_flows and provider_calls: where a table name collides, THIS application's table moves
-- and the CRM's is left untouched. Nothing outside this repository changes.
--
-- Both collisions have the same cause as all the others. `create table if not exists` against a name
-- the CRM already owns silently does nothing, so 20260902170000 and 20260902180000 each believed they
-- had created a table and had not. Later `add column if not exists` migrations then grafted this
-- application's columns onto the CRM's rows, which is why both tables currently carry two lineages:
--
--   lead_notes   organization_id, created_by, deleted_by   the CRM's
--                tenant_id, author_user_id, visibility,    ours, added on top
--                edited_at, idempotency_key
--   callbacks    organization_id                           the CRM's
--                tenant_id, work_item_id, idempotency_key  ours, added on top
--
-- What it costs today, which is everything this pair of tasks is worth:
--
--   lead_notes.lead_id REFERENCES leads(id) -- the CRM's lead table, not agent_leads. Every note this
--   application tries to write raises 23503 on lead_notes_lead_id_fkey. verify-lead-notes fails 7 of
--   its checks, all on that one constraint. No lead this application has ever created can have a note.
--
--   callbacks carries the CRM trigger callbacks_audit_write -> audit_callback_write, which writes an
--   audit_logs row. audit_logs.organization_id is NOT NULL and our rows have no organization, so every
--   callback insert dies with "null value in column organization_id of relation audit_logs".
--   verify-callbacks does not fail a check -- it throws during setup and never reaches one.
--
-- Ownership was checked rather than assumed, which is what backlog 179 asked for before choosing a
-- remedy. lead_notes holds 2 rows, both with organization_id set and tenant_id null: the CRM's.
-- callbacks holds 0 rows. So there is no data of ours to migrate on either side, and nothing of
-- theirs to disturb -- the new tables start empty and correct rather than inheriting a merged shape.
--
-- Index names are new. A `create index if not exists callbacks_tenant_due_idx` in the original
-- migration succeeded -- against the CRM's table -- so those index names are taken, and reusing them
-- here would attach this application's indexes to the wrong table a second time. Trigger and policy
-- names are per-table and are reused deliberately, so the two definitions stay easy to compare.

create table if not exists public.tenant_lead_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  author_user_id uuid not null references public.users(id) on delete restrict,
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  visibility text not null default 'internal' check (visibility in ('internal', 'shared')),
  idempotency_key text,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  unique (tenant_id, idempotency_key)
);

-- lead_id now references agent_leads, which is the whole point. author_user_id keeps ON DELETE
-- RESTRICT: the task's own warning is about NOT NULL combined with ON DELETE SET NULL, which is a
-- contradiction that errors at delete time. NOT NULL with RESTRICT is coherent -- a user who has
-- written notes cannot be deleted, and says so.

create table if not exists public.tenant_callbacks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  work_item_id uuid not null references public.lead_queue(id) on delete cascade,
  scheduled_at_utc timestamptz not null,
  customer_timezone text not null check (char_length(btrim(customer_timezone)) between 1 and 100),
  assigned_to uuid not null references public.users(id) on delete restrict,
  note text check (note is null or char_length(btrim(note)) between 1 and 1000),
  status text not null default 'scheduled' check (status in ('scheduled', 'due', 'completed', 'cancelled', 'missed')),
  reminder_sent_at timestamptz,
  completed_at timestamptz,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  idempotency_key text,
  unique (tenant_id, idempotency_key)
);

create index if not exists tenant_lead_notes_tenant_lead_created_idx on public.tenant_lead_notes (tenant_id, lead_id, created_at desc);
create index if not exists tenant_lead_notes_search_idx on public.tenant_lead_notes using gin (to_tsvector('simple', body)) where deleted_at is null;
create index if not exists tenant_callbacks_tenant_due_idx on public.tenant_callbacks (tenant_id, scheduled_at_utc asc) where status in ('scheduled', 'due', 'missed');
create index if not exists tenant_callbacks_assignee_idx on public.tenant_callbacks (tenant_id, assigned_to, scheduled_at_utc asc);
create unique index if not exists tenant_callbacks_active_work_item_idx on public.tenant_callbacks (tenant_id, work_item_id) where status in ('scheduled', 'due');

-- The two child tables are ours already and keep their rows; only the parent they point at moves.
-- callback_history is empty and lead_note_edits has no rows for notes that could never be written,
-- so neither repoint can orphan anything.

alter table public.callback_history drop constraint if exists callback_history_callback_id_fkey;
alter table public.callback_history add constraint callback_history_callback_id_fkey
  foreign key (callback_id) references public.tenant_callbacks(id) on delete cascade;

alter table public.lead_note_edits drop constraint if exists lead_note_edits_note_id_fkey;
alter table public.lead_note_edits add constraint lead_note_edits_note_id_fkey
  foreign key (note_id) references public.tenant_lead_notes(id) on delete cascade;

alter table public.lead_note_mentions drop constraint if exists lead_note_mentions_note_id_fkey;
alter table public.lead_note_mentions add constraint lead_note_mentions_note_id_fkey
  foreign key (note_id) references public.tenant_lead_notes(id) on delete cascade;

-- Row security and grants, copied from the originals so the new tables are no more permissive than
-- the ones they replace.

alter table public.tenant_lead_notes enable row level security;
alter table public.tenant_callbacks enable row level security;

drop policy if exists tenant_lead_notes_tenant_scoped on public.tenant_lead_notes;
create policy tenant_lead_notes_tenant_scoped on public.tenant_lead_notes
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

drop policy if exists tenant_callbacks_tenant_scoped on public.tenant_callbacks;
create policy tenant_callbacks_tenant_scoped on public.tenant_callbacks
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_lead_notes, public.tenant_callbacks from anon, authenticated, public;
grant select on public.tenant_lead_notes to tenant_app;
grant select, insert, update on public.tenant_callbacks to tenant_app;
grant select, insert, update on public.tenant_lead_notes, public.tenant_callbacks to service_role;

-- Every function that named the CRM's callbacks table, repointed. The bodies below are this
-- repository's own, carried over from 20260902180000, 20260902181000 and 20260902182000 with exactly
-- one substitution: public.callbacks -> public.tenant_callbacks. public.callback_history is ours and
-- is deliberately left alone.

create or replace function public.complete_disposition_with_callback(
  p_tenant_id uuid, p_work_item_id uuid, p_user_id uuid, p_walk_id uuid,
  p_callback_local timestamp without time zone, p_customer_timezone text,
  p_assigned_to uuid default null, p_callback_note text default null, p_idempotency_key text default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_item public.lead_queue;
  v_existing public.tenant_callbacks;
  v_callback public.tenant_callbacks;
  v_assignee uuid;
  v_result jsonb;
  v_scheduled_at timestamptz;
begin
  select q.* into v_item from public.lead_queue q
  where q.id = p_work_item_id and q.tenant_id = p_tenant_id and q.owner_user_id = p_user_id
    and q.status in ('claimed', 'completed', 'dropped') for update;
  if not found then raise exception 'DISPOSITION_OWNER_REQUIRED'; end if;

  if p_idempotency_key is not null then
    select c.* into v_existing from public.tenant_callbacks c where c.tenant_id = p_tenant_id and c.idempotency_key = p_idempotency_key;
    if found then return jsonb_build_object('callback_id', v_existing.id, 'scheduled_at_utc', v_existing.scheduled_at_utc, 'status', v_existing.status, 'duplicate', true); end if;
  end if;
  if p_callback_local is null then raise exception 'CALLBACK_DATE_REQUIRED'; end if;
  if not exists (select 1 from pg_timezone_names where name = btrim(p_customer_timezone)) then raise exception 'CALLBACK_TIMEZONE_INVALID'; end if;
  v_scheduled_at := p_callback_local at time zone btrim(p_customer_timezone);
  if v_scheduled_at <= now() then raise exception 'CALLBACK_DATE_PAST'; end if;
  if p_callback_note is not null and (char_length(btrim(p_callback_note)) < 1 or char_length(btrim(p_callback_note)) > 1000) then raise exception 'CALLBACK_NOTE_INVALID'; end if;
  v_assignee := coalesce(p_assigned_to, p_user_id);
  if not exists (
    select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id
    where tu.tenant_id = p_tenant_id and tu.user_id = v_assignee and tu.accepted_at is not null and u.status = 'active'
  ) then raise exception 'CALLBACK_ASSIGNEE_INVALID'; end if;

  v_result := public.complete_disposition(p_tenant_id, p_work_item_id, p_user_id, p_walk_id, 'callback_scheduled', nullif(btrim(p_callback_note), ''));
  insert into public.tenant_callbacks (tenant_id, lead_id, work_item_id, scheduled_at_utc, customer_timezone, assigned_to, note, status, created_by, idempotency_key)
  values (p_tenant_id, v_item.lead_id, v_item.id, v_scheduled_at, btrim(p_customer_timezone), v_assignee, nullif(btrim(p_callback_note), ''), 'scheduled', p_user_id, p_idempotency_key)
  returning * into v_callback;
  insert into public.callback_history (tenant_id, callback_id, lead_id, actor_user_id, action, new_scheduled_at_utc, new_status, note)
  values (p_tenant_id, v_callback.id, v_item.lead_id, p_user_id, 'scheduled', v_callback.scheduled_at_utc, v_callback.status, v_callback.note);
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_user_id, 'tenant.callback_scheduled', 'callback', v_callback.id::text, jsonb_build_object('leadId', v_callback.lead_id, 'workItemId', v_callback.work_item_id, 'scheduledAtUtc', v_callback.scheduled_at_utc, 'customerTimezone', v_callback.customer_timezone));
  return v_result || jsonb_build_object('callback_id', v_callback.id, 'scheduled_at_utc', v_callback.scheduled_at_utc, 'customer_timezone', v_callback.customer_timezone, 'assigned_to', v_callback.assigned_to, 'duplicate', false);
end;
$$;

create or replace function public.reschedule_callback(
  p_tenant_id uuid, p_callback_id uuid, p_actor uuid, p_callback_local timestamp without time zone
)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare c public.tenant_callbacks; v_old timestamptz; v_scheduled_at timestamptz;
begin
  select * into c from public.tenant_callbacks where id = p_callback_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'CALLBACK_NOT_FOUND'; end if;
  if c.status in ('completed', 'cancelled') then raise exception 'CALLBACK_NOT_ACTIVE'; end if;
  if not exists (select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and tu.accepted_at is not null and u.status = 'active') then raise exception 'CALLBACK_ACTOR_INVALID'; end if;
  if p_callback_local is null then raise exception 'CALLBACK_DATE_REQUIRED'; end if;
  v_old := c.scheduled_at_utc;
  v_scheduled_at := p_callback_local at time zone c.customer_timezone;
  if v_scheduled_at <= now() then raise exception 'CALLBACK_DATE_PAST'; end if;
  update public.tenant_callbacks set scheduled_at_utc = v_scheduled_at, status = 'scheduled', reminder_sent_at = null, updated_at = now() where id = c.id returning * into c;
  insert into public.callback_history (tenant_id, callback_id, lead_id, actor_user_id, action, old_scheduled_at_utc, new_scheduled_at_utc, old_status, new_status, note)
  values (p_tenant_id, c.id, c.lead_id, p_actor, 'rescheduled', v_old, c.scheduled_at_utc, 'scheduled', c.status, c.note);
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_actor, 'tenant.callback_rescheduled', 'callback', c.id::text, jsonb_build_object('leadId', c.lead_id, 'scheduledAtUtc', c.scheduled_at_utc));
  return jsonb_build_object('id', c.id, 'scheduled_at_utc', c.scheduled_at_utc, 'status', c.status, 'customer_timezone', c.customer_timezone);
end;
$$;

create or replace function public.cancel_callback(p_tenant_id uuid, p_callback_id uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare c public.tenant_callbacks;
begin
  select * into c from public.tenant_callbacks where id = p_callback_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'CALLBACK_NOT_FOUND'; end if;
  if not exists (select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and tu.accepted_at is not null and u.status = 'active') then raise exception 'CALLBACK_ACTOR_INVALID'; end if;
  if c.status = 'completed' then raise exception 'CALLBACK_ALREADY_COMPLETED'; end if;
  if c.status = 'cancelled' then return jsonb_build_object('id', c.id, 'status', c.status, 'duplicate', true); end if;
  update public.tenant_callbacks set status = 'cancelled', updated_at = now() where id = c.id returning * into c;
  insert into public.callback_history (tenant_id, callback_id, lead_id, actor_user_id, action, old_scheduled_at_utc, old_status, new_status, note)
  values (p_tenant_id, c.id, c.lead_id, p_actor, 'cancelled', c.scheduled_at_utc, 'scheduled', c.status, c.note);
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_actor, 'tenant.callback_cancelled', 'callback', c.id::text, jsonb_build_object('leadId', c.lead_id));
  return jsonb_build_object('id', c.id, 'status', c.status, 'duplicate', false);
end;
$$;

create or replace function public.complete_callback(p_tenant_id uuid, p_callback_id uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare c public.tenant_callbacks; q public.lead_queue;
begin
  select * into c from public.tenant_callbacks where id = p_callback_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'CALLBACK_NOT_FOUND'; end if;
  if not exists (select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and tu.accepted_at is not null and u.status = 'active') then raise exception 'CALLBACK_ACTOR_INVALID'; end if;
  if c.status = 'completed' then return jsonb_build_object('id', c.id, 'status', c.status, 'duplicate', true); end if;
  if c.status = 'cancelled' then raise exception 'CALLBACK_NOT_ACTIVE'; end if;
  update public.tenant_callbacks set status = 'completed', completed_at = now(), updated_at = now() where id = c.id returning * into c;
  insert into public.callback_history (tenant_id, callback_id, lead_id, actor_user_id, action, old_scheduled_at_utc, old_status, new_status, note)
  values (p_tenant_id, c.id, c.lead_id, p_actor, 'completed', c.scheduled_at_utc, 'scheduled', c.status, c.note);
  update public.lead_queue set status = 'unclaimed', owner_user_id = null, owner_role = null, claimed_by = null, claimed_at = null, disposition = null, disposition_at = null, disposition_by = null, updated_at = now()
  where id = c.work_item_id and tenant_id = p_tenant_id and status in ('completed', 'dropped') returning * into q;
  update public.agent_leads set callback_subtype = null, updated_at = now() where id = c.lead_id and tenant_id = p_tenant_id;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_actor, 'tenant.callback_completed', 'callback', c.id::text, jsonb_build_object('leadId', c.lead_id, 'workItemId', c.work_item_id, 'reopened', q.id is not null));
  return jsonb_build_object('id', c.id, 'status', c.status, 'work_item_id', c.work_item_id, 'reopened', q.id is not null, 'duplicate', false);
end;
$$;

create or replace function public.claim_callback_reminders(p_now timestamptz, p_until timestamptz, p_limit integer default 100)
returns setof public.tenant_callbacks language plpgsql security definer set search_path = public, pg_catalog as $$
declare c public.tenant_callbacks;
begin
  for c in select * from public.tenant_callbacks where status = 'scheduled' and reminder_sent_at is null and scheduled_at_utc > p_now and scheduled_at_utc <= p_until order by scheduled_at_utc for update skip locked limit greatest(1, least(p_limit, 500)) loop
    update public.tenant_callbacks set reminder_sent_at = p_now, updated_at = p_now where id = c.id returning * into c;
    return next c;
  end loop;
end;
$$;

create or replace function public.enforce_callback_assignee_role()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if not exists (
    select 1
    from public.tenant_users tu
    join public.users u on u.id = tu.user_id
    where tu.tenant_id = new.tenant_id
      and tu.user_id = new.assigned_to
      and tu.role in ('owner', 'producer', 'assistant')
      and tu.accepted_at is not null
      and u.status = 'active'
  ) then
    raise exception 'CALLBACK_ASSIGNEE_ROLE_INVALID';
  end if;
  return new;
end;
$$;

revoke all on function public.complete_disposition_with_callback(uuid, uuid, uuid, uuid, timestamp without time zone, text, uuid, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.complete_disposition_with_callback(uuid, uuid, uuid, uuid, timestamp without time zone, text, uuid, text, text) to service_role;
revoke all on function public.reschedule_callback(uuid, uuid, uuid, timestamp without time zone), public.cancel_callback(uuid, uuid, uuid), public.complete_callback(uuid, uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.reschedule_callback(uuid, uuid, uuid, timestamp without time zone), public.cancel_callback(uuid, uuid, uuid), public.complete_callback(uuid, uuid, uuid) to service_role;
revoke all on function public.claim_callback_reminders(timestamptz, timestamptz, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.claim_callback_reminders(timestamptz, timestamptz, integer) to service_role;
revoke all on function public.enforce_callback_assignee_role() from public, anon, authenticated, tenant_app;

-- Both triggers move to the new table. The guard is the one that matters: 20260913130000 restored
-- callbacks_assignee_role after finding it missing, and it is the only trigger in that set that fails
-- OPEN -- absent, a callback assigned to a role that may not take one is simply accepted.

drop trigger if exists tenant_callbacks_touch_updated_at on public.tenant_callbacks;
create trigger tenant_callbacks_touch_updated_at before update on public.tenant_callbacks
for each row execute function public.touch_callback_updated_at();

drop trigger if exists callbacks_assignee_role on public.tenant_callbacks;
create trigger callbacks_assignee_role
before insert or update of tenant_id, assigned_to on public.tenant_callbacks
for each row execute function public.enforce_callback_assignee_role();

do $$
declare
  missing text;
begin
  -- The new tables exist and point where they must.
  if to_regclass('public.tenant_lead_notes') is null then raise exception 'tenant_lead_notes was not created'; end if;
  if to_regclass('public.tenant_callbacks') is null then raise exception 'tenant_callbacks was not created'; end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tenant_lead_notes'::regclass and contype = 'f'
      and confrelid = 'public.agent_leads'::regclass
  ) then
    raise exception 'tenant_lead_notes.lead_id does not reference agent_leads -- the defect this migration exists to fix';
  end if;

  -- The children follow the parent.
  if (select confrelid from pg_constraint where conname = 'callback_history_callback_id_fkey') <> 'public.tenant_callbacks'::regclass then
    raise exception 'callback_history still points at the CRM callbacks table';
  end if;
  if (select confrelid from pg_constraint where conname = 'lead_note_edits_note_id_fkey') <> 'public.tenant_lead_notes'::regclass then
    raise exception 'lead_note_edits still points at the CRM lead_notes table';
  end if;

  -- Both triggers are attached HERE. Asserting this by name is deliberate: four separate times in
  -- this module a function has survived a migration while its trigger did not, and the resulting
  -- code reads as wired and runs for nothing.
  select string_agg(t.name, ', ') into missing
  from unnest(array['tenant_callbacks_touch_updated_at', 'callbacks_assignee_role']) as t(name)
  where not exists (
    select 1 from pg_trigger g
    where g.tgname = t.name and g.tgrelid = 'public.tenant_callbacks'::regclass and not g.tgisinternal
  );
  if missing is not null then raise exception 'trigger(s) missing on tenant_callbacks: %', missing; end if;

  -- And the CRM's tables are exactly as they were. This migration must not have touched them.
  if to_regclass('public.callbacks') is null or to_regclass('public.lead_notes') is null then
    raise exception 'a CRM table disappeared -- this migration must only add';
  end if;
  -- Do not assert a fixture row count here. This migration is checked through a restricted
  -- connection, where RLS can hide legacy rows, and the CRM may legitimately add rows later.
  -- Stable ownership markers prove that the legacy table was not replaced or repointed without
  -- coupling the migration to mutable data.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lead_notes'
      and column_name = 'organization_id'
  ) then
    raise exception 'the CRM lead_notes ownership marker is missing';
  end if;
  if not exists (
    select 1 from pg_trigger g where g.tgname = 'callbacks_audit_write'
      and g.tgrelid = 'public.callbacks'::regclass and not g.tgisinternal
  ) then
    raise exception 'the CRM callbacks_audit_write trigger was removed -- out of scope for this repository';
  end if;
end;
$$;
