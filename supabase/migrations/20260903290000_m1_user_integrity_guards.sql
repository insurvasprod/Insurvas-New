-- M1-3/M1-4/M1-5/M1-6/M1-8/M1-9:
-- keep administrator user mutations atomic, revoke old tenant sessions on lifecycle changes,
-- and make the first membership an owner while enforcing seat and transition rules in SQL.

alter table public.users
  add column if not exists session_version integer not null default 0;

create or replace function public.admin_create_user(
  p_name text,
  p_email text,
  p_phone text,
  p_tenant_id uuid,
  p_new_tenant_name text,
  p_role public.tenant_user_role,
  p_token_hash text,
  p_expires_at timestamptz,
  p_created_by uuid
)
returns table(user_id uuid, tenant_id uuid)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid;
  v_tenant_id uuid;
  v_plan uuid;
  v_max_seats integer;
  v_used integer;
  v_members integer;
  v_owners integer;
  v_role public.tenant_user_role := p_role;
begin
  if p_tenant_id is null and nullif(btrim(p_new_tenant_name), '') is null then
    raise exception 'either an existing tenant or a new tenant name is required';
  end if;
  if p_tenant_id is not null and nullif(btrim(p_new_tenant_name), '') is not null then
    raise exception 'choose an existing tenant or a new tenant, not both';
  end if;

  if p_tenant_id is null then
    insert into public.tenants (name, status) values (btrim(p_new_tenant_name), 'provisioning')
      returning id into v_tenant_id;
  else
    select t.id into v_tenant_id from public.tenants t where t.id = p_tenant_id for update;
    if not found then raise exception 'tenant_not_found'; end if;
  end if;

  -- One tenant lock serializes seat checks and ownership decisions across concurrent admins.
  perform pg_advisory_xact_lock(hashtextextended(v_tenant_id::text, 0));
  select count(*) into v_members from public.tenant_users tu where tu.tenant_id = v_tenant_id;
  select count(*) into v_owners from public.tenant_users tu where tu.tenant_id = v_tenant_id and tu.role = 'owner';
  if v_members = 0 or v_owners = 0 then
    v_role := 'owner';
  end if;

  v_plan := public.tenant_current_plan(v_tenant_id);
  if v_plan is not null then
    select pl.max_seats into v_max_seats from public.plan_limits pl where pl.plan_id = v_plan;
    if v_max_seats is not null then
      v_used := public.tenant_seats_used(v_tenant_id);
      if v_used >= v_max_seats then
        raise exception 'seat_limit_reached:%:%', v_used, v_max_seats;
      end if;
    end if;
  end if;

  insert into public.users (name, email, phone, status)
  values (btrim(p_name), lower(btrim(p_email)), nullif(btrim(coalesce(p_phone, '')), ''), 'active')
  returning id into v_user_id;

  insert into public.tenant_users (tenant_id, user_id, role, accepted_at)
  values (v_tenant_id, v_user_id, v_role, null);
  insert into public.user_invitations (user_id, token_hash, expires_at, created_by)
  values (v_user_id, p_token_hash, p_expires_at, p_created_by);

  return query select v_user_id, v_tenant_id;
end;
$function$;

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
  old_name text, old_phone text, old_role public.tenant_user_role, old_email text,
  new_name text, new_phone text, new_role public.tenant_user_role,
  requested_email text, email_change_created boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user public.users%rowtype;
  v_tenant_id uuid;
  v_old_role public.tenant_user_role;
  v_owner_count integer;
  v_email text := lower(btrim(p_requested_email));
  v_email_change boolean;
begin
  select u.* into v_user from public.users u where u.id = p_user_id for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  select tu.tenant_id, tu.role into v_tenant_id, v_old_role
    from public.tenant_users tu where tu.user_id = p_user_id for update;
  if not found then raise exception 'MEMBERSHIP_NOT_FOUND'; end if;
  perform 1 from public.tenants t where t.id = v_tenant_id for update;

  if v_old_role = 'owner' and p_role <> 'owner' then
    select count(*) into v_owner_count from public.tenant_users tu
      where tu.tenant_id = v_tenant_id and tu.role = 'owner';
    if v_owner_count <= 1 then raise exception 'LAST_OWNER'; end if;
  end if;
  v_email_change := v_email <> lower(v_user.email);
  if v_email_change and exists (
    select 1 from public.users u where lower(u.email) = v_email and u.id <> p_user_id
  ) then raise exception 'EMAIL_ALREADY_REGISTERED'; end if;

  update public.users set name = btrim(p_name), phone = nullif(btrim(coalesce(p_phone, '')), '') where id = p_user_id;
  update public.tenant_users set role = p_role where tenant_id = v_tenant_id and user_id = p_user_id;
  if v_email_change then
    update public.user_invitations set accepted_at = now()
      where user_id = p_user_id and purpose = 'email_change' and accepted_at is null;
    insert into public.user_invitations (user_id, token_hash, expires_at, created_by, purpose, new_email)
      values (p_user_id, p_token_hash, p_expires_at, p_created_by, 'email_change', v_email);
  end if;

  return query select v_user.name, v_user.phone, v_old_role, v_user.email,
    btrim(p_name), nullif(btrim(coalesce(p_phone, '')), ''), p_role, v_email, v_email_change;
