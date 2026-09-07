-- The restored Term Life source had a required single-select state field with no options. Publish
-- a normal immutable source version so new tenant copies can actually submit that form.
do $$
declare v_template_id uuid;
begin
  select id into v_template_id from public.templates where product_code = 'term_life' and version = 1 and is_active limit 1;
  if v_template_id is not null and not exists (select 1 from public.templates where id = v_template_id and version = 2) then
    update public.templates set version = 2 where id = v_template_id;
    insert into public.template_fields (template_id, version, field_key, label, type, is_required, options, sort_order, help_text, validation)
    select v_template_id, 2, field_key, label, type, is_required,
      case when field_key = 'state' then '["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"]'::jsonb else options end,
      sort_order, help_text, validation
    from public.template_fields tf where tf.template_id = v_template_id and tf.version = 1;
    insert into public.template_stages (template_id, version, stage_key, label, stage_type, color, sort_order)
    select v_template_id, 2, stage_key, label, stage_type, color, sort_order from public.template_stages ts where ts.template_id = v_template_id and ts.version = 1;
    insert into public.template_forms (template_id, version, form_definition)
    select v_template_id, 2, form_definition from public.template_forms tf where tf.template_id = v_template_id and tf.version = 1;
  end if;
end;
$$;
