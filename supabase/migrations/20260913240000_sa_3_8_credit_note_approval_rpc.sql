-- SA-3.8: approve a high-value refund through the same narrow service-only
-- database boundary used by the rest of credit-note execution.
--
-- The application service client can read the note, but the immutable billing
-- tables intentionally do not grant direct UPDATE to service_role. Keep the
-- state transition in a locked SECURITY DEFINER function instead of widening
-- table privileges or allowing a client to supply an arbitrary update.

create or replace function public.approve_credit_note(
  p_credit_note_id uuid,
  p_approved_by uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_status public.credit_note_status;
  v_requested_by uuid;
begin
  select cn.status, cn.requested_by
    into v_status, v_requested_by
    from public.credit_notes cn
   where cn.id = p_credit_note_id
   for update;

  if not found then
    raise exception 'That credit note does not exist.';
  end if;

  if v_status <> 'pending_approval' then
    raise exception 'The credit note is not waiting for approval.';
  end if;

  if v_requested_by is not null and v_requested_by = p_approved_by then
    raise exception 'The requester cannot approve their own credit note.';
  end if;

  update public.credit_notes cn
     set status = 'approved',
         approved_by = p_approved_by,
         approved_at = now()
   where cn.id = p_credit_note_id;

  return true;
end;
$function$;

revoke all on function public.approve_credit_note(uuid, uuid)
  from public, anon, authenticated, tenant_app;
grant execute on function public.approve_credit_note(uuid, uuid) to service_role;
