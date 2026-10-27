-- Signup order: verify email -> About you -> plan/payment -> optional business profile.
-- No existing business profile or licensing data is rewritten. Existing in-flight states remain
-- accepted by the save RPC so a tenant can finish the path it started on.

alter table public.tenants
  add column if not exists business_profile_skipped_at timestamptz;

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
  select invitation.* into v_token
    from public.user_invitations invitation
   where invitation.token_hash = p_token_hash
     and invitation.purpose = 'email_verification'
     and invitation.accepted_at is null
     and invitation.expires_at > now()
   for update;
  if not found then raise exception using errcode = 'P0001', message = 'VERIFICATION_INVALID_OR_EXPIRED'; end if;

  select membership.tenant_id into v_tenant_id
    from public.tenant_users membership
   where membership.user_id = v_token.user_id and membership.role = 'owner'
   for update;
  if not found then raise exception using errcode = 'P0001', message = 'OWNER_MEMBERSHIP_NOT_FOUND'; end if;

  update public.users as account set status = 'active'
   where account.id = v_token.user_id and account.status = 'pending_verification'
   returning account.email into v_email;
  if not found then raise exception using errcode = 'P0001', message = 'ACCOUNT_NOT_PENDING_VERIFICATION'; end if;

  update public.user_invitations as invitation set accepted_at = now()
   where invitation.user_id = v_token.user_id and invitation.purpose = 'email_verification' and invitation.accepted_at is null;
  update public.tenant_users as membership set accepted_at = coalesce(membership.accepted_at, now())
   where membership.user_id = v_token.user_id and membership.tenant_id = v_tenant_id;
  update public.tenants as tenant set onboarding_state = 'about_you'
   where tenant.id = v_tenant_id and tenant.onboarding_state = 'pending_verification';
  return query select v_token.user_id, v_tenant_id, v_email;
end;
$$;

revoke execute on function public.complete_signup_email_verification(text) from public, anon, authenticated;
grant execute on function public.complete_signup_email_verification(text) to service_role;

