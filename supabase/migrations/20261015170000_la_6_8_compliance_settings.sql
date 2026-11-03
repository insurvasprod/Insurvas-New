-- LA-6.8 (Notion sprint, Module 6 — Compliance) · compliance settings: one place for everything LA-6
-- reads. Tenant-level; enforced on the server; every change audited.
--
--   compliance_settings          + who may perform a deletion, who may generate evidence reports,
--                                which gap checks run, which dashboard tiles show, and the monthly
--                                email (on by default) and its recipients. Earlier files added the
--                                gate (6.2), complaint thresholds (6.4), deletion hold and methods
--                                (6.5) and the purge job (6.6).
--   compliance_setting_change    who changed what, from what, to what, and when — for every LA-6
--                                setting, retention rule and complaint deadline. Append-only.
--
-- Platform caps cannot be removed here: the deletion hold floor (3 days, a check constraint in 6.5),
-- the litigator and internal-DNC gate checks (no column exists to switch them off, 6.2), and the
-- never-delete rule for the do-not-call list (a check constraint in 6.6).
--
-- Requires 20261015100000–20261015160000. Additive. Rollback:
--   drop table if exists public.compliance_setting_change;
--   alter table public.compliance_settings drop column if exists deletion_performer_roles, drop column if exists report_roles,
--     drop column if exists report_gap_checks, drop column if exists dashboard_hidden_tiles, drop column if exists dashboard_monthly_email,
--     drop column if exists dashboard_email_recipients;

alter table public.compliance_settings
  add column if not exists deletion_performer_roles text[] not null default array['owner'],
  add column if not exists report_roles text[] not null default array['owner', 'producer'],
  add column if not exists report_gap_checks text[] not null default array['called_after_dnc', 'called_after_complaint', 'calls_without_consent', 'consent_expired_before_call',
                                                                            'outside_legal_hours', 'never_scrubbed', 'transfer_without_verdict', 'disclosure_missing'],
  add column if not exists dashboard_hidden_tiles text[] not null default '{}',
  add column if not exists dashboard_monthly_email boolean not null default true,
  add column if not exists dashboard_email_recipients uuid[] not null default '{}';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'compliance_settings_deletion_performers') then
    -- The tenant admin always may; a producer only if the owner says so. Never a setter or an assistant.
    alter table public.compliance_settings add constraint compliance_settings_deletion_performers
      check ('owner' = any(deletion_performer_roles) and deletion_performer_roles <@ array['owner', 'producer']);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'compliance_settings_report_roles') then
    alter table public.compliance_settings add constraint compliance_settings_report_roles
      check ('owner' = any(report_roles) and report_roles <@ array['owner', 'producer']);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'compliance_settings_gap_checks') then
    alter table public.compliance_settings add constraint compliance_settings_gap_checks
      check (report_gap_checks <@ array['called_after_dnc', 'called_after_complaint', 'calls_without_consent', 'consent_expired_before_call',
                                        'outside_legal_hours', 'never_scrubbed', 'transfer_without_verdict', 'disclosure_missing']);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'compliance_settings_tiles') then
    alter table public.compliance_settings add constraint compliance_settings_tiles
      check (dashboard_hidden_tiles <@ array['consent_coverage', 'campaigns_scrubbed', 'outside_hours', 'dnc_size', 'screened_before_transfer', 'deletions_and_holds']);
  end if;
end $$;

create table if not exists public.compliance_setting_change (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  section text not null,
  setting text not null,
  old_value jsonb,
  new_value jsonb,
  changed_by uuid references public.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  constraint compliance_setting_change_section check (section in ('complaint_deadlines', 'retention_rules', 'purge_job', 'legal_holds', 'deletion_requests', 'transfer_gate', 'evidence_report', 'dashboard'))
);
create index if not exists compliance_setting_change_tenant_idx on public.compliance_setting_change (tenant_id, changed_at desc);
create index if not exists compliance_setting_change_user_idx on public.compliance_setting_change (changed_by) where changed_by is not null;
alter table public.compliance_setting_change enable row level security;
drop policy if exists compliance_setting_change_read on public.compliance_setting_change;
create policy compliance_setting_change_read on public.compliance_setting_change for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.compliance_setting_change from public, anon, authenticated;
revoke update, delete, truncate on public.compliance_setting_change from service_role, tenant_app;
revoke insert on public.compliance_setting_change from tenant_app;
grant select on public.compliance_setting_change to tenant_app;
grant select, insert on public.compliance_setting_change to service_role;

do $$
begin
  if has_table_privilege('service_role', 'public.compliance_setting_change', 'UPDATE') or has_table_privilege('service_role', 'public.compliance_setting_change', 'DELETE') then
    raise exception '20261015170000: the settings audit must not be editable';
  end if;
  begin
    insert into public.compliance_settings (tenant_id, deletion_performer_roles) select id, array['producer'] from public.tenants limit 1;
    raise exception '20261015170000: the tenant admin was removed from who may delete';
  exception when check_violation then null;
  end;
end $$;
