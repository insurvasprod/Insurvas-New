-- AG-0.7 (Notion sprint, Agency Module 0) · suspend and offboard, with the frozen-balance confirmation.
--
-- Suspend   login blocked, can_submit false, book untouched, seat still consumed. Reversible in one click.
-- Offboard  his policies STAY in the agency book (writer attribution is permanent — nothing is deleted or
--           reassigned); his login ends today; his seat is released at the END OF THE PERIOD (no refund inside a
--           band); his payable balance is FROZEN at the offboarding date, negative included; chargebacks on his
--           policies after today hit the AGENCY, not him (AG-1.5's writer reads offboarded_on).
--           Reversible for 30 days (same producer id); after that a returning producer is a new invite against
--           the same user.
--
-- Login is blocked PER MEMBERSHIP (tenant_users.access_blocked_at), not on the account: one person may belong to
-- two agencies (D7), and suspending him here must not lock him out of the other one. resolveTenantContext
-- reads the column with the membership it already reads.
--
--   agency_offboard_preview  what the owner must see BEFORE confirming: the frozen balance, and the count and
--                     advance-at-risk of his policies still inside the chargeback window. The confirmation
--                     screen is the point of this task.
--
-- Requires 20261018100000 (producer), 20261018140000 (tenant_seats_used agency branch).
--
-- Rollback: drop functions agency_suspend_producer, agency_reactivate_producer, agency_offboard_producer,
--   agency_offboard_preview, producer_payable_balance_cents; alter table public.producer drop column seat_released_on,
--   frozen_balance_cents, reactivatable_until; alter table public.tenant_users drop column access_blocked_at;
--   restore tenant_seats_used from 20261018140000.

alter table public.producer add column if not exists seat_released_on date;
alter table public.producer add column if not exists frozen_balance_cents bigint;
alter table public.producer add column if not exists reactivatable_until date;
alter table public.tenant_users add column if not exists access_blocked_at timestamptz;
-- the block is written only by the functions below
grant update (tenant_id, user_id, role, invited_at, accepted_at, timezone) on public.tenant_users to service_role, authenticated;

-- The producer's payable balance: SUM(amount_cents), no branch, over his ledger (AG-1.5 evolves the ledger;
-- the sum stays the sum). On the reported basis once AG-1.5 adds one; every row until then.
create or replace function public.producer_payable_balance_cents(p_tenant_id uuid, p_user_id uuid, p_as_of date default current_date)
returns bigint
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_sum bigint;
begin
  if exists (select 1 from pg_attribute where attrelid = 'public.producer_ledger_entry'::regclass and attname = 'basis' and not attisdropped) then
    execute 'select coalesce(sum(amount_cents), 0)::bigint from public.producer_ledger_entry where tenant_id = $1 and producer_user_id = $2 and occurred_on <= $3 and basis = ''reported'''
      into v_sum using p_tenant_id, p_user_id, p_as_of;
  else
    select coalesce(sum(e.amount_cents), 0)::bigint into v_sum from public.producer_ledger_entry e
     where e.tenant_id = p_tenant_id and e.producer_user_id = p_user_id and e.occurred_on <= p_as_of;
  end if;
  return v_sum;
