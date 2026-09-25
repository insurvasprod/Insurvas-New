-- Restore the invoice-side tenant relationship guard that is part of the
-- billing integrity contract.
drop trigger if exists invoices_tenant_relationship_guard on public.invoices;
create trigger invoices_tenant_relationship_guard
  before insert or update of tenant_id, subscription_id on public.invoices
  for each row execute function public.enforce_billing_tenant_relationships();
