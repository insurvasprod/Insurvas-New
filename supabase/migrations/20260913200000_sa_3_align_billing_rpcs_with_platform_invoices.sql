-- SA-3 / period billing compatibility repair.
--
-- The platform billing tables were deliberately renamed to platform_invoices and
-- platform_invoice_lines because public.invoices belongs to the legacy CRM. The original
-- billing functions predate that rename and still write public.invoices, where tenant_id is
-- nullable/legacy-shaped and organization_id is required. Keep the CRM tables untouched and
-- make every SaaS billing RPC target the platform contract.

do $$
declare
  v_pending bigint;
  v_runs bigint;
begin
  select count(*) into v_pending from public.pending_charges where invoice_id is not null;
  select count(*) into v_runs from public.period_billing_runs where invoice_id is not null;
  if v_pending > 0 or v_runs > 0 then
    raise exception
      'billing compatibility repair requires empty legacy invoice references (pending %, runs %)',
      v_pending, v_runs;
  end if;
end;
$$;

alter table public.pending_charges
  drop constraint if exists pending_charges_invoice_id_fkey;
alter table public.pending_charges
  add constraint pending_charges_invoice_id_fkey
  foreign key (invoice_id) references public.platform_invoices(id) on delete set null;

alter table public.period_billing_runs
  drop constraint if exists period_billing_runs_invoice_id_fkey;
alter table public.period_billing_runs
  add constraint period_billing_runs_invoice_id_fkey
  foreign key (invoice_id) references public.platform_invoices(id) on delete set null;

-- One provider payment must produce one platform invoice. The transaction advisory lock closes
-- the check-then-insert race when a provider redelivers the same payment concurrently.
create or replace function public.create_invoice_for_payment(
  p_tenant_id uuid,
  p_subscription_id uuid,
  p_provider text,
  p_provider_payment_id text,
  p_provider_total_cents integer,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_paid_at timestamptz,
  p_lines jsonb
)
returns table(invoice_id uuid, number text, created boolean, reconciliation text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_existing public.platform_invoices%rowtype;
  v_number text;
  v_id uuid;
  v_subtotal integer := 0;
  v_discount integer := 0;
  v_total integer;
  v_reconciliation text;
  v_line jsonb;
  v_position integer := 0;
  v_kind text;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    coalesce(p_provider, '') || ':' || coalesce(p_provider_payment_id, ''), 0
  ));

  select * into v_existing
    from public.platform_invoices
   where provider = p_provider and provider_payment_id = p_provider_payment_id;

  if found then
    return query select v_existing.id, v_existing.number, false, v_existing.reconciliation;
    return;
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_kind := v_line ->> 'kind';
    if v_kind in ('discount', 'credit') then
      v_discount := v_discount + abs((v_line ->> 'amount_cents')::integer);
    else
      v_subtotal := v_subtotal + (v_line ->> 'amount_cents')::integer;
    end if;
  end loop;

  v_total := v_subtotal - v_discount;
  if v_total < 0 then
    raise exception 'invoice total cannot be negative';
  end if;

  if p_provider_total_cents is null then
    v_reconciliation := 'not_applicable';
  elsif p_provider_total_cents = v_total then
    v_reconciliation := 'matched';
  else
    v_reconciliation := 'mismatched';
  end if;

  v_number := public.allocate_invoice_number(coalesce(p_paid_at, now()));

  -- Insert as draft so the issued-invoice trigger permits its lines to be added. The second
  -- update transitions it to paid and makes the complete record immutable.
  insert into public.platform_invoices (
    number, tenant_id, subscription_id, kind, status,
    subtotal_cents, discount_cents, tax_cents, total_cents,
    period_start, period_end, provider, provider_payment_id, provider_total_cents,
    reconciliation, created_at
  ) values (
    v_number, p_tenant_id, p_subscription_id, 'subscription', 'draft',
    v_subtotal, v_discount, 0, v_total,
    p_period_start, p_period_end, p_provider, p_provider_payment_id, p_provider_total_cents,
    v_reconciliation, now()
  ) returning id into v_id;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_kind := v_line ->> 'kind';
    insert into public.platform_invoice_lines (
      invoice_id, position, kind, label, quantity, included_qty, unit_cents, amount_cents
    ) values (
      v_id,
      v_position,
      v_kind::public.invoice_line_kind,
      v_line ->> 'label',
      coalesce((v_line ->> 'quantity')::numeric, 1)::integer,
      nullif(v_line ->> 'included_qty', '')::numeric,
      abs(coalesce((v_line ->> 'unit_cents')::integer, (v_line ->> 'amount_cents')::integer)),
      case when v_kind in ('discount', 'credit')
        then -abs((v_line ->> 'amount_cents')::integer)
        else (v_line ->> 'amount_cents')::integer
      end
    );
    v_position := v_position + 1;
  end loop;

  update public.platform_invoices
     set status = 'paid',
         issued_at = coalesce(p_paid_at, now()),
         paid_at = coalesce(p_paid_at, now())
   where id = v_id;

  return query select v_id, v_number, true, v_reconciliation;
