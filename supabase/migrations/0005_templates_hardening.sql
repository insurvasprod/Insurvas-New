-- SA-4.6 hardening: preserve archive state across content versions and record the creating admin.
drop function if exists public.admin_save_template(uuid,text,text,text,boolean,jsonb,jsonb,jsonb);
drop function if exists public.admin_save_template(uuid,text,text,text,boolean,jsonb,jsonb,jsonb,uuid);

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
    -- Content edits never change availability. Archive/restore has its own explicit API action.
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
revoke all on function public.admin_save_template(uuid,text,text,text,boolean,jsonb,jsonb,jsonb,uuid) from public;
grant execute on function public.admin_save_template(uuid,text,text,text,boolean,jsonb,jsonb,jsonb,uuid) to service_role;
