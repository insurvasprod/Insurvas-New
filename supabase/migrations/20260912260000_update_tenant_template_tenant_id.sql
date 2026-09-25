-- Carry tenant_id onto the child rows when a tenant template is EDITED.
--
-- 20260912230000 fixed this for admin_apply_tenant_template, which creates the copy.
-- admin_update_tenant_template, which edits it afterwards, has the same omission and was missed:
-- it writes tenant_template_fields, _stages and _forms with only tenant_template_id, so the first
-- edit fails with
--
--   23502 null value in column "tenant_id" of relation "tenant_template_fields"
--
-- That is LA-1.4's "adding fields and a conditional form rule needs no deploy", and the four
-- criteria after it that need the edited form to exist.
--
-- Same reasoning as before: populate rather than relax. tenant_id is the isolation key for this
-- plane, and these rows belong to exactly the tenant that owns the copy they hang off -- which this
-- function already has in p_tenant_id, and already checks against tenant_templates before writing
-- anything.
--
-- Nothing else changes: same deletes, same conflict targets, same revision row, same return.

create or replace function public.admin_update_tenant_template(
  p_tenant_template_id uuid, p_tenant_id uuid, p_name text, p_description text,
  p_fields jsonb, p_stages jsonb, p_form_definition jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  next_definition_version integer;
  current_product text;
  applied_by_user uuid;
begin
  select definition_version + 1, product_code, applied_by
    into next_definition_version, current_product, applied_by_user
    from public.tenant_templates where id = p_tenant_template_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'tenant_template_not_found'; end if;

  update public.tenant_templates
     set name = p_name, description = p_description, definition_version = next_definition_version
   where id = p_tenant_template_id;

  delete from public.tenant_template_fields
   where tenant_template_id = p_tenant_template_id
     and field_key not in (select field_key from jsonb_to_recordset(coalesce(p_fields, '[]'::jsonb)) as f(field_key text));
  insert into public.tenant_template_fields (tenant_id, tenant_template_id, field_key, label, type, is_required, options, sort_order, help_text, validation)
  select p_tenant_id, p_tenant_template_id, field_key, label, type, is_required, options, sort_order, help_text, coalesce(validation, '{}'::jsonb)
  from jsonb_to_recordset(coalesce(p_fields, '[]'::jsonb)) as f(field_key text, label text, type text, is_required boolean, options jsonb, sort_order integer, help_text text, validation jsonb)
  on conflict (tenant_template_id, field_key) do update set label = excluded.label, type = excluded.type,
    is_required = excluded.is_required, options = excluded.options, sort_order = excluded.sort_order,
    help_text = excluded.help_text, validation = excluded.validation;

  delete from public.tenant_template_stages
   where tenant_template_id = p_tenant_template_id
     and stage_key not in (select stage_key from jsonb_to_recordset(coalesce(p_stages, '[]'::jsonb)) as s(stage_key text));
  insert into public.tenant_template_stages (tenant_id, tenant_template_id, stage_key, label, stage_type, color, sort_order)
  select p_tenant_id, p_tenant_template_id, stage_key, label, stage_type, color, sort_order
  from jsonb_to_recordset(coalesce(p_stages, '[]'::jsonb)) as s(stage_key text, label text, stage_type text, color text, sort_order integer)
  on conflict (tenant_template_id, stage_key) do update set label = excluded.label, stage_type = excluded.stage_type,
    color = excluded.color, sort_order = excluded.sort_order;

  insert into public.tenant_template_forms (tenant_id, tenant_template_id, form_definition)
  values (p_tenant_id, p_tenant_template_id, coalesce(p_form_definition, '{"sections":[]}'::jsonb))
  on conflict (tenant_template_id) do update set form_definition = excluded.form_definition;

  insert into public.tenant_template_revisions (tenant_template_id, revision, name, description, fields, stages, form_definition, created_by)
  values (p_tenant_template_id, next_definition_version, p_name, p_description,
          coalesce(p_fields, '[]'::jsonb), coalesce(p_stages, '[]'::jsonb),
          coalesce(p_form_definition, '{"sections":[]}'::jsonb), applied_by_user);

  return p_tenant_template_id;
end;
$function$;