end;
$function$;

revoke all on function public.create_invoice_for_payment(uuid, uuid, text, text, integer, timestamptz, timestamptz, timestamptz, jsonb)
  from public, anon, authenticated, tenant_app;
grant execute on function public.create_invoice_for_payment(uuid, uuid, text, text, integer, timestamptz, timestamptz, timestamptz, jsonb)
  to service_role;

create or replace function public.create_custom_invoice(
  p_tenant_id uuid,
  p_subscription_id uuid,
  p_reason text,
  p_due_at timestamptz,
  p_created_by uuid,
  p_lines jsonb
)
returns table(invoice_id uuid, number text, total_cents integer)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_number text;
  v_id uuid;
  v_subtotal integer := 0;
  v_discount integer := 0;
  v_total integer;
  v_line jsonb;
  v_position integer := 0;
  v_kind text;
begin
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'a custom invoice needs a reason';
  end if;
  if coalesce(jsonb_array_length(p_lines), 0) = 0 then
    raise exception 'a custom invoice needs at least one line';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_kind := v_line ->> 'kind';
    if v_kind in ('discount', 'credit') then
      v_discount := v_discount + abs((v_line ->> 'amount_cents')::integer);
    else
      v_subtotal := v_subtotal + (v_line ->> 'amount_cents')::integer;
    end if;
  end loop;

  v_total := v_subtotal - v_discount;
  if v_total <= 0 then
    raise exception 'a custom invoice must total more than zero';
  end if;

  v_number := public.allocate_invoice_number(now());

  insert into public.platform_invoices (
    number, tenant_id, subscription_id, kind, status,
    subtotal_cents, discount_cents, tax_cents, total_cents,
    issued_at, due_at, created_by, reconciliation
  ) values (
    v_number, p_tenant_id, p_subscription_id, 'custom', 'draft',
    v_subtotal, v_discount, 0, v_total,
    null, p_due_at, p_created_by, 'not_applicable'
  ) returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_kind := coalesce(v_line ->> 'kind', 'plan');
    insert into public.platform_invoice_lines (
      invoice_id, position, kind, label, quantity, included_qty, unit_cents, amount_cents
    ) values (
      v_id,
      v_position,
      v_kind::public.invoice_line_kind,
      v_line ->> 'label',
      coalesce((v_line ->> 'quantity')::numeric, 1)::integer,
      nullif(v_line ->> 'included_qty', '')::numeric,
      abs(coalesce((v_line ->> 'unit_cents')::integer, (v_line ->> 'amount_cents')::integer)),
      case when v_kind in ('discount', 'credit')
        then -abs((v_line ->> 'amount_cents')::integer)
        else (v_line ->> 'amount_cents')::integer
      end
    );
    v_position := v_position + 1;
  end loop;

  update public.platform_invoices
     set status = 'issued', issued_at = now()
   where id = v_id;

  return query select v_id, v_number, v_total;
end;
$function$;

