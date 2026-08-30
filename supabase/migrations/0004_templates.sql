-- SA-4.6 platform templates. A template has one stable id and immutable content versions.
-- Child rows are keyed by (template, version), so an edit can never rewrite an agent's old view.
create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  product_code text not null references public.products(code) on delete restrict,
  version integer not null default 1 check (version > 0),
  description text,
  is_active boolean not null default true,
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.template_fields (
  template_id uuid not null references public.templates(id) on delete restrict,
  version integer not null check (version > 0),
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]*$'),
  label text not null check (length(trim(label)) between 1 and 120),
  type text not null check (type in ('text','number','date','currency','phone','boolean','single_select','multi_select')),
  is_required boolean not null default false,
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  sort_order integer not null default 0 check (sort_order >= 0),
  primary key (template_id, version, field_key)
);

create table if not exists public.template_stages (
  template_id uuid not null references public.templates(id) on delete restrict,
  version integer not null check (version > 0),
  stage_key text not null check (stage_key ~ '^[a-z][a-z0-9_]*$'),
  label text not null check (length(trim(label)) between 1 and 120),
  stage_type text not null check (stage_type in ('open','won','lost')),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order integer not null default 0 check (sort_order >= 0),
  primary key (template_id, version, stage_key)
);

create table if not exists public.template_forms (
  template_id uuid not null references public.templates(id) on delete restrict,
  version integer not null check (version > 0),
  form_definition jsonb not null check (jsonb_typeof(form_definition) = 'object'),
  primary key (template_id, version)
);

create index if not exists templates_product_active_idx on public.templates(product_code, is_active);
create index if not exists template_fields_lookup_idx on public.template_fields(template_id, version, sort_order);
create index if not exists template_stages_lookup_idx on public.template_stages(template_id, version, sort_order);

alter table public.templates enable row level security;
alter table public.template_fields enable row level security;
alter table public.template_stages enable row level security;
alter table public.template_forms enable row level security;
revoke all on table public.templates, public.template_fields, public.template_stages, public.template_forms from anon, authenticated;
grant select, insert, update on table public.templates, public.template_fields, public.template_stages, public.template_forms to service_role;

create or replace function public.touch_template_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists templates_touch_updated_at on public.templates;
create trigger templates_touch_updated_at before update on public.templates for each row execute function public.touch_template_updated_at();
revoke all on function public.touch_template_updated_at() from public;

-- One transaction creates the template or appends a complete new content version. The row lock
-- makes two simultaneous edits become versions N+1 and N+2 rather than corrupting one another.
create or replace function public.admin_save_template(
  p_template_id uuid,
  p_name text,
  p_product_code text,
  p_description text,
  p_is_active boolean,
  p_fields jsonb,
  p_stages jsonb,
  p_form_definition jsonb,
  p_created_by uuid default null
)
returns table(template_id uuid, version integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  next_version integer;
  new_template_id uuid;
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
    next_version := next_version + 1;
    new_template_id := p_template_id;
    update public.templates
       set name = p_name,
           product_code = p_product_code,
           version = next_version,
           description = nullif(p_description, '')
     where id = p_template_id;
    template_id := p_template_id;
  end if;

  insert into public.template_fields (template_id, version, field_key, label, type, is_required, options, sort_order)
  select new_template_id, next_version, field_key, label, type, coalesce(is_required, false), coalesce(options, '[]'::jsonb), sort_order
    from jsonb_to_recordset(coalesce(p_fields, '[]'::jsonb)) as f(field_key text, label text, type text, is_required boolean, options jsonb, sort_order integer);

  insert into public.template_stages (template_id, version, stage_key, label, stage_type, color, sort_order)
  select new_template_id, next_version, stage_key, label, stage_type, color, sort_order
    from jsonb_to_recordset(coalesce(p_stages, '[]'::jsonb)) as s(stage_key text, label text, stage_type text, color text, sort_order integer);

  insert into public.template_forms (template_id, version, form_definition)
  values (new_template_id, next_version, coalesce(p_form_definition, '{"sections":[]}'::jsonb));

  version := next_version;
  return next;
end;
$$;

-- Duplicate copies the current version in one transaction and starts the copy at version 1.
create or replace function public.admin_duplicate_template(p_template_id uuid, p_name text)
returns table(template_id uuid, version integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  source_row public.templates%rowtype;
  new_template_id uuid;
begin
  select * into source_row from public.templates where id = p_template_id;
  if not found then raise exception 'template_not_found'; end if;

  insert into public.templates (name, product_code, version, description, is_active, created_by)
  values (p_name, source_row.product_code, 1, source_row.description, true, source_row.created_by)
  returning id into new_template_id;
  template_id := new_template_id;

  insert into public.template_fields (template_id, version, field_key, label, type, is_required, options, sort_order)
  select new_template_id, 1, field_key, label, type, is_required, options, sort_order
    from public.template_fields tf where tf.template_id = p_template_id and tf.version = source_row.version;
  insert into public.template_stages (template_id, version, stage_key, label, stage_type, color, sort_order)
  select new_template_id, 1, stage_key, label, stage_type, color, sort_order
    from public.template_stages ts where ts.template_id = p_template_id and ts.version = source_row.version;
  insert into public.template_forms (template_id, version, form_definition)
  select new_template_id, 1, form_definition
    from public.template_forms tf where tf.template_id = p_template_id and tf.version = source_row.version;

  version := 1;
  return next;
end;
$$;
revoke all on function public.admin_save_template(uuid,text,text,text,boolean,jsonb,jsonb,jsonb,uuid) from public;
revoke all on function public.admin_duplicate_template(uuid,text) from public;
grant execute on function public.admin_save_template(uuid,text,text,text,boolean,jsonb,jsonb,jsonb,uuid) to service_role;
grant execute on function public.admin_duplicate_template(uuid,text) to service_role;
