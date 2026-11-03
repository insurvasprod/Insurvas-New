-- LA-1.25: per-agent alert controls. The alert stream remains durable in agent_notifications;
-- this row stores only delivery preferences for one tenant membership.

create table if not exists public.agent_notification_settings (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  enabled_events jsonb not null default '{"new_lead":true,"handoff_offered":true,"unclaimed_escalation":true,"callback_due":true,"mentioned":true,"partner_message":true}'::jsonb,
  do_not_disturb boolean not null default false,
  sound_muted boolean not null default false,
  sound_volume smallint not null default 70 check (sound_volume between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id),
  check (jsonb_typeof(enabled_events) = 'object'),
  check (jsonb_typeof(enabled_events->'new_lead') = 'boolean'),
  check (jsonb_typeof(enabled_events->'handoff_offered') = 'boolean'),
  check (jsonb_typeof(enabled_events->'unclaimed_escalation') = 'boolean'),
  check (jsonb_typeof(enabled_events->'callback_due') = 'boolean'),
  check (jsonb_typeof(enabled_events->'mentioned') = 'boolean'),
  check (jsonb_typeof(enabled_events->'partner_message') = 'boolean')
);

create index if not exists agent_notification_settings_user_idx
  on public.agent_notification_settings (tenant_id, user_id);

alter table public.agent_notification_settings enable row level security;

drop policy if exists agent_notification_settings_user_scoped on public.agent_notification_settings;
create policy agent_notification_settings_user_scoped on public.agent_notification_settings
  for all to tenant_app
  using (
    tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid
    and user_id = nullif((select current_setting('app.user_id', true)), '')::uuid
  )
  with check (
    tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid
    and user_id = nullif((select current_setting('app.user_id', true)), '')::uuid
  );

revoke all on public.agent_notification_settings from anon, authenticated, public;
grant select, insert, update on public.agent_notification_settings to tenant_app, service_role;
