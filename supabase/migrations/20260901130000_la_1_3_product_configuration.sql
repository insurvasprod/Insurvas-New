-- LA-1.3: tenant product choices and the subset each partner may submit.
-- Product codes remain text so adding a catalog product is data, not a deployment.

create table if not exists public.tenant_products (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_code text not null references public.products(code) on delete restrict,
  is_enabled boolean not null default false,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, product_code)
);

create table if not exists public.partner_products (
  partner_id uuid not null references public.partners(id) on delete cascade,
  product_code text not null references public.products(code) on delete restrict,
  approved_at timestamptz not null default now(),
  approved_by uuid references public.users(id) on delete set null,
  primary key (partner_id, product_code)
);

-- Existing tenants used the original Term Life workspace before this configuration layer
-- existed. Preserve that behavior while leaving every other catalog product opt-in.
insert into public.tenant_products (tenant_id, product_code, is_enabled, sort_order)
select t.id, p.code, p.code = 'term_life', p.sort_order
from public.tenants t
cross join public.products p
where p.is_active
on conflict (tenant_id, product_code) do nothing;

alter table public.agent_leads add column if not exists product_line text;

update public.agent_leads l
set product_line = tt.product_code
from public.tenant_templates tt
where l.tenant_template_id = tt.id
  and l.product_line is null;

update public.agent_leads l
set product_line = t.product_code
from public.templates t
where l.template_id = t.id
  and l.product_line is null;

alter table public.agent_leads alter column product_line set not null;
do $$ begin
  alter table public.agent_leads add constraint agent_leads_product_line_fkey
    foreign key (product_line) references public.products(code) on delete restrict;
exception when duplicate_object then null; end $$;

create index if not exists tenant_products_enabled_order_idx
  on public.tenant_products (tenant_id, is_enabled, sort_order, product_code);
create index if not exists partner_products_partner_idx
  on public.partner_products (partner_id, product_code);
create index if not exists agent_leads_tenant_product_idx
  on public.agent_leads (tenant_id, product_line, created_at desc);

create or replace function public.touch_tenant_product_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tenant_products_touch_updated_at on public.tenant_products;
create trigger tenant_products_touch_updated_at
before update on public.tenant_products
for each row execute function public.touch_tenant_product_updated_at();

-- This operation validates the catalog row and serializes the tenant setting update. It does not
-- remove partner approvals when a product is disabled; the capability read filters them out until
-- the product is enabled again, preserving Ray's configuration history.
create or replace function public.set_tenant_product(
  p_tenant_id uuid,
  p_product_code text,
  p_is_enabled boolean,
  p_sort_order integer default null
)
returns public.tenant_products
language plpgsql security invoker set search_path = public
as $$
declare
  v_product public.products;
  v_row public.tenant_products;
begin
  select * into v_product from public.products where code = btrim(p_product_code);
  if not found then raise exception 'product_not_found'; end if;
  if p_is_enabled and not v_product.is_active then raise exception 'product_archived'; end if;
  if p_sort_order is not null and p_sort_order < 0 then raise exception 'invalid_product_sort_order'; end if;

  insert into public.tenant_products (tenant_id, product_code, is_enabled, sort_order)
  values (p_tenant_id, v_product.code, p_is_enabled, coalesce(p_sort_order, v_product.sort_order))
  on conflict (tenant_id, product_code) do update
    set is_enabled = excluded.is_enabled,
        sort_order = excluded.sort_order,
        updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

-- Approval is deliberately a separate write from the tenant toggle. A disabled tenant product
-- cannot be approved, while removing an approval never changes the product catalog or old leads.
create or replace function public.set_partner_product_approval(
  p_tenant_id uuid,
  p_partner_id uuid,
  p_product_code text,
  p_approved boolean,
  p_approved_by uuid
)
returns boolean
language plpgsql security invoker set search_path = public
as $$
declare
  v_partner public.partners;
  v_product public.products;
  v_enabled boolean;
begin
  select * into v_partner from public.partners where id = p_partner_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'partner_not_found'; end if;
  if v_partner.status = 'offboarded' then raise exception 'partner_offboarded'; end if;

  select * into v_product from public.products where code = btrim(p_product_code);
  if not found then raise exception 'product_not_found'; end if;
  if not v_product.is_active then raise exception 'product_archived'; end if;

  select tp.is_enabled into v_enabled
  from public.tenant_products tp
  where tp.tenant_id = p_tenant_id and tp.product_code = v_product.code;
  if coalesce(v_enabled, false) = false and p_approved then raise exception 'product_not_enabled'; end if;

  if p_approved then
    insert into public.partner_products (partner_id, product_code, approved_at, approved_by)
    values (p_partner_id, v_product.code, now(), p_approved_by)
    on conflict (partner_id, product_code) do update
      set approved_at = now(), approved_by = excluded.approved_by;
    return true;
  end if;

  delete from public.partner_products
  where partner_id = p_partner_id and product_code = v_product.code;
  return false;
end;
$$;

alter table public.tenant_products enable row level security;
alter table public.partner_products enable row level security;

revoke all on public.tenant_products, public.partner_products from anon, authenticated, public, tenant_app;
grant select on public.tenant_products, public.partner_products to tenant_app;
grant select, insert, update, delete on public.tenant_products, public.partner_products to service_role;

drop policy if exists tenant_products_tenant_read on public.tenant_products;
create policy tenant_products_tenant_read on public.tenant_products
  for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy if exists partner_products_tenant_read on public.partner_products;
create policy partner_products_tenant_read on public.partner_products
  for select to tenant_app
  using (exists (
    select 1 from public.partners p
    where p.id = partner_id
      and p.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
  ));

revoke all on function public.touch_tenant_product_updated_at() from public;
revoke all on function public.set_tenant_product(uuid, text, boolean, integer) from public;
revoke all on function public.set_partner_product_approval(uuid, uuid, text, boolean, uuid) from public;
grant execute on function public.set_tenant_product(uuid, text, boolean, integer) to service_role;
grant execute on function public.set_partner_product_approval(uuid, uuid, text, boolean, uuid) to service_role;
