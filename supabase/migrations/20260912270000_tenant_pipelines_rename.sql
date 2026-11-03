-- Give this application's runtime pipelines their own tables: tenant_pipelines / tenant_pipeline_stages.
--
-- public.pipelines and public.pipeline_stages belong to the organizations-era CRM, and they are
-- keyed by bigint:
--
--   pipelines.id             bigint      pipeline_stages.id          bigint
--                                        pipeline_stages.pipeline_id bigint
--
-- Every column in this repository that points at them is uuid -- agent_leads, lead_queue, deal_flow
-- and disposition_flows all declare pipeline_id/stage_id uuid. Postgres has no cast from bigint to
-- uuid in either direction, so a stage id read out of the live table can never be stored on a lead.
-- That is not a tuning problem, it is a hard stop: LA-1.4's partner submission calls
-- resolveRuntimeStage and then writes stage.id onto agent_leads, and nothing in the tenant plane has
-- ever had a working pipeline. agent_leads, lead_queue and deal_flow hold zero rows with a
-- pipeline_id today, which is the evidence.
--
-- Following SA-3 (e7c00ee): when a table name collides with the CRM, this application's table is the
-- one that moves. Nothing outside this repository changes. That rule is worth restating because it
-- decides the question even if my reading of the data is wrong -- the two live `pipelines` rows look
-- like orphaned leftovers (no foreign key points at them, and the CRM's own leads.pipeline_id is
-- uuid so it cannot reference them either), but I cannot see the CRM's code, and renaming ours is
-- correct whether or not that table is still in use. Converting their column types would not be.
--
-- 20260902190000 declared these as `create table if not exists public.pipelines`, which silently
-- no-opped against the CRM's table and left the mismatch invisible.
--
-- Scope is deliberately what LA-1.4 needs: the two tables, the default seeding, and the trigger that
-- runs it for a new tenant. The rest of LA-1.9 -- reorder_pipeline_stages, archive_pipeline_stage,
-- move_lead_to_disposition, stage_dispositions -- does not exist in this database at all and is
-- carried forward to LA-1.9 rather than ported blind here. See docs/backlog.md.

create table if not exists public.tenant_pipelines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  partner_type public.partner_type not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, partner_type, name),
  unique (id, tenant_id)
);

create unique index if not exists tenant_pipelines_one_default_per_partner_idx
  on public.tenant_pipelines (tenant_id, partner_type)
  where is_default;

create table if not exists public.tenant_pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.tenant_pipelines(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  position integer not null check (position >= 0),
  stage_type text not null check (stage_type in ('open', 'won', 'lost')),
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pipeline_id, name),
  unique (pipeline_id, id)
);

create unique index if not exists tenant_pipeline_stages_active_position_idx
  on public.tenant_pipeline_stages (pipeline_id, position)
  where not is_archived;

-- Row-level security carried over verbatim from the declaration in 20260902190000, predicates and
-- grants included, so the renamed tables inherit the posture LA-0.2 checks rather than a weaker one
-- invented here. tenant_app reads under app.tenant_id; writes go through the service client.
alter table public.tenant_pipelines enable row level security;
alter table public.tenant_pipeline_stages enable row level security;

drop policy if exists tenant_pipelines_tenant_scoped on public.tenant_pipelines;
create policy tenant_pipelines_tenant_scoped on public.tenant_pipelines for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

drop policy if exists tenant_pipeline_stages_tenant_scoped on public.tenant_pipeline_stages;
create policy tenant_pipeline_stages_tenant_scoped on public.tenant_pipeline_stages for all to tenant_app
  using (exists (select 1 from public.tenant_pipelines p where p.id = pipeline_id and p.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid))
  with check (exists (select 1 from public.tenant_pipelines p where p.id = pipeline_id and p.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid));

revoke all on public.tenant_pipelines, public.tenant_pipeline_stages from anon, authenticated, public;
grant select on public.tenant_pipelines, public.tenant_pipeline_stages to tenant_app;
grant select, insert, update, delete on public.tenant_pipelines, public.tenant_pipeline_stages to service_role;

