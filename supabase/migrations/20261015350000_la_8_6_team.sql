-- LA-8.6 (Notion sprint, Module 8 — Settings) · Team & seat management: the parts that were missing.
--
-- Invitations (72-hour signed links, resend, revoke), roles and the seat count already exist and are
-- reused unchanged: the invite flow is tenant_invite_user_with_auth, roles are LA-0.2's, and the one
-- seat rule (20260924346000) already counts a pending invitation as a held seat. This file adds:
--
--   tenant_users.timezone   the member's own zone (offshore staff). The roster (LA-2.12) reads it
--                           when the member has no working hours. NOTHING HERE TOUCHES CALLING
--                           WINDOWS: those come from the customer's state (LA-2.4), never the caller.
--   tenant_member_open_work(tenant, user)
--                           what is still waiting on a person: exception-queue items (LA-4.9), open
--                           reinstatement cases (LA-5.6), callbacks, claimed leads, upcoming
--                           appointments, and open servicing requests (LA-5.4).
--   tenant_deactivate_member(tenant, user, actor, reassign_to)
--                           in ONE transaction: refuses while work is open and nobody is named to take
--                           it; hands the open work to that person; then deactivates the account
--                           through admin_set_user_status, which bumps session_version — every session
--                           ends on its next request — and frees the seat. Nothing is deleted: what
--                           the person wrote, worked, booked and attempted stays attributed to them.
--                           A servicing request keeps its requester (LA-5.4 fixes "who asked" for
--                           good); it stays on the team's servicing list.
--   tenant_reactivate_member(tenant, user)
--                           back to active, through the same function and its seat check.
--
-- Deactivation is the person's account (users.status), as everywhere else in the product. Someone who
-- also belongs to another agency is not deactivated from here: that would lock them out of the other
-- agency too. The function refuses, and says so.
--
-- Rollback: drop function public.tenant_deactivate_member(uuid, uuid, uuid, uuid),
--   public.tenant_reactivate_member(uuid, uuid), public.tenant_member_open_work(uuid, uuid),
--   public.tenant_set_member_timezone(uuid, uuid, text);
--   alter table public.tenant_users drop column timezone; and restore tenant_member_roster from 20260929202000.

set local lock_timeout = '5s';

alter table public.tenant_users add column if not exists timezone text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_users_timezone_shape' and conrelid = 'public.tenant_users'::regclass) then
    alter table public.tenant_users add constraint tenant_users_timezone_shape check (timezone is null or char_length(timezone) between 1 and 64);
  end if;
end;
$$;

comment on column public.tenant_users.timezone is
  'LA-8.6 · The member''s own time zone (IANA), for the roster and scorecards. Never used for calling windows, which follow the customer''s state (LA-2.4).';

-- A real zone or nothing: checked against the server's zone list, which a check constraint cannot read.
create or replace function public.tenant_set_member_timezone(p_tenant_id uuid, p_user_id uuid, p_timezone text)
returns text
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_zone text := nullif(btrim(coalesce(p_timezone, '')), '');
begin
  if v_zone is not null and not exists (select 1 from pg_timezone_names where name = v_zone) then
    raise exception 'unknown_timezone' using errcode = 'P0001';
  end if;
  update public.tenant_users set timezone = v_zone where tenant_id = p_tenant_id and user_id = p_user_id;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0001';
  end if;
  return v_zone;
end;
$$;

revoke all on function public.tenant_set_member_timezone(uuid, uuid, text) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_set_member_timezone(uuid, uuid, text) to service_role;

-- --------------------------------------------------------------------------
-- The roster reads the member's zone (restated from 20260929202000; [8.6] marks the changes)
-- --------------------------------------------------------------------------

