-- bugs_sa.md M3-4 (P1) · Manual settlement was non-atomic and activated unrelated subscriptions.
--
-- Four separate defects in one route:
--
--   1. It activated EVERY subscription belonging to the tenant — `.eq("tenant_id", ...)` — so
--      settling one custom invoice could revive a subscription that had nothing to do with it,
--      including a deliberately unlinked one.
--   2. Payment insert, invoice settlement, subscription activation and entitlement refresh were
--      four separate statements with the update errors ignored, so a partial failure left a
--      recorded payment against an unpaid invoice. Retrying was then refused by the unique index
--      on the bank reference: the money was recorded, the invoice never settled, and the admin
--      could not fix it.
--   3. It accepted more than the outstanding balance. The live database holds INV-2026-08-0001
--      with a total of 9,900 cents and 19,800 cents of successful payments against it.
--   4. It never loaded the invoice's own subscription_id, which is what should have told it
--      which subscription to activate.
--
-- One function, one transaction. Either all of it happened or none of it did.

create or replace function public.admin_settle_invoice_manually(
  p_invoice_id   uuid,
  p_amount_cents integer,
  p_reference    text,
  p_paid_at      timestamptz,
  p_recorded_by  uuid
)
returns table(
  payment_id      uuid,
  invoice_status  public.invoice_status,
  paid_cents      integer,
  settled         boolean,
  subscription_id uuid,
  subscription_activated boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
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
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
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
    update public.invoices
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
$$;

revoke execute on function public.admin_settle_invoice_manually(uuid, integer, text, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_settle_invoice_manually(uuid, integer, text, timestamptz, uuid)
  to service_role;
