-- LA-0.7 · tenant policy book
--
-- This is deliberately separate from tenant_issued_policies. The latter is an immutable
-- attribution event for LA-2 reporting and requires a lead/application hop. The book of business
-- also needs to accept legacy carrier files and policies entered by hand, before a lead exists.
create table if not exists public.tenant_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  policy_number text not null check (char_length(btrim(policy_number)) between 1 and 120),
  insured_name text not null check (char_length(btrim(insured_name)) between 1 and 200),
  carrier text not null check (char_length(btrim(carrier)) between 1 and 160),
  product text not null check (char_length(btrim(product)) between 1 and 160),
  effective_date date not null,
  annual_premium_cents bigint not null check (annual_premium_cents >= 0),
  status text not null default 'active' check (status in ('active', 'pending', 'lapsed', 'cancelled')),
  renewal_date date,
  source text not null default 'manual' check (source in ('manual', 'csv')),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_policies_unique_number unique (tenant_id, policy_number),
  constraint tenant_policies_renewal_after_effective check (renewal_date is null or renewal_date >= effective_date)
);

create index if not exists tenant_policies_tenant_effective_idx
  on public.tenant_policies (tenant_id, effective_date desc);
create index if not exists tenant_policies_tenant_status_idx
  on public.tenant_policies (tenant_id, status);

alter table public.tenant_policies enable row level security;
drop policy if exists tenant_policies_tenant_scoped on public.tenant_policies;
create policy tenant_policies_tenant_scoped on public.tenant_policies
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_policies from anon, authenticated, public;
grant select on public.tenant_policies to tenant_app;
grant select, insert, update on public.tenant_policies to service_role;

create or replace function public.touch_tenant_policies_updated_at()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tenant_policies_updated_at on public.tenant_policies;
create trigger tenant_policies_updated_at
  before update on public.tenant_policies
  for each row execute function public.touch_tenant_policies_updated_at();
