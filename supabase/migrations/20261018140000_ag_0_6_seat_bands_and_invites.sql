-- AG-0.6 (Notion sprint, Agency Module 0) · seat bands, invitations, and the accept flow.
--
-- The $799 + $79/seat agency plan is dead. An agency buys a flat band: 1–50 $999, 51–150 $2,499, 151+ $4,999
-- (the plans themselves are AG-0.12's). No proration, no seat line, no mid-cycle credit. One check:
--   inviting a member: if seats_used + 1 > band_max → refuse, name the band it needs and its price.
-- That check is the one LA-8.6 already runs (tenant_invite_user_with_auth → tenant_seat_limit / tenant_seats_used);
-- this file only teaches tenant_seats_used how an AGENCY counts, and adds what an agency invite needs. There is
-- still exactly ONE invite flow in the codebase (spec: LA-8.6 extended, not duplicated).
--
--   tenant_seats_used   agency audience: accepted members whose account holds a seat — an INVITED person holds
--                       none (decision D6; the individual one-seat rule is unchanged). Producers count while
--                       onboarding, active or suspended; never while invited.
--   agency_invite_member  the agency branch of the invite: an agency title (admin / manager), a person who
--                       already has an Insurvas account in ANOTHER tenant (decision D7 — refused only when he is
--                       already in this one), and the producer row that exists from the moment of the invite
--                       (status 'invited', so the roster shows pending invites without a second table).
--   accept_tenant_invitation  the accept for a person who already has a password: burns the token and accepts
--                       the membership without touching his credentials.
--   producer_on_accept  accepting moves a producer from 'invited' to 'onboarding' (he lands at the top of the
--                       AG-1.10 checklist and cannot submit yet — can_submit stays false).
--
-- Requires 20261018100000 (producer), 20261018110000 (agency_role).
--
-- Rollback: restore tenant_seats_used from 20260924346000; drop function agency_invite_member(…),
--   accept_tenant_invitation(text), producer_on_accept(); drop trigger producer_on_accept on public.tenant_users.

create or replace function public.tenant_seats_used(p_tenant_id uuid)
returns integer
language sql
stable
set search_path to 'public'
as $$
  select case
    when public.tenant_plan_audience(p_tenant_id) = 'agency' then (
      select count(*)::integer
        from public.tenant_users tu
        join public.users u on u.id = tu.user_id
        left join public.producer p on p.tenant_id = tu.tenant_id and p.user_id = tu.user_id
       where tu.tenant_id = p_tenant_id
         and tu.accepted_at is not null
         and u.status::text in ('active', 'suspended')
         and coalesce(p.status, 'active') in ('onboarding', 'active', 'suspended')
    )
    else (
      select count(*)::integer
        from public.tenant_users tu
        join public.users u on u.id = tu.user_id
       where tu.tenant_id = p_tenant_id
         and public.user_status_holds_seat(u.status::text)
    )
  end;
$$;

-- ─── the agency branch of the one invite flow ─────────────────────────────────────────────────────
-- p_existing: true when the email already has an Insurvas account (in another tenant). Then no new account is
-- prepared, its status is left alone, and acceptance goes through accept_tenant_invitation.
create or replace function public.agency_invite_member(
  p_tenant_id uuid,
  p_user_id uuid,
  p_existing boolean,
  p_name text,
  p_email text,
  p_member_role text,
  p_token_hash text,
  p_expires_at timestamptz,
  p_created_by uuid,
  p_max_buffer_seats integer default null
)
returns table(user_id uuid, tenant_id uuid, producer_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base text;
  v_title text;
  v_agency uuid;
  v_used integer;
  v_max integer;
  v_producer uuid;
begin
  if coalesce(public.tenant_plan_audience(p_tenant_id), '') <> 'agency' then
    raise exception 'agency_plan_required' using errcode = 'P0001';
  end if;
  if p_member_role not in ('admin', 'manager', 'producer', 'assistant', 'bookkeeper', 'setter', 'retention') then
    raise exception 'unknown_role' using errcode = 'P0001';
  end if;
  v_base := case p_member_role when 'admin' then 'owner' when 'manager' then 'producer' else p_member_role end;
  v_title := case when p_member_role in ('admin', 'manager') then p_member_role end;
  select a.id into v_agency from public.agency a where a.tenant_id = p_tenant_id;
  if v_agency is null then raise exception 'agency_record_missing' using errcode = 'P0001'; end if;

  if p_existing then
    perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
    if not exists (select 1 from public.users u where u.id = p_user_id and lower(u.email) = lower(btrim(p_email))) then
      raise exception 'auth_profile_not_found' using errcode = 'P0001';
    end if;
    -- An email already in THIS tenant is rejected, not duplicated.
    if exists (select 1 from public.tenant_users m where m.tenant_id = p_tenant_id and m.user_id = p_user_id) then
      raise exception 'email_exists' using errcode = 'P0001';
    end if;
    v_max := public.tenant_seat_limit(p_tenant_id);
    v_used := public.tenant_seats_used(p_tenant_id);
    if v_max is not null and v_used >= v_max then
      raise exception 'seat_limit_reached:%:%', v_used, v_max using errcode = 'P0001';
    end if;
    insert into public.tenant_users (tenant_id, user_id, role, accepted_at) values (p_tenant_id, p_user_id, v_base::public.tenant_user_role, null);
    insert into public.user_invitations (user_id, tenant_id, token_hash, expires_at, created_by, purpose)
    values (p_user_id, p_tenant_id, p_token_hash, p_expires_at, null, 'invite');
  else
    perform public.tenant_invite_user_with_auth(p_user_id, p_name, p_email, v_base::public.tenant_user_role, p_tenant_id, p_token_hash, p_expires_at, p_created_by, p_max_buffer_seats);
  end if;

  if v_title is not null then
    update public.tenant_users m set agency_role = v_title where m.tenant_id = p_tenant_id and m.user_id = p_user_id;
  end if;

  -- A producer row from the moment of the invite, for the people who write business.
  if v_base = 'producer' then
    insert into public.producer (tenant_id, agency_id, user_id, display_name, status)
    values (p_tenant_id, v_agency, p_user_id, btrim(p_name), 'invited')
    on conflict on constraint producer_one_per_member do update set display_name = excluded.display_name
    returning id into v_producer;
  end if;

  return query select p_user_id, p_tenant_id, v_producer;
end;
$$;
revoke all on function public.agency_invite_member(uuid, uuid, boolean, text, text, text, text, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.agency_invite_member(uuid, uuid, boolean, text, text, text, text, timestamptz, uuid, integer) to service_role;

-- ─── accept, for someone who already has a password ───────────────────────────────────────────────
create or replace function public.accept_tenant_invitation(p_token_hash text)
returns table(user_id uuid, tenant_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token public.user_invitations%rowtype;
begin
  select i.* into v_token from public.user_invitations i
   where i.token_hash = p_token_hash and i.purpose = 'invite' and i.partner_id is null
     and i.accepted_at is null and i.expires_at > now()
   for update;
  if not found then raise exception using errcode = 'P0001', message = 'PASSWORD_TOKEN_INVALID_OR_EXPIRED'; end if;
  -- Only an account that can already sign in accepts this way; a new account must choose a password.
  if not exists (select 1 from public.users u where u.id = v_token.user_id and u.status::text = 'active') then
    raise exception using errcode = 'P0001', message = 'INVITE_NEEDS_PASSWORD';
  end if;
  update public.user_invitations set accepted_at = now() where id = v_token.id;
  update public.tenant_users m set accepted_at = coalesce(m.accepted_at, now())
   where m.user_id = v_token.user_id and m.tenant_id = v_token.tenant_id;
  return query select v_token.user_id, v_token.tenant_id;
end;
$$;
revoke all on function public.accept_tenant_invitation(text) from public, anon, authenticated;
grant execute on function public.accept_tenant_invitation(text) to service_role;

-- ─── accepting moves an invited producer to onboarding ────────────────────────────────────────────
create or replace function public.producer_on_accept()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.accepted_at is null and new.accepted_at is not null then
    update public.producer p
       set status = 'onboarding', hired_on = coalesce(p.hired_on, current_date), updated_at = now()
     where p.tenant_id = new.tenant_id and p.user_id = new.user_id and p.status = 'invited';
  end if;
  return new;
end;
$$;
revoke all on function public.producer_on_accept() from public, anon, authenticated;
drop trigger if exists producer_on_accept on public.tenant_users;
create trigger producer_on_accept after update of accepted_at on public.tenant_users
  for each row execute function public.producer_on_accept();

-- ─── self-check ───────────────────────────────────────────────────────────────────────────────────
do $$
begin
  -- An individual-plan tenant's seat count is unchanged by this file.
  if exists (
    select 1 from public.tenants t
     where public.tenant_plan_audience(t.id) = 'individual'
       and public.tenant_seats_used(t.id) <> (select count(*) from public.tenant_users tu join public.users u on u.id = tu.user_id
                                              where tu.tenant_id = t.id and public.user_status_holds_seat(u.status::text))
     limit 1) then
    raise exception 'AG-0.6: the individual seat count changed';
  end if;
end;
$$;
