-- Point tenant_templates at the template table this application actually uses.
--
-- `tenant_templates.template_id` references `platform_templates` here. This repo declares it
-- against `public.templates` (0009_tenant_template_copies.sql line 23), which is where SA-4.6 puts
-- the product template catalog and where the only template row lives.
--
-- `platform_templates` is the organizations-era table and it is EMPTY. So the reference can never
-- be satisfied, admin_apply_tenant_template fails with
--
--   23503 Key (template_id)=(...) is not present in table "platform_templates"
--
-- and no tenant ever receives a form copy. That is LA-1.4's "agent receives a tenant-owned form
-- copy", and the suite aborts there because every later check needs the copy id.
--
-- Safe to repoint: `tenant_templates` holds zero rows, and zero rows would fail the new constraint.
-- Nothing in either product is relying on the current target, because nothing can be.
--
-- ON DELETE RESTRICT matches what the repo declares: a template that tenants have copied must not
-- vanish underneath them.

alter table public.tenant_templates drop constraint if exists tenant_templates_template_id_fkey;

alter table public.tenant_templates
  add constraint tenant_templates_template_id_fkey
  foreign key (template_id) references public.templates(id) on delete restrict;

comment on constraint tenant_templates_template_id_fkey on public.tenant_templates is
  'Source template in public.templates, the SA-4.6 catalog. Previously pointed at the organizations-era platform_templates, which is empty; see 20260912220000.';
