-- SA-3.8 / M3-6 · State transitions after a provider call are locked and checked in SQL.

create or replace function public.finish_credit_note_refund(
  p_credit_note_id uuid,
  p_provider_refund_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_status public.credit_note_status;
  v_provider_refund_id text;
begin
  select status, provider_refund_id
    into v_status, v_provider_refund_id
    from public.credit_notes
   where id = p_credit_note_id
   for update;

  if not found then
    raise exception 'That credit note does not exist.';
  end if;

  if v_status = 'succeeded' and v_provider_refund_id is not null then
    return true;
  end if;

  if v_status <> 'processing' then
    return false;
  end if;

  update public.credit_notes
     set status = 'succeeded',
         provider_refund_id = p_provider_refund_id,
         reconciliation_state = 'reconciled',
         provider_succeeded_at = coalesce(provider_succeeded_at, now()),
         reconciled_at = now(),
         failure_reason = null,
         last_reconciliation_error = null
   where id = p_credit_note_id;

  return true;
end;
$function$;

revoke all on function public.finish_credit_note_refund(uuid, text)
  from public, anon, authenticated, tenant_app;
grant execute on function public.finish_credit_note_refund(uuid, text) to service_role;

create or replace function public.fail_credit_note_refund(
  p_credit_note_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_status public.credit_note_status;
  v_provider_refund_id text;
begin
  select status, provider_refund_id
    into v_status, v_provider_refund_id
    from public.credit_notes
   where id = p_credit_note_id
   for update;

  if not found then
    raise exception 'That credit note does not exist.';
  end if;

  -- Never overwrite a success discovered by a concurrent request.
  if v_status = 'succeeded' and v_provider_refund_id is not null then
    return true;
  end if;

  if v_status <> 'processing' then
    return false;
  end if;

  update public.credit_notes
     set status = 'failed',
         reconciliation_state = 'failed',
         failure_reason = p_reason,
         last_reconciliation_error = p_reason
   where id = p_credit_note_id;

  return true;
end;
$function$;

revoke all on function public.fail_credit_note_refund(uuid, text)
  from public, anon, authenticated, tenant_app;
grant execute on function public.fail_credit_note_refund(uuid, text) to service_role;
