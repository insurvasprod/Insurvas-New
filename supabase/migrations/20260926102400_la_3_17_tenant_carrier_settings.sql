-- LA-3.17 / 3.22 — the agency's own facts about a platform carrier, and one portal account per carrier.
--
-- `carriers` rows with organization_id null are the Insurvas library, shared by every tenant: a
-- tenant must never write one. `carriers.organization_id` is the organization-era CRM, not a tenant,
-- so there is no tenant-owned carrier row to use. The agency's portal origin, reference pattern and
-- billing descriptor therefore live here, one row per (tenant, carrier), and every reader prefers
-- this row's non-null value over the platform one (lib/salesSettings/carriers.ts effectiveCarrierFacts).
-- A row with all three null still means "this carrier is on the agency's list" (Settings › Sales ›
-- Carriers and products › Add a carrier).
--
--   tenant_carrier_settings                 NEW    (tenant_id, carrier_id) primary key
--   tenant_carrier_portal_accounts          INDEX  unique (tenant_id, carrier_id): one account per carrier
--
-- Down (only while nothing reads it):
--   drop index public.tenant_carrier_portal_accounts_one_per_carrier;
--   drop table public.tenant_carrier_settings;

-- ── 1 · tenant carrier settings ─────────────────────────────────────────────
create table if not exists public.tenant_carrier_settings (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  portal_origin text
    constraint tenant_carrier_settings_portal_origin_https check (portal_origin is null or portal_origin ~ '^https://[^/]+$'),
  reference_pattern text
    constraint tenant_carrier_settings_reference_pattern_length check (reference_pattern is null or char_length(reference_pattern) between 1 and 200),
  billing_descriptor text
    constraint tenant_carrier_settings_billing_descriptor_length check (billing_descriptor is null or char_length(billing_descriptor) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  primary key (tenant_id, carrier_id)
);
create index if not exists tenant_carrier_settings_carrier_idx on public.tenant_carrier_settings (carrier_id);

alter table public.tenant_carrier_settings enable row level security;
drop policy if exists tenant_carrier_settings_tenant_scoped on public.tenant_carrier_settings;
create policy tenant_carrier_settings_tenant_scoped on public.tenant_carrier_settings
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_carrier_settings to tenant_app;
grant select, insert, update on public.tenant_carrier_settings to service_role;
-- A setting is changed, never erased: the audit row holds what it was before.
revoke delete, truncate on public.tenant_carrier_settings from service_role, tenant_app;

drop trigger if exists tenant_carrier_settings_touch on public.tenant_carrier_settings;
create trigger tenant_carrier_settings_touch before update on public.tenant_carrier_settings
  for each row execute function public.la3_touch_updated_at();

-- A tenant setting may only name a platform carrier (organization_id null), never another
-- organization's private row.
create or replace function public.tenant_carrier_settings_platform_carrier()
returns trigger language plpgsql as $function$
begin
  if not exists (select 1 from public.carriers c where c.id = new.carrier_id and c.organization_id is null) then
    raise exception 'TENANT_CARRIER_NOT_PLATFORM: carrier % is not in the platform library', new.carrier_id;
  end if;
  return new;
end;
$function$;

drop trigger if exists tenant_carrier_settings_platform_carrier on public.tenant_carrier_settings;
create trigger tenant_carrier_settings_platform_carrier before insert or update of carrier_id on public.tenant_carrier_settings
  for each row execute function public.tenant_carrier_settings_platform_carrier();

-- ── 2 · one portal account per carrier (3.22) ───────────────────────────────
create unique index if not exists tenant_carrier_portal_accounts_one_per_carrier
  on public.tenant_carrier_portal_accounts (tenant_id, carrier_id);

-- ── 3 · checks ──────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'tenant_carrier_settings') then
    raise exception '20260926102400: tenant_carrier_settings is missing';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'tenant_carrier_settings'
         and column_name in ('portal_origin', 'reference_pattern', 'billing_descriptor')) <> 3 then
    raise exception '20260926102400: tenant_carrier_settings lacks a carrier fact column';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name in ('tenant_carrier_settings', 'tenant_carrier_portal_accounts')
                and column_name ~* '(pass|secret|token|pin|credential)') then
    raise exception '20260926102400: a carrier settings table has a password, secret, token, PIN or credential column';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_carrier_settings_portal_origin_https' and contype = 'c') then
    raise exception '20260926102400: the tenant portal origin is not constrained to an https origin';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'tenant_carrier_portal_accounts_one_per_carrier') then
    raise exception '20260926102400: more than one portal account per carrier is possible';
  end if;
  if has_table_privilege('service_role', 'public.tenant_carrier_settings', 'DELETE') then
    raise exception '20260926102400: tenant carrier settings can be deleted';
  end if;
end $$;