revoke all on function public.create_custom_invoice(uuid, uuid, text, timestamptz, uuid, jsonb)
  from public, anon, authenticated, tenant_app;
grant execute on function public.create_custom_invoice(uuid, uuid, text, timestamptz, uuid, jsonb)
  to service_role;

create or replace function public.bill_subscription_period(
  p_subscription_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_lines jsonb,
  p_pending_ids uuid[],
  p_reason text,
  p_credit_cents integer default 0,
  p_due_at timestamptz default null,
  p_created_by uuid default null
)
returns table(invoice_id uuid, invoice_number text, total_cents integer, line_count integer, already_billed boolean)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_existing public.period_billing_runs%rowtype;
  v_tenant uuid;
  v_total integer;
  v_count integer;
  v_invoice uuid;
  v_number text;
begin
  select s.tenant_id into v_tenant
    from public.subscriptions s
   where s.id = p_subscription_id
   for update;
  if not found then
    raise exception 'subscription_not_found' using errcode = 'no_data_found';
  end if;

  select * into v_existing
    from public.period_billing_runs r
   where r.subscription_id = p_subscription_id and r.period_start = p_period_start;

  if found then
    return query
      select v_existing.invoice_id,
             (select i.number from public.platform_invoices i where i.id = v_existing.invoice_id),
             v_existing.total_cents, v_existing.line_count, true;
    return;
  end if;

  v_count := coalesce(jsonb_array_length(p_lines), 0);

  select coalesce(sum(case when (line ->> 'kind') in ('discount', 'credit')
                           then -abs((line ->> 'amount_cents')::integer)
                           else (line ->> 'amount_cents')::integer end), 0)::integer
    into v_total
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) line;

  if v_count = 0 then
    insert into public.period_billing_runs
      (subscription_id, period_start, period_end, total_cents, line_count, note)
    values
      (p_subscription_id, p_period_start, p_period_end, 0, 0, 'Nothing beyond the plan to bill.');
    return query select null::uuid, null::text, 0, 0, false;
    return;
  end if;

  if v_total <= 0 then
    insert into public.period_billing_runs
      (subscription_id, period_start, period_end, total_cents, line_count, note)
    values
      (p_subscription_id, p_period_start, p_period_end, v_total, v_count,
       'Charges were fully covered by credit, so no invoice was raised.');

    update public.pending_charges
       set invoice_id = null, billed_at = now()
     where id = any(coalesce(p_pending_ids, '{}'::uuid[]));
    if coalesce(p_credit_cents, 0) > 0 then
      perform public.adjust_tenant_credit(v_tenant, -p_credit_cents);
    end if;
    return query select null::uuid, null::text, v_total, v_count, false;
    return;
  end if;

  select c.invoice_id, c.number into v_invoice, v_number
    from public.create_custom_invoice(
      v_tenant, p_subscription_id, p_reason, p_due_at, p_created_by, p_lines
    ) c;

  update public.platform_invoices
     set period_start = p_period_start, period_end = p_period_end
   where id = v_invoice;

  update public.pending_charges
     set invoice_id = v_invoice, billed_at = now()
   where id = any(coalesce(p_pending_ids, '{}'::uuid[]));

  if coalesce(p_credit_cents, 0) > 0 then
    perform public.adjust_tenant_credit(v_tenant, -p_credit_cents);
  end if;

  insert into public.period_billing_runs
    (subscription_id, period_start, period_end, invoice_id, total_cents, line_count)
  values
    (p_subscription_id, p_period_start, p_period_end, v_invoice, v_total, v_count);

  return query select v_invoice, v_number, v_total, v_count, false;
end;
$function$;

revoke all on function public.bill_subscription_period(uuid, timestamptz, timestamptz, jsonb, uuid[], text, integer, timestamptz, uuid)
  from public, anon, authenticated, tenant_app;
grant execute on function public.bill_subscription_period(uuid, timestamptz, timestamptz, jsonb, uuid[], text, integer, timestamptz, uuid)
  to service_role;
