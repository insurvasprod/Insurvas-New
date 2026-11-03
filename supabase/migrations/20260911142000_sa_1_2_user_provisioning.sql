-- SA-1.2 / SA-1.3 · Provisioning and editing a user
--
-- Two functions, and the reason they are shaped differently is worth stating.
--
-- `admin_attach_user_to_tenant` replaces the `admin_create_user` the route used to call. It does
-- NOT create the user. Since LA-0 made Supabase Auth the credential authority,
-- `public.users.id` is foreign-keyed to `auth.users`, so the row has to be born in Auth and
-- arrive here through the `on_auth_user_created` bridge trigger. The route now calls
-- `auth.admin.createUser()` first and this function second, and deletes the Auth user if this
-- function raises — see app/api/admin/users/route.ts.
--
-- `admin_update_user_with_email_change` stayed a single SQL transaction, because it never changes
-- an email outright: a new address is staged as an `email_change` token and only lands when the
-- user confirms it. "The email is never changed outright — the new address has to be confirmed
-- first, so a typo can't lock the user out of their own account." Nothing in it touches Auth, so
-- nothing forced it through the route.
--
-- Note for whoever writes `consume_user_email_change_token`: acceptance DOES cross the boundary.
-- The address lives in `auth.users` as well, so applying a staged change means an
-- `auth.admin.updateUserById()` alongside the SQL, or the two halves will disagree about who the
-- user is. That function is not in this migration.

-- --------------------------------------------------------------------------
-- Attach an already-created Auth user to a tenant (SA-1.2)
-- --------------------------------------------------------------------------

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

  -- The bridge trigger has already written this row from auth.users. If it is missing, the caller
  -- skipped the Auth step and we must not invent a user.
  if not exists (select 1 from public.users u where u.id = p_user_id) then
    raise exception 'user_not_provisioned' using errcode = 'no_data_found';
  end if;

  -- A duplicate address is the 23505 the route reports as "This email is already registered".
  if exists (select 1 from public.users u where lower(u.email) = lower(p_email) and u.id <> p_user_id) then
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

  -- Seats are consumed by ACTIVE members. A newly invited user is not active yet, so this checks
  -- the seat they will occupy rather than the one they hold.
  select l.max_seats into v_max
    from public.plan_limits l
   where l.plan_id = public.tenant_current_plan(v_tenant);
  if v_max is not null then
    select count(*)::integer into v_used
      from public.tenant_users tu
      join public.users u on u.id = tu.user_id
     where tu.tenant_id = v_tenant and u.status = 'active' and u.id <> p_user_id;
    if (v_used + 1) > v_max then
      raise exception 'seat_limit_reached:%:%', v_used, v_max using errcode = 'check_violation';
    end if;
  end if;

  update public.users
     set name   = coalesce(nullif(btrim(p_name), ''), name),
         email  = lower(btrim(p_email)),
         phone  = p_phone,
         -- Invited, not active: the seat is not consumed until they accept and are activated.
         status = case when status = 'deleted' then status else 'pending_verification' end
   where id = p_user_id;

  insert into public.tenant_users (tenant_id, user_id, role)
  values (v_tenant, p_user_id, p_role::public.tenant_user_role)
  on conflict (tenant_id, user_id) do update set role = excluded.role;

  insert into public.user_invitations (user_id, purpose, token_hash, expires_at, created_by)
  values (p_user_id, 'invite', p_token_hash, p_expires_at, p_created_by);

  return query select p_user_id, v_tenant;
end;
$$;

comment on function public.admin_attach_user_to_tenant(uuid, text, text, text, uuid, text, text, text, timestamptz, uuid) is
  'SA-1.2 · Attaches an already-created Auth user to a tenant, with the seat check and the '
  'invitation, in one transaction. The user is created in Auth by the route, because '
  'public.users.id is foreign-keyed to auth.users.';

-- --------------------------------------------------------------------------
-- Edit a user, staging any email change (SA-1.3)
--
-- Error strings are fixed by app/api/admin/users/[id]/route.ts: LAST_OWNER and
-- EMAIL_ALREADY_REGISTERED. The return shape drives an audit row written as a diff.
-- --------------------------------------------------------------------------

