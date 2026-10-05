-- ---------------------------------------------------------------------------
-- DATA CHANGE, not a migration. Run it by hand in the Supabase SQL editor. It touches one row.
--
-- Resets the unclaimed-SLA ladder of the demo tenant "LA-1.25 Alert Demo"
-- (d6f3950f-0d88-4e66-869f-0de2ea6b396b) to the product defaults: warn 45 s, escalate 2 min,
-- partner notice 5 min, expire 4 h (45 / 120 / 300 / 14400 seconds). User decision (2026-09-25):
-- the readiness pass had found it at 300 / 900 / 1800 / 3600, set on 2026-09-11.
--
-- Read on 2026-09-29 (service role): the row ALREADY holds 45 / 120 / 300 / 14400 (updated
-- 2026-09-25 17:07Z). Run as it is, this file then changes nothing and writes no audit row. It is
-- kept so the reset is recorded and can be re-run if the demo ladder is shortened again.
--
-- Idempotent. Writes tenant_queue_sla_settings (only when a value differs) and one audit_log row
-- when it does. update_tenant_queue_sla_settings is not used because it needs an owner as actor.
-- ---------------------------------------------------------------------------
do $$
declare
  v_tenant constant uuid := 'd6f3950f-0d88-4e66-869f-0de2ea6b396b';
  v_changed integer;
begin
  if not exists (select 1 from public.tenants where id = v_tenant) then
    raise notice 'demo tenant % does not exist; nothing to reset', v_tenant;
    return;
  end if;

  insert into public.tenant_queue_sla_settings
    (tenant_id, warn_after_seconds, escalate_after_seconds, partner_notify_after_seconds, expire_after_seconds, updated_at)
  values (v_tenant, 45, 120, 300, 14400, now())
  on conflict (tenant_id) do update set
    warn_after_seconds = excluded.warn_after_seconds,
    escalate_after_seconds = excluded.escalate_after_seconds,
    partner_notify_after_seconds = excluded.partner_notify_after_seconds,
    expire_after_seconds = excluded.expire_after_seconds,
    updated_at = now()
  where (tenant_queue_sla_settings.warn_after_seconds, tenant_queue_sla_settings.escalate_after_seconds,
         tenant_queue_sla_settings.partner_notify_after_seconds, tenant_queue_sla_settings.expire_after_seconds)
        is distinct from (45, 120, 300, 14400);
  get diagnostics v_changed = row_count;

  if v_changed > 0 then
    insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
    values ('system', null, 'tenant.queue_sla_settings_updated', 'tenant_queue_sla_settings', v_tenant::text,
            jsonb_build_object('warn', 45, 'escalate', 120, 'partner', 300, 'expire', 14400,
                               'reason', 'demo ladder reset to the defaults (data change 2026-09-29)'));
    raise notice 'demo ladder reset to 45 s / 2 min / 5 min / 4 h';
  else
    raise notice 'demo ladder was already 45 s / 2 min / 5 min / 4 h; nothing changed';
  end if;

  -- check
  if not exists (select 1 from public.tenant_queue_sla_settings
                  where tenant_id = v_tenant and warn_after_seconds = 45 and escalate_after_seconds = 120
                    and partner_notify_after_seconds = 300 and expire_after_seconds = 14400) then
    raise exception 'the demo ladder is not 45 / 120 / 300 / 14400 after the reset';
  end if;
end $$;
