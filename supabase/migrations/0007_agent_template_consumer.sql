-- SA-4.6 consumer contract: each tenant pins a template version and stores lead values as JSONB.
-- This closes the hand-off to the agent workspace without copying mutable template definitions.
create table if not exists public.tenant_template_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_code text not null references public.products(code) on delete restrict,
  template_id uuid not null references public.templates(id) on delete restrict,
  template_version integer not null check (template_version > 0),
  assigned_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, product_code)
);

create table if not exists public.agent_leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  template_id uuid not null references public.templates(id) on delete restrict,
  template_version integer not null check (template_version > 0),
  stage_key text not null,
  values jsonb not null default '{}'::jsonb check (jsonb_typeof(values) = 'object'),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tenant_template_assignments_tenant_idx
  on public.tenant_template_assignments (tenant_id, product_code);
create index if not exists agent_leads_tenant_template_idx
  on public.agent_leads (tenant_id, template_id, template_version, stage_key);
create index if not exists agent_leads_values_gin_idx
  on public.agent_leads using gin (values jsonb_path_ops);

alter table public.tenant_template_assignments enable row level security;
alter table public.agent_leads enable row level security;

drop policy if exists tenant_template_assignments_scoped on public.tenant_template_assignments;
create policy tenant_template_assignments_scoped on public.tenant_template_assignments
  for all to public
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy if exists agent_leads_scoped on public.agent_leads;
create policy agent_leads_scoped on public.agent_leads
  for all to public
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

revoke all on table public.tenant_template_assignments, public.agent_leads from anon, authenticated;
grant select, insert, update, delete on table public.tenant_template_assignments, public.agent_leads to tenant_app;
grant select, insert, update, delete on table public.tenant_template_assignments, public.agent_leads to service_role;

create or replace function public.touch_agent_template_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tenant_template_assignments_touch_updated_at on public.tenant_template_assignments;
create trigger tenant_template_assignments_touch_updated_at
before update on public.tenant_template_assignments
for each row execute function public.touch_agent_template_updated_at();

drop trigger if exists agent_leads_touch_updated_at on public.agent_leads;
create trigger agent_leads_touch_updated_at
before update on public.agent_leads
for each row execute function public.touch_agent_template_updated_at();

revoke all on function public.touch_agent_template_updated_at() from public;
