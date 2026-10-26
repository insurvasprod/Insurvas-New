-- Sign-up no longer asks for the NPN (owner, 2026-10-26: "remove npn" from Step 3 of 5, Your agency).
--
-- The NPN is asked later, in Settings › Agency profile, where the dispute letters and the complaint
-- register already read it from. Every reader of business_profiles.npn copes with it being empty:
-- getAgencyProfile falls back to null, and the agency backfills read it through nullif(btrim(npn), '').
--
-- 1. business_profiles.npn may be null. The format check stays: a null passes it, a typed value is
--    still 1–10 digits.
-- 2. save_signup_business_profile stores an empty p_npn as null, and a re-save during checkout keeps
--    an NPN already on the row instead of wiping it.
--
-- The function body is the live one (20261015580000) with only the two npn lines changed.

alter table public.business_profiles alter column npn drop not null;

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
    v_tenant_id, btrim(p_business_name), nullif(btrim(p_npn), ''), upper(btrim(p_primary_state)),
    p_products_sold, p_monthly_volume_range, p_lead_sources,
    nullif(btrim(p_lead_source_other), ''), p_recommended_setup_steps, now(), now()
  )
  on conflict (tenant_id) do update set
    business_name = excluded.business_name,
    -- Sign-up no longer asks for it: keep one already saved rather than clearing it on a re-save.
    npn = coalesce(excluded.npn, public.business_profiles.npn),
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

-- Self-check: the column takes a null, the format check still refuses letters, the function keeps an NPN.
do $$
begin
  if (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'business_profiles' and column_name = 'npn') <> 'YES' then
    raise exception 'business_profiles.npn is still NOT NULL';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'business_profiles_npn_check') then
    raise exception 'business_profiles_npn_check is missing';
  end if;
  if pg_get_functiondef('public.save_signup_business_profile(uuid,text,text,text,text[],text,text[],text,text[])'::regprocedure) !~ 'coalesce\(excluded\.npn' then
    raise exception 'save_signup_business_profile does not keep an existing NPN';
  end if;
end;
$$;
