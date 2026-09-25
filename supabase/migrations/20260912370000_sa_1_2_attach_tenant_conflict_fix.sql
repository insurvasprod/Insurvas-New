-- SA-1.2 · Fix the live tenant attachment function's ambiguous conflict target.
--
-- The return column `tenant_id` is also a PL/pgSQL output variable. In PostgreSQL,
-- `ON CONFLICT (tenant_id, user_id)` therefore resolves ambiguously in this function
-- and causes every admin-created invitation to fail after the Auth row is created.
-- Use the existing primary-key constraint instead. This is additive and preserves the
-- existing transaction, seat, invitation, and Auth-compensation behavior.

create or replace function public.admin_attach_user_to_tenant(
  p_user_id         uuid,
  p_name            text,
  p_email           text,
  p_phone           text,
  p_tenant_id       uuid,
  p_new_tenant_name text,
  p_role            text,
  p_token_hash      text,
  p_expires_at      timestamptz,
  p_created_by      uuid
)
returns table (user_id uuid, tenant_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant uuid;
  v_max    integer;
  v_used   integer;
begin
  if p_tenant_id is null and nullif(btrim(coalesce(p_new_tenant_name, '')), '') is null then
    raise exception 'tenant_required' using errcode = 'check_violation';
  end if;

  if not exists (select 1 from public.users u where u.id = p_user_id) then
    raise exception 'user_not_provisioned' using errcode = 'no_data_found';
  end if;

  if exists (
    select 1
      from public.users u
     where lower(u.email) = lower(p_email)
       and u.id <> p_user_id
  ) then
    raise exception 'EMAIL_ALREADY_REGISTERED' using errcode = 'unique_violation';
  end if;

  if p_tenant_id is not null then
    v_tenant := p_tenant_id;
    if not exists (select 1 from public.tenants t where t.id = v_tenant) then
      raise exception 'tenant_not_found' using errcode = 'foreign_key_violation';
    end if;
  else
    insert into public.tenants (name, status, onboarding_state)
    values (btrim(p_new_tenant_name), 'active', 'pending')
    returning id into v_tenant;
  end if;

  select l.max_seats into v_max
    from public.plan_limits l
   where l.plan_id = public.tenant_current_plan(v_tenant);

  if v_max is not null then
    select count(*)::integer into v_used
      from public.tenant_users tu
      join public.users u on u.id = tu.user_id
     where tu.tenant_id = v_tenant
       and u.status = 'active'
       and u.id <> p_user_id;
    if (v_used + 1) > v_max then
      raise exception 'seat_limit_reached:%:%', v_used, v_max using errcode = 'check_violation';
    end if;
  end if;

  update public.users
     set name   = coalesce(nullif(btrim(p_name), ''), name),
         email  = lower(btrim(p_email)),
         phone  = p_phone,
         status = case when status = 'deleted' then status else 'pending_verification' end
   where id = p_user_id;

  insert into public.tenant_users (tenant_id, user_id, role)
  values (v_tenant, p_user_id, p_role::public.tenant_user_role)
  on conflict on constraint tenant_users_pkey do update
    set role = excluded.role;

  insert into public.user_invitations (user_id, purpose, token_hash, expires_at, created_by)
  values (p_user_id, 'invite', p_token_hash, p_expires_at, p_created_by);

  return query select p_user_id, v_tenant;
end;
$$;

comment on function public.admin_attach_user_to_tenant(uuid, text, text, text, uuid, text, text, text, timestamptz, uuid) is
  'SA-1.2 · Attaches an Auth-created user to a tenant and issues an invitation in one transaction. Uses the tenant_users primary-key constraint to avoid an ambiguous PL/pgSQL conflict target.';

