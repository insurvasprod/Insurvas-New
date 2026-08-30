-- SA-4.5 platform product catalog. Products are shared reference data for templates, forms,
-- reporting and agent settings. The application exposes archive/restore, never hard delete.
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]*$'),
  name text not null check (length(trim(name)) between 1 and 120),
  category text not null check (category in ('life', 'health', 'retirement')),
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_active_order_idx on public.products (is_active, sort_order, created_at);
alter table public.products enable row level security;
revoke all on table public.products from anon, authenticated;
grant select, insert, update on table public.products to service_role;

create or replace function public.touch_product_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists products_touch_updated_at on public.products;
create trigger products_touch_updated_at before update on public.products for each row execute function public.touch_product_updated_at();
revoke all on function public.touch_product_updated_at() from public;

insert into public.products (code, name, category, sort_order) values
  ('final_expense', 'Final Expense', 'life', 10),
  ('term_life', 'Term Life', 'life', 20),
  ('whole_life', 'Whole Life', 'life', 30),
  ('iul', 'Indexed Universal Life', 'life', 40),
  ('medicare_advantage', 'Medicare Advantage', 'health', 50),
  ('annuity', 'Annuity', 'retirement', 60)
on conflict (code) do nothing;
