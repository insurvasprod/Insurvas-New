-- LA-1.4: tenant-owned dynamic lead/application forms.
-- Keep the existing tenant template tables as the current-copy compatibility layer, but store
-- every published tenant definition in an immutable revision so in-flight drafts never move.

alter table public.template_fields drop constraint if exists template_fields_type_check;
alter table public.template_fields add constraint template_fields_type_check
  check (type in ('text','long_text','number','currency','date','phone','email','ssn','boolean','single_select','multi_select'));
alter table public.template_fields add column if not exists help_text text;
alter table public.template_fields add column if not exists validation jsonb not null default '{}'::jsonb;
alter table public.template_fields add constraint template_fields_validation_object_check
  check (jsonb_typeof(validation) = 'object');

alter table public.tenant_template_fields drop constraint if exists tenant_template_fields_type_check;
alter table public.tenant_template_fields add constraint tenant_template_fields_type_check
  check (type in ('text','long_text','number','currency','date','phone','email','ssn','boolean','single_select','multi_select'));
alter table public.tenant_template_fields add column if not exists help_text text;
alter table public.tenant_template_fields add column if not exists validation jsonb not null default '{}'::jsonb;
alter table public.tenant_template_fields add constraint tenant_template_fields_validation_object_check
  check (jsonb_typeof(validation) = 'object');

alter table public.tenant_templates add column if not exists definition_version integer not null default 1;
alter table public.tenant_templates add constraint tenant_templates_definition_version_check
  check (definition_version > 0);
alter table public.agent_leads add column if not exists definition_version integer not null default 1;
alter table public.agent_leads add constraint agent_leads_definition_version_check
  check (definition_version > 0);
create index if not exists agent_leads_definition_version_idx
  on public.agent_leads (tenant_id, tenant_template_id, definition_version);

create table if not exists public.tenant_template_revisions (
  tenant_template_id uuid not null references public.tenant_templates(id) on delete cascade,
  revision integer not null check (revision > 0),
  name text not null check (length(trim(name)) between 1 and 120),
  description text,
  fields jsonb not null check (jsonb_typeof(fields) = 'array'),
  stages jsonb not null check (jsonb_typeof(stages) = 'array'),
  form_definition jsonb not null check (jsonb_typeof(form_definition) = 'object'),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (tenant_template_id, revision)
);

insert into public.tenant_template_revisions (
  tenant_template_id, revision, name, description, fields, stages, form_definition, created_by
)
select
  tt.id,
  1,
  tt.name,
  tt.description,
  coalesce((select jsonb_agg(jsonb_build_object(
    'field_key', f.field_key, 'label', f.label, 'type', f.type,
    'is_required', f.is_required, 'options', f.options, 'sort_order', f.sort_order,
    'help_text', f.help_text, 'validation', f.validation
  ) order by f.sort_order) from public.tenant_template_fields f where f.tenant_template_id = tt.id), '[]'::jsonb),
  coalesce((select jsonb_agg(jsonb_build_object(
    'stage_key', s.stage_key, 'label', s.label, 'stage_type', s.stage_type,
    'color', s.color, 'sort_order', s.sort_order
  ) order by s.sort_order) from public.tenant_template_stages s where s.tenant_template_id = tt.id), '[]'::jsonb),
  coalesce((select form_definition from public.tenant_template_forms tf where tf.tenant_template_id = tt.id), '{"sections":[]}'::jsonb),
  tt.applied_by
from public.tenant_templates tt
on conflict (tenant_template_id, revision) do nothing;

create index if not exists tenant_template_revisions_lookup_idx
  on public.tenant_template_revisions (tenant_template_id, revision desc);

