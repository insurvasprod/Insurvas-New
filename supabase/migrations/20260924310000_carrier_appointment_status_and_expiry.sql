-- /app/appointments: an appointment can be pending, and it can expire.
--
-- The board shows six states for a carrier × state cell: Appointed, Expires <60d, Pending, Expired,
-- Ended and nothing. The vault kept two (active, terminated) and no expiry, so "Pending" and
-- "Expired" could not be recorded and routing could not respect them. This file:
--
--   appointments.expires_at   the date the carrier's appointment lapses; null = does not expire
--   appointments.status       'pending' | 'active' | 'terminated' (was 'active' | 'terminated')
--   save_appointments_with_details   the grid and the per-cell dialog's save, one statement
--   assignment_candidate_is_eligible / assignment_ineligibility_reason   an expired appointment
--       stops counting, exactly as a terminated one does; a pending one never counted (status must
--       be 'active') and now says so when it is the reason.
--
-- The two eligibility functions are restated from their latest definition, 20260924110000 (applied).
-- No later migration redefines them: 20260924220200 and 20260924300000 only call them. Signatures
-- and grants are unchanged. save_appointments (LA-0.5) is left exactly as it is, for any caller
-- that still uses it; lib/appointments/service.ts calls the new function first and falls back.
--
-- Additive and idempotent. Nothing existing becomes invalid: every row is 'active' or 'terminated'
-- and has no expiry.

-- ── expiry ────────────────────────────────────────────────────────────────
alter table public.appointments add column if not exists expires_at date;
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.appointments'::regclass and conname = 'appointments_expiry_after_effective'
  ) then
    alter table public.appointments
      add constraint appointments_expiry_after_effective check (expires_at is null or expires_at >= effective_from);
  end if;
end $$;

-- ── status: pending, active, terminated ───────────────────────────────────
-- The original check was declared inline, so its name is whatever Postgres chose
-- (appointments_status_check on a fresh database). Find every check on the table that constrains
-- `status` and replace it with one named constraint.
do $$
declare
  r record;
begin
  for r in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.appointments'::regclass
       and c.contype = 'c'
       and c.conname <> 'appointments_status_valid'
       and pg_get_constraintdef(c.oid) ~ '\mstatus\M'
  loop
    execute format('alter table public.appointments drop constraint %I', r.conname);
  end loop;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.appointments'::regclass and conname = 'appointments_status_valid'
  ) then
    alter table public.appointments
      add constraint appointments_status_valid check (status in ('pending', 'active', 'terminated'));
  end if;
end $$;

-- ── the save ──────────────────────────────────────────────────────────────
-- Each element of p_rows: carrier_id, state, status, effective_from, terminated_at, and optionally
-- expires_at and id.
--   id present   edits that row (its effective date included). The row must belong to the tenant
--                and to the same carrier and state, or the batch fails with appointment_not_found.
--   id absent    upserts on (tenant, carrier, state, effective_from), as save_appointments does.
--   expires_at   an absent key keeps what is stored (a JSON null clears it), so the Settings grid,
--                which does not send it, never wipes an expiry an owner set on the page.
--   terminated_at  as in save_appointments: the value sent, null when absent.
create or replace function public.save_appointments_with_details(p_tenant_id uuid, p_rows jsonb)
returns setof public.appointments
language plpgsql
security invoker
set search_path = public
as $$
declare
  item jsonb;
  v_id uuid;
  v_row public.appointments;
begin
  if p_tenant_id is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 500 then
    raise exception 'invalid_appointment_batch' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(p_rows) loop
    v_id := nullif(item->>'id', '')::uuid;
    if v_id is not null then
      update public.appointments a
         set status = item->>'status',
             effective_from = (item->>'effective_from')::date,
             terminated_at = (item->>'terminated_at')::date,
             expires_at = case when item ? 'expires_at' then (item->>'expires_at')::date else a.expires_at end
       where a.id = v_id
         and a.tenant_id = p_tenant_id
         and a.carrier_id = (item->>'carrier_id')::uuid
         and a.state = upper(btrim(item->>'state'))
      returning a.* into v_row;
      if not found then
        raise exception 'appointment_not_found' using errcode = 'P0002';
      end if;
    else
      insert into public.appointments as a (tenant_id, carrier_id, state, status, effective_from, terminated_at, expires_at)
      values (
        p_tenant_id,
        (item->>'carrier_id')::uuid,
        upper(btrim(item->>'state')),
        item->>'status',
        (item->>'effective_from')::date,
        (item->>'terminated_at')::date,
        (item->>'expires_at')::date
      )
      on conflict (tenant_id, carrier_id, state, effective_from) do update set
        status = excluded.status,
        terminated_at = excluded.terminated_at,
        expires_at = case when item ? 'expires_at' then excluded.expires_at else a.expires_at end
      returning a.* into v_row;
    end if;
    return next v_row;
  end loop;
