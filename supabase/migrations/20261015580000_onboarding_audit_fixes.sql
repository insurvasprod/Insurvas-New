-- Sign-up and onboarding audit fixes (2026-10-15).
--
-- 1. Drops self_serve_signup_with_subscription (migration 0018). Only the retired /api/app/signup
--    called it. It could not work (public.users.id references auth.users, and it creates no Auth
--    identity), and had it worked it would have skipped email verification, legal acceptance, the
--    disposable-address check and the card Whop takes for the trial, and written an active or
--    trialing subscription directly. A security-definer function that can do that must not exist.
--    The one sign-up path is /signup -> /api/public/signup -> self_serve_signup_with_auth.
--
-- 2. save_signup_business_profile also accepts a tenant in 'awaiting_payment', so the owner can
--    correct the business profile while checkout is pending. It leaves that state as it is: going
--    back to 'ready_for_checkout' would hide the checkout that is already open.
--
-- 3. Sixteen Open Questions #4: an E&O policy keeps writing open for a grace period after it
--    expires. eo_grace_days() reads the platform setting compliance.eo_grace_days (default 7,
--    clamped to 0..14, the same bounds as the settings registry). can_write keeps its signature and
--    boolean result, now honouring the grace; can_write_reason is the companion that says why:
--    ok | grace | no_user | no_contract | no_appointment | no_licence | eo_expired | no_eo.
--    Licences get no grace: the decision is about E&O.

-- ─── 1. the legacy sign-up function ─────────────────────────────────────────────────────────────

drop function if exists public.self_serve_signup_with_subscription(text, text, text, text, uuid, public.billing_cycle);

-- ─── 2. the business profile while checkout is pending ──────────────────────────────────────────

create or replace function public.save_signup_business_profile(
  p_user_id                 uuid,
  p_business_name           text,
  p_npn                     text,
  p_primary_state           text,
  p_products_sold           text[],
  p_monthly_volume_range    text,
  p_lead_sources            text[],
  p_lead_source_other       text,
  p_recommended_setup_steps text[]
)
returns table(tenant_id uuid, onboarding_state text)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tenant_id uuid;
  v_state text;
  v_next_state text;
begin
  select membership.tenant_id
    into v_tenant_id
    from public.tenant_users membership
    join public.users account on account.id = membership.user_id
   where membership.user_id = p_user_id
     and membership.role = 'owner'
     and account.status = 'active'
   for update of membership;

  if not found then
    raise exception using errcode = 'P0001', message = 'VERIFIED_OWNER_NOT_FOUND';
  end if;

  select tenant.onboarding_state
    into v_state
    from public.tenants tenant
   where tenant.id = v_tenant_id
   for update;

  if v_state is null or v_state not in ('business_profile', 'ready_for_checkout', 'awaiting_payment') then
    raise exception using errcode = 'P0001', message = 'BUSINESS_PROFILE_NOT_AVAILABLE';
  end if;

  -- Checkout already open: keep it open. Otherwise the profile is what makes checkout ready.
  v_next_state := case when v_state = 'awaiting_payment' then 'awaiting_payment' else 'ready_for_checkout' end;

  insert into public.business_profiles (
    tenant_id, business_name, npn, primary_state, products_sold,
    monthly_volume_range, lead_sources, lead_source_other,
    recommended_setup_steps, completed_at, updated_at
  )
  values (
    v_tenant_id, btrim(p_business_name), btrim(p_npn), upper(btrim(p_primary_state)),
    p_products_sold, p_monthly_volume_range, p_lead_sources,
    nullif(btrim(p_lead_source_other), ''), p_recommended_setup_steps, now(), now()
  )
  on conflict (tenant_id) do update set
    business_name = excluded.business_name,
    npn = excluded.npn,
    primary_state = excluded.primary_state,
    products_sold = excluded.products_sold,
    monthly_volume_range = excluded.monthly_volume_range,
    lead_sources = excluded.lead_sources,
    lead_source_other = excluded.lead_source_other,
    recommended_setup_steps = excluded.recommended_setup_steps,
    completed_at = now(),
    updated_at = now();

  update public.tenants
     set name = btrim(p_business_name),
         onboarding_state = v_next_state
   where id = v_tenant_id;

  return query select v_tenant_id, v_next_state;
end;
$$;

