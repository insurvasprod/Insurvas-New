-- LA-3 steps 16 and 17 — sales settings (LA-3.17) and pipeline sync (LA-3.23).
--
-- docs/la3/SCHEMA-PLAN.md "Step 16" and "Step 17", and docs/la3/STATUS-MODEL.md §6, are the
-- specification. In short:
--
--   tenant_sales_settings          NEW    one row per tenant (Q9: one tenant_<domain>_settings table),
--                                         validated by Zod in lib/salesSettings/schema.ts
--   tenant_application_stage_map   NEW    sync_key → the tenant's own pipeline stage; unmapped moves nothing
--   tenant_lead_stage_events       CHECK  source gains 'application_sync', keeps 'inbound'
--
-- The stage-history CHECK is restated with every current value, 'inbound' included, so this file is
-- right whether it runs before or after 20260925709850 (the same reasoning as 20260926000100).
-- A sync move writes actor_user_id = null and disposition_key = null (Q3).
--
-- Down:
--   restore tenant_lead_stage_events_source_check without 'application_sync' (20260926000100's
--   statement) — only safe while no row has source = 'application_sync';
--   drop table public.tenant_application_stage_map, public.tenant_sales_settings;
--   drop function public.tenant_application_stage_map_same_tenant();

-- ── 1 · sales settings ──────────────────────────────────────────────────────
create table if not exists public.tenant_sales_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);

alter table public.tenant_sales_settings enable row level security;
drop policy if exists tenant_sales_settings_tenant_scoped on public.tenant_sales_settings;
create policy tenant_sales_settings_tenant_scoped on public.tenant_sales_settings
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_sales_settings to tenant_app;
grant select, insert, update on public.tenant_sales_settings to service_role;

drop trigger if exists tenant_sales_settings_touch on public.tenant_sales_settings;
create trigger tenant_sales_settings_touch before update on public.tenant_sales_settings
  for each row execute function public.la3_touch_updated_at();

-- ── 2 · application → pipeline stage map (STATUS-MODEL §6) ──────────────────
create table if not exists public.tenant_application_stage_map (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sync_key text not null
    check (sync_key in ('quoted', 'application_started', 'submitted', 'pending_requirements', 'issued', 'requoting', 'lost')),
  stage_id uuid not null references public.tenant_pipeline_stages(id) on delete cascade,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  primary key (tenant_id, sync_key)
);
create index if not exists tenant_application_stage_map_stage_idx on public.tenant_application_stage_map (stage_id);

alter table public.tenant_application_stage_map enable row level security;
drop policy if exists tenant_application_stage_map_tenant_scoped on public.tenant_application_stage_map;
create policy tenant_application_stage_map_tenant_scoped on public.tenant_application_stage_map
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_application_stage_map to tenant_app;
grant select, insert, update, delete on public.tenant_application_stage_map to service_role;

-- tenant_pipeline_stages has no tenant_id, so the FK alone would let one tenant map another's stage.
create or replace function public.tenant_application_stage_map_same_tenant()
returns trigger language plpgsql as $function$
begin
  if not exists (select 1 from public.tenant_pipeline_stages s
                   join public.tenant_pipelines p on p.id = s.pipeline_id
                  where s.id = new.stage_id and p.tenant_id = new.tenant_id) then
    raise exception 'STAGE_MAP_FOREIGN_STAGE: stage % is not in a pipeline of tenant %', new.stage_id, new.tenant_id;
  end if;
  return new;
end;
$function$;

drop trigger if exists tenant_application_stage_map_same_tenant on public.tenant_application_stage_map;
create trigger tenant_application_stage_map_same_tenant before insert or update on public.tenant_application_stage_map
  for each row execute function public.tenant_application_stage_map_same_tenant();
drop trigger if exists tenant_application_stage_map_touch on public.tenant_application_stage_map;
create trigger tenant_application_stage_map_touch before update on public.tenant_application_stage_map
  for each row execute function public.la3_touch_updated_at();

-- ── 3 · stage history accepts the sync source ───────────────────────────────
alter table public.tenant_lead_stage_events
  drop constraint if exists tenant_lead_stage_events_source_check,
  add constraint tenant_lead_stage_events_source_check
    check (source = any (array['board', 'table', 'list', 'lead_detail', 'owner_fix', 'dialer', 'inbound', 'application_sync'])) not valid;
alter table public.tenant_lead_stage_events validate constraint tenant_lead_stage_events_source_check;

-- ── 4 · checks ──────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_application_stage_map_pkey' and contype = 'p') then
    raise exception '20260926101000: one stage per sync key per tenant is not enforced';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tenant_application_stage_map_same_tenant' and not tgisinternal) then
    raise exception '20260926101000: a tenant can map another tenant''s stage';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_lead_stage_events_source_check'
                  and pg_get_constraintdef(oid) like '%''application_sync''%'
                  and pg_get_constraintdef(oid) like '%''inbound''%'
                  and pg_get_constraintdef(oid) like '%''dialer''%'
                  and pg_get_constraintdef(oid) like '%''owner_fix''%'
                  and convalidated) then
    raise exception '20260926101000: stage history does not accept application_sync alongside inbound, dialer and owner_fix';
  end if;
end $$;
