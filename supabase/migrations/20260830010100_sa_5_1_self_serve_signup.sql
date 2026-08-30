-- SA-5.1 · public pricing, self-serve signup, verification and business profile.

create table if not exists public.signup_selections (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  billing_cycle public.billing_cycle not null,
  selected_at timestamptz not null default now()
);

create table if not exists public.business_profiles (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  business_name text not null,
  npn text not null check (npn ~ '^[0-9]{1,10}$'),
  primary_state text not null check (primary_state ~ '^[A-Z]{2}$'),
  products_sold text[] not null check (cardinality(products_sold) > 0),
  monthly_volume_range text not null check (
    monthly_volume_range in ('0_25', '26_100', '101_250', '251_500', '500_plus')
  ),
  lead_sources text[] not null check (cardinality(lead_sources) > 0),
  lead_source_other text,
  recommended_setup_steps text[] not null default '{}',
  completed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    ('other' = any(lead_sources) and nullif(btrim(lead_source_other), '') is not null)
    or not ('other' = any(lead_sources))
  )
);

create index if not exists signup_selections_plan_idx
  on public.signup_selections(plan_id);

alter table public.signup_selections enable row level security;
alter table public.business_profiles enable row level security;

revoke all on table public.signup_selections from public, anon, authenticated;
revoke all on table public.business_profiles from public, anon, authenticated;
grant select, insert, update, delete on table public.signup_selections to service_role;
grant select, insert, update, delete on table public.business_profiles to service_role;

-- Email is normalised before insert, and this index makes the guarantee true even if another
-- server caller forgets to normalise. It also closes the case-variant duplicate loophole.
create unique index if not exists users_email_lower_unique
  on public.users(lower(email));

create or replace function public.self_serve_signup(
  p_name text,
  p_email text,
  p_password_hash text,
  p_phone text,
  p_plan_id uuid,
  p_billing_cycle public.billing_cycle,
  p_token_hash text,
  p_expires_at timestamptz
)
returns table(user_id uuid, tenant_id uuid, verification_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_tenant_id uuid;
  v_verification_id uuid;
  v_plan public.plans%rowtype;
  v_cycle_available boolean;
begin
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

  insert into public.users (email, password_hash, name, phone, status)
  values (
    lower(btrim(p_email)),
    p_password_hash,
    btrim(p_name),
    nullif(btrim(p_phone), ''),
    'pending_verification'::public.user_status
  )
  returning id into v_user_id;

  insert into public.tenants (name, status, onboarding_state)
  values (btrim(p_name) || '''s Workspace', 'provisioning', 'pending_verification')
  returning id into v_tenant_id;

  insert into public.tenant_users (tenant_id, user_id, role)
  values (v_tenant_id, v_user_id, 'owner');

  insert into public.signup_selections (tenant_id, plan_id, billing_cycle)
  values (v_tenant_id, p_plan_id, p_billing_cycle);

  insert into public.user_invitations (user_id, token_hash, purpose, expires_at)
  values (
    v_user_id,
    p_token_hash,
    'email_verification'::public.user_token_purpose,
    p_expires_at
  )
  returning id into v_verification_id;

  return query select v_user_id, v_tenant_id, v_verification_id;
end;
$$;

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

  update public.users
     set status = 'active'
   where id = v_token.user_id
     and status = 'pending_verification'
  returning users.email into v_email;

  if not found then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_NOT_PENDING_VERIFICATION';
  end if;

  update public.user_invitations as invitation
     set accepted_at = now()
   where invitation.user_id = v_token.user_id
     and invitation.purpose = 'email_verification'
     and invitation.accepted_at is null;

  update public.tenant_users as membership
     set accepted_at = coalesce(accepted_at, now())
   where membership.user_id = v_token.user_id
     and membership.tenant_id = v_tenant_id;

  update public.tenants
     set onboarding_state = 'business_profile'
   where id = v_tenant_id
     and onboarding_state = 'pending_verification';

  return query select v_token.user_id, v_tenant_id, v_email;
end;
$$;

create or replace function public.refresh_signup_verification(
  p_user_id uuid,
  p_new_email text,
  p_token_hash text,
  p_expires_at timestamptz
)
returns table(verification_id uuid, email text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user public.users%rowtype;
  v_verification_id uuid;
  v_email text;
  v_last_created_at timestamptz;
begin
  select account.*
    into v_user
    from public.users account
   where account.id = p_user_id
   for update;

  if not found or v_user.status <> 'pending_verification' then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_NOT_PENDING_VERIFICATION';
  end if;

  select max(created_at)
    into v_last_created_at
    from public.user_invitations
   where user_id = p_user_id
     and purpose = 'email_verification';

  -- A typo correction must work immediately after signup. Only a resend to the unchanged
  -- address is rate-limited; otherwise the screen would identify a typo and then trap the user.
  if v_last_created_at is not null
     and v_last_created_at > now() - interval '60 seconds'
     and coalesce(nullif(lower(btrim(p_new_email)), ''), v_user.email) = v_user.email then
    raise exception using errcode = 'P0001', message = 'VERIFICATION_RESEND_TOO_SOON';
  end if;

  v_email := coalesce(nullif(lower(btrim(p_new_email)), ''), v_user.email);

  update public.users
     set email = v_email
   where id = p_user_id;

  update public.user_invitations
     set accepted_at = now()
   where user_id = p_user_id
     and purpose = 'email_verification'
     and accepted_at is null;

  insert into public.user_invitations (user_id, token_hash, purpose, expires_at)
  values (
    p_user_id,
    p_token_hash,
    'email_verification'::public.user_token_purpose,
    p_expires_at
  )
  returning id into v_verification_id;

  return query select v_verification_id, v_email;
end;
$$;

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
security invoker
set search_path = ''
as $$
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
    tenant_id,
    business_name,
    npn,
    primary_state,
    products_sold,
    monthly_volume_range,
    lead_sources,
    lead_source_other,
    recommended_setup_steps,
    completed_at,
    updated_at
  )
  values (
    v_tenant_id,
    btrim(p_business_name),
    btrim(p_npn),
    upper(btrim(p_primary_state)),
    p_products_sold,
    p_monthly_volume_range,
    p_lead_sources,
    nullif(btrim(p_lead_source_other), ''),
    p_recommended_setup_steps,
    now(),
    now()
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

revoke execute on function public.self_serve_signup(text, text, text, text, uuid, public.billing_cycle, text, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.complete_signup_email_verification(text)
  from public, anon, authenticated;
revoke execute on function public.refresh_signup_verification(uuid, text, text, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.save_signup_business_profile(uuid, text, text, text, text[], text, text[], text, text[])
  from public, anon, authenticated;

grant execute on function public.self_serve_signup(text, text, text, text, uuid, public.billing_cycle, text, timestamptz)
  to service_role;
grant execute on function public.complete_signup_email_verification(text)
  to service_role;
grant execute on function public.refresh_signup_verification(uuid, text, text, timestamptz)
  to service_role;
grant execute on function public.save_signup_business_profile(uuid, text, text, text, text[], text, text[], text, text[])
  to service_role;
