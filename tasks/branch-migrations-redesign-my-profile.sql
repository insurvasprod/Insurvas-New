-- ============================================================================
-- redesign/my-profile: every SQL change this branch needs, in order.
-- Paste into the Supabase SQL editor and run once. All-or-nothing (one
-- transaction) and safe to run again.
--
--   1. 20261028120000_carrier_setup_drafts          (Contracting saved drafts)
--   2. 20261028400000_pricing_plan_intent           (remember plan picked on Pricing)
--   3. 20261028500000_payment_before_business_profile (verify -> About you -> pay -> optional business info)
-- ============================================================================

begin;

-- Stop early, with a clear message, if an older migration from main is missing.
do $$
begin
  if to_regclass('public.carriers') is null then raise exception 'Missing public.carriers: apply the earlier main-branch migrations first'; end if;
  if to_regclass('public.signup_selections') is null then raise exception 'Missing public.signup_selections: apply the earlier main-branch migrations first'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'full_name') then
    raise exception 'Missing users.full_name: apply the earlier main-branch migrations first';
  end if;
  if to_regprocedure('public.period_end_for(timestamptz, public.billing_cycle)') is null then raise exception 'Missing public.period_end_for: apply the earlier main-branch migrations first'; end if;
end $$;

-- From 20261026200000_signup_npn_optional (already on main): NPN is optional at sign-up.
-- Repeated here because step 3 relies on it; harmless if already applied.
alter table public.business_profiles alter column npn drop not null;

-- ---------------------------------------------------------------------------
-- 20261028120000_carrier_setup_drafts.sql
-- ---------------------------------------------------------------------------

-- LA-0.4 · A selected carrier may have incomplete contract details during setup.
-- These drafts are not tenant_carriers rows and never count as contracts or selling eligibility.

create table if not exists public.tenant_carrier_setup_drafts (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete cascade,
  contract_level_text text check (contract_level_text is null or length(btrim(contract_level_text)) <= 20),
  effective_from date,
  writing_number text check (writing_number is null or length(btrim(writing_number)) <= 120),
  updated_at timestamptz not null default now(),
  updated_by uuid not null,
  primary key (tenant_id, carrier_id)
);

alter table public.tenant_carrier_setup_drafts enable row level security;
revoke all on table public.tenant_carrier_setup_drafts from anon, authenticated, tenant_app;
grant select, insert, update, delete on table public.tenant_carrier_setup_drafts to service_role;

comment on table public.tenant_carrier_setup_drafts is
  'Incomplete Contracting form values only; never a contract or appointment and never an eligibility input.';

-- ---------------------------------------------------------------------------
-- 20261028400000_pricing_plan_intent.sql
-- ---------------------------------------------------------------------------

-- Preserve whether the owner selected a plan on Pricing before creating an account.
-- This allows onboarding to carry that choice straight to checkout, while the trial entry
-- still presents the plan chooser. Existing rows intentionally default to the chooser path.
alter table public.signup_selections
  add column if not exists selected_from_pricing boolean not null default false;

