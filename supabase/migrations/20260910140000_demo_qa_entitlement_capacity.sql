-- Keep the explicitly provisioned demo tenant usable for owner/team QA.
-- This is intentionally scoped by the demo agent identity and tenant label; production tenants
-- retain the normal default buffer-seat limit.
update public.tenant_entitlements e
set entitlement = jsonb_set(
  e.entitlement,
  '{limits,max_buffer_seats}',
  to_jsonb(greatest(
    coalesce((e.entitlement -> 'limits' ->> 'max_buffer_seats')::integer, 0),
    coalesce((select count(*)::integer
      from public.tenant_users tu
      where tu.tenant_id = e.tenant_id and tu.role = 'assistant'), 0),
    25
  )),
  true
),
computed_at = now(),
version = e.version + 1
where e.tenant_id in (
  select tu.tenant_id
  from public.tenant_users tu
  join public.users u on u.id = tu.user_id
  join public.tenants t on t.id = tu.tenant_id
  where lower(u.email) = 'demo.agent@insurvas.test'
    and t.name = 'LA-1.25 Alert Demo'
);
