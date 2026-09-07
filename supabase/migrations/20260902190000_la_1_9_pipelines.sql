-- LA-1.9: tenant-owned pipelines and canonical lead stage references.
-- Template stages remain the immutable form-definition contract. Runtime pipeline stages are
-- independent so a tenant can configure different pipelines for publisher, marketing, and affiliate
-- partners without copying one menu per plan or leaking one tenant's configuration to another.

create table if not exists public.pipelines (
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

create unique index if not exists pipelines_one_default_per_partner_idx
  on public.pipelines (tenant_id, partner_type)
  where is_default;

create table if not exists public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
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

create unique index if not exists pipeline_stages_active_position_idx
  on public.pipeline_stages (pipeline_id, position)
  where not is_archived;

create table if not exists public.stage_dispositions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  stage_id uuid not null references public.pipeline_stages(id) on delete restrict,
  disposition_key text not null check (disposition_key ~ '^[a-z][a-z0-9_]{1,79}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, disposition_key),
  unique (tenant_id, stage_id)
);

alter table public.agent_leads add column if not exists pipeline_id uuid;
alter table public.agent_leads add column if not exists stage_id uuid;
alter table public.lead_queue add column if not exists pipeline_id uuid;
alter table public.lead_queue add column if not exists stage_id uuid;
alter table public.deal_flow add column if not exists pipeline_id uuid;
alter table public.deal_flow add column if not exists stage_id uuid;

create or replace function public.seed_default_pipelines(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pipeline_row record;
begin
  insert into public.pipelines (tenant_id, name, partner_type, is_default)
  values
    (p_tenant_id, 'Publisher transfers', 'publisher'::public.partner_type, true),
    (p_tenant_id, 'Marketing leads', 'marketing'::public.partner_type, true),
    (p_tenant_id, 'Affiliate referrals', 'affiliate'::public.partner_type, true)
  on conflict (tenant_id, partner_type, name) do update set is_default = true, updated_at = now();

  for pipeline_row in
    select id, partner_type from public.pipelines where tenant_id = p_tenant_id and is_default
  loop
    if pipeline_row.partner_type = 'publisher'::public.partner_type then
      insert into public.pipeline_stages (pipeline_id, name, position, stage_type, color) values
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
      insert into public.pipeline_stages (pipeline_id, name, position, stage_type, color) values
        (pipeline_row.id, 'Form Lead', 0, 'open', '#2563eb'),
        (pipeline_row.id, 'Call Lead', 1, 'open', '#0891b2'),
        (pipeline_row.id, 'No Pickup - Needs Connection', 2, 'open', '#64748b'),
        (pipeline_row.id, 'Pickup - Needs Callback', 3, 'open', '#d97706'),
        (pipeline_row.id, 'Qualified - Needs Conversion', 4, 'open', '#7c3aed'),
        (pipeline_row.id, 'Disqualified - Do Not Call', 5, 'lost', '#dc2626'),
        (pipeline_row.id, 'Converted', 6, 'won', '#16a34a')
      on conflict (pipeline_id, name) do nothing;
    else
      insert into public.pipeline_stages (pipeline_id, name, position, stage_type, color) values
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

drop trigger if exists tenants_seed_pipelines on public.tenants;
create trigger tenants_seed_pipelines
after insert on public.tenants
for each row execute function public.seed_pipelines_after_tenant_insert();

do $$
declare
  tenant_row record;
begin
  for tenant_row in select id from public.tenants loop
    perform public.seed_default_pipelines(tenant_row.id);
  end loop;
end;
$$;

-- Convert the old template stage text to the nearest seeded runtime stage. A non-standard custom
-- stage is retained as a runtime stage, so existing leads remain readable after the cutover.
do $$
declare
  lead_row record;
  pipeline_uuid uuid;
  stage_uuid uuid;
  partner_kind public.partner_type;
  stage_label text;
  stage_position integer;
  has_legacy_stage_key boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'agent_leads' and column_name = 'stage_key'
  ) into has_legacy_stage_key;
  if not has_legacy_stage_key then
    return;
  end if;

  for lead_row in execute 'select id, tenant_id, partner_id, stage_key from public.agent_leads' loop
    select p.partner_type into partner_kind
    from public.partners p where p.id = lead_row.partner_id and p.tenant_id = lead_row.tenant_id;
    partner_kind := coalesce(partner_kind, 'marketing'::public.partner_type);
    select id into pipeline_uuid from public.pipelines
      where tenant_id = lead_row.tenant_id and partner_type = partner_kind and is_default limit 1;
    stage_label := case lower(lead_row.stage_key)
      when 'new' then case partner_kind when 'publisher'::public.partner_type then 'New Transfer' when 'affiliate'::public.partner_type then 'Referred' else 'Form Lead' end
      when 'contacted' then case partner_kind when 'publisher'::public.partner_type then 'Incomplete Transfer' when 'affiliate'::public.partner_type then 'Contacted' else 'Call Lead' end
      when 'quoted' then case partner_kind when 'affiliate'::public.partner_type then 'Qualified' else 'Qualified - Needs Conversion' end
      when 'application_sent' then case partner_kind when 'publisher'::public.partner_type then 'Pending Approval' when 'affiliate'::public.partner_type then 'Submitted' else 'Converted' end
      when 'submitted' then 'Submitted'
      when 'issued' then case partner_kind when 'publisher'::public.partner_type then 'Submitted' when 'affiliate'::public.partner_type then 'Submitted' else 'Converted' end
      when 'lost' then case partner_kind when 'publisher'::public.partner_type then 'Did Not Qualify' when 'affiliate'::public.partner_type then 'Not Interested' else 'Disqualified - Do Not Call' end
      else initcap(replace(lead_row.stage_key, '_', ' '))
    end;
    select id into stage_uuid from public.pipeline_stages where pipeline_id = pipeline_uuid and name = stage_label;
    if stage_uuid is null then
      select coalesce(max(position), -1) + 1 into stage_position from public.pipeline_stages where pipeline_id = pipeline_uuid and not is_archived;
      insert into public.pipeline_stages (pipeline_id, name, position, stage_type, color)
      values (pipeline_uuid, left(stage_label, 120), stage_position, 'open', '#64748b') returning id into stage_uuid;
    end if;
    update public.agent_leads set pipeline_id = pipeline_uuid, stage_id = stage_uuid where id = lead_row.id;
  end loop;

  update public.lead_queue q
    set pipeline_id = l.pipeline_id, stage_id = l.stage_id
  from public.agent_leads l where l.id = q.lead_id;
  update public.deal_flow d
    set pipeline_id = l.pipeline_id, stage_id = l.stage_id
  from public.agent_leads l where l.id = d.lead_id;
end;
$$;

alter table public.agent_leads drop constraint if exists agent_leads_pipeline_stage_fk;
alter table public.agent_leads add constraint agent_leads_pipeline_stage_fk
  foreign key (pipeline_id, stage_id) references public.pipeline_stages (pipeline_id, id) on delete restrict;
alter table public.lead_queue drop constraint if exists lead_queue_pipeline_stage_fk;
alter table public.lead_queue add constraint lead_queue_pipeline_stage_fk
  foreign key (pipeline_id, stage_id) references public.pipeline_stages (pipeline_id, id) on delete restrict;
alter table public.deal_flow drop constraint if exists deal_flow_pipeline_stage_fk;
alter table public.deal_flow add constraint deal_flow_pipeline_stage_fk
  foreign key (pipeline_id, stage_id) references public.pipeline_stages (pipeline_id, id) on delete restrict;

alter table public.agent_leads alter column pipeline_id set not null;
alter table public.agent_leads alter column stage_id set not null;
alter table public.lead_queue alter column pipeline_id set not null;
alter table public.lead_queue alter column stage_id set not null;
alter table public.deal_flow alter column pipeline_id set not null;
alter table public.deal_flow alter column stage_id set not null;

alter table public.agent_leads drop column if exists stage_key;
alter table public.lead_queue drop column if exists stage_key;
alter table public.deal_flow drop column if exists stage_key;

drop index if exists public.agent_leads_tenant_template_idx;
create index if not exists agent_leads_tenant_pipeline_stage_idx
  on public.agent_leads (tenant_id, pipeline_id, stage_id, created_at desc);
create index if not exists pipeline_stages_pipeline_position_idx
  on public.pipeline_stages (pipeline_id, position) where not is_archived;

create or replace function public.reorder_pipeline_stages(
  p_tenant_id uuid,
  p_pipeline_id uuid,
  p_stage_ids uuid[]
)
returns setof public.pipeline_stages
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_count integer;
begin
  if not exists (select 1 from public.pipelines where id = p_pipeline_id and tenant_id = p_tenant_id) then
    raise exception 'pipeline_not_found';
  end if;
  select count(*) into expected_count from public.pipeline_stages where pipeline_id = p_pipeline_id and not is_archived;
  if coalesce(array_length(p_stage_ids, 1), 0) <> expected_count
    or (select count(*) from unnest(p_stage_ids) as ids(id)) <> expected_count
    or exists (
      select 1 from public.pipeline_stages s
      where s.pipeline_id = p_pipeline_id and not s.is_archived
        and not (s.id = any(p_stage_ids))
    ) then
    raise exception 'stage_set_mismatch';
  end if;
  perform 1 from public.pipeline_stages where pipeline_id = p_pipeline_id for update;
  update public.pipeline_stages set position = position + 1000000, updated_at = now()
    where pipeline_id = p_pipeline_id and not is_archived;
  update public.pipeline_stages s set position = u.position - 1, updated_at = now()
  from unnest(p_stage_ids) with ordinality as u(id, position)
  where s.id = u.id and s.pipeline_id = p_pipeline_id;
  return query select * from public.pipeline_stages where pipeline_id = p_pipeline_id order by is_archived, position, created_at;
end;
$$;

create or replace function public.archive_pipeline_stage(p_tenant_id uuid, p_stage_id uuid)
returns public.pipeline_stages
language plpgsql
security definer
set search_path = public
as $$
declare
  stage_row public.pipeline_stages;
  active_count integer;
begin
  select s.* into stage_row from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id
    where s.id = p_stage_id and p.tenant_id = p_tenant_id for update;
  if stage_row.id is null then raise exception 'stage_not_found'; end if;
  select count(*) into active_count from public.pipeline_stages where pipeline_id = stage_row.pipeline_id and not is_archived;
  if not stage_row.is_archived and active_count <= 1 then raise exception 'pipeline_requires_stage'; end if;
  update public.pipeline_stages set is_archived = true, updated_at = now() where id = p_stage_id returning * into stage_row;
  with ranked as (
    select id, row_number() over (order by position, created_at) - 1 as new_position
    from public.pipeline_stages where pipeline_id = stage_row.pipeline_id and not is_archived
  )
  update public.pipeline_stages s set position = ranked.new_position, updated_at = now()
  from ranked where ranked.id = s.id;
  return stage_row;
end;
$$;

insert into public.stage_dispositions (tenant_id, stage_id, disposition_key)
select p.tenant_id, s.id, mapping.disposition_key
from public.pipelines p
join public.pipeline_stages s on s.pipeline_id = p.id
join (values
  ('publisher'::public.partner_type, 'New Transfer', 'new_transfer'),
  ('publisher'::public.partner_type, 'Needs Callback', 'needs_callback'),
  ('publisher'::public.partner_type, 'Did Not Qualify', 'did_not_qualify'),
  ('publisher'::public.partner_type, 'Submitted', 'submitted'),
  ('marketing'::public.partner_type, 'Form Lead', 'form_lead'),
  ('marketing'::public.partner_type, 'Call Lead', 'call_lead'),
  ('marketing'::public.partner_type, 'Pickup - Needs Callback', 'needs_callback'),
  ('marketing'::public.partner_type, 'Converted', 'converted'),
  ('affiliate'::public.partner_type, 'Referred', 'referred'),
  ('affiliate'::public.partner_type, 'Contacted', 'contacted'),
  ('affiliate'::public.partner_type, 'Qualified', 'qualified'),
  ('affiliate'::public.partner_type, 'Submitted', 'submitted'),
  ('affiliate'::public.partner_type, 'Not Interested', 'not_interested')
) as mapping(partner_type, stage_name, disposition_key)
  on mapping.partner_type = p.partner_type and mapping.stage_name = s.name
where p.is_default and not s.is_archived
on conflict (tenant_id, disposition_key) do nothing;

alter table public.pipelines enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.stage_dispositions enable row level security;

drop policy if exists pipelines_tenant_scoped on public.pipelines;
create policy pipelines_tenant_scoped on public.pipelines for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists pipeline_stages_tenant_scoped on public.pipeline_stages;
create policy pipeline_stages_tenant_scoped on public.pipeline_stages for all to tenant_app
  using (exists (select 1 from public.pipelines p where p.id = pipeline_id and p.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid))
  with check (exists (select 1 from public.pipelines p where p.id = pipeline_id and p.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid));
drop policy if exists stage_dispositions_tenant_scoped on public.stage_dispositions;
create policy stage_dispositions_tenant_scoped on public.stage_dispositions for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.pipelines, public.pipeline_stages, public.stage_dispositions from anon, authenticated, public;
grant select on public.pipelines, public.pipeline_stages, public.stage_dispositions to tenant_app;
grant select, insert, update, delete on public.pipelines, public.pipeline_stages, public.stage_dispositions to service_role;
revoke all on function public.seed_default_pipelines(uuid), public.seed_pipelines_after_tenant_insert(), public.reorder_pipeline_stages(uuid, uuid, uuid[]), public.archive_pipeline_stage(uuid, uuid) from public;
grant execute on function public.reorder_pipeline_stages(uuid, uuid, uuid[]), public.archive_pipeline_stage(uuid, uuid) to service_role;

drop trigger if exists pipelines_touch_updated_at on public.pipelines;
create trigger pipelines_touch_updated_at before update on public.pipelines for each row execute function public.touch_agent_template_updated_at();
drop trigger if exists pipeline_stages_touch_updated_at on public.pipeline_stages;
create trigger pipeline_stages_touch_updated_at before update on public.pipeline_stages for each row execute function public.touch_agent_template_updated_at();
drop trigger if exists stage_dispositions_touch_updated_at on public.stage_dispositions;
create trigger stage_dispositions_touch_updated_at before update on public.stage_dispositions for each row execute function public.touch_agent_template_updated_at();
