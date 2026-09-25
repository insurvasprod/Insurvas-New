-- /app/appointments: carrier-specific trainings.
--
-- The board's Continuing education card counts "Carrier-specific · 2 outstanding", and its Readiness
-- card lists trainings coming due. Carriers require their own product and AML trainings before an
-- agent may sell for them, separate from the state's CE hours, and nothing recorded them, so the
-- count would have been invented. One row per training an owner records against a carrier; it is
-- outstanding until completed_on is set.
--
-- Same arrangement as tenant_carrier_requirements (20260924220100): written by the service role
-- after the API has checked the caller is an owner with full access; the tenant plane may read its
-- own tenant's rows. Additive and idempotent.

create table if not exists public.tenant_carrier_training (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete cascade,
  title text not null,
  due_on date not null,
  completed_on date,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  constraint tenant_carrier_training_title_length check (char_length(btrim(title)) between 1 and 160)
);
create index if not exists tenant_carrier_training_tenant_due_idx on public.tenant_carrier_training (tenant_id, due_on);
create index if not exists tenant_carrier_training_carrier_idx on public.tenant_carrier_training (carrier_id);
create index if not exists tenant_carrier_training_updated_by_idx on public.tenant_carrier_training (updated_by);

alter table public.tenant_carrier_training enable row level security;
revoke all on public.tenant_carrier_training from public, anon, authenticated;
grant select, insert, update, delete on public.tenant_carrier_training to service_role;
grant select on public.tenant_carrier_training to tenant_app;
drop policy if exists tenant_carrier_training_read on public.tenant_carrier_training;
create policy tenant_carrier_training_read on public.tenant_carrier_training
  for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- ── asserted against whatever this database holds ─────────────────────────
do $$
begin
  if to_regclass('public.tenant_carrier_training') is null then
    raise exception 'tenant_carrier_training is missing';
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'tenant_carrier_training' and c.relrowsecurity
  ) then
    raise exception 'tenant_carrier_training has row level security switched off';
  end if;
  if has_table_privilege('tenant_app', 'public.tenant_carrier_training', 'insert')
     or has_table_privilege('tenant_app', 'public.tenant_carrier_training', 'update')
     or has_table_privilege('tenant_app', 'public.tenant_carrier_training', 'delete') then
    raise exception 'the tenant plane can write carrier trainings';
  end if;
  if not has_table_privilege('tenant_app', 'public.tenant_carrier_training', 'select') then
    raise exception 'the tenant plane cannot read carrier trainings';
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'tenant_carrier_training' and policyname = 'tenant_carrier_training_read'
  ) then
    raise exception 'tenant_carrier_training_read policy is missing';
  end if;
end $$;
