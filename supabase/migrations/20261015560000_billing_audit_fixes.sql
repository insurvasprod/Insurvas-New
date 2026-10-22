-- Billing audit fixes (2026-10-15) — SA-3.2 / 3.3 / 3.4 / 3.7 / 3.8.
--
-- 1. settle_invoice_from_provider — a payment.succeeded for one of OUR pay-online invoices (custom or
--    period invoices pushed to Whop by lib/billing/collect.ts) settles that invoice. Before this the
--    payment carried no plan metadata, the webhook threw plan_not_ours, Whop retried for days, and
--    the invoice stayed unpaid — a suspended tenant stayed suspended. Same rules as
--    admin_settle_invoice_manually (only the invoice's own subscription is reactivated, and only
--    from past_due/suspended), except that money which has ALREADY moved is never refused: an
--    over-payment or a payment against a void invoice is recorded and reported, not thrown away.
--
-- 2. request_credit_note — the approval threshold is checked against the CUMULATIVE refunds on the
--    invoice, not each refund alone. Two $499 refunds on a $998 invoice no longer skip the $500
--    second approver. Serialised per invoice so two concurrent requests cannot both read "nothing
--    refunded yet". A missing threshold now refuses instead of comparing against null (which
--    approved everything).
--
-- 3. prevent_issued_invoice_mutation — after issue only the lifecycle moves, and only forwards:
--    issued → paid | overdue | void | uncollectible; overdue → paid | void | uncollectible;
--    uncollectible → paid | void; paid and void are final. Nothing goes back to draft (that was the
--    hole: paid → draft → edit or DELETE). An invoice with money on it cannot be voided.
--    service_role loses DELETE and TRUNCATE on the invoice tables (TRUNCATE bypasses row triggers).
--
-- Redefined from the LIVE definitions (pg_get_functiondef, read 2026-10-15).
--
-- Rollback: re-run the previous definitions of request_credit_note and
-- prevent_issued_invoice_mutation (20260911143000 / the live text quoted in the audit), drop
-- settle_invoice_from_provider(uuid, uuid, text, text, integer, timestamptz), and
-- grant delete, truncate on public.platform_invoices, public.platform_invoice_lines to service_role.

-- ─── 1 · settle a pay-online invoice from the provider's payment ───

