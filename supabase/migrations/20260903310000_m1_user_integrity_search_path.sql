-- M1 integrity follow-up: helper functions in the existing schema expect the public search path.
-- Keep the definer functions deterministic while allowing them to call those helpers safely.

create or replace function public.admin_create_user(
  p_name text, p_email text, p_phone text, p_tenant_id uuid, p_new_tenant_name text,
  p_role public.tenant_user_role, p_token_hash text, p_expires_at timestamptz, p_created_by uuid
)
returns table(user_id uuid, tenant_id uuid)
language plpgsql security definer set search_path = public
as $function$
declare
  v_user_id uuid; v_tenant_id uuid; v_plan uuid; v_max_seats integer; v_used integer;
  v_members integer; v_owners integer; v_role public.tenant_user_role := p_role;
begin
  if p_tenant_id is null and nullif(btrim(p_new_tenant_name), '') is null then raise exception 'either an existing tenant or a new tenant name is required'; end if;
  if p_tenant_id is not null and nullif(btrim(p_new_tenant_name), '') is not null then raise exception 'choose an existing tenant or a new tenant, not both'; end if;
  if p_tenant_id is null then
    insert into public.tenants (name, status) values (btrim(p_new_tenant_name), 'provisioning') returning id into v_tenant_id;
  else
    select t.id into v_tenant_id from public.tenants t where t.id = p_tenant_id for update;
    if not found then raise exception 'tenant_not_found'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_tenant_id::text, 0));
  select count(*) into v_members from public.tenant_users tu where tu.tenant_id = v_tenant_id;
  select count(*) into v_owners from public.tenant_users tu where tu.tenant_id = v_tenant_id and tu.role = 'owner';
  if v_members = 0 or v_owners = 0 then v_role := 'owner'; end if;
  v_plan := public.tenant_current_plan(v_tenant_id);
  if v_plan is not null then
    select pl.max_seats into v_max_seats from public.plan_limits pl where pl.plan_id = v_plan;
    if v_max_seats is not null then
      v_used := public.tenant_seats_used(v_tenant_id);
      if v_used >= v_max_seats then raise exception 'seat_limit_reached:%:%', v_used, v_max_seats; end if;
    end if;
  end if;
  insert into public.users (name, email, phone, status) values (btrim(p_name), lower(btrim(p_email)), nullif(btrim(coalesce(p_phone, '')), ''), 'active') returning id into v_user_id;
  insert into public.tenant_users (tenant_id, user_id, role, accepted_at) values (v_tenant_id, v_user_id, v_role, null);
  insert into public.user_invitations (user_id, token_hash, expires_at, created_by) values (v_user_id, p_token_hash, p_expires_at, p_created_by);
  return query select v_user_id, v_tenant_id;
end;
$function$;

create or replace function public.admin_set_user_status(p_user_id uuid, p_status public.user_status, p_reason text default null)
returns table(old_status public.user_status, new_status public.user_status)
language plpgsql security definer set search_path = public
as $function$
declare
  v_user public.users%rowtype; v_tenant_id uuid; v_used integer; v_max_seats integer; v_plan uuid;
begin
  select u.* into v_user from public.users u where u.id = p_user_id for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  select tu.tenant_id into v_tenant_id from public.tenant_users tu where tu.user_id = p_user_id for update;
  if found then perform 1 from public.tenants t where t.id = v_tenant_id for update; end if;
  if v_user.status = p_status then raise exception 'USER_ALREADY_IN_STATE'; end if;
  if not ((v_user.status = 'active' and p_status in ('inactive', 'suspended')) or (v_user.status in ('inactive', 'suspended') and p_status = 'active')) then
    raise exception 'USER_TRANSITION_NOT_ALLOWED:%:%', v_user.status, p_status;
  end if;
  if p_status in ('active', 'suspended') and v_tenant_id is not null then
    v_plan := public.tenant_current_plan(v_tenant_id);
    select pl.max_seats into v_max_seats from public.plan_limits pl where pl.plan_id = v_plan;
    if v_max_seats is not null then
      select count(*) into v_used from public.tenant_users tu join public.users u on u.id = tu.user_id where tu.tenant_id = v_tenant_id and tu.user_id <> p_user_id and u.status in ('active', 'suspended');
      if v_used >= v_max_seats then raise exception 'seat_limit_reached:%:%', v_used, v_max_seats; end if;
    end if;
  end if;
  update public.users set status = p_status,
    suspended_at = case when p_status = 'suspended' then coalesce(suspended_at, now()) else null end,
    suspension_reason = case when p_status = 'suspended' then nullif(btrim(p_reason), '') else null end,
    session_version = session_version + 1 where id = p_user_id;
  return query select v_user.status, p_status;
end;
$function$;

revoke all on function public.admin_create_user(text,text,text,uuid,text,public.tenant_user_role,text,timestamptz,uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.admin_create_user(text,text,text,uuid,text,public.tenant_user_role,text,timestamptz,uuid) to service_role;
revoke all on function public.admin_set_user_status(uuid,public.user_status,text) from public, anon, authenticated, tenant_app;
grant execute on function public.admin_set_user_status(uuid,public.user_status,text) to service_role;
