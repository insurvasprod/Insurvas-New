-- LA-1.7 follow-up: retain the notification step as a durable queued event.
-- Delivery can be retried by the notification worker without asking the closer to resubmit.

create table if not exists public.lead_notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  channel text not null default 'internal',
  event_type text not null default 'lead_available',
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (lead_id, channel, event_type)
);

create index if not exists lead_notifications_queue_idx
  on public.lead_notifications (tenant_id, status, created_at)
  where status = 'queued';

alter table public.lead_notifications enable row level security;
drop policy if exists lead_notifications_tenant_scoped on public.lead_notifications;
create policy lead_notifications_tenant_scoped on public.lead_notifications
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.lead_notifications from anon, authenticated, public;
grant select on public.lead_notifications to tenant_app;
grant select, insert, update on public.lead_notifications to service_role;
