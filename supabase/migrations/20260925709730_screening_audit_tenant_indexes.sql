-- ---------------------------------------------------------------------------
-- LA-2.3-9 · the screening audit can be read per tenant without a full scan
--
-- /app/tcpa now lists screening_audit (who, when, vendor, raw response, outcome, cached), newest
-- first, by tenant and optionally by number or lead. 20260902160000 declared
-- screening_audit_tenant_ts_idx and screening_audit_phone_idx with `create index if not exists`,
-- but the live table only carries the older organization-plane indexes (organization_id, ts) and
-- (organization_id, lead_id, ts): the tenant ones were never built. Found 2026-09-29: with ~38k
-- rows, `where tenant_id = … order by ts desc limit 25` and the per-number filter both hit the
-- statement timeout while the database was busy.
--
-- Three plain btree indexes on the tenant plane. Additive, read path only. Built without
-- CONCURRENTLY so the file runs as one script in the SQL editor, the table is small (15 MB).
-- ---------------------------------------------------------------------------

set local lock_timeout = '5s';

create index if not exists screening_audit_tenant_ts_idx
  on public.screening_audit (tenant_id, ts desc, id desc);
create index if not exists screening_audit_tenant_phone_ts_idx
  on public.screening_audit (tenant_id, phone_digits, ts desc);
create index if not exists screening_audit_tenant_lead_ts_idx
  on public.screening_audit (tenant_id, lead_id, ts desc) where lead_id is not null;

do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709730: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'screening_audit'
        and indexname in ('screening_audit_tenant_ts_idx', 'screening_audit_tenant_phone_ts_idx', 'screening_audit_tenant_lead_ts_idx')) <> 3 then
    raise exception '20260925709730: a tenant-plane screening_audit index is missing';
  end if;
  raise notice '20260925709730: screening_audit reads by tenant, number and lead are indexed';
end $$;
