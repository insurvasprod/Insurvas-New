-- LA-0.2: a tenant invitation must attach a real Supabase Auth identity.
-- public.users.id intentionally references auth.users(id), so inserting a profile with a
-- generated UUID is invalid. The application creates the Auth identity first, then calls this
-- service-role-only RPC to attach it to the tenant and create the pending invitation atomically.

-- The shared invitation table is also used by the partner plane. Keep these nullable columns on
-- the live compatibility schema so the agent set-password query can distinguish tenant invites
-- from partner invites and email-change tokens without changing existing rows.
alter table public.user_invitations add column if not exists partner_id uuid;
alter table public.user_invitations add column if not exists new_email text;

create or replace function public.tenant_invite_user_with_auth(
  p_auth_user_id uuid,
  p_name text,
  p_email text,
  p_role public.tenant_user_role,
  p_tenant_id uuid,
  p_token_hash text,
  p_expires_at timestamptz,
  p_created_by uuid,
  p_max_buffer_seats integer default null
)
returns table(user_id uuid, tenant_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));

  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'tenant_not_found';
  end if;

  if not exists (
    select 1 from public.users
    where id = p_auth_user_id and lower(email) = lower(btrim(p_email))
  ) then
    raise exception 'auth_profile_not_found';
  end if;

  if exists (
    select 1 from public.users
    where lower(email) = lower(btrim(p_email)) and id <> p_auth_user_id
  ) then
    raise exception 'email_exists';
  end if;

  if exists (select 1 from public.tenant_users membership where membership.tenant_id = p_tenant_id and membership.user_id = p_auth_user_id) then
    raise exception 'email_exists';
  end if;

  if p_role = 'assistant' then
    select count(*)::integer into v_count
    from public.tenant_users tu
    join public.users u on u.id = tu.user_id
    where tu.tenant_id = p_tenant_id
      and tu.role = 'assistant'
      and u.status in ('active', 'suspended');
    if p_max_buffer_seats is not null and v_count >= p_max_buffer_seats then
      raise exception 'max_buffer_seats:%:%', v_count, p_max_buffer_seats;
    end if;
  end if;

  update public.users
     set name = btrim(p_name),
         full_name = btrim(p_name),
         display_name = btrim(p_name),
         status = 'invited',
         active = false,
         must_reset_password = true,
         updated_at = now()
   where id = p_auth_user_id;

  insert into public.tenant_users (tenant_id, user_id, role, accepted_at)
  values (p_tenant_id, p_auth_user_id, p_role, null);

  insert into public.user_invitations (user_id, tenant_id, token_hash, expires_at, created_by, purpose)
  values (p_auth_user_id, p_tenant_id, p_token_hash, p_expires_at, null, 'invite');

  return query select p_auth_user_id, p_tenant_id;
end;
$$;

revoke all on function public.tenant_invite_user_with_auth(uuid,text,text,public.tenant_user_role,uuid,text,timestamptz,uuid,integer)
  from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_invite_user_with_auth(uuid,text,text,public.tenant_user_role,uuid,text,timestamptz,uuid,integer)
  to service_role;

-- Completing an invite must make the profile eligible for the next tenant request. Supabase Auth
-- password synchronization is performed by the application after this atomic token operation.
create or replace function public.consume_user_password_token(
  p_token_hash text,
  p_password_hash text
)
returns table(user_id uuid, purpose text, accepted_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_token public.user_invitations%rowtype;
  v_accepted_at timestamptz := now();
begin
  select invitation.* into v_token
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
     set password_hash = p_password_hash,
         status = 'active',
         active = true,
         must_reset_password = false,
         updated_at = now()
   where account.id = v_token.user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'PASSWORD_TOKEN_USER_NOT_FOUND';
  end if;

  update public.user_invitations invitation
     set accepted_at = v_accepted_at
   where invitation.id = v_token.id and invitation.accepted_at is null;
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

revoke execute on function public.consume_user_password_token(text,text) from public, anon, authenticated;
grant execute on function public.consume_user_password_token(text,text) to service_role;
