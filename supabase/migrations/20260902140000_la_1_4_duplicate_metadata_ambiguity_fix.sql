-- LA-1.4 follow-up: qualify the source fields in the duplicate helper.
-- The function returns a column named template_id; an unqualified source
-- reference collided with that output column on live Postgres.
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
  select new_template_id, 1, f.field_key, f.label, f.type, f.is_required, f.options, f.sort_order, f.help_text, f.validation
  from public.template_fields f
  where f.template_id = p_template_id and f.version = source_row.version;
  insert into public.template_stages (template_id, version, stage_key, label, stage_type, color, sort_order)
  select new_template_id, 1, s.stage_key, s.label, s.stage_type, s.color, s.sort_order
  from public.template_stages s
  where s.template_id = p_template_id and s.version = source_row.version;
  insert into public.template_forms (template_id, version, form_definition)
  select new_template_id, 1, tf.form_definition
  from public.template_forms tf
  where tf.template_id = p_template_id and tf.version = source_row.version;
  template_id := new_template_id; version := 1; return next;
end;
$$;
