-- DO NOT RUN. Cancelled by the owner on 2026-11-02 ("Do not delete anything"); the end-to-end run
-- was done on the agency's data as it is. Kept only as a record of what a full wipe would touch.
--
-- Empty the demo agency "Ellery & Fields" (tenant d6f3950f-0d88-4e66-869f-0de2ea6b396b) of all its
-- work, keeping only its members, its partners and its settings, so the 2026-11-02 end-to-end run
-- starts from nothing. Owner's instruction (2026-11-02): delete leads, contacts, lead contacts, the
-- pipeline, policies, everything; "but not members and not partners and not the settings. So
-- nothing should change besides those deletions."
-- Paste the whole file into the Supabase SQL editor and run it once. Nobody has run it yet.
--
-- HOW "THE PIPELINE" IS READ: as what is inside the pipelines (the cards, i.e. the leads, and their
-- stage history). The pipeline definitions and their stages are KEPT, because the run needs them
-- and they are settings. If the pipelines themselves were meant too, say so and they will be added.
--
-- REMOVED (133 tables, about 316,592 rows as counted on 2026-11-02, this tenant only):
--   Leads and contacts: agent_leads (16,049), lead_queue, per-lead sources, lead lists
--     (agent_lead_import_batches), contacts (2,853, provisional ones included) with their phones,
--     emails and income, households, duplicate reviews, merges.
--   Selling: applications and every application table (cases, values, quotes, interviews and their
--     medications, submissions, payments, beneficiaries, disclosures, requirements, counteroffers,
--     welcome packs, copy-assist ticks, extension grants), deal flow, calls and call attempts,
--     provider calls, callbacks and their history, appointments with clients, notes, stage
--     history, SLA events, disposition walks, transfers and verdicts, screening results, consent
--     records, DNC look-ups, scoring decisions, scrub runs, nurture and recycle runs,
--     notifications, alerts.
--   Book and money: every carrier file and raw row, policy, snapshot, change, event, link, review,
--     Needs you item, ledger line, expected commission, discrepancy, statement, retention and save
--     row, risk score, bank import and transaction, deposit match, vendor invoice, expense, cost
--     entry, partner and producer payout runs with their items and lines.
--   Compliance records about those people: complaints, deadlines, deletion requests, legal holds,
--     the compliance index and report log, the sensitive-access log, webhook deliveries.
--   Also removed with them by the database's own cascades: the 383 partner chat messages that sit
--     on a lead's thread (of 867; the other 484 stay), and rows with no tenant column that hang off
--     removed rows (verification fields, walk steps, disclosure rules, unmapped-status
--     occurrences, contact merge log).
--
-- KEPT (111 tables, about 40,906 rows), unchanged:
--   Members: tenant_users (17), invitations, sessions, producers and their hierarchy, contract
--     levels, writing numbers, licences, CE, E&O, carrier appointments by state, availability,
--     blocks, booking policy, access presets, notification settings, assistants.
--   Partners: partners (30) and partner_users (30), their profiles, presets, affiliate links,
--     channels and the chat messages not on a lead's thread, tax profiles, vendors and post keys,
--     campaigns and their recycle rules.
--   Settings: the agency and its profile, plan, subscription, entitlements, billing and usage
--     meters, carriers and states, products, rate card, advance rules, carrier rules and settings,
--     layouts and field maps, agent codes, pipelines and stages, dispositions and flows, the
--     application stage map, scripts, rebuttals, templates and field sets, cadence and calling
--     windows, assignment and queue rules, scoring, retention, compliance and accounting settings,
--     webhooks, API keys, the setup guide, the settings audit.
--   The DNC and suppression lists (71 and 8 entries) stay. On 54 DNC entries the database itself
--     clears the link to the removed lead (that foreign key is ON DELETE SET NULL); the number and
--     reason stay. That is the one change to a kept row, and it can't be avoided while the leads go.
--   Outside the tenant tables: users (the logins) and the platform audit log.
--
-- STORAGE is not touched by SQL: uploaded carrier files, application confirmations and chat
-- attachments stay in their buckets, unreferenced. Nothing re-reads them.
--
-- SAFETY: one transaction. The tenant name is checked first. Every delete or update trigger on the
-- tables involved (the guards that refuse deletes by design, and the counters that would touch kept
-- rows) is switched off for this transaction only, and back on before it ends. Each table is
-- emptied for this tenant only; tables that point at each other are retried until they empty. Then
-- three proofs: every removed table is empty for this tenant; every kept table holds exactly the
-- rows it held (partner_messages less only its lead-thread messages); every trigger in the
-- database is on. Any mismatch raises, and the WHOLE script rolls back.
begin;