create or replace function public.save_signup_about_you(
  p_user_id uuid,
  p_first_name text,
  p_last_name text,
  p_phone text
)
returns table(tenant_id uuid, onboarding_state text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
begin
  select membership.tenant_id into v_tenant_id
    from public.tenant_users membership
    join public.users account on account.id = membership.user_id
   where membership.user_id = p_user_id and membership.role = 'owner' and account.status = 'active'
   for update of membership;
  if not found then raise exception using errcode = 'P0001', message = 'VERIFIED_OWNER_NOT_FOUND'; end if;
  update public.tenants set onboarding_state = 'ready_for_checkout'
   where id = v_tenant_id and onboarding_state = 'about_you';
  if not found then raise exception using errcode = 'P0001', message = 'ABOUT_YOU_NOT_AVAILABLE'; end if;
  update public.users
     set name = btrim(p_first_name) || ' ' || btrim(p_last_name),
         full_name = btrim(p_first_name) || ' ' || btrim(p_last_name),
         display_name = btrim(p_first_name) || ' ' || btrim(p_last_name),
         phone = nullif(btrim(p_phone), ''), updated_at = now()
   where id = p_user_id;
  update public.tenants
     set name = btrim(p_first_name) || ' ' || btrim(p_last_name) || '''s Workspace'
   where id = v_tenant_id and name = 'New user''s Workspace';
  return query select v_tenant_id, 'ready_for_checkout'::text;
end;
$$;

revoke all on function public.save_signup_about_you(uuid, text, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.save_signup_about_you(uuid, text, text, text) to service_role;

create or replace function public.create_subscription_from_checkout(
  p_tenant_id uuid,
  p_plan_id uuid,
  p_billing_cycle public.billing_cycle,
  p_whop_membership_id text,
  p_trial_days integer
)
returns table(subscription_id uuid, created boolean, status public.subscription_status)
language plpgsql
as $$
declare
  v_existing public.subscriptions%rowtype;
  v_id uuid;
  v_status public.subscription_status;
  v_now timestamptz := now();
  v_trial_ends timestamptz;
  v_onboarding_state text;
begin
  select * into v_existing from public.subscriptions where tenant_id = p_tenant_id for update;
  if found then
    if p_whop_membership_id is not null and v_existing.whop_membership_id is null then
      update public.subscriptions set whop_membership_id = p_whop_membership_id where id = v_existing.id;
    end if;
    return query select v_existing.id, false, v_existing.status;
    return;
  end if;

  if p_trial_days > 0 then
    v_status := 'trialing';
    v_trial_ends := v_now + make_interval(days => p_trial_days);
  else
    v_status := 'active';
    v_trial_ends := null;
  end if;

  insert into public.subscriptions (
    tenant_id, plan_id, status, billing_cycle, started_at, current_period_start, current_period_end, trial_ends_at, whop_membership_id
  ) values (
    p_tenant_id, p_plan_id, v_status, p_billing_cycle, v_now, v_now,
    public.period_end_for(v_now, p_billing_cycle), v_trial_ends, p_whop_membership_id
  ) returning id into v_id;

  v_onboarding_state := case
    when exists (select 1 from public.business_profiles where tenant_id = p_tenant_id) then 'completed'
    else 'business_profile'
  end;
  update public.tenants set status = 'active', onboarding_state = v_onboarding_state where id = p_tenant_id;
  return query select v_id, true, v_status;
end;
$$;

revoke execute on function public.create_subscription_from_checkout(uuid, uuid, public.billing_cycle, text, integer)
  from public, anon, authenticated;
grant execute on function public.create_subscription_from_checkout(uuid, uuid, public.billing_cycle, text, integer)
  to service_role;

create or replace function public.save_signup_business_profile(
  p_user_id uuid,
  p_business_name text,
  p_npn text,
  p_primary_state text,
  p_products_sold text[],
  p_monthly_volume_range text,
  p_lead_sources text[],
  p_lead_source_other text,
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
  select membership.tenant_id into v_tenant_id
    from public.tenant_users membership
    join public.users account on account.id = membership.user_id
   where membership.user_id = p_user_id and membership.role = 'owner' and account.status = 'active'
   for update of membership;
  if not found then raise exception using errcode = 'P0001', message = 'VERIFIED_OWNER_NOT_FOUND'; end if;

  select tenant.onboarding_state into v_state from public.tenants tenant where tenant.id = v_tenant_id for update;
  if v_state is null or v_state not in ('business_profile', 'ready_for_checkout', 'awaiting_payment') then
    raise exception using errcode = 'P0001', message = 'BUSINESS_PROFILE_NOT_AVAILABLE';
  end if;
  v_next_state := case
    when v_state = 'awaiting_payment' then 'awaiting_payment'
    when v_state = 'business_profile' and exists (
      select 1 from public.subscriptions where subscriptions.tenant_id = v_tenant_id and subscriptions.status in ('trialing', 'active')
    ) then 'completed'
    when v_state = 'business_profile' then 'ready_for_checkout'
    else 'ready_for_checkout'
  end;

  insert into public.business_profiles (
    tenant_id, business_name, npn, primary_state, products_sold, monthly_volume_range,
    lead_sources, lead_source_other, recommended_setup_steps, completed_at, updated_at
  ) values (
    v_tenant_id, btrim(p_business_name), nullif(btrim(p_npn), ''), upper(btrim(p_primary_state)), p_products_sold,
    p_monthly_volume_range, p_lead_sources, nullif(btrim(p_lead_source_other), ''), p_recommended_setup_steps, now(), now()
  ) on conflict (tenant_id) do update set
    business_name = excluded.business_name,
    npn = coalesce(excluded.npn, public.business_profiles.npn),
    primary_state = excluded.primary_state,
    products_sold = excluded.products_sold,
    monthly_volume_range = excluded.monthly_volume_range,
    lead_sources = excluded.lead_sources,
    lead_source_other = excluded.lead_source_other,
    recommended_setup_steps = excluded.recommended_setup_steps,
    completed_at = now(), updated_at = now();

  update public.tenants set name = btrim(p_business_name), onboarding_state = v_next_state where id = v_tenant_id;
  return query select v_tenant_id, v_next_state;
end;
$$;

revoke execute on function public.save_signup_business_profile(uuid, text, text, text, text[], text, text[], text, text[])
  from public, anon, authenticated;
grant execute on function public.save_signup_business_profile(uuid, text, text, text, text[], text, text[], text, text[])
  to service_role;

create or replace function public.skip_signup_business_profile(p_user_id uuid)
returns table(tenant_id uuid, onboarding_state text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
begin
  select membership.tenant_id into v_tenant_id
    from public.tenant_users membership
    join public.users account on account.id = membership.user_id
   where membership.user_id = p_user_id and membership.role = 'owner' and account.status = 'active'
   for update of membership;
  if not found then raise exception using errcode = 'P0001', message = 'VERIFIED_OWNER_NOT_FOUND'; end if;
  update public.tenants tenant
     set onboarding_state = 'completed', business_profile_skipped_at = coalesce(tenant.business_profile_skipped_at, now())
   where tenant.id = v_tenant_id and tenant.onboarding_state = 'business_profile'
     and exists (select 1 from public.subscriptions where subscriptions.tenant_id = v_tenant_id and subscriptions.status in ('trialing', 'active'));
  if not found then raise exception using errcode = 'P0001', message = 'BUSINESS_PROFILE_SKIP_NOT_AVAILABLE'; end if;
  return query select v_tenant_id, 'completed'::text;
end;
$$;

revoke all on function public.skip_signup_business_profile(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.skip_signup_business_profile(uuid) to service_role;
