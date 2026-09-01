-- LA-1.4 follow-up: keep tenant session settings init-planned once per statement
-- and cover the new foreign keys used by draft/revision lookups.
drop policy if exists tenant_templates_scoped on public.tenant_templates;
create policy tenant_templates_scoped on public.tenant_templates
  for all to public
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

drop policy if exists agent_leads_scoped on public.agent_leads;
create policy agent_leads_scoped on public.agent_leads
  for all to public
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

drop policy if exists form_drafts_scoped on public.form_drafts;
create policy form_drafts_scoped on public.form_drafts
  for all to public
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

create index if not exists form_drafts_partner_idx
  on public.form_drafts (partner_id);
create index if not exists form_drafts_product_idx
  on public.form_drafts (product_code);
create index if not exists form_drafts_template_idx
  on public.form_drafts (tenant_template_id);
create index if not exists form_drafts_user_idx
  on public.form_drafts (user_id);
create index if not exists tenant_template_revisions_created_by_idx
  on public.tenant_template_revisions (created_by);
create index if not exists tenant_templates_applied_by_idx
  on public.tenant_templates (applied_by);
create index if not exists tenant_templates_product_idx
  on public.tenant_templates (product_code);
