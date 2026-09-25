-- LA-1.2 follow-up: qualify invitation columns in the resend RPC.
--
-- The function returns a table with an output column named user_id.  Unqualified
-- references to user_invitations.user_id therefore become ambiguous in PL/pgSQL.
-- Resend must remain one transaction: replace the old pending token, then return
-- the account that the email sender should address.

create or replace function public.partner_resend_invite(
  p_tenant_id uuid,
  p_partner_id uuid,
  p_user_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns table(user_id uuid, name text, email text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user public.users%rowtype;
  v_membership public.partner_users%rowtype;
begin
  select pu.* into v_membership
    from public.partner_users pu
    join public.partners p on p.id = pu.partner_id
   where pu.tenant_id = p_tenant_id
     and pu.partner_id = p_partner_id
     and pu.user_id = p_user_id
     and p.status <> 'offboarded'
   for update;
  if not found then raise exception 'partner_user_not_found'; end if;

  if v_membership.status <> 'active' or v_membership.accepted_at is not null then
    raise exception 'partner_invite_not_pending';
  end if;

  select account.* into v_user
    from public.users account
   where account.id = p_user_id
   for update;
  if not found or v_user.password_hash is not null then
    raise exception 'partner_invite_not_pending';
  end if;

  delete from public.user_invitations invitation
   where invitation.user_id = p_user_id
     and invitation.partner_id = p_partner_id
     and invitation.accepted_at is null;

  insert into public.user_invitations
    (user_id, partner_id, token_hash, expires_at, created_by, purpose)
  values
    (p_user_id, p_partner_id, p_token_hash, p_expires_at, null, 'invite');

  return query select v_user.id, v_user.name, v_user.email;
end;
$$;

revoke all on function public.partner_resend_invite(uuid, uuid, uuid, text, timestamptz)
  from public, anon, authenticated, tenant_app;
grant execute on function public.partner_resend_invite(uuid, uuid, uuid, text, timestamptz)
  to service_role;