do $$
declare
  v_t constant uuid := 'd6f3950f-0d88-4e66-869f-0de2ea6b396b';
  v_delete constant text[] := array[
    'active_calls', 'agency_attribution_item', 'agency_variance_review', 'agent_findings', 'agent_floor_nudges',
    'agent_notifications', 'application_review', 'assignment_skip_events', 'buffer_handoffs', 'callback_history',
    'commission_discrepancy', 'complaint', 'compliance_complaint_deadline', 'compliance_index',
    'compliance_index_reconciliation', 'compliance_report_log', 'contact_emails', 'contact_income_access_log',
    'contact_phones', 'conversion_attempt', 'deletion_request_event', 'deposit_match', 'disposition_walks',
    'email_log', 'expected_commission', 'file_registry_skips', 'form_drafts', 'intake_alerts',
    'lead_assignment_events', 'lead_claim_items', 'lead_note_edits', 'lead_note_mentions', 'lead_notifications',
    'legal_hold', 'partner_notifications', 'partner_rejected_submissions', 'payout_run_item', 'pipeline_stage_run',
    'policy_change', 'policy_current', 'policy_event', 'policy_match_ladder', 'policy_match_review',
    'policy_risk_score', 'policy_risk_signals', 'policy_split', 'prediction_outcome', 'producer_ledger_entry',
    'provider_calls', 'queue_item', 'reinstatement_case', 'reprocess_runs', 'retention_assignment',
    'retention_holdout', 'retention_run', 'save_queue_hold', 'screening_audit', 'screening_cache_locks',
    'tenant_application_beneficiaries', 'tenant_application_counteroffers', 'tenant_application_disclosures',
    'tenant_application_payment_methods', 'tenant_application_submissions', 'tenant_application_values',
    'tenant_appointment_reminder_events', 'tenant_campaign_scrub_runs', 'tenant_commission_statement_lines',
    'tenant_consent_artefacts', 'tenant_contact_rate_stats', 'tenant_copy_assist_ticks', 'tenant_dial_dnc_checks',
    'tenant_extension_events', 'tenant_lead_activity', 'tenant_lead_post_log', 'tenant_lead_sla_events',
    'tenant_lead_sources', 'tenant_lead_stage_events', 'tenant_medications', 'tenant_nurture_reactivations',
    'tenant_scoring_decisions', 'tenant_sensitive_access_log', 'tenant_sla_daily_digests',
    'tenant_uw_answer_changes', 'tenant_uw_answers', 'tenant_welcome_packs', 'transfer_verdict',
    'vendor_invoice_line', 'verification_field_changes', 'webhook_delivery', 'winback_candidate',
    'application_disclosures', 'bank_transaction', 'carrier_account_statement', 'commission_entry', 'deal_flow',
    'deletion_request', 'intake_failures', 'lead_claims', 'pipeline_run', 'policy_match', 'policy_snapshot',
    'producer_payout_run', 'tenant_application_requirements', 'tenant_appointments',
    'tenant_campaign_scrub_rejections', 'tenant_commission_statements', 'tenant_extension_grants',
    'tenant_lead_notes', 'tenant_recycle_batches', 'tenant_uw_interviews', 'tenant_verification_sessions',
    'bank_import', 'cost_entry', 'raw_rows', 'tenant_callbacks', 'expense', 'file_registry', 'payout_run',
    'tenant_call_attempts', 'vendor_invoice', 'lead_queue', 'agent_lead_import_batches', 'agent_leads',
    'contact_duplicate_reviews', 'contacts', 'households', 'merge_log', 'save_attempt', 'screening_results',
    'servicing_request', 'tenant_application_cases', 'tenant_applications', 'tenant_quotes'];
  v_keep constant text[] := array[
    'tenant_users', 'user_invitations', 'tenant_user_session', 'user_security_event', 'agent_presence',
    'tenant_user_licensed_states', 'tenant_user_producer_profiles', 'producer', 'producer_appointment',
    'producer_contract_level', 'producer_hierarchy', 'producer_onboarding_item', 'producer_writing_number',
    'assistant_producer', 'agent_capacity', 'tenant_agent_availability', 'tenant_agent_blocks',
    'tenant_agent_booking_policy', 'licenses', 'ce_records', 'eo_policies', 'agent_notification_settings',
    'tenant_access_presets', 'tenant_member_activity', 'partners', 'partner_users', 'partner_form_presets',
    'partner_market_access_profiles', 'partner_submission_profiles', 'affiliate_links', 'partner_channels',
    'partner_channel_members', 'partner_channel_user_state', 'partner_messages', 'partner_message_attachments',
    'partner_message_mentions', 'partner_message_reads', 'payee_tax_profile', 'tenant_lead_vendors',
    'tenant_vendor_post_keys', 'tenant_campaigns', 'tenant_campaign_recycle_rules', 'agency', 'agency_profiles',
    'agency_profile_history', 'business_profiles', 'subscriptions', 'tenant_entitlements', 'tenant_credits',
    'payments', 'platform_invoices', 'credit_notes', 'usage_totals', 'usage_events', 'accounting_settings',
    'accounting_setting_change', 'advance_rules', 'assignment_rules', 'assignment_settings', 'bank_account',
    'carrier_agent_map', 'carrier_field_map', 'carrier_operating_settings', 'carrier_product_family',
    'carrier_products', 'carrier_retention_rule', 'commission_schedules', 'compliance_settings',
    'compliance_setting_change', 'dispositions', 'field_schema', 'pipeline_disposition_stages',
    'queue_assignment_rule', 'retention_rule', 'retention_settings', 'retention_setting_change', 'sales_templates',
    'settings_audit', 'stage_dispositions', 'tenant_application_stage_map', 'tenant_booking_settings',
    'tenant_cadence_rules', 'tenant_cadence_versions', 'tenant_calling_window_options', 'tenant_calling_windows',
    'tenant_carrier_commission_contacts', 'tenant_carrier_requirements', 'tenant_carrier_settings',
    'tenant_carriers', 'tenant_disposition_flows', 'tenant_import_mappings', 'tenant_pipelines', 'tenant_products',
    'tenant_queue_sla_settings', 'tenant_rebuttals', 'tenant_sales_settings', 'tenant_scoring_settings',
    'tenant_scripts', 'tenant_setup_guide', 'tenant_statement_column_mappings', 'tenant_template_assignments',
    'tenant_template_fields', 'tenant_template_forms', 'tenant_template_stages', 'tenant_templates',
    'tenant_suppression_list', 'tenant_do_not_call', 'webhook_subscription', 'api_key', 'producer_split',
    'appointments'];
  v_extra constant text[] := array[
    'partner_messages', 'tenant_do_not_call', 'unmapped_status_occurrences', 'contact_merge_log',
    'verification_fields', 'disposition_walk_steps', 'application_disclosure_rules', 'leads'];
  v_before jsonb := '{}';
  v_thread_msgs bigint;
  v_expected bigint;
  v_guards text[][] := '{}';
  v_g record;
  v_rel regclass;
  v_tbl text;
  v_left text[];
  v_progress boolean;
  v_pass integer := 0;
  v_ok boolean;
  i integer;
  n bigint;
  v_bad text;
