-- LA-1.22: callback scheduling. The instant is UTC; customer_timezone preserves the display rule.

create table if not exists public.callbacks (
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

create table if not exists public.callback_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  callback_id uuid not null references public.callbacks(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  action text not null check (action in ('scheduled', 'rescheduled', 'cancelled', 'completed', 'missed')),
  old_scheduled_at_utc timestamptz,
  new_scheduled_at_utc timestamptz,
  old_status text,
  new_status text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists callbacks_tenant_due_idx on public.callbacks (tenant_id, scheduled_at_utc asc) where status in ('scheduled', 'due', 'missed');
create index if not exists callbacks_assignee_idx on public.callbacks (tenant_id, assigned_to, scheduled_at_utc asc);
create index if not exists callback_history_callback_idx on public.callback_history (tenant_id, callback_id, created_at asc);
create unique index if not exists callbacks_active_work_item_idx on public.callbacks (tenant_id, work_item_id) where status in ('scheduled', 'due');

create or replace function public.touch_callback_updated_at()
returns trigger language plpgsql security invoker set search_path = public, pg_catalog as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists callbacks_touch_updated_at on public.callbacks;
create trigger callbacks_touch_updated_at before update on public.callbacks for each row execute function public.touch_callback_updated_at();

alter table public.callbacks enable row level security;
alter table public.callback_history enable row level security;
drop policy if exists callbacks_tenant_scoped on public.callbacks;
create policy callbacks_tenant_scoped on public.callbacks for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists callback_history_tenant_scoped on public.callback_history;
create policy callback_history_tenant_scoped on public.callback_history for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.callbacks, public.callback_history from anon, authenticated, public;
grant select, insert, update on public.callbacks to tenant_app;
grant select on public.callback_history to tenant_app;
grant select, insert, update on public.callbacks, public.callback_history to service_role;

-- Completes the existing disposition and schedules its callback in one transaction.
create or replace function public.complete_disposition_with_callback(
  p_tenant_id uuid, p_work_item_id uuid, p_user_id uuid, p_walk_id uuid,
  p_callback_local timestamp without time zone, p_customer_timezone text,
  p_assigned_to uuid default null, p_callback_note text default null, p_idempotency_key text default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_item public.lead_queue;
  v_existing public.callbacks;
  v_callback public.callbacks;
  v_assignee uuid;
  v_result jsonb;
  v_scheduled_at timestamptz;
begin
  select q.* into v_item from public.lead_queue q
  where q.id = p_work_item_id and q.tenant_id = p_tenant_id and q.owner_user_id = p_user_id
    and q.status in ('claimed', 'completed', 'dropped') for update;
  if not found then raise exception 'DISPOSITION_OWNER_REQUIRED'; end if;

  if p_idempotency_key is not null then
    select c.* into v_existing from public.callbacks c where c.tenant_id = p_tenant_id and c.idempotency_key = p_idempotency_key;
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
  insert into public.callbacks (tenant_id, lead_id, work_item_id, scheduled_at_utc, customer_timezone, assigned_to, note, status, created_by, idempotency_key)
  values (p_tenant_id, v_item.lead_id, v_item.id, v_scheduled_at, btrim(p_customer_timezone), v_assignee, nullif(btrim(p_callback_note), ''), 'scheduled', p_user_id, p_idempotency_key)
  returning * into v_callback;
  insert into public.callback_history (tenant_id, callback_id, lead_id, actor_user_id, action, new_scheduled_at_utc, new_status, note)
  values (p_tenant_id, v_callback.id, v_item.lead_id, p_user_id, 'scheduled', v_callback.scheduled_at_utc, v_callback.status, v_callback.note);
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_user_id, 'tenant.callback_scheduled', 'callback', v_callback.id::text, jsonb_build_object('leadId', v_callback.lead_id, 'workItemId', v_callback.work_item_id, 'scheduledAtUtc', v_callback.scheduled_at_utc, 'customerTimezone', v_callback.customer_timezone));
  return v_result || jsonb_build_object('callback_id', v_callback.id, 'scheduled_at_utc', v_callback.scheduled_at_utc, 'customer_timezone', v_callback.customer_timezone, 'assigned_to', v_callback.assigned_to, 'duplicate', false);
end;
$$;

revoke all on function public.complete_disposition_with_callback(uuid, uuid, uuid, uuid, timestamp without time zone, text, uuid, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.complete_disposition_with_callback(uuid, uuid, uuid, uuid, timestamp without time zone, text, uuid, text, text) to service_role;
