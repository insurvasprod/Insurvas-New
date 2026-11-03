-- ---------------------------------------------------------------------------
-- LA-2.12 criterion 5 · "Setter seats count against the plan limit"
--
-- They did not. Neither did anybody else's.
--
-- `max_seats` is enforced in exactly three places — admin_create_user, admin_set_user_status and
-- admin_attach_user_to_tenant — and all three are the PLATFORM ADMIN's path. The path a tenant
-- owner actually uses to add a teammate is `tenant_invite_user_with_auth`, from the team settings
-- page, and it checks `max_buffer_seats` for assistants and nothing at all for everyone else.
-- There is no trigger on `tenant_users` either, so nothing downstream caught it.
--
-- The effect is not subtle: any tenant on any plan could invite unlimited seats from their own
-- settings page. Backlog #15 is recorded as resolved on the strength of SA-2.5 enforcing seats "at
-- user creation", which is true of the admin path and was never true of this one.
--
-- This is written as a seat check for every role rather than a setter-shaped special case, because
-- a limit that applies to one role and not the others is the bug again in a smaller costume.
--
-- Reuses tenant_current_plan / tenant_seats_used and raises the identical
-- `seat_limit_reached:<used>:<max>` string, which lib/users/setStatus.ts already parses — so the
-- new refusal arrives in a shape the application has understood since SA-2.5.
-- ---------------------------------------------------------------------------

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
  v_plan uuid;
  v_max_seats integer;
  v_used integer;
begin
  -- The same lock the rest of the seat arithmetic takes. Two owners inviting simultaneously on a
  -- plan with one seat left must produce one member and one refusal, not two members.
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

  -- THE SEAT LIMIT, for every role including setter. Read from plan_limits rather than from a
  -- number the caller passed, so a client that omits or forges it cannot buy itself a seat.
  v_plan := public.tenant_current_plan(p_tenant_id);
  if v_plan is not null then
    select pl.max_seats into v_max_seats from public.plan_limits pl where pl.plan_id = v_plan;
    if v_max_seats is not null then
      v_used := public.tenant_seats_used(p_tenant_id);
      if v_used >= v_max_seats then
        raise exception 'seat_limit_reached:%:%', v_used, v_max_seats;
      end if;
    end if;
  end if;

  -- The buffer-seat sub-limit still applies on top: an assistant consumes a seat AND a buffer seat.
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

do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'tenant_invite_user_with_auth'
         and pg_get_functiondef(p.oid) ~ 'seat_limit_reached') <> 1 then
    raise exception 'the tenant invite path still does not check max_seats';
  end if;
  raise notice 'LA-2.12: the tenant invite path now counts a seat for every role';
end $$;
