-- Payment before the business profile (manager review, 2026-10-28, 13:20–15:18: "move the trial
-- before business information, so he signs up more quickly … even if he skips, we get that
-- information later, when he logs in").
--
-- The sign-up order lives in tenants.onboarding_state. Until now:
--   pending_verification → business_profile → ready_for_checkout → awaiting_payment → completed
-- and only saving the business profile moved a tenant on to ready_for_checkout, so checkout could not
-- come first. From now on:
--   pending_verification → ready_for_checkout → awaiting_payment → completed
-- and the business profile can be saved in any of those states, before or after payment. An owner
-- without one is asked for it at first login (the app's gate), not here.
--
-- 1. complete_signup_email_verification moves a verified tenant straight to ready_for_checkout.
--    The body is the live one (20260830010200) with only that state changed.
-- 2. Tenants waiting in business_profile move on to ready_for_checkout, so nobody is stranded on a
--    state nothing routes to any more. 'business_profile' is not removed as a value: an old row read
--    by old code still means "verified, not yet paid".
-- 3. save_signup_business_profile accepts business_profile, ready_for_checkout, awaiting_payment
--    and completed, and never moves a tenant backwards: business_profile goes on to
--    ready_for_checkout, every other state is kept. The body is the live one (20261026200000) with
--    only the state check and the next state changed.

create or replace function public.complete_signup_email_verification(p_token_hash text)
returns table(user_id uuid, tenant_id uuid, email text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_token public.user_invitations%rowtype;
  v_tenant_id uuid;
  v_email text;
begin
  select invitation.*
    into v_token
    from public.user_invitations invitation
   where invitation.token_hash = p_token_hash
     and invitation.purpose = 'email_verification'
     and invitation.accepted_at is null
     and invitation.expires_at > now()
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'VERIFICATION_INVALID_OR_EXPIRED';
  end if;

  select membership.tenant_id
    into v_tenant_id
    from public.tenant_users membership
   where membership.user_id = v_token.user_id
     and membership.role = 'owner'
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'OWNER_MEMBERSHIP_NOT_FOUND';
  end if;

  update public.users as account
     set status = 'active'
   where account.id = v_token.user_id
     and account.status = 'pending_verification'
  returning account.email into v_email;

  if not found then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_NOT_PENDING_VERIFICATION';
  end if;

  update public.user_invitations as invitation
     set accepted_at = now()
   where invitation.user_id = v_token.user_id
     and invitation.purpose = 'email_verification'
     and invitation.accepted_at is null;

  update public.tenant_users as membership
     set accepted_at = coalesce(membership.accepted_at, now())
   where membership.user_id = v_token.user_id
     and membership.tenant_id = v_tenant_id;

  -- Payment comes next; the business profile is asked after it (2026-10-28).
  update public.tenants as tenant
     set onboarding_state = 'ready_for_checkout'
   where tenant.id = v_tenant_id
     and tenant.onboarding_state = 'pending_verification';

  return query select v_token.user_id, v_tenant_id, v_email;
end;
$$;

revoke execute on function public.complete_signup_email_verification(text)
  from public, anon, authenticated;
grant execute on function public.complete_signup_email_verification(text)
  to service_role;

-- Nobody waits on a state nothing routes to.
update public.tenants
   set onboarding_state = 'ready_for_checkout'
 where onboarding_state = 'business_profile';

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

  -- Before payment, while checkout is open, or after the plan has started (the first-login gate).
  if v_state is null or v_state not in ('business_profile', 'ready_for_checkout', 'awaiting_payment', 'completed') then
    raise exception using errcode = 'P0001', message = 'BUSINESS_PROFILE_NOT_AVAILABLE';
  end if;

  -- Never backwards: only the old pre-payment state moves on; checkout and a started plan are kept.
  v_next_state := case when v_state = 'business_profile' then 'ready_for_checkout' else v_state end;

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

-- Self-check: verification leads to checkout, nobody is left in business_profile, and the profile
-- can be saved after the plan has started without moving the tenant backwards.
do $$
begin
  if pg_get_functiondef('public.complete_signup_email_verification(text)'::regprocedure) !~ 'onboarding_state = ''ready_for_checkout''' then
    raise exception 'complete_signup_email_verification does not lead to checkout';
  end if;
  if exists (select 1 from public.tenants where onboarding_state = 'business_profile') then
    raise exception 'a tenant is still waiting in business_profile';
  end if;
  if pg_get_functiondef('public.save_signup_business_profile(uuid,text,text,text,text[],text,text[],text,text[])'::regprocedure) !~ '''completed''\)' then
    raise exception 'save_signup_business_profile does not accept a started plan';
  end if;
  if pg_get_functiondef('public.save_signup_business_profile(uuid,text,text,text,text[],text,text[],text,text[])'::regprocedure) !~ 'coalesce\(excluded\.npn' then
    raise exception 'save_signup_business_profile lost the keep-an-existing-NPN rule';
  end if;
end;
$$;
