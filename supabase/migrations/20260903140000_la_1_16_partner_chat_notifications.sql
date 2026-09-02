-- LA-1.16: durable partner channels, chat messages, server-authored cards and read state.
-- The application uses a custom tenant_app session rather than a Supabase Auth JWT, so
-- API routes remain the authorization boundary while these policies provide database defense
-- in depth for the session settings used by the server database role.

create table if not exists public.partner_channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  partner_id uuid not null references public.partners(id) on delete restrict,
  channel_type text not null default 'partner' check (channel_type in ('partner', 'direct')),
  name text not null default 'Partner channel' check (char_length(btrim(name)) between 1 and 160),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (tenant_id, partner_id, channel_type)
);

alter table public.partner_messages
  alter column work_item_id drop not null;

alter table public.partner_messages
  add column if not exists channel_id uuid references public.partner_channels(id) on delete cascade,
  add column if not exists message_kind text not null default 'text',
  add column if not exists card_type text,
  add column if not exists card_payload jsonb not null default '{}'::jsonb;

alter table public.partner_messages
  drop constraint if exists partner_messages_message_kind_check;
alter table public.partner_messages
  add constraint partner_messages_message_kind_check
  check (message_kind in ('text', 'system_card'));

alter table public.partner_messages
  drop constraint if exists partner_messages_card_type_check;
alter table public.partner_messages
  add constraint partner_messages_card_type_check
  check (card_type is null or card_type in ('new_lead', 'connected', 'transferred', 'call_dropped', 'agent_ready', 'call_outcome', 'nobody_claimed'));

do $$
declare
  partner_row record;
begin
  for partner_row in select id, tenant_id, name from public.partners loop
    insert into public.partner_channels (tenant_id, partner_id, name)
    values (partner_row.tenant_id, partner_row.id, partner_row.name || ' channel')
    on conflict (tenant_id, partner_id, channel_type) do nothing;
  end loop;
end;
$$;

update public.partner_messages m
set channel_id = c.id
from public.partner_channels c
where c.tenant_id = m.tenant_id and c.partner_id = m.partner_id and c.channel_type = 'partner'
  and m.channel_id is null;

alter table public.partner_messages
  alter column channel_id set not null;

create index if not exists partner_channels_tenant_idx
  on public.partner_channels (tenant_id, status, created_at desc);
create index if not exists partner_channels_partner_idx
  on public.partner_channels (tenant_id, partner_id, status);
create index if not exists partner_messages_channel_idx
  on public.partner_messages (channel_id, created_at desc);
create index if not exists partner_messages_event_key_idx
  on public.partner_messages (event_key)
  where event_key is not null;

