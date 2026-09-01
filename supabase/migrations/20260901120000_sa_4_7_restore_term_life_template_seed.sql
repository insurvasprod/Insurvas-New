-- SA-4.7 follow-up: restore the default Term Life template and product access when the original
-- seed ran before the product catalog existed. This is idempotent and fixes the live ordering gap
-- without changing any tenant-owned copies.
do $$
declare
  template_id uuid;
begin
  if not exists (select 1 from public.templates where product_code = 'term_life' and is_active) then
    insert into public.templates (name, product_code, version, description, is_active)
    values ('Term Life — standard', 'term_life', 1, 'Default Term Life lead, pipeline and application workspace.', true)
    returning id into template_id;

    insert into public.template_fields (template_id, version, field_key, label, type, is_required, options, sort_order) values
      (template_id, 1, 'full_name', 'Full name', 'text', true, '[]'::jsonb, 10),
      (template_id, 1, 'date_of_birth', 'Date of birth', 'date', true, '[]'::jsonb, 20),
      (template_id, 1, 'state', 'State', 'single_select', true, '[]'::jsonb, 30),
      (template_id, 1, 'coverage_wanted', 'Coverage wanted (cents)', 'currency', false, '[]'::jsonb, 40),
      (template_id, 1, 'tobacco_use', 'Tobacco use', 'boolean', true, '[]'::jsonb, 50),
      (template_id, 1, 'health_notes', 'Health notes', 'text', false, '[]'::jsonb, 60);

    insert into public.template_stages (template_id, version, stage_key, label, stage_type, color, sort_order) values
      (template_id, 1, 'new', 'New', 'open', '#64748b', 10),
      (template_id, 1, 'contacted', 'Contacted', 'open', '#2563eb', 20),
      (template_id, 1, 'quoted', 'Quoted', 'open', '#7c3aed', 30),
      (template_id, 1, 'application_sent', 'Application sent', 'open', '#0891b2', 40),
      (template_id, 1, 'submitted', 'Submitted', 'open', '#d97706', 50),
      (template_id, 1, 'issued', 'Issued', 'won', '#16a34a', 60),
      (template_id, 1, 'lost', 'Lost', 'lost', '#dc2626', 70);

    insert into public.template_forms (template_id, version, form_definition) values (
      template_id, 1,
      '{"sections":[{"section_key":"lead","label":"Lead details","sort_order":10,"fields":[{"field_key":"full_name","is_required":true,"show_when":null},{"field_key":"date_of_birth","is_required":true,"show_when":null},{"field_key":"state","is_required":true,"show_when":null},{"field_key":"coverage_wanted","is_required":false,"show_when":null},{"field_key":"tobacco_use","is_required":true,"show_when":null},{"field_key":"health_notes","is_required":false,"show_when":{"field_key":"tobacco_use","equals":"true"}}]}]}'::jsonb
    );
  end if;
end;
$$;

insert into public.plan_product_access (plan_id, product_code)
select p.id, 'term_life'
from public.plans p
where p.version = 1 and not p.is_archived
on conflict do nothing;
