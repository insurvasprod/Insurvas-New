/**
 * LA-6.5 (Notion sprint, Module 6 — Compliance) · where one person's data lives, and what a deletion
 * does to each place. Pure data, so a test can hold the database to it:
 *
 *   - every table the purge touches (20261015140000, data_subject_purge_group) is listed here with
 *     the same action, and
 *   - every table created by a migration that holds a person's data — an identifying column, or a
 *     link to a lead, client, application, case, interview or verification session — is listed here,
 *     or named as not consumer data, or as part of the old CRM. A new table nobody wired in fails
 *     the test (lib/compliance/dataSubject.test.mjs). That is what keeps a "completed" deletion
 *     honest in six months.
 *
 * Actions: purge (rows deleted), anonymise (row kept, the person stripped out), keep (kept as it is,
 * with the reason the certificate states), cascade (deleted with its parent row).
 */

export type SubjectAction = "purge" | "anonymise" | "keep" | "cascade";
export type PurgeGroup = "dnc" | "activity" | "checks" | "applications" | "leads" | "clients" | "records";

export const PURGE_GROUPS: readonly PurgeGroup[] = ["dnc", "activity", "checks", "applications", "leads", "clients", "records"];

export type SubjectTable = { action: SubjectAction; group?: PurgeGroup; parent?: string; reason?: string };

