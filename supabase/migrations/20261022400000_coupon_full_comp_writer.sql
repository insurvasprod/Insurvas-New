-- A 100%-off-forever coupon redeemed at checkout records the tenant as comped (lib/checkout/fullComp.ts).
--
-- tenant_comps is written only by functions: 20261015530000 revoked insert/update/delete from service_role,
-- so its rows are always written under rules rather than by whoever holds the key. This adds the
-- second writer, with its own rules. It records a comp only when all of these hold:
-- - the coupon is active, percent, 100% and forever;
-- - the tenant is on manual billing;
-- - the tenant has no provider membership, so there is no card to charge;
-- - the tenant has no open comp already (the open-comp unique index also guarantees this).
-- With a comp recorded, the period billing run raises no usage or add-on invoice for the tenant
-- (lib/billing/gather.ts isComped).
--
-- Rollback: drop function public.record_coupon_comp(uuid, uuid).

create or replace function public.record_coupon_comp(p_tenant_id uuid, p_coupon_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  select c.code into v_code
    from public.coupons c
   where c.id = p_coupon_id and c.is_active
     and c.discount_type = 'percent' and c.percent_off = 100 and c.duration = 'forever';
  if v_code is null then
    raise exception using errcode = '22023', message = 'COUPON_NOT_FULL_COMP';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant_id and t.billing_mode = 'manual') then
    raise exception using errcode = '22023', message = 'TENANT_NOT_MANUAL_BILLING';
  end if;
  if exists (select 1 from public.subscriptions s where s.tenant_id = p_tenant_id and s.whop_membership_id is not null and s.status <> 'cancelled') then
    raise exception using errcode = '22023', message = 'TENANT_HAS_PROVIDER_MEMBERSHIP';
  end if;
  if exists (select 1 from public.tenant_comps tc where tc.tenant_id = p_tenant_id and tc.ended_at is null) then
    return false;
  end if;
  insert into public.tenant_comps (tenant_id, reason, created_by)
  values (p_tenant_id, format('Coupon %s: 100%% off forever, redeemed at checkout', v_code), null);
  return true;
end;
$$;

comment on function public.record_coupon_comp(uuid, uuid) is
  'Records a tenant as comped after a 100%-off-forever coupon started its plan at checkout (no provider, manual billing). '
  'False when it is already comped.';

revoke all on function public.record_coupon_comp(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.record_coupon_comp(uuid, uuid) to service_role;

-- Self-check: the table stays function-written only.
do $$
begin
  if to_regprocedure('public.record_coupon_comp(uuid,uuid)') is null then
    raise exception 'record_coupon_comp is missing';
  end if;
  if has_table_privilege('service_role', 'public.tenant_comps', 'INSERT') then
    raise exception 'tenant_comps must stay writable only through its functions';
  end if;
  if has_function_privilege('authenticated', 'public.record_coupon_comp(uuid,uuid)', 'EXECUTE') then
    raise exception 'record_coupon_comp must not be callable by authenticated users';
  end if;
end;
$$;
