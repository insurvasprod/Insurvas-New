-- LA-8.4 (Notion sprint, Module 8 — Settings) · the notification preference centre.
--
-- Per event, per channel — and four events that cannot be switched off. The events themselves are a
-- code registry (lib/notifications/events.ts), like LA-8.1's settings sections: a module adding an
-- alert registers it there with its defaults, and `is_protected` is set there by the platform, never
-- by a tenant. This file stores only the person's choices:
--
--   notification_preference      one row per person per event they have changed. NO ROW MEANS THE
--                                REGISTRY DEFAULT, not off — otherwise a newly registered event would
--                                be muted for everyone who already exists.
--   user_notification_settings   quiet hours, and when each digest last went.
--   notification_digest_item     what a daily or weekly digest will say. An empty digest is not sent.
--   agent_notifications.email_handled_at
--                                the outbox mark: a notification row whose email has been sent,
--                                queued for a digest, or decided against. Existing rows are marked
--                                handled as of now, so nothing old is emailed.
--
-- The four protected events (doi_deadline, reinstatement_closing, credential_expiring,
-- plan_payment_failed) cannot be stored as off on any channel: a check constraint refuses it, so no
-- route — the API included — can mute them. Missing one causes irreversible harm.
--
-- Rollback: drop table public.notification_digest_item, public.user_notification_settings,
--   public.notification_preference; alter table public.agent_notifications drop column email_handled_at.

create table if not exists public.notification_preference (
  user_id uuid not null references public.users(id) on delete cascade,
  event_key text not null check (event_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  in_app boolean not null,
  email boolean not null,
  push boolean not null,
  digest text not null default 'immediate' check (digest in ('immediate', 'daily', 'weekly', 'off')),
  updated_at timestamptz not null default now(),
  primary key (user_id, event_key),
  constraint notification_preference_protected check (
    event_key not in ('doi_deadline', 'reinstatement_closing', 'credential_expiring', 'plan_payment_failed')
    or (in_app and email and push and digest = 'immediate')
  )
);

create table if not exists public.user_notification_settings (
  user_id uuid primary key references public.users(id) on delete cascade,
  quiet_enabled boolean not null default false,
  quiet_start time not null default '21:00',
  quiet_end time not null default '08:00',
  daily_digest_sent_at timestamptz,
  weekly_digest_sent_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint user_notification_settings_quiet check (quiet_start <> quiet_end)
);

create table if not exists public.notification_digest_item (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete cascade,
  event_key text not null,
  cadence text not null check (cadence in ('daily', 'weekly')),
  title text not null check (length(title) <= 200),
  body text not null default '' check (length(body) <= 1000),
  link text check (link is null or length(link) <= 500),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists notification_digest_item_due on public.notification_digest_item (user_id, cadence) where sent_at is null;
create index if not exists notification_digest_item_tenant on public.notification_digest_item (tenant_id);

-- The outbox mark. Added with a default so every existing row reads "handled" (no rewrite: the
-- default is stored once), then the default is dropped so new rows start unhandled.
alter table public.agent_notifications add column if not exists email_handled_at timestamptz default now();
alter table public.agent_notifications alter column email_handled_at drop default;
create index if not exists agent_notifications_email_outbox on public.agent_notifications (created_at) where email_handled_at is null;

-- What people already chose behind the bell carries over: an alert they had switched off stays off
-- in the app. (The old "callback due" switch covered appointment reminders too, so it seeds both.)
-- Email and browser keep their registry defaults, so switching one back on later restores it whole.
insert into public.notification_preference (user_id, event_key, in_app, email, push, digest)
select distinct s.user_id, m.event_key, false, m.email_default, true, 'immediate'
  from public.agent_notification_settings s
  cross join lateral (values
    ('new_lead', 'new_lead', false), ('handoff_offered', 'handoff_offered', false), ('unclaimed_escalation', 'unclaimed_escalation', true),
    ('callback_due', 'callback_due', true), ('callback_due', 'appointment_due', true), ('mentioned', 'mentioned', false),
    ('partner_message', 'partner_message', false)
  ) as m(old_key, event_key, email_default)
 where jsonb_typeof(s.enabled_events) = 'object' and s.enabled_events ->> m.old_key = 'false'
on conflict (user_id, event_key) do nothing;

alter table public.notification_preference enable row level security;
alter table public.user_notification_settings enable row level security;
alter table public.notification_digest_item enable row level security;
revoke all on public.notification_preference, public.user_notification_settings, public.notification_digest_item from public, anon, authenticated;
grant select, insert, update, delete on public.notification_preference, public.user_notification_settings, public.notification_digest_item to service_role;

-- ─── a protected event that had no sender: E&O or licence expiring (LA-0.5) ──────────────────
-- The vault recorded expiry dates and the dashboard showed them, but nothing told anyone. Daily, an
-- in-app alert to the agency's owners at 30, 14, 7 and 1 day(s) out (and once when lapsed), one row
-- per item per step (the source key dedupes). The notifications job emails it: it cannot be muted.
create or replace function public.emit_credential_expiry_alerts(p_today date default current_date)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_n integer;
begin
  with due as (
    select l.tenant_id, 'licence'::text as what, l.id, l.expires_at,
           l.state || ' licence ' || l.license_number as label
      from public.licenses l
     where l.expires_at <= p_today + 30
    union all
    select e.tenant_id, 'eo', e.id, e.expires_at, 'E&O policy ' || e.policy_number || ' (' || e.carrier || ')'
      from public.eo_policies e
     where e.expires_at <= p_today + 30
       -- Only the agency's newest cover counts: an old policy that a renewal replaced is not "expiring".
       and not exists (select 1 from public.eo_policies n where n.tenant_id = e.tenant_id and n.expires_at > e.expires_at)
  ), stepped as (
    select d.*, (d.expires_at - p_today) as days,
           case when d.expires_at - p_today < 0 then 'lapsed' when d.expires_at - p_today <= 1 then '1'
                when d.expires_at - p_today <= 7 then '7' when d.expires_at - p_today <= 14 then '14' else '30' end as step
      from due d
     -- A lapsed item is told about for a week, not forever.
     where d.expires_at >= p_today - 7
  ), sent as (
    insert into public.agent_notifications (tenant_id, recipient_user_id, kind, title, body, link, source_key)
    select s.tenant_id, tu.user_id, 'credential_expiring',
           case when s.days < 0 then s.label || ' has lapsed' when s.days = 0 then s.label || ' expires today'
                else s.label || ' expires in ' || s.days || ' day' || case when s.days = 1 then '' else 's' end end,
           'Expires ' || to_char(s.expires_at, 'FMMonth FMDD, YYYY') || '. Record the renewal in States & licences.',
           '/app/settings#states-licences',
           'credential-expiring:' || s.what || ':' || s.id || ':' || s.step
      from stepped s
      join public.tenant_users tu on tu.tenant_id = s.tenant_id and tu.role::text = 'owner' and tu.accepted_at is not null
      join public.users u on u.id = tu.user_id and u.status = 'active'
      join public.tenants t on t.id = s.tenant_id and t.status::text <> 'suspended'
    on conflict (tenant_id, recipient_user_id, source_key) do nothing
    returning 1
  )
  select count(*) into v_n from sent;
  return v_n;
end;
$$;

revoke all on function public.emit_credential_expiry_alerts(date) from public, anon, authenticated, tenant_app;
grant execute on function public.emit_credential_expiry_alerts(date) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('la8-credential-expiry', '0 13 * * *', $job$select public.emit_credential_expiry_alerts()$job$);
  end if;
end;
$$;
