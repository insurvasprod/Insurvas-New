-- Fixes 42702 "column reference tenant_id is ambiguous" in save_signup_business_profile.
--
-- The function RETURNS TABLE(tenant_id uuid, ...), so `tenant_id` is an OUT parameter in scope for
-- the whole body — and `on conflict (tenant_id)` cannot tell whether that names the column or the
-- variable. The effect was that the business-profile step of signup threw at runtime, so no
-- self-serve signup could complete.
--
-- The sibling fix in 20260830010200 solved the same class by qualifying columns with table
-- aliases, but that is not available here: an ON CONFLICT target must name the column bare.
-- `#variable_conflict use_column` resolves bare identifiers to columns instead, which is safe in
-- this function because every genuine variable is already prefixed (v_ / p_).
--
-- The signature is unchanged on purpose, so the TypeScript caller reading `.tenant_id` keeps working.

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

  if not exists (
    select 1
      from public.tenants tenant
     where tenant.id = v_tenant_id
       and tenant.onboarding_state in ('business_profile', 'ready_for_checkout')
  ) then
    raise exception using errcode = 'P0001', message = 'BUSINESS_PROFILE_NOT_AVAILABLE';
  end if;

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
         onboarding_state = 'ready_for_checkout'
   where id = v_tenant_id;

  return query select v_tenant_id, 'ready_for_checkout'::text;
end;
$$;

revoke execute on function public.save_signup_business_profile(uuid, text, text, text, text[], text, text[], text, text[])
  from public, anon, authenticated;
grant execute on function public.save_signup_business_profile(uuid, text, text, text, text[], text, text[], text, text[])
  to service_role;
