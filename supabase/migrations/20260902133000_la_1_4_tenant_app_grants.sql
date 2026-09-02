-- Keep the tenant-plane role usable for RLS-backed direct database access. Application route
-- handlers still use the service client, but tenant_app is the least-privilege database role.
grant select, insert, update, delete on table public.tenant_template_revisions, public.form_drafts to tenant_app;
