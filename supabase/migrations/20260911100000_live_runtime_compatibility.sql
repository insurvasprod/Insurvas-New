-- Live runtime compatibility for the tenant application.
--
-- The connected project contains the tenant shell and the older organization-era
-- partner tables, but not the later LA runtime tables.  Keep this migration
-- additive: do not rewrite organization rows or change the existing tenant
-- bridge.  New runtime records are tenant-scoped and are only reachable through
-- service-role read models or the tenant_app policies below.

create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  product_code text not null references public.products(code) on delete restrict,
  version integer not null default 1 check (version > 0),
  description text,
  is_active boolean not null default true,
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists templates_product_version_compat_idx
  on public.templates (product_code, version);

insert into public.templates (name, product_code, version, description)
select 'Term Life intake', 'term_life', 1, 'Compatibility template for tenant lead intake'
where exists (select 1 from public.products where code = 'term_life')
  and not exists (select 1 from public.templates where product_code = 'term_life' and version = 1);

create table if not exists public.agent_leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  template_id uuid not null references public.templates(id) on delete restrict,
  template_version integer not null default 1 check (template_version > 0),
  tenant_template_id uuid,
  stage_key text not null default 'new',
  values jsonb not null default '{}'::jsonb check (jsonb_typeof(values) = 'object'),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  product_line text not null default 'term_life' references public.products(code) on delete restrict,
  partner_id uuid references public.partners(id) on delete set null,
  submission_id uuid,
  definition_version integer not null default 1 check (definition_version > 0),
  pipeline_id uuid,
  stage_id uuid,
  screening_outcome text,
  screening_warning text,
  duplicate_override_justification text,
  preflight_status text not null default 'unchecked',
  preflight_result jsonb not null default '{}'::jsonb,
  callback_subtype text,
  affiliate_campaign text,
  created_at_local date
);

create index if not exists agent_leads_tenant_created_compat_idx
  on public.agent_leads (tenant_id, created_at desc);
create index if not exists agent_leads_partner_created_compat_idx
  on public.agent_leads (tenant_id, partner_id, created_at desc);
create unique index if not exists agent_leads_partner_submission_compat_idx
  on public.agent_leads (tenant_id, partner_id, submission_id)
  where partner_id is not null and submission_id is not null;

create table if not exists public.lead_queue (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  partner_id uuid references public.partners(id) on delete restrict,
  product_line text not null references public.products(code) on delete restrict,
  stage_key text not null default 'new',
  pipeline_id uuid,
  stage_id uuid,
  status text not null default 'unclaimed',
  claimed_by uuid references public.users(id) on delete set null,
  owner_user_id uuid references public.users(id) on delete set null,
  owner_role text,
  claimed_at timestamptz,
  queued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disposition text,
  disposition_at timestamptz,
  disposition_by uuid references public.users(id) on delete set null,
  submission_id uuid,
  screening_outcome text,
  screening_warning text,
  sla_warned_at timestamptz,
  sla_escalated_at timestamptz,
  sla_partner_notified_at timestamptz,
  sla_expired_at timestamptz,
  affiliate_campaign text,
  unique (lead_id)
);

create index if not exists lead_queue_tenant_status_compat_idx
  on public.lead_queue (tenant_id, status, queued_at);
create index if not exists lead_queue_partner_compat_idx
  on public.lead_queue (tenant_id, partner_id, queued_at desc);

create table if not exists public.deal_flow (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  partner_id uuid references public.partners(id) on delete restrict,
  product_line text not null references public.products(code) on delete restrict,
  stage_key text not null default 'new',
  pipeline_id uuid,
  stage_id uuid,
  submission_id uuid,
  insured_name text,
  phone text,
  initial_quote text,
  tracking_id text,
  local_date date not null default current_date,
  call_result text,
  notes text,
  disposition_at timestamptz,
  disposition_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id)
);

create table if not exists public.agent_lead_import_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  idempotency_key text not null,
  created_by uuid not null references public.users(id) on delete restrict,
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  response jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, idempotency_key)
);

create table if not exists public.agent_notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  recipient_user_id uuid not null references public.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  link text not null default '/app/inbound',
  source_key text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (tenant_id, recipient_user_id, source_key)
);

create index if not exists agent_notifications_recipient_compat_idx
  on public.agent_notifications (tenant_id, recipient_user_id, created_at desc);

