-- LA-4.4: Book of Business › Discrepancies (what a carrier owes).
--
-- One row per finding of lib/discrepancies/compute.ts, keyed by its fingerprint (kind · policy ·
-- period), so recomputing updates the row instead of adding another. A person works each one:
--
--   open        found, nobody has acted yet
--   disputed    a dispute letter went to the carrier
--   resolved    the carrier paid it
--   written_off the agent decided not to pursue it
--   cleared     the facts behind it changed (a statement was voided, a line accepted, the policy
--               updated) and it no longer applies. Set by the refresh, never by a person.
--
-- A refresh reopens a cleared finding that applies again, keeps open and disputed ones current,
-- and never touches resolved or written-off ones: what a person decided stays decided. Rows are
-- never deleted.
--
-- Additive. Requires 20260924260000 (statements) and 20260831110000 (policies and carriers).
--
-- Down: drop table if exists public.tenant_commission_discrepancies;

create table if not exists public.tenant_commission_discrepancies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  fingerprint text not null,
  kind text not null,
  policy_id uuid not null references public.tenant_policies(id) on delete restrict,
  carrier_id uuid references public.carriers(id) on delete restrict,
  period_start date,
  period_end date,
  owed_cents bigint not null,
  detail jsonb not null default '{}'::jsonb,
  status text not null default 'open',
  note text,
  status_changed_by uuid references public.users(id) on delete set null,
  status_changed_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint tenant_commission_discrepancies_fingerprint unique (tenant_id, fingerprint),
  constraint tenant_commission_discrepancies_kind check (kind in ('never_paid', 'short_paid', 'mis_rated', 'duplicate_chargeback', 'unexpected_chargeback')),
  constraint tenant_commission_discrepancies_status check (status in ('open', 'disputed', 'resolved', 'written_off', 'cleared')),
  constraint tenant_commission_discrepancies_owed check (owed_cents >= 0),
  constraint tenant_commission_discrepancies_detail check (jsonb_typeof(detail) = 'object'),
  constraint tenant_commission_discrepancies_fingerprint_len check (char_length(fingerprint) between 3 and 2000),
  constraint tenant_commission_discrepancies_note check (note is null or char_length(note) <= 1000)
);

create index if not exists tenant_commission_discrepancies_tenant_status_idx
  on public.tenant_commission_discrepancies (tenant_id, status);
create index if not exists tenant_commission_discrepancies_policy_idx
  on public.tenant_commission_discrepancies (policy_id);
create index if not exists tenant_commission_discrepancies_carrier_idx
  on public.tenant_commission_discrepancies (carrier_id);
create index if not exists tenant_commission_discrepancies_changed_by_idx
  on public.tenant_commission_discrepancies (status_changed_by);

-- A finding's identity is fixed; what changes is its figures (on refresh) and its status.
create or replace function public.guard_commission_discrepancy()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.tenant_id <> old.tenant_id or new.fingerprint <> old.fingerprint or new.kind <> old.kind or new.policy_id <> old.policy_id then
    raise exception 'A discrepancy''s identity cannot change' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists tenant_commission_discrepancies_guard on public.tenant_commission_discrepancies;
create trigger tenant_commission_discrepancies_guard
  before update on public.tenant_commission_discrepancies
  for each row execute function public.guard_commission_discrepancy();

alter table public.tenant_commission_discrepancies enable row level security;
drop policy if exists tenant_commission_discrepancies_tenant_read on public.tenant_commission_discrepancies;
create policy tenant_commission_discrepancies_tenant_read on public.tenant_commission_discrepancies
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_commission_discrepancies from public, anon, authenticated;
revoke delete, truncate on public.tenant_commission_discrepancies from service_role, tenant_app;
grant select, insert, update on public.tenant_commission_discrepancies to service_role;
grant select on public.tenant_commission_discrepancies to tenant_app;

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'tenant_commission_discrepancies') then
    raise exception '20261002110000: tenant_commission_discrepancies is missing';
  end if;
  if has_table_privilege('service_role', 'public.tenant_commission_discrepancies', 'DELETE') then
    raise exception '20261002110000: discrepancies can be deleted';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'tenant_commission_discrepancies' and policyname = 'tenant_commission_discrepancies_tenant_read') then
    raise exception '20261002110000: the tenant read policy is missing';
  end if;
end $$;
