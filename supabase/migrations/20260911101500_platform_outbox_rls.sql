-- Outbox rows are worker-owned platform data.  The application never reads or
-- writes this table with an end-user role, so keep it inaccessible to all client
-- roles and document the service-role-only policy explicitly.
alter table public.platform_outbox_events enable row level security;
drop policy if exists platform_outbox_service_role_only on public.platform_outbox_events;
create policy platform_outbox_service_role_only on public.platform_outbox_events
  for all to service_role using (true) with check (true);
revoke all on public.platform_outbox_events from anon, authenticated, public, tenant_app;
grant select, insert, update, delete on public.platform_outbox_events to service_role;
