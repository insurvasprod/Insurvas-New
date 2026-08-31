-- M1-1 / M1-2: consume account-security tokens in the same transaction as the
-- credential or email mutation. A token is locked before it is checked, so two
-- concurrent redeemers cannot both act on it.

create or replace function public.consume_user_password_token(
  p_token_hash text,
  p_password_hash text
)
returns table(user_id uuid, purpose public.user_token_purpose, accepted_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_token public.user_invitations%rowtype;
  v_accepted_at timestamptz := now();
begin
  select invitation.*
    into v_token
    from public.user_invitations invitation
   where invitation.token_hash = p_token_hash
     and invitation.purpose in ('invite', 'password_reset')
     and invitation.accepted_at is null
     and invitation.expires_at > now()
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'PASSWORD_TOKEN_INVALID_OR_EXPIRED';
  end if;

  update public.users account
     set password_hash = p_password_hash
   where account.id = v_token.user_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'PASSWORD_TOKEN_USER_NOT_FOUND';
  end if;

  update public.user_invitations invitation
     set accepted_at = v_accepted_at
   where invitation.id = v_token.id
     and invitation.accepted_at is null;

  if not found then
    raise exception using errcode = 'P0001', message = 'PASSWORD_TOKEN_ALREADY_USED';
  end if;

  if v_token.purpose = 'invite' then
    update public.tenant_users membership
       set accepted_at = coalesce(membership.accepted_at, v_accepted_at)
     where membership.user_id = v_token.user_id;
  end if;

  return query select v_token.user_id, v_token.purpose, v_accepted_at;
end;
$$;

revoke execute on function public.consume_user_password_token(text, text)
  from public, anon, authenticated;
grant execute on function public.consume_user_password_token(text, text)
  to service_role;

create or replace function public.consume_user_email_change_token(p_token_hash text)
returns table(user_id uuid, email text, accepted_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_token public.user_invitations%rowtype;
  v_accepted_at timestamptz := now();
begin
  select invitation.*
    into v_token
    from public.user_invitations invitation
   where invitation.token_hash = p_token_hash
     and invitation.purpose = 'email_change'
     and invitation.new_email is not null
     and invitation.accepted_at is null
     and invitation.expires_at > now()
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'EMAIL_CHANGE_TOKEN_INVALID_OR_EXPIRED';
  end if;

  begin
    update public.users account
       set email = lower(v_token.new_email)
     where account.id = v_token.user_id;
  exception
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'EMAIL_ALREADY_REGISTERED';
  end;

  if not found then
    raise exception using errcode = 'P0001', message = 'EMAIL_CHANGE_USER_NOT_FOUND';
  end if;

  update public.user_invitations invitation
     set accepted_at = v_accepted_at
   where invitation.id = v_token.id
     and invitation.accepted_at is null;

  if not found then
    raise exception using errcode = 'P0001', message = 'EMAIL_CHANGE_TOKEN_ALREADY_USED';
  end if;

  return query select v_token.user_id, lower(v_token.new_email), v_accepted_at;
end;
$$;

revoke execute on function public.consume_user_email_change_token(text)
  from public, anon, authenticated;
grant execute on function public.consume_user_email_change_token(text)
  to service_role;
