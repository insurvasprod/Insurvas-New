-- LA-0 bridge hardening: every public compatibility table is protected by RLS.
-- Products are platform reference data; the remaining tables are service-role-only.

alter table public.products enable row level security;
alter table public.audit_log enable row level security;
alter table public.login_events enable row level security;
alter table public.user_invitations enable row level security;

drop policy if exists la0_products_read on public.products;
create policy la0_products_read on public.products
  for select to tenant_app
  using (is_active);

revoke all on public.audit_log, public.login_events, public.user_invitations from public, anon, authenticated, tenant_app;
revoke all on public.products from public, anon, authenticated;
grant select on public.products to tenant_app;
grant all on public.audit_log, public.login_events, public.user_invitations to service_role;