create or replace function public.admin_update_user_with_email_change(
  p_user_id         uuid,
  p_name            text,
  p_phone           text,
  p_role            text,
  p_requested_email text,
  p_token_hash      text,
  p_expires_at      timestamptz,
  p_created_by      uuid
)
returns table (
  old_name             text,
  new_name             text,
  old_phone            text,
  new_phone            text,
  old_role             text,
  new_role             text,
  email_change_created boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user         public.users%rowtype;
  v_tenant       uuid;
  v_old_role     text;
  v_owner_count  integer;
  v_email_change boolean := false;
begin
  select * into v_user from public.users where id = p_user_id for update;
  if v_user.id is null then
    raise exception 'user_not_found' using errcode = 'no_data_found';
  end if;

  select tu.tenant_id, tu.role::text into v_tenant, v_old_role
    from public.tenant_users tu where tu.user_id = p_user_id limit 1;

  -- LA-0.2: "a tenant must always keep at least one owner — removing or demoting the last one is
  -- blocked". This is that guard, and it is in the database rather than the form because the form
  -- is not the only caller.
  if v_tenant is not null and v_old_role = 'owner' and p_role <> 'owner' then
    select count(*)::integer into v_owner_count
      from public.tenant_users tu
      join public.users u on u.id = tu.user_id
     where tu.tenant_id = v_tenant and tu.role = 'owner' and u.status <> 'deleted';
    if v_owner_count <= 1 then
      raise exception 'LAST_OWNER' using errcode = 'check_violation';
    end if;
  end if;

  -- Checked before anything is written. The whole function is one transaction, so a clash leaves
  -- the name, phone and role untouched too — which is what the "Should Not Commit" case in
  -- scripts/verify-user-integrity.mjs asserts.
  if lower(btrim(p_requested_email)) <> lower(v_user.email)
     and exists (select 1 from public.users u
                  where lower(u.email) = lower(btrim(p_requested_email)) and u.id <> p_user_id) then
    raise exception 'EMAIL_ALREADY_REGISTERED' using errcode = 'unique_violation';
  end if;

  update public.users
     set name  = coalesce(nullif(btrim(p_name), ''), name),
         phone = p_phone
   where id = p_user_id;

  if v_tenant is not null and p_role is not null and p_role <> v_old_role then
    update public.tenant_users set role = p_role::public.tenant_user_role
     where tenant_id = v_tenant and user_id = p_user_id;
    -- A role change takes effect on the user's next REQUEST, not their next login
    -- (LA-0.2 criterion 5), which is what bumping session_version buys.
    update public.users set session_version = coalesce(session_version, 0) + 1 where id = p_user_id;
  end if;

  if lower(btrim(p_requested_email)) <> lower(v_user.email) then
    -- Staged, never applied here. Supersede any outstanding request so only one confirmation link
    -- can ever work.
    update public.user_invitations
       set accepted_at = now()
     where user_id = p_user_id and purpose = 'email_change' and accepted_at is null;

    insert into public.user_invitations (user_id, purpose, token_hash, new_email, expires_at, created_by)
    values (p_user_id, 'email_change', p_token_hash, lower(btrim(p_requested_email)), p_expires_at, p_created_by);

    v_email_change := true;
  end if;

  return query
    select v_user.name, coalesce(nullif(btrim(p_name), ''), v_user.name),
           v_user.phone, p_phone,
           v_old_role, coalesce(p_role, v_old_role),
           v_email_change;
end;
$$;

revoke all on function public.admin_attach_user_to_tenant(uuid, text, text, text, uuid, text, text, text, timestamptz, uuid)
  from public, anon, authenticated, tenant_app;
revoke all on function public.admin_update_user_with_email_change(uuid, text, text, text, text, text, timestamptz, uuid)
  from public, anon, authenticated, tenant_app;
grant execute on function public.admin_attach_user_to_tenant(uuid, text, text, text, uuid, text, text, text, timestamptz, uuid) to service_role;
grant execute on function public.admin_update_user_with_email_change(uuid, text, text, text, text, text, timestamptz, uuid) to service_role;
