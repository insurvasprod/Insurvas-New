-- Period billing: the run that turns add-ons, overage, proration and credit into one invoice.
--
-- Backlog #41, #44 and #46 are three descriptions of the same hole. SA-3.4 built exact proration
-- and nothing called it. SA-3.7 built create_custom_invoice and nothing called it. SA-3.8 recorded
-- credit balances and nothing spent them. Each piece works; none of them were joined, so today a
-- tenant with add-ons is billed for their plan alone, overage is free, and a mid-period upgrade
-- charges nobody the difference.
--
-- Two tables close it.

-- ---------------------------------------------------------------------------
-- pending_charges — things owed that have no invoice yet
--
-- A mid-period upgrade is the motivating case: the customer owes the difference NOW, but raising a
-- separate invoice for $122.58 the moment someone clicks Change Plan is both noisy and worse for
-- the customer than one line on their next invoice. So the amount is parked here and collected at
-- the next period rollover.
--
-- Deliberately general rather than a proration-only table. Anything that needs to reach an invoice
-- later — a one-off adjustment, a negotiated discount, a manual correction — is the same shape,
-- and a second table for each would be four tables doing one job.
-- ---------------------------------------------------------------------------
create table if not exists public.pending_charges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,

  kind invoice_line_kind not null,
  label text not null,
  quantity numeric(14,4) not null default 1,
  included_qty numeric(14,4),
  unit_cents integer not null default 0,

  -- Signed. A proration credit on a downgrade is negative, and netting happens on the invoice
  -- rather than here, so both halves of a plan change stay legible as separate rows.
  amount_cents integer not null,

  -- Why this exists, in words that can appear in an audit trail.
  reason text not null,

  created_at timestamptz not null default now(),
  created_by uuid references public.admin_users (id) on delete set null,

  -- Set when the charge lands on an invoice. Null means still owed.
  invoice_id uuid references public.invoices (id) on delete set null,
  billed_at timestamptz,

  -- A row cannot be half-billed: either both are set or neither is.
  constraint pending_charges_billed_together
    check ((invoice_id is null) = (billed_at is null))
);

-- The billing run's hot path: unbilled charges for one subscription.
create index if not exists pending_charges_unbilled_idx
  on public.pending_charges (subscription_id)
  where billed_at is null;

