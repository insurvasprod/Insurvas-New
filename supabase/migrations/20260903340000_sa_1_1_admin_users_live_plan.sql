-- SA-1.1: the Users screen must show the tenant's live subscription plan,
-- not the legacy free-text tenants.plan_code field.

create or replace view public.admin_user_list as
select
  u.id,
  u.name,
  u.email,
  u.phone,
  u.status,
  u.last_login_at,
  u.created_at,
  tu.tenant_id,
  t.name as tenant_name,
  tu.role as tenant_role,
  plan.code as plan_code,
  u.password_hash is not null as has_password,
  u.suspended_at,
  u.suspension_reason,
  (
    select count(distinct le.ip)
    from public.login_events le
    where le.user_id = u.id
      and le.success
      and le.ip is not null
      and le.ts > (now() - '24:00:00'::interval)
  ) as distinct_ips_24h
from public.users u
left join public.tenant_users tu on tu.user_id = u.id
left join public.tenants t on t.id = tu.tenant_id
left join public.subscriptions subscription
  on subscription.tenant_id = tu.tenant_id
  and subscription.status <> 'cancelled'::public.subscription_status
left join public.plans plan on plan.id = subscription.plan_id;