end;
$$;
revoke all on function public.producer_payable_balance_cents(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.producer_payable_balance_cents(uuid, uuid, date) to service_role;

-- ─── what the confirmation shows ──────────────────────────────────────────────────────────────────
create or replace function public.agency_offboard_preview(p_tenant_id uuid, p_producer_id uuid)
returns table(
  producer_id uuid, display_name text, user_id uuid, status text,
  balance_cents bigint, policies_in_window integer, advance_at_risk_cents bigint,
  seat_released_on date, reactivatable_until date
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.display_name, p.user_id, p.status,
         public.producer_payable_balance_cents(p.tenant_id, p.user_id, current_date),
         (select count(*)::integer from public.policy_current pc
           where pc.tenant_id = p.tenant_id and pc.agent_user_id = p.user_id and pc.in_clawback_window),
         (select coalesce(sum(pc.unearned_advance_cents), 0)::bigint from public.policy_current pc
           where pc.tenant_id = p.tenant_id and pc.agent_user_id = p.user_id and pc.in_clawback_window),
         coalesce((select (s.current_period_end at time zone 'UTC')::date from public.subscriptions s
                    where s.tenant_id = p.tenant_id and s.status <> 'cancelled' order by s.started_at desc limit 1),
                  (date_trunc('month', current_date) + interval '1 month - 1 day')::date),
         current_date + 30
    from public.producer p
   where p.tenant_id = p_tenant_id and p.id = p_producer_id;
$$;
revoke all on function public.agency_offboard_preview(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agency_offboard_preview(uuid, uuid) to service_role;

-- ─── suspend / reactivate / offboard ──────────────────────────────────────────────────────────────
create or replace function public.agency_suspend_producer(p_tenant_id uuid, p_producer_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_user uuid;
begin
  update public.producer set status = 'suspended', can_submit = false, can_submit_reason = 'Suspended', can_submit_checked_at = now(), updated_at = now()
   where tenant_id = p_tenant_id and id = p_producer_id and status in ('onboarding', 'active')
  returning user_id into v_user;
  if v_user is null then raise exception 'producer_not_suspendable' using errcode = 'P0001'; end if;
  update public.tenant_users set access_blocked_at = now() where tenant_id = p_tenant_id and user_id = v_user;
end;
$$;

create or replace function public.agency_offboard_producer(p_tenant_id uuid, p_producer_id uuid)
returns table(balance_cents bigint, seat_released_on date, reactivatable_until date)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_preview record;
begin
  select * into v_preview from public.agency_offboard_preview(p_tenant_id, p_producer_id);
  if v_preview.producer_id is null then raise exception 'producer_not_found' using errcode = 'P0001'; end if;
  if v_preview.status = 'offboarded' then raise exception 'already_offboarded' using errcode = 'P0001'; end if;
  -- The owner of the agency cannot offboard himself: someone must hold the contracts.
  if exists (select 1 from public.tenant_users tu where tu.tenant_id = p_tenant_id and tu.user_id = v_preview.user_id and tu.role::text = 'owner' and tu.agency_role is null) then
    raise exception 'owner_not_offboardable' using errcode = 'P0001';
  end if;
  update public.producer
     set status = 'offboarded', offboarded_on = current_date, can_submit = false, can_submit_reason = 'Offboarded',
         can_submit_checked_at = now(), frozen_balance_cents = v_preview.balance_cents,
         seat_released_on = v_preview.seat_released_on, reactivatable_until = v_preview.reactivatable_until, updated_at = now()
   where tenant_id = p_tenant_id and id = p_producer_id;
  update public.tenant_users set access_blocked_at = now() where tenant_id = p_tenant_id and user_id = v_preview.user_id;
  return query select v_preview.balance_cents, v_preview.seat_released_on, v_preview.reactivatable_until;
end;
$$;

create or replace function public.agency_reactivate_producer(p_tenant_id uuid, p_producer_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row public.producer%rowtype;
begin
  select * into v_row from public.producer where tenant_id = p_tenant_id and id = p_producer_id for update;
  if v_row.id is null then raise exception 'producer_not_found' using errcode = 'P0001'; end if;
  if v_row.status = 'offboarded' and (v_row.reactivatable_until is null or current_date > v_row.reactivatable_until) then
    raise exception 'reactivation_window_closed' using errcode = 'P0001',
      hint = 'More than 30 days have passed. Invite this person again.';
  end if;
  if v_row.status not in ('suspended', 'offboarded') then raise exception 'producer_not_reactivatable' using errcode = 'P0001'; end if;
  -- Back to work; can_submit stays false until the licence gate (AG-1.10) re-derives it.
  update public.producer
     set status = 'active', offboarded_on = null, seat_released_on = null, reactivatable_until = null,
         frozen_balance_cents = null, can_submit_reason = 'Re-checking licences', updated_at = now()
   where id = p_producer_id;
  update public.tenant_users set access_blocked_at = null where tenant_id = p_tenant_id and user_id = v_row.user_id;
end;
$$;
revoke all on function public.agency_suspend_producer(uuid, uuid), public.agency_offboard_producer(uuid, uuid), public.agency_reactivate_producer(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agency_suspend_producer(uuid, uuid), public.agency_offboard_producer(uuid, uuid), public.agency_reactivate_producer(uuid, uuid) to service_role;

-- ─── seats: an offboarded producer holds his seat to the end of the period ────────────────────────
create or replace function public.tenant_seats_used(p_tenant_id uuid)
returns integer
language sql
stable
set search_path to 'public'
as $$
  select case
    when public.tenant_plan_audience(p_tenant_id) = 'agency' then (
      select count(*)::integer
        from public.tenant_users tu
        join public.users u on u.id = tu.user_id
        left join public.producer p on p.tenant_id = tu.tenant_id and p.user_id = tu.user_id
       where tu.tenant_id = p_tenant_id
         and tu.accepted_at is not null
         and u.status::text in ('active', 'suspended')
         and (coalesce(p.status, 'active') in ('onboarding', 'active', 'suspended')
              or (p.status = 'offboarded' and p.seat_released_on >= current_date))
    )
    else (
      select count(*)::integer
        from public.tenant_users tu
        join public.users u on u.id = tu.user_id
       where tu.tenant_id = p_tenant_id
         and public.user_status_holds_seat(u.status::text)
    )
  end;
$$;

-- ─── self-check ───────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if pg_get_functiondef('public.agency_offboard_producer(uuid, uuid)'::regprocedure) ~* 'delete\s+from\s+public\.(policy|commission)' then
    raise exception 'AG-0.7: offboarding deletes book rows';
  end if;
  if has_column_privilege('service_role', 'public.tenant_users', 'access_blocked_at', 'UPDATE') then
    raise exception 'AG-0.7: service_role can unblock a membership directly';
  end if;
end;
$$;
