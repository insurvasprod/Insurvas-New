-- Keep the existing database helper usable while the live project contains
-- both the later agent_* model and the LA-0 tenant vault model.
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
            and eo.expires_at >= p_at
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
            and eo.expires_at >= p_at
        )
    )
  );
$$;

revoke all on function public.can_write(uuid, text, date, uuid) from public, anon, authenticated;
grant execute on function public.can_write(uuid, text, date, uuid) to service_role;