create or replace function public.self_serve_signup_with_auth(
  p_auth_user_id uuid,
  p_name text,
  p_email text,
  p_phone text,
  p_plan_id uuid,
  p_billing_cycle public.billing_cycle,
  p_token_hash text,
  p_expires_at timestamptz,
  p_selected_from_pricing boolean
)
returns table(user_id uuid, tenant_id uuid, verification_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_verification_id uuid;
  v_plan public.plans%rowtype;
  v_cycle_available boolean;
begin
  if not exists (
    select 1 from public.users
     where id = p_auth_user_id and lower(users.email) = lower(btrim(p_email))
  ) then
    raise exception using errcode = 'P0001', message = 'AUTH_PROFILE_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.users
     where lower(users.email) = lower(btrim(p_email)) and id <> p_auth_user_id
  ) then
    raise exception using errcode = '23505', message = 'EMAIL_EXISTS';
  end if;

  if exists (select 1 from public.tenant_users tu where tu.user_id = p_auth_user_id) then
    raise exception using errcode = '23505', message = 'EMAIL_EXISTS';
  end if;

  select p.*
    into v_plan
    from public.plans p
   where p.id = p_plan_id
     and p.is_public
     and not p.is_archived
     and p.version = (
       select max(latest.version)
         from public.plans latest
        where latest.code = p.code
     )
   for share;

  if not found then
    raise exception using errcode = 'P0001', message = 'PLAN_UNAVAILABLE';
  end if;

  select case p_billing_cycle
    when 'monthly' then prices.price_monthly_cents is not null
    when 'quarterly' then prices.price_quarterly_cents is not null
    when 'yearly' then prices.price_yearly_cents is not null
  end
    into v_cycle_available
    from public.plan_prices prices
   where prices.plan_id = p_plan_id;

  if coalesce(v_cycle_available, false) is not true then
    raise exception using errcode = 'P0001', message = 'BILLING_CYCLE_UNAVAILABLE';
  end if;

  update public.users
     set name = btrim(p_name),
         full_name = btrim(p_name),
         display_name = btrim(p_name),
         phone = nullif(btrim(p_phone), ''),
         status = 'pending_verification'::public.user_status,
         updated_at = now()
   where id = p_auth_user_id;

  insert into public.tenants (name, status, onboarding_state)
  values (btrim(p_name) || '''s Workspace', 'provisioning', 'pending_verification')
  returning id into v_tenant_id;

  insert into public.tenant_users (tenant_id, user_id, role)
  values (v_tenant_id, p_auth_user_id, 'owner');

  insert into public.signup_selections (tenant_id, plan_id, billing_cycle, selected_from_pricing)
  values (v_tenant_id, p_plan_id, p_billing_cycle, coalesce(p_selected_from_pricing, false));

  insert into public.user_invitations (user_id, token_hash, purpose, expires_at)
  values (p_auth_user_id, p_token_hash, 'email_verification'::public.user_token_purpose, p_expires_at)
  returning id into v_verification_id;

  return query select p_auth_user_id, v_tenant_id, v_verification_id;
end;
$$;

revoke all on function public.self_serve_signup_with_auth(uuid, text, text, text, uuid, public.billing_cycle, text, timestamptz, boolean)
  from public, anon, authenticated, tenant_app;
grant execute on function public.self_serve_signup_with_auth(uuid, text, text, text, uuid, public.billing_cycle, text, timestamptz, boolean)
  to service_role;

comment on function public.self_serve_signup_with_auth(uuid, text, text, text, uuid, public.billing_cycle, text, timestamptz, boolean) is
  'Self-serve Auth signup that preserves Pricing-plan intent for the post-verification plan/checkout step.';

-- ---------------------------------------------------------------------------
-- 20261028500000_payment_before_business_profile.sql
-- ---------------------------------------------------------------------------

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
  v_state text;
begin
  select membership.tenant_id into v_tenant_id
    from public.tenant_users membership
    join public.users account on account.id = membership.user_id
   where membership.user_id = p_user_id and membership.role = 'owner' and account.status = 'active'
   for update of membership;
  if not found then raise exception using errcode = 'P0001', message = 'VERIFIED_OWNER_NOT_FOUND'; end if;
  -- First save moves the owner on to the plan. Going Back from the plan or payment step to correct
  -- a detail is allowed and keeps the state where it is.
  select tenant.onboarding_state into v_state from public.tenants tenant where tenant.id = v_tenant_id for update;
  if v_state is null or v_state not in ('about_you', 'ready_for_checkout', 'awaiting_payment') then
    raise exception using errcode = 'P0001', message = 'ABOUT_YOU_NOT_AVAILABLE';
  end if;
  if v_state = 'about_you' then
    v_state := 'ready_for_checkout';
    update public.tenants as tenant set onboarding_state = v_state where tenant.id = v_tenant_id;
  end if;
  update public.users
     set name = btrim(p_first_name) || ' ' || btrim(p_last_name),
         full_name = btrim(p_first_name) || ' ' || btrim(p_last_name),
         display_name = btrim(p_first_name) || ' ' || btrim(p_last_name),
         phone = nullif(btrim(p_phone), ''), updated_at = now()
   where id = p_user_id;
  update public.tenants as tenant
     set name = btrim(p_first_name) || ' ' || btrim(p_last_name) || '''s Workspace'
   where tenant.id = v_tenant_id and tenant.name = 'New user''s Workspace';
  return query select v_tenant_id, v_state;
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

commit;
