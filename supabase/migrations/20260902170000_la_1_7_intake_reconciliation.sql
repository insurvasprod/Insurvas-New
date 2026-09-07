-- LA-1.7: make intake failure alerts durable and expose the daily reconciliation check.

create unique index if not exists intake_alerts_failure_unique_idx
  on public.intake_alerts (intake_failure_id);

create or replace function public.create_intake_failure_alert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.intake_alerts (tenant_id, intake_failure_id, alert_type, status)
  values (new.tenant_id, new.id, 'intake_failure', 'open')
  on conflict (intake_failure_id) do nothing;
  return new;
end;
$$;

drop trigger if exists intake_failure_create_alert on public.intake_failures;
create trigger intake_failure_create_alert
  after insert on public.intake_failures
  for each row execute function public.create_intake_failure_alert();

revoke all on function public.create_intake_failure_alert() from public, anon, authenticated, tenant_app;

create or replace function public.reconcile_partner_intake()
returns table (
  lead_id uuid,
  tenant_id uuid,
  submission_id uuid,
  missing_steps text[]
)
language sql
security definer
set search_path = public
as $$
  select
    l.id,
    l.tenant_id,
    l.submission_id,
    array['work_item']::text[]
  from public.agent_leads l
  left join public.lead_queue q on q.lead_id = l.id
  left join public.intake_failures f on f.lead_id = l.id
  where l.partner_id is not null
    and l.submission_id is not null
    and q.id is null
    and f.id is null
  order by l.created_at;
$$;

revoke all on function public.reconcile_partner_intake() from public, anon, authenticated, tenant_app;
grant execute on function public.reconcile_partner_intake() to service_role;
