-- LA-2.11: claim appointment reminders once and retain recipient-level evidence.
-- Additive only. The migration is intentionally separate from the calendar migration so it can be
-- reviewed and promoted after the appointment tables are present.

create table if not exists public.tenant_appointment_reminder_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  appointment_id uuid not null references public.tenant_appointments(id) on delete restrict,
  recipient_type text not null check (recipient_type in ('agent', 'customer')),
  recipient_key text not null check (char_length(btrim(recipient_key)) between 1 and 320),
  customer_local text not null,
  agent_local text not null,
  customer_timezone text not null,
  agent_timezone text not null,
  delivery_status text not null default 'queued'
    check (delivery_status in ('queued', 'delivered', 'skipped', 'failed')),
  failure_reason text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (appointment_id, recipient_type, recipient_key)
);

create index if not exists tenant_appointment_reminder_events_tenant_idx
  on public.tenant_appointment_reminder_events (tenant_id, created_at desc);

create or replace function public.claim_appointment_reminders(
  p_now timestamptz,
  p_until timestamptz,
  p_limit integer default 100
)
returns setof public.tenant_appointments
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  a public.tenant_appointments;
begin
  if p_until <= p_now then
    raise exception 'APPOINTMENT_REMINDER_WINDOW_INVALID';
  end if;

  for a in
    select *
      from public.tenant_appointments
     where status in ('booked', 'confirmed')
       and reminder_sent_at is null
       and starts_at_utc > p_now
       and starts_at_utc <= p_until
     order by starts_at_utc, id
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 100), 500))
  loop
    update public.tenant_appointments
       set reminder_sent_at = p_now, updated_at = p_now
     where id = a.id
     returning * into a;
    return next a;
  end loop;
end;
$function$;

alter table public.tenant_appointment_reminder_events enable row level security;
drop policy if exists tenant_appointment_reminder_events_scoped on public.tenant_appointment_reminder_events;
create policy tenant_appointment_reminder_events_scoped
  on public.tenant_appointment_reminder_events for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_appointment_reminder_events
  from public, anon, authenticated, tenant_app;
grant select on public.tenant_appointment_reminder_events to tenant_app;
grant select, insert, update on public.tenant_appointment_reminder_events to service_role;
revoke all on function public.claim_appointment_reminders(timestamptz, timestamptz, integer)
  from public, anon, authenticated, tenant_app;
grant execute on function public.claim_appointment_reminders(timestamptz, timestamptz, integer)
  to service_role;