create or replace view public.tenant_member_roster as
select tu.tenant_id,
       tu.user_id,
       tu.role::text as role,
       z.zone as timezone,
       (now() at time zone z.zone) as local_time,
       to_char(now() at time zone z.zone, 'Dy HH24:MI') as local_label,
       av.start_time,
       av.end_time,
       case when av.user_id is null then null
            else (
              extract(dow from (now() at time zone av.timezone))::smallint = av.weekday
              and (now() at time zone av.timezone)::time >= av.start_time
              and (now() at time zone av.timezone)::time < av.end_time
            ) end as on_shift_now
  from tenant_users tu
  left join tenant_agent_availability av
    on av.tenant_id = tu.tenant_id and av.user_id = tu.user_id
  left join agency_profiles ag
    on ag.tenant_id = tu.tenant_id
  cross join lateral (
    select coalesce(
             nullif(btrim(av.timezone), ''),
             -- [8.6] the member's own zone, before the agency's
             (select tz.name from pg_timezone_names tz where tz.name = nullif(btrim(tu.timezone), '') limit 1),
             (select tz.name from pg_timezone_names tz where tz.name = nullif(btrim(ag.timezone), '') limit 1),
             'UTC') as zone
  ) z
 where tu.accepted_at is not null
   and (av.user_id is not null or tu.role::text in ('owner', 'producer', 'setter'))
   -- [8.6] a deactivated member is not on the phones
   and exists (select 1 from users u where u.id = tu.user_id and u.status = 'active');

alter view public.tenant_member_roster set (security_invoker = on);
revoke all on public.tenant_member_roster from anon, authenticated, public;
grant select on public.tenant_member_roster to tenant_app, service_role;

-- --------------------------------------------------------------------------
-- Open work
-- --------------------------------------------------------------------------

create or replace function public.tenant_member_open_work(p_tenant_id uuid, p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'queue_items', (select count(*) from public.queue_item q where q.tenant_id = p_tenant_id and q.assigned_to_user_id = p_user_id and q.status = 'open'),
    'reinstatement_cases', (select count(*) from public.reinstatement_case r where r.tenant_id = p_tenant_id and r.worked_by = p_user_id and r.status in ('identified', 'contacted', 'client_agreed', 'submitted')),
    'callbacks', (select count(*) from public.tenant_callbacks c where c.tenant_id = p_tenant_id and c.assigned_to = p_user_id and c.status in ('scheduled', 'due')),
    'claimed_leads', (select count(*) from public.lead_queue l where l.tenant_id = p_tenant_id and l.claimed_by = p_user_id and l.status = 'claimed' and l.disposition is null),
    'appointments', (select count(*) from public.tenant_appointments a where a.tenant_id = p_tenant_id and a.agent_user_id = p_user_id and a.status in ('booked', 'confirmed') and a.starts_at_utc > now()),
    'servicing_requests', (select count(*) from public.servicing_request s where s.tenant_id = p_tenant_id and s.requested_by = p_user_id and s.status in ('draft', 'submitted', 'awaiting_carrier', 'confirmed_by_carrier'))
  );
$$;

