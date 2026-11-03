-- Settings › Agency profile, the two lines the board states that were not yet true.
--
-- ── 1. "Verified against NIPR 3 March 2026."
--
-- 20260924100000 created `agency_profiles.npn_verified_at` and said nothing sets it, because there
-- is no NIPR integration. NIPR's Producer Database (PDB) lookup is a paid, contracted service with
-- its own credentials, so the lookup itself cannot be written here. What can be is everything
-- around it: where a check's outcome is kept, and the one function the lookup calls to record it.
-- lib/agencyProfile/nipr.ts is the hook; it calls record_agency_npn_check once a client exists.
--
--   npn_check_status   what the last lookup said: verified, not_found (NIPR has no producer with
--                      that number), name_mismatch (it does, under another name) or error
--   npn_checked_at     when that lookup ran
--
-- The check is recorded against the NPN it looked up. If the owner changed the number while the
-- lookup was in flight, the result describes a number the agency no longer uses and is dropped.
-- save_agency_profile already clears npn_verified_at when the NPN changes; it now clears the
-- status with it (below), so a stale "not found" cannot sit beside a corrected number either.
--
-- ── 2. "Every calling window, callback and report reads this."
--
-- The report half: `deal_local_date` files a deal against the agent's own timezone, then the
-- customer's, then UTC. The agency's timezone is a far better guess at the agent's midnight than
-- the customer's is, so it now sits second. (Callbacks read it in lib/callbacks/service.ts; calling
-- windows follow the customer's own timezone by law and are not changed by this file.)
--
-- Additive and idempotent. Requires 20260924100000 (agency_profiles).

alter table public.agency_profiles add column if not exists npn_check_status text;
alter table public.agency_profiles add column if not exists npn_checked_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agency_profiles_npn_check_status_valid') then
    alter table public.agency_profiles
      add constraint agency_profiles_npn_check_status_valid
      check (npn_check_status is null or npn_check_status in ('verified', 'not_found', 'name_mismatch', 'error'));
  end if;
end $$;

-- Records one NIPR lookup. Returns false when the NPN on file is no longer the one that was checked.
create or replace function public.record_agency_npn_check(
  p_tenant_id uuid,
  p_npn text,
  p_status text,
  p_checked_at timestamptz default now()
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_status not in ('verified', 'not_found', 'name_mismatch', 'error') then
    raise exception 'invalid_npn_check_status';
  end if;
  update public.agency_profiles ap
     set npn_check_status = p_status,
         npn_checked_at = p_checked_at,
         -- An error says nothing about the number, so it leaves an earlier verification standing.
         npn_verified_at = case
           when p_status = 'verified' then p_checked_at
           when p_status = 'error' then ap.npn_verified_at
           else null end
   where ap.tenant_id = p_tenant_id
     and ap.npn is not distinct from nullif(btrim(p_npn), '');
  return found;
end;
$$;

revoke all on function public.record_agency_npn_check(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_agency_npn_check(uuid, text, text, timestamptz) to service_role;

-- A changed NPN drops the check with the verification stamp. Same body as 20260924100000 plus the
-- two check columns; re-stated rather than patched because it is short and owned by this section.
create or replace function public.save_agency_profile(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_legal_name text,
  p_dba text,
  p_npn text,
  p_tax_id_change boolean,
  p_tax_id_ciphertext text,
  p_tax_id_last4 text,
  p_principal_address text,
  p_timezone text
)
returns public.agency_profiles
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.agency_profiles;
begin
  insert into public.agency_profiles as ap
    (tenant_id, legal_name, dba, npn, npn_verified_at, tax_id_ciphertext, tax_id_last4, principal_address, timezone, updated_at, updated_by)
  values
    (p_tenant_id, trim(p_legal_name), nullif(trim(p_dba), ''), nullif(trim(p_npn), ''), null,
     case when p_tax_id_change then p_tax_id_ciphertext else null end,
     case when p_tax_id_change then p_tax_id_last4 else null end,
     nullif(trim(p_principal_address), ''), nullif(trim(p_timezone), ''), now(), p_actor_id)
  on conflict (tenant_id) do update set
    legal_name = excluded.legal_name,
    dba = excluded.dba,
    npn = excluded.npn,
    npn_verified_at = case when ap.npn is not distinct from excluded.npn then ap.npn_verified_at else null end,
    npn_check_status = case when ap.npn is not distinct from excluded.npn then ap.npn_check_status else null end,
    npn_checked_at = case when ap.npn is not distinct from excluded.npn then ap.npn_checked_at else null end,
    tax_id_ciphertext = case when p_tax_id_change then excluded.tax_id_ciphertext else ap.tax_id_ciphertext end,
    tax_id_last4 = case when p_tax_id_change then excluded.tax_id_last4 else ap.tax_id_last4 end,
    principal_address = excluded.principal_address,
    timezone = excluded.timezone,
    updated_at = now(),
    updated_by = excluded.updated_by
  returning * into v_row;

  insert into public.agency_profile_history
    (tenant_id, changed_by, legal_name, dba, npn, tax_id_last4, tax_id_changed, principal_address, timezone)
  values
    (p_tenant_id, p_actor_id, v_row.legal_name, v_row.dba, v_row.npn, v_row.tax_id_last4, coalesce(p_tax_id_change, false), v_row.principal_address, v_row.timezone);

  return v_row;
end;
$$;

revoke all on function public.save_agency_profile(uuid, uuid, text, text, text, boolean, text, text, text, text) from public, anon, authenticated;
grant execute on function public.save_agency_profile(uuid, uuid, text, text, text, boolean, text, text, text, text) to service_role;

-- ── 2 ──────────────────────────────────────────────────────────────────────
-- 20260922190000's function with one step inserted: agent → agency → customer → UTC.
create or replace function public.deal_local_date(
  p_tenant_id uuid,
  p_agent_user_id uuid,
  p_lead_values jsonb,
  p_at timestamptz default now()
)
returns date
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_zone text;
begin
  select min(av.timezone) into v_zone
    from tenant_agent_availability av
   where av.tenant_id = p_tenant_id and av.user_id = p_agent_user_id;

  -- The agency's own timezone (Settings › Agency profile), when the agent has none of their own.
  if v_zone is null then
    select ap.timezone into v_zone
      from agency_profiles ap
     where ap.tenant_id = p_tenant_id
       and ap.timezone is not null
       and exists (select 1 from pg_timezone_names tz where tz.name = ap.timezone);
  end if;

  if v_zone is null then
    select st.timezone into v_zone
      from state_timezones st
     where st.state = upper(nullif(btrim(coalesce(p_lead_values->>'state', '')), ''));
  end if;

  return (p_at at time zone coalesce(v_zone, 'UTC'))::date;
end;
$function$;

revoke all on function public.deal_local_date(uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.deal_local_date(uuid, uuid, jsonb, timestamptz) to tenant_app, service_role;
