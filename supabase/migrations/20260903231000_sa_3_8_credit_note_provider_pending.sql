-- SA-3.8 / M3-6 · Preserve a provider-successful refund for a later reconciliation retry.

create or replace function public.mark_credit_note_provider_pending(
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

  if v_status = 'succeeded' and v_provider_refund_id is not null then
    return true;
  end if;

  if v_status <> 'processing' then
    return false;
  end if;

  update public.credit_notes
     set reconciliation_state = 'provider_pending',
         provider_succeeded_at = coalesce(provider_succeeded_at, now()),
         last_reconciliation_error = p_reason
   where id = p_credit_note_id;

  return true;
end;
$function$;

revoke all on function public.mark_credit_note_provider_pending(uuid, text)
  from public, anon, authenticated, tenant_app;
grant execute on function public.mark_credit_note_provider_pending(uuid, text) to service_role;
