-- M3-10 · Billing relationships are tenant-owned, not merely UUID-shaped.

create or replace function public.enforce_billing_tenant_relationships()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
begin
  if tg_table_name = 'invoices' and new.subscription_id is not null then
    select s.tenant_id into v_tenant_id
      from public.subscriptions s
     where s.id = new.subscription_id;
    if not found then
      raise exception 'The invoice subscription does not exist.';
    end if;
    if v_tenant_id <> new.tenant_id then
      raise exception 'The invoice subscription belongs to another tenant.';
    end if;
  elsif tg_table_name = 'credit_notes' and new.invoice_id is not null then
    select i.tenant_id into v_tenant_id
      from public.invoices i
     where i.id = new.invoice_id;
    if not found then
      raise exception 'The credit note invoice does not exist.';
    end if;
    if v_tenant_id <> new.tenant_id then
      raise exception 'The credit note invoice belongs to another tenant.';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists invoices_tenant_relationship_guard on public.invoices;
create trigger invoices_tenant_relationship_guard
before insert or update of tenant_id, subscription_id on public.invoices
for each row execute function public.enforce_billing_tenant_relationships();

drop trigger if exists credit_notes_tenant_relationship_guard on public.credit_notes;
create trigger credit_notes_tenant_relationship_guard
before insert or update of tenant_id, invoice_id on public.credit_notes
for each row execute function public.enforce_billing_tenant_relationships();

revoke all on function public.enforce_billing_tenant_relationships() from public, anon, authenticated, tenant_app;
grant execute on function public.enforce_billing_tenant_relationships() to service_role;
