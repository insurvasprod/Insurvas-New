-- ---------------------------------------------------------------------------
-- Waiving an overage before the invoice is issued (backlog 44)
--
-- Backlog 44 lists four things a period invoice must gather: attached add-ons, metered overage,
-- pending proration, and "any billing-admin waiver that must remove an overage line before issue".
-- The first three have been assembled since 0017_period_billing.sql. The waiver had no model at
-- all, so the only way to forgive an overage was to let the invoice be raised and then issue a
-- credit note against it — which is a different thing with a different paper trail, and leaves the
-- customer holding a bill for something we had already agreed not to charge.
--
-- What a waiver is here:
--
--   scoped to one meter          a waiver names the meter it forgives. A blanket "waive all
--                                overage" is a much larger act than it looks and is expressible
--                                as several rows, each with its own reason.
--
--   scoped to one period         period_start is required. The failure mode of this feature
--                                everywhere it exists is a waiver granted once for a bad month
--                                and then quietly forgiving every month after it, which nobody
--                                notices because the line simply stops appearing.
--
--   capped or complete           max_cents null forgives the whole overage line; a number
--                                forgives up to that many cents and bills the rest.
--
--   spent once                   consumed_at and invoice_id are stamped by the billing run. A
--                                waiver cannot be applied twice, and afterwards the invoice it
--                                was spent on can be named.
--
-- The invoice keeps the overage line and carries a separate discount line for the waiver, rather
-- than having the overage quietly removed. The customer's invoice should say "you used 400 SMS
-- over your allowance, and we are not charging you for it" — that is a better document than one
-- that silently omits the usage, and it is the only version we can still audit a year later. The
-- net is identical.
-- ---------------------------------------------------------------------------

create table if not exists public.billing_waivers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  meter_key text not null,
  period_start timestamp with time zone not null,
  -- Null forgives the whole line. A number forgives up to that many cents.
  max_cents integer,
  reason text not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  consumed_at timestamp with time zone,
  invoice_id uuid references public.platform_invoices(id) on delete set null,
  constraint billing_waivers_max_cents_positive check (max_cents is null or max_cents > 0),
  constraint billing_waivers_reason_present check (length(trim(reason)) >= 5),
  -- One waiver per meter per period. Two waivers for the same overage is an argument, not a
  -- policy; a billing admin who wants a different amount edits the one that is there.
  constraint billing_waivers_one_per_meter_per_period unique (subscription_id, period_start, meter_key)
);

comment on table public.billing_waivers is
  'A billing admin forgiving some or all of one meter''s overage for one billing period, applied by the period billing run before the invoice is issued.';

create index if not exists billing_waivers_pending_idx
  on public.billing_waivers (subscription_id, period_start)
  where consumed_at is null;

-- Service-role only, like the rest of the billing plane. Nothing in the tenant app may read or
-- write a waiver: it is an act performed by the platform's billing admin, on the platform's side.
revoke all on public.billing_waivers from anon, authenticated, tenant_app, public;
grant select, insert, update, delete on public.billing_waivers to service_role;

-- ---------------------------------------------------------------------------
-- bill_subscription_period, now spending the waivers it was given
--
-- Dropped and recreated rather than given a defaulted tenth parameter: a defaulted parameter
-- leaves the nine-argument signature in place, and PostgREST resolves overloads by the names in
-- the request body, so the old one would still be reachable and would silently skip the waivers.
-- One signature, no ambiguity.
-- ---------------------------------------------------------------------------
drop function if exists public.bill_subscription_period(uuid, timestamptz, timestamptz, jsonb, uuid[], text, integer, timestamptz, uuid);

