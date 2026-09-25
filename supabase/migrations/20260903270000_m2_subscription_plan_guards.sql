-- M2-5 / M2-6 · Subscription operations must enforce their source state and sellable plan in SQL.

create or replace function public.admin_assign_subscription(
  p_tenant_id uuid,
  p_plan_id uuid,
  p_billing_cycle public.billing_cycle,
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
  v_archived boolean;
begin
  if exists (select 1 from public.subscriptions where tenant_id = p_tenant_id and status <> 'cancelled') then
    raise exception 'already_subscribed';
  end if;

  select p.is_archived into v_archived from public.plans p where p.id = p_plan_id;
  if not found then raise exception 'plan_not_found'; end if;
  if v_archived then raise exception 'plan_archived'; end if;

  select case p_billing_cycle
           when 'monthly' then pp.price_monthly_cents
           when 'quarterly' then pp.price_quarterly_cents
           else pp.price_yearly_cents
         end,
         pp.trial_days
    into v_price, v_trial_days
    from public.plan_prices pp where pp.plan_id = p_plan_id;
  if v_price is null then raise exception 'cycle_not_offered'; end if;

  if coalesce(v_trial_days, 0) > 0 then
    v_status := 'trialing';
    v_trial_ends := p_start + (v_trial_days || ' days')::interval;
  else
    v_status := 'active';
  end if;

  insert into public.subscriptions (
    tenant_id, plan_id, status, billing_cycle, started_at,
    current_period_start, current_period_end, trial_ends_at
  ) values (
    p_tenant_id, p_plan_id, v_status, p_billing_cycle, p_start,
    p_start, public.period_end_for(p_start, p_billing_cycle), v_trial_ends
  ) returning id into v_id;

  return v_id;
end;
$function$;

create or replace function public.admin_change_subscription_plan(
  p_subscription_id uuid,
  p_new_plan_id uuid,
  p_apply_now boolean
)
returns table(applied_now boolean, effective_at timestamp with time zone)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.subscriptions%rowtype;
  v_price integer;
  v_archived boolean;
begin
  select * into v_row from public.subscriptions where id = p_subscription_id for update;
  if not found then raise exception 'subscription_not_found'; end if;
  if v_row.status not in ('trialing', 'active', 'past_due', 'paused') then
    raise exception 'subscription_state_not_changeable:%', v_row.status using errcode = 'check_violation';
  end if;

  select p.is_archived into v_archived from public.plans p where p.id = p_new_plan_id;
  if not found then raise exception 'plan_not_found'; end if;
  if v_archived then raise exception 'plan_archived'; end if;

  select case v_row.billing_cycle
           when 'monthly' then pp.price_monthly_cents
           when 'quarterly' then pp.price_quarterly_cents
           else pp.price_yearly_cents
         end into v_price
    from public.plan_prices pp where pp.plan_id = p_new_plan_id;
  if v_price is null then raise exception 'cycle_not_offered'; end if;

  if p_apply_now then
    update public.subscriptions set plan_id = p_new_plan_id, pending_plan_id = null where id = p_subscription_id;
    return query select true, now();
  else
    update public.subscriptions set pending_plan_id = p_new_plan_id where id = p_subscription_id;
    return query select false, v_row.current_period_end;
  end if;
end;
$function$;

create or replace function public.admin_cancel_subscription(
  p_subscription_id uuid,
  p_reason text,
  p_immediate boolean default false
)
returns table(cancelled_now boolean, effective_at timestamp with time zone)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.subscriptions%rowtype;
begin
  select * into v_row from public.subscriptions where id = p_subscription_id for update;
  if not found then raise exception 'subscription_not_found'; end if;
  if v_row.status not in ('trialing', 'active', 'past_due', 'paused') then
    raise exception 'subscription_state_not_cancellable:%', v_row.status using errcode = 'check_violation';
  end if;

  if p_immediate then
    update public.subscriptions
       set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason,
           cancel_at_period_end = false, pending_plan_id = null
     where id = p_subscription_id;
    return query select true, now();
  else
    update public.subscriptions
       set cancel_at_period_end = true, cancel_reason = p_reason, status = 'cancelling'
     where id = p_subscription_id;
    return query select false, v_row.current_period_end;
  end if;
end;
$function$;

revoke all on function public.admin_assign_subscription(uuid, uuid, public.billing_cycle, timestamptz)
  from public, anon, authenticated, tenant_app;
grant execute on function public.admin_assign_subscription(uuid, uuid, public.billing_cycle, timestamptz) to service_role;
revoke all on function public.admin_change_subscription_plan(uuid, uuid, boolean)
  from public, anon, authenticated, tenant_app;
grant execute on function public.admin_change_subscription_plan(uuid, uuid, boolean) to service_role;
revoke all on function public.admin_cancel_subscription(uuid, text, boolean)
  from public, anon, authenticated, tenant_app;
grant execute on function public.admin_cancel_subscription(uuid, text, boolean) to service_role;