create table if not exists public.form_drafts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  partner_id uuid references public.partners(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  product_code text not null references public.products(code) on delete restrict,
  tenant_template_id uuid not null references public.tenant_templates(id) on delete cascade,
  definition_version integer not null check (definition_version > 0),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.form_drafts add column if not exists owner_key uuid
  generated always as (coalesce(partner_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored;
create unique index if not exists form_drafts_owner_product_idx
  on public.form_drafts (tenant_id, user_id, product_code, owner_key);
create index if not exists form_drafts_tenant_updated_idx
  on public.form_drafts (tenant_id, updated_at desc);

create or replace function public.touch_form_draft_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists form_drafts_touch_updated_at on public.form_drafts;
create trigger form_drafts_touch_updated_at before update on public.form_drafts
for each row execute function public.touch_form_draft_updated_at();

alter table public.tenant_template_revisions enable row level security;
alter table public.form_drafts enable row level security;

drop policy if exists tenant_template_revisions_scoped on public.tenant_template_revisions;
create policy tenant_template_revisions_scoped on public.tenant_template_revisions
  for all to public
  using (tenant_template_id in (select id from public.tenant_templates))
  with check (tenant_template_id in (select id from public.tenant_templates));

drop policy if exists form_drafts_scoped on public.form_drafts;
create policy form_drafts_scoped on public.form_drafts
  for all to public
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

revoke all on table public.tenant_template_revisions, public.form_drafts from anon, authenticated;
grant select, insert, update, delete on table public.tenant_template_revisions, public.form_drafts to service_role;

-- Keep the platform source capable of carrying the same field contract. Existing callers remain
-- valid because the extra JSON properties are optional.
create or replace function public.admin_save_template(
  p_template_id uuid, p_name text, p_product_code text, p_description text, p_is_active boolean,
  p_fields jsonb, p_stages jsonb, p_form_definition jsonb, p_created_by uuid default null
)
returns table(template_id uuid, version integer)
language plpgsql security definer set search_path = public
as $$
declare next_version integer; new_template_id uuid;
begin
  if p_template_id is null then
    next_version := 1;
    insert into public.templates (name, product_code, version, description, is_active, created_by)
    values (p_name, p_product_code, next_version, nullif(p_description, ''), coalesce(p_is_active, true), p_created_by)
    returning id into new_template_id;
    template_id := new_template_id;
  else
    select t.version into next_version from public.templates t where t.id = p_template_id for update;
    if not found then raise exception 'template_not_found'; end if;
    next_version := next_version + 1; new_template_id := p_template_id; template_id := p_template_id;
    update public.templates set name = p_name, product_code = p_product_code,
      version = next_version, description = nullif(p_description, '') where id = p_template_id;
  end if;

  insert into public.template_fields (template_id, version, field_key, label, type, is_required, options, sort_order, help_text, validation)
  select new_template_id, next_version, field_key, label, type, coalesce(is_required, false), coalesce(options, '[]'::jsonb), sort_order, help_text, coalesce(validation, '{}'::jsonb)
  from jsonb_to_recordset(coalesce(p_fields, '[]'::jsonb)) as f(field_key text, label text, type text, is_required boolean, options jsonb, sort_order integer, help_text text, validation jsonb);
  insert into public.template_stages (template_id, version, stage_key, label, stage_type, color, sort_order)
  select new_template_id, next_version, stage_key, label, stage_type, color, sort_order
  from jsonb_to_recordset(coalesce(p_stages, '[]'::jsonb)) as s(stage_key text, label text, stage_type text, color text, sort_order integer);
  insert into public.template_forms (template_id, version, form_definition)
  values (new_template_id, next_version, coalesce(p_form_definition, '{"sections":[]}'::jsonb));
  version := next_version; return next;
end;
$$;

create or replace function public.admin_duplicate_template(p_template_id uuid, p_name text, p_created_by uuid default null)
returns table(template_id uuid, version integer)
language plpgsql security definer set search_path = public
as $$
declare source_row public.templates%rowtype; new_template_id uuid;
begin
  select * into source_row from public.templates where id = p_template_id;
  if not found then raise exception 'template_not_found'; end if;
  insert into public.templates (name, product_code, version, description, is_active, created_by)
  values (p_name, source_row.product_code, 1, source_row.description, true, coalesce(p_created_by, source_row.created_by)) returning id into new_template_id;
  insert into public.template_fields (template_id, version, field_key, label, type, is_required, options, sort_order, help_text, validation)
  select new_template_id, 1, f.field_key, f.label, f.type, f.is_required, f.options, f.sort_order, f.help_text, f.validation from public.template_fields f where f.template_id = p_template_id and f.version = source_row.version;
  insert into public.template_stages (template_id, version, stage_key, label, stage_type, color, sort_order)
  select new_template_id, 1, stage_key, label, stage_type, color, sort_order from public.template_stages where template_id = p_template_id and version = source_row.version;
  insert into public.template_forms (template_id, version, form_definition)
  select new_template_id, 1, form_definition from public.template_forms where template_id = p_template_id and version = source_row.version;
  template_id := new_template_id; version := 1; return next;
end;
$$;

create or replace function public.admin_apply_tenant_template(
  p_tenant_id uuid, p_template_id uuid, p_template_version integer, p_product_code text,
  p_name text, p_description text, p_applied_by uuid, p_fields jsonb, p_stages jsonb, p_form_definition jsonb
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare copy_id uuid; next_definition_version integer;
begin
  insert into public.tenant_templates (tenant_id, template_id, template_version, product_code, name, description, applied_at, applied_by)
  values (p_tenant_id, p_template_id, p_template_version, p_product_code, p_name, p_description, now(), p_applied_by)
  on conflict (tenant_id, product_code) do update set template_id = excluded.template_id,
    template_version = excluded.template_version, applied_at = excluded.applied_at, applied_by = excluded.applied_by,
    definition_version = public.tenant_templates.definition_version + 1
  returning id, definition_version into copy_id, next_definition_version;

  insert into public.tenant_template_fields (tenant_template_id, field_key, label, type, is_required, options, sort_order, help_text, validation)
  select copy_id, field_key, label, type, is_required, options, sort_order, help_text, coalesce(validation, '{}'::jsonb)
  from jsonb_to_recordset(coalesce(p_fields, '[]'::jsonb)) as f(field_key text, label text, type text, is_required boolean, options jsonb, sort_order integer, help_text text, validation jsonb)
  on conflict (tenant_template_id, field_key) do update set label = excluded.label, type = excluded.type,
    is_required = excluded.is_required, options = excluded.options, sort_order = excluded.sort_order,
    help_text = excluded.help_text, validation = excluded.validation;
  insert into public.tenant_template_stages (tenant_template_id, stage_key, label, stage_type, color, sort_order)
  select copy_id, stage_key, label, stage_type, color, sort_order from jsonb_to_recordset(coalesce(p_stages, '[]'::jsonb)) as s(stage_key text, label text, stage_type text, color text, sort_order integer)
  on conflict (tenant_template_id, stage_key) do update set label = excluded.label, stage_type = excluded.stage_type, color = excluded.color, sort_order = excluded.sort_order;
  insert into public.tenant_template_forms (tenant_template_id, form_definition) values (copy_id, coalesce(p_form_definition, '{"sections":[]}'::jsonb))
  on conflict (tenant_template_id) do update set form_definition = excluded.form_definition;
  insert into public.tenant_template_revisions (tenant_template_id, revision, name, description, fields, stages, form_definition, created_by)
  values (copy_id, next_definition_version, p_name, p_description, coalesce(p_fields, '[]'::jsonb), coalesce(p_stages, '[]'::jsonb), coalesce(p_form_definition, '{"sections":[]}'::jsonb), p_applied_by)
  on conflict (tenant_template_id, revision) do update set name = excluded.name, description = excluded.description, fields = excluded.fields, stages = excluded.stages, form_definition = excluded.form_definition, created_by = excluded.created_by;
  return copy_id;
end;
$$;

create or replace function public.admin_update_tenant_template(
  p_tenant_template_id uuid, p_tenant_id uuid, p_name text, p_description text,
  p_fields jsonb, p_stages jsonb, p_form_definition jsonb
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare next_definition_version integer; current_product text; applied_by_user uuid;
begin
  select definition_version + 1, product_code, applied_by into next_definition_version, current_product, applied_by_user
  from public.tenant_templates where id = p_tenant_template_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'tenant_template_not_found'; end if;
  update public.tenant_templates set name = p_name, description = p_description, definition_version = next_definition_version where id = p_tenant_template_id;

  delete from public.tenant_template_fields where tenant_template_id = p_tenant_template_id and field_key not in (select field_key from jsonb_to_recordset(coalesce(p_fields, '[]'::jsonb)) as f(field_key text));
  insert into public.tenant_template_fields (tenant_template_id, field_key, label, type, is_required, options, sort_order, help_text, validation)
  select p_tenant_template_id, field_key, label, type, is_required, options, sort_order, help_text, coalesce(validation, '{}'::jsonb)
  from jsonb_to_recordset(coalesce(p_fields, '[]'::jsonb)) as f(field_key text, label text, type text, is_required boolean, options jsonb, sort_order integer, help_text text, validation jsonb)
  on conflict (tenant_template_id, field_key) do update set label = excluded.label, type = excluded.type, is_required = excluded.is_required, options = excluded.options, sort_order = excluded.sort_order, help_text = excluded.help_text, validation = excluded.validation;
  delete from public.tenant_template_stages where tenant_template_id = p_tenant_template_id and stage_key not in (select stage_key from jsonb_to_recordset(coalesce(p_stages, '[]'::jsonb)) as s(stage_key text));
  insert into public.tenant_template_stages (tenant_template_id, stage_key, label, stage_type, color, sort_order)
  select p_tenant_template_id, stage_key, label, stage_type, color, sort_order from jsonb_to_recordset(coalesce(p_stages, '[]'::jsonb)) as s(stage_key text, label text, stage_type text, color text, sort_order integer)
  on conflict (tenant_template_id, stage_key) do update set label = excluded.label, stage_type = excluded.stage_type, color = excluded.color, sort_order = excluded.sort_order;
  insert into public.tenant_template_forms (tenant_template_id, form_definition) values (p_tenant_template_id, coalesce(p_form_definition, '{"sections":[]}'::jsonb)) on conflict (tenant_template_id) do update set form_definition = excluded.form_definition;
  insert into public.tenant_template_revisions (tenant_template_id, revision, name, description, fields, stages, form_definition, created_by)
  values (p_tenant_template_id, next_definition_version, p_name, p_description, coalesce(p_fields, '[]'::jsonb), coalesce(p_stages, '[]'::jsonb), coalesce(p_form_definition, '{"sections":[]}'::jsonb), applied_by_user);
  return p_tenant_template_id;
end;
$$;

revoke all on function public.touch_form_draft_updated_at() from public;

create or replace function public.save_form_draft(
  p_tenant_id uuid, p_partner_id uuid, p_user_id uuid, p_product_code text,
  p_tenant_template_id uuid, p_definition_version integer, p_payload jsonb
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare draft_id uuid;
begin
  insert into public.form_drafts (tenant_id, partner_id, user_id, product_code, tenant_template_id, definition_version, payload)
  values (p_tenant_id, p_partner_id, p_user_id, p_product_code, p_tenant_template_id, p_definition_version, p_payload)
  on conflict (tenant_id, user_id, product_code, owner_key) do update set
    tenant_template_id = excluded.tenant_template_id,
    definition_version = excluded.definition_version,
    payload = excluded.payload,
    updated_at = now()
  returning id into draft_id;
  return draft_id;
end;
$$;
revoke all on function public.save_form_draft(uuid,uuid,uuid,text,uuid,integer,jsonb) from public;
grant execute on function public.save_form_draft(uuid,uuid,uuid,text,uuid,integer,jsonb) to service_role;
