-- SA-5.2 · Hosted checkout and trial start.
--
-- Also the fix for backlog #47: until now a subscription only existed if an admin assigned a plan
-- by hand, so a customer who paid through hosted checkout got no subscription, no entitlement and
-- therefore no product.

create table if not exists public.checkout_sessions (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  plan_id            uuid not null references public.plans(id) on delete restrict,
  billing_cycle      public.billing_cycle not null,
  coupon_id          uuid references public.coupons(id) on delete set null,
  provider           text not null default 'whop',
  provider_config_id text not null,
  checkout_url       text not null,
  status             text not null default 'open' check (status in ('open', 'completed', 'abandoned')),
  created_at         timestamptz not null default now(),
  completed_at       timestamptz,
  unique (provider, provider_config_id)
);

comment on table public.checkout_sessions is
  'A hosted checkout we opened. Lets an abandoned checkout be resumed rather than restarted.';

create index if not exists checkout_sessions_tenant_idx on public.checkout_sessions (tenant_id, created_at desc);

alter table public.checkout_sessions enable row level security;
revoke all on public.checkout_sessions from tenant_app, anon, authenticated;

/**
 * Creates the subscription for a tenant that has completed checkout, and marks the tenant active.
 *
 * Idempotent on the tenant. Called from BOTH the checkout return handler and the
 * membership.activated webhook, because either can arrive first and either can be the only one
 * that arrives -- the only correct shape when you control neither the ordering nor whether both
 * happen.
 */
create or replace function public.create_subscription_from_checkout(
  p_tenant_id           uuid,
  p_plan_id             uuid,
  p_billing_cycle       public.billing_cycle,
  p_whop_membership_id  text,
  p_trial_days          integer
)
returns table(subscription_id uuid, created boolean, status public.subscription_status)
language plpgsql
as $$
declare
  v_existing   public.subscriptions%rowtype;
  v_id         uuid;
  v_status     public.subscription_status;
  v_now        timestamptz := now();
  v_trial_ends timestamptz;
begin
  select * into v_existing from public.subscriptions where tenant_id = p_tenant_id for update;

  if found then
    -- Keep the membership id fresh even when nothing was created: the webhook often knows it when
    -- the return handler did not.
    if p_whop_membership_id is not null and v_existing.whop_membership_id is null then
      update public.subscriptions set whop_membership_id = p_whop_membership_id where id = v_existing.id;
    end if;
    return query select v_existing.id, false, v_existing.status;
    return;
  end if;

  -- A trial subscription is `trialing`, which the access rules already treat as full access.
  if p_trial_days > 0 then
    v_status := 'trialing';
    v_trial_ends := v_now + make_interval(days => p_trial_days);
  else
    v_status := 'active';
    v_trial_ends := null;
  end if;

  insert into public.subscriptions (
    tenant_id, plan_id, status, billing_cycle, started_at,
    current_period_start, current_period_end, trial_ends_at, whop_membership_id
  ) values (
    p_tenant_id, p_plan_id, v_status, p_billing_cycle, v_now,
    v_now, public.period_end_for(v_now, p_billing_cycle), v_trial_ends, p_whop_membership_id
  ) returning id into v_id;

  update public.tenants
     set status = 'active', onboarding_state = 'completed'
   where id = p_tenant_id;

  return query select v_id, true, v_status;
end;
$$;

revoke execute on function public.create_subscription_from_checkout(uuid, uuid, public.billing_cycle, text, integer)
  from public, anon, authenticated;
grant execute on function public.create_subscription_from_checkout(uuid, uuid, public.billing_cycle, text, integer)
  to service_role;
