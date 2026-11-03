-- SA-1.2 · Keep invitation replacement compatible with the live text purpose column.
--
-- The live user_invitations.purpose column is text, while the previous function
-- compared it to a user_token_purpose enum. PostgreSQL does not implicitly compare
-- text to that enum, so resend-invitation always failed. Keep the public RPC contract
-- as text, validate the supported vocabulary explicitly, and compare/store text.

create or replace function public.admin_replace_user_token(
  p_user_id    uuid,
  p_purpose    text,
  p_token_hash text,
  p_expires_at timestamptz,
  p_created_by uuid default null,
  p_new_email  text default null
)
returns public.user_invitations
language plpgsql
set search_path = public
as $$
declare
  v_user public.users%rowtype;
  v_row  public.user_invitations%rowtype;
begin
  if p_purpose not in ('invite', 'password_reset', 'email_change', 'email_verification') then
    raise exception 'invalid_token_purpose' using errcode = 'check_violation';
  end if;

  select * into v_user
    from public.users
   where id = p_user_id
   for update;

  if v_user.id is null or v_user.status = 'deleted' then
    raise exception 'USER_REMOVED' using errcode = 'check_violation';
  end if;

  if p_purpose = 'invite' and v_user.password_hash is not null then
    raise exception 'PASSWORD_ALREADY_SET' using errcode = 'check_violation';
  end if;

  update public.user_invitations
     set accepted_at = now()
   where user_id = p_user_id
     and purpose = p_purpose
     and accepted_at is null;

  insert into public.user_invitations (user_id, purpose, token_hash, new_email, expires_at, created_by)
  values (p_user_id, p_purpose, p_token_hash, p_new_email, p_expires_at, p_created_by)
  returning * into v_row;

  return v_row;
end;
$$;

