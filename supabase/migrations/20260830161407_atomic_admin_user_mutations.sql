-- M1-3 / M1-8: keep profile/role edits and pending-email issuance atomic,
-- and replace invite/reset tokens without destroying the prior token first.

create or replace function public.admin_update_user_with_email_change(
  p_user_id uuid,
  p_name text,
  p_phone text,
  p_role public.tenant_user_role,
  p_requested_email text,
  p_token_hash text,
  p_expires_at timestamptz,
  p_created_by uuid
)
returns table(
  old_name text,
  old_phone text,
  old_role public.tenant_user_role,
  old_email text,
  new_name text,
  new_phone text,
  new_role public.tenant_user_role,
  requested_email text,
  email_change_created boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user public.users%rowtype;
  v_tenant_id uuid;
  v_old_role public.tenant_user_role;
  v_owner_count integer;
  v_email text := lower(btrim(p_requested_email));
  v_email_change boolean;
begin
  select account.* into v_user
    from public.users account
   where account.id = p_user_id
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'USER_NOT_FOUND';
  end if;

  select membership.tenant_id into v_tenant_id
    from public.tenant_users membership
   where membership.user_id = p_user_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'MEMBERSHIP_NOT_FOUND';
  end if;

  -- Every ownership mutation takes the same tenant-row lock. Locking only the membership being
  -- demoted lets two different owners demote themselves concurrently.
  perform 1 from public.tenants tenant where tenant.id = v_tenant_id for update;

  select membership.role into v_old_role
    from public.tenant_users membership
   where membership.user_id = p_user_id
     and membership.tenant_id = v_tenant_id
   for update;

  if v_old_role = 'owner' and p_role <> 'owner' then
    select count(*) into v_owner_count
      from public.tenant_users membership
     where membership.tenant_id = v_tenant_id
       and membership.role = 'owner';

    if v_owner_count <= 1 then
      raise exception using errcode = 'P0001', message = 'LAST_OWNER';
    end if;
  end if;

  v_email_change := v_email <> lower(v_user.email);

  if v_email_change and exists (
    select 1 from public.users account
     where lower(account.email) = v_email
       and account.id <> p_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'EMAIL_ALREADY_REGISTERED';
  end if;

  update public.users account
     set name = p_name,
         phone = nullif(btrim(coalesce(p_phone, '')), '')
   where account.id = p_user_id;

  update public.tenant_users membership
     set role = p_role
   where membership.user_id = p_user_id
     and membership.tenant_id = v_tenant_id;

  if v_email_change then
    update public.user_invitations invitation
       set accepted_at = now()
     where invitation.user_id = p_user_id
       and invitation.purpose = 'email_change'
       and invitation.accepted_at is null;

    insert into public.user_invitations (
      user_id, token_hash, expires_at, created_by, purpose, new_email
    ) values (
      p_user_id, p_token_hash, p_expires_at, p_created_by, 'email_change', v_email
    );
  end if;

  return query select
    v_user.name,
    v_user.phone,
    v_old_role,
    v_user.email,
    p_name,
    nullif(btrim(coalesce(p_phone, '')), ''),
    p_role,
    v_email,
    v_email_change;
end;
$$;

revoke execute on function public.admin_update_user_with_email_change(
  uuid, text, text, public.tenant_user_role, text, text, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.admin_update_user_with_email_change(
  uuid, text, text, public.tenant_user_role, text, text, timestamptz, uuid
) to service_role;

create or replace function public.admin_replace_user_token(
  p_user_id uuid,
  p_purpose public.user_token_purpose,
  p_token_hash text,
  p_expires_at timestamptz,
  p_created_by uuid
)
returns table(token_id uuid, email text, name text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user public.users%rowtype;
  v_token_id uuid;
begin
  if p_purpose not in ('invite', 'password_reset') then
    raise exception using errcode = 'P0001', message = 'UNSUPPORTED_TOKEN_PURPOSE';
  end if;

  select account.* into v_user
    from public.users account
   where account.id = p_user_id
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'USER_NOT_FOUND';
  end if;

  if v_user.status = 'deleted' then
    raise exception using errcode = 'P0001', message = 'USER_REMOVED';
  end if;

  if p_purpose = 'invite' and v_user.password_hash is not null then
    raise exception using errcode = 'P0001', message = 'PASSWORD_ALREADY_SET';
  end if;

  if p_purpose = 'password_reset' and v_user.password_hash is null then
    raise exception using errcode = 'P0001', message = 'PASSWORD_NOT_SET';
  end if;

  -- Invalidate only the same purpose. A failed insert rolls this update back, preserving the old
  -- valid token instead of stranding the customer.
  update public.user_invitations invitation
     set accepted_at = now()
   where invitation.user_id = p_user_id
     and invitation.purpose = p_purpose
     and invitation.accepted_at is null;

  insert into public.user_invitations (user_id, token_hash, expires_at, created_by, purpose)
  values (p_user_id, p_token_hash, p_expires_at, p_created_by, p_purpose)
  returning id into v_token_id;

  return query select v_token_id, v_user.email, v_user.name;
end;
$$;

revoke execute on function public.admin_replace_user_token(
  uuid, public.user_token_purpose, text, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.admin_replace_user_token(
  uuid, public.user_token_purpose, text, timestamptz, uuid
) to service_role;
