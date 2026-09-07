-- LA-1.23: one durable clock for unclaimed lead warnings, escalation, partner notice and expiry.
-- The scheduler is intentionally service-role-only. Agent requests can claim the same row, but
-- cannot advance or forge SLA state. Every transition has a marker, an outbox row and an audit row.

alter table public.lead_queue
  drop constraint if exists lead_queue_status_check;
alter table public.lead_queue
  add constraint lead_queue_status_check
  check (status in ('unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active', 'completed', 'closed', 'dropped', 'expired'));

alter table public.lead_queue
  add column if not exists sla_warned_at timestamptz,
  add column if not exists sla_escalated_at timestamptz,
  add column if not exists sla_partner_notified_at timestamptz,
  add column if not exists sla_expired_at timestamptz;

create table if not exists public.tenant_queue_sla_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  warn_after_seconds integer not null default 45,
  escalate_after_seconds integer not null default 120,
  partner_notify_after_seconds integer not null default 300,
  expire_after_seconds integer not null default 14400,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_queue_sla_settings_positive check (
    warn_after_seconds > 0 and escalate_after_seconds > warn_after_seconds
    and partner_notify_after_seconds > escalate_after_seconds
    and expire_after_seconds > partner_notify_after_seconds
  )
);

create table if not exists public.lead_sla_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  work_item_id uuid not null references public.lead_queue(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  partner_id uuid references public.partners(id) on delete set null,
  rung text not null check (rung in ('warn', 'escalate', 'partner', 'expire')),
  occurred_at timestamptz not null default now(),
  claimed_at timestamptz,
  processed_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  unique (work_item_id, rung)
);

create index if not exists lead_sla_events_pending_idx
  on public.lead_sla_events (created_at asc) where processed_at is null;
create index if not exists lead_queue_sla_due_idx
  on public.lead_queue (status, queued_at asc) where status = 'unclaimed';

alter table public.tenant_queue_sla_settings enable row level security;
alter table public.lead_sla_events enable row level security;

drop policy if exists tenant_queue_sla_settings_scoped on public.tenant_queue_sla_settings;
create policy tenant_queue_sla_settings_scoped on public.tenant_queue_sla_settings
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists lead_sla_events_scoped on public.lead_sla_events;
create policy lead_sla_events_scoped on public.lead_sla_events
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_queue_sla_settings, public.lead_sla_events from anon, authenticated, public;
grant select on public.tenant_queue_sla_settings, public.lead_sla_events to tenant_app;
grant select, insert, update on public.tenant_queue_sla_settings, public.lead_sla_events to service_role;

create or replace function public.update_tenant_queue_sla_settings(
  p_tenant_id uuid, p_actor uuid, p_warn integer, p_escalate integer,
  p_partner integer, p_expire integer
)
returns public.tenant_queue_sla_settings
language plpgsql security definer set search_path = public, pg_catalog as $$
declare result public.tenant_queue_sla_settings;
begin
  if not exists (
    select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id
    where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and tu.role = 'owner'
      and tu.accepted_at is not null and u.status = 'active'
  ) then raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED'; end if;
  if p_warn is null or p_escalate is null or p_partner is null or p_expire is null
     or p_escalate <= p_warn or p_partner <= p_escalate or p_expire <= p_partner
     or p_warn < 1 or p_expire > 604800 then
    raise exception using errcode = '22023', message = 'INVALID_SLA_THRESHOLDS';
  end if;
  insert into public.tenant_queue_sla_settings
    (tenant_id, warn_after_seconds, escalate_after_seconds, partner_notify_after_seconds, expire_after_seconds, updated_by, updated_at)
  values (p_tenant_id, p_warn, p_escalate, p_partner, p_expire, p_actor, now())
  on conflict (tenant_id) do update set
    warn_after_seconds = excluded.warn_after_seconds,
    escalate_after_seconds = excluded.escalate_after_seconds,
    partner_notify_after_seconds = excluded.partner_notify_after_seconds,
    expire_after_seconds = excluded.expire_after_seconds,
    updated_by = excluded.updated_by,
    updated_at = now()
  returning * into result;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_actor, 'tenant.queue_sla_settings_updated', 'tenant_queue_sla_settings', p_tenant_id::text,
    jsonb_build_object('warn', p_warn, 'escalate', p_escalate, 'partner', p_partner, 'expire', p_expire));
  return result;
end;
$$;

create or replace function public.run_unclaimed_sla(p_now timestamptz default now(), p_limit integer default 500)
returns table (event_id uuid, tenant_id uuid, work_item_id uuid, lead_id uuid, partner_id uuid, rung text, occurred_at timestamptz)
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  item record; v_age integer; v_id uuid;
  v_warn integer; v_escalate integer; v_partner integer; v_expire integer;
