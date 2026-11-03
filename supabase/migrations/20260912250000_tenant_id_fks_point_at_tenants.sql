-- Point tenant_id foreign keys at `tenants`, not `organizations`.
--
-- Six tables have `tenant_id` referencing `organizations(id)`. Every one of them is a tenant-plane
-- table, and this repo declares each against `public.tenants(id)`. The mismatch is invisible for
-- any tenant that happens to have a matching organizations row -- the live ones mostly do, which is
-- why a hand probe against an existing tenant succeeded -- and fatal for a tenant that does not:
--
--   23503 insert or update on table "tenant_templates" violates foreign key constraint
--         "tenant_templates_tenant_id_fkey"
--
-- which is what LA-1.4 hits, because its fixture creates a real tenant and no organization. The
-- same trap is waiting for any newly provisioned customer, since nothing in the signup path creates
-- an organizations row.
--
-- That last point is the reason to fix this rather than teach fixtures to create organizations: a
-- tenant created by self-serve signup today cannot have a payment provider or a template copy, and
-- nobody would find out until the first customer tried.
--
-- Safe: every existing tenant_id in these six tables also exists in `tenants`, checked below by the
-- constraints validating on creation. ON DELETE CASCADE is preserved from the originals.

alter table public.tenant_templates drop constraint if exists tenant_templates_tenant_id_fkey;
alter table public.tenant_templates
  add constraint tenant_templates_tenant_id_fkey
  foreign key (tenant_id) references public.tenants(id) on delete cascade;

alter table public.tenant_template_fields drop constraint if exists tenant_template_fields_tenant_id_fkey;
alter table public.tenant_template_fields
  add constraint tenant_template_fields_tenant_id_fkey
  foreign key (tenant_id) references public.tenants(id) on delete cascade;

alter table public.tenant_template_stages drop constraint if exists tenant_template_stages_tenant_id_fkey;
alter table public.tenant_template_stages
  add constraint tenant_template_stages_tenant_id_fkey
  foreign key (tenant_id) references public.tenants(id) on delete cascade;

alter table public.tenant_template_forms drop constraint if exists tenant_template_forms_tenant_id_fkey;
alter table public.tenant_template_forms
  add constraint tenant_template_forms_tenant_id_fkey
  foreign key (tenant_id) references public.tenants(id) on delete cascade;

alter table public.payment_providers drop constraint if exists payment_providers_tenant_id_fkey;
alter table public.payment_providers
  add constraint payment_providers_tenant_id_fkey
  foreign key (tenant_id) references public.tenants(id) on delete cascade;

alter table public.provider_calls drop constraint if exists provider_calls_tenant_id_fkey;
alter table public.provider_calls
  add constraint provider_calls_tenant_id_fkey
  foreign key (tenant_id) references public.tenants(id) on delete cascade;
