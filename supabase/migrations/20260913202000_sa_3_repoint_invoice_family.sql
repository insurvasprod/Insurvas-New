-- ---------------------------------------------------------------------------
-- SA-3 finished renaming the tables and repointed almost nothing (backlog 189)
--
-- 20260911143000_sa_3_platform_invoices.sql moved this application's `invoices` and
-- `invoice_lines` out of the way of the organizations-era CRM's tables of the same name. The
-- tables moved. The things that referenced them did not:
--
--   four foreign keys      payments, credit_notes, pending_charges, period_billing_runs
--                          all still point their invoice_id at the CRM's `invoices`
--   six functions          still insert into, select from and update `public.invoices`
--                          and `public.invoice_lines`
--   one trigger guard      branches on tg_table_name = 'invoices', a name no table we own
--                          answers to any more, so the branch is dead code
--
-- The visible symptom is `null value in column "organization_id" of relation "invoices"` — this
-- application writing a row the CRM's NOT NULL column rejects. Five verification suites fail on
-- it, and `bill_subscription_period` cannot raise an invoice at all, which is why the period
-- billing run has never produced one.
--
-- Ownership was established per object before touching anything, because the rule from SA-3 is
-- that this application's objects move and nothing outside this repo changes:
--
--   ours     payments, credit_notes, pending_charges, period_billing_runs,
--            platform_invoices, platform_invoice_lines, and the six functions below
--   CRM's    invoices, invoice_lines, invoice_reconciliations, platform_credit_notes
--
-- `invoice_reconciliations` references the CRM's invoices and is the CRM's own; it is left
-- exactly as it is. `platform_credit_notes` is likewise the CRM's despite the name — it carries
-- organization_id — which is why our credit notes are still called `credit_notes` and were never
-- renamed: the name they would have moved to was already taken.
-- ---------------------------------------------------------------------------

-- ── preconditions ──────────────────────────────────────────────────────────
-- Asserted rather than assumed. If the CRM's invoices table has grown rows since this was
-- written, repointing a foreign key could orphan them and this must stop rather than guess.
do $$
declare
  v_crm_rows integer;
  v_bad integer;
begin
  select count(*) into v_crm_rows from public.invoices;
  if v_crm_rows > 0 then
    raise exception 'public.invoices (the CRM table) now has % row(s); repointing needs review first', v_crm_rows;
  end if;

  select count(*) into v_bad
    from public.payments p
   where p.invoice_id is not null
     and not exists (select 1 from public.platform_invoices i where i.id = p.invoice_id);
  if v_bad > 0 then
    raise exception '% payment(s) reference an invoice that is not in platform_invoices', v_bad;
  end if;

  select count(*) into v_bad
    from public.credit_notes c
   where c.invoice_id is not null
     and not exists (select 1 from public.platform_invoices i where i.id = c.invoice_id);
  if v_bad > 0 then
    raise exception '% credit note(s) reference an invoice that is not in platform_invoices', v_bad;
  end if;
end $$;

-- ── the four foreign keys ──────────────────────────────────────────────────
alter table public.payments drop constraint if exists payments_invoice_id_fkey;
alter table public.payments
  add constraint payments_invoice_id_fkey
  foreign key (invoice_id) references public.platform_invoices(id) on delete set null;

alter table public.credit_notes drop constraint if exists credit_notes_invoice_id_fkey;
-- RESTRICT, not SET NULL, because that is what this constraint already said. A credit note
-- whose invoice vanished is a credit note nobody can explain, and quietly relaxing the rule
-- while repointing it would be a behaviour change smuggled in under a rename.
alter table public.credit_notes
  add constraint credit_notes_invoice_id_fkey
  foreign key (invoice_id) references public.platform_invoices(id) on delete restrict;

alter table public.pending_charges drop constraint if exists pending_charges_invoice_id_fkey;
alter table public.pending_charges
  add constraint pending_charges_invoice_id_fkey
  foreign key (invoice_id) references public.platform_invoices(id) on delete set null;

alter table public.period_billing_runs drop constraint if exists period_billing_runs_invoice_id_fkey;
alter table public.period_billing_runs
  add constraint period_billing_runs_invoice_id_fkey
  foreign key (invoice_id) references public.platform_invoices(id) on delete set null;

