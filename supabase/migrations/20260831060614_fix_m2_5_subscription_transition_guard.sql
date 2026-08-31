-- bugs_sa.md M2-5 (P1) · Crafted subscription actions could revive cancelled or suspended access.
--
-- The admin UI hides actions that make no sense, but the server enforced nothing. `resume` was a
-- universal status setter: it wrote `active` over ANY row, so one crafted request restored full
-- entitlement to a cancelled subscription. `pause` could rewrite a cancelled row to paused, and a
-- non-immediate cancel could turn an already-cancelled row into `cancelling`, which grants access
-- until rollover.
--
-- The transition graph now lives in the database, next to the data it protects, and every path
-- goes through it. A hidden button is a courtesy; this is the rule.

create or replace function public.admin_set_subscription_pause_state(
  p_subscription_id uuid,
  p_pause           boolean
)
returns table(subscription_id uuid, status public.subscription_status, previous public.subscription_status)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.subscriptions%rowtype;
  v_next public.subscription_status;
begin
  -- Locked before it is read: two concurrent requests must not both decide from the same "before".
  select * into v_row from public.subscriptions where id = p_subscription_id for update;
  if not found then raise exception 'no such subscription'; end if;

  if p_pause then
    -- Pausing stops collection on something currently being collected. A subscription that is
    -- already over, or already paused, has nothing to pause.
    if v_row.status not in ('trialing', 'active', 'past_due') then
      raise exception 'a % subscription cannot be paused', v_row.status
        using errcode = 'check_violation';
    end if;
    v_next := 'paused';
  else
    -- Resume is NOT a general "make it active". Only a paused subscription can be resumed;
    -- bringing a cancelled or suspended one back is a different act that needs its own decision
    -- and its own audit trail, not a button that happens to write 'active'.
    if v_row.status <> 'paused' then
      raise exception 'only a paused subscription can be resumed (this one is %)', v_row.status
        using errcode = 'check_violation';
    end if;
    v_next := 'active';
  end if;

  update public.subscriptions set status = v_next where id = p_subscription_id;

  return query select p_subscription_id, v_next, v_row.status;
end;
$$;

revoke execute on function public.admin_set_subscription_pause_state(uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_set_subscription_pause_state(uuid, boolean) to service_role;

/**
 * Whether a subscription is in a state that may still be operated on.
 *
 * `cancelled` is terminal. Shared by the plan-change and cancel paths so all three agree about
 * what "already over" means.
 */
create or replace function public.subscription_is_operable(p_status public.subscription_status)
returns boolean
language sql
immutable
as $$ select p_status <> 'cancelled'; $$;