end;
$function$;

create or replace function public.admin_replace_user_token(
  p_user_id uuid,
  p_purpose public.user_token_purpose,
  p_token_hash text,
  p_expires_at timestamptz,
  p_created_by uuid
)
returns table(token_id uuid, email text, name text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user public.users%rowtype;
  v_token_id uuid;
begin
  if p_purpose not in ('invite', 'password_reset') then raise exception 'UNSUPPORTED_TOKEN_PURPOSE'; end if;
  select u.* into v_user from public.users u where u.id = p_user_id for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  if v_user.status = 'deleted' then raise exception 'USER_REMOVED'; end if;
  if p_purpose = 'invite' and v_user.password_hash is not null then raise exception 'PASSWORD_ALREADY_SET'; end if;
  if p_purpose = 'password_reset' and v_user.password_hash is null then raise exception 'PASSWORD_NOT_SET'; end if;

  update public.user_invitations set accepted_at = now()
    where user_id = p_user_id and purpose = p_purpose and accepted_at is null;
  insert into public.user_invitations (user_id, token_hash, expires_at, created_by, purpose)
    values (p_user_id, p_token_hash, p_expires_at, p_created_by, p_purpose)
    returning id into v_token_id;
  return query select v_token_id, v_user.email, v_user.name;
end;
$function$;

create or replace function public.admin_set_user_status(
  p_user_id uuid,
  p_status public.user_status,
  p_reason text default null
)
returns table(old_status public.user_status, new_status public.user_status)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user public.users%rowtype;
  v_tenant_id uuid;
  v_used integer;
  v_max_seats integer;
  v_plan uuid;
begin
  select u.* into v_user from public.users u where u.id = p_user_id for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  select tu.tenant_id into v_tenant_id from public.tenant_users tu where tu.user_id = p_user_id for update;
  if found then perform 1 from public.tenants t where t.id = v_tenant_id for update; end if;

  if v_user.status = p_status then raise exception 'USER_ALREADY_IN_STATE'; end if;
  if not (
    (v_user.status = 'active' and p_status in ('inactive', 'suspended')) or
    (v_user.status in ('inactive', 'suspended') and p_status = 'active')
  ) then raise exception 'USER_TRANSITION_NOT_ALLOWED:%:%', v_user.status, p_status; end if;

  if p_status in ('active', 'suspended') and v_tenant_id is not null then
    v_plan := public.tenant_current_plan(v_tenant_id);
    select pl.max_seats into v_max_seats from public.plan_limits pl where pl.plan_id = v_plan;
    if v_max_seats is not null then
      select count(*) into v_used from public.tenant_users tu join public.users u on u.id = tu.user_id
        where tu.tenant_id = v_tenant_id and tu.user_id <> p_user_id and u.status in ('active', 'suspended');
      if v_used >= v_max_seats then raise exception 'seat_limit_reached:%:%', v_used, v_max_seats; end if;
    end if;
  end if;

  update public.users set
    status = p_status,
    suspended_at = case when p_status = 'suspended' then coalesce(suspended_at, now()) else null end,
    suspension_reason = case when p_status = 'suspended' then nullif(btrim(p_reason), '') else null end,
    session_version = session_version + 1
  where id = p_user_id;
  return query select v_user.status, p_status;
end;
$function$;

revoke all on function public.admin_create_user(text,text,text,uuid,text,public.tenant_user_role,text,timestamptz,uuid)
  from public, anon, authenticated, tenant_app;
grant execute on function public.admin_create_user(text,text,text,uuid,text,public.tenant_user_role,text,timestamptz,uuid) to service_role;
revoke all on function public.admin_update_user_with_email_change(uuid,text,text,public.tenant_user_role,text,text,timestamptz,uuid)
  from public, anon, authenticated, tenant_app;
grant execute on function public.admin_update_user_with_email_change(uuid,text,text,public.tenant_user_role,text,text,timestamptz,uuid) to service_role;
revoke all on function public.admin_replace_user_token(uuid,public.user_token_purpose,text,timestamptz,uuid)
  from public, anon, authenticated, tenant_app;
grant execute on function public.admin_replace_user_token(uuid,public.user_token_purpose,text,timestamptz,uuid) to service_role;
revoke all on function public.admin_set_user_status(uuid,public.user_status,text)
  from public, anon, authenticated, tenant_app;
grant execute on function public.admin_set_user_status(uuid,public.user_status,text) to service_role;
