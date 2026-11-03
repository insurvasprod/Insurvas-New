-- ---------------------------------------------------------------------------
-- One seat rule, everywhere (user decision, admin tenant record › Users & seats)
--
-- A seat is held by a membership whose person is active, suspended, or invited and not accepted yet
-- (`invited`, and this application's spelling of it, `pending_verification`). A membership whose
-- person is inactive / deactivated (the two spellings of one state, see 20260912340000) or deleted
-- does not hold a seat.
--
-- Before this file the database had four different answers to "how many seats are used":
--
--   tenant_seats_used (20260911135000)             every tenant_users row, whatever the state
--   admin_set_user_status (20260911141000, text)   active members only
--   admin_set_user_status (20260903310000, enum)   active + suspended
--   admin_attach_user_to_tenant (20260913100000)   active members only
--   buffer seats, invite path (20260913385000)     active + suspended assistants
--   buffer seats, role change (20260910120000)     every assistant row
--   setter seats, trigger (20260914105621)         every setter row
--
-- So an invite held a seat on the tenant's own invite path and did not on the admin's; a deactivated
-- person held a seat forever on one path and none on another. Each function below is rebuilt from
-- its LATEST definition with only the counting changed, all of them through one predicate.
--
-- Additive in spirit: same signatures, same grants, same error strings (lib/users/setStatus.ts and
-- app/api/app/team/** already parse `seat_limit_reached:<used>:<max>`, `max_buffer_seats:<used>:<max>`
-- and `max_setter_seats:<used>:<max>`).
-- ---------------------------------------------------------------------------

-- 1. The rule ---------------------------------------------------------------------------------------

create or replace function public.user_status_holds_seat(p_status text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p_status in ('active', 'suspended', 'invited', 'pending_verification'), false);
$$;

comment on function public.user_status_holds_seat(text) is
  'The one seat rule: active, suspended and invited (invited / pending_verification) people hold a seat; inactive, deactivated and deleted do not. Mirrored by lib/tenantTeam/seats.ts.';

revoke all on function public.user_status_holds_seat(text) from public, anon, authenticated, tenant_app;
grant execute on function public.user_status_holds_seat(text) to service_role;

-- 2. Seats used ------------------------------------------------------------------------------------
-- From 20260911135000 (the latest definition); only the WHERE clause changes.

create or replace function public.tenant_seats_used(p_tenant_id uuid)
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)::integer
    from public.tenant_users tu
    join public.users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id
     and public.user_status_holds_seat(u.status::text);
$$;

comment on function public.tenant_seats_used(uuid) is
  'Seats held by this tenant under the one seat rule (user_status_holds_seat): active, suspended and not-yet-accepted invited members. 20260924346000.';

revoke all on function public.tenant_seats_used(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_seats_used(uuid) to service_role;

-- 2b. The seat limit ------------------------------------------------------------------------------
-- plan_limits.max_seats for the tenant's current plan; an individual plan with no explicit max_seats is
-- ONE seat (user decision), the same fallback as lib/tenantTeam/seats.ts seatLimitFor and the
-- entitlement engine. Null = no limit (no plan, or a non-individual plan without a cap). Used only by
-- the checks that decide whether someone can join or be activated: nobody already in is removed, an
-- individual tenant already over one seat simply cannot add another.

create or replace function public.tenant_seat_limit(p_tenant_id uuid)
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(pl.max_seats, case when p.plan_type::text = 'individual' then 1 end)
    from public.plans p
    left join public.plan_limits pl on pl.plan_id = p.id
   where p.id = public.tenant_current_plan(p_tenant_id);
$$;

comment on function public.tenant_seat_limit(uuid) is
  'Seat limit of the tenant''s current plan: plan_limits.max_seats, or 1 for an individual plan without one (mirrors lib/tenantTeam/seats.ts seatLimitFor). Null = no limit. 20260924346000.';

revoke all on function public.tenant_seat_limit(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_seat_limit(uuid) to service_role;

-- 3. The check a status change makes ----------------------------------------------------------------
-- A person starts holding a seat when they move from a state that does not hold one into a state that
-- does (inactive -> active, inactive -> suspended, ...). Status is account-wide, so the check runs for
-- every tenant they belong to, under the same per-tenant lock the invite path takes.

create or replace function public.assert_user_seat_transition(p_user_id uuid, p_from text, p_to text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  r        record;
  v_plan   uuid;
  v_max    integer;
  v_buffer integer;
  v_setter integer;
  v_used   integer;
begin
  if public.user_status_holds_seat(p_from) or not public.user_status_holds_seat(p_to) then
    return;
  end if;

  for r in
    select tu.tenant_id, tu.role::text as role
      from public.tenant_users tu
     where tu.user_id = p_user_id
     order by tu.tenant_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(r.tenant_id::text, 0));
    v_plan := public.tenant_current_plan(r.tenant_id);
    continue when v_plan is null;

    select pl.max_buffer_seats, pl.max_setter_seats
      into v_buffer, v_setter
      from public.plan_limits pl
     where pl.plan_id = v_plan;
    v_max := public.tenant_seat_limit(r.tenant_id);

    -- The person does not hold a seat yet (p_from), so the count below excludes them.
    if v_max is not null then
      v_used := public.tenant_seats_used(r.tenant_id);
      if v_used + 1 > v_max then
        raise exception 'seat_limit_reached:%:%', v_used, v_max using errcode = 'check_violation';
      end if;
    end if;

    if r.role = 'assistant' and v_buffer is not null then
      select count(*)::integer into v_used
        from public.tenant_users tu
        join public.users u on u.id = tu.user_id
       where tu.tenant_id = r.tenant_id
         and tu.role::text = 'assistant'
         and public.user_status_holds_seat(u.status::text);
      if v_used + 1 > v_buffer then
        raise exception 'max_buffer_seats:%:%', v_used, v_buffer using errcode = 'check_violation';
      end if;
    end if;

    if r.role = 'setter' and v_setter is not null then
      select count(*)::integer into v_used
        from public.tenant_users tu
        join public.users u on u.id = tu.user_id
       where tu.tenant_id = r.tenant_id
         and tu.role::text = 'setter'
         and public.user_status_holds_seat(u.status::text);
      if v_used + 1 > v_setter then
        raise exception 'max_setter_seats:%:%', v_used, v_setter using errcode = 'check_violation';
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function public.assert_user_seat_transition(uuid, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.assert_user_seat_transition(uuid, text, text) to service_role;

-- 4. admin_set_user_status, text overload -----------------------------------------------------------
-- From 20260911141000 (the latest). The lifecycle is unchanged; the seat block is the shared check,
-- which now also covers inactive -> suspended (a suspended person holds a seat).

create or replace function public.admin_set_user_status(
  p_user_id uuid,
  p_status  text,
  p_reason  text default null
)
returns public.users
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user    public.users%rowtype;
  v_allowed boolean;
begin
  select * into v_user from public.users where id = p_user_id for update;
  if v_user.id is null then
    raise exception 'user_not_found' using errcode = 'no_data_found';
  end if;

  if p_status not in ('pending_verification', 'active', 'inactive', 'suspended', 'deleted') then
    raise exception 'USER_TRANSITION_NOT_ALLOWED: unknown status %', p_status using errcode = 'check_violation';
  end if;

  if v_user.status::text = p_status then
    raise exception 'USER_ALREADY_IN_STATE' using errcode = 'check_violation';
  end if;

  -- SA-1.4's lifecycle. Deletion is terminal; everything else is reversible, which is why
  -- hard deletion was descoped in favour of a status.
  v_allowed := case
    when v_user.status::text = 'deleted' then false
    when p_status = 'deleted' then true
    when p_status = 'active' then v_user.status::text in ('inactive', 'suspended', 'pending_verification')
    when p_status = 'inactive' then v_user.status::text in ('active', 'suspended')
    when p_status = 'suspended' then v_user.status::text in ('active', 'inactive')
    when p_status = 'pending_verification' then false
    else false
  end;

  if not v_allowed then
    raise exception 'USER_TRANSITION_NOT_ALLOWED: % -> %', v_user.status, p_status using errcode = 'check_violation';
  end if;

  -- The one seat rule: only a move INTO a seat-holding state can be refused. Deactivating and
  -- deleting never can.
  perform public.assert_user_seat_transition(p_user_id, v_user.status::text, p_status);

  update public.users
     set status            = p_status,
         suspended_at      = case when p_status = 'suspended' then now() else null end,
         suspension_reason = case when p_status = 'suspended' then p_reason else null end,
         -- Every state change invalidates outstanding sessions: resolveTenantContext() compares
         -- session_version on each request, so a suspended user is out on their next click rather
         -- than at their next login.
         session_version   = coalesce(v_user.session_version, 0) + 1
   where id = p_user_id
  returning * into v_user;

  return v_user;
end;
$$;

revoke all on function public.admin_set_user_status(uuid, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.admin_set_user_status(uuid, text, text) to service_role;

-- 5. admin_set_user_status, enum overload -----------------------------------------------------------
-- 20260903310000 declared a second overload over the repository's `user_status` enum. The live
-- users.status is text with a CHECK (20260912340000), so that type, and therefore this overload, may
-- not exist in a given database. Rebuilt only where it does, with the same seat check, so neither
-- overload can be used to step around the rule. Nested IFs: to_regprocedure may raise on a type name
-- that does not exist, and SQL does not promise to short-circuit AND.

do $do$
begin
  if to_regtype('public.user_status') is not null then
    if to_regprocedure('public.admin_set_user_status(uuid,public.user_status,text)') is not null then
      execute $ddl$
        create or replace function public.admin_set_user_status(p_user_id uuid, p_status public.user_status, p_reason text default null)
        returns table(old_status public.user_status, new_status public.user_status)
        language plpgsql security definer set search_path = public
        as $function$
        declare
          v_user public.users%rowtype; v_tenant_id uuid;
        begin
          select u.* into v_user from public.users u where u.id = p_user_id for update;
          if not found then raise exception 'USER_NOT_FOUND'; end if;
          select tu.tenant_id into v_tenant_id from public.tenant_users tu where tu.user_id = p_user_id limit 1 for update;
          if found then perform 1 from public.tenants t where t.id = v_tenant_id for update; end if;
          if v_user.status::text = p_status::text then raise exception 'USER_ALREADY_IN_STATE'; end if;
          if not ((v_user.status::text = 'active' and p_status::text in ('inactive', 'suspended'))
               or (v_user.status::text in ('inactive', 'suspended') and p_status::text = 'active')) then
            raise exception 'USER_TRANSITION_NOT_ALLOWED:%:%', v_user.status, p_status;
          end if;
          perform public.assert_user_seat_transition(p_user_id, v_user.status::text, p_status::text);
          update public.users set status = p_status,
            suspended_at = case when p_status::text = 'suspended' then coalesce(suspended_at, now()) else null end,
            suspension_reason = case when p_status::text = 'suspended' then nullif(btrim(p_reason), '') else null end,
            session_version = coalesce(session_version, 0) + 1
           where id = p_user_id;
          return query select v_user.status::text::public.user_status, p_status;
        end;
        $function$
      $ddl$;
      execute 'revoke all on function public.admin_set_user_status(uuid,public.user_status,text) from public, anon, authenticated, tenant_app';
      execute 'grant execute on function public.admin_set_user_status(uuid,public.user_status,text) to service_role';
    end if;
  end if;
end;
$do$;

-- 6. admin_attach_user_to_tenant --------------------------------------------------------------------
-- From 20260913100000 (the latest). The seat count is tenant_seats_used, less this person if their
-- membership already holds a seat there (the ON CONFLICT path re-attaches an existing member).

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
  v_tenant         uuid;
  v_max            integer;
  v_used           integer;
  v_self           integer;
  v_effective_role text;
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
    v_effective_role := p_role;
  else
    insert into public.tenants (name, status, onboarding_state)
    values (btrim(p_new_tenant_name), 'active', 'pending')
    returning id into v_tenant;
    v_effective_role := 'owner';
  end if;

  -- The same lock the invite path and the status check take, so two attachments on the last seat
  -- produce one member and one refusal.
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text, 0));

  v_max := public.tenant_seat_limit(v_tenant);

  if v_max is not null then
    select count(*)::integer into v_self
      from public.tenant_users tu
      join public.users u on u.id = tu.user_id
     where tu.tenant_id = v_tenant
       and tu.user_id = p_user_id
       and public.user_status_holds_seat(u.status::text);
    v_used := public.tenant_seats_used(v_tenant) - v_self;
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
  values (v_tenant, p_user_id, v_effective_role::public.tenant_user_role)
  on conflict on constraint tenant_users_pkey do update
    set role = excluded.role;

  insert into public.user_invitations (user_id, purpose, token_hash, expires_at, created_by)
  values (p_user_id, 'invite', p_token_hash, p_expires_at, p_created_by);

  return query select p_user_id, v_tenant;
end;
$$;

comment on function public.admin_attach_user_to_tenant(uuid, text, text, text, uuid, text, text, text, timestamptz, uuid) is
  'SA-1.2 · Attaches an Auth-created user to a tenant, forces the first new-tenant membership to owner, and issues an invitation transactionally. Seats counted by the one seat rule (20260924346000).';

revoke all on function public.admin_attach_user_to_tenant(uuid, text, text, text, uuid, text, text, text, timestamptz, uuid)
  from public, anon, authenticated, tenant_app;
grant execute on function public.admin_attach_user_to_tenant(uuid, text, text, text, uuid, text, text, text, timestamptz, uuid) to service_role;

-- 7. tenant_invite_user_with_auth -------------------------------------------------------------------
-- From 20260913385000 (the latest). max_seats already went through tenant_seats_used; the buffer
-- sub-limit now counts by the same rule (it counted active + suspended, so an unaccepted assistant
-- invite did not hold a buffer seat).

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
  -- tenant_seat_limit: an individual plan without an explicit max_seats is one seat.
  v_max_seats := public.tenant_seat_limit(p_tenant_id);
  if v_max_seats is not null then
    v_used := public.tenant_seats_used(p_tenant_id);
    if v_used >= v_max_seats then
      raise exception 'seat_limit_reached:%:%', v_used, v_max_seats;
    end if;
  end if;

  -- The buffer-seat sub-limit still applies on top: an assistant consumes a seat AND a buffer seat,
  -- counted by the same rule as seats.
  if p_role = 'assistant' then
    select count(*)::integer into v_count
    from public.tenant_users tu
    join public.users u on u.id = tu.user_id
    where tu.tenant_id = p_tenant_id
      and tu.role = 'assistant'
      and public.user_status_holds_seat(u.status::text);
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

-- 8. tenant_update_member_role_with_limit -----------------------------------------------------------
-- From 20260910120000 (the latest). It counted every assistant row, deactivated ones included, and
-- refused even when the person being changed holds no seat. Now: held assistants only, and only when
-- the person being made an assistant holds a seat themselves.

create or replace function public.tenant_update_member_role_with_limit(p_tenant_id uuid, p_user_id uuid, p_role public.tenant_user_role, p_max_buffer_seats integer default null)
returns table(old_role public.tenant_user_role, new_role public.tenant_user_role)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
begin
  if p_role = 'assistant' and p_max_buffer_seats is not null
     and exists (select 1 from public.users u where u.id = p_user_id and public.user_status_holds_seat(u.status::text)) then
    perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
    select count(*)::integer into v_used
      from public.tenant_users tu
      join public.users u on u.id = tu.user_id
     where tu.tenant_id = p_tenant_id
       and tu.role = 'assistant'
       and tu.user_id <> p_user_id
       and public.user_status_holds_seat(u.status::text);
    -- With the numbers now: app/api/app/team/[userId]/route.ts matches `max_buffer_seats:<used>:<max>`
    -- and answered a bare 'max_buffer_seats' with a generic 500.
    if v_used >= p_max_buffer_seats then
      raise exception 'max_buffer_seats:%:%', v_used, p_max_buffer_seats;
    end if;
  end if;
  return query select * from public.tenant_update_member_role(p_tenant_id, p_user_id, p_role);
end;
$$;

revoke all on function public.tenant_update_member_role_with_limit(uuid,uuid,public.tenant_user_role,integer) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_update_member_role_with_limit(uuid,uuid,public.tenant_user_role,integer) to service_role;

-- 9. enforce_outbound_fixed_limits (setter seats) ---------------------------------------------------
-- From 20260914105621 (the latest). Only the setter count changes; the campaign branch is verbatim.

create or replace function public.enforce_outbound_fixed_limits()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_plan uuid;
  v_cap integer;
  v_used integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text, 0));
  v_plan := public.tenant_current_plan(new.tenant_id);

  if tg_table_name = 'tenant_users' then
    if new.role::text = 'setter' then
      select max_setter_seats into v_cap from public.plan_limits where plan_id = v_plan;
      if v_cap is not null then
        select count(*)::integer into v_used
          from public.tenant_users tu
          join public.users u on u.id = tu.user_id
         where tu.tenant_id = new.tenant_id
           and tu.role::text = 'setter'
           and public.user_status_holds_seat(u.status::text);
        if v_used > v_cap then
          raise exception 'max_setter_seats:%:%', v_used - 1, v_cap;
        end if;
      end if;
    end if;
  elsif tg_table_name = 'tenant_campaigns' then
    if new.status = 'active' then
      select max_active_campaigns into v_cap from public.plan_limits where plan_id = v_plan;
      if v_cap is not null then
        select count(*)::integer into v_used
          from public.tenant_campaigns
         where tenant_id = new.tenant_id and status = 'active';
        if v_used > v_cap then
          raise exception 'max_active_campaigns:%:%', v_used - 1, v_cap;
        end if;
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_outbound_fixed_limits()
  from public, anon, authenticated, tenant_app;

-- 10. Assertions ------------------------------------------------------------------------------------

do $$
declare
  v_def text;
begin
  -- A role that cannot create objects cannot have applied anything above either (scripts/
  -- check-migrations.mjs parse-checks with such a role); a real apply always reaches the checks.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260924346000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if not public.user_status_holds_seat('invited') or not public.user_status_holds_seat('suspended')
     or not public.user_status_holds_seat('active') or not public.user_status_holds_seat('pending_verification')
     or public.user_status_holds_seat('inactive') or public.user_status_holds_seat('deactivated')
     or public.user_status_holds_seat('deleted') or public.user_status_holds_seat(null) then
    raise exception 'user_status_holds_seat does not implement the one seat rule';
  end if;

  foreach v_def in array array[
    'public.tenant_seats_used(uuid)',
    'public.admin_set_user_status(uuid,text,text)',
    'public.admin_attach_user_to_tenant(uuid,text,text,text,uuid,text,text,text,timestamptz,uuid)',
    'public.tenant_invite_user_with_auth(uuid,text,text,public.tenant_user_role,uuid,text,timestamptz,uuid,integer)',
    'public.tenant_update_member_role_with_limit(uuid,uuid,public.tenant_user_role,integer)',
    'public.enforce_outbound_fixed_limits()'
  ] loop
    if to_regprocedure(v_def) is null then
      raise exception '% is missing', v_def;
    end if;
    if pg_get_functiondef(to_regprocedure(v_def)) !~ '(user_status_holds_seat|assert_user_seat_transition|tenant_seats_used)' then
      raise exception '% does not count seats by the one seat rule', v_def;
    end if;
  end loop;

  foreach v_def in array array[
    'public.assert_user_seat_transition(uuid,text,text)',
    'public.admin_attach_user_to_tenant(uuid,text,text,text,uuid,text,text,text,timestamptz,uuid)',
    'public.tenant_invite_user_with_auth(uuid,text,text,public.tenant_user_role,uuid,text,timestamptz,uuid,integer)'
  ] loop
    if pg_get_functiondef(to_regprocedure(v_def)) !~ 'tenant_seat_limit' then
      raise exception '% does not read the seat limit through tenant_seat_limit', v_def;
    end if;
  end loop;

  if pg_get_functiondef('public.admin_set_user_status(uuid,text,text)'::regprocedure) !~ 'assert_user_seat_transition' then
    raise exception 'admin_set_user_status(text) does not use the shared seat check';
  end if;

  raise notice '20260924346000: one seat rule in place (active, suspended, invited hold a seat)';
end;
$$;
