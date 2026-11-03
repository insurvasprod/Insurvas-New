-- Column mapping dialog: a vendor's saved map remembers how that vendor writes slash dates.
--
-- 05/06/1961 is 6 May in a US file and 5 June in most others, and a file can hold hundreds of
-- values where both readings are valid. The person importing picks the order once per file; a
-- vendor whose saved map carries one is not asked again.
--
-- Additive and idempotent. Null means "never chosen", which is every existing row. RLS and grants
-- on tenant_import_mappings are unchanged: a new column inherits them.

alter table public.tenant_import_mappings
  add column if not exists date_order text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tenant_import_mappings'::regclass
       and conname = 'tenant_import_mappings_date_order_check'
  ) then
    alter table public.tenant_import_mappings
      add constraint tenant_import_mappings_date_order_check
      check (date_order is null or date_order in ('mdy', 'dmy'));
  end if;
end $$;

comment on column public.tenant_import_mappings.date_order is
  'How this vendor writes slash dates: mdy (US, month first) or dmy (day first). Null when never chosen.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tenant_import_mappings' and column_name = 'date_order'
       and data_type = 'text' and is_nullable = 'YES'
  ) then
    raise exception 'tenant_import_mappings.date_order was not added as a nullable text column';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tenant_import_mappings'::regclass
       and conname = 'tenant_import_mappings_date_order_check'
       and contype = 'c'
  ) then
    raise exception 'tenant_import_mappings_date_order_check was not created';
  end if;

  if not has_table_privilege('tenant_app', 'public.tenant_import_mappings', 'update') then
    raise exception 'tenant_app lost update on tenant_import_mappings';
  end if;
end $$;
