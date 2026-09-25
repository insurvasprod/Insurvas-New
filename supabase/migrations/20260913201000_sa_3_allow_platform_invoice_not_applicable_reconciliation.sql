-- SA-3.2 compatibility repair: manual/period invoices have no provider comparison.
-- The application contract already exposes not_applicable and uses it for custom invoices.
alter table public.platform_invoices
  drop constraint if exists platform_invoices_reconciliation_values;

alter table public.platform_invoices
  add constraint platform_invoices_reconciliation_values
  check (reconciliation in ('pending', 'matched', 'mismatched', 'not_applicable'));