create table if not exists public.agent_notification_settings (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  enabled_events jsonb not null default '{"new_lead":true,"handoff_offered":true,"unclaimed_escalation":true,"callback_due":true,"mentioned":true,"partner_message":true}'::jsonb,
  do_not_disturb boolean not null default false,
  sound_muted boolean not null default false,
  sound_volume smallint not null default 70 check (sound_volume between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create table if not exists public.partner_channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  partner_id uuid references public.partners(id) on delete restrict,
  channel_type text not null default 'partner' check (channel_type in ('partner', 'direct', 'group')),
  name text not null default 'Partner channel',
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  direct_key text,
  unique (tenant_id, partner_id, channel_type)
);

create unique index if not exists partner_channels_direct_compat_idx
  on public.partner_channels (tenant_id, direct_key)
  where channel_type = 'direct' and direct_key is not null;

create table if not exists public.partner_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  partner_id uuid references public.partners(id) on delete restrict,
  channel_id uuid references public.partner_channels(id) on delete cascade,
  work_item_id uuid references public.lead_queue(id) on delete cascade,
  message text not null,
  message_kind text not null default 'text' check (message_kind in ('text', 'system_card')),
  card_type text,
  card_payload jsonb not null default '{}'::jsonb,
  event_key text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists partner_messages_channel_compat_idx
  on public.partner_messages (tenant_id, channel_id, created_at desc);

create table if not exists public.partner_channel_members (
  channel_id uuid not null references public.partner_channels(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create index if not exists partner_channel_members_tenant_user_compat_idx
  on public.partner_channel_members (tenant_id, user_id, created_at desc);

alter table public.templates enable row level security;
alter table public.agent_leads enable row level security;
alter table public.lead_queue enable row level security;
alter table public.deal_flow enable row level security;
alter table public.agent_lead_import_batches enable row level security;
alter table public.agent_notifications enable row level security;
alter table public.agent_notification_settings enable row level security;
alter table public.partner_channels enable row level security;
alter table public.partner_messages enable row level security;
alter table public.partner_channel_members enable row level security;

drop policy if exists agent_leads_tenant_compat on public.agent_leads;
create policy agent_leads_tenant_compat on public.agent_leads for all to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
drop policy if exists lead_queue_tenant_compat on public.lead_queue;
create policy lead_queue_tenant_compat on public.lead_queue for all to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
drop policy if exists deal_flow_tenant_compat on public.deal_flow;
create policy deal_flow_tenant_compat on public.deal_flow for all to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
drop policy if exists import_batches_tenant_compat on public.agent_lead_import_batches;
create policy import_batches_tenant_compat on public.agent_lead_import_batches for all to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
drop policy if exists notifications_user_compat on public.agent_notifications;
create policy notifications_user_compat on public.agent_notifications for all to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and recipient_user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and recipient_user_id = nullif(current_setting('app.user_id', true), '')::uuid);
drop policy if exists notification_settings_user_compat on public.agent_notification_settings;
create policy notification_settings_user_compat on public.agent_notification_settings for all to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid and user_id = nullif(current_setting('app.user_id', true), '')::uuid);
drop policy if exists channels_tenant_compat on public.partner_channels;
create policy channels_tenant_compat on public.partner_channels for all to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
drop policy if exists messages_tenant_compat on public.partner_messages;
create policy messages_tenant_compat on public.partner_messages for all to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
drop policy if exists channel_members_tenant_compat on public.partner_channel_members;
create policy channel_members_tenant_compat on public.partner_channel_members for all to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

revoke all on public.templates, public.agent_leads, public.lead_queue, public.deal_flow,
  public.agent_lead_import_batches, public.agent_notifications, public.agent_notification_settings,
  public.partner_channels, public.partner_messages, public.partner_channel_members
  from anon, authenticated, public;
grant select, insert, update, delete on public.agent_leads, public.lead_queue, public.deal_flow,
  public.agent_lead_import_batches, public.agent_notifications, public.agent_notification_settings,
  public.partner_channels, public.partner_messages, public.partner_channel_members to service_role;
grant select, insert, update on public.agent_lead_import_batches to tenant_app;
grant select, insert, update on public.agent_notifications, public.agent_notification_settings to tenant_app;
grant select, insert, update, delete on public.agent_leads, public.lead_queue, public.deal_flow,
  public.partner_channels, public.partner_messages, public.partner_channel_members to tenant_app;

create or replace function public.list_transfer_inbox(
  p_tenant_id uuid,
  p_status text default 'unclaimed',
  p_partner_id uuid default null,
  p_product_line text default null,
  p_state text default null,
  p_screening_outcome text default null,
  p_claimed_by uuid default null
)
returns table (
  id uuid, lead_id uuid, partner_id uuid, partner_name text, product_line text, status text,
  owner_user_id uuid, owner_name text, claimed_at timestamptz, queued_at timestamptz,
  wait_seconds integer, customer text, age text, state text, screening_outcome text,
  screening_warning text, duplicate_warning boolean, preflight_status text, preflight_result jsonb
)
language sql security definer set search_path = public, pg_catalog
as $$
  select q.id, q.lead_id, q.partner_id, coalesce(p.name, 'Unassigned partner'), q.product_line,
    q.status, coalesce(q.owner_user_id, q.claimed_by), u.name, q.claimed_at, q.queued_at,
    greatest(0, floor(extract(epoch from (now() - q.queued_at)))::integer),
    coalesce(nullif(btrim(l.values->>'full_name'), ''), nullif(btrim(l.values->>'name'), ''),
      nullif(btrim(concat_ws(' ', l.values->>'first_name', l.values->>'last_name')), ''), 'Unnamed customer'),
    coalesce(nullif(btrim(l.values->>'age'), ''), '—'),
    coalesce(nullif(btrim(l.values->>'state'), ''), nullif(btrim(l.values->>'state_code'), ''), '—'),
    coalesce(nullif(btrim(q.screening_outcome), ''), nullif(btrim(l.screening_outcome), ''), 'not_checked'),
    coalesce(q.screening_warning, l.screening_warning),
    coalesce((l.values->>'duplicate_warning')::boolean, false), l.preflight_status, l.preflight_result
  from public.lead_queue q
  join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
  left join public.partners p on p.id = q.partner_id and p.tenant_id = q.tenant_id
  left join public.users u on u.id = coalesce(q.owner_user_id, q.claimed_by)
  where q.tenant_id = p_tenant_id
    and (p_status = 'all' or q.status = p_status)
    and (p_partner_id is null or q.partner_id = p_partner_id)
    and (p_product_line is null or q.product_line = p_product_line)
    and (p_claimed_by is null or coalesce(q.owner_user_id, q.claimed_by) = p_claimed_by)
    and (p_state is null or coalesce(l.values->>'state', l.values->>'state_code') = p_state)
    and (p_screening_outcome is null or coalesce(q.screening_outcome, l.screening_outcome, 'not_checked') = p_screening_outcome)
  order by q.queued_at asc limit 500;
$$;
revoke all on function public.list_transfer_inbox(uuid, text, uuid, text, text, text, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.list_transfer_inbox(uuid, text, uuid, text, text, text, uuid) to service_role;

create or replace function public.list_buffer_handoffs(p_tenant_id uuid, p_licensed_agent_id uuid)
returns table (id uuid, work_item_id uuid, buffer_user_id uuid, buffer_name text, product_line text,
  customer text, progress_percentage integer, verification_session_id uuid, offered_at timestamptz, expires_at timestamptz)
language sql security definer set search_path = public, pg_catalog
as $$
  select null::uuid, null::uuid, null::uuid, null::text, null::text, null::text,
    null::integer, null::uuid, null::timestamptz, null::timestamptz where false;
$$;
revoke all on function public.list_buffer_handoffs(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.list_buffer_handoffs(uuid, uuid) to service_role;

create or replace function public.partner_lead_pipeline_page(
  p_tenant_id uuid, p_partner_id uuid, p_date_from date default null, p_date_to date default null,
  p_closer_id uuid default null, p_product text default null, p_stage_id uuid default null,
  p_outcome text default null, p_timezone text default 'UTC', p_limit integer default 250, p_offset integer default 0
)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$
  with filtered as (
    select q.*, l.values, l.created_at as submitted_at, l.created_by as submitted_by_id,
      coalesce(u.name, 'Partner closer') as submitted_by_name,
      coalesce(nullif(btrim(l.values->>'full_name'), ''), nullif(btrim(concat_ws(' ', l.values->>'first_name', l.values->>'last_name')), ''), nullif(btrim(l.values->>'name'), ''), 'Unnamed lead') as customer
    from public.lead_queue q join public.agent_leads l on l.id=q.lead_id and l.tenant_id=q.tenant_id
    left join public.users u on u.id=l.created_by
    where q.tenant_id=p_tenant_id and q.partner_id=p_partner_id
      and (p_date_from is null or q.queued_at >= p_date_from::timestamptz)
      and (p_date_to is null or q.queued_at < (p_date_to + 1)::timestamptz)
      and (p_closer_id is null or l.created_by=p_closer_id)
      and (p_product is null or q.product_line=p_product)
      and (p_stage_id is null or q.stage_id=p_stage_id)
      and (p_outcome is null or q.disposition=p_outcome)
  ), page as (
    select * from filtered order by queued_at desc, id desc
    limit least(greatest(coalesce(p_limit,250),1),5000) offset greatest(coalesce(p_offset,0),0)
  ), stage_rows as (
    select coalesce(stage_id::text, stage_key) as stage_id, coalesce(pipeline_id::text,'default') as pipeline_id,
      coalesce(stage_key,'New') as stage_name, count(*)::integer as lead_count
    from filtered group by coalesce(stage_id::text, stage_key), coalesce(pipeline_id::text,'default'), coalesce(stage_key,'New')
  ), totals as (select count(*)::integer as total from filtered)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_array(id, id, customer, submitted_at, updated_at, product_line,
      coalesce(stage_id::text, stage_key), coalesce(stage_key,'New'), 'open', disposition, disposition, null,
      submitted_by_id, submitted_by_name, status) order by queued_at desc, id desc) from page), '[]'::jsonb),
    'stages', coalesce((select jsonb_agg(jsonb_build_array(stage_id,pipeline_id,'Default pipeline',stage_name,0,'open','#64748b',false,lead_count)) from stage_rows), '[]'::jsonb),
    'closers', coalesce((select jsonb_agg(jsonb_build_array(submitted_by_id, submitted_by_name)) from (select distinct submitted_by_id, submitted_by_name from filtered where submitted_by_id is not null) c), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(product_line) from (select distinct product_line from filtered) p), '[]'::jsonb),
    'outcomes', coalesce((select jsonb_agg(jsonb_build_array(disposition, disposition)) from (select distinct disposition from filtered where disposition is not null) o), '[]'::jsonb),
    'total', totals.total,
    'next_offset', case when greatest(coalesce(p_offset,0),0)+(select count(*) from page)<totals.total then greatest(coalesce(p_offset,0),0)+(select count(*) from page) else null end,
    'counters', jsonb_build_object(
      'submittedToday', (select count(*)::integer from filtered where submitted_at::date = current_date),
      'claimed', (select count(*)::integer from filtered where status in ('claimed','buffer_active','handed_pending','la_active')),
      'converted', 0,
      'stillOpen', (select count(*)::integer from filtered where status not in ('completed','dropped'))
    )
  ) from totals;