revoke all on function public.tenant_member_open_work(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_member_open_work(uuid, uuid) to service_role;

-- --------------------------------------------------------------------------
-- Deactivate, handing open work over first
-- --------------------------------------------------------------------------

create or replace function public.tenant_deactivate_member(p_tenant_id uuid, p_user_id uuid, p_actor uuid, p_reassign_to uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_role text;
  v_status text;
  v_open jsonb;
  v_reassignable integer;
  v_moved jsonb := '{}'::jsonb;
  v_n integer;
begin
  select tu.role::text, u.status into v_role, v_status
    from public.tenant_users tu join public.users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id and tu.user_id = p_user_id and tu.accepted_at is not null
   for update of tu;
  if v_role is null then
    raise exception 'member_not_found' using errcode = 'P0001';
  end if;
  if p_user_id = p_actor then
    raise exception 'cannot_deactivate_self' using errcode = 'P0001';
  end if;
  if v_status not in ('active', 'suspended') then
    raise exception 'not_active' using errcode = 'P0001';
  end if;
  if v_role = 'owner' and not exists (
    select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id
     where tu.tenant_id = p_tenant_id and tu.user_id <> p_user_id and tu.role::text = 'owner' and tu.accepted_at is not null and u.status = 'active'
  ) then
    raise exception 'last_owner' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.tenant_users tu where tu.user_id = p_user_id and tu.tenant_id <> p_tenant_id) then
    raise exception 'member_of_other_workspaces' using errcode = 'P0001';
  end if;

  v_open := public.tenant_member_open_work(p_tenant_id, p_user_id);
  v_reassignable := (v_open->>'queue_items')::int + (v_open->>'reinstatement_cases')::int + (v_open->>'callbacks')::int
                  + (v_open->>'claimed_leads')::int + (v_open->>'appointments')::int;

  if v_reassignable > 0 then
    if p_reassign_to is null then
      raise exception 'open_work:%', v_open::text using errcode = 'P0001';
    end if;
    if p_reassign_to = p_user_id or not exists (
      select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id
       where tu.tenant_id = p_tenant_id and tu.user_id = p_reassign_to and tu.accepted_at is not null and u.status = 'active'
    ) then
      raise exception 'reassign_target_invalid' using errcode = 'P0001';
    end if;

    update public.queue_item set assigned_to_user_id = p_reassign_to, updated_at = now()
     where tenant_id = p_tenant_id and assigned_to_user_id = p_user_id and status = 'open';
    get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('queue_items', v_n);

    update public.reinstatement_case set worked_by = p_reassign_to
     where tenant_id = p_tenant_id and worked_by = p_user_id and status in ('identified', 'contacted', 'client_agreed', 'submitted');
    get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('reinstatement_cases', v_n);

    update public.lead_queue set claimed_by = p_reassign_to, owner_user_id = p_reassign_to, updated_at = now()
     where tenant_id = p_tenant_id and claimed_by = p_user_id and status = 'claimed' and disposition is null;
    get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('claimed_leads', v_n);

    update public.tenant_callbacks set assigned_to = p_reassign_to, updated_at = now()
     where tenant_id = p_tenant_id and assigned_to = p_user_id and status in ('scheduled', 'due');
    get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('callbacks', v_n);

    update public.tenant_appointments set agent_user_id = p_reassign_to
     where tenant_id = p_tenant_id and agent_user_id = p_user_id and status in ('booked', 'confirmed') and starts_at_utc > now();
    get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('appointments', v_n);
  end if;

  -- The account's own lifecycle: status inactive, session_version + 1 (sessions end on their next
  -- request), the seat freed. The row and everything attributed to it stay.
  perform public.admin_set_user_status(p_user_id, 'inactive', null);

  return jsonb_build_object('role', v_role, 'open', v_open, 'moved', v_moved, 'reassigned_to', p_reassign_to);
end;
$$;

revoke all on function public.tenant_deactivate_member(uuid, uuid, uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_deactivate_member(uuid, uuid, uuid, uuid) to service_role;

create or replace function public.tenant_reactivate_member(p_tenant_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_status text;
begin
  select u.status into v_status
    from public.tenant_users tu join public.users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id and tu.user_id = p_user_id and tu.accepted_at is not null;
  if v_status is null then
    raise exception 'member_not_found' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.tenant_users tu where tu.user_id = p_user_id and tu.tenant_id <> p_tenant_id) then
    raise exception 'member_of_other_workspaces' using errcode = 'P0001';
  end if;
  if v_status not in ('inactive', 'deactivated') then
    raise exception 'not_deactivated' using errcode = 'P0001';
  end if;
  -- The seat check is admin_set_user_status's (assert_user_seat_transition): at the limit, refused.
  perform public.admin_set_user_status(p_user_id, 'active', null);
  return 'active';
end;
$$;

revoke all on function public.tenant_reactivate_member(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_reactivate_member(uuid, uuid) to service_role;
