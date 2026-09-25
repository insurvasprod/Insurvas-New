-- SA-3.8 / M3-6 · Credit-note execution must be recoverable when the provider and our database
-- do not finish at the same time.

alter table public.credit_notes
  add column if not exists reconciliation_state text not null default 'pending',
  add column if not exists reconciliation_attempts integer not null default 0,
  add column if not exists provider_succeeded_at timestamp with time zone,
  add column if not exists reconciled_at timestamp with time zone,
  add column if not exists last_reconciliation_error text;

update public.credit_notes
   set reconciliation_state = case
     when status = 'succeeded' then 'reconciled'
     when status = 'processing' then 'provider_pending'
     else 'pending'
   end
 where reconciliation_state = 'pending';

do $$
begin
  alter table public.credit_notes
    add constraint credit_notes_reconciliation_state_check
    check (reconciliation_state in ('pending', 'provider_pending', 'reconciled', 'failed'));
exception when duplicate_object then null;
end $$;

create index if not exists credit_notes_reconciliation_idx
  on public.credit_notes (reconciliation_state, created_at desc)
  where reconciliation_state in ('provider_pending', 'failed');

-- Claims a refund execution briefly and increments the attempt count. A second request may resume
-- provider_pending: it uses the same credit-note idempotency key, so the provider returns the first
-- result instead of moving money twice. The function is service-role-only because it is a billing
-- control-plane operation, not a tenant RPC.
create or replace function public.claim_credit_note_refund(p_credit_note_id uuid)
returns table (
  id uuid,
  number text,
  tenant_id uuid,
  invoice_id uuid,
  amount_cents integer,
  provider_refund_id text,
  reconciliation_state text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_note record;
begin
  select cn.id, cn.number, cn.tenant_id, cn.invoice_id, cn.amount_cents,
         cn.provider_refund_id, cn.status, cn.type, cn.reconciliation_state
    into v_note
    from public.credit_notes cn
   where cn.id = p_credit_note_id
   for update;

  if not found then
    raise exception 'That credit note does not exist.';
  end if;

  if v_note.type <> 'refund' then
    raise exception 'Only refund credit notes can be sent to a provider.';
  end if;

  if v_note.status = 'succeeded' and v_note.reconciliation_state = 'reconciled' then
    return query select v_note.id, v_note.number, v_note.tenant_id, v_note.invoice_id,
      v_note.amount_cents, v_note.provider_refund_id, v_note.reconciliation_state;
    return;
  end if;

  if v_note.status <> 'approved'
     and not (v_note.status = 'processing' and v_note.reconciliation_state = 'provider_pending') then
    raise exception '% is not approved or awaiting reconciliation.', v_note.number;
  end if;

  update public.credit_notes cn
     set status = 'processing',
         reconciliation_state = 'provider_pending',
         reconciliation_attempts = cn.reconciliation_attempts + 1,
         last_reconciliation_error = null
   where cn.id = p_credit_note_id
  returning cn.id, cn.number, cn.tenant_id, cn.invoice_id, cn.amount_cents,
            cn.provider_refund_id, cn.reconciliation_state
       into v_note;

  return query select v_note.id, v_note.number, v_note.tenant_id, v_note.invoice_id,
    v_note.amount_cents, v_note.provider_refund_id, v_note.reconciliation_state;
end;
$function$;

revoke all on function public.claim_credit_note_refund(uuid)
  from public, anon, authenticated, tenant_app;
grant execute on function public.claim_credit_note_refund(uuid) to service_role;

-- Credits and waivers never call a provider. Applying the balance and marking the note succeeded
-- must still be one transaction, otherwise a local update failure can grant the same credit twice
-- on retry.
create or replace function public.apply_credit_note_balance(p_credit_note_id uuid)
returns table (balance_cents integer, status public.credit_note_status)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_note record;
  v_balance integer;
begin
  select cn.id, cn.tenant_id, cn.type, cn.amount_cents, cn.status, cn.reconciliation_state
    into v_note
    from public.credit_notes cn
   where cn.id = p_credit_note_id
   for update;

  if not found then
    raise exception 'That credit note does not exist.';
  end if;

  if v_note.type not in ('credit', 'waiver') then
    raise exception 'Only credits and waivers can be applied to a tenant balance.';
  end if;

  insert into public.tenant_credits (tenant_id, balance_cents)
  values (v_note.tenant_id, 0)
  on conflict (tenant_id) do nothing;

  if v_note.status = 'succeeded' and v_note.reconciliation_state = 'reconciled' then
    select tc.balance_cents into v_balance
      from public.tenant_credits tc
     where tc.tenant_id = v_note.tenant_id;
    return query select v_balance, v_note.status;
    return;
  end if;

  if v_note.status <> 'approved' then
    raise exception 'The credit note is not approved.';
  end if;

  update public.tenant_credits tc
     set balance_cents = tc.balance_cents + case when v_note.type = 'credit'
                                                  then v_note.amount_cents
                                                  else 0 end,
         updated_at = now()
   where tc.tenant_id = v_note.tenant_id
  returning tc.balance_cents into v_balance;

  update public.credit_notes cn
     set status = 'succeeded',
         reconciliation_state = 'reconciled',
         reconciled_at = now(),
         last_reconciliation_error = null
   where cn.id = p_credit_note_id;

  return query select v_balance, 'succeeded'::public.credit_note_status;
end;
$function$;

revoke all on function public.apply_credit_note_balance(uuid)
  from public, anon, authenticated, tenant_app;
grant execute on function public.apply_credit_note_balance(uuid) to service_role;
