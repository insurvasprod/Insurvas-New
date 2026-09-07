-- LA-0.5 · Appointment, licence, E&O and continuing-education vault.
-- These records are tenant-owned. The application resolves tenant and role from the session;
-- service-role-only RPCs keep the bulk grid and the one-row settings writes atomic.

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  state text not null check (state ~ '^[A-Z]{2}$'),
  status text not null default 'active' check (status in ('active', 'terminated')),
  effective_from date not null,
  terminated_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_dates_valid check (terminated_at is null or terminated_at >= effective_from),
  constraint appointments_unique_effective_start unique (tenant_id, carrier_id, state, effective_from)
);

create table if not exists public.licenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  state text not null check (state ~ '^[A-Z]{2}$'),
  license_number text not null check (char_length(btrim(license_number)) between 1 and 120),
  expires_at date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint licenses_unique_state unique (tenant_id, state)
);

create table if not exists public.eo_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier text not null check (char_length(btrim(carrier)) between 1 and 160),
  policy_number text not null check (char_length(btrim(policy_number)) between 1 and 120),
  expires_at date not null,
  coverage_amount_cents bigint not null check (coverage_amount_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint eo_policies_unique_policy unique (tenant_id, policy_number)
);

create table if not exists public.ce_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  state text not null check (state ~ '^[A-Z]{2}$'),
  credits_required integer not null check (credits_required between 0 and 10000),
  credits_completed integer not null check (credits_completed between 0 and 10000),
  deadline date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ce_records_unique_state unique (tenant_id, state)
);

create index if not exists appointments_tenant_lookup_idx on public.appointments (tenant_id, carrier_id, state, effective_from desc);
create index if not exists licenses_expiry_idx on public.licenses (tenant_id, expires_at);
create index if not exists eo_policies_expiry_idx on public.eo_policies (tenant_id, expires_at);
create index if not exists ce_records_expiry_idx on public.ce_records (tenant_id, deadline);

alter table public.appointments enable row level security;
alter table public.licenses enable row level security;
alter table public.eo_policies enable row level security;
alter table public.ce_records enable row level security;

revoke all on public.appointments, public.licenses, public.eo_policies, public.ce_records from anon, authenticated, public;
grant select, insert, update, delete on public.appointments, public.licenses, public.eo_policies, public.ce_records to service_role;

create or replace function public.touch_appointment_vault_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists appointments_touch_updated_at on public.appointments;
create trigger appointments_touch_updated_at before update on public.appointments for each row execute function public.touch_appointment_vault_updated_at();
drop trigger if exists licenses_touch_updated_at on public.licenses;
create trigger licenses_touch_updated_at before update on public.licenses for each row execute function public.touch_appointment_vault_updated_at();
drop trigger if exists eo_policies_touch_updated_at on public.eo_policies;
create trigger eo_policies_touch_updated_at before update on public.eo_policies for each row execute function public.touch_appointment_vault_updated_at();
drop trigger if exists ce_records_touch_updated_at on public.ce_records;
create trigger ce_records_touch_updated_at before update on public.ce_records for each row execute function public.touch_appointment_vault_updated_at();

create or replace function public.save_appointments(p_tenant_id uuid, p_rows jsonb)
returns setof public.appointments
language plpgsql security invoker as $$
begin
  if p_tenant_id is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 500 then
    raise exception 'invalid_appointment_batch' using errcode = '22023';
  end if;

  return query
  insert into public.appointments (tenant_id, carrier_id, state, status, effective_from, terminated_at)
  select p_tenant_id, item.carrier_id, upper(item.state), item.status, item.effective_from, item.terminated_at
    from jsonb_to_recordset(p_rows) as item(carrier_id uuid, state text, status text, effective_from date, terminated_at date)
  on conflict (tenant_id, carrier_id, state, effective_from)
  do update set status = excluded.status, terminated_at = excluded.terminated_at
  returning *;
end;
$$;

create or replace function public.save_license(p_tenant_id uuid, p_state text, p_license_number text, p_expires_at date)
returns public.licenses
language plpgsql security invoker as $$
declare result public.licenses;
begin
  insert into public.licenses (tenant_id, state, license_number, expires_at)
  values (p_tenant_id, upper(btrim(p_state)), btrim(p_license_number), p_expires_at)
  on conflict (tenant_id, state)
  do update set license_number = excluded.license_number, expires_at = excluded.expires_at
  returning * into result;
  return result;
end;
$$;

create or replace function public.save_eo_policy(p_tenant_id uuid, p_carrier text, p_policy_number text, p_expires_at date, p_coverage_amount_cents bigint)
returns public.eo_policies
language plpgsql security invoker as $$
declare result public.eo_policies;
begin
  insert into public.eo_policies (tenant_id, carrier, policy_number, expires_at, coverage_amount_cents)
  values (p_tenant_id, btrim(p_carrier), btrim(p_policy_number), p_expires_at, p_coverage_amount_cents)
  on conflict (tenant_id, policy_number)
  do update set carrier = excluded.carrier, expires_at = excluded.expires_at, coverage_amount_cents = excluded.coverage_amount_cents
  returning * into result;
  return result;
end;
$$;

create or replace function public.save_ce_record(p_tenant_id uuid, p_state text, p_credits_required integer, p_credits_completed integer, p_deadline date)
returns public.ce_records
language plpgsql security invoker as $$
declare result public.ce_records;
begin
  insert into public.ce_records (tenant_id, state, credits_required, credits_completed, deadline)
  values (p_tenant_id, upper(btrim(p_state)), p_credits_required, p_credits_completed, p_deadline)
  on conflict (tenant_id, state)
  do update set credits_required = excluded.credits_required, credits_completed = excluded.credits_completed, deadline = excluded.deadline
  returning * into result;
  return result;
end;
$$;

revoke execute on function public.save_appointments(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_appointments(uuid, jsonb) to service_role;
revoke execute on function public.save_license(uuid, text, text, date) from public, anon, authenticated;
grant execute on function public.save_license(uuid, text, text, date) to service_role;
revoke execute on function public.save_eo_policy(uuid, text, text, date, bigint) from public, anon, authenticated;
grant execute on function public.save_eo_policy(uuid, text, text, date, bigint) to service_role;
revoke execute on function public.save_ce_record(uuid, text, integer, integer, date) from public, anon, authenticated;
grant execute on function public.save_ce_record(uuid, text, integer, integer, date) to service_role;
