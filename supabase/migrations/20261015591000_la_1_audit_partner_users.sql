-- LA-1 audit · partner users: one agency-wide seat count, and who suspended whom.
--
-- 1. max_partner_users is "total closers across all partners" (LA-1.19). Reactivation and partner
--    resume already count it agency-wide (20260912120000, 20260925709950), but both invite paths
--    counted ONE partner's users, so an agency on a 40-seat plan could hold 40 per partner. The
--    invite now counts every active user of every active partner (plus this partner's own), under a
--    per-tenant lock, so two partners inviting at once cannot both take the last seat.
-- 2. A user of a PAUSED partner could not be suspended (partner_not_found_or_offboarded → 404).
--    Suspension and reactivation now work for active and paused partners; only an offboarded or
--    draft partner refuses. Paused partners' users hold no seat, so reactivating one is not counted
--    until the partner resumes (transition_partner_with_limits counts them then).
-- 3. A partner admin could undo the agency's suspension of one of their users. Each suspension now
--    records which side made it (partner_users.revoked_by_plane); the partner side cannot reactivate
--    a user the agency suspended (partner_user_suspended_by_agency → 403).
--
-- Both invite overloads are restated from their live definitions (read 2026-10-15), changed only
-- where noted. partner_set_user_status_with_limit gains p_actor_plane, so the old signature is dropped.

alter table public.partner_users
  add column if not exists revoked_by_plane text;

do $$ begin
  alter table public.partner_users
    add constraint partner_users_revoked_by_plane_check check (revoked_by_plane is null or revoked_by_plane in ('agency', 'partner'));
exception when duplicate_object then null;
end $$;

comment on column public.partner_users.revoked_by_plane is
  'LA-1 audit: who suspended this user, agency or partner. A partner admin cannot reactivate a user the agency suspended.';

-- ── invite, with the partner-admin assignment (the path the app uses) ─────────────────────────────
create or replace function public.partner_invite_user_with_auth(
  p_auth_user_id uuid,
  p_tenant_id uuid,
  p_partner_id uuid,
  p_name text,
  p_email text,
  p_role public.partner_user_role,
  p_partner_admin_user_id uuid,
  p_token_hash text,
  p_expires_at timestamptz,
  p_max_partner_users integer default null
)
returns table(user_id uuid, tenant_id uuid, partner_id uuid, name text, email text, role public.partner_user_role, invited_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_invited_at timestamptz := now();
begin
  -- Per tenant (was per partner): the seat count is agency-wide, so the lock must be too.
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  if not exists (select 1 from public.partners where id = p_partner_id and partners.tenant_id = p_tenant_id) then raise exception 'partner_not_found'; end if;
  if not exists (select 1 from public.users where id = p_auth_user_id and lower(users.email) = lower(btrim(p_email))) then raise exception 'auth_profile_not_found'; end if;
  if exists (select 1 from public.users where lower(users.email) = lower(btrim(p_email)) and id <> p_auth_user_id) then raise exception 'email_exists'; end if;
  if exists (select 1 from public.partner_users pu where pu.user_id = p_auth_user_id and pu.partner_id = p_partner_id) then raise exception 'email_exists'; end if;
  if p_role <> 'partner_user' and p_partner_admin_user_id is not null then raise exception 'invalid_partner_admin_assignment'; end if;
  if p_partner_admin_user_id is not null and not exists (
    select 1 from public.partner_users pu where pu.tenant_id = p_tenant_id and pu.partner_id = p_partner_id and pu.user_id = p_partner_admin_user_id and pu.role = 'partner_admin'
  ) then raise exception 'invalid_partner_admin_assignment'; end if;
  if p_max_partner_users is not null then
    -- LA-1.19: total active closers across all active partners, plus this partner's own.
    select count(*)::integer into v_count
      from public.partner_users pu
      join public.partners p on p.id = pu.partner_id
     where pu.tenant_id = p_tenant_id and pu.status = 'active'
       and (p.status = 'active' or p.id = p_partner_id);
    if v_count >= p_max_partner_users then raise exception 'max_partner_users:%:%', v_count, p_max_partner_users; end if;
  end if;
  update public.users set name = btrim(p_name), full_name = btrim(p_name), display_name = btrim(p_name), status = case when password_hash is null then 'invited' else status end, active = case when password_hash is null then false else active end, must_reset_password = case when password_hash is null then true else must_reset_password end, updated_at = now() where id = p_auth_user_id;
  insert into public.partner_users (tenant_id, partner_id, user_id, role, status, invited_at, partner_admin_user_id)
  values (p_tenant_id, p_partner_id, p_auth_user_id, p_role, 'active', v_invited_at, p_partner_admin_user_id);
  insert into public.user_invitations (user_id, partner_id, token_hash, expires_at, created_by, purpose)
  values (p_auth_user_id, p_partner_id, p_token_hash, p_expires_at, null, 'invite');
  return query select p_auth_user_id, p_tenant_id, p_partner_id, btrim(p_name), lower(btrim(p_email)), p_role, v_invited_at;
end;
$$;

revoke all on function public.partner_invite_user_with_auth(uuid,uuid,uuid,text,text,public.partner_user_role,uuid,text,timestamptz,integer) from public, anon, authenticated, tenant_app;
grant execute on function public.partner_invite_user_with_auth(uuid,uuid,uuid,text,text,public.partner_user_role,uuid,text,timestamptz,integer) to service_role;

-- ── invite, the pre-hierarchy overload (the app's rollout fallback) ───────────────────────────────
create or replace function public.partner_invite_user_with_auth(
  p_auth_user_id uuid,
  p_tenant_id uuid,
  p_partner_id uuid,
  p_name text,
  p_email text,
  p_role public.partner_user_role,
  p_token_hash text,
  p_expires_at timestamptz,
  p_max_partner_users integer default null
)
returns table(user_id uuid, tenant_id uuid, partner_id uuid, name text, email text, role public.partner_user_role, invited_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_invited_at timestamptz := now();
begin
  -- Serialised per tenant, so two admins inviting at once cannot both pass the seat check.
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));

  if not exists (select 1 from public.partners where id = p_partner_id and partners.tenant_id = p_tenant_id) then
    raise exception 'partner_not_found';
  end if;

  if not exists (
    select 1 from public.users
    where id = p_auth_user_id and lower(users.email) = lower(btrim(p_email))
  ) then
    raise exception 'auth_profile_not_found';
  end if;

  if exists (
    select 1 from public.users
    where lower(users.email) = lower(btrim(p_email)) and id <> p_auth_user_id
  ) then
    raise exception 'email_exists';
  end if;

  if exists (select 1 from public.partner_users pu where pu.user_id = p_auth_user_id and pu.partner_id = p_partner_id) then
    raise exception 'email_exists';
  end if;

  if p_max_partner_users is not null then
    -- LA-1.19: total active closers across all active partners, plus this partner's own.
    select count(*)::integer into v_count
      from public.partner_users pu
      join public.partners p on p.id = pu.partner_id
     where pu.tenant_id = p_tenant_id and pu.status = 'active'
       and (p.status = 'active' or p.id = p_partner_id);
    if v_count >= p_max_partner_users then
      raise exception 'max_partner_users:%:%', v_count, p_max_partner_users;
    end if;
  end if;

  update public.users
     set name = btrim(p_name),
         full_name = btrim(p_name),
         display_name = btrim(p_name),
         status = case when password_hash is null then 'invited' else status end,
         active = case when password_hash is null then false else active end,
         must_reset_password = case when password_hash is null then true else must_reset_password end,
         updated_at = now()
   where id = p_auth_user_id;

  insert into public.partner_users (tenant_id, partner_id, user_id, role, status, invited_at)
  values (p_tenant_id, p_partner_id, p_auth_user_id, p_role, 'active', v_invited_at);

  insert into public.user_invitations (user_id, partner_id, token_hash, expires_at, created_by, purpose)
  values (p_auth_user_id, p_partner_id, p_token_hash, p_expires_at, null, 'invite');

  return query
    select p_auth_user_id, p_tenant_id, p_partner_id, btrim(p_name), lower(btrim(p_email)), p_role, v_invited_at;
end;
$$;

revoke all on function public.partner_invite_user_with_auth(uuid,uuid,uuid,text,text,public.partner_user_role,text,timestamptz,integer) from public, anon, authenticated, tenant_app;
grant execute on function public.partner_invite_user_with_auth(uuid,uuid,uuid,text,text,public.partner_user_role,text,timestamptz,integer) to service_role;

-- ── suspend / reactivate ──────────────────────────────────────────────────────────────────────────
drop function if exists public.partner_set_user_status_with_limit(uuid, uuid, uuid, text, integer);

create or replace function public.partner_set_user_status_with_limit(
  p_tenant_id uuid,
  p_partner_id uuid,
  p_user_id uuid,
  p_status text,
  p_max_partner_users integer default null,
  p_actor_plane text default 'agency'
)
returns table(old_status text, new_status text)
language plpgsql
set search_path to 'public'
as $function$
declare
  v_old text;
  v_revoked_by text;
  v_partner_status text;
  v_count integer;
begin
  if p_status not in ('active', 'revoked') then
    raise exception 'invalid_partner_user_status:%', p_status;
  end if;
  if p_actor_plane not in ('agency', 'partner') then
    raise exception 'invalid_actor_plane:%', p_actor_plane;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  -- A paused partner's users can be suspended (and reactivated) too; offboarded and draft cannot.
  select status into v_partner_status from partners
   where id = p_partner_id and tenant_id = p_tenant_id and status in ('active', 'paused') for update;
  if not found then raise exception 'partner_not_found_or_offboarded'; end if;

  select status, revoked_by_plane into v_old, v_revoked_by from partner_users
   where tenant_id = p_tenant_id and partner_id = p_partner_id and user_id = p_user_id for update;
  if not found then raise exception 'partner_user_not_found'; end if;
  if v_old = p_status then raise exception 'partner_user_already_in_state'; end if;

  -- The agency's suspension is the agency's to lift.
  if p_status = 'active' and p_actor_plane = 'partner' and v_revoked_by = 'agency' then
    raise exception 'partner_user_suspended_by_agency';
  end if;

  -- Only an active partner's users hold seats; a paused partner's are counted when it resumes.
  if p_status = 'active' and v_partner_status = 'active' then
    select count(*)::integer into v_count
      from partner_users pu
      join partners p on p.id = pu.partner_id
     where pu.tenant_id = p_tenant_id
       and pu.status = 'active'
       and p.status = 'active'
       and not (pu.partner_id = p_partner_id and pu.user_id = p_user_id);
    if p_max_partner_users is not null and v_count >= p_max_partner_users then
      raise exception 'partner_user_limit_reached:max_partner_users:%:%', v_count, p_max_partner_users;
    end if;
  end if;

  update partner_users
     set status = p_status,
         revoked_at = case when p_status = 'revoked' then coalesce(revoked_at, now()) else null end,
         deactivated_at = case when p_status = 'revoked' then coalesce(deactivated_at, now()) else null end,
         revoked_by_plane = case when p_status = 'revoked' then p_actor_plane else null end
   where tenant_id = p_tenant_id and partner_id = p_partner_id and user_id = p_user_id;

  return query select v_old, p_status;
end;
$function$;

revoke all on function public.partner_set_user_status_with_limit(uuid, uuid, uuid, text, integer, text)
  from public, anon, authenticated, tenant_app;
grant execute on function public.partner_set_user_status_with_limit(uuid, uuid, uuid, text, integer, text)
  to service_role;

-- ─── self-check ──────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
begin
  for v_def in
    select replace(pg_get_functiondef(p.oid), E'\r\n', E'\n')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'partner_invite_user_with_auth'
  loop
    if position('pu.partner_id = p_partner_id and pu.status' in v_def) > 0 or position('(p.status = ''active'' or p.id = p_partner_id)' in v_def) = 0 then
      raise exception '20261015591000: an invite overload still counts partner users per partner';
    end if;
    if position('hashtextextended(p_partner_id::text' in v_def) > 0 then
      raise exception '20261015591000: an invite overload still locks per partner';
    end if;
  end loop;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'partner_set_user_status_with_limit') <> 1 then
    raise exception '20261015591000: expected exactly one partner_set_user_status_with_limit';
  end if;
  if position('partner_user_suspended_by_agency' in pg_get_functiondef('public.partner_set_user_status_with_limit(uuid,uuid,uuid,text,integer,text)'::regprocedure)) = 0 then
    raise exception '20261015591000: the partner side can still lift an agency suspension';
  end if;
end;
$$;