create index if not exists pending_charges_tenant_idx
  on public.pending_charges (tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- period_billing_runs — the idempotency ledger
--
-- This is what makes the job safe to schedule. A cron that runs twice, a retry after a network
-- failure, or an operator running the script by hand while the scheduler fires must not bill a
-- customer twice. The primary key is the guarantee: one row per subscription per period, inserted
-- in the same breath as the invoice.
--
-- A row with a null invoice_id is a real outcome, not a failure — it records "we looked at this
-- period and there was nothing extra to bill", which is the common case and must still be
-- remembered, otherwise every run would re-examine every period forever.
-- ---------------------------------------------------------------------------
create table if not exists public.period_billing_runs (
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,

  invoice_id uuid references public.invoices (id) on delete set null,
  total_cents integer not null default 0,
  line_count integer not null default 0,

  -- Set when the run decided not to raise an invoice, so the reason survives.
  note text,

  ran_at timestamptz not null default now(),

  constraint period_billing_runs_pkey primary key (subscription_id, period_start)
);

create index if not exists period_billing_runs_recent_idx
  on public.period_billing_runs (ran_at desc);

-- ---------------------------------------------------------------------------
-- bill_subscription_period — assemble one invoice, or record that there was nothing to bill
--
-- In the database rather than in TypeScript because the ledger row and the invoice must be created
-- together. Split across two round trips, a crash between them either bills a customer with no
-- record that it happened (so the next run bills again) or records a run that never produced the
-- invoice. One function, one transaction, neither failure possible.
--
-- It calls create_custom_invoice rather than inserting an invoice itself. That function already
-- owns the gap-free number sequence and the subtotal/discount split — a second implementation of
-- either would drift, and the one that drifts silently is the numbering.
--
-- Returns the existing row untouched when the period has already been billed, so the caller can
-- run it as often as it likes.
-- ---------------------------------------------------------------------------
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
set search_path = public
as $$
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
             (select i.number from invoices i where i.id = v_existing.invoice_id),
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

  -- Charges fully covered by credit. The pending charges are still settled — they were paid, just
  -- not with money — but no invoice is raised, because an invoice for zero or less is not a thing
  -- to send anybody. Unspent credit stays on the balance, which is why the caller clamps the
  -- credit line to the subtotal rather than letting it run negative.
  if v_total <= 0 then
    insert into period_billing_runs (subscription_id, period_start, period_end, total_cents, line_count, note)
    values (p_subscription_id, p_period_start, p_period_end, v_total, v_count,
            'Charges were fully covered by credit, so no invoice was raised.');

    update pending_charges
    set invoice_id = null, billed_at = now()
    where id = any(coalesce(p_pending_ids, '{}'::uuid[]));

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
  update invoices
  set period_start = p_period_start, period_end = p_period_end
  where id = v_invoice;

  -- Settle the pending charges against THIS invoice, in the same transaction. Had the invoice
  -- rolled back, these would roll back with it.
  update pending_charges
  set invoice_id = v_invoice, billed_at = now()
  where id = any(coalesce(p_pending_ids, '{}'::uuid[]));

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
$$;

-- ---------------------------------------------------------------------------
-- Access
--
-- Same posture as every other table here: RLS on with no policy, so the only way in is the service
-- role through the admin plane. The agent app has no business reading what a tenant will be billed
-- before the invoice exists.
-- ---------------------------------------------------------------------------
alter table public.pending_charges enable row level security;
alter table public.period_billing_runs enable row level security;

revoke all on public.pending_charges from anon, authenticated, tenant_app, public;
revoke all on public.period_billing_runs from anon, authenticated, tenant_app, public;
grant select, insert, update on public.pending_charges to service_role;
grant select, insert, update on public.period_billing_runs to service_role;

revoke all on function public.bill_subscription_period(uuid, timestamptz, timestamptz, jsonb, uuid[], text, integer, timestamptz, uuid)
  from public, anon, authenticated, tenant_app;
grant execute on function public.bill_subscription_period(uuid, timestamptz, timestamptz, jsonb, uuid[], text, integer, timestamptz, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- create_custom_invoice — carry included_qty onto the line
--
-- The original dropped it. That was harmless while every custom invoice was typed by a human, and
-- is not harmless now: an overage line's whole claim is "you used 150 of your 100", and without
-- included_qty the invoice says "you used 50 extra" with nothing to check it against. The column
-- has been on invoice_lines since SA-3.2; only this function failed to fill it.
--
-- Identical to the original in every other respect.
-- ---------------------------------------------------------------------------
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

  v_number := public.allocate_invoice_number(now());

  -- Issued, not paid: unlike an invoice generated from a collected payment, nobody has paid this
  -- yet. This is the only path that produces an unpaid invoice, which is what finally exercises
  -- overdue, void and the manual mark-as-paid flow.
  insert into public.invoices (
    number, tenant_id, subscription_id, kind, reason, status,
    subtotal_cents, discount_cents, tax_cents, total_cents,
    issued_at, due_at, created_by, reconciliation
  ) values (
    v_number, p_tenant_id, p_subscription_id, 'custom', p_reason, 'issued',
    v_subtotal, v_discount, 0, v_total,
    now(), p_due_at, p_created_by, 'not_applicable'
  ) returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into public.invoice_lines (invoice_id, position, kind, label, quantity, included_qty, unit_cents, amount_cents)
    values (
      v_id, v_position,
      coalesce((v_line ->> 'kind')::public.invoice_line_kind, 'plan'),
      v_line ->> 'label',
      coalesce((v_line ->> 'quantity')::numeric, 1),
      nullif(v_line ->> 'included_qty', '')::numeric,
      coalesce((v_line ->> 'unit_cents')::integer, (v_line ->> 'amount_cents')::integer),
      (v_line ->> 'amount_cents')::integer
    );
    v_position := v_position + 1;
  end loop;

  return query select v_id, v_number, v_total;
end;
$function$;
