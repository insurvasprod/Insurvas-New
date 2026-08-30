-- Preserve the operator who requested a duplicate as the copy's creator.
-- The audit row records the action too, but created_by should remain truthful
-- when the source template was originally created by another administrator.
drop function if exists public.admin_duplicate_template(uuid, text);

create or replace function public.admin_duplicate_template(
  p_template_id uuid,
  p_name text,
  p_created_by uuid default null
)
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
  values (p_name, source_row.product_code, 1, source_row.description, true, coalesce(p_created_by, source_row.created_by))
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

revoke all on function public.admin_duplicate_template(uuid, text, uuid) from public;
grant execute on function public.admin_duplicate_template(uuid, text, uuid) to service_role;
