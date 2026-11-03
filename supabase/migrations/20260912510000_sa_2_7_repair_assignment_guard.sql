-- SA-2.7 compatibility repair: the shared database had an older text-signature assignment RPC
-- which bypassed the lifecycle guards. Keep that signature for existing callers, but restore the
-- guarded service-only implementation.

create or replace function public.admin_assign_subscription(
  p_tenant_id uuid,
  p_plan_id uuid,
  p_billing_cycle text default 'monthly',
  p_start timestamp with time zone default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
  v_trial_days integer;
  v_price integer;
  v_status public.subscription_status;
  v_trial_ends timestamptz;
begin
  if not exists (
    select 1 from public.tenants where id = p_tenant_id
  ) then
    raise exception 'tenant_not_found' using errcode = 'foreign_key_violation';
  end if;

  if exists (
    select 1
      from public.subscriptions
     where tenant_id = p_tenant_id
       and status <> 'cancelled'
  ) then
    raise exception 'already_subscribed';
  end if;

  if not exists (
    select 1 from public.plans where id = p_plan_id
  ) then
    raise exception 'plan_not_found';
  end if;

  if exists (
    select 1 from public.plans where id = p_plan_id and is_archived
  ) then
    raise exception 'plan_archived';
  end if;

  select case p_billing_cycle
           when 'monthly' then pp.price_monthly_cents
           when 'quarterly' then pp.price_quarterly_cents
           when 'yearly' then pp.price_yearly_cents
         end,
         pp.trial_days
    into v_price, v_trial_days
    from public.plan_prices pp
   where pp.plan_id = p_plan_id;

  if v_price is null then
    raise exception 'cycle_not_offered';
  end if;

  if coalesce(v_trial_days, 0) > 0 then
    v_status := 'trialing';
    v_trial_ends := p_start + (v_trial_days || ' days')::interval;
  else
    v_status := 'active';
    v_trial_ends := null;
  end if;

  insert into public.subscriptions (
    tenant_id, plan_id, status, billing_cycle, started_at,
    current_period_start, current_period_end, trial_ends_at
  ) values (
    p_tenant_id,
    p_plan_id,
    v_status,
    p_billing_cycle::public.billing_cycle,
    p_start,
    p_start,
    public.period_end_for(p_start, p_billing_cycle::public.billing_cycle),
    v_trial_ends
  )
  returning id into v_id;

  perform public.refresh_tenant_entitlement(p_tenant_id);
  return v_id;
end;
$function$;

comment on function public.admin_assign_subscription(uuid, uuid, text, timestamptz) is
  'SA-2.7 compatibility repair. Assigns only an active, sellable plan and refuses a second live subscription.';

revoke all on function public.admin_assign_subscription(uuid, uuid, text, timestamptz)
  from public, anon, authenticated, tenant_app;
grant execute on function public.admin_assign_subscription(uuid, uuid, text, timestamptz)
  to service_role;
