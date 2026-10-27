-- Carrier fact reports (owner, 2026-10-27): "Something wrong? Tell us" on Settings › Carriers saves
-- here instead of opening an email, and Insurvas staff work the queue in the admin console
-- (Catalog › Fact reports). Carrier facts are Insurvas's now; an agency reports, staff fix the
-- platform value once for every agency, and the report is closed as fixed or declined.
--
--   carrier_fact_reports    NEW    one row per report; tenant-scoped reads, written by the app
--
-- fact_key names what is wrong: the three carrier columns staff can fix from the queue
-- (portal_origin, reference_pattern, billing_descriptor), or payment_methods / products, which are
-- fixed on the product catalog and then closed by hand.
--
-- Down (only while nothing reads it):
--   drop table public.carrier_fact_reports;
--   drop function public.carrier_fact_reports_platform_carrier();

create table if not exists public.carrier_fact_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  fact_key text not null
    constraint carrier_fact_reports_fact_key check (fact_key in ('portal_origin', 'reference_pattern', 'billing_descriptor', 'payment_methods', 'products')),
  -- What the agency saw when it reported, so staff see the report as it was made.
  shown_value text
    constraint carrier_fact_reports_shown_length check (shown_value is null or char_length(shown_value) <= 1000),
  suggested_value text not null
    constraint carrier_fact_reports_suggested_length check (char_length(btrim(suggested_value)) between 1 and 500),
  evidence text
    constraint carrier_fact_reports_evidence_length check (evidence is null or char_length(evidence) <= 500),
  status text not null default 'open'
    constraint carrier_fact_reports_status check (status in ('open', 'fixed', 'declined')),
  reported_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.admin_users(id) on delete set null,
  resolution_note text
    constraint carrier_fact_reports_note_length check (resolution_note is null or char_length(resolution_note) <= 500),
  -- Open has no outcome; a closed report always says when.
  constraint carrier_fact_reports_resolved_when_closed check ((status = 'open') = (resolved_at is null)),
  -- A declined report tells the agency why.
  constraint carrier_fact_reports_declined_says_why check (status <> 'declined' or char_length(btrim(coalesce(resolution_note, ''))) > 0)
);

-- The staff queue (open first, oldest first) and the agency's own reports per carrier.
create index if not exists carrier_fact_reports_status_idx on public.carrier_fact_reports (status, created_at);
create index if not exists carrier_fact_reports_tenant_carrier_idx on public.carrier_fact_reports (tenant_id, carrier_id, created_at desc);
create index if not exists carrier_fact_reports_carrier_idx on public.carrier_fact_reports (carrier_id);

alter table public.carrier_fact_reports enable row level security;
drop policy if exists carrier_fact_reports_tenant_scoped on public.carrier_fact_reports;
create policy carrier_fact_reports_tenant_scoped on public.carrier_fact_reports
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.carrier_fact_reports to tenant_app;
grant select, insert, update on public.carrier_fact_reports to service_role;
-- The app writes through the service role; a tenant connection only reads its own reports.
revoke insert, update on public.carrier_fact_reports from tenant_app;
-- A report is closed, never erased.
revoke delete, truncate on public.carrier_fact_reports from service_role, tenant_app;

-- A report may only name a platform carrier (organization_id null), never an organization's own row.
create or replace function public.carrier_fact_reports_platform_carrier()
returns trigger language plpgsql as $function$
begin
  if not exists (select 1 from public.carriers c where c.id = new.carrier_id and c.organization_id is null) then
    raise exception 'CARRIER_FACT_REPORT_NOT_PLATFORM: carrier % is not in the platform library', new.carrier_id;
  end if;
  return new;
end;
$function$;

drop trigger if exists carrier_fact_reports_platform_carrier on public.carrier_fact_reports;
create trigger carrier_fact_reports_platform_carrier before insert or update of carrier_id on public.carrier_fact_reports
  for each row execute function public.carrier_fact_reports_platform_carrier();

-- ── checks ──────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.carrier_fact_reports') is null then
    raise exception '20261027200000: carrier_fact_reports is missing';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.carrier_fact_reports'::regclass) then
    raise exception '20261027200000: carrier_fact_reports has no row level security';
  end if;
  if has_table_privilege('service_role', 'public.carrier_fact_reports', 'DELETE') then
    raise exception '20261027200000: carrier fact reports can be deleted';
  end if;
  -- An owner holds every privilege whatever was revoked; the table's owner is never tenant_app live
  -- (only a rolled-back rehearsal, where the rehearsing role owns its copy).
  if (select pg_get_userbyid(relowner) from pg_class where oid = 'public.carrier_fact_reports'::regclass) <> 'tenant_app'
     and (has_table_privilege('tenant_app', 'public.carrier_fact_reports', 'INSERT') or has_table_privilege('tenant_app', 'public.carrier_fact_reports', 'UPDATE')) then
    raise exception '20261027200000: tenant_app can write carrier fact reports directly';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'carrier_fact_reports_resolved_when_closed' and contype = 'c') then
    raise exception '20261027200000: a report can be closed without a time';
  end if;
end $$;
