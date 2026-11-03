-- ---------------------------------------------------------------------------
-- One sign convention for a reducing line (backlog 189, part three)
--
-- Two conventions for the same column have been coexisting since SA-3:
--
--   the table says      platform_invoice_lines_amount_sign
--                       CHECK (case when kind in ('discount','credit') then amount_cents <= 0
--                                   else amount_cents >= 0 end)
--
--   the code says       lib/billing/lines.ts — "A credit line carries a POSITIVE amount and
--                       subtracts, matching create_custom_invoice"
--
-- Both are defensible and they cannot both hold. The constraint wins, for a reason that is not
-- merely that it is the newer of the two: with reducing lines stored negative, the lines of an
-- invoice sum to the invoice total, and an invoice whose lines do not add up to what it asks for
-- is the kind of document a customer disputes and we cannot defend. The older comment in
-- create_invoice_for_payment said exactly this — "Discounts are stored as negative amounts so the
-- lines always sum to the total" — and then the function stored them positive anyway.
--
-- The normalisation is done here, at the boundary, rather than by changing every caller:
--
--   callers keep passing a positive amount_cents for a discount or credit, which is what
--   InvoiceLineInput has always meant and what the assembler in lib/billing/lines.ts produces
--
--   the header arithmetic is untouched — it already reads abs(amount_cents), so no total moves
--
--   the stored line is negated, so it satisfies the constraint and sums correctly
--
-- Nothing that reads lines back needs to change: lib/invoices/lines.ts already totals them with
-- Math.abs, and the invoice screens format whatever is stored, where a credit showing as -$20.00
-- is what a reader expects to see.
-- ---------------------------------------------------------------------------

-- create_custom_invoice ------------------------------------------------------
create or replace function public.create_custom_invoice(
  p_tenant_id uuid,
  p_subscription_id uuid,
  p_reason text,
  p_due_at timestamp with time zone,
  p_created_by uuid,
  p_lines jsonb
)
returns table(invoice_id uuid, number text, total_cents integer)
language plpgsql
as $function$
declare
  v_number   text;
  v_id       uuid;
  v_subtotal integer := 0;
  v_discount integer := 0;
  v_total    integer;
  v_line     jsonb;
  v_position integer := 0;
  v_issued   timestamp with time zone := now();
  v_reducing boolean;
  v_amount   integer;
begin
  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'a custom invoice needs a reason';
  end if;

  if jsonb_array_length(p_lines) = 0 then
    raise exception 'a custom invoice needs at least one line';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    if (v_line ->> 'kind') in ('discount', 'credit') then
      v_discount := v_discount + abs((v_line ->> 'amount_cents')::integer);
    else
      v_subtotal := v_subtotal + (v_line ->> 'amount_cents')::integer;
    end if;
  end loop;

  v_total := v_subtotal - v_discount;
  if v_total <= 0 then
    raise exception 'a custom invoice must total more than zero';
  end if;

  v_number := public.allocate_invoice_number(v_issued);

  -- Born a draft so the lines can be attached; issued at the end. issued_at is computed once and
  -- used for both the number and the stamp, so a number allocated in one month can never carry an
  -- issue date in the next.
  insert into public.platform_invoices (
    number, tenant_id, subscription_id, kind, reason, status,
    subtotal_cents, discount_cents, tax_cents, total_cents,
    due_at, created_by, reconciliation
  ) values (
    v_number, p_tenant_id, p_subscription_id, 'custom', p_reason, 'draft',
    v_subtotal, v_discount, 0, v_total,
    p_due_at, p_created_by, 'not_applicable'
  ) returning id into v_id;

  -- platform_invoice_lines types quantity and included_qty as integer, where the CRM's table used
  -- numeric. The casts are to integer for that reason; a fractional quantity was never reachable
  -- from any caller, all of which pass whole units.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_reducing := (v_line ->> 'kind') in ('discount', 'credit');
    v_amount := abs((v_line ->> 'amount_cents')::integer);
    if v_reducing then v_amount := -v_amount; end if;

    insert into public.platform_invoice_lines (invoice_id, position, kind, label, quantity, included_qty, unit_cents, amount_cents)
    values (
      v_id, v_position,
      coalesce((v_line ->> 'kind')::public.invoice_line_kind, 'plan'),
      v_line ->> 'label',
      coalesce((v_line ->> 'quantity')::integer, 1),
      nullif(v_line ->> 'included_qty', '')::integer,
      coalesce((v_line ->> 'unit_cents')::integer, abs((v_line ->> 'amount_cents')::integer)),
      v_amount
    );
    v_position := v_position + 1;
  end loop;

  -- Issued, not paid: unlike an invoice generated from a collected payment, nobody has paid this
  -- yet. This is the only path that produces an unpaid invoice, which is what finally exercises
  -- overdue, void and the manual mark-as-paid flow.
  update public.platform_invoices
     set status = 'issued', issued_at = v_issued
   where id = v_id;

  return query select v_id, v_number, v_total;
end;
$function$;