create table if not exists public.partner_message_reads (
  channel_id uuid not null references public.partner_channels(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create index if not exists partner_message_reads_tenant_user_idx
  on public.partner_message_reads (tenant_id, user_id, read_at desc);

create table if not exists public.partner_message_mentions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  message_id uuid not null references public.partner_messages(id) on delete cascade,
  mentioned_user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (message_id, mentioned_user_id)
);

create index if not exists partner_message_mentions_user_idx
  on public.partner_message_mentions (tenant_id, mentioned_user_id, created_at desc);

create table if not exists public.partner_message_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  message_id uuid not null references public.partner_messages(id) on delete cascade,
  file_name text not null check (char_length(btrim(file_name)) between 1 and 255),
  storage_path text not null check (char_length(btrim(storage_path)) between 1 and 1000),
  content_type text not null check (char_length(btrim(content_type)) between 1 and 160),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists partner_message_attachments_message_idx
  on public.partner_message_attachments (message_id);

create or replace function public.ensure_partner_channel()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  insert into public.partner_channels (tenant_id, partner_id, name)
  values (new.tenant_id, new.id, new.name || ' channel')
  on conflict (tenant_id, partner_id, channel_type) do nothing;
  return new;
end;
$$;

drop trigger if exists partners_create_chat_channel on public.partners;
create trigger partners_create_chat_channel
after insert on public.partners
for each row execute function public.ensure_partner_channel();

create or replace function public.archive_partner_channel()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  if new.status::text = 'offboarded' and old.status::text <> 'offboarded' then
    update public.partner_channels
    set status = 'archived', archived_at = coalesce(archived_at, now())
    where tenant_id = new.tenant_id and partner_id = new.id and status <> 'archived';
  end if;
  return new;
end;
$$;

drop trigger if exists partners_archive_chat_channel on public.partners;
create trigger partners_archive_chat_channel
after update of status on public.partners
for each row execute function public.archive_partner_channel();

create or replace function public.broadcast_partner_message()
returns trigger
security definer
set search_path = public, pg_catalog
as $$
begin
  perform realtime.broadcast_changes(
    'partner-chat:' || new.channel_id::text,
    'message',
    'INSERT',
    'partner_messages',
    'public',
    jsonb_build_object('channel_id', new.channel_id, 'message_id', new.id),
    null
  );
  return new;
end;
$$ language plpgsql;

-- LA-1.12 writes its outcome card inside the disposition transaction. Normalize that legacy
-- insert here so the transition owner still produces a typed, idempotent card without moving
-- disposition business logic into a React component or allowing client-authored card payloads.
create or replace function public.normalize_partner_disposition_card()
returns trigger
security definer
set search_path = public, pg_catalog
as $$
declare
  q record;
  label text;
  display_name text;
begin
  if new.work_item_id is null or new.message_kind <> 'text' or new.event_key is not null then return new; end if;
  select q.partner_id, q.disposition, q.disposition_by, q.status, l.values into q
  from public.lead_queue q
  join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
  where q.id = new.work_item_id and q.tenant_id = new.tenant_id;
  if q.disposition is null or q.disposition_by is distinct from new.created_by or q.status not in ('completed', 'dropped') then return new; end if;
  select d.label into label from public.dispositions d where d.tenant_id = new.tenant_id and d.disposition_key = q.disposition limit 1;
  display_name := coalesce(nullif(btrim(q.values->>'full_name'), ''), nullif(btrim(concat_ws(' ', q.values->>'first_name', q.values->>'last_name')), ''), 'Customer');
  new.message_kind := 'system_card';
  new.card_type := case when q.disposition = 'call_dropped' then 'call_dropped' else 'call_outcome' end;
  new.event_key := 'disposition:' || new.work_item_id::text || ':' || q.disposition;
  new.card_payload := jsonb_build_object('customer', display_name, 'disposition', coalesce(label, q.disposition));
  new.message := display_name || ': ' || coalesce(label, q.disposition);
  return new;
end;
$$ language plpgsql;

drop trigger if exists partner_messages_normalize_disposition on public.partner_messages;
create trigger partner_messages_normalize_disposition
before insert on public.partner_messages
for each row execute function public.normalize_partner_disposition_card();

drop trigger if exists partner_messages_broadcast on public.partner_messages;
create trigger partner_messages_broadcast
after insert on public.partner_messages
for each row execute function public.broadcast_partner_message();

create or replace function public.audit_partner_message()
returns trigger
security definer
set search_path = public, pg_catalog
as $$
begin
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values (
    case when new.created_by is null then 'system'::public.audit_actor_type else 'tenant'::public.audit_actor_type end,
    new.created_by,
    case when new.message_kind = 'system_card' then 'tenant.partner_system_card_posted' else 'tenant.partner_message_posted' end,
    'partner_message', new.id::text,
    jsonb_build_object('tenantId', new.tenant_id, 'partnerId', new.partner_id, 'channelId', new.channel_id, 'workItemId', new.work_item_id, 'eventKey', new.event_key, 'cardType', new.card_type)
  );
  return new;
end;
$$ language plpgsql;

drop trigger if exists partner_messages_audit on public.partner_messages;
create trigger partner_messages_audit
after insert on public.partner_messages
for each row execute function public.audit_partner_message();

alter table public.partner_channels enable row level security;
alter table public.partner_messages enable row level security;
alter table public.partner_message_reads enable row level security;
alter table public.partner_message_mentions enable row level security;
alter table public.partner_message_attachments enable row level security;

drop policy if exists partner_channels_tenant_scoped on public.partner_channels;
create policy partner_channels_tenant_scoped on public.partner_channels
for all to tenant_app
using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid
  and (nullif((select current_setting('app.partner_id', true)), '') is null or partner_id = nullif((select current_setting('app.partner_id', true)), '')::uuid))
with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid
  and (nullif((select current_setting('app.partner_id', true)), '') is null or partner_id = nullif((select current_setting('app.partner_id', true)), '')::uuid));

drop policy if exists partner_messages_tenant_scoped on public.partner_messages;
create policy partner_messages_tenant_scoped on public.partner_messages
for all to tenant_app
using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid
  and (nullif((select current_setting('app.partner_id', true)), '') is null or partner_id = nullif((select current_setting('app.partner_id', true)), '')::uuid))
with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid
  and (nullif((select current_setting('app.partner_id', true)), '') is null or partner_id = nullif((select current_setting('app.partner_id', true)), '')::uuid));

drop policy if exists partner_message_reads_tenant_scoped on public.partner_message_reads;
create policy partner_message_reads_tenant_scoped on public.partner_message_reads
for all to tenant_app
using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid
  and user_id = nullif((select current_setting('app.user_id', true)), '')::uuid)
with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid
  and user_id = nullif((select current_setting('app.user_id', true)), '')::uuid);

drop policy if exists partner_message_mentions_tenant_scoped on public.partner_message_mentions;
create policy partner_message_mentions_tenant_scoped on public.partner_message_mentions
for all to tenant_app
using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

drop policy if exists partner_message_attachments_tenant_scoped on public.partner_message_attachments;
create policy partner_message_attachments_tenant_scoped on public.partner_message_attachments
for all to tenant_app
using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.partner_channels, public.partner_messages, public.partner_message_reads, public.partner_message_mentions, public.partner_message_attachments from anon, authenticated, public;
grant select, insert, update on public.partner_channels, public.partner_messages, public.partner_message_reads, public.partner_message_mentions, public.partner_message_attachments to tenant_app;
grant select, insert, update on public.partner_channels, public.partner_messages, public.partner_message_reads, public.partner_message_mentions, public.partner_message_attachments to service_role;
revoke all on function public.ensure_partner_channel(), public.archive_partner_channel(), public.normalize_partner_disposition_card(), public.broadcast_partner_message(), public.audit_partner_message() from public, anon, authenticated, tenant_app;
