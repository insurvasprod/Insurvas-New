-- Atomic copy/merge and tenant-owned editing. The platform template is read-only input data here.
create or replace function public.touch_tenant_template_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tenant_templates_touch_updated_at on public.tenant_templates;
create trigger tenant_templates_touch_updated_at
before update on public.tenant_templates
for each row execute function public.touch_tenant_template_updated_at();

create or replace function public.admin_apply_tenant_template(
  p_tenant_id uuid,
  p_template_id uuid,
  p_template_version integer,
  p_product_code text,
  p_name text,
  p_description text,
  p_applied_by uuid,
  p_fields jsonb,
  p_stages jsonb,
  p_form_definition jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  copy_id uuid;
begin
  insert into public.tenant_templates (tenant_id, template_id, template_version, product_code, name, description, applied_at, applied_by)
  values (p_tenant_id, p_template_id, p_template_version, p_product_code, p_name, p_description, now(), p_applied_by)
  on conflict (tenant_id, product_code) do update set
    template_id = excluded.template_id,
    template_version = excluded.template_version,
    applied_at = excluded.applied_at,
    applied_by = excluded.applied_by
  returning id into copy_id;

  insert into public.tenant_template_fields (tenant_template_id, field_key, label, type, is_required, options, sort_order)
  select copy_id, field_key, label, type, is_required, options, sort_order
  from jsonb_to_recordset(coalesce(p_fields, '[]'::jsonb)) as f(field_key text, label text, type text, is_required boolean, options jsonb, sort_order integer)
  on conflict (tenant_template_id, field_key) do nothing;

  insert into public.tenant_template_stages (tenant_template_id, stage_key, label, stage_type, color, sort_order)
  select copy_id, stage_key, label, stage_type, color, sort_order
  from jsonb_to_recordset(coalesce(p_stages, '[]'::jsonb)) as s(stage_key text, label text, stage_type text, color text, sort_order integer)
  on conflict (tenant_template_id, stage_key) do nothing;

  insert into public.tenant_template_forms (tenant_template_id, form_definition)
  values (copy_id, coalesce(p_form_definition, '{"sections":[]}'::jsonb))
  on conflict (tenant_template_id) do update set form_definition = excluded.form_definition;
  return copy_id;
end;
$$;

create or replace function public.admin_update_tenant_template(
  p_tenant_template_id uuid,
  p_tenant_id uuid,
  p_name text,
  p_description text,
  p_fields jsonb,
  p_stages jsonb,
  p_form_definition jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tenant_templates
     set name = p_name, description = p_description
   where id = p_tenant_template_id and tenant_id = p_tenant_id;
  if not found then raise exception 'tenant_template_not_found'; end if;

  delete from public.tenant_template_fields
   where tenant_template_id = p_tenant_template_id
     and field_key not in (select field_key from jsonb_to_recordset(coalesce(p_fields, '[]'::jsonb)) as f(field_key text));
  insert into public.tenant_template_fields (tenant_template_id, field_key, label, type, is_required, options, sort_order)
  select p_tenant_template_id, field_key, label, type, is_required, options, sort_order
  from jsonb_to_recordset(coalesce(p_fields, '[]'::jsonb)) as f(field_key text, label text, type text, is_required boolean, options jsonb, sort_order integer)
  on conflict (tenant_template_id, field_key) do update set label = excluded.label, type = excluded.type, is_required = excluded.is_required, options = excluded.options, sort_order = excluded.sort_order;

  delete from public.tenant_template_stages
   where tenant_template_id = p_tenant_template_id
     and stage_key not in (select stage_key from jsonb_to_recordset(coalesce(p_stages, '[]'::jsonb)) as s(stage_key text));
  insert into public.tenant_template_stages (tenant_template_id, stage_key, label, stage_type, color, sort_order)
  select p_tenant_template_id, stage_key, label, stage_type, color, sort_order
  from jsonb_to_recordset(coalesce(p_stages, '[]'::jsonb)) as s(stage_key text, label text, stage_type text, color text, sort_order integer)
  on conflict (tenant_template_id, stage_key) do update set label = excluded.label, stage_type = excluded.stage_type, color = excluded.color, sort_order = excluded.sort_order;

  insert into public.tenant_template_forms (tenant_template_id, form_definition)
  values (p_tenant_template_id, coalesce(p_form_definition, '{"sections":[]}'::jsonb))
  on conflict (tenant_template_id) do update set form_definition = excluded.form_definition;
  return p_tenant_template_id;
end;
$$;

revoke all on function public.admin_apply_tenant_template(uuid,uuid,integer,text,text,text,uuid,jsonb,jsonb,jsonb) from public;
revoke all on function public.admin_update_tenant_template(uuid,uuid,text,text,jsonb,jsonb,jsonb) from public;
grant execute on function public.admin_apply_tenant_template(uuid,uuid,integer,text,text,text,uuid,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.admin_update_tenant_template(uuid,uuid,text,text,jsonb,jsonb,jsonb) to service_role;
revoke all on function public.touch_tenant_template_updated_at() from public;
