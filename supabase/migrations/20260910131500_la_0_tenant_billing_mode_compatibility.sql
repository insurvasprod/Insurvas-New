-- Keep the live tenant facade compatible with the local tenant contract used by
-- administration and billing views.
alter table public.tenants
  add column if not exists billing_mode text not null default 'automatic';