$$;
revoke all on function public.partner_lead_pipeline_page(uuid, uuid, date, date, uuid, text, uuid, text, text, integer, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.partner_lead_pipeline_page(uuid, uuid, date, date, uuid, text, uuid, text, text, integer, integer) to service_role;

create or replace function public.consume_existing_partner_invite(p_token_hash text)
returns table(user_id uuid, tenant_id uuid, partner_id uuid, accepted_at timestamptz)
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare v_inv public.user_invitations%rowtype; v_partner uuid; v_accepted timestamptz := now();
begin
  select i.* into v_inv from public.user_invitations i
  where i.token_hash=p_token_hash and i.accepted_at is null and i.expires_at>now()
  order by i.created_at desc limit 1 for update;
  if not found then return; end if;
  select pu.partner_id into v_partner from public.partner_users pu
    where pu.user_id=v_inv.user_id and (v_inv.tenant_id is null or pu.tenant_id=v_inv.tenant_id)
      and pu.status in ('invited','active') order by pu.created_at desc limit 1 for update;
  if v_partner is null then return; end if;
  update public.user_invitations set accepted_at=v_accepted where id=v_inv.id;
  update public.partner_users pu set accepted_at=v_accepted where pu.user_id=v_inv.user_id and pu.partner_id=v_partner;
  return query select v_inv.user_id, v_inv.tenant_id, v_partner, v_accepted;
end;
$$;
revoke all on function public.consume_existing_partner_invite(text) from public, anon, authenticated, tenant_app;
grant execute on function public.consume_existing_partner_invite(text) to service_role;

create or replace function public.admin_usage_monitor_json(p_over_80 boolean default false)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select '[]'::jsonb; $$;
revoke all on function public.admin_usage_monitor_json(boolean) from public, anon, authenticated, tenant_app;
grant execute on function public.admin_usage_monitor_json(boolean) to service_role;