-- The stage names are the ones legacyStageName() in lib/pipelines/service.ts maps template stage
-- keys onto. They must stay in step with that map or resolveRuntimeStage raises
-- "No starting pipeline stage is configured".
create or replace function public.seed_default_pipelines(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pipeline_row record;
begin
  insert into public.tenant_pipelines (tenant_id, name, partner_type, is_default)
  values
    (p_tenant_id, 'Publisher transfers', 'publisher'::public.partner_type, true),
    (p_tenant_id, 'Marketing leads', 'marketing'::public.partner_type, true),
    (p_tenant_id, 'Affiliate referrals', 'affiliate'::public.partner_type, true)
  on conflict (tenant_id, partner_type, name) do update set is_default = true, updated_at = now();

  for pipeline_row in
    select id, partner_type from public.tenant_pipelines where tenant_id = p_tenant_id and is_default
  loop
    if pipeline_row.partner_type = 'publisher'::public.partner_type then
      insert into public.tenant_pipeline_stages (pipeline_id, name, position, stage_type, color) values
        (pipeline_row.id, 'New Transfer', 0, 'open', '#2563eb'),
        (pipeline_row.id, 'Incomplete Transfer', 1, 'open', '#64748b'),
        (pipeline_row.id, 'Returned to Partner - DQ', 2, 'lost', '#dc2626'),
        (pipeline_row.id, 'Previously Sold', 3, 'lost', '#9333ea'),
        (pipeline_row.id, 'Did Not Qualify', 4, 'lost', '#dc2626'),
        (pipeline_row.id, 'Needs Callback', 5, 'open', '#d97706'),
        (pipeline_row.id, 'Application Withdrawn', 6, 'lost', '#dc2626'),
        (pipeline_row.id, 'Declined Underwriting', 7, 'lost', '#b91c1c'),
        (pipeline_row.id, 'Pending Approval', 8, 'open', '#0891b2'),
        (pipeline_row.id, 'Submitted', 9, 'won', '#16a34a')
      on conflict (pipeline_id, name) do nothing;
    elsif pipeline_row.partner_type = 'marketing'::public.partner_type then
      insert into public.tenant_pipeline_stages (pipeline_id, name, position, stage_type, color) values
        (pipeline_row.id, 'Form Lead', 0, 'open', '#2563eb'),
        (pipeline_row.id, 'Call Lead', 1, 'open', '#0891b2'),
        (pipeline_row.id, 'No Pickup - Needs Connection', 2, 'open', '#64748b'),
        (pipeline_row.id, 'Pickup - Needs Callback', 3, 'open', '#d97706'),
        (pipeline_row.id, 'Qualified - Needs Conversion', 4, 'open', '#7c3aed'),
        (pipeline_row.id, 'Disqualified - Do Not Call', 5, 'lost', '#dc2626'),
        (pipeline_row.id, 'Converted', 6, 'won', '#16a34a')
      on conflict (pipeline_id, name) do nothing;
    else
      insert into public.tenant_pipeline_stages (pipeline_id, name, position, stage_type, color) values
        (pipeline_row.id, 'Referred', 0, 'open', '#2563eb'),
        (pipeline_row.id, 'Contacted', 1, 'open', '#0891b2'),
        (pipeline_row.id, 'Qualified', 2, 'open', '#7c3aed'),
        (pipeline_row.id, 'Submitted', 3, 'won', '#16a34a'),
        (pipeline_row.id, 'Not Interested', 4, 'lost', '#dc2626')
      on conflict (pipeline_id, name) do nothing;
    end if;
  end loop;
end;
$$;

create or replace function public.seed_pipelines_after_tenant_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_default_pipelines(new.id);
  return new;
end;
$$;

-- This trigger was declared in 20260902190000 and is absent from the database, which is why a tenant
-- created today gets no pipelines and every partner submission fails with
-- "No default pipeline is configured for this partner type".
drop trigger if exists tenants_seed_pipelines on public.tenants;
create trigger tenants_seed_pipelines
after insert on public.tenants
for each row execute function public.seed_pipelines_after_tenant_insert();

revoke all on function public.seed_default_pipelines(uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.seed_pipelines_after_tenant_insert() from public, anon, authenticated, tenant_app;
grant execute on function public.seed_default_pipelines(uuid) to service_role;

-- Backfill the tenants that already exist. Idempotent: every insert above has a conflict target.
do $$
declare
  tenant_row record;
begin
  for tenant_row in select id from public.tenants loop
    perform public.seed_default_pipelines(tenant_row.id);
  end loop;
end;
$$;

comment on table public.tenant_pipelines is
  'Runtime pipelines owned by a tenant. Renamed from public.pipelines, which belongs to the organizations-era CRM and is keyed by bigint; see 20260912270000 and SA-3.';