begin
  for item in
    select q.*,
      coalesce(s.warn_after_seconds, 45) as warn_after,
      coalesce(s.escalate_after_seconds, 120) as escalate_after,
      coalesce(s.partner_notify_after_seconds, 300) as partner_after,
      coalesce(s.expire_after_seconds, 14400) as expire_after
    from public.lead_queue q
    left join public.tenant_queue_sla_settings s on s.tenant_id = q.tenant_id
    where q.status = 'unclaimed'
    order by q.queued_at asc
    limit greatest(1, least(coalesce(p_limit, 500), 1000))
    for update of q skip locked
  loop
    v_age := greatest(0, floor(extract(epoch from (p_now - item.queued_at)))::integer);
    v_warn := item.warn_after; v_escalate := item.escalate_after;
    v_partner := item.partner_after; v_expire := item.expire_after;

    if v_age >= v_warn and item.sla_warned_at is null then
      update public.lead_queue set sla_warned_at = p_now where id = item.id and status = 'unclaimed';
      v_id := null;
      insert into public.lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at)
      values (item.tenant_id, item.id, item.lead_id, item.partner_id, 'warn', p_now)
      on conflict (work_item_id, rung) do nothing returning id into v_id;
      insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
      values ('system', 'tenant.lead_sla_warned', 'lead_queue', item.id::text, jsonb_build_object('ageSeconds', v_age, 'thresholdSeconds', v_warn));
      if v_id is not null then return query select v_id, item.tenant_id, item.id, item.lead_id, item.partner_id, 'warn'::text, p_now; end if;
    end if;
    if v_age >= v_escalate and item.sla_escalated_at is null then
      update public.lead_queue set sla_escalated_at = p_now where id = item.id and status = 'unclaimed';
      v_id := null;
      insert into public.lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at)
      values (item.tenant_id, item.id, item.lead_id, item.partner_id, 'escalate', p_now)
      on conflict (work_item_id, rung) do nothing returning id into v_id;
      insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
      values ('system', 'tenant.lead_sla_escalated', 'lead_queue', item.id::text, jsonb_build_object('ageSeconds', v_age, 'thresholdSeconds', v_escalate));
      if v_id is not null then return query select v_id, item.tenant_id, item.id, item.lead_id, item.partner_id, 'escalate'::text, p_now; end if;
    end if;
    if v_age >= v_partner and item.sla_partner_notified_at is null then
      update public.lead_queue set sla_partner_notified_at = p_now where id = item.id and status = 'unclaimed';
      v_id := null;
      insert into public.lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at)
      values (item.tenant_id, item.id, item.lead_id, item.partner_id, 'partner', p_now)
      on conflict (work_item_id, rung) do nothing returning id into v_id;
      insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
      values ('system', 'tenant.lead_sla_partner_notified', 'lead_queue', item.id::text, jsonb_build_object('ageSeconds', v_age, 'thresholdSeconds', v_partner));
      if v_id is not null then return query select v_id, item.tenant_id, item.id, item.lead_id, item.partner_id, 'partner'::text, p_now; end if;
    end if;
    if v_age >= v_expire and item.sla_expired_at is null then
      update public.lead_queue set status = 'expired', sla_expired_at = p_now where id = item.id and status = 'unclaimed';
      if found then
        v_id := null;
        insert into public.lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at)
        values (item.tenant_id, item.id, item.lead_id, item.partner_id, 'expire', p_now)
        on conflict (work_item_id, rung) do nothing returning id into v_id;
        insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
        values ('system', 'tenant.lead_sla_expired', 'lead_queue', item.id::text, jsonb_build_object('ageSeconds', v_age, 'thresholdSeconds', v_expire));
        if v_id is not null then return query select v_id, item.tenant_id, item.id, item.lead_id, item.partner_id, 'expire'::text, p_now; end if;
      end if;
    end if;
  end loop;
end;
$$;

create or replace function public.claim_unclaimed_sla_events(p_limit integer default 500)
returns setof public.lead_sla_events language plpgsql security definer set search_path = public, pg_catalog as $$
declare e public.lead_sla_events;
begin
  for e in select * from public.lead_sla_events
    where processed_at is null and (claimed_at is null or claimed_at < now() - interval '10 minutes')
    order by created_at asc for update skip locked limit greatest(1, least(coalesce(p_limit, 500), 1000)) loop
    update public.lead_sla_events set claimed_at = now(), attempts = attempts + 1 where id = e.id returning * into e;
    return next e;
  end loop;
end;
$$;

create or replace function public.reopen_expired_lead(p_tenant_id uuid, p_work_item_id uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare q public.lead_queue;
begin
  if not exists (select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id
    where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and tu.accepted_at is not null and u.status = 'active'
      and tu.role in ('owner', 'producer', 'assistant')) then raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED'; end if;
  select * into q from public.lead_queue where id = p_work_item_id and tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'WORK_ITEM_NOT_FOUND'; end if;
  if q.status = 'unclaimed' then return jsonb_build_object('id', q.id, 'status', q.status, 'duplicate', true); end if;
  if q.status <> 'expired' then raise exception using errcode = 'P0001', message = 'LEAD_NOT_EXPIRED'; end if;
  update public.lead_queue set status = 'unclaimed', queued_at = now(), sla_warned_at = null,
    sla_escalated_at = null, sla_partner_notified_at = null, sla_expired_at = null, updated_at = now()
    where id = q.id returning * into q;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
    values ('tenant', p_actor, 'tenant.lead_sla_reopened', 'lead_queue', q.id::text, jsonb_build_object('leadId', q.lead_id));
  return jsonb_build_object('id', q.id, 'status', q.status, 'queued_at', q.queued_at, 'duplicate', false);
end;
$$;

revoke all on function public.update_tenant_queue_sla_settings(uuid, uuid, integer, integer, integer, integer), public.run_unclaimed_sla(timestamptz, integer), public.claim_unclaimed_sla_events(integer), public.reopen_expired_lead(uuid, uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.update_tenant_queue_sla_settings(uuid, uuid, integer, integer, integer, integer), public.run_unclaimed_sla(timestamptz, integer), public.claim_unclaimed_sla_events(integer), public.reopen_expired_lead(uuid, uuid, uuid) to service_role;