-- ── the six functions ──────────────────────────────────────────────────────
-- Each is the live definition with `invoices` → `platform_invoices` and `invoice_lines` →
-- `platform_invoice_lines`, and nothing else changed. Diffing these against the bodies they
-- replace should show only the table names.

-- mark_overdue_invoices ------------------------------------------------------
create or replace function public.mark_overdue_invoices()
returns integer
language plpgsql
as $function$
declare v_count integer;
begin
  with moved as (
    update public.platform_invoices
       set status = 'overdue'
     where status = 'issued'
       and due_at is not null
       and due_at < now()
    returning 1
  )
  select count(*) into v_count from moved;

  return v_count;
end;
$function$;

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
  insert into public.platform_invoices (
    number, tenant_id, subscription_id, kind, reason, status,
    subtotal_cents, discount_cents, tax_cents, total_cents,
    issued_at, due_at, created_by, reconciliation
  ) values (
    v_number, p_tenant_id, p_subscription_id, 'custom', p_reason, 'issued',
    v_subtotal, v_discount, 0, v_total,
    now(), p_due_at, p_created_by, 'not_applicable'
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

  v_number := public.allocate_invoice_number(coalesce(p_paid_at, now()));

  insert into public.platform_invoices (
    number, tenant_id, subscription_id, status, period_start, period_end,
    subtotal_cents, discount_cents, tax_cents, total_cents,
    provider, provider_payment_id, provider_total_cents, reconciliation,
    issued_at, paid_at
  ) values (
    v_number, p_tenant_id, p_subscription_id, 'paid', p_period_start, p_period_end,
    v_subtotal, v_discount, 0, v_total,
    p_provider, p_provider_payment_id, p_provider_total_cents, v_reconciliation,
    coalesce(p_paid_at, now()), coalesce(p_paid_at, now())
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

  return query select v_id, v_number, true, v_reconciliation;
end;
$function$;

-- admin_settle_invoice_manually ----------------------------------------------
create or replace function public.admin_settle_invoice_manually(
  p_invoice_id uuid,
  p_amount_cents integer,
  p_reference text,
  p_paid_at timestamp with time zone,
  p_recorded_by uuid
)
returns table(payment_id uuid, invoice_status public.invoice_status, paid_cents integer,
              settled boolean, subscription_id uuid, subscription_activated boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_invoice public.platform_invoices%rowtype;
  v_paid    integer;
  v_payment uuid;
  v_settled boolean := false;
  v_activated boolean := false;
  v_sub public.subscriptions%rowtype;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'the amount must be more than zero' using errcode = 'check_violation';
  end if;

  -- Locked first: two admins recording against the same invoice must not both read the same
  -- "already paid" total and both decide there is room.
  select * into v_invoice from public.platform_invoices where id = p_invoice_id for update;
  if not found then raise exception 'invoice not found' using errcode = 'no_data_found'; end if;

  if v_invoice.status = 'paid' then
    raise exception 'this invoice is already paid' using errcode = 'check_violation';
  end if;
  if v_invoice.status = 'void' then
    raise exception 'a void invoice cannot be paid' using errcode = 'check_violation';
  end if;

  select coalesce(sum(p.amount_cents), 0)::integer into v_paid
    from public.payments p
   where p.invoice_id = p_invoice_id and p.status = 'succeeded';

  -- Refused rather than silently kept. Money we cannot account for on the invoice it was paid
  -- against is money that will be argued about later; converting the excess to tenant credit is a
  -- deliberate product decision, not something to do by accident.
  if v_paid + p_amount_cents > v_invoice.total_cents then
    raise exception 'that is more than the % cents still outstanding on this invoice',
      (v_invoice.total_cents - v_paid) using errcode = 'check_violation';
  end if;

  insert into public.payments
    (invoice_id, tenant_id, amount_cents, method, manual_reference, recorded_by, paid_at, status)
  values
    (p_invoice_id, v_invoice.tenant_id, p_amount_cents, 'manual_bank_transfer', p_reference,
     p_recorded_by, coalesce(p_paid_at, now()), 'succeeded')
  returning id into v_payment;

  v_paid := v_paid + p_amount_cents;
  v_settled := v_paid >= v_invoice.total_cents;

  if v_settled then
    update public.platform_invoices
       set status = 'paid', paid_at = coalesce(p_paid_at, now())
     where id = p_invoice_id;

    -- ONLY the invoice's own subscription, and only when the invoice has one. A custom invoice
    -- raised without a subscription link settles without touching anybody's access.
    if v_invoice.subscription_id is not null then
      select * into v_sub from public.subscriptions
       where id = v_invoice.subscription_id for update;

      -- Paying a bill clears a lapse; it does not undo a cancellation. Reviving a cancelled
      -- subscription is the same act M2-5 refuses through the pause/resume path.
      if found and v_sub.status in ('past_due', 'suspended') then
        update public.subscriptions set status = 'active' where id = v_sub.id;
        v_activated := true;
      end if;
    end if;
  end if;

  return query select
    v_payment,
    (case when v_settled then 'paid'::public.invoice_status else v_invoice.status end),
    v_paid,
    v_settled,
    v_invoice.subscription_id,
    v_activated;
end;
$function$;

-- enforce_billing_tenant_relationships ---------------------------------------
--
-- The branch read `tg_table_name = 'invoices'`. After the rename no table this application owns
-- answers to that name, so the branch could never fire — and because the trigger was only ever
-- attached to `credit_notes`, the invoice half of this guard has never run at all. Both branches
-- are corrected and the invoice trigger is attached below, which is the first time an invoice's
-- subscription is actually checked to belong to the invoice's tenant.
create or replace function public.enforce_billing_tenant_relationships()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_tenant_id uuid;
  v_related_id uuid;
begin
  if tg_table_name = 'platform_invoices' then
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
      select i.tenant_id into v_tenant_id from public.platform_invoices i where i.id = v_related_id;
      if not found then raise exception 'The credit note invoice does not exist.'; end if;
      if v_tenant_id <> (to_jsonb(new) ->> 'tenant_id')::uuid then
        raise exception 'The credit note invoice belongs to another tenant.';
      end if;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists platform_invoices_tenant_relationship_guard on public.platform_invoices;
create trigger platform_invoices_tenant_relationship_guard
  before insert or update on public.platform_invoices
  for each row execute function public.enforce_billing_tenant_relationships();

-- bill_subscription_period ---------------------------------------------------
-- Two references: the invoice number read back for an already-billed period, and the stamp that
-- records which period the invoice covers. Both named the CRM's table, and the second is why the
-- period billing run could never complete — create_custom_invoice returned an id from
-- platform_invoices and the very next statement looked for it in `invoices`.
create or replace function public.bill_subscription_period(
  p_subscription_id uuid,
  p_period_start timestamp with time zone,
  p_period_end timestamp with time zone,
  p_lines jsonb,
  p_pending_ids uuid[],
  p_reason text,
  p_credit_cents integer default 0,
  p_due_at timestamp with time zone default null,
  p_created_by uuid default null
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
  update platform_invoices
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
$function$;

-- ── the CRM is untouched, and nothing of ours still points at it ────────────
do $$
declare
  v_left text;
  v_crm_rows integer;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_left
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and p.proname in ('mark_overdue_invoices', 'create_custom_invoice', 'create_invoice_for_payment',
                       'admin_settle_invoice_manually', 'enforce_billing_tenant_relationships',
                       'bill_subscription_period')
     and pg_get_functiondef(p.oid) ~ '(public\.)?invoices\M'
     and pg_get_functiondef(p.oid) !~ 'platform_invoices';
  if v_left is not null then
    raise exception 'still pointing at the CRM invoices table: %', v_left;
  end if;

  if (select count(*) from pg_constraint con
        join pg_class src on src.oid = con.conrelid
        join pg_class tgt on tgt.oid = con.confrelid
       where con.contype = 'f' and tgt.relname = 'invoices'
         and src.relname in ('payments', 'credit_notes', 'pending_charges', 'period_billing_runs')) > 0 then
    raise exception 'a foreign key of ours still references the CRM invoices table';
  end if;

  -- The CRM's own reference to its own table is deliberately left alone.
  if not exists (select 1 from pg_constraint con
                   join pg_class src on src.oid = con.conrelid
                   join pg_class tgt on tgt.oid = con.confrelid
                  where con.contype = 'f' and tgt.relname = 'invoices'
                    and src.relname = 'invoice_reconciliations') then
    raise exception 'invoice_reconciliations lost its foreign key, and that one is the CRM own';
  end if;

  select count(*) into v_crm_rows from public.invoices;
  if v_crm_rows <> 0 then
    raise exception 'the CRM invoices table changed during this migration (% rows)', v_crm_rows;
  end if;
end $$;
