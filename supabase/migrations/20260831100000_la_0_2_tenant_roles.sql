-- LA-0.2: tenant-owned team mutations.
--
-- These functions are intentionally service-role-only. The application resolves the caller's
-- current tenant and role from the tenant session before calling them; the functions then make
-- the database mutation atomic and exact-tenant. No function accepts a role from a JWT claim.

alter type public.audit_actor_type add value if not exists 'tenant';

create or replace function public.tenant_invite_user(
  p_name text,
  p_email text,
  p_role public.tenant_user_role,
  p_tenant_id uuid,
  p_token_hash text,
  p_expires_at timestamptz,
  p_created_by uuid
)
returns table(user_id uuid, tenant_id uuid)
language plpgsql
as $$
declare
  v_user_id uuid;
begin
  if p_tenant_id is null then
    raise exception 'tenant_required' using errcode = '22023';
  end if;

  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'tenant_not_found' using errcode = 'P0002';
  end if;

  insert into public.users (name, email, status)
  values (btrim(p_name), lower(btrim(p_email)), 'active')
  returning id into v_user_id;

  insert into public.tenant_users (tenant_id, user_id, role, accepted_at)
  values (p_tenant_id, v_user_id, p_role, null);

  -- created_by is a legacy admin_users foreign key. The tenant actor is recorded in audit_log;
  -- storing the tenant user here would violate that existing constraint.
  insert into public.user_invitations (user_id, token_hash, expires_at, created_by, purpose)
  values (v_user_id, p_token_hash, p_expires_at, null, 'invite');

  return query select v_user_id, p_tenant_id;
end;
$$;

create or replace function public.tenant_update_member_role(
  p_tenant_id uuid,
  p_user_id uuid,
  p_role public.tenant_user_role
)
returns table(old_role public.tenant_user_role, new_role public.tenant_user_role)
language plpgsql
as $$
declare
  v_old_role public.tenant_user_role;
  v_owner_count integer;
begin
  -- The tenant lock serialises two simultaneous last-owner demotions.
  perform 1 from public.tenants where id = p_tenant_id for update;
  if not found then
    raise exception 'tenant_not_found' using errcode = 'P0002';
  end if;

  select role into v_old_role
    from public.tenant_users
   where tenant_id = p_tenant_id and user_id = p_user_id
   for update;

  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;

  if v_old_role = 'owner' and p_role <> 'owner' then
    select count(*) into v_owner_count
      from public.tenant_users
     where tenant_id = p_tenant_id and role = 'owner';

    if v_owner_count <= 1 then
      raise exception 'last_owner' using errcode = 'P0001';
    end if;
  end if;

  update public.tenant_users
     set role = p_role
   where tenant_id = p_tenant_id and user_id = p_user_id;

  return query select v_old_role, p_role;
end;
$$;

revoke execute on function public.tenant_invite_user(text, text, public.tenant_user_role, uuid, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.tenant_invite_user(text, text, public.tenant_user_role, uuid, text, timestamptz, uuid) to service_role;

revoke execute on function public.tenant_update_member_role(uuid, uuid, public.tenant_user_role) from public, anon, authenticated;
grant execute on function public.tenant_update_member_role(uuid, uuid, public.tenant_user_role) to service_role;