export const DATA_SUBJECT_MAP: Record<string, SubjectTable> = {
  // dnc — never deleted; reduced to the number and a reason.
  tenant_do_not_call: { action: "keep", group: "dnc", reason: "The number stays on the do-not-call list, reduced to the number and a reason, so the person is never called again." },
  tenant_suppression_list: { action: "keep", group: "dnc", reason: "Federal, state and litigator listings of the number: kept so it is never called." },

  // activity — the history of contact.
  tenant_appointment_reminder_events: { action: "purge", group: "activity" },
  tenant_appointments: { action: "purge", group: "activity" },
  tenant_callbacks: { action: "purge", group: "activity" },
  callbacks: { action: "purge", group: "activity" },
  callback_history: { action: "purge", group: "activity" },
  tenant_lead_activity: { action: "purge", group: "activity" },
  tenant_dial_dnc_checks: { action: "purge", group: "activity" },
  tenant_call_attempts: { action: "purge", group: "activity" },
  active_calls: { action: "purge", group: "activity" },
  disposition_walks: { action: "purge", group: "activity" },
  tenant_lead_notes: { action: "purge", group: "activity" },
  lead_notes: { action: "purge", group: "activity" },
  lead_note_edits: { action: "purge", group: "activity" },
  lead_notifications: { action: "purge", group: "activity" },
  tenant_lead_sla_events: { action: "purge", group: "activity" },
  lead_sla_events: { action: "purge", group: "activity" },
  tenant_lead_stage_events: { action: "purge", group: "activity" },
  tenant_nurture_reactivations: { action: "purge", group: "activity" },
  tenant_scoring_decisions: { action: "purge", group: "activity" },
  tenant_lead_signature_readiness: { action: "purge", group: "activity" },
  intake_failures: { action: "purge", group: "activity" },
  lead_assignment_events: { action: "purge", group: "activity" },

  // checks — consent goes; the records partner quality and vendor credits count stay, without the number.
  tenant_consent_artefacts: { action: "purge", group: "checks" },
  tenant_lead_post_log: { action: "purge", group: "checks" },
  lead_income: { action: "purge", group: "checks" },
  screening_results: { action: "purge", group: "checks" },
  screening_cache_locks: { action: "purge", group: "checks" },
  screening_audit: { action: "anonymise", group: "checks", reason: "Kept without the number: partner quality counts each screen." },
  tenant_campaign_scrub_rejections: { action: "anonymise", group: "checks", reason: "Kept without the number: vendor credits count each rejected row." },
  transfer_verdict: { action: "anonymise", group: "checks", reason: "Kept without the number: partner quality counts each verdict." },
  lead_claim_items: { action: "anonymise", group: "checks", reason: "Vendor credit claims stay so vendor cost reporting reconciles." },
  // LA-2.6's consent / existing-relationship exemptions (20260925709700; purged when that file is live).
  tenant_dnc_exemptions: { action: "purge", group: "checks" },
  tenant_dnc_exemption_uses: { action: "purge", group: "checks" },

  // applications — answers, health, money details go; the application row stays (policy record).
  tenant_uw_interviews: { action: "purge", group: "applications" },
  tenant_uw_answers: { action: "cascade", parent: "tenant_uw_interviews" },
  tenant_uw_answer_changes: { action: "cascade", parent: "tenant_uw_interviews" },
  tenant_medications: { action: "cascade", parent: "tenant_uw_interviews" },
  tenant_verification_sessions: { action: "purge", group: "applications" },
  verification_fields: { action: "cascade", parent: "tenant_verification_sessions" },
  verification_field_changes: { action: "cascade", parent: "tenant_verification_sessions" },
  verification_sessions: { action: "purge", group: "applications" },
  verification_items: { action: "cascade", parent: "verification_sessions" },
  verification_item_audit: { action: "cascade", parent: "verification_sessions" },
  tenant_application_values: { action: "purge", group: "applications" },
  tenant_application_beneficiaries: { action: "purge", group: "applications" },
  tenant_application_payment_methods: { action: "purge", group: "applications" },
  tenant_application_counteroffers: { action: "anonymise", group: "applications" },
  tenant_welcome_packs: { action: "anonymise", group: "applications" },
  tenant_applications: { action: "anonymise", group: "applications", reason: "The application row stays (carrier, product, status, dates): it is part of the policy record." },
  tenant_quotes: { action: "anonymise", group: "applications" },

  // leads — anonymised so vendor cost reporting still reconciles.
  agent_leads: { action: "anonymise", group: "leads", reason: "Lead rows stay without the person so vendor cost reporting still reconciles." },
  deal_flow: { action: "anonymise", group: "leads", reason: "Sales rows stay without the person: sales and cost figures still reconcile." },
  form_drafts: { action: "anonymise", group: "leads" },
  partner_messages: { action: "anonymise", group: "leads" },

  // clients — the person's record; policy and commission records kept, anonymised.
  contact_phones: { action: "purge", group: "clients" },
  contact_emails: { action: "purge", group: "clients" },
  contact_income: { action: "purge", group: "clients" },
  queue_item: { action: "purge", group: "clients" },
  contact_duplicate_reviews: { action: "purge", group: "clients" },
  household_claim_followup: { action: "anonymise", group: "clients" },
  contacts: { action: "anonymise", group: "clients", reason: "The client row stays (no name, number, birth date or address) so policies and commissions still reconcile." },
  households: { action: "anonymise", group: "clients" },
  raw_rows: { action: "anonymise", group: "clients", reason: "Carrier rows behind the policies: kept for the financial record, the person's identifiers erased." },
  policy_snapshot: { action: "anonymise", group: "clients", reason: "Policy history: kept, the person's identifiers erased." },
  policy_current: { action: "anonymise", group: "clients", reason: "Policy and commission records are a financial and tax record: kept, anonymised." },
  tenant_commission_statement_lines: { action: "anonymise", group: "clients", reason: "Commission statements: kept, anonymised." },
  tenant_policies: { action: "anonymise", group: "clients", reason: "Hand-entered policies: kept, anonymised." },
  agent_findings: { action: "anonymise", group: "clients" },

  // records — regulatory and access records kept without the person.
  complaint: { action: "anonymise", group: "records", reason: "The regulatory record of a complaint and its outcome is kept, without the person." },
  compliance_report_log: { action: "anonymise", group: "records", reason: "Who generated which report is kept; the number is not." },
  email_log: { action: "anonymise", group: "records" },

  // Kept as they are: no direct identifier, and part of a record the business must keep.
  compliance_index: { action: "keep", reason: "Pointers only: rebuilt from the sources, so it follows what was purged; the do-not-call pointer stays." },
  policy_match: { action: "keep", reason: "The link between a policy and its sale: ids only, part of the policy record." },
  commission_entry: { action: "keep", reason: "Commission ledger: amounts and policy numbers, no personal identifiers." },
  commission_account_entry: { action: "keep", reason: "Commission account ledger: amounts only." },
  commission_discrepancy: { action: "keep", reason: "Commission discrepancies: amounts and policy numbers, part of the financial record." },
  lead_queue: { action: "keep", reason: "Assignment row with no personal data; vendor and agent figures count it." },
  tenant_lead_sources: { action: "keep", reason: "Campaign attribution with no personal data." },
  tenant_application_cases: { action: "keep", reason: "Case row with no personal data; part of the policy record." },
  tenant_application_submissions: { action: "keep", reason: "Submission confirmations: carrier and dates, part of the policy record." },
  tenant_application_disclosures: { action: "keep", reason: "Which disclosure was given and when: part of the policy record." },
  tenant_application_requirements: { action: "keep", reason: "Carrier requirements on the application: part of the policy record." },
  tenant_issued_policies: { action: "keep", reason: "Issued-policy record: part of the policy and commission record." },
  tenant_sensitive_access_log: { action: "keep", reason: "Who opened the application's sensitive fields: an access record, ids only." },
  contact_income_access_log: { action: "keep", reason: "Who saw the income and when: an access record, ids only." },
  tenant_extension_grants: { action: "keep", reason: "Browser-extension grants: ids only." },
  tenant_copy_assist_ticks: { action: "keep", reason: "Copy-assist ticks: field keys only." },
  carrier_field_map_events: { action: "keep", reason: "Field-map telemetry: field keys only." },
  partner_rejected_submissions: { action: "keep", reason: "A coded reject with the last four digits only." },
  tenant_campaign_scrub_runs: { action: "keep", reason: "Scrub run progress: counts and a cursor id only." },
  winback_candidate: { action: "keep", reason: "Policy history (lapse and win-back): keyed by policy, no personal identifiers." },
  reinstatement_case: { action: "keep", reason: "Policy history (reinstatement): keyed by policy, no personal identifiers." },
  servicing_request: { action: "keep", reason: "Policy servicing history: keyed by policy, no personal identifiers." },
  retention_action: { action: "keep", reason: "Policy retention history: keyed by policy, no personal identifiers." },
  conversion_attempt: { action: "keep", reason: "Billing-conversion history: keyed by policy, no personal identifiers." },
  contact_merge_log: { action: "keep", reason: "Which client records were merged: ids only." },
  merge_log: { action: "keep", reason: "Which client records were merged: ids only." },
  deletion_request: { action: "keep", reason: "This deletion's own record: the proof it was done." },
  deletion_request_event: { action: "keep", reason: "This deletion's audit trail: the proof it was done." },
};