create function public.bill_subscription_period(
  p_subscription_id uuid,
  p_period_start timestamp with time zone,
  p_period_end timestamp with time zone,
  p_lines jsonb,
  p_pending_ids uuid[],
  p_reason text,
  p_credit_cents integer default 0,
  p_due_at timestamp with time zone default null,
  p_created_by uuid default null,
  p_waiver_ids uuid[] default '{}'::uuid[]
)
returns table(invoice_id uuid, invoice_number text, total_cents integer, line_count integer, already_billed boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_existing period_billing_runs%rowtype;
  v_tenant uuid;
  v_subtotal integer := 0;
  v_discount integer := 0;
  v_total integer;
  v_count integer;
  v_invoice uuid;
  v_number text;
  v_line jsonb;
begin
  -- Lock the subscription so two concurrent runs serialise on this row rather than racing to
  -- insert the same ledger key.
  select tenant_id into v_tenant from subscriptions where id = p_subscription_id for update;
  if not found then
    raise exception 'subscription_not_found' using errcode = 'no_data_found';
  end if;

  select * into v_existing
  from period_billing_runs
  where subscription_id = p_subscription_id and period_start = p_period_start;

  if found then
    return query
      select v_existing.invoice_id,
             (select i.number from platform_invoices i where i.id = v_existing.invoice_id),
             v_existing.total_cents, v_existing.line_count, true;
    return;
  end if;

  v_count := coalesce(jsonb_array_length(p_lines), 0);

  -- Same arithmetic create_custom_invoice uses, so the decision to raise an invoice and the
  -- invoice's own total can never disagree: discount and credit lines carry a positive amount and
  -- subtract from the subtotal.
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if (v_line ->> 'kind') in ('discount', 'credit') then
      v_discount := v_discount + abs((v_line ->> 'amount_cents')::integer);
    else
      v_subtotal := v_subtotal + (v_line ->> 'amount_cents')::integer;
    end if;
  end loop;
  v_total := v_subtotal - v_discount;

  -- Nothing extra this period. Record the run and stop — a zero-value invoice is noise in the
  -- customer's history and in ours.
  if v_count = 0 then
    insert into period_billing_runs (subscription_id, period_start, period_end, total_cents, line_count, note)
    values (p_subscription_id, p_period_start, p_period_end, 0, 0, 'Nothing beyond the plan to bill.');
    return query select null::uuid, null::text, 0, 0, false;
    return;
  end if;

  -- Charges fully covered by credit, or fully waived. The pending charges are still settled — they
  -- were accounted for, just not with money — but no invoice is raised, because an invoice for
  -- zero or less is not a thing to send anybody. Unspent credit stays on the balance, which is why
  -- the caller clamps the credit line to the subtotal rather than letting it run negative.
  if v_total <= 0 then
    insert into period_billing_runs (subscription_id, period_start, period_end, total_cents, line_count, note)
    values (p_subscription_id, p_period_start, p_period_end, v_total, v_count,
            'Charges were fully covered by credit or waived, so no invoice was raised.');

    update pending_charges
    set invoice_id = null, billed_at = now()
    where id = any(coalesce(p_pending_ids, '{}'::uuid[]));

    -- A waiver spent on a period that raised no invoice is still spent. Leaving it unconsumed
    -- would forgive the same overage again on the next period that does produce one.
    update billing_waivers
    set consumed_at = now(), invoice_id = null
    where id = any(coalesce(p_waiver_ids, '{}'::uuid[])) and consumed_at is null;

    if coalesce(p_credit_cents, 0) > 0 then
      perform adjust_tenant_credit(v_tenant, -p_credit_cents);
    end if;

    return query select null::uuid, null::text, v_total, v_count, false;
    return;
  end if;

  select c.invoice_id, c.number into v_invoice, v_number
  from create_custom_invoice(v_tenant, p_subscription_id, p_reason, p_due_at, p_created_by, p_lines) c;

  -- create_custom_invoice does not know about billing periods; stamping them here is what makes
  -- the invoice say which period it covers rather than merely when it was raised.
  update platform_invoices
  set period_start = p_period_start, period_end = p_period_end
  where id = v_invoice;

  -- Settle the pending charges against THIS invoice, in the same transaction. Had the invoice
  -- rolled back, these would roll back with it.
  update pending_charges
  set invoice_id = v_invoice, billed_at = now()
  where id = any(coalesce(p_pending_ids, '{}'::uuid[]));

  -- Same transaction, same reason: a waiver marked spent against an invoice that never committed
  -- would forgive an overage nobody was ever charged for, and the real one would arrive next
  -- period at full price.
  update billing_waivers
  set consumed_at = now(), invoice_id = v_invoice
  where id = any(coalesce(p_waiver_ids, '{}'::uuid[])) and consumed_at is null;

  -- Spend the credit in the same transaction that bills it. Deducting from TypeScript after the
  -- RPC returned would mean a crash in between leaves a customer's invoice discounted by credit
  -- they still hold — we would have given the discount away twice.
  if coalesce(p_credit_cents, 0) > 0 then
    perform adjust_tenant_credit(v_tenant, -p_credit_cents);
  end if;

  insert into period_billing_runs (subscription_id, period_start, period_end, invoice_id, total_cents, line_count)
  values (p_subscription_id, p_period_start, p_period_end, v_invoice, v_total, v_count);

  return query select v_invoice, v_number, v_total, v_count, false;
end;
$function$;

revoke all on function public.bill_subscription_period(uuid, timestamptz, timestamptz, jsonb, uuid[], text, integer, timestamptz, uuid, uuid[])
  from public, anon, authenticated, tenant_app;
grant execute on function public.bill_subscription_period(uuid, timestamptz, timestamptz, jsonb, uuid[], text, integer, timestamptz, uuid, uuid[])
  to service_role;

-- ── one signature, and the tenant plane cannot see a waiver ─────────────────
do $$
declare v_count integer;
begin
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bill_subscription_period';
  if v_count <> 1 then
    raise exception 'bill_subscription_period has % signatures; the old one must not survive', v_count;
  end if;

  if has_table_privilege('tenant_app', 'public.billing_waivers', 'select') then
    raise exception 'tenant_app can read billing_waivers';
  end if;
  if has_table_privilege('authenticated', 'public.billing_waivers', 'select') then
    raise exception 'authenticated can read billing_waivers';
  end if;
  if not has_table_privilege('service_role', 'public.billing_waivers', 'insert') then
    raise exception 'service_role cannot write billing_waivers';
  end if;
end $$;
