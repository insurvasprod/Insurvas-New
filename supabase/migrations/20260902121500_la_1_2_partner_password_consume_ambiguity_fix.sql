-- LA-1.2 follow-up: qualify the membership update in the atomic partner-token consumer. The
-- function returns user_id, so PL/pgSQL can otherwise resolve user_id as the output variable.
create or replace function public.consume_partner_password_token(
  p_token_hash text,
  p_password_hash text
)
returns table(user_id uuid, partner_id uuid, accepted_at timestamptz)
language plpgsql security invoker set search_path = public
as $$
declare
  v_token public.user_invitations%rowtype;
  v_accepted_at timestamptz := now();
begin
  select invitation.* into v_token
    from public.user_invitations invitation
    join public.partner_users membership on membership.partner_id = invitation.partner_id and membership.user_id = invitation.user_id
    join public.partners partner on partner.id = membership.partner_id
   where invitation.token_hash = p_token_hash
     and invitation.partner_id is not null
     and invitation.purpose = 'invite'
     and invitation.accepted_at is null
     and invitation.expires_at > now()
     and membership.status = 'active'
     and partner.status <> 'offboarded'
   for update of invitation;
  if not found then raise exception using errcode = 'P0001', message = 'PARTNER_PASSWORD_TOKEN_INVALID_OR_EXPIRED'; end if;

  update public.users account set password_hash = p_password_hash where account.id = v_token.user_id;
  if not found then raise exception using errcode = 'P0001', message = 'PARTNER_PASSWORD_TOKEN_USER_NOT_FOUND'; end if;
  update public.user_invitations invitation set accepted_at = v_accepted_at
   where invitation.id = v_token.id and invitation.accepted_at is null;
  if not found then raise exception using errcode = 'P0001', message = 'PARTNER_PASSWORD_TOKEN_ALREADY_USED'; end if;
  update public.partner_users membership
     set accepted_at = coalesce(membership.accepted_at, v_accepted_at), status = 'active', revoked_at = null, deactivated_at = null
   where membership.partner_id = v_token.partner_id and membership.user_id = v_token.user_id and membership.status = 'active';
  if not found then raise exception using errcode = 'P0001', message = 'PARTNER_MEMBERSHIP_NOT_ACTIVE'; end if;
  return query select v_token.user_id, v_token.partner_id, v_accepted_at;
end;
$$;
revoke all on function public.consume_partner_password_token(text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.consume_partner_password_token(text, text) to service_role;
