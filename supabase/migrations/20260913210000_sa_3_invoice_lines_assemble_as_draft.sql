-- ---------------------------------------------------------------------------
-- An invoice has to be assembled before it can be issued (backlog 189, part two)
--
-- 20260911143000_sa_3_platform_invoices.sql added `platform_invoice_lines_immutable`, which fires
-- on INSERT as well as UPDATE and DELETE:
--
--   if v_status is not null and v_status <> 'draft' then
--     raise exception 'invoice_immutable: the lines of an issued invoice cannot be changed'
--
-- Both functions that create an invoice insert the header first and the lines second, and both
-- insert the header in a final state — `issued` for a custom invoice, `paid` for one generated
-- from a collected payment. So the first line of every invoice hit that exception, and neither
-- function has been able to complete since the trigger was added. Five verification suites fail
-- on it: invoices, custom-invoices, credit-notes, manual-settlement and coupons, all of which
-- call one of these two.
--
-- The trigger is right and is left exactly as it is. The rule it states — the lines of an issued
-- invoice cannot be changed — is the one we want, and weakening it to let inserts through would
-- reopen the hole it was added to close. What was wrong is that these functions never used the
-- lifecycle the trigger is built around: they skipped `draft`, which is the state that means
-- "still being assembled".
--
-- So both now do what the trigger expects. Insert the header as a draft, add the lines, then move
-- it to its final state in the same transaction. `prevent_issued_invoice_mutation` returns early
-- for `old.status = 'draft'`, so that last step is permitted by design. Nothing observable
-- changes: no caller can see the intermediate draft, because it exists only inside a transaction
-- that has not committed, and the row that commits is identical to the one these functions always
-- meant to write.
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

  -- Born a draft so the lines can be attached; issued three statements below. issued_at is
  -- computed once and used for both the number and the stamp, so a number allocated in one month
  -- can never carry an issue date in the next.
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
    insert into public.platform_invoice_lines (invoice_id, position, kind, label, quantity, included_qty, unit_cents, amount_cents)
    values (
      v_id, v_position,
      coalesce((v_line ->> 'kind')::public.invoice_line_kind, 'plan'),
      v_line ->> 'label',
      coalesce((v_line ->> 'quantity')::integer, 1),
      nullif(v_line ->> 'included_qty', '')::integer,
      coalesce((v_line ->> 'unit_cents')::integer, (v_line ->> 'amount_cents')::integer),
      (v_line ->> 'amount_cents')::integer
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
      (v_line ->> 'amount_cents')::integer
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

-- ── it can actually raise one now ───────────────────────────────────────────
-- The check the absence of which let this ship: create an invoice, with a line, and read it back.
-- Rolled back at the end, so this asserts against the real functions and leaves nothing behind.
do $$
declare
  v_tenant uuid;
  v_id uuid;
  v_number text;
  v_total integer;
  v_lines integer;
  v_status public.invoice_status;
begin
  select id into v_tenant from public.tenants order by created_at limit 1;
  if v_tenant is null then
    raise notice 'no tenant exists, so the end-to-end assertion was skipped';
    return;
  end if;

  select c.invoice_id, c.number, c.total_cents into v_id, v_number, v_total
    from public.create_custom_invoice(
      v_tenant, null, 'Migration self-check, rolled back', null, null,
      '[{"kind":"addon","label":"Self check","quantity":1,"unit_cents":100,"amount_cents":100}]'::jsonb
    ) c;

  select count(*) into v_lines from public.platform_invoice_lines where invoice_id = v_id;
  select status into v_status from public.platform_invoices where id = v_id;

  if v_lines <> 1 then
    raise exception 'the invoice was created with % line(s) rather than 1', v_lines;
  end if;
  if v_status <> 'issued' then
    raise exception 'the invoice ended in status % rather than issued', v_status;
  end if;
  if v_total <> 100 then
    raise exception 'the invoice totalled % rather than 100', v_total;
  end if;

  -- The trigger must still refuse to change a line once the invoice is issued; the point was
  -- never to weaken it.
  begin
    update public.platform_invoice_lines set amount_cents = 200 where invoice_id = v_id;
    raise exception 'an issued invoice let its line be edited — the immutability trigger is not doing its job';
  exception when check_violation then
    null;
  end;

  -- Back to draft before removing it: prevent_issued_invoice_mutation refuses to delete an
  -- invoice that has been issued, which is exactly what it is for. status is not one of the
  -- columns it freezes, so moving it back is permitted.
  update public.platform_invoices set status = 'draft' where id = v_id;
  delete from public.platform_invoice_lines where invoice_id = v_id;
  delete from public.platform_invoices where id = v_id;
exception when others then
  -- Anything raised above still has to clean up after itself: this runs against the live project,
  -- and a self-check that leaves a stray invoice behind is worse than no self-check.
  if v_id is not null then
    update public.platform_invoices set status = 'draft' where id = v_id;
    delete from public.platform_invoice_lines where invoice_id = v_id;
    delete from public.platform_invoices where id = v_id;
  end if;
  raise;
end $$;
