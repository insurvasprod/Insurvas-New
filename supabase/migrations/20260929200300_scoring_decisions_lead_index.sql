-- M2 · the dialer panel's "why this lead" read, indexed.
--
-- getDialerPanel reads the newest tenant_scoring_decisions row for one lead (tenant_id, lead_id,
-- order by served_at desc limit 1). The table had indexes on (tenant_id, served_at) and
-- (tenant_id, work_item_id) only, so a lead that was never served walked every decision of the
-- tenant, and under load (2026-09-29) the read hit the statement timeout and closed the panel.

create index if not exists tenant_scoring_decisions_tenant_lead_served_idx
  on public.tenant_scoring_decisions (tenant_id, lead_id, served_at desc);

do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929200300: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if to_regclass('public.tenant_scoring_decisions_tenant_lead_served_idx') is null then
    raise exception '20260929200300: the lead index was not created';
  end if;
end
$$;