create or replace function public.settle_invoice_from_provider(
  p_tenant_id uuid,
  p_local_invoice_id uuid,
  p_provider_invoice_id text,
  p_provider_payment_id text,
  p_amount_cents integer,
  p_paid_at timestamptz
)
returns table (
  invoice_id uuid,
  invoice_number text,
  tenant_id uuid,
  invoice_status public.invoice_status,
  paid_cents integer,
  settled boolean,
  payment_recorded boolean,
  subscription_id uuid,
  subscription_activated boolean,
  anomaly text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.platform_invoices%rowtype;
  v_paid integer;
  v_inserted uuid;
  v_settled boolean := false;
  v_activated boolean := false;
  v_anomaly text;
  v_sub public.subscriptions%rowtype;
begin
  if p_provider_payment_id is null or length(btrim(p_provider_payment_id)) = 0 then
    raise exception 'a provider payment id is required' using errcode = 'check_violation';
  end if;
  if p_amount_cents is null or p_amount_cents < 0 then
    raise exception 'the amount must be zero or more' using errcode = 'check_violation';
  end if;

  if p_local_invoice_id is not null then
    select * into v_invoice from public.platform_invoices i where i.id = p_local_invoice_id for update;
  end if;
  if v_invoice.id is null and p_provider_invoice_id is not null then
    select * into v_invoice from public.platform_invoices i
     where i.provider_invoice_id = p_provider_invoice_id
     order by i.created_at desc
     limit 1
     for update;
  end if;

  -- Not one of ours: no row, and the caller decides what that means.
  if v_invoice.id is null then
    return;
  end if;

  -- The event was attributed to one tenant and names another tenant's invoice. Settling it would
  -- change the wrong customer's books and access, so refuse loudly.
  if p_tenant_id is not null and p_tenant_id <> v_invoice.tenant_id then
    raise exception 'payment % names invoice % of another tenant', p_provider_payment_id, v_invoice.number
      using errcode = 'check_violation';
  end if;

  insert into public.payments
    (invoice_id, tenant_id, amount_cents, method, provider, provider_charge_id, paid_at, status)
  values
    (v_invoice.id, v_invoice.tenant_id, p_amount_cents, 'provider', 'whop', p_provider_payment_id,
     coalesce(p_paid_at, now()), 'succeeded')
  on conflict (provider, provider_charge_id) where provider_charge_id is not null do nothing
  returning id into v_inserted;

  -- Recorded earlier without an invoice (the subscription path's recordPayment): attach it.
  if v_inserted is null then
    update public.payments p
       set invoice_id = v_invoice.id
     where p.provider = 'whop' and p.provider_charge_id = p_provider_payment_id
       and p.invoice_id is null and p.tenant_id = v_invoice.tenant_id;
  end if;

  select coalesce(sum(p.amount_cents), 0)::integer into v_paid
    from public.payments p
   where p.invoice_id = v_invoice.id and p.status = 'succeeded';

  if v_invoice.status = 'void' then
    v_anomaly := 'paid_after_void';
  elsif v_invoice.status = 'paid' then
    if v_inserted is not null then v_anomaly := 'paid_twice'; end if;
  elsif v_paid >= v_invoice.total_cents then
    update public.platform_invoices i
       set status = 'paid',
           paid_at = coalesce(p_paid_at, now()),
           provider = coalesce(i.provider, 'whop'),
           provider_payment_id = coalesce(i.provider_payment_id, p_provider_payment_id)
     where i.id = v_invoice.id;
    v_settled := true;
    if v_paid > v_invoice.total_cents then v_anomaly := 'overpaid'; end if;

    -- Same rule as admin_settle_invoice_manually: only the invoice's own subscription, and paying a
    -- bill clears a lapse — it does not undo a cancellation.
    if v_invoice.subscription_id is not null then
      select * into v_sub from public.subscriptions s where s.id = v_invoice.subscription_id for update;
      if found and v_sub.status in ('past_due', 'suspended') then
        update public.subscriptions s set status = 'active' where s.id = v_sub.id;
        v_activated := true;
      end if;
    end if;
  end if;

  return query select
    v_invoice.id,
    v_invoice.number,
    v_invoice.tenant_id,
    (case when v_settled then 'paid'::public.invoice_status else v_invoice.status end),
    v_paid,
    v_settled,
    v_inserted is not null,
    v_invoice.subscription_id,
    v_activated,
    v_anomaly;
end;
$$;

revoke all on function public.settle_invoice_from_provider(uuid, uuid, text, text, integer, timestamptz)
  from public, anon, authenticated, tenant_app;
grant execute on function public.settle_invoice_from_provider(uuid, uuid, text, text, integer, timestamptz)
  to service_role;

-- ─── 2 · refund approval on the cumulative refunded total ───

create or replace function public.request_credit_note(
  p_tenant_id uuid,
  p_invoice_id uuid,
  p_type public.credit_note_type,
  p_amount_cents integer,
  p_reason_code public.credit_reason,
  p_reason_text text,
  p_requested_by uuid,
  p_threshold_cents integer
)
returns table (credit_note_id uuid, number text, status public.credit_note_status)
language plpgsql
as $$
declare
  v_number text;
  v_id     uuid;
  v_status public.credit_note_status;
  v_prior  integer := 0;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'a credit note must be for more than zero';
  end if;
  if p_threshold_cents is null or p_threshold_cents < 0 then
    raise exception 'the refund approval threshold is not set';
  end if;

  -- Only a refund moves money, so only a refund is gated. A credit or a waiver costs revenue but
  -- cannot drain the bank account, which is what the threshold protects.
  if p_type = 'refund' and p_invoice_id is not null then
    -- One request per invoice at a time, so two concurrent requests cannot both read the same
    -- "already refunded" total and each slip under the threshold.
    perform pg_advisory_xact_lock(hashtextextended('request_credit_note:' || p_invoice_id::text, 0));

    -- Everything already asked for against this invoice that has not been refused or failed:
    -- pending, approved, in flight and done all count. Splitting one refund into several small
    -- ones must not dodge the second approver.
    select coalesce(sum(cn.amount_cents), 0)::integer into v_prior
      from public.credit_notes cn
     where cn.invoice_id = p_invoice_id
       and cn.type = 'refund'
       and cn.status not in ('failed', 'rejected');
  end if;

  if p_type = 'refund' and v_prior + p_amount_cents > p_threshold_cents then
    v_status := 'pending_approval';
  else
    v_status := 'approved';
  end if;

  v_number := public.allocate_document_number('CN', now());

  insert into public.credit_notes (
    number, tenant_id, invoice_id, type, amount_cents,
    reason_code, reason_text, status, requested_by,
    approved_at
  ) values (
    v_number, p_tenant_id, p_invoice_id, p_type, p_amount_cents,
    p_reason_code, p_reason_text, v_status, p_requested_by,
    case when v_status = 'approved' then now() else null end
  ) returning id into v_id;

  return query select v_id, v_number, v_status;
end;
$$;

revoke all on function public.request_credit_note(uuid, uuid, public.credit_note_type, integer, public.credit_reason, text, uuid, integer)
  from public, anon, authenticated, tenant_app;
grant execute on function public.request_credit_note(uuid, uuid, public.credit_note_type, integer, public.credit_reason, text, uuid, integer)
  to service_role;

-- ─── 3 · issued invoices only move forwards ───

create or replace function public.prevent_issued_invoice_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'invoice_immutable: an invoice that has been issued cannot be deleted'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if old.status = 'draft' then
    return new;  -- A draft is still being assembled.
  end if;

  -- After issue, only the lifecycle may move: payment, voiding, provider reconciliation. The
  -- money and the identity are fixed.
  if new.tenant_id is distinct from old.tenant_id
     or new.number is distinct from old.number
     or new.kind is distinct from old.kind
     or new.subtotal_cents is distinct from old.subtotal_cents
     or new.discount_cents is distinct from old.discount_cents
     or new.tax_cents is distinct from old.tax_cents
     or new.total_cents is distinct from old.total_cents
     or new.currency is distinct from old.currency
     or new.issued_at is distinct from old.issued_at
     or new.created_at is distinct from old.created_at then
    raise exception 'invoice_immutable: an issued invoice cannot be edited — raise a credit note'
      using errcode = 'check_violation';
  end if;

  -- The lifecycle, forwards only. Going back to draft is what used to make a paid invoice editable
  -- and deletable; paid and void are final (a paid invoice is undone by a credit note).
  if new.status is distinct from old.status then
    if not (
         (old.status = 'issued'        and new.status in ('paid', 'overdue', 'void', 'uncollectible'))
      or (old.status = 'overdue'       and new.status in ('paid', 'void', 'uncollectible'))
      or (old.status = 'uncollectible' and new.status in ('paid', 'void'))
    ) then
      raise exception 'invoice_immutable: an invoice cannot move from % to %', old.status, new.status
        using errcode = 'check_violation';
    end if;

    -- Money has been received against it: voiding would leave the books disagreeing with the bank.
    if new.status = 'void' and exists (
      select 1 from public.payments p where p.invoice_id = old.id and p.status = 'succeeded'
    ) then
      raise exception 'invoice_immutable: invoice % has payments recorded against it and cannot be voided — refund or credit instead', old.number
        using errcode = 'check_violation';
    end if;
  end if;

  -- What a final state recorded stays recorded.
  if old.status = 'paid' and new.paid_at is distinct from old.paid_at then
    raise exception 'invoice_immutable: the payment date of a paid invoice cannot change'
      using errcode = 'check_violation';
  end if;
  if old.status = 'void' and (new.voided_at is distinct from old.voided_at or new.void_reason is distinct from old.void_reason) then
    raise exception 'invoice_immutable: a void invoice cannot be changed'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- Row triggers do not fire on TRUNCATE, and nothing in the app deletes an invoice: the trigger
-- already refuses every delete but a draft's, and no code path deletes drafts either.
revoke delete, truncate on public.platform_invoices from service_role;
revoke truncate on public.platform_invoice_lines from service_role;

-- ─── self-check ───
do $$
declare
  v_src text;
begin
  select prosrc into v_src from pg_proc where oid = 'public.prevent_issued_invoice_mutation()'::regprocedure;
  if position('forwards only' in v_src) = 0 then
    raise exception 'self-check: prevent_issued_invoice_mutation was not replaced';
  end if;
  if has_table_privilege('service_role', 'public.platform_invoices', 'DELETE')
     or has_table_privilege('service_role', 'public.platform_invoices', 'TRUNCATE') then
    raise exception 'self-check: service_role can still delete or truncate platform_invoices';
  end if;
  if has_function_privilege('anon', 'public.request_credit_note(uuid, uuid, public.credit_note_type, integer, public.credit_reason, text, uuid, integer)', 'EXECUTE') then
    raise exception 'self-check: anon can still execute request_credit_note';
  end if;
  if not has_function_privilege('service_role', 'public.settle_invoice_from_provider(uuid, uuid, text, text, integer, timestamptz)', 'EXECUTE') then
    raise exception 'self-check: service_role cannot execute settle_invoice_from_provider';
  end if;
end $$;
