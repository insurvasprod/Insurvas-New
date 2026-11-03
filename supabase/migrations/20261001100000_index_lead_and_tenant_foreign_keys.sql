-- Index every foreign key that points at agent_leads, lead_queue or tenants but had no index.
--
-- Found 2026-09-30 while purging test data: 40 referencing columns had no index, so deleting ONE
-- lead made Postgres scan whole tables (tenant_lead_activity, 116k rows, twice — lead_id and
-- work_item_id; call attempts; lead sources; scoring decisions…) to apply ON DELETE CASCADE /
-- SET NULL. A 20,000-lead delete batch became billions of row checks and always hit the
-- statement timeout. The same missing indexes slow every "activity for this lead" read the app
-- does. Additive only: no data changes, no table rewrite. `if not exists` makes it re-runnable.
--
-- Plain (not CONCURRENTLY) because the migration runs in a transaction; each table here is small
-- enough (≤ ~120k rows) that the build takes seconds and blocks writes to that table only.
--
-- Down: drop index if exists <each name below>;

create index if not exists tenant_lead_activity_lead_id_idx            on public.tenant_lead_activity (lead_id);
create index if not exists tenant_lead_activity_work_item_id_idx       on public.tenant_lead_activity (work_item_id);
create index if not exists tenant_call_attempts_lead_id_idx            on public.tenant_call_attempts (lead_id);
create index if not exists tenant_call_attempts_work_item_id_idx       on public.tenant_call_attempts (work_item_id);
create index if not exists tenant_lead_sources_lead_id_idx             on public.tenant_lead_sources (lead_id);
create index if not exists tenant_scoring_decisions_lead_id_idx        on public.tenant_scoring_decisions (lead_id);
create index if not exists intake_failures_lead_id_idx                 on public.intake_failures (lead_id);
create index if not exists partner_messages_work_item_id_idx           on public.partner_messages (work_item_id);
create index if not exists lead_claim_items_lead_id_idx                on public.lead_claim_items (lead_id);
create index if not exists tenant_lead_post_log_lead_id_idx            on public.tenant_lead_post_log (lead_id);
create index if not exists email_log_tenant_id_idx                     on public.email_log (tenant_id);
create index if not exists tenant_verification_sessions_tenant_id_idx  on public.tenant_verification_sessions (tenant_id);
create index if not exists tenant_verification_sessions_lead_id_idx    on public.tenant_verification_sessions (lead_id);
create index if not exists tenant_callbacks_lead_id_idx                on public.tenant_callbacks (lead_id);
create index if not exists tenant_callbacks_work_item_id_idx           on public.tenant_callbacks (work_item_id);
create index if not exists tenant_template_fields_tenant_id_idx        on public.tenant_template_fields (tenant_id);
create index if not exists lead_assignment_events_lead_id_idx          on public.lead_assignment_events (lead_id);
create index if not exists lead_assignment_events_work_item_id_idx     on public.lead_assignment_events (work_item_id);
create index if not exists tenant_appointments_lead_id_idx             on public.tenant_appointments (lead_id);
create index if not exists tenant_application_cases_lead_id_idx        on public.tenant_application_cases (lead_id);
create index if not exists tenant_template_stages_tenant_id_idx        on public.tenant_template_stages (tenant_id);
create index if not exists tenant_do_not_call_lead_id_idx              on public.tenant_do_not_call (lead_id);
create index if not exists user_invitations_tenant_id_idx              on public.user_invitations (tenant_id);
create index if not exists verification_field_changes_lead_id_idx      on public.verification_field_changes (lead_id);
create index if not exists disposition_walks_work_item_id_idx          on public.disposition_walks (work_item_id);
create index if not exists disposition_walks_lead_id_idx               on public.disposition_walks (lead_id);
create index if not exists tenant_template_forms_tenant_id_idx         on public.tenant_template_forms (tenant_id);
create index if not exists tenant_applications_lead_id_idx             on public.tenant_applications (lead_id);
create index if not exists tenant_lead_notes_lead_id_idx               on public.tenant_lead_notes (lead_id);
create index if not exists agent_floor_nudges_work_item_id_idx         on public.agent_floor_nudges (work_item_id);
create index if not exists partner_message_attachments_tenant_id_idx   on public.partner_message_attachments (tenant_id);
create index if not exists lead_note_edits_lead_id_idx                 on public.lead_note_edits (lead_id);
create index if not exists billing_waivers_tenant_id_idx               on public.billing_waivers (tenant_id);
create index if not exists tenant_quotes_lead_id_idx                   on public.tenant_quotes (lead_id);
create index if not exists callbacks_lead_id_idx                       on public.callbacks (lead_id);
create index if not exists tenant_campaign_recycle_rules_tenant_id_idx on public.tenant_campaign_recycle_rules (tenant_id);
create index if not exists tenant_issued_policies_lead_id_idx          on public.tenant_issued_policies (lead_id);
create index if not exists tenant_dial_dnc_checks_lead_id_idx          on public.tenant_dial_dnc_checks (lead_id);
create index if not exists tenant_lead_stage_events_lead_id_idx        on public.tenant_lead_stage_events (lead_id);
create index if not exists tenant_lead_signature_readiness_lead_id_idx on public.tenant_lead_signature_readiness (lead_id);
