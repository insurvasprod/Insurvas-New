-- LA-0 / SA-0.2 hardening: tenant_app may read only the tenant's operational records.
-- Mutations remain service-role-only because the API resolves role, entitlement, read-only state,
-- and audit context before writing. These policies are the database backstop against cross-tenant
-- reads if a future route uses the tenant connection directly.

create policy carriers_active_read on public.carriers
  for select to tenant_app
  using (is_active);

grant select on public.carriers to tenant_app;

create policy tenant_carriers_read on public.tenant_carriers
  for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create policy commission_schedules_read on public.commission_schedules
  for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create policy advance_rules_read on public.advance_rules
  for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select on public.tenant_carriers, public.commission_schedules, public.advance_rules to tenant_app;

create policy appointments_read on public.appointments
  for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create policy licenses_read on public.licenses
  for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create policy eo_policies_read on public.eo_policies
  for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create policy ce_records_read on public.ce_records
  for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select on public.appointments, public.licenses, public.eo_policies, public.ce_records to tenant_app;

create policy households_read on public.households
  for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create policy contacts_read on public.contacts
  for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create policy contact_phones_read on public.contact_phones
  for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create policy contact_emails_read on public.contact_emails
  for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create policy field_schema_read on public.field_schema
  for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

create policy merge_log_read on public.merge_log
  for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

grant select on public.households, public.contacts, public.contact_phones, public.contact_emails,
  public.field_schema, public.merge_log to tenant_app;
