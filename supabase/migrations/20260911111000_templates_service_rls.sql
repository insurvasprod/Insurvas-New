-- Templates are read by the server-side service client. Keep the exposed
-- table explicit and service-role-only instead of leaving RLS policy-less.
drop policy if exists templates_service_role_only on public.templates;
create policy templates_service_role_only on public.templates
  for all to service_role using (true) with check (true);

revoke all on public.templates from public, anon, authenticated, tenant_app;
grant select, insert, update, delete on public.templates to service_role;
