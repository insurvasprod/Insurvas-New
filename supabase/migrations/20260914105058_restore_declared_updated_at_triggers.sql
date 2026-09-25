-- Restore the declared updated_at and invoice relationship triggers on the
-- live schema. Every operation is idempotent so this is safe to re-run while
-- reconciling environments that were provisioned from an older baseline.

drop trigger if exists agent_leads_touch_updated_at on public.agent_leads;
create trigger agent_leads_touch_updated_at
  before update on public.agent_leads
  for each row execute function public.touch_agent_template_updated_at();

drop trigger if exists appointments_touch_updated_at on public.appointments;
create trigger appointments_touch_updated_at
  before update on public.appointments
  for each row execute function public.touch_appointment_vault_updated_at();

drop trigger if exists callbacks_touch_updated_at on public.callbacks;
create trigger callbacks_touch_updated_at
  before update on public.callbacks
  for each row execute function public.touch_appointment_vault_updated_at();

drop trigger if exists ce_records_touch_updated_at on public.ce_records;
create trigger ce_records_touch_updated_at
  before update on public.ce_records
  for each row execute function public.touch_appointment_vault_updated_at();

drop trigger if exists contacts_touch_updated_at on public.contacts;
create trigger contacts_touch_updated_at
  before update on public.contacts
  for each row execute function public.touch_contact_updated_at();

drop trigger if exists deal_flow_touch_updated_at on public.deal_flow;
create trigger deal_flow_touch_updated_at
  before update on public.deal_flow
  for each row execute function public.touch_intake_updated_at();

drop trigger if exists disposition_flows_touch_updated_at on public.disposition_flows;
create trigger disposition_flows_touch_updated_at
  before update on public.disposition_flows
  for each row execute function public.touch_disposition_updated_at();

drop trigger if exists eo_policies_touch_updated_at on public.eo_policies;
create trigger eo_policies_touch_updated_at
  before update on public.eo_policies
  for each row execute function public.touch_appointment_vault_updated_at();

drop trigger if exists field_schema_touch_updated_at on public.field_schema;
create trigger field_schema_touch_updated_at
  before update on public.field_schema
  for each row execute function public.touch_contact_updated_at();

drop trigger if exists households_touch_updated_at on public.households;
create trigger households_touch_updated_at
  before update on public.households
  for each row execute function public.touch_contact_updated_at();

drop trigger if exists lead_queue_touch_updated_at on public.lead_queue;
create trigger lead_queue_touch_updated_at
  before update on public.lead_queue
  for each row execute function public.touch_intake_updated_at();

drop trigger if exists licenses_touch_updated_at on public.licenses;
create trigger licenses_touch_updated_at
  before update on public.licenses
  for each row execute function public.touch_appointment_vault_updated_at();

drop trigger if exists partners_touch_updated_at on public.partners;
create trigger partners_touch_updated_at
  before update on public.partners
  for each row execute function public.touch_partner_updated_at();

drop trigger if exists pipeline_stages_touch_updated_at on public.pipeline_stages;
create trigger pipeline_stages_touch_updated_at
  before update on public.pipeline_stages
  for each row execute function public.touch_agent_template_updated_at();

drop trigger if exists pipelines_touch_updated_at on public.pipelines;
create trigger pipelines_touch_updated_at
  before update on public.pipelines
  for each row execute function public.touch_agent_template_updated_at();

drop trigger if exists products_touch_updated_at on public.products;
create trigger products_touch_updated_at
  before update on public.products
  for each row execute function public.touch_product_updated_at();

drop trigger if exists stage_dispositions_touch_updated_at on public.stage_dispositions;
create trigger stage_dispositions_touch_updated_at
  before update on public.stage_dispositions
  for each row execute function public.touch_agent_template_updated_at();

drop trigger if exists templates_touch_updated_at on public.templates;
create trigger templates_touch_updated_at
  before update on public.templates
  for each row execute function public.touch_template_updated_at();

drop trigger if exists tenant_templates_touch_updated_at on public.tenant_templates;
create trigger tenant_templates_touch_updated_at
  before update on public.tenant_templates
  for each row execute function public.touch_tenant_template_updated_at();
