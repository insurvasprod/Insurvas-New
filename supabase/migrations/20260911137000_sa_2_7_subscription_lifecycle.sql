-- SA-2.7 · Assign, change & cancel a subscription
--
-- `admin_assign_subscription` landed with SA-2.8, because SA-2.8's own acceptance test could not
-- run without it. This adds the other three: change plan, cancel, pause/resume.
--
-- The state machine is not invented here — it is already stated in availableActions() in
-- lib/subscriptions/access.ts, and the error strings are already parsed by
-- app/api/admin/subscriptions/[id]/route.ts:
--
--   change plan   plan_archived | plan_not_found | cycle_not_offered
--   cancel        subscription_state_not_cancellable
--   pause/resume  check_violation (23514) with a message the route shows verbatim
--
--   canChangePlan  status <> 'cancelled'
--   canPause       status in ('active','trialing')
--   canResume      status = 'paused'
--   canCancel      status <> 'cancelled'
--
-- Return shapes are equally fixed: the route reads `applied_now` and `effective_at` from the plan
-- change, and `cancelled_now` and `effective_at` from the cancel.

-- --------------------------------------------------------------------------
-- Change plan — now, or queued to the period boundary
-- --------------------------------------------------------------------------

create or replace function public.admin_change_subscription_plan(
  p_subscription_id uuid,
  p_new_plan_id     uuid,
  p_apply_now       boolean default true
)
returns table (applied_now boolean, effective_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sub      public.subscriptions%rowtype;
  v_plan     public.plans%rowtype;
  v_price    public.plan_prices%rowtype;
  v_offered  boolean;
  v_boundary timestamptz;
begin
  select * into v_sub from public.subscriptions where id = p_subscription_id for update;
  if v_sub.id is null then
    raise exception 'subscription_not_found' using errcode = 'foreign_key_violation';
  end if;
  if v_sub.status = 'cancelled' then
    raise exception 'subscription_state_not_cancellable' using errcode = 'check_violation';
  end if;

  select * into v_plan from public.plans where id = p_new_plan_id;
  if v_plan.id is null then
    raise exception 'plan_not_found' using errcode = 'check_violation';
  end if;
  if v_plan.is_archived then
    -- Archived plans keep working for existing subscribers but are not available to move onto.
    raise exception 'plan_archived' using errcode = 'check_violation';
  end if;

  -- The target plan must actually be sold on this subscription's cycle. SA-2.4: "a plan with only
  -- price_monthly set offers only monthly at checkout" — the same has to be true of a plan change,
  -- or a tenant ends up on a cycle with no price.
  select * into v_price from public.plan_prices where plan_id = p_new_plan_id;
  v_offered := case v_sub.billing_cycle
    when 'monthly'   then v_price.price_monthly_cents is not null
    when 'quarterly' then v_price.price_quarterly_cents is not null
    when 'yearly'    then v_price.price_yearly_cents is not null
  end;
  if v_price.plan_id is null or not coalesce(v_offered, false) then
    raise exception 'cycle_not_offered' using errcode = 'check_violation';
  end if;

  v_boundary := coalesce(v_sub.current_period_end, v_sub.current_period_start);

  if p_apply_now then
    update public.subscriptions
       set plan_id         = p_new_plan_id,
           pending_plan_id = null
     where id = p_subscription_id;

    -- The caller rebuilds the entitlement and settles proration; doing it here as well would
    -- double-count. See the route: it only rebuilds when applied_now is true.
    return query select true, now();
  else
    -- A queued change takes effect exactly at the boundary. Nothing about the entitlement changes
    -- until then — rebuilding now would revoke access the tenant has already paid for.
    update public.subscriptions
       set pending_plan_id = p_new_plan_id
     where id = p_subscription_id;

    return query select false, v_boundary;
  end if;
end;
$$;

comment on function public.admin_change_subscription_plan(uuid, uuid, boolean) is
  'SA-2.7 · Moves a subscription onto another plan version now, or queues it to the period '
  'boundary. Refuses an archived plan and a cycle the target plan does not price.';

-- --------------------------------------------------------------------------
-- Cancel — immediately, or at the end of the paid term
-- --------------------------------------------------------------------------

create or replace function public.admin_cancel_subscription(
  p_subscription_id uuid,
  p_reason          text default null,
  p_immediate       boolean default false
)
returns table (cancelled_now boolean, effective_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sub      public.subscriptions%rowtype;
  v_boundary timestamptz;
begin
  select * into v_sub from public.subscriptions where id = p_subscription_id for update;
  if v_sub.id is null then
    raise exception 'subscription_not_found' using errcode = 'foreign_key_violation';
  end if;
  if v_sub.status = 'cancelled' then
    raise exception 'subscription_state_not_cancellable' using errcode = 'check_violation';
  end if;

  v_boundary := coalesce(v_sub.current_period_end, now());

  if p_immediate then
    update public.subscriptions
       set status               = 'cancelled',
           cancel_at_period_end = false,
           cancel_reason        = p_reason,
           cancelled_at         = now()
     where id = p_subscription_id;

    return query select true, now();
  else
    -- 'cancelling' still resolves to FULL access in entitlement_access_for_status: the term is
    -- paid for, so the tenant keeps everything until it expires. Suspend the doing only when the
    -- money stops, not when the intention is announced.
    update public.subscriptions
       set status               = 'cancelling',
           cancel_at_period_end = true,
           cancel_reason        = p_reason
     where id = p_subscription_id;

    return query select false, v_boundary;
  end if;
end;
$$;

comment on function public.admin_cancel_subscription(uuid, text, boolean) is
  'SA-2.7 · Immediate cancellation ends access now; the default cancels at the period boundary '
  'and leaves full access until then, because the term is already paid.';

-- --------------------------------------------------------------------------
-- Pause / resume
-- --------------------------------------------------------------------------

create or replace function public.admin_set_subscription_pause_state(
  p_subscription_id uuid,
  p_pause           boolean
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sub public.subscriptions%rowtype;
begin
  select * into v_sub from public.subscriptions where id = p_subscription_id for update;
  if v_sub.id is null then
    raise exception 'subscription_not_found' using errcode = 'foreign_key_violation';
  end if;

  if p_pause then
    -- Mirrors availableActions().canPause. The message is shown to the admin verbatim, so it has
    -- to read as an explanation rather than an error code.
    if v_sub.status not in ('active', 'trialing') then
      raise exception 'A % subscription cannot be paused', v_sub.status using errcode = 'check_violation';
    end if;
    update public.subscriptions set status = 'paused' where id = p_subscription_id;
  else
    -- Mirrors availableActions().canResume.
    if v_sub.status <> 'paused' then
      raise exception 'Only a paused subscription can be resumed' using errcode = 'check_violation';
    end if;
    update public.subscriptions set status = 'active' where id = p_subscription_id;
  end if;

  -- Pausing drops the tenant to read_only, so the cached entitlement must not lag. The route
  -- rebuilds too; this makes the invariant hold even for a direct database call.
  perform public.refresh_tenant_entitlement(v_sub.tenant_id);
end;
$$;

comment on function public.admin_set_subscription_pause_state(uuid, boolean) is
  'SA-2.7 · Pause from active or trialing only; resume from paused only. Paused is read_only, '
  'never a loss of read access to the tenant''s own book of business.';

-- --------------------------------------------------------------------------
-- Access
-- --------------------------------------------------------------------------

revoke all on function public.admin_change_subscription_plan(uuid, uuid, boolean)
  from public, anon, authenticated, tenant_app;
revoke all on function public.admin_cancel_subscription(uuid, text, boolean)
  from public, anon, authenticated, tenant_app;
revoke all on function public.admin_set_subscription_pause_state(uuid, boolean)
  from public, anon, authenticated, tenant_app;
grant execute on function public.admin_change_subscription_plan(uuid, uuid, boolean) to service_role;
grant execute on function public.admin_cancel_subscription(uuid, text, boolean) to service_role;
grant execute on function public.admin_set_subscription_pause_state(uuid, boolean) to service_role;
