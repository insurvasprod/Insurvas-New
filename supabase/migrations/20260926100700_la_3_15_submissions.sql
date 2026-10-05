-- LA-3 step 11 — submission capture (LA-3.15).
--
-- docs/la3/SCHEMA-PLAN.md "Step 11" is the specification. In short:
--
--   tenant_application_submissions  NEW     one row per time submit was pressed; QA verdict and the
--                                           health picture frozen onto it
--   application-confirmations       BUCKET  private; png / jpeg / pdf; 10 MB
--
-- carrier_id is denormalised from the attempt so the duplicate-reference warning is one index probe.
-- The reference may be empty at capture (the attempt then sits on Missing reference); policy_number
-- is filled in later without touching carrier_reference. Nothing deletes a submission.
--
-- The bucket has no storage.objects policy (none exists anywhere in the repo): only the service role
-- reads or writes it, and the app serves short-lived signed URLs after checking the tenant. Objects
-- live at <tenant_id>/<application_id>/<submission_id>.<ext>, which the path CHECK enforces.
--
-- Down (only while no row or object exists):
--   drop table public.tenant_application_submissions;
--   delete from storage.buckets where id = 'application-confirmations';

create table if not exists public.tenant_application_submissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  application_id uuid not null references public.tenant_applications(id) on delete cascade,
  attempt_no integer not null check (attempt_no > 0),
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  carrier_reference text check (carrier_reference is null or char_length(btrim(carrier_reference)) between 1 and 60),
  reference_kind text check (reference_kind is null or reference_kind in ('application_no', 'policy_no')),
  policy_number text check (policy_number is null or char_length(btrim(policy_number)) between 1 and 60),
  submitted_at timestamptz not null default now(),
  submitted_via text not null check (submitted_via in ('extension', 'copy_assist', 'carrier_portal_manual')),
  confirmation_path text,
  qa_verdict jsonb not null check (jsonb_typeof(qa_verdict) = 'object'),
  health_snapshot jsonb not null check (jsonb_typeof(health_snapshot) = 'object'),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_application_submissions_reference_kind check (carrier_reference is null or reference_kind is not null),
  constraint tenant_application_submissions_confirmation_path check (
    confirmation_path is null
    or (starts_with(confirmation_path, tenant_id::text || '/' || application_id::text || '/' || id::text || '.')
        and confirmation_path ~ '\.(png|jpe?g|pdf)$')
  )
);
-- The duplicate-reference warning: same carrier, same reference, anywhere in the tenant.
create index if not exists tenant_application_submissions_reference_idx
  on public.tenant_application_submissions (tenant_id, carrier_id, carrier_reference) where carrier_reference is not null;
create index if not exists tenant_application_submissions_app_idx
  on public.tenant_application_submissions (application_id, submitted_at desc);
create index if not exists tenant_application_submissions_carrier_idx
  on public.tenant_application_submissions (carrier_id);
-- Missing reference list.
create index if not exists tenant_application_submissions_missing_ref_idx
  on public.tenant_application_submissions (tenant_id, submitted_at desc) where carrier_reference is null;

alter table public.tenant_application_submissions enable row level security;
drop policy if exists tenant_application_submissions_tenant_scoped on public.tenant_application_submissions;
create policy tenant_application_submissions_tenant_scoped on public.tenant_application_submissions
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_application_submissions to tenant_app;
grant select, insert, update on public.tenant_application_submissions to service_role;
-- Default privileges would otherwise leave DELETE with service_role, anon and authenticated.
revoke delete, truncate on public.tenant_application_submissions from service_role, tenant_app, anon, authenticated;

drop trigger if exists tenant_application_submissions_touch on public.tenant_application_submissions;
create trigger tenant_application_submissions_touch before update on public.tenant_application_submissions
  for each row execute function public.la3_touch_updated_at();

-- ── storage ─────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'application-confirmations',
  'application-confirmations',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'application/pdf']::text[]
)
on conflict (id) do nothing;

-- ── checks ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'tenant_application_submissions_reference_idx') then
    raise exception '20260926100700: the duplicate carrier reference lookup has no index';
  end if;
  if has_table_privilege('service_role', 'public.tenant_application_submissions', 'DELETE') then
    raise exception '20260926100700: submissions can be deleted';
  end if;
  if not exists (select 1 from storage.buckets where id = 'application-confirmations' and public = false) then
    raise exception '20260926100700: the application-confirmations bucket is missing or public';
  end if;
end $$;
