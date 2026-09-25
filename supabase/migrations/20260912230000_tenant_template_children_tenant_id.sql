-- Carry tenant_id onto the tenant template child rows.
--
-- `tenant_template_fields`, `_stages` and `_forms` all have `tenant_id` NOT NULL here, and
-- admin_apply_tenant_template never sets it -- it writes only tenant_template_id and the payload.
-- So applying a template fails on the first child insert:
--
--   23502 null value in column "tenant_id" of relation "tenant_template_fields"
--
-- and LA-1.4 cannot get past "agent receives a tenant-owned form copy".
--
-- Found ahead of the failure by scripts/check-unmodelled-required-columns.mjs, which flags columns
-- the live schema requires and this repo's migrations never declare. It named all three of these
-- before the suite reached them.
--
-- Populating rather than making the column nullable. tenant_id is the isolation key for this whole
-- plane; a child row that does not carry it cannot be scoped by row-level security, and LA-0.2's
-- guarantees are built on every tenant-owned row carrying it. The value is unambiguous here --
-- these rows belong to exactly the tenant whose copy they hang off.
--
-- Nothing else about the function changes: same conflict targets, same update sets, same return.

create or replace function public.admin_apply_tenant_template(
  p_tenant_id uuid, p_template_id uuid, p_template_version integer, p_product_code text,
  p_name text, p_description text, p_applied_by uuid,
  p_fields jsonb, p_stages jsonb, p_form_definition jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  copy_id uuid;
  next_definition_version integer;
begin
  insert into public.tenant_templates (tenant_id, template_id, template_version, product_code, name, description, applied_at, applied_by)
  values (p_tenant_id, p_template_id, p_template_version, p_product_code, p_name, p_description, now(), p_applied_by)
  on conflict (tenant_id, product_code) do update set template_id = excluded.template_id,
    template_version = excluded.template_version, applied_at = excluded.applied_at, applied_by = excluded.applied_by,
    definition_version = public.tenant_templates.definition_version + 1
  returning id, definition_version into copy_id, next_definition_version;

  insert into public.tenant_template_fields (tenant_id, tenant_template_id, field_key, label, type, is_required, options, sort_order, help_text, validation)
  select p_tenant_id, copy_id, field_key, label, type, is_required, options, sort_order, help_text, coalesce(validation, '{}'::jsonb)
  from jsonb_to_recordset(coalesce(p_fields, '[]'::jsonb)) as f(field_key text, label text, type text, is_required boolean, options jsonb, sort_order integer, help_text text, validation jsonb)
  on conflict (tenant_template_id, field_key) do update set label = excluded.label, type = excluded.type,
    is_required = excluded.is_required, options = excluded.options, sort_order = excluded.sort_order,
    help_text = excluded.help_text, validation = excluded.validation;

  insert into public.tenant_template_stages (tenant_id, tenant_template_id, stage_key, label, stage_type, color, sort_order)
  select p_tenant_id, copy_id, stage_key, label, stage_type, color, sort_order
  from jsonb_to_recordset(coalesce(p_stages, '[]'::jsonb)) as s(stage_key text, label text, stage_type text, color text, sort_order integer)
  on conflict (tenant_template_id, stage_key) do update set label = excluded.label, stage_type = excluded.stage_type,
    color = excluded.color, sort_order = excluded.sort_order;

  insert into public.tenant_template_forms (tenant_id, tenant_template_id, form_definition)
  values (p_tenant_id, copy_id, coalesce(p_form_definition, '{"sections":[]}'::jsonb))
  on conflict (tenant_template_id) do update set form_definition = excluded.form_definition;

  insert into public.tenant_template_revisions (tenant_template_id, revision, name, description, fields, stages, form_definition, created_by)
  values (copy_id, next_definition_version, p_name, p_description, coalesce(p_fields, '[]'::jsonb), coalesce(p_stages, '[]'::jsonb), coalesce(p_form_definition, '{"sections":[]}'::jsonb), p_applied_by)
  on conflict (tenant_template_id, revision) do update set name = excluded.name, description = excluded.description,
    fields = excluded.fields, stages = excluded.stages, form_definition = excluded.form_definition, created_by = excluded.created_by;

  return copy_id;
end;
$function$;
