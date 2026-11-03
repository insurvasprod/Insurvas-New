-- LA-3.18 — who logged the last chase on a carrier requirement.
--
-- The Pending cases board prints "Last chased · 25 Sep · Priya S."; tenant_application_requirements
-- (20260926101100) records when and how often, not who. This adds the one column. "Log a chase"
-- (app/api/app/pending/requirements/[id]/chase) sets chase_count + 1, last_chased_at = now() and
-- last_chased_by = the agent in one update. Until this is applied the route writes the first two and
-- the page shows the date alone.
--
-- Down (only while nothing reads it):
--   alter table public.tenant_application_requirements drop column last_chased_by;

alter table public.tenant_application_requirements
  add column if not exists last_chased_by uuid references public.users(id) on delete set null;

-- A chased-by without a chased-at is a chase nobody can date.
alter table public.tenant_application_requirements
  drop constraint if exists tenant_application_requirements_chased_by_dated,
  add constraint tenant_application_requirements_chased_by_dated
    check (last_chased_by is null or last_chased_at is not null) not valid;
alter table public.tenant_application_requirements validate constraint tenant_application_requirements_chased_by_dated;

create index if not exists tenant_application_requirements_chased_by_idx
  on public.tenant_application_requirements (last_chased_by) where last_chased_by is not null;

-- ── checks ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tenant_application_requirements'
                    and column_name = 'last_chased_by' and data_type = 'uuid') then
    raise exception '20260926102300: tenant_application_requirements.last_chased_by is missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_application_requirements_chased_by_dated' and convalidated) then
    raise exception '20260926102300: a chase can be attributed without a date';
  end if;
end $$;