end;
$$;

revoke all on function public.save_appointments_with_details(uuid, jsonb) from public, anon, authenticated, tenant_app;
grant execute on function public.save_appointments_with_details(uuid, jsonb) to service_role;

-- ── eligibility: an expired appointment no longer counts ──────────────────
-- Restated from 20260924110000. The only change in each function is the expires_at condition on
-- the appointment, and, in the reason, two branches that name an expired or pending appointment.
create or replace function public.assignment_candidate_is_eligible(
  p_tenant_id uuid,
  p_user_id uuid,
  p_role text,
  p_product text,
  p_state text,
  p_requires_licensed boolean
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_state text := upper(btrim(coalesce(p_state, '')));
begin
  if p_role not in ('owner', 'producer', 'setter') then return false; end if;
  if p_requires_licensed and p_role = 'setter' then return false; end if;
  if p_role = 'setter' then return true; end if;
  if v_state = '' then return false; end if;

  return
    exists (
      select 1 from public.licenses l
       where l.tenant_id = p_tenant_id
         and upper(btrim(l.state)) = v_state
         and (l.expires_at is null or l.expires_at >= current_date)
    )
    and exists (
      select 1
        from public.appointments a
        join public.tenant_carriers tc
          on tc.tenant_id = a.tenant_id
         and tc.carrier_id = a.carrier_id
         and tc.is_active
       where a.tenant_id = p_tenant_id
         and upper(btrim(a.state)) = v_state
         and a.status = 'active'
         and (a.effective_from is null or a.effective_from <= current_date)
         and (a.terminated_at is null or a.terminated_at >= current_date)
         -- New: an appointment past its expiry stops counting, as a terminated one does.
         and (a.expires_at is null or a.expires_at >= current_date)
    )
    -- The agent's own states, when any are recorded. None recorded means "judge me on the
    -- agency", which is what every agent was before 20260924110000.
    and (
      not exists (select 1 from public.tenant_user_licensed_states s where s.tenant_id = p_tenant_id and s.user_id = p_user_id)
      or exists (select 1 from public.tenant_user_licensed_states s where s.tenant_id = p_tenant_id and s.user_id = p_user_id and s.state = v_state)
    );
end;
$function$;

create or replace function public.assignment_ineligibility_reason(
  p_tenant_id uuid,
  p_user_id uuid,
  p_role text,
  p_product text,
  p_state text,
  p_requires_licensed boolean
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_state text := upper(btrim(coalesce(p_state, '')));
  v_licensed boolean;
  v_appointed boolean;
  v_agent_ok boolean;
begin
  if p_role not in ('owner', 'producer', 'setter') then
    return format('A %s cannot be given leads to work.', coalesce(p_role, 'member with no role'));
  end if;
  if p_requires_licensed and p_role = 'setter' then
    return 'This lead needs a licensed agent, and a setter cannot write business.';
  end if;
  if p_role = 'setter' then return null; end if;
  if v_state = '' then
    return 'This lead has no state on it, so there is no way to tell who is licensed to work it.';
  end if;

  select exists (
    select 1 from public.licenses l
     where l.tenant_id = p_tenant_id and upper(btrim(l.state)) = v_state
       and (l.expires_at is null or l.expires_at >= current_date)
  ) into v_licensed;

  select exists (
    select 1 from public.appointments a
      join public.tenant_carriers tc
        on tc.tenant_id = a.tenant_id and tc.carrier_id = a.carrier_id and tc.is_active
     where a.tenant_id = p_tenant_id and upper(btrim(a.state)) = v_state
       and a.status = 'active'
       and (a.effective_from is null or a.effective_from <= current_date)
       and (a.terminated_at is null or a.terminated_at >= current_date)
       and (a.expires_at is null or a.expires_at >= current_date)
  ) into v_appointed;

  select not exists (select 1 from public.tenant_user_licensed_states s where s.tenant_id = p_tenant_id and s.user_id = p_user_id)
      or exists (select 1 from public.tenant_user_licensed_states s where s.tenant_id = p_tenant_id and s.user_id = p_user_id and s.state = v_state)
    into v_agent_ok;

  if v_licensed and v_appointed and v_agent_ok then return null; end if;

  if not v_licensed and not v_appointed then
    return format(
      'Your agency %s for %s and has no active carrier appointment there. Both are needed before anyone can be given a %s lead.',
      case when exists (select 1 from public.licenses l where l.tenant_id = p_tenant_id and upper(btrim(l.state)) = v_state)
           then 'has an expired licence' else 'has no licence on record' end,
      v_state, v_state);
  end if;
  if not v_licensed then
    if exists (select 1 from public.licenses l where l.tenant_id = p_tenant_id and upper(btrim(l.state)) = v_state) then
      return format('Your agency''s %s licence has expired. Renew it on States & licences before working %s leads.', v_state, v_state);
    end if;
    return format('Your agency has no %s licence on record. Add it on States & licences before working %s leads.', v_state, v_state);
  end if;
  if not v_appointed then
    -- New: say which of the two new reasons it is, when it is one of them.
    if exists (
      select 1 from public.appointments a
        join public.tenant_carriers tc on tc.tenant_id = a.tenant_id and tc.carrier_id = a.carrier_id and tc.is_active
       where a.tenant_id = p_tenant_id and upper(btrim(a.state)) = v_state
         and a.status = 'active'
         and (a.effective_from is null or a.effective_from <= current_date)
         and (a.terminated_at is null or a.terminated_at >= current_date)
         and a.expires_at < current_date
    ) then
      return format('Your agency''s carrier appointment in %s has expired, so nothing can be written there. Renew it on Appointments & licences.', v_state);
    end if;
    if exists (
      select 1 from public.appointments a
        join public.tenant_carriers tc on tc.tenant_id = a.tenant_id and tc.carrier_id = a.carrier_id and tc.is_active
       where a.tenant_id = p_tenant_id and upper(btrim(a.state)) = v_state
         and a.status = 'pending'
    ) then
      return format('Your agency''s carrier appointment in %s is still pending with the carrier. %s leads can be worked once it is active.', v_state, v_state);
    end if;
    return format('Your agency is licensed in %s but has no active carrier appointment there, so nothing can be written. Add one on States & licences.', v_state);
  end if;
  return format('This agent is not licensed in %s. Add %s to their licensed states on Team & access, or give the lead to someone who is.', v_state, v_state);
end;
$function$;

revoke all on function public.assignment_candidate_is_eligible(uuid, uuid, text, text, text, boolean)
  from public, anon, authenticated, tenant_app;
grant execute on function public.assignment_candidate_is_eligible(uuid, uuid, text, text, text, boolean)
  to service_role;
revoke all on function public.assignment_ineligibility_reason(uuid, uuid, text, text, text, boolean)
  from public, anon, authenticated, tenant_app;
grant execute on function public.assignment_ineligibility_reason(uuid, uuid, text, text, text, boolean)
  to service_role;

-- ── asserted against whatever this database holds ─────────────────────────
do $$
declare
  v_def text;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'appointments' and column_name = 'expires_at'
  ) then
    raise exception 'appointments.expires_at is missing';
  end if;

  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = 'public.appointments'::regclass and c.conname = 'appointments_status_valid';
  if v_def is null or v_def !~ 'pending' or v_def !~ 'active' or v_def !~ 'terminated' then
    raise exception 'appointments_status_valid does not admit pending, active and terminated: %', v_def;
  end if;
  if exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.appointments'::regclass and c.contype = 'c'
       and c.conname <> 'appointments_status_valid' and pg_get_constraintdef(c.oid) ~ '\mstatus\M'
  ) then
    raise exception 'an older status check on appointments survived and still refuses pending';
  end if;
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.appointments'::regclass and c.conname = 'appointments_expiry_after_effective'
  ) then
    raise exception 'appointments_expiry_after_effective is missing';
  end if;

  if to_regprocedure('public.save_appointments_with_details(uuid, jsonb)') is null then
    raise exception 'save_appointments_with_details is missing';
  end if;
  if to_regprocedure('public.save_appointments(uuid, jsonb)') is null then
    raise exception 'save_appointments was dropped; it must stay for its existing callers';
  end if;

  select pg_get_functiondef('public.assignment_candidate_is_eligible(uuid, uuid, text, text, text, boolean)'::regprocedure) into v_def;
  if v_def !~ 'a\.expires_at is null or a\.expires_at >= current_date' or v_def !~ 'a\.status = ''active''' or v_def !~ 'tenant_user_licensed_states' then
    raise exception 'assignment_candidate_is_eligible lost a rule after the rewrite';
  end if;
  select pg_get_functiondef('public.assignment_ineligibility_reason(uuid, uuid, text, text, text, boolean)'::regprocedure) into v_def;
  if v_def !~ 'has expired, so nothing can be written there' or v_def !~ 'still pending with the carrier' then
    raise exception 'assignment_ineligibility_reason does not explain an expired or pending appointment';
  end if;

  if has_function_privilege('tenant_app', 'public.save_appointments_with_details(uuid, jsonb)', 'execute')
     or has_function_privilege('tenant_app', 'public.assignment_candidate_is_eligible(uuid, uuid, text, text, text, boolean)', 'execute') then
    raise exception 'the tenant plane can execute a service-role function';
  end if;
end $$;