/** Tables that hold no consumer's data (staff, agencies, partners, configuration, files as files). */
export const NOT_CONSUMER = [
  "users", "admin_users", "tenants", "partners", "agency_profiles", "agency_profile_history", "login_events", "platform_login_activity",
  // LA-8.2: an agency user's own sessions, second factor and security log — staff, not consumers.
  "tenant_user_session", "user_two_factor", "user_recovery_code", "user_security_event",
  // LA-8.4: an agency user's own notification choices and digest queue. A queued digest line can name a
  // customer in its title, as agent_notifications rows do; sent lines are deleted after 30 days by the
  // notifications job (lib/notifications/outbox.ts), so none outlives the email it went in.
  "notification_preference", "user_notification_settings", "notification_digest_item",
  // LA-8.7: integration keys and webhooks. A delivery's payload carries a policy number, carrier and
  // figures — never a name, contact detail or SSN (lib/webhooks/webhooks.test.mjs) — and finished
  // deliveries are deleted after 30 days by prune_webhook_attempts(); the receiver holds its own copy.
  "api_key", "webhook_subscription", "webhook_delivery", "webhook_attempt",
  // LA-8.8: the settings audit log — agency configuration and who changed it. Never purged, by anything.
  "settings_audit",
  "user_identity_mappings", "user_invitations", "tenant_connected_calendars", "tenant_carrier_commission_contacts", "assignment_rules",
  "carrier_layout_map_entry", "carrier_status_map", "carrier_servicing_guide", "unmapped_status_queue", "file_registry", "file_registry_skips",
  "payment_providers", "webhook_events", "tenant_users", "partner_users", "compliance_settings", "compliance_complaint_deadline",
  "compliance_complaint_checklist", "compliance_index_reconciliation", "audit_log", "legal_acceptances",
  // LA-7.8: the agency's own payees (call centres, producers, lead vendors) and who looked up their tax IDs — not consumers.
  "payee_tax_profile", "payee_tax_reveal_log",
] as const;

/** The old CRM's tables (organization-keyed, no tenant): not part of a tenant's records, so not searched. Named on the certificate. */
export const LEGACY_ORG_PLANE = [
  "leads", "lead_events", "lead_dispositions", "lead_assignments", "lead_callback_events", "lead_note_edit_history", "lead_note_tombstones",
  "lead_post_log", "lead_preflight_checks", "lead_suppressions", "lead_import_rows", "insurance_policies", "retention_cases", "sales_tasks",
  "compliance_checks", "compliance_evidence", "scrub_results", "suppression_lists", "daily_deal_flow", "dialer_calls", "telephony_events",
  "partner_intake_submissions", "outbound_prospects", "outbound_prospect_sources", "outbound_import_rows", "outbound_consent_artifacts",
  "outbound_dnc", "outbound_appointments", "outbound_autofill_corrections", "appointment_reminder_events", "call_results", "call_update_logs",
  "disposition_events", "app_fix_banking_updates", "app_fix_carrier_requirements", "app_fix_tasks", "course_enrollments",
] as const;

/** What the certificate says is kept, and why: every category retained, with its reason. */
export function retainedCategories() {
  return Object.entries(DATA_SUBJECT_MAP)
    .filter(([, t]) => (t.action === "keep" || t.action === "anonymise") && t.reason)
    .map(([table, t]) => ({ table, action: t.action, reason: t.reason as string }));
}
