-- M3-10 follow-up: a trigger function shared by invoices and credit_notes cannot reference a
-- table-specific NEW field before it has checked TG_TABLE_NAME. Read the relevant field safely.

create or replace function public.enforce_billing_tenant_relationships()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
  v_related_id uuid;
begin
  if tg_table_name = 'invoices' then
    v_related_id := nullif(to_jsonb(new) ->> 'subscription_id', '')::uuid;
    if v_related_id is not null then
      select s.tenant_id into v_tenant_id from public.subscriptions s where s.id = v_related_id;
      if not found then raise exception 'The invoice subscription does not exist.'; end if;
      if v_tenant_id <> (to_jsonb(new) ->> 'tenant_id')::uuid then
        raise exception 'The invoice subscription belongs to another tenant.';
      end if;
    end if;
  elsif tg_table_name = 'credit_notes' then
    v_related_id := nullif(to_jsonb(new) ->> 'invoice_id', '')::uuid;
    if v_related_id is not null then
      select i.tenant_id into v_tenant_id from public.invoices i where i.id = v_related_id;
      if not found then raise exception 'The credit note invoice does not exist.'; end if;
      if v_tenant_id <> (to_jsonb(new) ->> 'tenant_id')::uuid then
        raise exception 'The credit note invoice belongs to another tenant.';
      end if;
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function public.enforce_billing_tenant_relationships() from public, anon, authenticated, tenant_app;
grant execute on function public.enforce_billing_tenant_relationships() to service_role;
