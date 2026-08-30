-- SA-4.7: a tenant owns a copied template definition. The source id/version are provenance only;
-- no tenant query needs to read mutable platform child rows after apply.
create table if not exists public.plan_product_access (
  plan_id uuid not null references public.plans(id) on delete cascade,
  product_code text not null references public.products(code) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (plan_id, product_code)
);

insert into public.plan_product_access (plan_id, product_code)
select p.id, pr.code
from public.plans p cross join public.products pr
where p.version = 1 and pr.is_active
on conflict do nothing;

alter table public.plan_product_access enable row level security;
revoke all on table public.plan_product_access from anon, authenticated, tenant_app;
grant select on table public.plan_product_access to service_role;

create table if not exists public.tenant_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  template_id uuid not null references public.templates(id) on delete restrict,
  template_version integer not null check (template_version > 0),
  product_code text not null references public.products(code) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 120),
  description text,
  applied_at timestamptz not null default now(),
  applied_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, product_code)
);

create table if not exists public.tenant_template_fields (
  tenant_template_id uuid not null references public.tenant_templates(id) on delete cascade,
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]*$'),
  label text not null check (length(trim(label)) between 1 and 120),
  type text not null,
  is_required boolean not null default false,
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  sort_order integer not null default 0 check (sort_order >= 0),
  primary key (tenant_template_id, field_key)
);

create table if not exists public.tenant_template_stages (
  tenant_template_id uuid not null references public.tenant_templates(id) on delete cascade,
  stage_key text not null check (stage_key ~ '^[a-z][a-z0-9_]*$'),
  label text not null check (length(trim(label)) between 1 and 120),
  stage_type text not null check (stage_type in ('open', 'won', 'lost')),
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order integer not null default 0 check (sort_order >= 0),
  primary key (tenant_template_id, stage_key)
);

create table if not exists public.tenant_template_forms (
  tenant_template_id uuid primary key references public.tenant_templates(id) on delete cascade,
  form_definition jsonb not null check (jsonb_typeof(form_definition) = 'object')
);

alter table public.agent_leads add column if not exists tenant_template_id uuid references public.tenant_templates(id) on delete restrict;
create index if not exists agent_leads_tenant_template_idx
  on public.agent_leads (tenant_id, tenant_template_id, stage_key);

create index if not exists tenant_templates_tenant_product_idx
  on public.tenant_templates (tenant_id, product_code);

alter table public.tenant_templates enable row level security;
alter table public.tenant_template_fields enable row level security;
alter table public.tenant_template_stages enable row level security;
alter table public.tenant_template_forms enable row level security;

drop policy if exists tenant_templates_scoped on public.tenant_templates;
create policy tenant_templates_scoped on public.tenant_templates
  for all to public
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy if exists tenant_template_fields_scoped on public.tenant_template_fields;
create policy tenant_template_fields_scoped on public.tenant_template_fields
  for all to public
  using (tenant_template_id in (select id from public.tenant_templates))
  with check (tenant_template_id in (select id from public.tenant_templates));

drop policy if exists tenant_template_stages_scoped on public.tenant_template_stages;
create policy tenant_template_stages_scoped on public.tenant_template_stages
  for all to public
  using (tenant_template_id in (select id from public.tenant_templates))
  with check (tenant_template_id in (select id from public.tenant_templates));

drop policy if exists tenant_template_forms_scoped on public.tenant_template_forms;
create policy tenant_template_forms_scoped on public.tenant_template_forms
  for all to public
  using (tenant_template_id in (select id from public.tenant_templates))
  with check (tenant_template_id in (select id from public.tenant_templates));

revoke all on table public.tenant_templates, public.tenant_template_fields, public.tenant_template_stages, public.tenant_template_forms from anon, authenticated;
grant select, insert, update, delete on table public.tenant_templates, public.tenant_template_fields, public.tenant_template_stages, public.tenant_template_forms to tenant_app;
grant select, insert, update, delete on table public.tenant_templates, public.tenant_template_fields, public.tenant_template_stages, public.tenant_template_forms to service_role;