-- create_invoice_for_payment -------------------------------------------------
create or replace function public.create_invoice_for_payment(
  p_tenant_id uuid,
  p_subscription_id uuid,
  p_provider text,
  p_provider_payment_id text,
  p_provider_total_cents integer,
  p_period_start timestamp with time zone,
  p_period_end timestamp with time zone,
  p_paid_at timestamp with time zone,
  p_lines jsonb
)
returns table(invoice_id uuid, number text, created boolean, reconciliation text)
language plpgsql
as $function$
declare
  v_existing       public.platform_invoices%rowtype;
  v_number         text;
  v_id             uuid;
  v_subtotal       integer := 0;
  v_discount       integer := 0;
  v_total          integer;
  v_reconciliation text;
  v_line           jsonb;
  v_position       integer := 0;
  v_at             timestamp with time zone := coalesce(p_paid_at, now());
  v_reducing       boolean;
  v_amount         integer;
begin
  select * into v_existing
    from public.platform_invoices
   where provider = p_provider and provider_payment_id = p_provider_payment_id;

  if found then
    return query select v_existing.id, v_existing.number, false, v_existing.reconciliation;
    return;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    if (v_line ->> 'kind') in ('discount', 'credit') then
      v_discount := v_discount + abs((v_line ->> 'amount_cents')::integer);
    else
      v_subtotal := v_subtotal + (v_line ->> 'amount_cents')::integer;
    end if;
  end loop;

  v_total := v_subtotal - v_discount;

  -- Tax is deliberately zero until a tax service is integrated (SA-3.2 out of scope).
  if p_provider_total_cents is null then
    v_reconciliation := 'not_applicable';
  elsif p_provider_total_cents = v_total then
    v_reconciliation := 'matched';
  else
    v_reconciliation := 'mismatched';
  end if;

  v_number := public.allocate_invoice_number(v_at);

  insert into public.platform_invoices (
    number, tenant_id, subscription_id, status, period_start, period_end,
    subtotal_cents, discount_cents, tax_cents, total_cents,
    provider, provider_payment_id, provider_total_cents, reconciliation
  ) values (
    v_number, p_tenant_id, p_subscription_id, 'draft', p_period_start, p_period_end,
    v_subtotal, v_discount, 0, v_total,
    p_provider, p_provider_payment_id, p_provider_total_cents, v_reconciliation
  ) returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_reducing := (v_line ->> 'kind') in ('discount', 'credit');
    v_amount := abs((v_line ->> 'amount_cents')::integer);
    if v_reducing then v_amount := -v_amount; end if;

    insert into public.platform_invoice_lines (
      invoice_id, position, kind, label, quantity, included_qty, unit_cents, amount_cents
    ) values (
      v_id,
      v_position,
      (v_line ->> 'kind')::public.invoice_line_kind,
      v_line ->> 'label',
      coalesce((v_line ->> 'quantity')::integer, 1),
      (v_line ->> 'included_qty')::integer,
      coalesce((v_line ->> 'unit_cents')::integer, 0),
      v_amount
    );
    v_position := v_position + 1;
  end loop;

  -- Paid on arrival: this invoice exists because money was already collected.
  update public.platform_invoices
     set status = 'paid', issued_at = v_at, paid_at = v_at
   where id = v_id;

  return query select v_id, v_number, true, v_reconciliation;
end;
$function$;

-- ── an invoice with a reducing line, end to end ─────────────────────────────
-- The assertion the last two migrations each needed and did not have: a line of every shape,
-- through the real function, read back, then removed. Each defect in this series was found by
-- running a verification suite rather than by the migration that introduced it.
do $$
declare
  v_tenant uuid;
  v_id uuid;
  v_total integer;
  v_sum integer;
  v_header integer;
begin
  select id into v_tenant from public.tenants order by created_at limit 1;
  if v_tenant is null then
    raise notice 'no tenant exists, so the end-to-end assertion was skipped';
    return;
  end if;

  select c.invoice_id, c.total_cents into v_id, v_total
    from public.create_custom_invoice(
      v_tenant, null, 'Migration self-check, rolled back', null, null,
      '[{"kind":"addon","label":"Seats","quantity":1,"unit_cents":1500,"amount_cents":1500},
        {"kind":"overage","label":"Minutes over","quantity":50,"included_qty":100,"unit_cents":4,"amount_cents":200},
        {"kind":"credit","label":"Account credit applied","quantity":1,"unit_cents":700,"amount_cents":700}]'::jsonb
    ) c;

  select coalesce(sum(amount_cents), 0) into v_sum from public.platform_invoice_lines where invoice_id = v_id;
  select total_cents into v_header from public.platform_invoices where id = v_id;

  -- The property the sign convention exists for, asserted rather than described.
  if v_sum <> v_header then
    raise exception 'the lines sum to % but the invoice asks for %', v_sum, v_header;
  end if;
  if v_total <> 1000 then
    raise exception 'expected 1500 + 200 - 700 = 1000, got %', v_total;
  end if;

  update public.platform_invoices set status = 'draft' where id = v_id;
  delete from public.platform_invoice_lines where invoice_id = v_id;
  delete from public.platform_invoices where id = v_id;
exception when others then
  if v_id is not null then
    update public.platform_invoices set status = 'draft' where id = v_id;
    delete from public.platform_invoice_lines where invoice_id = v_id;
    delete from public.platform_invoices where id = v_id;
  end if;
  raise;
end $$;
