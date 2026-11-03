-- Settings › Carrier library: a commission schedule can end on an open-ended year ("Year 11+").
--
-- Carriers quote renewals as "year 11 and every year after". The schedule stored one row per policy
-- year (1–100), so the only way to say that was ninety identical rows. `applies_onward` marks a row
-- as covering its own year and every later year that has no row of its own; resolveCommissionRate
-- (lib/carriers/resolve.ts) applies it — an exact year always wins, otherwise the highest onward
-- row below the year does.
--
-- The seven-argument save_commission_schedule stays exactly as it is, so a caller that predates this
-- column keeps working. The eight-argument overload has no defaults, so PostgREST never finds the
-- two ambiguous.

alter table public.commission_schedules
  add column if not exists applies_onward boolean not null default false;

create or replace function public.save_commission_schedule(
  p_tenant_id uuid,
  p_carrier_id uuid,
  p_product_code text,
  p_contract_level_bp integer,
  p_policy_year integer,
  p_rate_bp integer,
  p_effective_from date,
  p_applies_onward boolean
)
returns public.commission_schedules
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.commission_schedules;
begin
  if not exists (
    select 1 from public.tenant_carriers
    where tenant_id = p_tenant_id and carrier_id = p_carrier_id
      and contract_level_bp = p_contract_level_bp and effective_from <= p_effective_from
  ) then
    raise exception 'Save the carrier contract level before its commission schedule';
  end if;

  -- One open-ended row per schedule version: marking year 11 onward un-marks any other year in the
  -- same carrier / product / level / effective date, so "Year 11+" and "Year 15+" cannot both claim
  -- year 20.
  if coalesce(p_applies_onward, false) then
    update public.commission_schedules
       set applies_onward = false
     where tenant_id = p_tenant_id and carrier_id = p_carrier_id and product_code = p_product_code
       and contract_level_bp = p_contract_level_bp and effective_from = p_effective_from
       and policy_year <> p_policy_year and applies_onward;
  end if;

  insert into public.commission_schedules
    (tenant_id, carrier_id, product_code, contract_level_bp, policy_year, rate_bp, effective_from, applies_onward)
  values
    (p_tenant_id, p_carrier_id, p_product_code, p_contract_level_bp, p_policy_year, p_rate_bp, p_effective_from, coalesce(p_applies_onward, false))
  on conflict (tenant_id, carrier_id, product_code, contract_level_bp, policy_year, effective_from) do update
    set rate_bp = excluded.rate_bp,
        applies_onward = excluded.applies_onward
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.save_commission_schedule(uuid, uuid, text, integer, integer, integer, date, boolean) from public, anon, authenticated;
grant execute on function public.save_commission_schedule(uuid, uuid, text, integer, integer, integer, date, boolean) to service_role;
