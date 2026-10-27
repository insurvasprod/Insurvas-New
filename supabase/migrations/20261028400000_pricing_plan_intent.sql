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
