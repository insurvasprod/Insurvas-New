-- Settings › Agency profile: the agency's legal identity, with every change kept.
--
-- The board asks for a legal entity name, a DBA, the NPN (and when it was verified against NIPR),
-- the federal tax ID, a principal address and a workspace timezone. Only a business name and an
-- NPN existed, on business_profiles — and that table is the signup questionnaire, with six NOT NULL
-- onboarding answers a tenant created by an admin never gave. So the legal record gets its own
-- table rather than a row that could not be inserted for half the tenants.
--
-- The tax ID never reaches this table in the clear: the API encrypts it (AES-256-GCM, key from the
-- server environment) and stores the ciphertext plus the last four digits for display.
--
-- "Changing it is effective-dated, not retroactive": every save writes a dated row to
-- agency_profile_history. Earlier versions are never rewritten.
--
-- Additive and idempotent. Writes go through the service role after the API has checked the
-- caller is an owner, the same arrangement as the carrier library.

create table if not exists public.agency_profiles (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  legal_name text not null check (length(trim(legal_name)) between 1 and 200),
  dba text check (dba is null or length(dba) <= 200),
  npn text check (npn is null or npn ~ '^[0-9]{1,10}$'),
  -- Set only by a real NIPR check. There is no NIPR integration yet, so nothing sets it today.
  npn_verified_at timestamptz,
  tax_id_ciphertext text,
  tax_id_last4 text check (tax_id_last4 is null or tax_id_last4 ~ '^[0-9]{4}$'),
  principal_address text check (principal_address is null or length(principal_address) <= 300),
  timezone text check (timezone is null or length(timezone) between 1 and 64),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);

create table if not exists public.agency_profile_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  effective_from timestamptz not null default now(),
  changed_by uuid references public.users(id) on delete set null,
  legal_name text not null,
  dba text,
  npn text,
  tax_id_last4 text,
  tax_id_changed boolean not null default false,
  principal_address text,
  timezone text
);

create index if not exists agency_profile_history_tenant_idx
  on public.agency_profile_history (tenant_id, effective_from desc);
create index if not exists agency_profiles_updated_by_idx on public.agency_profiles (updated_by);
create index if not exists agency_profile_history_changed_by_idx on public.agency_profile_history (changed_by);

alter table public.agency_profiles enable row level security;
alter table public.agency_profile_history enable row level security;

revoke all on table public.agency_profiles, public.agency_profile_history from public, anon, authenticated;
grant select, insert, update, delete on table public.agency_profiles, public.agency_profile_history to service_role;

-- The same tenant-scoped read backstop the carrier tables carry (LA-0 hardening).
drop policy if exists agency_profiles_read on public.agency_profiles;
create policy agency_profiles_read on public.agency_profiles
  for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
drop policy if exists agency_profile_history_read on public.agency_profile_history;
create policy agency_profile_history_read on public.agency_profile_history
  for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select on public.agency_profiles, public.agency_profile_history to tenant_app;

-- One save = the current row plus its history row, atomically. p_tax_id_change distinguishes
-- "leave the stored tax ID alone" from "clear it" (both arrive as a null ciphertext otherwise).
-- A changed NPN drops the verification stamp: it vouched for the old number, not the new one.
create or replace function public.save_agency_profile(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_legal_name text,
  p_dba text,
  p_npn text,
  p_tax_id_change boolean,
  p_tax_id_ciphertext text,
  p_tax_id_last4 text,
  p_principal_address text,
  p_timezone text
)
returns public.agency_profiles
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.agency_profiles;
begin
  insert into public.agency_profiles as ap
    (tenant_id, legal_name, dba, npn, npn_verified_at, tax_id_ciphertext, tax_id_last4, principal_address, timezone, updated_at, updated_by)
  values
    (p_tenant_id, trim(p_legal_name), nullif(trim(p_dba), ''), nullif(trim(p_npn), ''), null,
     case when p_tax_id_change then p_tax_id_ciphertext else null end,
     case when p_tax_id_change then p_tax_id_last4 else null end,
     nullif(trim(p_principal_address), ''), nullif(trim(p_timezone), ''), now(), p_actor_id)
  on conflict (tenant_id) do update set
    legal_name = excluded.legal_name,
    dba = excluded.dba,
    npn = excluded.npn,
    npn_verified_at = case when ap.npn is not distinct from excluded.npn then ap.npn_verified_at else null end,
    tax_id_ciphertext = case when p_tax_id_change then excluded.tax_id_ciphertext else ap.tax_id_ciphertext end,
    tax_id_last4 = case when p_tax_id_change then excluded.tax_id_last4 else ap.tax_id_last4 end,
    principal_address = excluded.principal_address,
    timezone = excluded.timezone,
    updated_at = now(),
    updated_by = excluded.updated_by
  returning * into v_row;

  insert into public.agency_profile_history
    (tenant_id, changed_by, legal_name, dba, npn, tax_id_last4, tax_id_changed, principal_address, timezone)
  values
    (p_tenant_id, p_actor_id, v_row.legal_name, v_row.dba, v_row.npn, v_row.tax_id_last4, coalesce(p_tax_id_change, false), v_row.principal_address, v_row.timezone);

  return v_row;
end;
$$;

revoke all on function public.save_agency_profile(uuid, uuid, text, text, text, boolean, text, text, text, text) from public, anon, authenticated;
grant execute on function public.save_agency_profile(uuid, uuid, text, text, text, boolean, text, text, text, text) to service_role;
