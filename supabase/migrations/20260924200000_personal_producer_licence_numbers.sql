-- Your profile: a person's own producer numbers.
--
-- The account menu's first row is "Your profile · Name, phone, licence numbers". Name and phone
-- already live on `users`. Licence numbers did not exist per person at all: `licenses` holds the
-- AGENCY's licence per state, `agency_profiles.npn` the agency's NPN, and
-- `tenant_user_licensed_states` (20260924110000) only WHICH states a person is licensed in, set by
-- the owner. A National Producer Number and a state licence number belong to the individual
-- producer, so they get a per-person row here.
--
-- Per workspace (tenant_id, user_id) rather than on `users`, because the numbers are recorded for
-- the agency the person produces for, and every read and write in this product is tenant-scoped.
--
-- Additive and idempotent. Until this is applied the profile page shows the numbers as "needs the
-- database update" and the API refuses to save them with a 503; name and phone save regardless.

create table if not exists public.tenant_user_producer_profiles (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  -- NPNs are issued by NIPR as digits only, up to ten.
  npn text check (npn is null or npn ~ '^[0-9]{1,10}$'),
  -- { "AZ": "1234567", "TX": "2345678" } — keyed by two-letter state, values are the number as
  -- the state prints it (letters, digits and dashes, up to 32 characters).
  state_licence_numbers jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id),
  constraint tenant_user_producer_profiles_numbers_object check (jsonb_typeof(state_licence_numbers) = 'object')
);
create index if not exists tenant_user_producer_profiles_user_idx on public.tenant_user_producer_profiles (user_id);

alter table public.tenant_user_producer_profiles enable row level security;
revoke all on public.tenant_user_producer_profiles from anon, authenticated, public;
grant select, insert, update, delete on public.tenant_user_producer_profiles to service_role;
grant select, insert, update on public.tenant_user_producer_profiles to tenant_app;

-- Colleagues in the same workspace can read the numbers (an owner checking a producer's licence is
-- the ordinary case); only the person themselves writes them.
drop policy if exists tenant_user_producer_profiles_read on public.tenant_user_producer_profiles;
create policy tenant_user_producer_profiles_read on public.tenant_user_producer_profiles
  for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy if exists tenant_user_producer_profiles_write_own on public.tenant_user_producer_profiles;
create policy tenant_user_producer_profiles_write_own on public.tenant_user_producer_profiles
  for insert to tenant_app
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and user_id = nullif(current_setting('app.user_id', true), '')::uuid
  );

drop policy if exists tenant_user_producer_profiles_update_own on public.tenant_user_producer_profiles;
create policy tenant_user_producer_profiles_update_own on public.tenant_user_producer_profiles
  for update to tenant_app
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and user_id = nullif(current_setting('app.user_id', true), '')::uuid
  );