revoke execute on function public.save_signup_business_profile(uuid, text, text, text, text[], text, text[], text, text[])
  from public, anon, authenticated;
grant execute on function public.save_signup_business_profile(uuid, text, text, text, text[], text, text[], text, text[])
  to service_role;

-- ─── 3. E&O grace and the reason behind can_write ───────────────────────────────────────────────

-- The platform's grace, in days. A missing or unreadable setting is the coded default, never an error.
create or replace function public.eo_grace_days()
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  v_days integer;
begin
  begin
    select (setting.value #>> '{}')::integer
      into v_days
      from public.settings setting
     where setting.key = 'compliance.eo_grace_days';
  exception when others then
    v_days := null;
  end;
  return least(greatest(coalesce(v_days, 7), 0), 14);
end;
$$;

-- can_write's rule with the E&O grace as a parameter: 0 is the strict rule, eo_grace_days() the live one.
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
        and exists (
          select 1 from public.agent_eo_policies eo
          where eo.organization_id = contract.organization_id
            and eo.user_id = p_user_id
            and eo.status = 'active'
            and eo.expires_at + greatest(coalesce(p_grace_days, 0), 0) >= p_at
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
        and exists (
          select 1 from public.eo_policies eo
          where eo.tenant_id = contract.tenant_id
            and eo.expires_at + greatest(coalesce(p_grace_days, 0), 0) >= p_at
        )
    )
  );
$$;

-- Same signature and boolean as before, so every caller keeps working; it now honours the grace.
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
  select public.can_write_with_grace(p_carrier_id, p_state, p_at, p_user_id, public.eo_grace_days());
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
  if public.can_write_with_grace(p_carrier_id, p_state, p_at, p_user_id, public.eo_grace_days()) then
    return 'grace';
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

  if exists (
    select 1
      from public.eo_policies eo
      join public.tenant_users membership on membership.tenant_id = eo.tenant_id and membership.user_id = p_user_id
  ) then
    return 'eo_expired';
  end if;

  return 'no_eo';
end;
$$;

revoke all on function public.eo_grace_days() from public, anon, authenticated;
grant execute on function public.eo_grace_days() to service_role;
revoke all on function public.can_write_with_grace(uuid, text, date, uuid, integer) from public, anon, authenticated;
grant execute on function public.can_write_with_grace(uuid, text, date, uuid, integer) to service_role;
revoke all on function public.can_write(uuid, text, date, uuid) from public, anon, authenticated;
grant execute on function public.can_write(uuid, text, date, uuid) to service_role;
revoke all on function public.can_write_reason(uuid, text, date, uuid) from public, anon, authenticated;
grant execute on function public.can_write_reason(uuid, text, date, uuid) to service_role;

-- ─── self-check ─────────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_grace integer := public.eo_grace_days();
begin
  if v_grace not between 0 and 14 then
    raise exception 'eo_grace_days() returned %, outside 0..14', v_grace;
  end if;
  if public.can_write_reason(gen_random_uuid(), 'TX', current_date, null) <> 'no_user' then
    raise exception 'can_write_reason must say no_user for a missing user';
  end if;
  if public.can_write_reason(gen_random_uuid(), 'TX', current_date, gen_random_uuid()) <> 'no_contract' then
    raise exception 'can_write_reason must say no_contract for a user with no carrier';
  end if;
  if public.can_write(gen_random_uuid(), 'TX', current_date, gen_random_uuid()) then
    raise exception 'can_write must stay false for a user with no carrier';
  end if;
end;
$$;

-- ─── grant check ────────────────────────────────────────────────────────────────────────────────

do $$
begin
  if to_regprocedure('public.self_serve_signup_with_subscription(text, text, text, text, uuid, public.billing_cycle)') is not null then
    raise exception 'self_serve_signup_with_subscription still exists';
  end if;
  if has_function_privilege('anon', 'public.can_write_reason(uuid, text, date, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.can_write_reason(uuid, text, date, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.can_write_with_grace(uuid, text, date, uuid, integer)', 'execute') then
    raise exception 'the can_write family must not be executable by anon or authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.can_write_reason(uuid, text, date, uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.can_write(uuid, text, date, uuid)', 'execute') then
    raise exception 'service_role must execute can_write and can_write_reason';
  end if;
end;
$$;