begin
  if (select name from public.tenants where id = v_t) is distinct from 'Ellery & Fields' then
    raise exception 'wipe: % is not Ellery & Fields; nothing changed', v_t;
  end if;

  -- What the kept tables hold now, to prove afterwards that they hold the same.
  foreach v_tbl in array v_keep loop
    execute format('select count(*) from public.%I where tenant_id = $1', v_tbl) into n using v_t;
    v_before := v_before || jsonb_build_object(v_tbl, n);
  end loop;
  select count(*) into v_thread_msgs from public.partner_messages
    where tenant_id = v_t and work_item_id in (select id from public.lead_queue where tenant_id = v_t);

  -- Every row trigger that fires on DELETE or UPDATE on those tables (its own, not a partition's copy).
  for v_g in select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
              where c.relnamespace = 'public'::regnamespace and c.relname = any(v_delete || v_extra)
                and not t.tgisinternal and t.tgparentid = 0 and (t.tgtype & 24) <> 0 loop
    v_guards := v_guards || array[array[v_g.relname::text, v_g.tgname::text]];
  end loop;
  if coalesce(array_length(v_guards, 1), 0) < 20 then
    raise exception 'wipe: found only % triggers to switch off, expected at least 20; nothing changed', coalesce(array_length(v_guards, 1), 0);
  end if;
  for i in 1 .. array_length(v_guards, 1) loop
    execute format('alter table public.%I disable trigger %I', v_guards[i][1], v_guards[i][2]);
    for v_rel in select inhrelid::regclass from pg_inherits where inhparent = ('public.' || v_guards[i][1])::regclass loop
      execute format('alter table %s disable trigger %I', v_rel, v_guards[i][2]);
    end loop;
  end loop;

  -- Rows with no tenant column that would block a delete, and one self-reference.
  delete from public.unmapped_status_occurrences where file_id in (select id from public.file_registry where tenant_id = v_t);
  delete from public.contact_merge_log
    where kept_id in (select id from public.contacts where tenant_id = v_t)
       or merged_id in (select id from public.contacts where tenant_id = v_t);
  delete from public.producer_ledger_entry where tenant_id = v_t and adjusts_entry_id is not null;

  -- Children first; a table something still points at is retried on the next pass.
  v_left := v_delete;
  loop
    v_pass := v_pass + 1;
    v_progress := false;
    foreach v_tbl in array v_left loop
      begin
        execute format('delete from public.%I where tenant_id = $1', v_tbl) using v_t;
        v_progress := true;
      exception when foreign_key_violation then
        null;
      end;
    end loop;
    v_left := '{}';
    foreach v_tbl in array v_delete loop
      execute format('select exists (select 1 from public.%I where tenant_id = $1)', v_tbl) into v_ok using v_t;
      if v_ok then v_left := v_left || v_tbl; end if;
    end loop;
    exit when cardinality(v_left) = 0;
    if not v_progress or v_pass >= 25 then
      raise exception 'wipe: could not empty % after % passes; rolled back', array_to_string(v_left, ', '), v_pass;
    end if;
  end loop;

  -- Triggers back on (the delayed checks run first, or the tables can't be altered).
  set constraints all immediate;
  for i in 1 .. array_length(v_guards, 1) loop
    execute format('alter table public.%I enable trigger %I', v_guards[i][1], v_guards[i][2]);
    for v_rel in select inhrelid::regclass from pg_inherits where inhparent = ('public.' || v_guards[i][1])::regclass loop
      execute format('alter table %s enable trigger %I', v_rel, v_guards[i][2]);
    end loop;
  end loop;

  -- Proof 1: every removed table is empty for this tenant.
  foreach v_tbl in array v_delete loop
    execute format('select count(*) from public.%I where tenant_id = $1', v_tbl) into n using v_t;
    if n > 0 then raise exception 'wipe: % still holds % rows; rolled back', v_tbl, n; end if;
  end loop;

  -- Proof 2: every kept table holds what it held (partner_messages less its lead-thread messages).
  foreach v_tbl in array v_keep loop
    execute format('select count(*) from public.%I where tenant_id = $1', v_tbl) into n using v_t;
    v_expected := (v_before ->> v_tbl)::bigint;
    if v_tbl = 'partner_messages' then v_expected := v_expected - v_thread_msgs; end if;
    if n <> v_expected then
      v_bad := coalesce(v_bad || ', ', '') || format('%s %s to %s', v_tbl, v_before ->> v_tbl, n);
    end if;
  end loop;
  if v_bad is not null then raise exception 'wipe: kept tables changed (%); rolled back', v_bad; end if;

  -- Proof 3: every trigger in the database is on.
  select count(*) into n from pg_trigger where not tgisinternal and tgenabled <> 'O';
  if n > 0 then raise exception 'wipe: % trigger(s) still off; rolled back', n; end if;

  raise notice 'wipe: done in % passes; % triggers switched off and back on; % lead-thread chat messages removed',
    v_pass, array_length(v_guards, 1), v_thread_msgs;
end $$;

-- Should read 0 leads, 0 contacts, 0 applications, 0 policies, 0 files, 0 ledger lines, 0 needs you,
-- 17 members, 30 partners, 6 pipelines, 0 triggers off.
select
  (select count(*) from public.agent_leads where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as leads,
  (select count(*) from public.contacts where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as contacts,
  (select count(*) from public.tenant_applications where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as applications,
  (select count(*) from public.policy_current where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as policies,
  (select count(*) from public.file_registry where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as files,
  (select count(*) from public.commission_entry where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as ledger_lines,
  (select count(*) from public.queue_item where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as needs_you,
  (select count(*) from public.tenant_users where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as members,
  (select count(*) from public.partners where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as partners,
  (select count(*) from public.tenant_pipelines where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as pipelines,
  (select count(*) from pg_trigger where not tgisinternal and tgenabled <> 'O') as triggers_off;

commit;
