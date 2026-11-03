-- LA-1 tenant-access performance hardening.
--
-- These two compatibility policies have the same tenant predicate as their scoped neighbors, but
-- the unwrapped current_setting() call can be re-evaluated for every row. Keep the policy role and
-- predicate unchanged while giving PostgreSQL an initplan-valued setting for large inbox/workspace
-- reads. This migration changes no data and does not grant any new table or function privilege.

drop policy if exists agent_leads_tenant_compat on public.agent_leads;
create policy agent_leads_tenant_compat on public.agent_leads
  for all to tenant_app
  using (tenant_id = (select nullif(current_setting('app.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('app.tenant_id', true), '')::uuid));

drop policy if exists lead_queue_tenant_compat on public.lead_queue;
create policy lead_queue_tenant_compat on public.lead_queue
  for all to tenant_app
  using (tenant_id = (select nullif(current_setting('app.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('app.tenant_id', true), '')::uuid));
