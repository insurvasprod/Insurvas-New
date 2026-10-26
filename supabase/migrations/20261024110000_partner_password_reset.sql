-- Partner self-service password reset (sign-in redesign, 2026-10-24).
--
-- Partners sign in with users.password_hash (app/api/partner/auth/login), and until now the only
-- way to set it was the invitation link (consume_partner_password_token, purpose 'invite'), so a
-- partner who forgot a password could only email support. "Forgot password?" on /partner/login now
-- issues a 'password_reset' token (admin_replace_user_token, as the agent door does), and this
-- consumes it.
--
-- What it checks, in one transaction, with the token row locked:
--   · the token is a live 'password_reset' token (not accepted, not expired);
--   · its user holds an ACTIVE membership of a partner that is not offboarded, so an agent account
--     or a removed partner user cannot use this door to set a password;
--   · the account is active (a suspended or invited account is left as an administrator set it).
-- What it does: sets the password, ends every session (session_version + 1, as "sign out
-- everywhere" does), and burns the token.

create or replace function public.consume_partner_password_reset(p_token_hash text, p_password_hash text)
returns table(user_id uuid, partner_id uuid)
language plpgsql
set search_path to 'public'
as $function$
declare
  v_token public.user_invitations%rowtype;
  v_partner uuid;
begin
  select invitation.* into v_token
    from public.user_invitations invitation
   where invitation.token_hash = p_token_hash
     and invitation.purpose = 'password_reset'
     and invitation.accepted_at is null
     and invitation.expires_at > now()
   for update of invitation;
  if not found then raise exception using errcode = 'P0001', message = 'PARTNER_RESET_TOKEN_INVALID_OR_EXPIRED'; end if;

  select membership.partner_id into v_partner
    from public.partner_users membership
    join public.partners partner on partner.id = membership.partner_id
   where membership.user_id = v_token.user_id
     and membership.status = 'active'
     and partner.status <> 'offboarded'
   order by membership.accepted_at nulls last
   limit 1;
  if v_partner is null then raise exception using errcode = 'P0001', message = 'PARTNER_MEMBERSHIP_NOT_ACTIVE'; end if;

  update public.users account
     set password_hash = p_password_hash,
         session_version = coalesce(account.session_version, 0) + 1
   where account.id = v_token.user_id
     and account.status = 'active';
  if not found then raise exception using errcode = 'P0001', message = 'PARTNER_RESET_ACCOUNT_NOT_ACTIVE'; end if;

  update public.user_invitations invitation set accepted_at = now()
   where invitation.id = v_token.id and invitation.accepted_at is null;
  if not found then raise exception using errcode = 'P0001', message = 'PARTNER_RESET_TOKEN_ALREADY_USED'; end if;

  return query select v_token.user_id, v_partner;
end;
$function$;

-- Called only by the server with the service role; nobody else may set a password through it.
revoke all on function public.consume_partner_password_reset(text, text) from public, anon, authenticated;
grant execute on function public.consume_partner_password_reset(text, text) to service_role;

do $$
begin
  if to_regprocedure('public.consume_partner_password_reset(text, text)') is null then
    raise exception 'consume_partner_password_reset was not created';
  end if;
  if has_function_privilege('anon', 'public.consume_partner_password_reset(text, text)', 'execute') then
    raise exception 'consume_partner_password_reset is executable by anon';
  end if;
end $$;
