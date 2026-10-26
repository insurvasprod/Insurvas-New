-- Remove E&O cover and continuing education from the platform (owner decision 2026-10-26: "remove E&O and
-- continuing education everywhere, including the gates and the checklist").
--
-- Every function that read eo_policies, agent_eo_policies or ce_records is re-created from its LIVE body with only
-- the E&O / CE part taken out:
--   can_write_with_grace   the write gate: contract + appointment + licence. No E&O exists-clause on either path
--                          (tenant vault or the legacy agent_* bridge). p_grace_days is kept so the signature, the
--                          grants and every caller stay as they are; it no longer changes the answer.
--   can_write              same signature and boolean; asks can_write_with_grace with 0 (there is no grace to give).
--   can_write_reason       ok | no_user | no_contract | no_appointment | no_licence. 'grace', 'eo_expired' and
--                          'no_eo' are gone; a user whose pieces exist but in different agencies reads no_appointment
--                          (no appointment under a contract he holds), never ok.
--   emit_credential_expiry_alerts  the daily expiry notices: licences only.
--   producer_checklist     AG-1.10: the E&O item is removed (six items now; the W-9 is item 6), so can_submit is
--                          derived without it. producer_refresh_can_submit (the one writer of can_submit) is
--                          unchanged and reads this function.
-- And these are dropped, because nothing calls them any more (the app's E&O / CE routes were deleted):
--   save_eo_policy, save_eo_policy_with_limits, save_ce_record, save_ce_record_with_ethics, eo_grace_days.
--
-- NOT destructive: the tables public.eo_policies, public.ce_records and public.agent_eo_policies are RETIRED and
-- UNREAD — no function, view, trigger, cron job or app route reads or writes them after this file — but they, their
-- rows, their RLS policies and their updated_at triggers are left exactly as they are. So are the
-- producer_onboarding_item rows with item = 'eo' (its check constraint still allows 'eo'; nothing reads those rows),
-- tenant_carrier_requirements.requires_eo (no longer read or written), and the settings row
-- compliance.eo_grace_days (no longer read).
--
-- After the functions, every producer's can_submit is re-derived once so a producer held back only by E&O can
-- submit today rather than after the 06:15 daily job. That step runs only where the role can write producer (the
-- owner's paste); a rehearsal role cannot, and skips it.
--
-- Rollback: re-run the function bodies from 20261015580000 (can_write*, eo_grace_days), 20261015320000
-- (emit_credential_expiry_alerts), 20261018240000 (producer_checklist), 20260924220300 and the LA-0.5 vault
-- migration (the save_* functions).

-- ─── 1. the write gate: contract + appointment + licence ────────────────────────────────────────

create or replace function public.can_write_with_grace(
  p_carrier_id uuid,
  p_state text,
  p_at date,
  p_user_id uuid,
  p_grace_days integer
)
returns boolean
language sql stable security definer
set search_path = public, pg_catalog
as $$
  -- p_grace_days is unused since 2026-10-26 (it was the E&O grace); kept for the signature.
  select p_user_id is not null and (
    exists (
      select 1
      from public.agent_carrier_contracts contract
      join public.agent_appointments appointment
        on appointment.organization_id = contract.organization_id
       and appointment.user_id = contract.user_id
       and appointment.carrier_id = contract.carrier_id
      where contract.user_id = p_user_id
        and contract.carrier_id = p_carrier_id
        and (contract.status = 'active' or contract.effective_to >= p_at)
        and contract.effective_from <= p_at
        and (contract.effective_to is null or contract.effective_to >= p_at)
        and appointment.state = upper(trim(p_state))
        and (appointment.status = 'active' or appointment.terminated_at >= p_at)
        and appointment.effective_from <= p_at
        and (appointment.terminated_at is null or appointment.terminated_at >= p_at)
        and exists (
          select 1 from public.agent_licenses license
          where license.organization_id = contract.organization_id
            and license.user_id = p_user_id
            and license.state = upper(trim(p_state))
            and license.status = 'active'
            and license.expires_at >= p_at
        )
    )
    or exists (
      select 1
      from public.tenant_carriers contract
      join public.tenant_users membership
        on membership.tenant_id = contract.tenant_id
       and membership.user_id = p_user_id
      join public.appointments appointment
        on appointment.tenant_id = contract.tenant_id
       and appointment.carrier_id = contract.carrier_id
      where contract.carrier_id = p_carrier_id
        and contract.is_active
        and contract.effective_from <= p_at
        and appointment.state = upper(trim(p_state))
        and appointment.effective_from <= p_at
        and (appointment.terminated_at is null or appointment.terminated_at >= p_at)
        and (appointment.status = 'active' or appointment.terminated_at >= p_at)
        and exists (
          select 1 from public.licenses license
          where license.tenant_id = contract.tenant_id
            and license.state = upper(trim(p_state))
            and license.expires_at >= p_at
        )
    )
  );
$$;

-- Same signature and boolean as before, so every caller keeps working.
create or replace function public.can_write(
  p_carrier_id uuid,
  p_state text,
  p_at date default current_date,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select public.can_write_with_grace(p_carrier_id, p_state, p_at, p_user_id, 0);
$$;

-- Why can_write answered as it did. Diagnoses the tenant vault in the order the TS rule checks it.
create or replace function public.can_write_reason(
  p_carrier_id uuid,
  p_state text,
  p_at date default current_date,
  p_user_id uuid default auth.uid()
)
returns text
language plpgsql stable security definer
set search_path = public, pg_catalog
as $$
declare
  v_state text := upper(trim(p_state));
begin
  if p_user_id is null then
    return 'no_user';
  end if;
  if public.can_write_with_grace(p_carrier_id, p_state, p_at, p_user_id, 0) then
    return 'ok';
  end if;

  if not exists (
    select 1
      from public.tenant_carriers contract
      join public.tenant_users membership on membership.tenant_id = contract.tenant_id and membership.user_id = p_user_id
     where contract.carrier_id = p_carrier_id
       and contract.is_active
       and contract.effective_from <= p_at
  ) then
    return 'no_contract';
  end if;

  if not exists (
    select 1
      from public.appointments appointment
      join public.tenant_users membership on membership.tenant_id = appointment.tenant_id and membership.user_id = p_user_id
     where appointment.carrier_id = p_carrier_id
       and appointment.state = v_state
       and appointment.effective_from <= p_at
       and (appointment.terminated_at is null or appointment.terminated_at >= p_at)
       and (appointment.status = 'active' or appointment.terminated_at >= p_at)
  ) then
    return 'no_appointment';
  end if;

  if not exists (
    select 1
      from public.licenses license
      join public.tenant_users membership on membership.tenant_id = license.tenant_id and membership.user_id = p_user_id
     where license.state = v_state
       and license.expires_at >= p_at
  ) then
    return 'no_licence';
  end if;

  -- Each piece exists, but not together under one agency's contract: there is no appointment he can write on.
  return 'no_appointment';
end;
$$;

revoke all on function public.can_write_with_grace(uuid, text, date, uuid, integer) from public, anon, authenticated;
grant execute on function public.can_write_with_grace(uuid, text, date, uuid, integer) to service_role;
revoke all on function public.can_write(uuid, text, date, uuid) from public, anon, authenticated;
grant execute on function public.can_write(uuid, text, date, uuid) to service_role;
revoke all on function public.can_write_reason(uuid, text, date, uuid) from public, anon, authenticated;
grant execute on function public.can_write_reason(uuid, text, date, uuid) to service_role;

-- ─── 2. the daily expiry notices: licences only ─────────────────────────────────────────────────

create or replace function public.emit_credential_expiry_alerts(p_today date default current_date)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_n integer;
begin
  with due as (
    select l.tenant_id, 'licence'::text as what, l.id, l.expires_at,
           l.state || ' licence ' || l.license_number as label
      from public.licenses l
     where l.expires_at <= p_today + 30
  ), stepped as (
    select d.*, (d.expires_at - p_today) as days,
           case when d.expires_at - p_today < 0 then 'lapsed' when d.expires_at - p_today <= 1 then '1'
                when d.expires_at - p_today <= 7 then '7' when d.expires_at - p_today <= 14 then '14' else '30' end as step
      from due d
     -- A lapsed item is told about for a week, not forever.
     where d.expires_at >= p_today - 7
  ), sent as (
    insert into public.agent_notifications (tenant_id, recipient_user_id, kind, title, body, link, source_key)
    select s.tenant_id, tu.user_id, 'credential_expiring',
           case when s.days < 0 then s.label || ' has lapsed' when s.days = 0 then s.label || ' expires today'
                else s.label || ' expires in ' || s.days || ' day' || case when s.days = 1 then '' else 's' end end,
           'Expires ' || to_char(s.expires_at, 'FMMonth FMDD, YYYY') || '. Record the renewal in States & licences.',
           '/app/settings#states-licences',
           'credential-expiring:' || s.what || ':' || s.id || ':' || s.step
      from stepped s
      join public.tenant_users tu on tu.tenant_id = s.tenant_id and tu.role::text = 'owner' and tu.accepted_at is not null
      join public.users u on u.id = tu.user_id and u.status = 'active'
      join public.tenants t on t.id = s.tenant_id and t.status::text <> 'suspended'
    on conflict (tenant_id, recipient_user_id, source_key) do nothing
    returning 1
  )
  select count(*) into v_n from sent;
  return v_n;
end;
$$;

revoke all on function public.emit_credential_expiry_alerts(date) from public, anon, authenticated;
grant execute on function public.emit_credential_expiry_alerts(date) to service_role;

-- ─── 3. AG-1.10: the producer checklist without the E&O item ────────────────────────────────────

create or replace function public.producer_checklist(p_tenant_id uuid, p_producer_id uuid, p_as_of date default current_date)
returns table(item text, seq integer, done boolean, detail text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_owner boolean;
  v_appointed uuid[];
  v_missing_numbers integer;
  v_missing_levels integer;
begin
  select p.user_id into v_user from public.producer p where p.tenant_id = p_tenant_id and p.id = p_producer_id;
  if v_user is null then return; end if;
  v_owner := exists (select 1 from public.tenant_users tu where tu.tenant_id = p_tenant_id and tu.user_id = v_user and tu.role::text = 'owner' and tu.agency_role is null);

  -- 1. licence: a licensed state with an expiry on record, not lapsed
  return query select 'licence', 1,
    exists (select 1 from public.tenant_user_licensed_states s where s.tenant_id = p_tenant_id and s.user_id = v_user and s.expires_on is not null and s.expires_on >= p_as_of)
    or (v_owner and exists (select 1 from public.licenses l where l.tenant_id = p_tenant_id and l.expires_at is not null and l.expires_at >= p_as_of)),
    'State licence number and expiry';

  -- 2. appointments: at least one carrier appointment in force
  select coalesce(array_agg(distinct a.carrier_id), '{}') into v_appointed
    from public.producer_appointment a
   where a.producer_id = p_producer_id and a.status = 'appointed' and (a.effective_from is null or a.effective_from <= p_as_of) and (a.expires_on is null or a.expires_on >= p_as_of);
  if v_owner and cardinality(v_appointed) = 0 then
    select coalesce(array_agg(distinct a.carrier_id), '{}') into v_appointed from public.appointments a
     where a.tenant_id = p_tenant_id and a.status = 'active' and (a.expires_at is null or a.expires_at >= p_as_of) and (a.terminated_at is null or a.terminated_at >= p_as_of);
  end if;
  return query select 'appointments', 2, cardinality(v_appointed) > 0, 'State appointments per carrier';

  -- 3. contracting: the owner approved it (the owner himself holds the contracts)
  return query select 'contracting', 3,
    v_owner or exists (select 1 from public.producer_onboarding_item i where i.producer_id = p_producer_id and i.item = 'contracting'),
    'Carrier contracting complete';

  -- 4. & 5. a writing number and a contract level for every appointed carrier
  select count(*) into v_missing_numbers from unnest(v_appointed) c(id)
   where not exists (select 1 from public.producer_writing_number w where w.producer_id = p_producer_id and w.carrier_id = c.id
                      and p_as_of between w.effective_from and coalesce(w.effective_to, '9999-12-31'::date));
  return query select 'numbers', 4, cardinality(v_appointed) > 0 and v_missing_numbers = 0,
    case when v_missing_numbers > 0 then format('Writing number per carrier (%s missing)', v_missing_numbers) else 'Writing number per carrier' end;
  select count(*) into v_missing_levels from unnest(v_appointed) c(id)
   where not exists (select 1 from public.producer_contract_level l where l.producer_id = p_producer_id and l.carrier_id = c.id
                      and p_as_of between l.effective_from and coalesce(l.effective_to, '9999-12-31'::date));
  return query select 'levels', 5, cardinality(v_appointed) > 0 and v_missing_levels = 0,
    case when v_missing_levels > 0 then format('Contract level per carrier (%s missing)', v_missing_levels) else 'Contract level per carrier' end;

  -- 6. W-9 (not asked of the owner). E&O was item 6 until 2026-10-26.
  return query select 'w9', 6,
    v_owner or exists (select 1 from public.producer_onboarding_item i where i.producer_id = p_producer_id and i.item = 'w9' and i.document_path is not null),
    'W-9 on file';
end;
$$;

revoke all on function public.producer_checklist(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.producer_checklist(uuid, uuid, date) to service_role;

-- ─── 4. the writers and the grace setting nothing calls any more ────────────────────────────────

drop function if exists public.save_eo_policy(uuid, text, text, date, bigint);
drop function if exists public.save_eo_policy_with_limits(uuid, text, text, date, bigint, jsonb);
drop function if exists public.save_ce_record(uuid, text, integer, integer, date);
drop function if exists public.save_ce_record_with_ethics(uuid, text, integer, integer, date, jsonb);
drop function if exists public.eo_grace_days();

-- ─── 5. re-derive can_submit now (the owner's paste only) ───────────────────────────────────────

do $$
begin
  if has_table_privilege(current_user, 'public.producer', 'UPDATE') then
    perform public.producer_refresh_can_submit_all();
  end if;
end;
$$;

-- ─── self-check: fails the script, rolled back, if any piece did not land ───────────────────────

do $$
declare
  v_reader text;
begin
  -- No function may still read the retired tables.
  select string_agg(p.proname, ', ' order by p.proname) into v_reader
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prosrc ~* '\m(agent_eo_policies|eo_policies|ce_records)\M';
  if v_reader is not null then
    raise exception 'remove E&O and CE: these functions still read eo_policies / ce_records: %', v_reader;
  end if;

  if to_regprocedure('public.save_eo_policy(uuid, text, text, date, bigint)') is not null
     or to_regprocedure('public.save_eo_policy_with_limits(uuid, text, text, date, bigint, jsonb)') is not null
     or to_regprocedure('public.save_ce_record(uuid, text, integer, integer, date)') is not null
     or to_regprocedure('public.save_ce_record_with_ethics(uuid, text, integer, integer, date, jsonb)') is not null
     or to_regprocedure('public.eo_grace_days()') is not null then
    raise exception 'remove E&O and CE: a retired E&O / CE function still exists';
  end if;

  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'producer_checklist' and p.prosrc like '%''eo''%') then
    raise exception 'remove E&O and CE: producer_checklist still has the E&O item';
  end if;

  -- The gate still answers. Needs read access to the vault tables, which the owner's paste has (a rehearsal role
  -- running copies of these security-definer functions as itself does not, and skips this part).
  if has_table_privilege(current_user, 'public.agent_carrier_contracts', 'SELECT') then
    if public.can_write_reason(gen_random_uuid(), 'TX', current_date, null) <> 'no_user' then
      raise exception 'can_write_reason must say no_user for a missing user';
    end if;
    if public.can_write_reason(gen_random_uuid(), 'TX', current_date, gen_random_uuid()) <> 'no_contract' then
      raise exception 'can_write_reason must say no_contract for a user with no carrier';
    end if;
    if public.can_write(gen_random_uuid(), 'TX', current_date, gen_random_uuid()) then
      raise exception 'can_write must stay false for a user with no carrier';
    end if;
  end if;
end;
$$;
