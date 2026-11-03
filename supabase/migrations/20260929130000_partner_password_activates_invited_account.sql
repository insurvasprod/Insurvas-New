-- W1.6 (Module 1) -- a partner user invited by the agency could never sign in.
--
-- An invite creates the account with users.status = 'invited'. Setting the password through
-- /partner/set-password runs consume_partner_password_token, which set the password, marked the
-- invitation accepted and the membership active -- but never moved the ACCOUNT out of 'invited'.
-- Partner login, requirePartner and mint-session all require users.status = 'active', so every
-- agency-invited partner user was locked out (login recorded no_membership). Found live 2026-09-30.
--
-- 1. consume_partner_password_token now also activates the account, but only from 'invited'.
--    A suspended or inactive account is never reactivated by redeeming an old invite.
--    Body is the live definition (read 2026-09-30) plus that one update. Signature, return shape,
--    security (invoker) and search_path are unchanged, so existing grants stand.
-- 2. Repair: accounts that already redeemed an invite this way (password set, still 'invited',
--    holding an accepted active partner membership) are activated. They are exactly the users
--    the bug locked out.

create or replace function public.consume_partner_password_token(p_token_hash text, p_password_hash text)
 returns table(user_id uuid, partner_id uuid, accepted_at timestamp with time zone)
 language plpgsql
 set search_path to 'public'
as $function$
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
  -- The invitee has now proven the invite link and chosen a password: the account is live.
  -- Only from 'invited' -- a suspended or inactive account stays as an administrator left it.
  update public.users account set status = 'active' where account.id = v_token.user_id and account.status = 'invited';
  update public.user_invitations invitation set accepted_at = v_accepted_at
   where invitation.id = v_token.id and invitation.accepted_at is null;
  if not found then raise exception using errcode = 'P0001', message = 'PARTNER_PASSWORD_TOKEN_ALREADY_USED'; end if;
  update public.partner_users membership
     set accepted_at = coalesce(membership.accepted_at, v_accepted_at), status = 'active', revoked_at = null, deactivated_at = null
   where membership.partner_id = v_token.partner_id and membership.user_id = v_token.user_id and membership.status = 'active';
  if not found then raise exception using errcode = 'P0001', message = 'PARTNER_MEMBERSHIP_NOT_ACTIVE'; end if;
  return query select v_token.user_id, v_token.partner_id, v_accepted_at;
end;
$function$;

-- Repair the accounts the bug already locked out.
update public.users account
   set status = 'active'
 where account.status = 'invited'
   and account.password_hash is not null
   and exists (
     select 1 from public.partner_users membership
      where membership.user_id = account.id
        and membership.status = 'active'
        and membership.accepted_at is not null
   );

do $$
begin
  if not has_schema_privilege('public', 'CREATE') then
    raise notice 'skipping the self-check: this role cannot create in public';
    return;
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'consume_partner_password_token'
       and p.prosrc like '%set status = ''active'' where account.id = v_token.user_id and account.status = ''invited''%'
  ) then
    raise exception 'consume_partner_password_token still leaves a redeemed partner account invited';
  end if;
  if exists (
    select 1 from public.users account
     where account.status = 'invited' and account.password_hash is not null
       and exists (select 1 from public.partner_users m where m.user_id = account.id and m.status = 'active' and m.accepted_at is not null)
  ) then
    raise exception 'a partner account that redeemed its invite is still invited';
  end if;
end $$;
