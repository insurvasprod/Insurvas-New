-- ============================================================================
-- Pending migrations — 17 files, each in its own transaction
-- Generated 2026-09-30 by scripts/build-pending-bundle.mjs. Do not hand-edit; regenerate.
--
-- HOW TO RUN: Supabase dashboard → SQL editor → paste this whole file → Run.
-- Each file is begin … commit on its own. The SQL editor STOPS at the first error: that file is
-- rolled back, the files before it stay applied, and nothing after it runs. Fix the named file,
-- regenerate, and run the whole script again — re-running is safe: the files use
-- create-or-replace / if-not-exists, and history rows use on-conflict-do-nothing.
--
-- AFTERWARDS: node --env-file=.env.local scripts/verify-applied-migrations.mjs
--
-- Files, in order:
--    1. 20260925510000_screening_versions_are_known_or_refused.sql
--    2. 20260925510100_form_drafts_any_started_form_resumes.sql
--    3. 20260925510200_partner_intake_reconciliation_logs_and_runs.sql
--    4. 20260925515000_bank_routing_and_account_field_types.sql
--    5. 20260925709850_inbound_transfer_foundations.sql
--    6. 20260925709860_inbound_requeue_resume_and_buffer_involvement.sql
--    7. 20260925709870_inbound_disposition_history_and_deal_buffer.sql
--    8. 20260925709900_unclaimed_sla_backlog_older_than_a_day_is_skipped.sql
--    9. 20260925709910_unclaimed_sla_side_effects_run_every_minute.sql
--   10. 20260925709950_partner_limits_count_active_partners_only.sql
--   11. 20260929110000_partner_limit_trigger_checks_tenant_partners.sql
--   12. 20260929120000_reconcile_partner_intake_for_one_tenant.sql
--   13. 20260929130000_partner_password_activates_invited_account.sql
--   14. 20260929140000_m1_partner_pipeline_lean_read_model.sql
--   15. 20260929140100_m1_preflight_indexed_candidates.sql
--   16. 20260929140200_m1_deal_flow_export_pages.sql
--   17. 20260929140300_m1_transfer_inbox_status_seek.sql
-- ============================================================================

-- ─── [1/17] 20260925510000_screening_versions_are_known_or_refused.sql ────────────
begin;

-- LA-1.5-10: a screening result is versioned on the lead, and an unknown version is refused.
--
-- QA 2026-09-25 (Design 1): agent_leads.screening_version accepted 99 (reverted) and nothing read the
-- version back. The application now refuses to store or replay a version it does not know
-- (lib/compliance/screeningCore.ts KNOWN_SCREENING_VERSIONS, createPartnerLead) and the lead
-- workspace shows an unknown version as "not trusted" instead of as a result. This makes the
-- database refuse it too, for writers that do not go through that code.
--
-- The known set is {1}. A future version 2 adds itself here in the same migration that teaches the
-- application to read it. Checked live before writing: no agent_leads row and no screening_results
-- row has a version other than 1, so both constraints validate.

alter table public.agent_leads drop constraint if exists agent_leads_screening_version_known;
alter table public.agent_leads add constraint agent_leads_screening_version_known
  check (screening_version is null or screening_version in (1)) not valid;
alter table public.agent_leads validate constraint agent_leads_screening_version_known;

alter table public.screening_results drop constraint if exists screening_results_version_known;
alter table public.screening_results add constraint screening_results_version_known
  check (version in (1)) not valid;
alter table public.screening_results validate constraint screening_results_version_known;

do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925510000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.agent_leads'::regclass and conname = 'agent_leads_screening_version_known' and convalidated
  ) then
    raise exception 'agent_leads still accepts an unknown screening version';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.screening_results'::regclass and conname = 'screening_results_version_known' and convalidated
  ) then
    raise exception 'screening_results still accepts an unknown version';
  end if;
  -- The effect, not just the name: version 99 is refused.
  begin
    update public.agent_leads set screening_version = 99
     where id = (select id from public.agent_leads where screening_version is not null limit 1);
    if found then raise exception 'agent_leads accepted screening_version 99'; end if;
  exception when check_violation then null;
  end;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925510000', 'screening_versions_are_known_or_refused') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [2/17] 20260925510100_form_drafts_any_started_form_resumes.sql ───────────────
begin;

-- LA-1.6-5: the partner portal keeps a list of drafts, and any started form can be resumed.
--
-- QA 2026-09-25 (Design 1): form_drafts allowed one draft per user per product
-- (form_drafts_owner_product_idx on tenant_id, user_id, product_code, owner_key), so a second form
-- for the same product overwrote the first, and a draft for another product came back only by
-- picking that product.
--
-- 1. form_drafts.is_multi marks a draft saved by the draft-list portal. Those rows are addressed by
--    id, so a partner user can hold several for one product. Existing rows stay false.
-- 2. The one-per-product unique index now covers only the legacy rows (where not is_multi). The two
--    existing save functions are restated from their latest definitions (save_form_draft:
--    20260902130000; save_partner_form_draft: 20260916100000) with the matching conflict target
--    `on conflict (...) where not is_multi`; nothing else in them changes, and create or replace
--    keeps their grants. The agent-side form (save_form_draft, partner_id null) keeps one draft per
--    product, as before.
-- 3. save_partner_form_draft_slot(..., p_draft_id) inserts a new draft (p_draft_id null) or updates
--    that user's own draft by id. At most 25 drafts per partner user.
--
-- The app works before this is applied: it falls back to save_partner_form_draft, which keeps the
-- old one-draft-per-product behaviour, and the list simply has one row per product.

alter table public.form_drafts add column if not exists is_multi boolean not null default false;

create or replace function public.save_form_draft(
  p_tenant_id uuid, p_partner_id uuid, p_user_id uuid, p_product_code text,
  p_tenant_template_id uuid, p_definition_version integer, p_payload jsonb
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare draft_id uuid;
begin
  insert into public.form_drafts (tenant_id, partner_id, user_id, product_code, tenant_template_id, definition_version, payload)
  values (p_tenant_id, p_partner_id, p_user_id, p_product_code, p_tenant_template_id, p_definition_version, p_payload)
  on conflict (tenant_id, user_id, product_code, owner_key) where not is_multi do update set
    tenant_template_id = excluded.tenant_template_id,
    definition_version = excluded.definition_version,
    payload = excluded.payload,
    updated_at = now()
  returning id into draft_id;
  return draft_id;
end;
$$;

create or replace function public.save_partner_form_draft(
  p_tenant_id uuid,
  p_partner_id uuid,
  p_user_id uuid,
  p_product_code text,
  p_tenant_template_id uuid,
  p_definition_version integer,
  p_profile_id uuid,
  p_profile_revision integer,
  p_payload jsonb
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  draft_id uuid;
begin
  if p_partner_id is null then raise exception 'partner_required'; end if;
  if p_profile_id is not null and not exists (
    select 1 from public.partner_submission_profiles p
    where p.id = p_profile_id
      and p.tenant_id = p_tenant_id
      and p.partner_id = p_partner_id
      and p.product_code = p_product_code
  ) then raise exception 'invalid_partner_submission_profile'; end if;
  if p_profile_id is not null and p_profile_revision is null then raise exception 'profile_revision_required'; end if;
  if p_profile_id is not null and not exists (
    select 1 from public.partner_submission_profile_revisions r
    where r.profile_id = p_profile_id and r.revision = p_profile_revision
  ) then raise exception 'invalid_partner_submission_profile_revision'; end if;

  insert into public.form_drafts (
    tenant_id, partner_id, user_id, product_code, tenant_template_id, definition_version,
    partner_submission_profile_id, partner_submission_profile_revision, payload
  ) values (
    p_tenant_id, p_partner_id, p_user_id, p_product_code, p_tenant_template_id, p_definition_version,
    p_profile_id, p_profile_revision, p_payload
  )
  on conflict (tenant_id, user_id, product_code, owner_key) where not is_multi do update set
    tenant_template_id = excluded.tenant_template_id,
    definition_version = excluded.definition_version,
    partner_submission_profile_id = excluded.partner_submission_profile_id,
    partner_submission_profile_revision = excluded.partner_submission_profile_revision,
    payload = excluded.payload,
    updated_at = now()
  returning id into draft_id;
  return draft_id;
end;
$$;

create unique index if not exists form_drafts_owner_product_single_idx
  on public.form_drafts (tenant_id, user_id, product_code, owner_key)
  where not is_multi;
drop index if exists public.form_drafts_owner_product_idx;
create index if not exists form_drafts_owner_list_idx
  on public.form_drafts (tenant_id, user_id, owner_key, updated_at desc);

create or replace function public.save_partner_form_draft_slot(
  p_tenant_id uuid,
  p_partner_id uuid,
  p_user_id uuid,
  p_product_code text,
  p_tenant_template_id uuid,
  p_definition_version integer,
  p_profile_id uuid,
  p_profile_revision integer,
  p_payload jsonb,
  p_draft_id uuid default null
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  v_saved uuid;
  v_open integer;
begin
  if p_partner_id is null then raise exception 'partner_required'; end if;
  if p_profile_id is not null and not exists (
    select 1 from public.partner_submission_profiles p
    where p.id = p_profile_id
      and p.tenant_id = p_tenant_id
      and p.partner_id = p_partner_id
      and p.product_code = p_product_code
  ) then raise exception 'invalid_partner_submission_profile'; end if;
  if p_profile_id is not null and p_profile_revision is null then raise exception 'profile_revision_required'; end if;
  if p_profile_id is not null and not exists (
    select 1 from public.partner_submission_profile_revisions r
    where r.profile_id = p_profile_id and r.revision = p_profile_revision
  ) then raise exception 'invalid_partner_submission_profile_revision'; end if;

  if p_draft_id is not null then
    update public.form_drafts d
       set tenant_template_id = p_tenant_template_id,
           definition_version = p_definition_version,
           partner_submission_profile_id = p_profile_id,
           partner_submission_profile_revision = p_profile_revision,
           payload = p_payload,
           updated_at = now()
     where d.id = p_draft_id
       and d.tenant_id = p_tenant_id
       and d.partner_id = p_partner_id
       and d.user_id = p_user_id
       and d.product_code = p_product_code
    returning d.id into v_saved;
    if v_saved is null then raise exception 'form_draft_not_found'; end if;
    return v_saved;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('form_drafts:' || p_user_id::text, 0));
  select count(*)::integer into v_open
    from public.form_drafts d
   where d.tenant_id = p_tenant_id and d.partner_id = p_partner_id and d.user_id = p_user_id;
  if v_open >= 25 then raise exception 'form_draft_limit_reached'; end if;

  insert into public.form_drafts (
    tenant_id, partner_id, user_id, product_code, tenant_template_id, definition_version,
    partner_submission_profile_id, partner_submission_profile_revision, payload, is_multi
  ) values (
    p_tenant_id, p_partner_id, p_user_id, p_product_code, p_tenant_template_id, p_definition_version,
    p_profile_id, p_profile_revision, p_payload, true
  )
  returning id into v_saved;
  return v_saved;
end;
$$;

revoke all on function public.save_partner_form_draft_slot(uuid, uuid, uuid, text, uuid, integer, uuid, integer, jsonb, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.save_partner_form_draft_slot(uuid, uuid, uuid, text, uuid, integer, uuid, integer, jsonb, uuid) to service_role;

do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925510100: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'form_drafts_owner_product_idx') then
    raise exception 'form_drafts still allows only one draft per product';
  end if;
  if not exists (
    select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
     where c.relname = 'form_drafts_owner_product_single_idx' and i.indisunique and i.indpred is not null
  ) then
    raise exception 'the legacy one-per-product index is missing or not partial';
  end if;
  if exists (
    select 1 from pg_proc
     where pronamespace = 'public'::regnamespace and proname in ('save_form_draft', 'save_partner_form_draft')
       and position('where not is_multi' in prosrc) = 0
  ) then
    raise exception 'a legacy draft save still targets the dropped index';
  end if;
  if to_regprocedure('public.save_partner_form_draft_slot(uuid,uuid,uuid,text,uuid,integer,uuid,integer,jsonb,uuid)') is null then
    raise exception 'save_partner_form_draft_slot is missing';
  end if;
  -- Run both paths once and roll them back: a PL/pgSQL body only resolves its names when it runs.
  begin
    perform public.save_partner_form_draft_slot(d.tenant_id, d.partner_id, d.user_id, d.product_code, d.tenant_template_id, d.definition_version, null, null, '{}'::jsonb, null)
       from public.form_drafts d where d.partner_id is not null limit 1;
    perform public.save_partner_form_draft(d.tenant_id, d.partner_id, d.user_id, d.product_code, d.tenant_template_id, d.definition_version, null, null, d.payload)
       from public.form_drafts d where d.partner_id is not null and not d.is_multi limit 1;
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925510100', 'form_drafts_any_started_form_resumes') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [3/17] 20260925510200_partner_intake_reconciliation_logs_and_runs.sql ────────
begin;

-- LA-1.7-3: no partner lead exists without a work item or a logged failure.
--
-- QA 2026-09-25 (Design 1): public.reconcile_partner_intake() (20260902170000) only LISTED partner
-- leads with neither a lead_queue row nor an intake_failures row. Nothing scheduled it and nothing
-- acted on what it found; one such lead sat undetected in the demo tenant.
--
-- 1. run_partner_intake_reconciliation() logs one intake_failures row (step 'work_item') for each
--    lead the check returns. The existing trigger (create_intake_failure_alert) opens an
--    intake_alerts row for it, so the orphan shows on /app/alerts like any other intake failure.
--    A lead that has a failure row is no longer returned by the check, so a lead is logged once.
--    Leads younger than 10 minutes are skipped: intake writes the work item a moment after the lead,
--    and a run landing in between must not log a false failure.
-- 2. pg_cron runs it every 15 minutes (job 'partner-intake-reconciliation'), plus a daily trim of
--    that job's run log to 7 days. Scheduling under an existing job name replaces it, so this file
--    can run again safely.
--
-- To stop it:  select cron.unschedule('partner-intake-reconciliation');
-- To see runs: select status, start_time, return_message from cron.job_run_details
--              where jobid = (select jobid from cron.job where jobname = 'partner-intake-reconciliation')
--              order by start_time desc limit 10;

create or replace function public.run_partner_intake_reconciliation(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orphan record;
  v_logged integer := 0;
begin
  -- One run at a time, so two overlapping runs cannot log the same lead twice.
  perform pg_advisory_xact_lock(hashtextextended('run_partner_intake_reconciliation', 0));
  for v_orphan in
    select r.lead_id as orphan_lead_id, r.tenant_id as orphan_tenant_id, r.submission_id as orphan_submission_id, r.missing_steps as orphan_steps
      from public.reconcile_partner_intake() r
      join public.agent_leads l on l.id = r.lead_id
     where l.created_at < now() - interval '10 minutes'
     order by l.created_at
     limit greatest(1, least(coalesce(p_limit, 500), 5000))
  loop
    insert into public.intake_failures (tenant_id, lead_id, step, error_message, metadata)
    values (
      v_orphan.orphan_tenant_id,
      v_orphan.orphan_lead_id,
      'work_item',
      'Reconciliation found this partner lead without a work item or a logged failure.',
      jsonb_build_object(
        'source', 'reconcile_partner_intake',
        'submission_id', v_orphan.orphan_submission_id,
        'missing_steps', to_jsonb(v_orphan.orphan_steps)
      )
    );
    v_logged := v_logged + 1;
  end loop;
  return v_logged;
end;
$$;

revoke all on function public.run_partner_intake_reconciliation(integer) from public, anon, authenticated, tenant_app;
grant execute on function public.run_partner_intake_reconciliation(integer) to service_role;

-- Supabase Cron is installed and granted by 20260924250100 (applied 2026-09-24).
select cron.schedule(
  'partner-intake-reconciliation',
  '*/15 * * * *',
  $cron$select public.run_partner_intake_reconciliation(500)$cron$
);

select cron.schedule(
  'partner-intake-reconciliation-log-cleanup',
  '41 3 * * *',
  $cron$delete from cron.job_run_details
         where jobid in (select jobid from cron.job where jobname = 'partner-intake-reconciliation')
           and end_time < now() - interval '7 days'$cron$
);

do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925510200: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if to_regprocedure('public.run_partner_intake_reconciliation(integer)') is null then
    raise exception 'run_partner_intake_reconciliation is missing';
  end if;
  -- Run the job's function once and roll it back (a PL/pgSQL body only resolves names when it runs;
  -- see 20260925709100). Then prove the effect: after a run, no lead older than the grace period is
  -- left without a work item or a failure row.
  begin
    perform public.run_partner_intake_reconciliation(5000);
    if exists (
      select 1 from public.reconcile_partner_intake() r
        join public.agent_leads l on l.id = r.lead_id
       where l.created_at < now() - interval '10 minutes'
    ) then
      raise exception 'reconciliation left a partner lead without a work item or a logged failure';
    end if;
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  if not exists (select 1 from cron.job where jobname = 'partner-intake-reconciliation' and schedule = '*/15 * * * *' and active) then
    raise exception 'the partner intake reconciliation is not scheduled';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925510200', 'partner_intake_reconciliation_logs_and_runs') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [4/17] 20260925515000_bank_routing_and_account_field_types.sql ───────────────
begin;

-- LA-1.4-6: bank routing and account numbers are form field types.
--
-- The spec's formats line names "SSN, phone, email, routing and account formats". SSN, phone and
-- email were field types; routing and account numbers were not, so a Banking section could only
-- ask for them as free text with no check. The application now has two more types
-- (lib/templates/constants.ts TEMPLATE_FIELD_TYPES):
--
--   bank_routing   nine digits passing the ABA checksum 3·7·1   (lib/templates/formats.ts)
--   bank_account   4 to 17 digits
--
-- Both are stored in lead values as a string of digits. The format checks run in the application
-- (partner form and intake); the database only has to accept the type names. Both catalogs widen:
-- template_fields (the platform templates) and tenant_template_fields (each tenant's copy, which
-- keeps the organizations-era hyphenated spellings from 20260912240000).
--
-- Until this is applied, saving a form with either type is refused by the check constraint and the
-- settings screen says so; nothing else changes.

alter table public.template_fields drop constraint if exists template_fields_type_check;
alter table public.template_fields add constraint template_fields_type_check
  check (type = any (array[
    'text'::text, 'long_text'::text, 'number'::text, 'currency'::text, 'date'::text, 'phone'::text,
    'email'::text, 'ssn'::text, 'bank_routing'::text, 'bank_account'::text, 'boolean'::text,
    'single_select'::text, 'multi_select'::text
  ]));

alter table public.tenant_template_fields drop constraint if exists tenant_template_fields_type_check;
alter table public.tenant_template_fields add constraint tenant_template_fields_type_check
  check (type = any (array[
    -- shared by both
    'text'::text, 'number'::text, 'currency'::text, 'date'::text, 'phone'::text, 'boolean'::text,
    -- this application's catalog (template_fields), per LA-1.4
    'long_text'::text, 'email'::text, 'ssn'::text, 'single_select'::text, 'multi_select'::text,
    -- LA-1.4-6
    'bank_routing'::text, 'bank_account'::text,
    -- organizations-era spellings, kept so existing rows stay valid
    'single-select'::text, 'multi-select'::text
  ]));

comment on constraint tenant_template_fields_type_check on public.tenant_template_fields is
  'Union of both products field-type vocabularies plus the LA-1.4-6 bank types. single-select and single_select are the same concept spelled two ways; see 20260912240000.';

do $$
begin
  -- A role that cannot create objects cannot have applied anything above either (scripts/
  -- check-migrations.mjs parse-checks with such a role); a real apply always reaches the checks.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925515000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'template_fields_type_check'
       and conrelid = 'public.template_fields'::regclass
       and pg_get_constraintdef(oid) like '%bank_routing%'
       and pg_get_constraintdef(oid) like '%bank_account%'
  ) then
    raise exception 'template_fields_type_check does not accept the bank field types';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'tenant_template_fields_type_check'
       and conrelid = 'public.tenant_template_fields'::regclass
       and pg_get_constraintdef(oid) like '%bank_routing%'
       and pg_get_constraintdef(oid) like '%bank_account%'
       and pg_get_constraintdef(oid) like '%single-select%'
  ) then
    raise exception 'tenant_template_fields_type_check does not accept the bank field types';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925515000', 'bank_routing_and_account_field_types') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [5/17] 20260925709850_inbound_transfer_foundations.sql ───────────────────────
begin;

-- Inbound transfers, part 1 of 3: the columns and helpers the other two files build on.
-- Apply in order: 709850, then 709860, then 709870. Each file checks the one before it.
--
--   LA-1.10-2   The inbox row's age. Partner forms collect date_of_birth, not age, so every partner
--               lead showed an age of "—". lead_values_age() reads values.age when a form recorded
--               one and otherwise works it out from the date of birth, for every lead already in the
--               queue.
--   LA-1.10-8   A dropped call can go back in the queue (requeued_at, requeue_count) and
--   LA-1.11-6   a re-claim resumes the same verification session (file 709860).
--   LA-1.14-9   A buffer who stays on the call after the handoff ends that involvement on its own
--               (buffer_ended_at), which is a different act from giving the transfer back.
--   LA-1.14-10  A caller who asked for another language: language_key(), lead_language_key() and
--               agent_speaks_language() are the one reading of "who can take this call".
--   LA-1.13-2   deal_flow.buffer_agent, and an initial quote composed from carrier, face and premium
--               when nobody gave one.
--   LA-1.12-10  tenant_lead_stage_events accepts 'inbound' as a source.
--
-- Reconciled against the live database on 2026-09-29 (read-only catalog reads):
--   * The stage-history source check is NOT restated from a fixed list any more. Live it already
--     allows 'inbound' (20260926000100) and 'application_sync' (LA-3, 20260926101000), the earlier
--     draft restated it without 'application_sync', which would have failed validation on the first
--     LA-3 sync row, or dropped LA-3's source. The block below only ever ADDS values, keeping every
--     value the live check has.
--   * list_transfer_inbox is restated from its live body (20260924250000), the one change is age.
--   * The initial-quote trigger never replaces a quote somebody gave (a partner's text, or an agent's
--     typed quote on a manual deal). It fills the blank. The backfill likewise only fills blanks.
--   * lead_value_cents reads whole cents only: template currency fields store integer cents, and a
--     decimal string ("50.72") is a dollar amount this function cannot tell apart, so it is skipped.
--   * The lead_queue buffer_ended_at backfill is gone: it only touched finished transfers, bumped
--     their updated_at and broadcast a floor change per row. Finished transfers are excluded by
--     status instead (end_buffer_involvement in 709860 refuses them).
--
-- Down: drop the trigger deal_flow_compose_initial_quote and the functions lead_values_age,
-- language_key, lead_language_key, agent_speaks_language, compose_initial_quote, lead_value_cents,
-- deal_flow_compose_initial_quote, restate list_transfer_inbox from 20260924250000, drop the columns
-- lead_queue.buffer_ended_at/requeued_at/requeue_count and deal_flow.buffer_agent (after 709860 and
-- 709870 are rolled back). The stage-history source is left as it is (other files use it).

-- ── columns ─────────────────────────────────────────────────────────────────
alter table public.lead_queue
  add column if not exists buffer_ended_at timestamptz,
  add column if not exists requeued_at timestamptz,
  add column if not exists requeue_count integer not null default 0;

alter table public.deal_flow
  add column if not exists buffer_agent uuid references public.users(id) on delete set null;

create index if not exists deal_flow_buffer_agent_idx
  on public.deal_flow (tenant_id, buffer_agent) where buffer_agent is not null;

-- ── stage history sources ───────────────────────────────────────────────────
-- Adds 'inbound' (and 'dialer', for a replay where 20260925711300 has not run yet) to whatever the
-- live check allows. A no-op when both are already there, which is the live state on 2026-09-29.
do $$
declare
  v_def text;
  v_values text[];
  v_needed constant text[] := array['board', 'table', 'list', 'lead_detail', 'owner_fix', 'dialer', 'inbound'];
  v_list text;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = 'public.tenant_lead_stage_events'::regclass
     and c.conname = 'tenant_lead_stage_events_source_check';
  select coalesce(array_agg(distinct t.m[1]), '{}'::text[]) into v_values
    from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') as t(m);
  if v_def is not null and v_values @> v_needed then
    raise notice '20260925709850: stage history already accepts %', array_to_string(v_values, ', ');
    return;
  end if;
  select string_agg(quote_literal(s.v), ', ' order by s.v) into v_list
    from (select distinct unnest(v_values || v_needed) as v) s;
  execute format(
    'alter table public.tenant_lead_stage_events drop constraint if exists tenant_lead_stage_events_source_check, '
    || 'add constraint tenant_lead_stage_events_source_check check (source = any (array[%s])) not valid', v_list);
  execute 'alter table public.tenant_lead_stage_events validate constraint tenant_lead_stage_events_source_check';
end $$;

-- ── age ─────────────────────────────────────────────────────────────────────
-- Whole years on p_on. Accepts YYYY-MM-DD (the date field's stored form, optionally with a time)
-- and MM/DD/YYYY. Anything else, a date in the future, or past 130 years reads as unknown (null),
-- never as an error that would take the whole inbox down.
create or replace function public.lead_values_age(p_values jsonb, p_on date default current_date)
returns text
language plpgsql
stable
set search_path = pg_catalog
as $function$
declare
  v_raw text;
  v_dob date;
  v_years integer;
begin
  if p_values is null or jsonb_typeof(p_values) <> 'object' then return null; end if;
  v_raw := nullif(btrim(coalesce(p_values->>'age', '')), '');
  if v_raw is not null then return v_raw; end if;
  v_raw := nullif(btrim(coalesce(p_values->>'date_of_birth', p_values->>'dob', p_values->>'birth_date', '')), '');
  if v_raw is null then return null; end if;
  begin
    if v_raw ~ '^\d{4}-\d{2}-\d{2}' then
      v_dob := make_date(substr(v_raw, 1, 4)::integer, substr(v_raw, 6, 2)::integer, substr(v_raw, 9, 2)::integer);
    elsif v_raw ~ '^\d{1,2}/\d{1,2}/\d{4}$' then
      v_dob := make_date(split_part(v_raw, '/', 3)::integer, split_part(v_raw, '/', 1)::integer, split_part(v_raw, '/', 2)::integer);
    else
      return null;
    end if;
  exception when others then
    return null;
  end;
  if v_dob > p_on then return null; end if;
  v_years := extract(year from age(p_on, v_dob))::integer;
  if v_years > 130 then return null; end if;
  return v_years::text;
end;
$function$;

-- ── language ────────────────────────────────────────────────────────────────
-- One spelling for a language, whichever way it was written: 'Spanish', 'spanish', 'es', 'es-MX'
-- all read 'spanish'. The same code list the Agent Floor uses (lib/transferInbox/constants.ts
-- languageKey). Null when nothing is recorded.
create or replace function public.language_key(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog
as $function$
  select case
    when s.v is null or s.v = '' then null
    when s.v ~ '^[a-z]{2,3}([-_][a-z0-9]{2,8})?$' then coalesce((
      select m.name
        from (values ('es', 'spanish'), ('en', 'english'), ('fr', 'french'), ('pt', 'portuguese'), ('zh', 'chinese'),
                     ('vi', 'vietnamese'), ('ko', 'korean'), ('tl', 'tagalog'), ('ar', 'arabic'), ('ru', 'russian'),
                     ('ht', 'haitian creole')) as m(code, name)
       where m.code = split_part(split_part(s.v, '-', 1), '_', 1)
    ), s.v)
    else s.v
  end
  from (select lower(btrim(p_value)) as v) s
$function$;

-- The language the caller asked for, from the lead's own values. English, or nothing recorded,
-- needs no pairing and reads as null.
create or replace function public.lead_language_key(p_values jsonb)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $function$
  select nullif(public.language_key(coalesce(
    nullif(btrim(p_values->>'language'), ''),
    nullif(btrim(p_values->>'preferred_language'), ''),
    nullif(btrim(p_values->>'language_code'), '')
  )), 'english')
$function$;

-- Whether this member can take a call in that language. Everybody speaks English. Otherwise the
-- language must be on their capacity row (agent_capacity.languages, Settings > Team & access).
create or replace function public.agent_speaks_language(p_tenant_id uuid, p_user_id uuid, p_language_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  select p_language_key is null
      or p_language_key = 'english'
      or exists (
        select 1
          from public.agent_capacity c
          cross join lateral unnest(coalesce(c.languages, '{}'::text[])) as spoken(language)
         where c.tenant_id = p_tenant_id
           and c.user_id = p_user_id
           and public.language_key(spoken.language) = p_language_key
      )
$function$;

revoke all on function public.agent_speaks_language(uuid, uuid, text) from public, anon, authenticated, tenant_app;
grant execute on function public.agent_speaks_language(uuid, uuid, text) to service_role;

-- ── the composed initial quote ──────────────────────────────────────────────
-- "Carrier · $25,000 face · $48.50/mo", from whichever of the three are known. Null when none is.
create or replace function public.compose_initial_quote(p_carrier text, p_face_amount_cents bigint, p_monthly_premium_cents bigint)
returns text
language sql
immutable
set search_path = pg_catalog
as $function$
  select nullif(concat_ws(' · ',
    nullif(btrim(p_carrier), ''),
    case when p_face_amount_cents is not null and p_face_amount_cents > 0
         then '$' || to_char(p_face_amount_cents / 100.0, 'FM999,999,999,990') || ' face' end,
    case when p_monthly_premium_cents is not null and p_monthly_premium_cents > 0
         then '$' || to_char(p_monthly_premium_cents / 100.0, 'FM999,999,990.00') || '/mo' end
  ), '')
$function$;

-- A cents amount from a lead value: template currency fields store integer cents. A decimal string
-- ("50.72") is a dollar amount typed as text and is not read, so it can never show as 51 cents.
create or replace function public.lead_value_cents(p_values jsonb, p_keys text[])
returns bigint
language sql
immutable
set search_path = pg_catalog
as $function$
  select (
    select btrim(p_values->>k)::bigint
      from unnest(p_keys) with ordinality as keys(k, n)
     where coalesce(btrim(p_values->>k), '') ~ '^[0-9]{1,15}$'
     order by n
     limit 1
  )
$function$;

-- An initial quote somebody gave -- the partner's text, or an agent's typed quote on a manual deal --
-- is never replaced. A blank one is composed from the deal row's carrier, face and premium, or, on a
-- new row that has none of them, from the partner's submission.
create or replace function public.deal_flow_compose_initial_quote()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_values jsonb;
  v_composed text;
begin
  if nullif(btrim(coalesce(new.initial_quote, '')), '') is not null then
    return new;
  end if;
  v_composed := public.compose_initial_quote(new.carrier, new.face_amount_cents, new.monthly_premium_cents);
  if v_composed is null and tg_op = 'INSERT' then
    select l.values into v_values from public.agent_leads l where l.id = new.lead_id and l.tenant_id = new.tenant_id;
    if v_values is not null and jsonb_typeof(v_values) = 'object' then
      v_composed := public.compose_initial_quote(
        nullif(btrim(coalesce(v_values->>'carrier', v_values->>'quoted_carrier', v_values->>'preferred_carrier', '')), ''),
        public.lead_value_cents(v_values, array['face_amount_cents', 'face_amount', 'coverage_amount']),
        public.lead_value_cents(v_values, array['monthly_premium_cents', 'monthly_premium', 'quoted_premium', 'premium']));
    end if;
  end if;
  if v_composed is not null then new.initial_quote := left(v_composed, 1000); end if;
  return new;
end;
$function$;

revoke all on function public.lead_values_age(jsonb, date) from public, anon, authenticated;
revoke all on function public.language_key(text) from public, anon, authenticated;
revoke all on function public.lead_language_key(jsonb) from public, anon, authenticated;
revoke all on function public.compose_initial_quote(text, bigint, bigint) from public, anon, authenticated;
revoke all on function public.lead_value_cents(jsonb, text[]) from public, anon, authenticated;
revoke all on function public.deal_flow_compose_initial_quote() from public, anon, authenticated, tenant_app;
grant execute on function public.lead_values_age(jsonb, date) to service_role, tenant_app;
grant execute on function public.language_key(text) to service_role, tenant_app;
grant execute on function public.lead_language_key(jsonb) to service_role, tenant_app;
grant execute on function public.compose_initial_quote(text, bigint, bigint) to service_role, tenant_app;
grant execute on function public.lead_value_cents(jsonb, text[]) to service_role, tenant_app;

drop trigger if exists deal_flow_compose_initial_quote on public.deal_flow;
create trigger deal_flow_compose_initial_quote
  before insert or update of carrier, face_amount_cents, monthly_premium_cents on public.deal_flow
  for each row execute function public.deal_flow_compose_initial_quote();

-- ── the inbox, with an age for every lead ───────────────────────────────────
-- Restated from the live definition (20260924250000, read 2026-09-29). One change: the age column.
create or replace function public.list_transfer_inbox(p_tenant_id uuid, p_status text default 'unclaimed'::text, p_partner_id uuid default null::uuid, p_product_line text default null::text, p_state text default null::text, p_screening_outcome text default null::text, p_claimed_by uuid default null::uuid)
returns table(id uuid, lead_id uuid, partner_id uuid, partner_name text, product_line text, status text, owner_user_id uuid, owner_name text, claimed_at timestamp with time zone, queued_at timestamp with time zone, wait_seconds integer, customer text, age text, state text, screening_outcome text, screening_warning text, duplicate_warning boolean, preflight_status text, preflight_result jsonb)
language sql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select newest.* from (
    select q.id as id, q.lead_id as lead_id, q.partner_id as partner_id, coalesce(p.name, 'Unassigned partner') as partner_name, q.product_line as product_line,
      q.status as status, coalesce(q.owner_user_id, q.claimed_by) as owner_user_id, u.name as owner_name, q.claimed_at as claimed_at, q.queued_at as queued_at,
      greatest(0, floor(extract(epoch from (now() - q.queued_at)))::integer) as wait_seconds,
      coalesce(nullif(btrim(l.values->>'full_name'), ''), nullif(btrim(l.values->>'name'), ''),
        nullif(btrim(concat_ws(' ', l.values->>'first_name', l.values->>'last_name')), ''), 'Unnamed customer') as customer,
      -- LA-1.10-2: the recorded age, else worked out from the date of birth.
      coalesce(public.lead_values_age(l.values), '—') as age,
      coalesce(nullif(btrim(l.values->>'state'), ''), nullif(btrim(l.values->>'state_code'), ''), nullif(btrim(l.values->>'primary_state'), ''), nullif(btrim(l.carrier_state), ''), '—') as state,
      coalesce(nullif(btrim(q.screening_outcome), ''), nullif(btrim(l.screening_outcome), ''), 'not_checked') as screening_outcome,
      coalesce(q.screening_warning, l.screening_warning) as screening_warning,
      coalesce((l.values->>'duplicate_warning')::boolean, false) as duplicate_warning, l.preflight_status as preflight_status, l.preflight_result as preflight_result
    from public.lead_queue q
    join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
    left join public.partners p on p.id = q.partner_id and p.tenant_id = q.tenant_id
    left join public.users u on u.id = coalesce(q.owner_user_id, q.claimed_by)
    where q.tenant_id = p_tenant_id
      -- Inbound transfers only: a dialer lead is served by the dialer, not claimed from the inbox.
      and q.partner_id is not null
      and (p_status = 'all'
        -- Everything still being worked: waiting, or with an agent. Terminal history is not.
        or (p_status = 'open' and q.status in ('unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active'))
        -- "Claimed" in the inbox means with an agent, at whichever stage: a buffer assistant, a
        -- handoff in flight, or the licensed agent. Only the first of those is status 'claimed'.
        or (p_status = 'claimed' and q.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active'))
        or q.status = p_status)
      and (p_partner_id is null or q.partner_id = p_partner_id)
      and (p_product_line is null or q.product_line = p_product_line)
      and (p_claimed_by is null or coalesce(q.owner_user_id, q.claimed_by) = p_claimed_by)
      and (p_state is null or coalesce(nullif(btrim(l.values->>'state'), ''), nullif(btrim(l.values->>'state_code'), ''), nullif(btrim(l.values->>'primary_state'), ''), nullif(btrim(l.carrier_state), '')) = p_state)
      and (p_screening_outcome is null or coalesce(q.screening_outcome, l.screening_outcome, 'not_checked') = p_screening_outcome)
    -- The newest 500, so a transfer that just arrived is never the one cut. The bundle's
    -- `truncated` flag reads this same 500.
    order by q.queued_at desc limit 500
  ) newest
  order by newest.queued_at asc
$function$;

revoke all on function public.list_transfer_inbox(uuid, text, uuid, text, text, text, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.list_transfer_inbox(uuid, text, uuid, text, text, text, uuid) to service_role;

-- ── backfills ───────────────────────────────────────────────────────────────
-- Guarded so the migration checker's role (no rights on these tables' new columns) skips them.
do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709850: backfills skipped, % cannot create in public', current_user;
    return;
  end if;
  -- The buffer assistant who took each transfer, from the work item that still names them.
  update public.deal_flow d
     set buffer_agent = q.buffer_user_id
    from public.lead_queue q
   where q.lead_id = d.lead_id
     and q.tenant_id = d.tenant_id
     and q.buffer_user_id is not null
     and d.buffer_agent is null
     and exists (select 1 from public.users u where u.id = q.buffer_user_id);
  -- Deals with no initial quote whose agent already recorded carrier, face or premium get the
  -- composed one. A quote somebody gave is left exactly as it is.
  update public.deal_flow
     set initial_quote = left(public.compose_initial_quote(carrier, face_amount_cents, monthly_premium_cents), 1000)
   where nullif(btrim(coalesce(initial_quote, '')), '') is null
     and public.compose_initial_quote(carrier, face_amount_cents, monthly_premium_cents) is not null;
end $$;

-- ── assertions ──────────────────────────────────────────────────────────────
-- Run in the SQL editor they prove this file landed, the checker's role skips them.
do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709850: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if not exists (select 1 from pg_attribute where attrelid = 'public.lead_queue'::regclass and attname = 'requeue_count' and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = 'public.lead_queue'::regclass and attname = 'buffer_ended_at' and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = 'public.deal_flow'::regclass and attname = 'buffer_agent' and not attisdropped) then
    raise exception '20260925709850: the requeue, buffer and deal-buffer columns are missing';
  end if;
  if public.lead_values_age('{"date_of_birth":"1960-04-02"}'::jsonb, date '2026-09-25') is distinct from '66' then
    raise exception '20260925709850: age is not worked out from a date of birth';
  end if;
  if public.lead_values_age('{"date_of_birth":"04/02/1960"}'::jsonb, date '2026-04-01') is distinct from '65' then
    raise exception '20260925709850: a US-format date of birth is not read, or the birthday is counted early';
  end if;
  if public.lead_values_age('{"date_of_birth":"1960-02-31"}'::jsonb) is not null
     or public.lead_values_age('{"age":"71","date_of_birth":"1960-04-02"}'::jsonb) is distinct from '71' then
    raise exception '20260925709850: a bad date is not unknown, or a recorded age is not preferred';
  end if;
  if public.lead_language_key('{"language":"Spanish"}'::jsonb) is distinct from 'spanish'
     or public.lead_language_key('{"language":"es-MX"}'::jsonb) is distinct from 'spanish'
     or public.lead_language_key('{"language":"English"}'::jsonb) is not null
     or public.lead_language_key('{}'::jsonb) is not null then
    raise exception '20260925709850: lead languages are not read the one way';
  end if;
  if public.compose_initial_quote('Mutual of Omaha', 2500000, 4850) is distinct from 'Mutual of Omaha · $25,000 face · $48.50/mo'
     or public.compose_initial_quote(null, null, null) is not null then
    raise exception '20260925709850: the initial quote is not composed from carrier, face and premium';
  end if;
  if public.lead_value_cents('{"premium":"50.72","monthly_premium_cents":4850}'::jsonb, array['premium', 'monthly_premium_cents']) is distinct from 4850 then
    raise exception '20260925709850: a decimal dollar string is read as cents';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_lead_stage_events_source_check'
                  and pg_get_constraintdef(oid) like '%''inbound''%' and pg_get_constraintdef(oid) like '%''dialer''%'
                  and pg_get_constraintdef(oid) like '%''owner_fix''%' and convalidated) then
    raise exception '20260925709850: stage history does not accept inbound and dialer';
  end if;
  -- LA-3 (20260926101000) added 'application_sync'. Once it is live it must still be there.
  if to_regclass('public.tenant_application_stage_map') is not null then
    if not exists (select 1 from pg_constraint where conname = 'tenant_lead_stage_events_source_check'
                    and pg_get_constraintdef(oid) like '%''application_sync''%') then
      raise exception '20260925709850: stage history lost the LA-3 application_sync source';
    end if;
  end if;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'list_transfer_inbox'
                  and position('public.lead_values_age(l.values)' in prosrc) > 0) then
    raise exception '20260925709850: the inbox does not work out age';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.deal_flow'::regclass and tgname = 'deal_flow_compose_initial_quote' and not tgisinternal) then
    raise exception '20260925709850: the initial-quote trigger is missing';
  end if;
  if has_function_privilege('anon', 'public.agent_speaks_language(uuid, uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.agent_speaks_language(uuid, uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.list_transfer_inbox(uuid, text, uuid, text, text, text, uuid)', 'execute') then
    raise exception '20260925709850: a service-only function is callable from the browser';
  end if;
  -- Coverage: LA-1.10-2, LA-1.13-2 (columns, quote), LA-1.12-10 (source), LA-1.14-9 and LA-1.14-10 (helpers).
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925709850', 'inbound_transfer_foundations') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [6/17] 20260925709860_inbound_requeue_resume_and_buffer_involvement.sql ──────
begin;

-- Inbound transfers, part 2 of 3: who may take a call, giving a transfer back, and resuming it.
-- Needs 20260925709850 (its columns and helpers), the first block refuses to run without it.
--
--   LA-1.10-8   A dropped call goes back in the queue (return_transfer_to_queue, reason 'requeue').
--               It waits again from now, with the SLA ladder reset, exactly as a reopened expired
--               lead does, and its deal row is in progress again. Any call record still open on an
--               unclaimed transfer is stale by definition, so a claim now closes every one of them,
--               not only those past two hours.
--   LA-1.11-6   The re-claim resumes the SAME verification session: its confirmed and corrected
--               fields, and the corrected values already on the lead, are all still there. The claim
--               says so (resumed_verification). The disposition walk that recorded the drop starts
--               again from the stage's flow, so the call gets a fresh outcome.
--   LA-1.14-7   The claim returns requeue_count, so the partner's "Connected" card is posted once per
--               claim, a re-claim included, instead of once per transfer.
--   LA-1.14-9   Two different acts. Unassign (reason 'unassign') gives a transfer being worked back
--               to the queue: nobody owns it any more. End buffer involvement (end_buffer_involvement)
--               is the buffer assistant leaving a call the licensed agent now owns: ownership, the
--               call and the verification stay exactly where they are.
--   LA-1.14-10  A caller who asked for another language is claimed only by somebody who speaks it.
--               A licensed agent who does not may still take the call from a buffer who does,
--               because that buffer stays on the call (accept_buffer_handoff keeps buffer_user_id).
--               Claim next skips transfers the claimer cannot take, and says so when those are the
--               only ones waiting.
--   LA-1.13-2   The buffer who claims a transfer is written to its deal row (deal_flow.buffer_agent).
--
-- Reconciled against the live database on 2026-09-29 (read-only catalog reads). claim_transfer_lead
-- (20260912400000), claim_next_transfer (20260924335100), offer_buffer_handoff and
-- accept_buffer_handoff are restated from their LIVE bodies, which no later applied migration
-- (711300, 711400, 711600, 20260926000100 or the LA-3 files) has changed, the only differences are
-- the ones listed above. Signatures, SECURITY DEFINER, search_path and the service-role-only grants
-- match the live functions.
--
-- Down: restate the four functions from 20260912400000 / 20260924335100 (their live bodies before
-- this file) and drop return_transfer_to_queue and end_buffer_involvement.

-- ── precondition ────────────────────────────────────────────────────────────
do $$
begin
  -- The migration checker's role applies nothing, so an earlier file is never there for it.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709860: precondition skipped, % cannot create in public', current_user;
    return;
  end if;
  if not exists (select 1 from pg_attribute where attrelid = 'public.lead_queue'::regclass and attname = 'requeued_at' and not attisdropped)
     or to_regprocedure('public.agent_speaks_language(uuid, uuid, text)') is null then
    raise exception '20260925709860 needs 20260925709850 first (lead_queue.requeued_at and agent_speaks_language are missing)';
  end if;
end $$;

-- ── claim ───────────────────────────────────────────────────────────────────
create or replace function public.claim_transfer_lead(p_tenant_id uuid, p_work_item_id uuid, p_user_id uuid, p_owner_role text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  item public.lead_queue%rowtype;
  session_id uuid;
  call_id uuid;
  resolved_submission_id uuid;
  resolved_role text;
  claim_status text;
  violation_constraint text;
  v_language text;
  v_resumed boolean := false;
begin
  select tu.role::text into resolved_role from public.tenant_users tu join public.users u on u.id = tu.user_id where tu.tenant_id = p_tenant_id and tu.user_id = p_user_id and u.status = 'active';
  if resolved_role is null or resolved_role <> p_owner_role or resolved_role not in ('owner', 'producer', 'assistant') then raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED'; end if;
  select q.* into item from public.lead_queue q where q.id = p_work_item_id and q.tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'WORK_ITEM_NOT_FOUND'; end if;
  if item.status <> 'unclaimed' then raise exception using errcode = 'P0001', message = 'ALREADY_CLAIMED', detail = coalesce(item.owner_user_id::text, item.claimed_by::text, 'unknown'); end if;
  select l.submission_id, public.lead_language_key(l.values) into resolved_submission_id, v_language from public.agent_leads l where l.id = item.lead_id and l.tenant_id = p_tenant_id;
  -- LA-1.14-10: the caller asked for a language this member does not list.
  if not public.agent_speaks_language(p_tenant_id, p_user_id, v_language) then
    raise exception using errcode = 'P0001', message = 'LANGUAGE_NOT_SPOKEN', detail = v_language;
  end if;
  claim_status := case when resolved_role = 'assistant' then 'buffer_active' else 'claimed' end;
  update public.lead_queue
     set status = claim_status, owner_user_id = p_user_id, claimed_by = p_user_id, owner_role = resolved_role,
         buffer_user_id = case when resolved_role = 'assistant' then p_user_id else null end,
         buffer_ended_at = null, claimed_at = now()
   where id = item.id and tenant_id = p_tenant_id and status = 'unclaimed';
  -- Nobody is on an unclaimed transfer, so every call record still open on it is stale.
  update public.active_calls set ended_at = now(), updated_at = now()
   where work_item_id = item.id and tenant_id = p_tenant_id and ended_at is null;
  -- LA-1.11-6: a transfer that was given back resumes its last verification session.
  if item.requeued_at is not null then
    update public.tenant_verification_sessions s
       set status = 'open', ended_at = null, completed_at = null, user_id = p_user_id, agent_role = resolved_role,
           last_actor_id = p_user_id, updated_at = now()
     where s.id = (
             select s2.id from public.tenant_verification_sessions s2
              where s2.tenant_id = p_tenant_id and s2.work_item_id = item.id and s2.ended_at is not null
              order by s2.started_at desc, s2.created_at desc
              limit 1)
       and not exists (select 1 from public.tenant_verification_sessions s3 where s3.work_item_id = item.id and s3.ended_at is null)
    returning s.id into session_id;
    v_resumed := session_id is not null;
  end if;
  if session_id is null then
    insert into public.tenant_verification_sessions(tenant_id, work_item_id, lead_id, user_id, agent_role) values (p_tenant_id, item.id, item.lead_id, p_user_id, resolved_role)
      on conflict (work_item_id) where ended_at is null do update set user_id = excluded.user_id, agent_role = excluded.agent_role, status = 'open', ended_at = null, updated_at = now() returning id into session_id;
  end if;
  begin
    insert into public.active_calls(tenant_id, work_item_id, lead_id, submission_id, user_id, agent_role) values (p_tenant_id, item.id, item.lead_id, resolved_submission_id, p_user_id, resolved_role) returning id into call_id;
  exception when unique_violation then
    get stacked diagnostics violation_constraint = constraint_name;
    if violation_constraint <> 'active_calls_open_item_user_idx' then raise; end if;
    select id into call_id from public.active_calls where work_item_id = item.id and user_id = p_user_id and ended_at is null;
    if call_id is null then raise; end if;
  end;
  -- LA-1.13-2: the deal row names the buffer who took the call.
  if resolved_role = 'assistant' then
    update public.deal_flow set buffer_agent = p_user_id, updated_at = now() where tenant_id = p_tenant_id and lead_id = item.lead_id;
  end if;
  return jsonb_build_object('work_item_id', item.id, 'lead_id', item.lead_id, 'submission_id', resolved_submission_id, 'verification_session_id', session_id, 'active_call_id', call_id,
    'owner_user_id', p_user_id, 'owner_role', resolved_role, 'status', claim_status, 'claimed_at', (select claimed_at from public.lead_queue where id = item.id),
    'resumed_verification', v_resumed, 'requeue_count', coalesce(item.requeue_count, 0), 'language', v_language);
end;
$function$;

revoke all on function public.claim_transfer_lead(uuid, uuid, uuid, text) from public, anon, authenticated, tenant_app;
grant execute on function public.claim_transfer_lead(uuid, uuid, uuid, text) to service_role;

-- ── claim next ──────────────────────────────────────────────────────────────
create or replace function public.claim_next_transfer(p_tenant_id uuid, p_user_id uuid, p_owner_role text, p_partner_id uuid default null::uuid, p_product_line text default null::text, p_state text default null::text, p_screening_outcome text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_work_item_id uuid;
  v_language text;
begin
  select q.id into v_work_item_id
    from public.lead_queue q
    join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
   where q.tenant_id = p_tenant_id
     and q.partner_id is not null
     and q.status = 'unclaimed'
     and (p_partner_id is null or q.partner_id = p_partner_id)
     and (p_product_line is null or q.product_line = p_product_line)
     and (p_state is null or coalesce(nullif(btrim(l.values->>'state'), ''), nullif(btrim(l.values->>'state_code'), ''), nullif(btrim(l.values->>'primary_state'), ''), nullif(btrim(l.carrier_state), '')) = p_state)
     and (p_screening_outcome is null or coalesce(q.screening_outcome, l.screening_outcome, 'not_checked') = p_screening_outcome)
     -- LA-1.14-10: never hand this agent a caller they cannot talk to.
     and public.agent_speaks_language(p_tenant_id, p_user_id, public.lead_language_key(l.values))
   order by q.queued_at asc, q.id asc
   limit 1
   for update of q skip locked;

  if v_work_item_id is null then
    -- Say why when the only callers waiting asked for a language this agent does not list.
    select public.lead_language_key(l.values) into v_language
      from public.lead_queue q
      join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
     where q.tenant_id = p_tenant_id
       and q.partner_id is not null
       and q.status = 'unclaimed'
       and (p_partner_id is null or q.partner_id = p_partner_id)
       and (p_product_line is null or q.product_line = p_product_line)
       and (p_state is null or coalesce(nullif(btrim(l.values->>'state'), ''), nullif(btrim(l.values->>'state_code'), ''), nullif(btrim(l.values->>'primary_state'), ''), nullif(btrim(l.carrier_state), '')) = p_state)
       and (p_screening_outcome is null or coalesce(q.screening_outcome, l.screening_outcome, 'not_checked') = p_screening_outcome)
     order by q.queued_at asc, q.id asc
     limit 1;
    if v_language is not null then
      raise exception using errcode = 'P0001', message = 'LANGUAGE_NOT_SPOKEN', detail = v_language;
    end if;
    raise exception using errcode = 'P0002', message = 'NO_TRANSFER_WAITING';
  end if;

  -- The row is locked by this transaction, so claim_transfer_lead's own FOR UPDATE re-reads it
  -- without waiting, and its status check still refuses anything that is no longer unclaimed.
  return public.claim_transfer_lead(p_tenant_id, v_work_item_id, p_user_id, p_owner_role);
end;
$function$;

revoke all on function public.claim_next_transfer(uuid, uuid, text, uuid, text, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.claim_next_transfer(uuid, uuid, text, uuid, text, text, text) to service_role;

-- ── offer a handoff ─────────────────────────────────────────────────────────
create or replace function public.offer_buffer_handoff(p_tenant_id uuid, p_work_item_id uuid, p_buffer_user_id uuid, p_target_user_id uuid, p_timeout_seconds integer default 30, p_ip text default null::text, p_user_agent text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare queue_row public.lead_queue%rowtype; existing_handoff public.buffer_handoffs%rowtype; new_handoff public.buffer_handoffs%rowtype; buffer_role text; target_role text; session_exists boolean; call_exists boolean; v_language text;
begin
  if p_timeout_seconds < 5 or p_timeout_seconds > 300 then raise exception using errcode = '22023', message = 'INVALID_HANDOFF_TIMEOUT'; end if;
  select tu.role::text into buffer_role from public.tenant_users tu join public.users u on u.id = tu.user_id where tu.tenant_id = p_tenant_id and tu.user_id = p_buffer_user_id and u.status = 'active';
  if buffer_role <> 'assistant' then raise exception using errcode = '42501', message = 'BUFFER_ROLE_REQUIRED'; end if;
  select tu.role::text into target_role from public.tenant_users tu join public.users u on u.id = tu.user_id where tu.tenant_id = p_tenant_id and tu.user_id = p_target_user_id and u.status = 'active';
  if target_role not in ('owner', 'producer') then raise exception using errcode = '42501', message = 'LICENSED_AGENT_REQUIRED'; end if;
  select * into queue_row from public.lead_queue where id = p_work_item_id and tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'WORK_ITEM_NOT_FOUND'; end if;
  if queue_row.status not in ('buffer_active', 'handed_pending') or queue_row.owner_user_id <> p_buffer_user_id then raise exception using errcode = '42501', message = 'BUFFER_OWNER_REQUIRED'; end if;
  select * into existing_handoff from public.buffer_handoffs where work_item_id = p_work_item_id and status = 'pending' for update;
  if found then
    if existing_handoff.licensed_agent_id <> p_target_user_id then raise exception using errcode = 'P0001', message = 'HANDOFF_PENDING'; end if;
    return jsonb_build_object('handoff_id', existing_handoff.id, 'status', existing_handoff.status, 'expires_at', existing_handoff.expires_at, 'idempotent', true);
  end if;
  if queue_row.status <> 'buffer_active' then raise exception using errcode = 'P0001', message = 'HANDOFF_PENDING'; end if;
  -- LA-1.14-10: the licensed agent speaks the caller's language, or the buffer on the call does.
  select public.lead_language_key(l.values) into v_language from public.agent_leads l where l.id = queue_row.lead_id and l.tenant_id = p_tenant_id;
  if not public.agent_speaks_language(p_tenant_id, p_target_user_id, v_language) and not public.agent_speaks_language(p_tenant_id, p_buffer_user_id, v_language) then
    raise exception using errcode = 'P0001', message = 'LANGUAGE_NOT_SPOKEN', detail = v_language;
  end if;
  select exists(select 1 from public.tenant_verification_sessions where work_item_id = p_work_item_id and tenant_id = p_tenant_id and user_id = p_buffer_user_id and ended_at is null) into session_exists;
  if not session_exists then raise exception using errcode = 'P0002', message = 'VERIFICATION_SESSION_NOT_FOUND'; end if;
  select exists(select 1 from public.active_calls where work_item_id = p_work_item_id and tenant_id = p_tenant_id and user_id = p_buffer_user_id and ended_at is null) into call_exists;
  if not call_exists then raise exception using errcode = 'P0002', message = 'ACTIVE_CALL_NOT_FOUND'; end if;
  insert into public.buffer_handoffs(tenant_id, work_item_id, buffer_user_id, licensed_agent_id, expires_at) values (p_tenant_id, p_work_item_id, p_buffer_user_id, p_target_user_id, now() + make_interval(secs => p_timeout_seconds)) returning * into new_handoff;
  update public.lead_queue set status = 'handed_pending', updated_at = now() where id = p_work_item_id;
  insert into public.audit_log(actor_type, actor_id, action, target_type, target_id, ip, user_agent, metadata) values ('tenant', p_buffer_user_id, 'tenant.buffer_handoff_offered', 'buffer_handoff', new_handoff.id::text, p_ip, p_user_agent, jsonb_build_object('workItemId', p_work_item_id, 'licensedAgentId', p_target_user_id, 'expiresAt', new_handoff.expires_at, 'language', v_language));
  return jsonb_build_object('handoff_id', new_handoff.id, 'status', new_handoff.status, 'expires_at', new_handoff.expires_at, 'idempotent', false);
end;
$function$;

revoke all on function public.offer_buffer_handoff(uuid, uuid, uuid, uuid, integer, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.offer_buffer_handoff(uuid, uuid, uuid, uuid, integer, text, text) to service_role;

-- ── accept a handoff ────────────────────────────────────────────────────────
create or replace function public.accept_buffer_handoff(p_tenant_id uuid, p_handoff_id uuid, p_licensed_agent_id uuid, p_ip text default null::text, p_user_agent text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  handoff_row public.buffer_handoffs%rowtype;
  queue_row public.lead_queue%rowtype;
  session_row public.tenant_verification_sessions%rowtype;
  target_role text;
  call_count integer;
  v_language text;
begin
  perform public.expire_buffer_handoffs(p_tenant_id);
  select tu.role::text into target_role from public.tenant_users tu
  join public.users u on u.id = tu.user_id
  where tu.tenant_id = p_tenant_id and tu.user_id = p_licensed_agent_id
    and u.status = 'active';
  if target_role not in ('owner', 'producer') then raise exception using errcode = '42501', message = 'LICENSED_AGENT_REQUIRED'; end if;
  select * into handoff_row from public.buffer_handoffs where id = p_handoff_id and tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'HANDOFF_NOT_FOUND'; end if;
  if handoff_row.status <> 'pending' or handoff_row.licensed_agent_id <> p_licensed_agent_id then
    raise exception using errcode = '42501', message = 'HANDOFF_NOT_AVAILABLE';
  end if;
  if handoff_row.expires_at <= now() then raise exception using errcode = 'P0001', message = 'HANDOFF_EXPIRED'; end if;
  select * into queue_row from public.lead_queue where id = handoff_row.work_item_id and tenant_id = p_tenant_id for update;
  if queue_row.status <> 'handed_pending' or queue_row.owner_user_id <> handoff_row.buffer_user_id then
    raise exception using errcode = '42501', message = 'HANDOFF_NOT_AVAILABLE';
  end if;
  -- LA-1.14-10: as on the offer, the buffer who stays on the call covers the caller's language.
  select public.lead_language_key(l.values) into v_language from public.agent_leads l where l.id = queue_row.lead_id and l.tenant_id = p_tenant_id;
  if not public.agent_speaks_language(p_tenant_id, p_licensed_agent_id, v_language) and not public.agent_speaks_language(p_tenant_id, handoff_row.buffer_user_id, v_language) then
    raise exception using errcode = 'P0001', message = 'LANGUAGE_NOT_SPOKEN', detail = v_language;
  end if;
  select * into session_row from public.tenant_verification_sessions where work_item_id = queue_row.id and tenant_id = p_tenant_id and user_id = handoff_row.buffer_user_id and ended_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'VERIFICATION_SESSION_NOT_FOUND'; end if;
  update public.active_calls set user_id = p_licensed_agent_id, agent_role = target_role, updated_at = now()
  where work_item_id = queue_row.id and tenant_id = p_tenant_id and user_id = handoff_row.buffer_user_id and ended_at is null;
  get diagnostics call_count = row_count;
  if call_count <> 1 then raise exception using errcode = 'P0002', message = 'ACTIVE_CALL_NOT_FOUND'; end if;
  update public.tenant_verification_sessions set user_id = p_licensed_agent_id, agent_role = target_role, last_actor_id = p_licensed_agent_id, updated_at = now() where id = session_row.id;
  -- The buffer stays involved (buffer_user_id kept, buffer_ended_at clear) until they end it.
  update public.lead_queue set status = 'la_active', owner_user_id = p_licensed_agent_id, claimed_by = p_licensed_agent_id, owner_role = target_role, buffer_ended_at = null, updated_at = now() where id = queue_row.id;
  update public.buffer_handoffs set status = 'accepted', accepted_at = now(), updated_at = now() where id = handoff_row.id;
  update public.deal_flow set buffer_agent = handoff_row.buffer_user_id, updated_at = now() where tenant_id = p_tenant_id and lead_id = queue_row.lead_id and buffer_agent is null;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, ip, user_agent, metadata)
  values ('tenant', p_licensed_agent_id, 'tenant.buffer_handoff_accepted', 'buffer_handoff', handoff_row.id::text, p_ip, p_user_agent,
    jsonb_build_object('workItemId', queue_row.id, 'bufferUserId', handoff_row.buffer_user_id, 'progressPercentage', session_row.progress_percentage, 'language', v_language));
  return jsonb_build_object('handoff_id', handoff_row.id, 'work_item_id', queue_row.id, 'status', 'accepted', 'verification_session_id', session_row.id, 'progress_percentage', session_row.progress_percentage);
end;
$function$;

revoke all on function public.accept_buffer_handoff(uuid, uuid, uuid, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.accept_buffer_handoff(uuid, uuid, uuid, text, text) to service_role;

-- ── give a transfer back to the queue ───────────────────────────────────────
-- p_reason 'unassign': a transfer being worked (claimed, with a buffer, or with a licensed agent)
--   goes back to waiting. The person who has it, or the account owner, may do it. A handoff still
--   being offered must be accepted or time out first.
-- p_reason 'requeue': a transfer whose call dropped goes back to waiting. The agent who had it, the
--   agent who recorded the drop, or the account owner, may do it. Its deal row is in progress again.
-- Either way the transfer waits again from now with the SLA ladder reset, its open call records and
-- verification session are closed (the session is kept, and the next claim reopens it), and nobody
-- owns it.
create or replace function public.return_transfer_to_queue(p_tenant_id uuid, p_work_item_id uuid, p_actor uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  q public.lead_queue%rowtype;
  v_role text;
  v_flow public.tenant_disposition_flows%rowtype;
  v_session uuid;
begin
  if p_reason is null or p_reason not in ('unassign', 'requeue') then raise exception using errcode = '22023', message = 'INVALID_RELEASE_REASON'; end if;
  select tu.role::text into v_role from public.tenant_users tu join public.users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and u.status = 'active';
  if v_role is null or v_role not in ('owner', 'producer', 'assistant') then raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED'; end if;
  select * into q from public.lead_queue where id = p_work_item_id and tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'WORK_ITEM_NOT_FOUND'; end if;
  if q.partner_id is null then raise exception using errcode = 'P0001', message = 'NOT_A_TRANSFER'; end if;
  if q.status = 'unclaimed' then
    return jsonb_build_object('work_item_id', q.id, 'lead_id', q.lead_id, 'status', q.status, 'duplicate', true);
  end if;
  if p_reason = 'unassign' then
    if q.status = 'handed_pending' then raise exception using errcode = 'P0001', message = 'HANDOFF_PENDING'; end if;
    if q.status not in ('claimed', 'buffer_active', 'la_active') then raise exception using errcode = 'P0001', message = 'NOT_BEING_WORKED'; end if;
    if v_role <> 'owner' and q.owner_user_id is distinct from p_actor then raise exception using errcode = '42501', message = 'RELEASE_OWNER_REQUIRED'; end if;
  else
    if q.status <> 'dropped' then raise exception using errcode = 'P0001', message = 'NOT_DROPPED'; end if;
    if v_role <> 'owner' and q.owner_user_id is distinct from p_actor and q.disposition_by is distinct from p_actor then
      raise exception using errcode = '42501', message = 'RELEASE_OWNER_REQUIRED';
    end if;
  end if;

  update public.active_calls set ended_at = now(), updated_at = now()
   where work_item_id = q.id and tenant_id = p_tenant_id and ended_at is null;
  update public.tenant_verification_sessions
     set status = 'closed', ended_at = now(), updated_at = now(), last_actor_id = p_actor
   where work_item_id = q.id and tenant_id = p_tenant_id and ended_at is null
  returning id into v_session;

  if p_reason = 'requeue' then
    -- The drop was recorded. The next call gets its own outcome, walked from the stage it is in now.
    delete from public.disposition_walk_steps s using public.disposition_walks w
     where s.walk_id = w.id and w.tenant_id = p_tenant_id and w.work_item_id = q.id;
    select f.* into v_flow from public.tenant_disposition_flows f where f.tenant_id = p_tenant_id and f.stage_id = q.stage_id and f.is_active;
    if found then
      update public.disposition_walks
         set flow_id = v_flow.id, current_node_id = v_flow.root_node_id, status = 'open', completed_at = null,
             final_disposition_key = null, composed_note = null, updated_at = now()
       where tenant_id = p_tenant_id and work_item_id = q.id;
    else
      delete from public.disposition_walks where tenant_id = p_tenant_id and work_item_id = q.id;
    end if;
    -- The deal is being worked again, its call_result keeps the drop until the next outcome.
    update public.deal_flow set status = 'partial', updated_at = now()
     where tenant_id = p_tenant_id and lead_id = q.lead_id and status = 'dropped';
  end if;

  update public.lead_queue
     set status = 'unclaimed', owner_user_id = null, claimed_by = null, owner_role = null,
         buffer_user_id = null, buffer_ended_at = null, claimed_at = null, queued_at = now(),
         sla_warned_at = null, sla_escalated_at = null, sla_partner_notified_at = null, sla_expired_at = null,
         requeued_at = now(), requeue_count = coalesce(requeue_count, 0) + 1, updated_at = now()
   where id = q.id and tenant_id = p_tenant_id;

  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_actor, case when p_reason = 'requeue' then 'tenant.transfer_requeued' else 'tenant.transfer_unassigned' end, 'lead_queue', q.id::text,
    jsonb_build_object('leadId', q.lead_id, 'previousStatus', q.status, 'previousOwnerId', q.owner_user_id, 'bufferUserId', q.buffer_user_id,
      'verificationSessionId', v_session, 'requeueCount', coalesce(q.requeue_count, 0) + 1));

  return jsonb_build_object('work_item_id', q.id, 'lead_id', q.lead_id, 'status', 'unclaimed', 'previous_status', q.status,
    'verification_session_id', v_session, 'requeue_count', coalesce(q.requeue_count, 0) + 1, 'duplicate', false);
end;
$function$;

revoke all on function public.return_transfer_to_queue(uuid, uuid, uuid, text) from public, anon, authenticated, tenant_app;
grant execute on function public.return_transfer_to_queue(uuid, uuid, uuid, text) to service_role;

-- ── end buffer involvement ──────────────────────────────────────────────────
-- The buffer leaves a call the licensed agent already owns. Nothing about the transfer's owner,
-- call record or verification changes. The buffer themselves, the licensed agent who has the
-- transfer, or the account owner may do it. While the buffer still owns the call (before any
-- handoff) there is nothing to end: they hand off, or unassign. A finished transfer has no call
-- left to leave. When the caller asked for a language the licensed agent does not list, the buffer
-- was the one covering it, so leaving needs p_acknowledge_language.
create or replace function public.end_buffer_involvement(p_tenant_id uuid, p_work_item_id uuid, p_actor uuid, p_acknowledge_language boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  q public.lead_queue%rowtype;
  v_role text;
  v_language text;
  v_cover_ends boolean := false;
begin
  select tu.role::text into v_role from public.tenant_users tu join public.users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and u.status = 'active';
  if v_role is null or v_role not in ('owner', 'producer', 'assistant') then raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED'; end if;
  select * into q from public.lead_queue where id = p_work_item_id and tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'WORK_ITEM_NOT_FOUND'; end if;
  if q.buffer_user_id is null then raise exception using errcode = 'P0001', message = 'NO_BUFFER_INVOLVED'; end if;
  if q.buffer_ended_at is not null then
    return jsonb_build_object('work_item_id', q.id, 'buffer_user_id', q.buffer_user_id, 'buffer_ended_at', q.buffer_ended_at, 'duplicate', true);
  end if;
  if q.status in ('buffer_active', 'handed_pending') then raise exception using errcode = 'P0001', message = 'BUFFER_OWNS_CALL'; end if;
  if q.status not in ('claimed', 'la_active') then raise exception using errcode = 'P0001', message = 'CALL_ENDED'; end if;
  if v_role <> 'owner' and p_actor is distinct from q.buffer_user_id and p_actor is distinct from q.owner_user_id then
    raise exception using errcode = '42501', message = 'RELEASE_OWNER_REQUIRED';
  end if;
  if q.owner_user_id is not null then
    select public.lead_language_key(l.values) into v_language from public.agent_leads l where l.id = q.lead_id and l.tenant_id = p_tenant_id;
    v_cover_ends := not public.agent_speaks_language(p_tenant_id, q.owner_user_id, v_language);
    if v_cover_ends and not coalesce(p_acknowledge_language, false) then
      raise exception using errcode = 'P0001', message = 'LANGUAGE_COVER_REQUIRED', detail = v_language;
    end if;
  end if;
  update public.lead_queue set buffer_ended_at = now(), updated_at = now() where id = q.id and tenant_id = p_tenant_id;
  -- A call record the buffer still holds on this transfer ends with their involvement.
  update public.active_calls set ended_at = now(), updated_at = now()
   where work_item_id = q.id and tenant_id = p_tenant_id and user_id = q.buffer_user_id and ended_at is null;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_actor, 'tenant.buffer_involvement_ended', 'lead_queue', q.id::text,
    jsonb_build_object('leadId', q.lead_id, 'bufferUserId', q.buffer_user_id, 'licensedAgentId', q.owner_user_id, 'status', q.status,
      'language', v_language, 'languageCoverEnded', v_cover_ends));
  return jsonb_build_object('work_item_id', q.id, 'buffer_user_id', q.buffer_user_id, 'owner_user_id', q.owner_user_id, 'status', q.status,
    'buffer_ended_at', now(), 'language_cover_ended', v_cover_ends, 'duplicate', false);
end;
$function$;

revoke all on function public.end_buffer_involvement(uuid, uuid, uuid, boolean) from public, anon, authenticated, tenant_app;
grant execute on function public.end_buffer_involvement(uuid, uuid, uuid, boolean) to service_role;

-- ── assertions ──────────────────────────────────────────────────────────────
do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709860: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'claim_transfer_lead'
                  and position('LANGUAGE_NOT_SPOKEN' in prosrc) > 0
                  and position('item.requeued_at is not null' in prosrc) > 0
                  and position('''resumed_verification''' in prosrc) > 0
                  and position('''requeue_count''' in prosrc) > 0
                  and position('started_at<now()-interval' in replace(prosrc, ' ', '')) = 0) then
    raise exception '20260925709860: claim_transfer_lead does not gate language, resume a returned session, or still closes only old calls';
  end if;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'claim_next_transfer'
                  and position('agent_speaks_language' in prosrc) > 0 and position('skip locked' in prosrc) > 0
                  and position('LANGUAGE_NOT_SPOKEN' in prosrc) > 0) then
    raise exception '20260925709860: claim_next_transfer does not skip callers the agent cannot talk to';
  end if;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'offer_buffer_handoff'
                  and position('LANGUAGE_NOT_SPOKEN' in prosrc) > 0) then
    raise exception '20260925709860: offer_buffer_handoff does not check the caller''s language';
  end if;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'accept_buffer_handoff'
                  and position('buffer_ended_at = null' in prosrc) > 0 and position('LANGUAGE_NOT_SPOKEN' in prosrc) > 0) then
    raise exception '20260925709860: accept_buffer_handoff does not keep the buffer on the call';
  end if;
  if to_regprocedure('public.return_transfer_to_queue(uuid, uuid, uuid, text)') is null
     or to_regprocedure('public.end_buffer_involvement(uuid, uuid, uuid, boolean)') is null then
    raise exception '20260925709860: the release functions are missing';
  end if;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'end_buffer_involvement'
                  and position('CALL_ENDED' in prosrc) > 0) then
    raise exception '20260925709860: end_buffer_involvement accepts a finished transfer';
  end if;
  if not exists (select 1 from pg_proc where oid = 'public.return_transfer_to_queue(uuid, uuid, uuid, text)'::regprocedure and prosecdef
                  and array_to_string(proconfig, ',') like '%search_path=public%') then
    raise exception '20260925709860: return_transfer_to_queue is not security definer with a fixed search_path';
  end if;
  if has_function_privilege('anon', 'public.return_transfer_to_queue(uuid, uuid, uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.return_transfer_to_queue(uuid, uuid, uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.end_buffer_involvement(uuid, uuid, uuid, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.end_buffer_involvement(uuid, uuid, uuid, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.claim_transfer_lead(uuid, uuid, uuid, text)', 'execute') then
    raise exception '20260925709860: a transfer function is callable from the browser';
  end if;
  -- Coverage: LA-1.10-8, LA-1.11-6, LA-1.13-2 (buffer on the deal), LA-1.14-7, LA-1.14-9, LA-1.14-10.
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925709860', 'inbound_requeue_resume_and_buffer_involvement') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [7/17] 20260925709870_inbound_disposition_history_and_deal_buffer.sql ────────
begin;

-- Inbound transfers, part 3 of 3: what an inbound disposition writes, and the buffer on the deal.
-- Needs 20260925709850 (deal_flow.buffer_agent), the first block refuses to run without it.
--
--   LA-1.12-10  complete_disposition already wrote the work item, the audit event, the call end, the
--               lead's stage, the deal row, the partner outcome card and the DNC list. Two targets
--               were missing, and are added here:
--                 - tenant_lead_stage_events: a disposition that moves the lead records the move,
--                   from where to where, which outcome and who. Source 'inbound' for a partner
--                   transfer, 'lead_detail' for any other work item dispositioned from the lead page
--                   (the dialer writes its own 'dialer' rows, 20260925711300). Every other stage
--                   change already writes this history.
--                 - tenant_lead_activity (transfers only): the served row the claim opened gets
--                   dispositioned_at and the disposition. A transfer that reached its agent through a
--                   buffer handoff has no served row (the served trigger fires on 'claimed' only), so
--                   one is written. Deal flow's history column reads exactly this table. An outbound
--                   work item's activity belongs to the dialer and is left alone, so it is never
--                   counted twice.
--               It also carries the buffer who worked the call onto the deal row.
--   LA-1.13-2   list_deal_flow_report returns buffer_agent and buffer_agent_name on every row.
--
-- Both functions are edited IN PLACE from their live source, not restated: complete_disposition is
-- shared with the callback path (complete_disposition_with_callback calls it) and other work may
-- restate it in parallel, and list_deal_flow_report is 10 kB. Each anchor is one line, counted
-- against the live source on 2026-09-29 (each occurs exactly once), and CRLF is normalised first
-- because functions pasted through the SQL editor are stored with CRLF (list_deal_flow_report is).
-- A missing anchor raises, so a changed definition fails loudly instead of being half-edited.
-- Re-running is a no-op: each edit checks for its own marker first.
--
-- Down: restate complete_disposition and list_deal_flow_report from their definitions before this
-- file (pg_get_functiondef output saved before applying, or the files that last defined them).

-- ── precondition ────────────────────────────────────────────────────────────
do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709870: precondition skipped, % cannot create in public', current_user;
    return;
  end if;
  if not exists (select 1 from pg_attribute where attrelid = 'public.deal_flow'::regclass and attname = 'buffer_agent' and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = 'public.lead_queue'::regclass and attname = 'buffer_ended_at' and not attisdropped) then
    raise exception '20260925709870 needs 20260925709850 first (deal_flow.buffer_agent is missing)';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_lead_stage_events_source_check'
                  and pg_get_constraintdef(oid) like '%''inbound''%' and pg_get_constraintdef(oid) like '%''lead_detail''%') then
    raise exception '20260925709870: stage history does not accept the inbound and lead_detail sources; apply 20260925709850 first';
  end if;
end $$;

-- ── complete_disposition: stage history, activity, buffer ───────────────────
do $migration$
declare
  v_sig regprocedure := 'public.complete_disposition(uuid,uuid,uuid,uuid,text,text)'::regprocedure;
  v_def text;
  v_marker constant text := 'LA-1.12-10: the move, in the stage history';
  v_anchor_declare constant text := E'\n  v_partner_card_error text;\n';
  v_anchor_from constant text := E'\n  v_status := v_disposition.closes_as;\n';
  v_anchor_walk constant text := E'\n  update public.disposition_walks\n';
  v_block text;
begin
  v_def := replace(pg_get_functiondef(v_sig), E'\r\n', E'\n');
  if position(v_marker in v_def) > 0 then
    raise notice '20260925709870: complete_disposition already writes inbound history';
    return;
  end if;
  if (length(v_def) - length(replace(v_def, v_anchor_declare, ''))) / length(v_anchor_declare) <> 1
     or (length(v_def) - length(replace(v_def, v_anchor_from, ''))) / length(v_anchor_from) <> 1
     or (length(v_def) - length(replace(v_def, v_anchor_walk, ''))) / length(v_anchor_walk) <> 1 then
    raise exception '20260925709870: complete_disposition no longer has exactly one of each anchor, edit it by hand';
  end if;

  v_def := replace(v_def, v_anchor_declare, v_anchor_declare
    || E'  v_from_pipeline_id uuid;\n'
    || E'  v_from_stage_id uuid;\n');

  v_def := replace(v_def, v_anchor_from, v_anchor_from
    || E'  -- LA-1.12-10: where the lead was before this outcome moves it.\n'
    || E'  select l.pipeline_id, l.stage_id into v_from_pipeline_id, v_from_stage_id\n'
    || E'    from public.agent_leads l\n'
    || E'   where l.id = v_item.lead_id and l.tenant_id = p_tenant_id;\n');

  v_block :=
       E'\n  -- ' || v_marker || E' every other stage change writes.\n'
    || E'  if v_stage_id is not null and v_stage_id is distinct from coalesce(v_from_stage_id, v_item.stage_id) then\n'
    || E'    insert into public.tenant_lead_stage_events\n'
    || E'      (tenant_id, lead_id, from_pipeline_id, from_stage_id, to_pipeline_id, to_stage_id, disposition_key, source, actor_user_id)\n'
    || E'    select p_tenant_id, v_item.lead_id, coalesce(v_from_pipeline_id, v_item.pipeline_id), coalesce(v_from_stage_id, v_item.stage_id),\n'
    || E'           ps.pipeline_id, v_stage_id, v_disposition.disposition_key,\n'
    || E'           case when v_item.partner_id is not null then ''inbound'' else ''lead_detail'' end, p_user_id\n'
    || E'      from public.tenant_pipeline_stages ps\n'
    || E'     where ps.id = v_stage_id;\n'
    || E'  end if;\n'
    || E'  -- LA-1.12-10: a transfer''s outcome on the activity row the claim opened, or a row of its own.\n'
    || E'  -- An outbound work item''s activity is the dialer''s, and is left alone.\n'
    || E'  if v_item.partner_id is not null then\n'
    || E'    update public.tenant_lead_activity a\n'
    || E'       set dispositioned_at = now(), disposition = v_disposition.disposition_key, updated_at = now()\n'
    || E'     where a.id = (\n'
    || E'       select a2.id from public.tenant_lead_activity a2\n'
    || E'        where a2.tenant_id = p_tenant_id and a2.work_item_id = v_item.id and a2.dispositioned_at is null\n'
    || E'        order by a2.served_at desc\n'
    || E'        limit 1);\n'
    || E'    if not found then\n'
    || E'      insert into public.tenant_lead_activity (tenant_id, work_item_id, lead_id, campaign_id, agent_user_id, served_at, dispositioned_at, disposition)\n'
    || E'      select p_tenant_id, v_item.id, v_item.lead_id, l.campaign_id, p_user_id, coalesce(v_item.claimed_at, now()), now(), v_disposition.disposition_key\n'
    || E'        from public.agent_leads l\n'
    || E'       where l.id = v_item.lead_id and l.tenant_id = p_tenant_id;\n'
    || E'    end if;\n'
    || E'  end if;\n'
    || E'  -- LA-1.13-2: the buffer who worked the call, on the deal row.\n'
    || E'  if v_item.buffer_user_id is not null then\n'
    || E'    update public.deal_flow set buffer_agent = v_item.buffer_user_id\n'
    || E'     where lead_id = v_item.lead_id and tenant_id = p_tenant_id and buffer_agent is null;\n'
    || E'  end if;\n';
  v_def := replace(v_def, v_anchor_walk, v_block || v_anchor_walk);

  execute v_def;
end;
$migration$;

-- ── list_deal_flow_report: the buffer agent ─────────────────────────────────
do $migration$
declare
  v_sig regprocedure := 'public.list_deal_flow_report(uuid,date,date,uuid,text,uuid,text,integer,integer,text,text,uuid)'::regprocedure;
  v_def text;
  v_anchor_column constant text := E'\n    d.worked_by, d.manual_entry, d.created_at, d.updated_at,\n';
  v_anchor_name constant text := E'\n      ''worked_by_name'', wu.name,\n';
  v_anchor_join constant text := E'\n  left join public.users wu on wu.id = x.worked_by\n';
begin
  v_def := replace(pg_get_functiondef(v_sig), E'\r\n', E'\n');
  if position('d.buffer_agent' in v_def) > 0 then
    raise notice '20260925709870: list_deal_flow_report already returns the buffer agent';
    return;
  end if;
  if (length(v_def) - length(replace(v_def, v_anchor_column, ''))) / length(v_anchor_column) <> 1
     or (length(v_def) - length(replace(v_def, v_anchor_name, ''))) / length(v_anchor_name) <> 1
     or (length(v_def) - length(replace(v_def, v_anchor_join, ''))) / length(v_anchor_join) <> 1 then
    raise exception '20260925709870: list_deal_flow_report no longer has exactly one of each anchor, edit it by hand';
  end if;
  v_def := replace(v_def, v_anchor_column, E'\n    d.worked_by, d.buffer_agent, d.manual_entry, d.created_at, d.updated_at,\n');
  v_def := replace(v_def, v_anchor_name, v_anchor_name || E'      ''buffer_agent_name'', bu.name,\n');
  v_def := replace(v_def, v_anchor_join, v_anchor_join || E'  left join public.users bu on bu.id = x.buffer_agent\n');
  execute v_def;
end;
$migration$;

-- An in-place CREATE OR REPLACE keeps each function's owner and grants. Restated anyway.
revoke all on function public.complete_disposition(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.complete_disposition(uuid, uuid, uuid, uuid, text, text) to service_role;
revoke all on function public.list_deal_flow_report(uuid, date, date, uuid, text, uuid, text, integer, integer, text, text, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.list_deal_flow_report(uuid, date, date, uuid, text, uuid, text, integer, integer, text, text, uuid) to service_role;

-- ── assertions ──────────────────────────────────────────────────────────────
do $$
declare
  v_src text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709870: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  select replace(prosrc, E'\r\n', E'\n') into v_src from pg_proc where oid = 'public.complete_disposition(uuid,uuid,uuid,uuid,text,text)'::regprocedure;
  if position('insert into public.tenant_lead_stage_events' in v_src) = 0
     or position('then ''inbound'' else ''lead_detail'' end' in v_src) = 0
     or position('update public.tenant_lead_activity a' in v_src) = 0
     or position('if v_item.partner_id is not null then' in v_src) = 0
     or position('set buffer_agent = v_item.buffer_user_id' in v_src) = 0
     -- the edit went in before the walk is closed, not after the return
     or position('insert into public.tenant_lead_stage_events' in v_src) > position('update public.disposition_walks' in v_src) then
    raise exception '20260925709870: complete_disposition does not write stage history, activity and the buffer';
  end if;
  if not exists (select 1 from pg_proc where oid = 'public.complete_disposition(uuid,uuid,uuid,uuid,text,text)'::regprocedure and prosecdef
                  and array_to_string(proconfig, ',') like '%search_path=public%') then
    raise exception '20260925709870: complete_disposition lost security definer or its search_path';
  end if;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'list_deal_flow_report'
                  and position('d.buffer_agent' in prosrc) > 0 and position('''buffer_agent_name'', bu.name' in prosrc) > 0) then
    raise exception '20260925709870: list_deal_flow_report does not return the buffer agent';
  end if;
  if has_function_privilege('anon', 'public.complete_disposition(uuid, uuid, uuid, uuid, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.list_deal_flow_report(uuid, date, date, uuid, text, uuid, text, integer, integer, text, text, uuid)', 'execute') then
    raise exception '20260925709870: a disposition or report function is callable from the browser';
  end if;
  -- Coverage: LA-1.12-10 (stage history, activity), LA-1.13-2 (buffer on the deal and in the report).
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925709870', 'inbound_disposition_history_and_deal_buffer') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [8/17] 20260925709900_unclaimed_sla_backlog_older_than_a_day_is_skipped.sql ───
begin;

-- ---------------------------------------------------------------------------
-- Unclaimed SLA · a side effect older than a day is recorded as skipped, never sent (LA-1.23, W5)
--
-- The ladder has run in the database every minute since 20260924250100, but its side effects (the
-- owner's escalation alert, the partner's notice, the nurture lead on expiry) only happen when the
-- app runs lib/queueSla, and nothing hosts that. So tenant_lead_sla_events has piled up: on
-- 2026-09-25 about 34,700 rows had processed_at null across 11 tenants, 34,613 of them more than
-- 24 hours old (most from two QA tenants that seeded thousands of transfers).
--
-- User decision (2026-09-25): mark every side effect older than 24 hours as skipped, recorded and
-- not sent, and from then on run the side effects from pg_cron every minute (20260925709910).
-- A day-old "this lead needs attention" is news about nobody, and sending thousands at once would
-- bury today's real alerts.
--
-- This file
--   1. adds what the side-effect job records on each event
--        handled_by      'database' (pg_cron) or 'app' (lib/queueSla) or 'skipped'
--        skipped_reason  why nothing was sent: older_than_24_hours, no_longer_unclaimed,
--                        gave_up_after_failures
--        outcome         what was done, as counts, so a reader can see nothing was sent
--        email_due_at / email_done_at / email_outcome
--                        the escalation email stays with the app job. The database marks it
--                        owed, the app sends it and says what happened.
--   2. skips the backlog. Each skipped row keeps its rung, times and ids, gets processed_at and
--      skipped_reason 'older_than_24_hours', and no other table is written except one audit row per
--      tenant with the count. The check block below proves no alert, partner message, partner
--      alert or nurture work item was written by it.
--
-- Additive. Re-running it skips only what has become more than a day old since.
--
-- Reviewed against the live catalog on 2026-09-29: tenant_lead_sla_events had none of these columns
-- and no trigger (so an UPDATE of it can write nothing else), and 34,735 events were pending, every
-- one older than 24 hours. The skip is one statement whose per-tenant counts are collected first and
-- then written to the audit log, rather than a loop over a data-modifying WITH.
-- ---------------------------------------------------------------------------

alter table public.tenant_lead_sla_events
  add column if not exists handled_by text,
  add column if not exists skipped_reason text,
  add column if not exists outcome jsonb not null default '{}'::jsonb,
  add column if not exists email_due_at timestamptz,
  add column if not exists email_done_at timestamptz,
  add column if not exists email_outcome text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.tenant_lead_sla_events'::regclass
                  and conname = 'tenant_lead_sla_events_handled_by_check') then
    alter table public.tenant_lead_sla_events
      add constraint tenant_lead_sla_events_handled_by_check
      check (handled_by is null or handled_by in ('database', 'app', 'skipped'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.tenant_lead_sla_events'::regclass
                  and conname = 'tenant_lead_sla_events_skipped_reason_check') then
    alter table public.tenant_lead_sla_events
      add constraint tenant_lead_sla_events_skipped_reason_check
      check (skipped_reason is null or skipped_reason in ('older_than_24_hours', 'no_longer_unclaimed', 'gave_up_after_failures'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.tenant_lead_sla_events'::regclass
                  and conname = 'tenant_lead_sla_events_email_outcome_check') then
    alter table public.tenant_lead_sla_events
      add constraint tenant_lead_sla_events_email_outcome_check
      check (email_outcome is null or char_length(email_outcome) between 1 and 200);
  end if;
end $$;

-- The app's email pass reads the owed escalation emails by this.
create index if not exists tenant_lead_sla_events_email_due_idx
  on public.tenant_lead_sla_events (email_due_at)
  where email_due_at is not null and email_done_at is null;

grant select, insert, update on public.tenant_lead_sla_events to service_role;

-- ── the backlog ────────────────────────────────────────────────────────────
-- Only the owner role runs this part. The parse check (tenant_app) skips it.
do $$
declare
  r record;
  v_rows jsonb;
  v_total integer := 0;
  v_alerts_before bigint;
  v_messages_before bigint;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709900: backlog skip not run, % cannot create in public', current_user;
    return;
  end if;

  -- The skip only marks events. It can write nowhere else because nothing fires on the table: a
  -- trigger added here later would have to be reviewed against this rule first.
  if exists (select 1 from pg_trigger where tgrelid = 'public.tenant_lead_sla_events'::regclass and not tgisinternal) then
    raise exception 'tenant_lead_sla_events has a trigger; review it before skipping the backlog';
  end if;

  -- The only writers of these keys are the SLA side effects (lib/queueSla, 20260925709910).
  select count(*) into v_alerts_before from public.agent_notifications where source_key like 'unclaimed-sla:%';
  select count(*) into v_messages_before from public.partner_messages where event_key like 'unclaimed-sla:%';

  with skipped as (
    update public.tenant_lead_sla_events e
       set processed_at = now(),
           handled_by = 'skipped',
           skipped_reason = 'older_than_24_hours',
           outcome = jsonb_build_object('sent', false, 'skippedAt', now()),
           last_error = null
     where e.processed_at is null
       and e.occurred_at < now() - interval '24 hours'
    returning e.tenant_id, e.rung
  ), counted as (
    select s.tenant_id,
           count(*)::integer as skipped,
           count(*) filter (where s.rung = 'warn')::integer as warn,
           count(*) filter (where s.rung = 'escalate')::integer as escalate,
           count(*) filter (where s.rung = 'partner')::integer as partner,
           count(*) filter (where s.rung = 'expire')::integer as expire
      from skipped s
     group by s.tenant_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('tenant_id', c.tenant_id, 'name', t.name, 'skipped', c.skipped,
                                               'warn', c.warn, 'escalate', c.escalate, 'partner', c.partner,
                                               'expire', c.expire) order by c.skipped desc), '[]'::jsonb)
    into v_rows
    from counted c
    left join public.tenants t on t.id = c.tenant_id;

  for r in
    select * from jsonb_to_recordset(v_rows)
      as x(tenant_id uuid, name text, skipped integer, warn integer, escalate integer, partner integer, expire integer)
  loop
    v_total := v_total + r.skipped;
    raise notice '20260925709900: tenant % (%) skipped % (warn %, escalate %, partner %, expire %)',
      r.tenant_id, coalesce(r.name, '?'), r.skipped, r.warn, r.escalate, r.partner, r.expire;
    insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
    values ('system', null, 'tenant.lead_sla_backlog_skipped', 'tenant', r.tenant_id::text,
            jsonb_build_object('tenantId', r.tenant_id, 'skipped', r.skipped, 'olderThanHours', 24,
                               'byRung', jsonb_build_object('warn', r.warn, 'escalate', r.escalate,
                                                            'partner', r.partner, 'expire', r.expire),
                               'sent', false));
  end loop;
  raise notice '20260925709900: % side effects older than 24 hours skipped, none sent', v_total;

  -- Nothing was sent: no SLA alert and no partner notice was written by the skip.
  if (select count(*) from public.agent_notifications where source_key like 'unclaimed-sla:%') <> v_alerts_before
     or (select count(*) from public.partner_messages where event_key like 'unclaimed-sla:%') <> v_messages_before then
    raise exception 'the backlog skip wrote a side effect; it must only mark events';
  end if;
  if exists (select 1 from public.tenant_lead_sla_events
              where processed_at is null and occurred_at < now() - interval '24 hours') then
    raise exception 'an unprocessed SLA event older than 24 hours is left';
  end if;
end $$;

-- ── check ──────────────────────────────────────────────────────────────────
do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709900: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'tenant_lead_sla_events'
         and column_name in ('handled_by', 'skipped_reason', 'outcome', 'email_due_at', 'email_done_at', 'email_outcome')) <> 6 then
    raise exception '20260925709900 check failed: a tenant_lead_sla_events column is missing';
  end if;
  if (select count(*) from pg_constraint where conrelid = 'public.tenant_lead_sla_events'::regclass
       and conname in ('tenant_lead_sla_events_handled_by_check', 'tenant_lead_sla_events_skipped_reason_check',
                       'tenant_lead_sla_events_email_outcome_check')) <> 3 then
    raise exception '20260925709900 check failed: a tenant_lead_sla_events check constraint is missing';
  end if;
  if to_regclass('public.tenant_lead_sla_events_email_due_idx') is null then
    raise exception '20260925709900 check failed: tenant_lead_sla_events_email_due_idx is missing';
  end if;
  if exists (select 1 from public.tenant_lead_sla_events where skipped_reason is not null and processed_at is null) then
    raise exception '20260925709900 check failed: a skipped event is not marked processed';
  end if;
  raise notice '20260925709900: columns, constraints and index present; no day-old event left pending';
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925709900', 'unclaimed_sla_backlog_older_than_a_day_is_skipped') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [9/17] 20260925709910_unclaimed_sla_side_effects_run_every_minute.sql ────────
begin;

-- ---------------------------------------------------------------------------
-- Unclaimed SLA · the side effects run in the database every minute (LA-1.23-1/6/7, W5.3-W5.5)
--
-- Apply 20260925709900 first (it adds the columns this uses and skips the day-old backlog).
--
-- Until now the ladder rungs fired on time (pg_cron, 20260924250100) and nobody was told: the
-- alerts, the partner's notice and the nurture lead were app-side (lib/queueSla/service.ts), and
-- nothing hosts the app job. User decision (2026-09-25): run them from pg_cron every minute, and
-- keep only the email with the app.
--
--   run_unclaimed_sla_side_effects(now, limit, source)  jsonb, what it did
--     1. advances the ladder (run_unclaimed_sla, idempotent) so a rung and what it causes land in
--        the same minute. The ladder's own job keeps running too, and the two skip each other's rows.
--     2. takes each unprocessed tenant_lead_sla_events row (not leased by the app in the last ten
--        minutes), each in its own subtransaction, and marks it processed with what it did:
--          older than 24 hours   skipped, nothing sent (the same rule as 20260925709900)
--          warn                  nothing to send, the floor shows it
--          escalate              still unclaimed: "Unclaimed lead needs attention" to every active
--                                owner (source unclaimed-sla:<item>:escalated), "Still unclaimed"
--                                to producers and assistants (…:offered), and the escalation email
--                                marked owed (email_due_at) for the app job to send
--          partner               still unclaimed: the partner's notice in their channel (Design 1's
--                                shape, card_type null, event_key unclaimed-sla:<item>:partner,
--                                only when the partner has an active channel) plus their bell, and
--                                the agency's "Nobody claimed" alert to every active owner
--                                (…:nobody-claimed). Nobody-claimed never goes to the partner.
--          expire                nurture_expired_transfer (20260924230400): the lead becomes a
--                                nurture lead. It asks for a dialer item where the plan dials, but
--                                lead_queue is UNIQUE(lead_id) live, so that item is refused and
--                                the lead is marked nurture without one (recorded in outcome)
--        An escalation or partner notice for a transfer claimed or expired since is recorded as
--        skipped (no_longer_unclaimed), not sent. A row that fails keeps last_error and is tried
--        again next minute, and after five failures it is given up (gave_up_after_failures).
--     3. refreshes the daily digest (tenant_sla_daily_digests): escalated and expired per partner,
--        per day in the agency's own timezone, today so far and yesterday closed. /app/alerts shows it.
--     4. writes one heartbeat row (unclaimed_sla_job_runs) with the report, ok or not, when pg_cron
--        ran it (source 'database', the default). A run that fails as a whole still writes its row,
--        with the error. /app/alerts and the app's heartbeat read it, so "running" means pg_cron is
--        running. The app job calls this with source 'app' and records its own row instead, so a
--        manual `npm run sla:run` can never make a stopped schedule look alive. Rows older than
--        seven days are trimmed on each run.
--
-- Every insert is keyed (agent_notifications on tenant + recipient + source_key, partner_messages on
-- event_key, partner_notifications on tenant + recipient + source_key) and every event is marked
-- processed in the same transaction, so a run repeated, overlapping or retried sends nothing twice.
--
-- Reviewed against the live catalog on 2026-09-29: none of the objects below existed, so nothing
-- live is replaced. Their dependencies were read live and match: run_unclaimed_sla (20260924250100,
-- quiet expiry), nurture_expired_transfer(uuid, uuid, boolean) (20260924230400), the unique keys on
-- agent_notifications / partner_notifications (tenant_id, recipient_user_id, source_key) and
-- partner_messages (event_key where not null), lead_queue UNIQUE(lead_id), pg_cron 1.6.4.
--
-- To stop it:   select cron.unschedule('unclaimed-sla-side-effects')
-- ---------------------------------------------------------------------------

do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then return; end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tenant_lead_sla_events' and column_name = 'skipped_reason') then
    raise exception 'tenant_lead_sla_events.skipped_reason does not exist; apply 20260925709900 before this file';
  end if;
  if to_regprocedure('public.nurture_expired_transfer(uuid, uuid, boolean)') is null then
    raise exception 'nurture_expired_transfer does not exist; apply 20260924230400 before this file';
  end if;
end $$;

-- ── the heartbeat ──────────────────────────────────────────────────────────
create table if not exists public.unclaimed_sla_job_runs (
  id bigint generated always as identity primary key,
  source text not null check (source in ('database', 'app')),
  started_at timestamptz not null,
  finished_at timestamptz,
  ok boolean not null,
  report jsonb not null default '{}'::jsonb,
  error text check (error is null or char_length(error) <= 2000)
);

create index if not exists unclaimed_sla_job_runs_started_idx
  on public.unclaimed_sla_job_runs (started_at desc);

alter table public.unclaimed_sla_job_runs enable row level security;
revoke all on public.unclaimed_sla_job_runs from anon, authenticated, public, tenant_app;
grant select, insert, delete on public.unclaimed_sla_job_runs to service_role;

-- ── the daily digest ───────────────────────────────────────────────────────
create table if not exists public.tenant_sla_daily_digests (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  digest_date date not null,
  timezone text not null,
  escalated integer not null default 0 check (escalated >= 0),
  expired integer not null default 0 check (expired >= 0),
  by_partner jsonb not null default '[]'::jsonb,
  closed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, digest_date)
);

alter table public.tenant_sla_daily_digests enable row level security;
drop policy if exists tenant_sla_daily_digests_scoped on public.tenant_sla_daily_digests;
create policy tenant_sla_daily_digests_scoped on public.tenant_sla_daily_digests
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.tenant_sla_daily_digests from anon, authenticated, public;
grant select on public.tenant_sla_daily_digests to tenant_app;
grant select on public.tenant_sla_daily_digests to service_role;

create or replace function public.refresh_unclaimed_sla_daily_digests(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  t record;
  v_tz text;
  v_day date;
  v_back integer;
  v_start timestamptz;
  v_end timestamptz;
  v_rows jsonb;
  v_escalated integer;
  v_expired integer;
  v_count integer := 0;
begin
  for t in
    select distinct ev.tenant_id
      from public.tenant_lead_sla_events ev
     where ev.rung in ('escalate', 'expire')
       and ev.occurred_at >= p_now - interval '50 hours'
  loop
    select nullif(btrim(ap.timezone), '') into v_tz from public.agency_profiles ap where ap.tenant_id = t.tenant_id;
    begin
      perform p_now at time zone coalesce(v_tz, 'UTC');
    exception when others then
      v_tz := null;
    end;
    v_tz := coalesce(v_tz, 'UTC');

    for v_back in 0..1 loop
      v_day := (p_now at time zone v_tz)::date - v_back;
      -- A closed day does not change.
      if exists (select 1 from public.tenant_sla_daily_digests dd
                  where dd.tenant_id = t.tenant_id and dd.digest_date = v_day and dd.closed) then
        continue;
      end if;
      v_start := v_day::timestamp at time zone v_tz;
      v_end := (v_day + 1)::timestamp at time zone v_tz;
      select coalesce(jsonb_agg(jsonb_build_object('partnerId', x.partner_id, 'partnerName', x.partner_name,
                                                   'escalated', x.escalated, 'expired', x.expired)
                                order by x.escalated + x.expired desc, x.partner_name), '[]'::jsonb),
             coalesce(sum(x.escalated), 0)::integer,
             coalesce(sum(x.expired), 0)::integer
        into v_rows, v_escalated, v_expired
        from (
          select ev.partner_id, coalesce(p.name, 'No partner') as partner_name,
                 count(*) filter (where ev.rung = 'escalate')::integer as escalated,
                 count(*) filter (where ev.rung = 'expire')::integer as expired
            from public.tenant_lead_sla_events ev
            left join public.partners p on p.id = ev.partner_id
           where ev.tenant_id = t.tenant_id
             and ev.rung in ('escalate', 'expire')
             and ev.occurred_at >= v_start and ev.occurred_at < v_end
           group by ev.partner_id, p.name
        ) x;
      if v_escalated + v_expired = 0
         and not exists (select 1 from public.tenant_sla_daily_digests dd where dd.tenant_id = t.tenant_id and dd.digest_date = v_day) then
        continue;
      end if;
      -- A day closes ten minutes after its midnight, so a rung the ladder's own job fired in the
      -- day's last minute (committed after this read) is still counted in it.
      insert into public.tenant_sla_daily_digests
        (tenant_id, digest_date, timezone, escalated, expired, by_partner, closed, updated_at)
      values
        (t.tenant_id, v_day, v_tz, v_escalated, v_expired, v_rows, p_now >= v_end + interval '10 minutes', p_now)
      on conflict (tenant_id, digest_date) do update
        set timezone = excluded.timezone, escalated = excluded.escalated, expired = excluded.expired,
            by_partner = excluded.by_partner, closed = excluded.closed, updated_at = excluded.updated_at;
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end;
$function$;

revoke all on function public.refresh_unclaimed_sla_daily_digests(timestamptz) from public, anon, authenticated, tenant_app;
grant execute on function public.refresh_unclaimed_sla_daily_digests(timestamptz) to service_role;

-- ── the side effects ───────────────────────────────────────────────────────
-- An earlier draft had no source argument. It was never applied live, and dropping it keeps a re-run
-- of this file from leaving two overloads.
drop function if exists public.run_unclaimed_sla_side_effects(timestamptz, integer);

create or replace function public.run_unclaimed_sla_side_effects(
  p_now timestamptz default now(), p_limit integer default 500, p_source text default 'database')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_started timestamptz := clock_timestamp();
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 1000));
  -- Only pg_cron's run is the heartbeat. The app records its own run (lib/queueSla/monitor.ts).
  v_heartbeat boolean := coalesce(p_source, 'database') = 'database';
  v_fired integer := 0;
  v_ladder_error text;
  v_digest_error text;
  v_digests integer := 0;
  e record;
  v_status text;
  v_values jsonb;
  v_name text;
  v_state text;
  v_partner_name text;
  v_channel uuid;
  v_message uuid;
  v_n integer;
  v_outcome jsonb;
  v_email_due timestamptz;
  v_queue boolean;
  v_nurture jsonb;
  v_err text;
  v_ids uuid[] := '{}';
  v_events integer := 0;
  v_owner_alerts integer := 0;
  v_offered integer := 0;
  v_partner_cards integer := 0;
  v_partner_alerts integer := 0;
  v_nobody_claimed integer := 0;
  v_nurtured integer := 0;
  v_emails_owed integer := 0;
  v_warns integer := 0;
  v_skip_stale integer := 0;
  v_skip_resolved integer := 0;
  v_gave_up integer := 0;
  v_failed integer := 0;
  v_failures jsonb := '[]'::jsonb;
  v_by_tenant jsonb := '{}'::jsonb;
  v_report jsonb;
  v_ok boolean;
begin
  if coalesce(p_source, 'database') not in ('database', 'app') then
    raise exception using errcode = '22023', message = 'INVALID_SOURCE';
  end if;
  begin
    -- 1 · the ladder, so a rung fired this minute is acted on this minute
    begin
      select count(*)::integer into v_fired from public.run_unclaimed_sla(p_now, 500);
    exception when others then
      get stacked diagnostics v_ladder_error = message_text;
    end;

    -- 2 · each pending event
    for e in
      select ev.id, ev.tenant_id, ev.work_item_id, ev.lead_id, ev.partner_id, ev.rung, ev.occurred_at, ev.attempts
        from public.tenant_lead_sla_events ev
       where ev.processed_at is null
         and (ev.claimed_at is null or ev.claimed_at < p_now - interval '10 minutes')
       order by ev.created_at asc
       limit v_limit
       for update skip locked
    loop
      v_events := v_events + 1;
      v_ids := v_ids || e.id;
      begin
        if e.occurred_at < p_now - interval '24 hours' then
          update public.tenant_lead_sla_events
             set processed_at = p_now, handled_by = 'skipped', skipped_reason = 'older_than_24_hours',
                 outcome = jsonb_build_object('sent', false), last_error = null
           where id = e.id;
          v_skip_stale := v_skip_stale + 1;
          continue;
        end if;

        select lq.status into v_status from public.lead_queue lq
         where lq.id = e.work_item_id and lq.tenant_id = e.tenant_id;
        if e.rung in ('escalate', 'partner') and v_status is distinct from 'unclaimed' then
          -- Claimed or expired since the rung fired: "needs attention" is no longer news.
          update public.tenant_lead_sla_events
             set processed_at = p_now, handled_by = 'database', skipped_reason = 'no_longer_unclaimed',
                 outcome = jsonb_build_object('sent', false, 'transferStatus', v_status), last_error = null
           where id = e.id;
          v_skip_resolved := v_skip_resolved + 1;
          continue;
        end if;

        select l.values into v_values from public.agent_leads l where l.id = e.lead_id and l.tenant_id = e.tenant_id;
        v_values := case when jsonb_typeof(v_values) = 'object' then v_values else '{}'::jsonb end;
        v_name := left(coalesce(
          nullif(btrim(v_values->>'full_name'), ''),
          nullif(btrim(concat_ws(' ', nullif(btrim(v_values->>'first_name'), ''), nullif(btrim(v_values->>'last_name'), ''))), ''),
          nullif(btrim(v_values->>'name'), ''),
          'Customer'), 160);
        v_outcome := jsonb_build_object('sent', true);
        v_email_due := null;

        if e.rung = 'warn' then
          v_outcome := jsonb_build_object('sent', false, 'note', 'the floor shows the warning');
          v_warns := v_warns + 1;

        elsif e.rung = 'escalate' then
          insert into public.agent_notifications (tenant_id, recipient_user_id, kind, title, body, link, source_key)
          select e.tenant_id, tu.user_id, 'unclaimed_sla_escalation',
                 left('Unclaimed lead needs attention: ' || v_name, 160),
                 left(v_name || ' has been waiting unclaimed. Open the lead to claim it or coordinate coverage.', 1000),
                 '/app/leads/' || e.lead_id::text,
                 'unclaimed-sla:' || e.work_item_id::text || ':escalated'
            from public.tenant_users tu
            join public.users u on u.id = tu.user_id
           where tu.tenant_id = e.tenant_id and tu.role::text = 'owner'
             and tu.accepted_at is not null and u.status::text = 'active'
          on conflict (tenant_id, recipient_user_id, source_key) do nothing;
          get diagnostics v_n = row_count;
          v_owner_alerts := v_owner_alerts + v_n;
          v_outcome := v_outcome || jsonb_build_object('ownerAlerts', v_n);

          -- "and the lead is offered more widely": everyone else who can claim a transfer.
          insert into public.agent_notifications (tenant_id, recipient_user_id, kind, title, body, link, source_key)
          select distinct e.tenant_id, tu.user_id, 'unclaimed_sla_escalation',
                 left('Still unclaimed: ' || v_name, 160),
                 left(v_name || ' has waited past the escalation time. Anyone free can claim it now.', 1000),
                 '/app/leads/' || e.lead_id::text,
                 'unclaimed-sla:' || e.work_item_id::text || ':offered'
            from public.tenant_users tu
            join public.users u on u.id = tu.user_id
           where tu.tenant_id = e.tenant_id and tu.role::text in ('producer', 'assistant')
             and tu.accepted_at is not null and u.status::text = 'active'
             and not exists (select 1 from public.tenant_users o
                              where o.tenant_id = e.tenant_id and o.user_id = tu.user_id and o.role::text = 'owner')
          on conflict (tenant_id, recipient_user_id, source_key) do nothing;
          get diagnostics v_n = row_count;
          v_offered := v_offered + v_n;
          v_outcome := v_outcome || jsonb_build_object('offered', v_n);

          -- The email is the app's to send (lib/queueSla). It is owed when an owner has an address.
          if exists (select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id
                      where tu.tenant_id = e.tenant_id and tu.role::text = 'owner' and tu.accepted_at is not null
                        and u.status::text = 'active' and nullif(btrim(u.email), '') is not null) then
            v_email_due := p_now;
            v_emails_owed := v_emails_owed + 1;
          end if;
          v_outcome := v_outcome || jsonb_build_object('emailOwed', v_email_due is not null);

        elsif e.rung = 'partner' then
          if e.partner_id is null then
            v_outcome := jsonb_build_object('sent', false, 'note', 'the transfer has no partner');
          else
            v_state := left(coalesce(nullif(btrim(v_values->>'state'), ''), nullif(btrim(v_values->>'state_code'), ''),
                                     nullif(btrim(v_values->>'address_state'), '')), 40);
            -- The partner's notice. An archived channel is an offboarded partner: nothing is posted.
            v_channel := null;
            select c.id into v_channel from public.partner_channels c
             where c.tenant_id = e.tenant_id and c.partner_id = e.partner_id
               and c.channel_type = 'partner' and c.status = 'active'
             order by c.created_at asc
             limit 1;
            v_message := null;
            if v_channel is not null then
              insert into public.partner_messages
                (tenant_id, partner_id, channel_id, work_item_id, message, message_kind, card_type, card_payload, event_key, created_by)
              values
                (e.tenant_id, e.partner_id, v_channel, e.work_item_id,
                 left(v_name || ' was not claimed before the response window. Our team has been notified.', 2000),
                 'system_card', null,
                 jsonb_build_object('customer', v_name, 'notice', 'unclaimed_partner_notice')
                   || case when v_state is not null then jsonb_build_object('state', v_state) else '{}'::jsonb end,
                 'unclaimed-sla:' || e.work_item_id::text || ':partner', null)
              on conflict (event_key) where event_key is not null do nothing
              returning id into v_message;
              if v_message is not null then
                v_partner_cards := v_partner_cards + 1;
                insert into public.partner_notifications (tenant_id, partner_id, recipient_user_id, kind, title, body, link, source_key)
                select e.tenant_id, e.partner_id, pu.user_id, 'lead_status_changed', 'Lead status updated',
                       'A lead in your pipeline has a new operational update.', '/partner/pipeline',
                       'partner-system-card:' || v_message::text
                  from public.partner_users pu
                 where pu.tenant_id = e.tenant_id and pu.partner_id = e.partner_id and pu.status = 'active'
                on conflict (tenant_id, recipient_user_id, source_key) do nothing;
                get diagnostics v_n = row_count;
                v_partner_alerts := v_partner_alerts + v_n;
                v_outcome := v_outcome || jsonb_build_object('partnerMessageId', v_message, 'partnerAlerts', v_n);
              else
                v_outcome := v_outcome || jsonb_build_object('partnerMessage', 'already posted');
              end if;
            else
              v_outcome := v_outcome || jsonb_build_object('partnerMessage', 'no active partner channel');
            end if;

            -- The agency side of it, owners only. Never a row in the partner's channel.
            select p.name into v_partner_name from public.partners p where p.id = e.partner_id and p.tenant_id = e.tenant_id;
            insert into public.agent_notifications (tenant_id, recipient_user_id, kind, title, body, link, source_key)
            select e.tenant_id, tu.user_id, 'unclaimed_sla_escalation',
                   left('Nobody claimed: ' || v_name, 160),
                   left(v_name || ' from ' || coalesce(nullif(btrim(v_partner_name), ''), 'the partner')
                        || ' was not claimed before the response window.', 1000),
                   '/app/leads/' || e.lead_id::text,
                   'unclaimed-sla:' || e.work_item_id::text || ':nobody-claimed'
              from public.tenant_users tu
              join public.users u on u.id = tu.user_id
             where tu.tenant_id = e.tenant_id and tu.role::text = 'owner'
               and tu.accepted_at is not null and u.status::text = 'active'
            on conflict (tenant_id, recipient_user_id, source_key) do nothing;
            get diagnostics v_n = row_count;
            v_nobody_claimed := v_nobody_claimed + v_n;
            v_outcome := v_outcome || jsonb_build_object('nobodyClaimedOwnerAlerts', v_n);
          end if;

        elsif e.rung = 'expire' then
          -- "It leaves the active queue and becomes a nurture lead", queued where the plan dials.
          v_queue := coalesce((select (te.entitlement->'features') ? 'outbound_dialing'
                                 from public.tenant_entitlements te where te.tenant_id = e.tenant_id), false);
          begin
            v_nurture := public.nurture_expired_transfer(e.tenant_id, e.work_item_id, v_queue);
          exception when unique_violation then
            -- lead_queue is UNIQUE(lead_id) live (lead_queue_lead_id_key, see 20260925709300), and the
            -- expired transfer is the lead's one row, so a second dialer item cannot be inserted.
            -- The lead still becomes a nurture lead, it is just not queued.
            v_nurture := public.nurture_expired_transfer(e.tenant_id, e.work_item_id, false)
                         || jsonb_build_object('dialerItem', 'refused, the lead already has its one queue row');
          end;
          if coalesce((v_nurture->>'nurtured')::boolean, false) and not coalesce((v_nurture->>'duplicate')::boolean, false) then
            v_nurtured := v_nurtured + 1;
          end if;
          v_outcome := jsonb_build_object('sent', false, 'nurture', v_nurture);
        end if;

        update public.tenant_lead_sla_events
           set processed_at = p_now, handled_by = 'database', skipped_reason = null, outcome = v_outcome,
               last_error = null, email_due_at = coalesce(email_due_at, v_email_due)
         where id = e.id;
      exception when others then
        -- The subtransaction's writes are gone. Record the failure on the event and carry on.
        get stacked diagnostics v_err = message_text;
        update public.tenant_lead_sla_events
           set attempts = attempts + 1,
               last_error = left(v_err, 1000),
               processed_at = case when attempts + 1 >= 5 then p_now end,
               handled_by = case when attempts + 1 >= 5 then 'database' end,
               skipped_reason = case when attempts + 1 >= 5 then 'gave_up_after_failures' end,
               outcome = case when attempts + 1 >= 5 then jsonb_build_object('sent', false, 'error', left(v_err, 300)) else outcome end
         where id = e.id;
        if e.attempts + 1 >= 5 then v_gave_up := v_gave_up + 1; end if;
        v_failed := v_failed + 1;
        if jsonb_array_length(v_failures) < 10 then
          v_failures := v_failures || jsonb_build_array(jsonb_build_object(
            'eventId', e.id, 'tenantId', e.tenant_id, 'rung', e.rung, 'error', left(v_err, 300)));
        end if;
      end;
    end loop;

    -- 3 · the daily digest
    begin
      v_digests := public.refresh_unclaimed_sla_daily_digests(p_now);
    exception when others then
      get stacked diagnostics v_digest_error = message_text;
    end;

    select coalesce(jsonb_object_agg(x.tenant_id::text, jsonb_build_object('events', x.n, 'sent', x.sent, 'skipped', x.skipped, 'failed', x.failed)), '{}'::jsonb)
      into v_by_tenant
      from (
        select ev.tenant_id, count(*)::integer as n,
               count(*) filter (where ev.processed_at = p_now and ev.handled_by = 'database' and ev.skipped_reason is null and coalesce((ev.outcome->>'sent')::boolean, false))::integer as sent,
               count(*) filter (where ev.skipped_reason is not null)::integer as skipped,
               count(*) filter (where ev.processed_at is null)::integer as failed
          from public.tenant_lead_sla_events ev
         where ev.id = any(v_ids)
         group by ev.tenant_id
      ) x;

    v_ok := v_failed = 0 and v_ladder_error is null and v_digest_error is null;
    v_report := jsonb_build_object(
      'ok', v_ok,
      'source', coalesce(p_source, 'database'),
      'ladder', jsonb_build_object('fired', v_fired, 'error', v_ladder_error),
      'events', v_events,
      'sent', jsonb_build_object('ownerAlerts', v_owner_alerts, 'offered', v_offered, 'partnerNotices', v_partner_cards,
                                 'partnerAlerts', v_partner_alerts, 'nobodyClaimed', v_nobody_claimed,
                                 'nurtured', v_nurtured, 'emailsOwed', v_emails_owed),
      'warnsRecorded', v_warns,
      'skipped', jsonb_build_object('olderThan24Hours', v_skip_stale, 'noLongerUnclaimed', v_skip_resolved, 'gaveUp', v_gave_up),
      'failed', v_failed,
      'failures', v_failures,
      'digest', jsonb_build_object('rows', v_digests, 'error', v_digest_error),
      'byTenant', v_by_tenant);

    -- 4 · the heartbeat
    if v_heartbeat then
      insert into public.unclaimed_sla_job_runs (source, started_at, finished_at, ok, report, error)
      values ('database', v_started, clock_timestamp(), v_ok, v_report,
              left(coalesce(v_ladder_error, v_digest_error, v_failures->0->>'error'), 2000));
      delete from public.unclaimed_sla_job_runs where started_at < p_now - interval '7 days';
    end if;
    return v_report;
  exception when others then
    get stacked diagnostics v_err = message_text;
    v_report := jsonb_build_object('ok', false, 'source', coalesce(p_source, 'database'), 'error', left(v_err, 1000));
    if v_heartbeat then
      insert into public.unclaimed_sla_job_runs (source, started_at, finished_at, ok, report, error)
      values ('database', v_started, clock_timestamp(), false, v_report, left(v_err, 2000));
    end if;
    return v_report;
  end;
end;
$function$;

revoke all on function public.run_unclaimed_sla_side_effects(timestamptz, integer, text) from public, anon, authenticated, tenant_app;
grant execute on function public.run_unclaimed_sla_side_effects(timestamptz, integer, text) to service_role;

-- ── the schedule ───────────────────────────────────────────────────────────
-- cron.schedule under an existing job name (same user) replaces that job's schedule and command,
-- so re-running this file leaves exactly one job of each name.
do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709910: not scheduled, % cannot create in public', current_user;
    return;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception '20260925709910: pg_cron is not installed; apply 20260924250100 first';
  end if;
  perform cron.schedule('unclaimed-sla-side-effects', '* * * * *',
    $cron$select public.run_unclaimed_sla_side_effects(now(), 500, 'database')$cron$);
  perform cron.schedule('unclaimed-sla-side-effects-log-cleanup', '29 3 * * *',
    $cron$delete from cron.job_run_details
           where jobid in (select jobid from cron.job where jobname = 'unclaimed-sla-side-effects')
             and end_time < now() - interval '7 days'$cron$);
end $$;

-- ── check: the objects, then one run on the real rows plus built events, all rolled back ─────
do $$
declare
  v_q public.lead_queue;
  v_q2 public.lead_queue;
  v_channel uuid;
  v_esc uuid;
  v_par uuid;
  v_old uuid;
  v_late uuid;
  v_report jsonb;
  v_owners integer;
  v_owner_email boolean;
  v_runs_before bigint;
  v_again jsonb;
  v_counts text;
  v_counts_again text;
  v_err text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709910: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  -- the objects
  if to_regprocedure('public.run_unclaimed_sla_side_effects(timestamptz, integer, text)') is null
     or to_regprocedure('public.refresh_unclaimed_sla_daily_digests(timestamptz)') is null
     or to_regclass('public.unclaimed_sla_job_runs') is null
     or to_regclass('public.tenant_sla_daily_digests') is null then
    raise exception '20260925709910 check failed: a function or table is missing';
  end if;
  if to_regprocedure('public.run_unclaimed_sla_side_effects(timestamptz, integer)') is not null then
    raise exception '20260925709910 check failed: the two-argument draft of run_unclaimed_sla_side_effects is still there';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname in ('run_unclaimed_sla_side_effects', 'refresh_unclaimed_sla_daily_digests')
                and (not p.prosecdef or not coalesce(p.proconfig::text like '%search_path=public, pg_catalog%', false))) then
    raise exception '20260925709910 check failed: a function is not security definer with a pinned search_path';
  end if;
  if has_function_privilege('tenant_app', 'public.run_unclaimed_sla_side_effects(timestamptz, integer, text)', 'EXECUTE')
     or has_function_privilege('tenant_app', 'public.refresh_unclaimed_sla_daily_digests(timestamptz)', 'EXECUTE') then
    raise exception '20260925709910 check failed: tenant_app can execute a side-effect function';
  end if;
  if (select count(*) from cron.job where jobname = 'unclaimed-sla-side-effects' and schedule = '* * * * *' and active
        and command like '%run_unclaimed_sla_side_effects(now(), 500, ''database'')%') <> 1 then
    raise exception '20260925709910 check failed: the unclaimed-SLA side-effect job is not scheduled exactly once';
  end if;

  begin
    -- A transfer whose tenant has an active owner and whose partner has an active channel, on a
    -- ladder long enough that the embedded ladder run cannot expire it first.
    select q.* into v_q
      from public.lead_queue q
      left join public.tenant_queue_sla_settings s on s.tenant_id = q.tenant_id
     where q.partner_id is not null
       and q.status in ('completed', 'dropped', 'expired', 'closed')
       and coalesce(s.expire_after_seconds, 14400) > 900
       and exists (select 1 from public.partner_channels c where c.tenant_id = q.tenant_id and c.partner_id = q.partner_id
                     and c.channel_type = 'partner' and c.status = 'active')
       and exists (select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id
                    where tu.tenant_id = q.tenant_id and tu.role::text = 'owner' and tu.accepted_at is not null and u.status::text = 'active')
       and not exists (select 1 from public.lead_queue o where o.lead_id = q.lead_id and o.id <> q.id
                         and o.status in ('unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active'))
     order by q.queued_at desc
     limit 1;
    if v_q.id is null then raise exception 'SKIP no transfer to build the check on'; end if;
    -- A second transfer that is no longer unclaimed: its late escalation must be recorded, not sent.
    select q.* into v_q2
      from public.lead_queue q
     where q.partner_id is not null and q.id <> v_q.id
       and q.status in ('completed', 'dropped', 'closed')
     order by q.queued_at desc
     limit 1;
    if v_q2.id is null then raise exception 'SKIP no second transfer to build the check on'; end if;

    select count(*), bool_or(nullif(btrim(u.email), '') is not null) into v_owners, v_owner_email
      from public.tenant_users tu join public.users u on u.id = tu.user_id
     where tu.tenant_id = v_q.tenant_id and tu.role::text = 'owner' and tu.accepted_at is not null and u.status::text = 'active';

    delete from public.tenant_lead_sla_events where work_item_id in (v_q.id, v_q2.id);
    delete from public.agent_notifications where tenant_id in (v_q.tenant_id, v_q2.tenant_id)
       and (source_key like 'unclaimed-sla:' || v_q.id::text || ':%' or source_key like 'unclaimed-sla:' || v_q2.id::text || ':%');
    delete from public.partner_messages where event_key = 'unclaimed-sla:' || v_q.id::text || ':partner';
    update public.lead_queue
       set status = 'unclaimed', queued_at = now() - interval '6 minutes', claimed_by = null, claimed_at = null,
           sla_warned_at = now(), sla_escalated_at = now(), sla_partner_notified_at = now(), sla_expired_at = null
     where id = v_q.id;
    insert into public.tenant_lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at)
    values (v_q.tenant_id, v_q.id, v_q.lead_id, v_q.partner_id, 'escalate', now()) returning id into v_esc;
    insert into public.tenant_lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at)
    values (v_q.tenant_id, v_q.id, v_q.lead_id, v_q.partner_id, 'partner', now()) returning id into v_par;
    insert into public.tenant_lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at)
    values (v_q.tenant_id, v_q.id, v_q.lead_id, v_q.partner_id, 'warn', now() - interval '25 hours') returning id into v_old;
    insert into public.tenant_lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at)
    values (v_q2.tenant_id, v_q2.id, v_q2.lead_id, v_q2.partner_id, 'escalate', now()) returning id into v_late;

    -- The app's call: does the work, writes no heartbeat (only pg_cron's run is the heartbeat).
    select count(*) into v_runs_before from public.unclaimed_sla_job_runs where source = 'database';
    v_report := public.run_unclaimed_sla_side_effects(now(), 1000, 'app');
    raise notice '20260925709910: check run report %', v_report;
    if v_report ? 'error' then
      raise exception 'CHECK the run failed as a whole: %', v_report->>'error';
    end if;
    if v_report->'ladder'->>'error' is not null or v_report->'digest'->>'error' is not null then
      raise exception 'CHECK the ladder or the digest failed: % / %', v_report->'ladder'->>'error', v_report->'digest'->>'error';
    end if;
    if exists (select 1 from public.tenant_lead_sla_events where id in (v_esc, v_par, v_old, v_late) and processed_at is null) then
      select last_error into v_err from public.tenant_lead_sla_events
       where id in (v_esc, v_par, v_old, v_late) and last_error is not null limit 1;
      if v_err is not null then raise exception 'CHECK a built event failed: %', v_err; end if;
      raise exception 'SKIP the built events were not reached in one run (more than 1000 pending)';
    end if;
    if coalesce((v_report->>'failed')::integer, 0) > 0 then
      -- A real row failing is reported, not fatal: it keeps last_error and is retried every minute.
      raise notice '20260925709910: % real event(s) failed in the check run, first: %', v_report->>'failed', v_report->'failures'->0;
    end if;
    if (select count(*) from public.unclaimed_sla_job_runs where source = 'database') <> v_runs_before then
      raise exception 'CHECK an app-invoked run wrote the pg_cron heartbeat';
    end if;

    -- escalation: every active owner, the wider offer, the email owed when an owner has an address
    if (select count(*) from public.agent_notifications where tenant_id = v_q.tenant_id
         and source_key = 'unclaimed-sla:' || v_q.id::text || ':escalated') <> v_owners then
      raise exception 'CHECK the escalation alert did not reach every active owner';
    end if;
    if exists (select 1 from public.agent_notifications n
                join public.tenant_users tu on tu.tenant_id = n.tenant_id and tu.user_id = n.recipient_user_id
               where n.tenant_id = v_q.tenant_id and n.source_key = 'unclaimed-sla:' || v_q.id::text || ':escalated'
                 and tu.role::text <> 'owner') then
      raise exception 'CHECK the escalation alert reached someone who is not an owner';
    end if;
    if not exists (select 1 from public.tenant_lead_sla_events where id = v_esc and handled_by = 'database'
                    and skipped_reason is null and (outcome->>'ownerAlerts')::integer = v_owners) then
      raise exception 'CHECK the escalation event was not recorded as handled by the database with its owner alerts';
    end if;
    if (select email_due_at is not null from public.tenant_lead_sla_events where id = v_esc) is distinct from coalesce(v_owner_email, false) then
      raise exception 'CHECK the escalation email was not marked owed exactly when an owner has an address';
    end if;

    -- partner notice: one row, Design 1's shape, in the active partner channel
    select c.id into v_channel from public.partner_channels c where c.tenant_id = v_q.tenant_id and c.partner_id = v_q.partner_id
       and c.channel_type = 'partner' and c.status = 'active' order by c.created_at limit 1;
    if (select count(*) from public.partner_messages m
         where m.event_key = 'unclaimed-sla:' || v_q.id::text || ':partner'
           and m.channel_id = v_channel and m.message_kind = 'system_card' and m.card_type is null
           and m.card_payload->>'notice' = 'unclaimed_partner_notice' and m.created_by is null
           and m.message like '% was not claimed before the response window. Our team has been notified.') <> 1 then
      raise exception 'CHECK the partner notice is missing or not in the agreed shape';
    end if;
    -- nobody claimed: owners only, never the partner's channel
    if (select count(*) from public.agent_notifications where tenant_id = v_q.tenant_id
         and source_key = 'unclaimed-sla:' || v_q.id::text || ':nobody-claimed') <> v_owners then
      raise exception 'CHECK the nobody-claimed alert did not reach every active owner';
    end if;
    if exists (select 1 from public.partner_messages m where m.work_item_id = v_q.id and m.card_type = 'nobody_claimed'
                and m.created_at >= now()) then
      raise exception 'CHECK a nobody_claimed card was posted to the partner';
    end if;

    -- older than a day: recorded, not sent
    if not exists (select 1 from public.tenant_lead_sla_events where id = v_old
                    and handled_by = 'skipped' and skipped_reason = 'older_than_24_hours' and processed_at is not null) then
      raise exception 'CHECK a day-old event was not skipped';
    end if;
    -- no longer unclaimed: recorded, not sent
    if not exists (select 1 from public.tenant_lead_sla_events where id = v_late
                    and handled_by = 'database' and skipped_reason = 'no_longer_unclaimed' and processed_at is not null)
       or exists (select 1 from public.agent_notifications where tenant_id = v_q2.tenant_id
                   and source_key like 'unclaimed-sla:' || v_q2.id::text || ':%') then
      raise exception 'CHECK a late escalation for a transfer no longer unclaimed was sent or not recorded';
    end if;

    -- the digest: an open row (today, in the agency's own day) counts the built escalation
    if not exists (select 1 from public.tenant_sla_daily_digests d
                    where d.tenant_id = v_q.tenant_id and d.escalated >= 1 and not d.closed
                      and d.digest_date between (now() at time zone 'UTC')::date - 1 and (now() at time zone 'UTC')::date + 1) then
      raise exception 'CHECK the daily digest has no open row counting the escalation';
    end if;

    -- pg_cron's call: writes the heartbeat, and sends nothing a second time
    select string_agg(x, ',') into v_counts from (
      select (select count(*) from public.agent_notifications where tenant_id = v_q.tenant_id and source_key like 'unclaimed-sla:' || v_q.id::text || ':%')::text as x
      union all select (select count(*) from public.partner_messages where event_key = 'unclaimed-sla:' || v_q.id::text || ':partner')::text
      union all select (select count(*) from public.partner_notifications where source_key like 'partner-system-card:%' and created_at >= now())::text) c;
    v_again := public.run_unclaimed_sla_side_effects(now(), 1000);
    select string_agg(x, ',') into v_counts_again from (
      select (select count(*) from public.agent_notifications where tenant_id = v_q.tenant_id and source_key like 'unclaimed-sla:' || v_q.id::text || ':%')::text as x
      union all select (select count(*) from public.partner_messages where event_key = 'unclaimed-sla:' || v_q.id::text || ':partner')::text
      union all select (select count(*) from public.partner_notifications where source_key like 'partner-system-card:%' and created_at >= now())::text) c;
    if v_counts <> v_counts_again then
      raise exception 'CHECK a second run sent again (% then %)', v_counts, v_counts_again;
    end if;
    if not exists (select 1 from public.unclaimed_sla_job_runs where source = 'database' and started_at >= now()) then
      raise exception 'CHECK the pg_cron-style run wrote no heartbeat';
    end if;

    raise exception 'ROLLBACK_OK';
  exception when others then
    if sqlerrm = 'ROLLBACK_OK' then
      raise notice '20260925709910: ran on the real rows and built events, then rolled back. Escalation to owners, email owed, partner notice, nobody-claimed to owners, day-old and no-longer-unclaimed recorded not sent, digest, heartbeat only from pg_cron, no repeat.';
    elsif sqlerrm like 'SKIP%' then
      raise notice '20260925709910: behaviour check skipped (%)', sqlerrm;
    else
      raise exception '20260925709910 check failed: %', sqlerrm;
    end if;
  end;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925709910', 'unclaimed_sla_side_effects_run_every_minute') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [10/17] 20260925709950_partner_limits_count_active_partners_only.sql ──────────
begin;

-- ---------------------------------------------------------------------------
-- LA-1.19 / W6.2 · only ACTIVE partners hold a slot against the plan's partner limits
--
-- The user's decision (M1 fulfilment, 2026-09-25): a draft never holds a slot. Activating a draft or
-- resuming a paused partner takes one and is refused at the cap. Create, resume and the usage figure
-- on /app/publishers all use the same count, status = 'active'.
--
-- Before this file create_partner_with_limits and update_partner_with_limits counted draft + active
-- while transition_partner_with_limits counted active only. With drafts filling the cap, the page said
-- 10 of 10 and refused a create, yet resuming a paused publisher went through and usage read 11 of 10
-- (found by W6.2).
--
-- Changes, and nothing else:
--   create_partner_with_limits   counts status = 'active' (was draft + active)
--   update_partner_with_limits   a type change counts status = 'active' in the new type (was draft + active)
--   transition_partner_with_limits   the partner-user check on activation refuses only when the count,
--     which already includes the partner's own users, is OVER the limit. It refused at exactly the
--     limit, so resuming a partner with no users was blocked when the plan's partner users were all in use.
--
-- Each body is the LIVE definition (pg_get_functiondef, read 2026-09-25, CRLF normalised) with one
-- single-line anchor replaced per change. create or replace keeps the signatures and grants.
-- create/update were last defined by 20260925709200, transition by 20260912150000.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_partner_with_limits(p_tenant_id uuid, p_name text, p_partner_type text, p_country text, p_contact_name text, p_contact_email text, p_timezone text, p_notes text, p_created_by uuid, p_max_publishers integer DEFAULT NULL::integer, p_max_marketing_partners integer DEFAULT NULL::integer, p_max_affiliates integer DEFAULT NULL::integer)
 RETURNS partners
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_row public.partners;
  v_count integer;
  v_limit integer;
  v_key text;
  v_slug text;
begin
  if p_partner_type not in ('publisher', 'marketing', 'affiliate') then
    raise exception 'invalid_partner_type:%', p_partner_type;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  perform 1 from tenants where id = p_tenant_id for update;
  if not found then raise exception 'tenant_not_found'; end if;

  -- LA-1.19: only an ACTIVE partner holds a slot. A draft holds none. Creating one is still refused
  -- at the cap, in the same count activation uses, because a draft made there could never be activated.
  v_key := case p_partner_type when 'publisher' then 'max_publishers' when 'marketing' then 'max_marketing_partners' else 'max_affiliates' end;
  v_limit := case p_partner_type when 'publisher' then p_max_publishers when 'marketing' then p_max_marketing_partners else p_max_affiliates end;
  select count(*)::integer into v_count from partners
   where tenant_id = p_tenant_id and partner_type = p_partner_type and status = 'active';
  if v_limit is not null and v_count >= v_limit then
    raise exception 'partner_limit_reached:%:%:%', v_key, v_count, v_limit;
  end if;

  -- Readable prefix, random suffix. `partners.slug` is required by the organizations-era schema.
  -- gen_random_uuid() rather than gen_random_bytes(): pgcrypto is installed into the `extensions`
  -- schema and this function's search_path is `public`, so gen_random_bytes is not resolvable here.
  -- gen_random_uuid is core from PG13 and needs no schema qualification.
  v_slug := left(nullif(regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'), ''), 40);
  v_slug := trim(both '-' from coalesce(v_slug, 'partner')) || '-' || left(replace(gen_random_uuid()::text, '-', ''), 8);

  -- status is set explicitly. The column default is 'onboarding', the organizations-era product's
  -- first state, and LA-1.1's lifecycle is draft -> active -> paused -> offboarded. A partner left
  -- on the default can never be activated ("invalid_partner_transition:onboarding:active") and is
  -- never activated at all. It holds no slot until transition_partner_with_limits makes it active.
  insert into partners (tenant_id, name, slug, partner_type, status, country, contact_name, contact_email, timezone, notes, created_by)
  values (p_tenant_id, btrim(p_name), v_slug, p_partner_type, 'draft', upper(btrim(p_country)),
          coalesce(btrim(p_contact_name), ''), nullif(lower(btrim(p_contact_email)), ''),
          btrim(p_timezone), coalesce(btrim(p_notes), ''), p_created_by)
  returning * into v_row;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_partner_with_limits(p_tenant_id uuid, p_partner_id uuid, p_name text, p_partner_type text, p_country text, p_contact_name text, p_contact_email text, p_timezone text, p_notes text, p_max_publishers integer DEFAULT NULL::integer, p_max_marketing_partners integer DEFAULT NULL::integer, p_max_affiliates integer DEFAULT NULL::integer)
 RETURNS partners
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_row public.partners;
  v_old public.partners;
  v_count integer;
  v_limit integer;
  v_key text;
begin
  if p_partner_type not in ('publisher', 'marketing', 'affiliate') then
    raise exception 'invalid_partner_type:%', p_partner_type;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  select * into v_old from partners where id = p_partner_id and tenant_id = p_tenant_id for update;
  if not found or v_old.status in ('paused', 'offboarded') then
    raise exception 'partner_not_found_or_offboarded';
  end if;

  if v_old.partner_type <> p_partner_type then
    v_key := case p_partner_type when 'publisher' then 'max_publishers' when 'marketing' then 'max_marketing_partners' else 'max_affiliates' end;
    v_limit := case p_partner_type when 'publisher' then p_max_publishers when 'marketing' then p_max_marketing_partners else p_max_affiliates end;
    select count(*)::integer into v_count from partners
     where tenant_id = p_tenant_id and partner_type = p_partner_type
       and status = 'active' and id <> p_partner_id;
    if v_limit is not null and v_count >= v_limit then
      raise exception 'partner_limit_reached:%:%:%', v_key, v_count, v_limit;
    end if;
  end if;

  update partners
     set name = btrim(p_name), partner_type = p_partner_type, country = upper(btrim(p_country)),
         contact_name = coalesce(btrim(p_contact_name), ''), contact_email = nullif(lower(btrim(p_contact_email)), ''),
         timezone = btrim(p_timezone), notes = coalesce(btrim(p_notes), '')
   where id = p_partner_id and tenant_id = p_tenant_id
   returning * into v_row;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.transition_partner_with_limits(p_tenant_id uuid, p_partner_id uuid, p_next_status text, p_confirmation text DEFAULT NULL::text, p_max_publishers integer DEFAULT NULL::integer, p_max_marketing_partners integer DEFAULT NULL::integer, p_max_affiliates integer DEFAULT NULL::integer, p_max_partner_users integer DEFAULT NULL::integer)
 RETURNS partners
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_row public.partners;
  v_count integer;
  v_limit integer;
  v_key text;
begin
  if p_next_status not in ('draft', 'active', 'paused', 'offboarded') then
    raise exception 'invalid_partner_status:%', p_next_status;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  select * into v_row from partners where id = p_partner_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'partner_not_found'; end if;
  if v_row.status = 'offboarded' then raise exception 'partner_already_offboarded'; end if;
  if p_next_status = 'offboarded' and coalesce(p_confirmation, '') <> 'OFFBOARD' then
    raise exception 'offboard_confirmation_required';
  end if;
  if not ((v_row.status = 'draft' and p_next_status = 'active')
       or (v_row.status = 'active' and p_next_status in ('paused', 'offboarded'))
       or (v_row.status = 'paused' and p_next_status in ('active', 'offboarded'))) then
    raise exception 'invalid_partner_transition:%:%', v_row.status, p_next_status;
  end if;

  if p_next_status = 'active' and v_row.status <> 'active' then
    v_key := case v_row.partner_type when 'publisher' then 'max_publishers' when 'marketing' then 'max_marketing_partners' else 'max_affiliates' end;
    v_limit := case v_row.partner_type when 'publisher' then p_max_publishers when 'marketing' then p_max_marketing_partners else p_max_affiliates end;
    select count(*)::integer into v_count from partners
     where tenant_id = p_tenant_id and partner_type = v_row.partner_type and status = 'active';
    if v_limit is not null and v_count >= v_limit then
      raise exception 'partner_limit_reached:%:%:%', v_key, v_count, v_limit;
    end if;
    select count(*)::integer into v_count from partner_users pu
      join partners p on p.id = pu.partner_id
     where pu.tenant_id = p_tenant_id and pu.status = 'active'
       and (p.status = 'active' or p.id = p_partner_id);
    -- v_count already includes this partner's own users, so reaching the limit exactly is allowed.
    if p_max_partner_users is not null and v_count > p_max_partner_users then
      raise exception 'partner_user_limit_reached:max_partner_users:%:%', v_count, p_max_partner_users;
    end if;
  end if;

  update partners
     set status = p_next_status,
         paused_at = case when p_next_status = 'paused' then coalesce(paused_at, now()) else paused_at end,
         offboarded_at = case when p_next_status = 'offboarded' then now() else offboarded_at end
   where id = p_partner_id and tenant_id = p_tenant_id
   returning * into v_row;

  if p_next_status = 'offboarded' then
    update partner_users
       set status = 'revoked', revoked_at = coalesce(revoked_at, now()), deactivated_at = coalesce(deactivated_at, now())
     where tenant_id = p_tenant_id and partner_id = p_partner_id and status <> 'revoked';
  end if;

  return v_row;
end;
$function$;


-- ── assertions ─────────────────────────────────────────────────────────────
do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709950: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
              and proname in ('create_partner_with_limits', 'update_partner_with_limits')
              and position('status in (''draft'', ''active'')' in prosrc) > 0) then
    raise exception '20260925709950: a draft still holds a partner slot';
  end if;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'create_partner_with_limits'
                  and position('partner_type = p_partner_type and status = ''active''' in prosrc) > 0) then
    raise exception '20260925709950: create_partner_with_limits does not count active partners only';
  end if;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'update_partner_with_limits'
                  and position('and status = ''active'' and id <> p_partner_id' in prosrc) > 0) then
    raise exception '20260925709950: update_partner_with_limits does not count active partners only';
  end if;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'transition_partner_with_limits'
                  and position('v_count > p_max_partner_users' in prosrc) > 0
                  and position('status = ''active''' in prosrc) > 0) then
    raise exception '20260925709950: transition_partner_with_limits still refuses at exactly the partner-user limit';
  end if;
  -- Coverage: LA-1.19-2, LA-1.19-5 and W6.2 (active partners only).
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925709950', 'partner_limits_count_active_partners_only') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [11/17] 20260929110000_partner_limit_trigger_checks_tenant_partners.sql ───────
begin;

-- ---------------------------------------------------------------------------
-- M1 D7 / LA-1.19 · the database-side partner limit also covers partners created through the app
--
-- partners_enforce_limit (BEFORE INSERT OR UPDATE OF status, partner_type ON partners) runs
-- private.enforce_partner_type_limit, an organizations-era guard. It reads the limit from
-- organization_entitlements by partners.organization_id. Every partner the app creates
-- (create_partner_with_limits) has tenant_id and NO organization_id, so the limit read returns null
-- and the check is skipped. Only the app-side check (the limits the route passes into the
-- *_with_limits functions) stood between a direct write and the plan's cap.
--
-- This restates the trigger function from its LIVE definition (pg_get_functiondef, read
-- 2026-09-29, CRLF normalised, not defined in any migration file) with one new branch.
-- A partner with no organization id and a tenant id is checked against the tenant's cached plan
-- limits, tenant_entitlements.entitlement -> limits -> max_publishers / max_marketing_partners /
-- max_affiliates (the same snapshot the app reads its limits from). The count is the user's
-- LA-1.19 rule, ACTIVE partners of that type in the tenant, this row left out. The refusal is
-- raised in the functions' own words, partner_limit_reached:<key>:<count>:<limit>, which the
-- partners routes already answer as a 403 that names the limit. The organizations branch is
-- unchanged.
--
-- The tenant branch takes the same transaction advisory lock the *_with_limits functions take,
-- so a create, activation or type change and this check are serialised per tenant.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.enforce_partner_type_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  limit_key text;
  limit_value integer;
  active_count integer;
  raw_limit jsonb;
begin
  if new.status = 'active' then
    if new.partner_type = 'publisher' then limit_key := 'max_publishers';
    elsif new.partner_type = 'marketing' then limit_key := 'max_marketing_partners';
    elsif new.partner_type = 'affiliate' then limit_key := 'max_affiliates';
    else raise exception 'Invalid partner type';
    end if;

    if new.organization_id is null and new.tenant_id is not null then
      -- LA-1.19 (D7): a tenant partner, created through the app. Only ACTIVE partners hold a slot.
      if tg_op = 'INSERT' or old.status <> 'active' or old.partner_type <> new.partner_type then
        perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text, 0));
        select te.entitlement -> 'limits' -> limit_key into raw_limit
          from public.tenant_entitlements te where te.tenant_id = new.tenant_id;
        limit_value := case when jsonb_typeof(raw_limit) = 'number' and (raw_limit #>> '{}')::numeric >= 0
                            then floor((raw_limit #>> '{}')::numeric)::integer else null end;
        if limit_value is not null then
          select count(*)::integer into active_count from public.partners p
           where p.tenant_id = new.tenant_id and p.partner_type = new.partner_type
             and p.status = 'active' and p.id <> new.id;
          if active_count >= limit_value then
            raise exception 'partner_limit_reached:%:%:%', limit_key, active_count, limit_value;
          end if;
        end if;
      end if;
      return new;
    end if;

    perform pg_advisory_xact_lock(hashtextextended('la-1.19:partner:' || new.organization_id::text || ':' || new.partner_type, 0));
    limit_value := private.cached_partner_limit(new.organization_id, limit_key);
    active_count := private.partner_active_count(new.organization_id, new.partner_type);
    if limit_value is not null and active_count >= limit_value
       and (tg_op = 'INSERT' or old.status <> 'active' or old.partner_type <> new.partner_type) then
      raise exception '% limit reached', replace(limit_key, 'max_', '');
    end if;
  end if;
  return new;
end;
$function$;


-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_src text;
begin
  if not has_schema_privilege(current_user, 'private', 'CREATE') then
    raise notice '20260929110000: assertions skipped, % cannot create in private', current_user;
    return;
  end if;
  select p.prosrc into v_src from pg_proc p
   where p.pronamespace = 'private'::regnamespace and p.proname = 'enforce_partner_type_limit';
  if v_src is null or position('tenant_entitlements' in v_src) = 0
     or position('partner_limit_reached:%:%:%' in v_src) = 0 then
    raise exception '20260929110000: the partner limit trigger still skips partners with no organization id';
  end if;
  if not exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                  where t.tgrelid = 'public.partners'::regclass and not t.tgisinternal
                    and p.proname = 'enforce_partner_type_limit') then
    raise exception '20260929110000: partners_enforce_limit is not attached to partners';
  end if;
  -- Coverage: M1 D7, LA-1.19-3 (a direct write over the cap is refused by the database).
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260929110000', 'partner_limit_trigger_checks_tenant_partners') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [12/17] 20260929120000_reconcile_partner_intake_for_one_tenant.sql ────────────
begin;

-- LA-1.7-3: the intake reconciliation check, for one tenant.
--
-- public.reconcile_partner_intake() (20260902170000) walks every partner lead in the database. On
-- the shared project that is ~200k partner leads and it answers in ~9 s, next to the service
-- role's statement timeout, and a backlog of seeded load-test leads (drained 500 per run by the
-- 20260925510200 job) fills PostgREST's 1,000-row response before any newer lead is reached. So
-- neither scripts/reconcile-intake.mjs --tenant nor the LA-1.7 suite could see one tenant's
-- orphan reliably.
--
-- 1. reconcile_partner_intake_for_tenant(p_tenant_id) is the same rule, read through the
--    (tenant_id, partner_id, submission_id) index. The global function is unchanged and the pg_cron
--    job keeps calling it.
-- 2. intake_failures gains an index on lead_id. Both functions probe it once per partner lead and
--    it had none.
--
-- Idempotent. Additive only.

create index if not exists intake_failures_lead_idx on public.intake_failures (lead_id);

create or replace function public.reconcile_partner_intake_for_tenant(p_tenant_id uuid)
returns table (
  lead_id uuid,
  tenant_id uuid,
  submission_id uuid,
  missing_steps text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.id,
    l.tenant_id,
    l.submission_id,
    array['work_item']::text[]
  from public.agent_leads l
  where l.tenant_id = p_tenant_id
    and l.partner_id is not null
    and l.submission_id is not null
    and not exists (select 1 from public.lead_queue q where q.lead_id = l.id)
    and not exists (select 1 from public.intake_failures f where f.lead_id = l.id)
  order by l.created_at;
$$;

revoke all on function public.reconcile_partner_intake_for_tenant(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.reconcile_partner_intake_for_tenant(uuid) to service_role;

-- assertions
do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929120000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if to_regprocedure('public.reconcile_partner_intake_for_tenant(uuid)') is null then
    raise exception '20260929120000: reconcile_partner_intake_for_tenant is missing';
  end if;
  if to_regclass('public.intake_failures_lead_idx') is null then
    raise exception '20260929120000: intake_failures_lead_idx is missing';
  end if;
  -- A tenant that does not exist has nothing to reconcile, and asking must not fail.
  if exists (select 1 from public.reconcile_partner_intake_for_tenant('00000000-0000-0000-0000-000000000000'::uuid)) then
    raise exception '20260929120000: an unknown tenant reported partner leads';
  end if;
  if has_function_privilege('anon', 'public.reconcile_partner_intake_for_tenant(uuid)', 'EXECUTE') then
    raise exception '20260929120000: anon can run the tenant reconciliation';
  end if;
  -- Coverage: M1 LA-1.7-3 (a partner lead with no work item and no logged failure is reported).
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260929120000', 'reconcile_partner_intake_for_one_tenant') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [13/17] 20260929130000_partner_password_activates_invited_account.sql ─────────
begin;

-- W1.6 (Module 1) -- a partner user invited by the agency could never sign in.
--
-- An invite creates the account with users.status = 'invited'. Setting the password through
-- /partner/set-password runs consume_partner_password_token, which set the password, marked the
-- invitation accepted and the membership active -- but never moved the ACCOUNT out of 'invited'.
-- Partner login, requirePartner and mint-session all require users.status = 'active', so every
-- agency-invited partner user was locked out (login recorded no_membership). Found live 2026-09-30.
--
-- 1. consume_partner_password_token now also activates the account, but only from 'invited'.
--    A suspended or inactive account is never reactivated by redeeming an old invite.
--    Body is the live definition (read 2026-09-30) plus that one update. Signature, return shape,
--    security (invoker) and search_path are unchanged, so existing grants stand.
-- 2. Repair: accounts that already redeemed an invite this way (password set, still 'invited',
--    holding an accepted active partner membership) are activated. They are exactly the users
--    the bug locked out.

create or replace function public.consume_partner_password_token(p_token_hash text, p_password_hash text)
 returns table(user_id uuid, partner_id uuid, accepted_at timestamp with time zone)
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_token public.user_invitations%rowtype;
  v_accepted_at timestamptz := now();
begin
  select invitation.* into v_token
    from public.user_invitations invitation
    join public.partner_users membership on membership.partner_id = invitation.partner_id and membership.user_id = invitation.user_id
    join public.partners partner on partner.id = membership.partner_id
   where invitation.token_hash = p_token_hash
     and invitation.partner_id is not null
     and invitation.purpose = 'invite'
     and invitation.accepted_at is null
     and invitation.expires_at > now()
     and membership.status = 'active'
     and partner.status <> 'offboarded'
   for update of invitation;
  if not found then raise exception using errcode = 'P0001', message = 'PARTNER_PASSWORD_TOKEN_INVALID_OR_EXPIRED'; end if;

  update public.users account set password_hash = p_password_hash where account.id = v_token.user_id;
  if not found then raise exception using errcode = 'P0001', message = 'PARTNER_PASSWORD_TOKEN_USER_NOT_FOUND'; end if;
  -- The invitee has now proven the invite link and chosen a password: the account is live.
  -- Only from 'invited' -- a suspended or inactive account stays as an administrator left it.
  update public.users account set status = 'active' where account.id = v_token.user_id and account.status = 'invited';
  update public.user_invitations invitation set accepted_at = v_accepted_at
   where invitation.id = v_token.id and invitation.accepted_at is null;
  if not found then raise exception using errcode = 'P0001', message = 'PARTNER_PASSWORD_TOKEN_ALREADY_USED'; end if;
  update public.partner_users membership
     set accepted_at = coalesce(membership.accepted_at, v_accepted_at), status = 'active', revoked_at = null, deactivated_at = null
   where membership.partner_id = v_token.partner_id and membership.user_id = v_token.user_id and membership.status = 'active';
  if not found then raise exception using errcode = 'P0001', message = 'PARTNER_MEMBERSHIP_NOT_ACTIVE'; end if;
  return query select v_token.user_id, v_token.partner_id, v_accepted_at;
end;
$function$;

-- Repair the accounts the bug already locked out.
update public.users account
   set status = 'active'
 where account.status = 'invited'
   and account.password_hash is not null
   and exists (
     select 1 from public.partner_users membership
      where membership.user_id = account.id
        and membership.status = 'active'
        and membership.accepted_at is not null
   );

do $$
begin
  if not has_schema_privilege('public', 'CREATE') then
    raise notice 'skipping the self-check: this role cannot create in public';
    return;
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'consume_partner_password_token'
       and p.prosrc like '%set status = ''active'' where account.id = v_token.user_id and account.status = ''invited''%'
  ) then
    raise exception 'consume_partner_password_token still leaves a redeemed partner account invited';
  end if;
  if exists (
    select 1 from public.users account
     where account.status = 'invited' and account.password_hash is not null
       and exists (select 1 from public.partner_users m where m.user_id = account.id and m.status = 'active' and m.accepted_at is not null)
  ) then
    raise exception 'a partner account that redeemed its invite is still invited';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260929130000', 'partner_password_activates_invited_account') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [14/17] 20260929140000_m1_partner_pipeline_lean_read_model.sql ────────────────
begin;

-- M1 perf · LA-1.17-12, the partner pipeline at 5,000 leads (target under 2 s).
--
-- Measured 2026-09-30 on the load-test workspace (partner with 5,000 queue items): the RPC alone took
-- 441 ms to 7.9 s and the route hit the statement timeout. Its `filtered` CTE carried q.* (35 columns)
-- and l.values, about 650 bytes a row, so the 5,000-row CTE spilled to disk (312 temp blocks written)
-- and was re-read from disk nine times, once per counter and facet. The route then made three more
-- reads beside it (the told flags, submitted since midnight, oldest open), and "submitted since
-- midnight" walked every one of the partner's queue items with a per-row lead lookup (4 to 9 s).
--
-- Restated from the LIVE definition (read 2026-09-30, which is 20260912370000's body). Changes:
--   * filtered carries only the twelve columns the payload and the counters read, not q.* and
--     l.values. The customer name and the closer's name are worked out for the page's rows only.
--   * The four counters read filtered in one pass instead of four.
--   * work_mem 16MB and jit off, which 20260903360000 and 20260906130000 set and 20260912370000's
--     create-or-replace silently dropped, are restated. Parallel workers are off for this read: a
--     5,000-row bounded read gains nothing from them and on 2026-09-30 the worker start-up was the
--     slowest part of the plan.
--   * Three additive fields, so the route can stop making its three extra reads:
--       rows[i][15]        true when the SLA ladder has told the partner (sla_partner_notified_at)
--                          and the item is still unclaimed or expired (lanes.ts nobodyClaimed)
--       oldest_open_at     the oldest queued_at among the board's open lanes
--       submitted_recent   [bucket, count] pairs, a bucket being 15 minutes of lead creation time
--                          (epoch seconds / 900) over the last 26 hours. Every time zone's midnight
--                          falls on a 15-minute boundary, so the route sums the buckets from its
--                          own startOfTodayIn(zone) with no time-zone rules in the database.
--     lib/partnerLeads/service.ts reads them when present and falls back to its own reads when not,
--     so the route works before and after this file.
-- Payload positions 0 to 14 and every other key are unchanged.

create or replace function public.partner_lead_pipeline_page(p_tenant_id uuid, p_partner_id uuid, p_date_from date default null::date, p_date_to date default null::date, p_closer_id uuid default null::uuid, p_product text default null::text, p_stage_id uuid default null::uuid, p_outcome text default null::text, p_timezone text default 'UTC'::text, p_limit integer default 250, p_offset integer default 0)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'pg_catalog'
 set work_mem to '16MB'
 set jit to 'off'
 set max_parallel_workers_per_gather to '0'
as $function$
  with filtered as materialized (
    select q.id, q.lead_id, q.queued_at, q.updated_at, q.product_line, q.stage_id, q.stage_key, q.pipeline_id,
      q.disposition, q.status, q.sla_partner_notified_at,
      l.created_at as submitted_at, l.created_by as submitted_by_id
    from public.lead_queue q join public.agent_leads l on l.id=q.lead_id and l.tenant_id=q.tenant_id
    where q.tenant_id=p_tenant_id and q.partner_id=p_partner_id
      and (p_date_from is null or q.queued_at >= p_date_from::timestamptz)
      and (p_date_to is null or q.queued_at < (p_date_to + 1)::timestamptz)
      and (p_closer_id is null or l.created_by=p_closer_id)
      and (p_product is null or q.product_line=p_product)
      and (p_stage_id is null or q.stage_id=p_stage_id)
      and (p_outcome is null or q.disposition=p_outcome)
  ), page_keys as (
    select * from filtered order by queued_at desc, id desc
    limit least(greatest(coalesce(p_limit,250),1),5000) offset greatest(coalesce(p_offset,0),0)
  ), page as (
    select k.*, coalesce(u.name, 'Partner closer') as submitted_by_name,
      coalesce(nullif(btrim(l.values->>'full_name'), ''), nullif(btrim(concat_ws(' ', l.values->>'first_name', l.values->>'last_name')), ''), nullif(btrim(l.values->>'name'), ''), 'Unnamed lead') as customer
    from page_keys k join public.agent_leads l on l.id=k.lead_id
    left join public.users u on u.id=k.submitted_by_id
  ), stage_rows as (
    select coalesce(stage_id::text, stage_key) as stage_id, coalesce(pipeline_id::text,'default') as pipeline_id,
      coalesce(stage_key,'New') as stage_name, count(*)::integer as lead_count
    from filtered group by coalesce(stage_id::text, stage_key), coalesce(pipeline_id::text,'default'), coalesce(stage_key,'New')
  ), totals as (
    select count(*)::integer as total,
      (count(*) filter (where submitted_at::date = current_date))::integer as submitted_today,
      (count(*) filter (where status in ('claimed','buffer_active','handed_pending','la_active')))::integer as claimed,
      (count(*) filter (where status not in ('completed','dropped')))::integer as still_open,
      min(queued_at) filter (where status in ('unclaimed','claimed','buffer_active','handed_pending','la_active')) as oldest_open_at
    from filtered
  ), page_size as (select count(*)::integer as n from page_keys)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_array(lead_id, id, customer, submitted_at, updated_at, product_line,
      coalesce(stage_id::text, stage_key), coalesce(stage_key,'New'), 'open', disposition, disposition, null,
      submitted_by_id, submitted_by_name, status,
      (sla_partner_notified_at is not null and status in ('unclaimed','expired'))) order by queued_at desc, id desc) from page), '[]'::jsonb),
    'stages', coalesce((select jsonb_agg(jsonb_build_array(stage_id,pipeline_id,'Default pipeline',stage_name,0,'open','#64748b',false,lead_count)) from stage_rows), '[]'::jsonb),
    'closers', coalesce((select jsonb_agg(jsonb_build_array(c.submitted_by_id, coalesce(u.name, 'Partner closer'))) from (select distinct submitted_by_id from filtered where submitted_by_id is not null) c left join public.users u on u.id=c.submitted_by_id), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(product_line) from (select distinct product_line from filtered) p), '[]'::jsonb),
    'outcomes', coalesce((select jsonb_agg(jsonb_build_array(disposition, disposition)) from (select distinct disposition from filtered where disposition is not null) o), '[]'::jsonb),
    'total', totals.total,
    'next_offset', case when greatest(coalesce(p_offset,0),0)+page_size.n<totals.total then greatest(coalesce(p_offset,0),0)+page_size.n else null end,
    'counters', jsonb_build_object(
      'submittedToday', totals.submitted_today,
      'claimed', totals.claimed,
      'converted', 0,
      'stillOpen', totals.still_open
    ),
    'oldest_open_at', totals.oldest_open_at,
    'submitted_recent', coalesce((select jsonb_agg(jsonb_build_array(b.bucket, b.n) order by b.bucket) from (
      select floor(extract(epoch from submitted_at) / 900)::bigint as bucket, count(*)::integer as n
      from filtered where submitted_at >= now() - interval '26 hours' group by 1) b), '[]'::jsonb)
  ) from totals, page_size;
$function$;

revoke all on function public.partner_lead_pipeline_page(uuid, uuid, date, date, uuid, text, uuid, text, text, integer, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.partner_lead_pipeline_page(uuid, uuid, date, date, uuid, text, uuid, text, text, integer, integer) to service_role;

do $$
declare
  v_sig regprocedure := 'public.partner_lead_pipeline_page(uuid,uuid,date,date,uuid,text,uuid,text,text,integer,integer)'::regprocedure;
  v_body text;
  v_config text[];
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929140000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  v_body := replace(pg_get_functiondef(v_sig), E'\r\n', E'\n');
  select proconfig into v_config from pg_proc where oid = v_sig;
  if position('select q.*' in v_body) > 0 or position('q.*, l.values' in v_body) > 0 then
    raise exception '20260929140000: filtered still carries q.* or l.values';
  end if;
  if position('filtered as materialized' in v_body) = 0 or position('page_keys' in v_body) = 0 then
    raise exception '20260929140000: the lean filtered / page_keys shape is not live';
  end if;
  if position('submitted_recent' in v_body) = 0 or position('oldest_open_at' in v_body) = 0 then
    raise exception '20260929140000: the additive route fields are missing';
  end if;
  if not (v_config @> array['work_mem=16MB', 'jit=off', 'max_parallel_workers_per_gather=0']) then
    raise exception '20260929140000: function settings not applied: %', v_config;
  end if;
  if has_function_privilege('anon', v_sig, 'execute') or has_function_privilege('authenticated', v_sig, 'execute') then
    raise exception '20260929140000: the pipeline read model is callable by a public role';
  end if;
end
$$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260929140000', 'm1_partner_pipeline_lean_read_model') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [15/17] 20260929140100_m1_preflight_indexed_candidates.sql ────────────────────
begin;

-- M1 perf · LA-1.24-9, the existing-customer pre-flight at 20,000 contacts in a 135,500-lead tenant
-- (target under 500 ms).
--
-- Measured 2026-09-30: the RPC hit the 8 s statement timeout on every run. find_existing_customer_
-- preflight scored EVERY lead of the tenant (135,500 rows, each with regexp and trigram work plus two
-- lateral lookups into deal_flow and lead_queue) and tested every contact (20,000) with the same OR,
-- with no indexed candidate step first. 20260915130000 built the contact-side indexes, but the OR
-- over the CTE's keys could not use them.
--
-- Restated from the LIVE definition (read 2026-09-30, identical to 20260915130000's body). The one
-- change is two candidate CTEs that narrow the rows BEFORE the unchanged scoring:
--   lead_candidates      phone keys (GIN), DOB digits (btree), name trigram with similarity .6 (GIN)
--   contact_candidates   the contact OR split into one indexed arm per branch
-- Why the lead prefilter loses nothing: a lead reaches the .45 threshold only with a phone match
-- (.35), a DOB match (.25), or, with neither, a name similarity of at least .625, because address can
-- add at most .20. Address alone never qualifies. On the load-test lead that is 350 candidates
-- instead of 135,500 (1 phone, 40 DOB, 313 name).
-- The scorer, its weights, the .45 cut-off, the matched_on .45 rule and pg_trgm.similarity_threshold
-- 0.3 are untouched, and lead_values / contact_values keep their original WHERE clauses, so the
-- result is the same set, scored the same way.
--
-- Two IMMUTABLE helpers give the lead's phone keys and name key an index expression.
-- preflight_lead_name_key is the scorer's name key with concat_ws (STABLE, so not indexable)
-- written out as the same null-skipping join, and preflight_lead_phone_keys holds the scorer's direct
-- phone key plus every values.phones[] key. The check at the end compares both with the scorer's own
-- expressions on sample values. EXECUTE stays with PUBLIC: index maintenance runs them for whoever
-- inserts a lead.
--
-- The indexes are built inside the bundle's transaction (CONCURRENTLY cannot run there), so
-- agent_leads takes writes only after they finish, about 373,000 rows on 2026-09-30.

create or replace function public.preflight_lead_name_key(p_values jsonb)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select regexp_replace(lower(coalesce(
    p_values->>'full_name',
    p_values->>'name',
    btrim(coalesce((p_values->>'first_name') || ' ' || (p_values->>'last_name'), p_values->>'first_name', p_values->>'last_name', ''))
  )), '[^a-z0-9]', '', 'g')
$$;

create or replace function public.preflight_lead_phone_keys(p_values jsonb)
returns text[]
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select array_remove(
    array[regexp_replace(coalesce(p_values->>'phone', p_values->>'phone_number', p_values->>'primary_phone', ''), '[^0-9]', '', 'g')]
    || coalesce((
      select array_agg(regexp_replace(coalesce(e->>'phone', e->>'value', ''), '[^0-9]', '', 'g'))
      from jsonb_array_elements(case when jsonb_typeof(p_values->'phones') = 'array' then p_values->'phones' else '[]'::jsonb end) e
    ), '{}'::text[]),
    '')
$$;

create index if not exists agent_leads_preflight_phone_keys_idx
  on public.agent_leads using gin (public.preflight_lead_phone_keys(values));

create index if not exists agent_leads_preflight_dob_idx
  on public.agent_leads (tenant_id, (nullif(regexp_replace(coalesce(values->>'dob', values->>'date_of_birth', ''), '[^0-9]', '', 'g'), '')));

create index if not exists agent_leads_preflight_name_trgm_idx
  on public.agent_leads using gin (public.preflight_lead_name_key(values) gin_trgm_ops);

-- The contact address arm reaches contacts from a matching household.
create index if not exists contacts_preflight_household_idx
  on public.contacts (household_id)
  where household_id is not null and merged_into_id is null;

CREATE OR REPLACE FUNCTION public.find_existing_customer_preflight(p_tenant_id uuid, p_full_name text DEFAULT NULL::text, p_dob date DEFAULT NULL::date, p_phone_digits text DEFAULT NULL::text, p_address_search text DEFAULT NULL::text, p_exclude_lead_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(lead_id uuid, contact_id uuid, submitted_at timestamp with time zone, partner_id uuid, partner_name text, product_line text, outcome text, score numeric, matched_on text[], source_type text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
 SET "pg_trgm.similarity_threshold" TO '0.3'
AS $function$
with input as (
  select
    nullif(regexp_replace(lower(coalesce(p_full_name, '')), '[^a-z0-9]', '', 'g'), '') as name_key,
    nullif(regexp_replace(coalesce(p_phone_digits, ''), '[^0-9]', '', 'g'), '') as phone_key,
    nullif(regexp_replace(lower(coalesce(p_address_search, '')), '[^a-z0-9]', '', 'g'), '') as address_key
), lead_candidates as (
  -- Indexed prefilter, BEFORE the scoring below. A lead scores at least .45 only with a phone match
  -- (.35), a DOB match (.25), or, with neither, a name similarity of at least .625 (.40 x name plus at
  -- most .20 for address). So these three arms hold every lead the scorer can return. The name arm
  -- keeps .6, under .625, as a margin. The scorer and its thresholds are unchanged.
  select l.id from public.agent_leads l
  where l.tenant_id = p_tenant_id
    and nullif(regexp_replace(coalesce(p_phone_digits, ''), '[^0-9]', '', 'g'), '') is not null
    and public.preflight_lead_phone_keys(l.values) @> array[nullif(regexp_replace(coalesce(p_phone_digits, ''), '[^0-9]', '', 'g'), '')]
  union
  select l.id from public.agent_leads l
  where l.tenant_id = p_tenant_id and p_dob is not null
    and nullif(regexp_replace(coalesce(l.values->>'dob', l.values->>'date_of_birth', ''), '[^0-9]', '', 'g'), '') = replace(p_dob::text, '-', '')
  union
  select l.id from public.agent_leads l
  where l.tenant_id = p_tenant_id
    and public.preflight_lead_name_key(l.values) % nullif(regexp_replace(lower(coalesce(p_full_name, '')), '[^a-z0-9]', '', 'g'), '')
    and similarity(public.preflight_lead_name_key(l.values), nullif(regexp_replace(lower(coalesce(p_full_name, '')), '[^a-z0-9]', '', 'g'), '')) >= .6
), lead_values as (
  select
    l.id as lead_id,
    l.created_at as submitted_at,
    l.partner_id,
    l.product_line,
    regexp_replace(lower(coalesce(l.values->>'full_name', l.values->>'name', trim(concat_ws(' ', l.values->>'first_name', l.values->>'last_name')))), '[^a-z0-9]', '', 'g') as name_key,
    nullif(regexp_replace(coalesce(l.values->>'dob', l.values->>'date_of_birth', ''), '[^0-9]', '', 'g'), '') as dob_key,
    regexp_replace(coalesce(l.values->>'phone', l.values->>'phone_number', l.values->>'primary_phone', ''), '[^0-9]', '', 'g') as phone_key,
    regexp_replace(lower(concat_ws(' ', l.values->>'address_line1', l.values->>'address', l.values->>'city', l.values->>'state', l.values->>'state_code', l.values->>'postal_code', l.values->>'zip')), '[^a-z0-9]', '', 'g') as address_key,
    coalesce(nullif(btrim(df.call_result), ''), nullif(btrim(q.disposition), ''), nullif(btrim(l.values->>'outcome'), ''), nullif(btrim(l.values->>'disposition'), '')) as outcome,
    p.name as partner_name
  from public.agent_leads l
  cross join input i
  left join public.partners p on p.id = l.partner_id and p.tenant_id = l.tenant_id
  left join lateral (select d.call_result from public.deal_flow d where d.tenant_id = l.tenant_id and d.lead_id = l.id order by d.updated_at desc limit 1) df on true
  left join lateral (select q.disposition from public.lead_queue q where q.tenant_id = l.tenant_id and q.lead_id = l.id order by q.updated_at desc limit 1) q on true
  where l.tenant_id = p_tenant_id and l.id is distinct from p_exclude_lead_id
    and l.id in (select c.id from lead_candidates c)
    and (i.phone_key is not null or p_dob is not null or i.name_key is not null or i.address_key is not null)
), lead_scored as (
  select lv.*,
    ((case when i.phone_key is not null and (lv.phone_key = i.phone_key or exists (
      select 1 from jsonb_array_elements(case when jsonb_typeof(l.values->'phones') = 'array' then l.values->'phones' else '[]'::jsonb end) phone_item
      where regexp_replace(coalesce(phone_item->>'phone', phone_item->>'value', ''), '[^0-9]', '', 'g') = i.phone_key
    )) then .35 else 0 end)
    + (case when p_dob is not null and lv.dob_key = replace(p_dob::text, '-', '') then .25 else 0 end)
    + (case when i.address_key is not null and lv.address_key <> '' then greatest(similarity(lv.address_key, i.address_key), 0) * .20 else 0 end)
    + (case when i.name_key is not null and lv.name_key <> '' then greatest(similarity(lv.name_key, i.name_key), 0) * .40 else 0 end))::numeric as raw_score,
    array_remove(array[
      case when i.phone_key is not null and lv.phone_key = i.phone_key then 'phone' end,
      case when p_dob is not null and lv.dob_key = replace(p_dob::text, '-', '') then 'dob' end,
      case when i.address_key is not null and similarity(lv.address_key, i.address_key) >= .45 then 'address' end,
      case when i.name_key is not null and similarity(lv.name_key, i.name_key) >= .45 then 'name' end
    ], null)::text[] as matched_on
  from lead_values lv cross join input i
  join public.agent_leads l on l.id = lv.lead_id and l.tenant_id = p_tenant_id
), contact_candidates as (
  -- The same OR as contact_values below, one arm per index, so each arm is an index read instead of a
  -- test on every contact. contact_values still applies the whole OR, so the set is unchanged.
  select c.id as contact_id from public.contacts c
  where c.tenant_id = p_tenant_id and c.merged_into_id is null
    and regexp_replace(coalesce(c.primary_phone, ''), '[^0-9]', '', 'g') = nullif(regexp_replace(coalesce(p_phone_digits, ''), '[^0-9]', '', 'g'), '')
  union
  select cp.contact_id from public.contact_phones cp
  where cp.tenant_id = p_tenant_id
    and regexp_replace(cp.phone, '[^0-9]', '', 'g') = nullif(regexp_replace(coalesce(p_phone_digits, ''), '[^0-9]', '', 'g'), '')
  union
  select c.id from public.contacts c
  where c.tenant_id = p_tenant_id and c.merged_into_id is null and c.dob = p_dob
  union
  select c.id from public.contacts c
  where c.tenant_id = p_tenant_id and c.merged_into_id is null
    and c.name_search % nullif(regexp_replace(lower(coalesce(p_full_name, '')), '[^a-z0-9]', '', 'g'), '')
  union
  select c.id from public.households h
  join public.contacts c on c.household_id = h.id and c.tenant_id = p_tenant_id and c.merged_into_id is null
  where h.tenant_id = p_tenant_id
    and regexp_replace(lower(coalesce(h.address_search, '')), '[^a-z0-9]', '', 'g') % nullif(regexp_replace(lower(coalesce(p_address_search, '')), '[^a-z0-9]', '', 'g'), '')
), contact_values as (
  select c.id as contact_id, c.created_at as submitted_at, c.first_name, c.last_name, c.dob, c.primary_phone, c.name_search, h.address_search, h.address_hash, c.household_id
  from public.contacts c
  left join public.households h on h.id = c.household_id and h.tenant_id = p_tenant_id
  cross join input i
  where c.tenant_id = p_tenant_id and c.merged_into_id is null
    and c.id in (select cc.contact_id from contact_candidates cc)
    and (i.phone_key is not null or p_dob is not null or i.name_key is not null or i.address_key is not null)
    and (
      (i.phone_key is not null and (
        regexp_replace(coalesce(c.primary_phone, ''), '[^0-9]', '', 'g') = i.phone_key
        or exists (
          select 1 from public.contact_phones cp
          where cp.tenant_id = p_tenant_id and cp.contact_id = c.id
            and regexp_replace(cp.phone, '[^0-9]', '', 'g') = i.phone_key
        )
      ))
      or (p_dob is not null and c.dob = p_dob)
      or (i.name_key is not null and c.name_search % i.name_key)
      or (i.address_key is not null and regexp_replace(lower(coalesce(h.address_search, '')), '[^a-z0-9]', '', 'g') % i.address_key)
    )
), contact_scored as (
  select cv.*,
    ((case when i.phone_key is not null and (regexp_replace(coalesce(cv.primary_phone, ''), '[^0-9]', '', 'g') = i.phone_key or exists (
      select 1 from public.contact_phones cp where cp.tenant_id = p_tenant_id and cp.contact_id = cv.contact_id and regexp_replace(cp.phone, '[^0-9]', '', 'g') = i.phone_key
    )) then .35 else 0 end)
    + (case when p_dob is not null and cv.dob = p_dob then .25 else 0 end)
    + (case when i.address_key is not null and cv.address_search is not null then greatest(similarity(regexp_replace(lower(cv.address_search), '[^a-z0-9]', '', 'g'), i.address_key), 0) * .20 else 0 end)
    + (case when i.name_key is not null then greatest(similarity(cv.name_search, i.name_key), 0) * .40 else 0 end))::numeric as raw_score,
    array_remove(array[
      case when i.phone_key is not null and (regexp_replace(coalesce(cv.primary_phone, ''), '[^0-9]', '', 'g') = i.phone_key or exists (select 1 from public.contact_phones cp where cp.tenant_id = p_tenant_id and cp.contact_id = cv.contact_id and regexp_replace(cp.phone, '[^0-9]', '', 'g') = i.phone_key)) then 'phone' end,
      case when p_dob is not null and cv.dob = p_dob then 'dob' end,
      case when i.address_key is not null and cv.address_search is not null and similarity(regexp_replace(lower(cv.address_search), '[^a-z0-9]', '', 'g'), i.address_key) >= .45 then 'address' end,
      case when i.name_key is not null and similarity(cv.name_search, i.name_key) >= .45 then 'name' end
    ], null)::text[] as matched_on
  from contact_values cv cross join input i
)
select s.lead_id, null::uuid, s.submitted_at, s.partner_id, s.partner_name, s.product_line, s.outcome,
       round(s.raw_score, 4), s.matched_on, 'lead'
from lead_scored s cross join input i
where s.raw_score >= .45
union all
select null::uuid, s.contact_id, s.submitted_at, null::uuid, null::text, null::text, 'contact_on_file',
       round(s.raw_score, 4), s.matched_on, 'contact'
from contact_scored s cross join input i
where s.raw_score >= .45
order by 8 desc, 3 desc
limit least(greatest(coalesce(p_limit, 20), 1), 50);
$function$;

revoke all on function public.find_existing_customer_preflight(uuid, text, date, text, text, uuid, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.find_existing_customer_preflight(uuid, text, date, text, text, uuid, integer) to service_role;

do $$
declare
  v_sig regprocedure := 'public.find_existing_customer_preflight(uuid,text,date,text,text,uuid,integer)'::regprocedure;
  v_body text;
  v_config text[];
  v_bad integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929140100: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  -- The helpers agree with the scorer's own expressions.
  select count(*) into v_bad
  from (values
    ('{}'::jsonb), ('{"full_name":"Ann Lee"}'), ('{"name":"Bo"}'), ('{"first_name":"Ann"}'), ('{"last_name":"Lee"}'),
    ('{"first_name":" Ann ","last_name":"O''Lee"}'), ('{"full_name":"","first_name":"A"}'), ('{"first_name":null,"last_name":"Z"}'),
    ('{"phone":"(214) 555-5777"}'), ('{"phone_number":"1-800"}'), ('{"primary_phone":"x9"}'), ('{"phone":"","phone_number":"5"}'),
    ('{"phones":[{"phone":"214-555-0000"},{"value":"999"},"str",5,null,{"other":1}]}'), ('{"phones":"not an array"}'), ('[]')
  ) s(v)
  where public.preflight_lead_name_key(v) is distinct from
          regexp_replace(lower(coalesce(v->>'full_name', v->>'name', trim(concat_ws(' ', v->>'first_name', v->>'last_name')))), '[^a-z0-9]', '', 'g')
     or (regexp_replace(coalesce(v->>'phone', v->>'phone_number', v->>'primary_phone', ''), '[^0-9]', '', 'g') <> ''
         and not public.preflight_lead_phone_keys(v) @> array[regexp_replace(coalesce(v->>'phone', v->>'phone_number', v->>'primary_phone', ''), '[^0-9]', '', 'g')])
     or exists (
          select 1 from jsonb_array_elements(case when jsonb_typeof(v->'phones') = 'array' then v->'phones' else '[]'::jsonb end) e
          where regexp_replace(coalesce(e->>'phone', e->>'value', ''), '[^0-9]', '', 'g') <> ''
            and not public.preflight_lead_phone_keys(v) @> array[regexp_replace(coalesce(e->>'phone', e->>'value', ''), '[^0-9]', '', 'g')]);
  if v_bad > 0 then
    raise exception '20260929140100: the preflight helpers disagree with the scorer on % sample value(s)', v_bad;
  end if;

  if to_regclass('public.agent_leads_preflight_phone_keys_idx') is null
     or to_regclass('public.agent_leads_preflight_dob_idx') is null
     or to_regclass('public.agent_leads_preflight_name_trgm_idx') is null
     or to_regclass('public.contacts_preflight_household_idx') is null then
    raise exception '20260929140100: a preflight candidate index is missing';
  end if;

  v_body := replace(pg_get_functiondef(v_sig), E'\r\n', E'\n');
  select proconfig into v_config from pg_proc where oid = v_sig;
  if position('lead_candidates' in v_body) = 0 or position('contact_candidates' in v_body) = 0 then
    raise exception '20260929140100: the candidate prefilter is not live';
  end if;
  if position('raw_score >= .45' in v_body) = 0 or position('>= .45 then ''name''' in v_body) = 0 then
    raise exception '20260929140100: the scorer thresholds changed';
  end if;
  if not (v_config @> array['pg_trgm.similarity_threshold=0.3']) then
    raise exception '20260929140100: the trigram threshold is not 0.3: %', v_config;
  end if;
  if has_function_privilege('anon', v_sig, 'execute') or has_function_privilege('authenticated', v_sig, 'execute') or has_function_privilege('tenant_app', v_sig, 'execute') then
    raise exception '20260929140100: the pre-flight is callable outside the service role';
  end if;
end
$$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260929140100', 'm1_preflight_indexed_candidates') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [16/17] 20260929140200_m1_deal_flow_export_pages.sql ──────────────────────────
begin;

-- M1 perf · LA-1.13-10, the deal flow CSV at 10,000 rows.
--
-- Measured 2026-09-30: GET /api/app/deal-flow?format=csv answered 400 every time. The route asked
-- list_deal_flow_report for one 10,000-row page, and that call hit the 8 s statement timeout on 6 of
-- 6 runs. An EXPLAIN of the same body (read-only, load-test tenant, 9,012 rows in 30 days) ran 72 s:
-- a per-row history lateral into tenant_lead_activity (10 s), one jsonb_agg over 9,012 whole-row
-- payloads (35 s) and the KPIs, partner summary, filter options and window count the CSV never
-- prints. The grid's own 100-row page is fine (1.4 s) and is not changed here.
--
-- list_deal_flow_export is the CSV's own read. Its settings, term, base and filtered CTEs are the
-- LIVE list_deal_flow_report's (read 2026-09-30), so the export filters exactly as the grid does.
-- Around them:
--   keys       the next p_limit deals after a cursor (local_date, created_at, id), in the grid's
--              order (local_date desc, created_at desc, id desc), from deal_flow alone. Only the
--              deal's own columns filter here, so the window never skips a row the grid shows.
--   filtered   restricted to that window, then the grid's full filter (stage type, search) applies.
--   rows       the grid's row payload plus the names and issued date the CSV prints. No history,
--              KPIs, summary or options.
--   more/next  a full window means there may be more. The caller asks again from next.
-- Each call handles at most p_limit (default 1,000, cap 5,000) deals, so the export is a series of
-- bounded reads instead of one that grows with the report. lib/dealFlow/service.ts streams the CSV
-- page by page and, before this file, pages list_deal_flow_report instead.
--
-- deal_flow_tenant_order_idx serves the keys window as one backward index range.

create index if not exists deal_flow_tenant_order_idx
  on public.deal_flow (tenant_id, local_date, created_at, id);

create or replace function public.list_deal_flow_export(
  p_tenant_id uuid,
  p_from_date date default null,
  p_to_date date default null,
  p_partner_id uuid default null,
  p_product_line text default null,
  p_agent_id uuid default null,
  p_status text default null,
  p_search text default null,
  p_stage_type text default null,
  p_after_local_date date default null,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 1000
)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
set jit to 'off'
as $function$
with settings as (
  select
    least(5000, greatest(1, coalesce(p_limit, 1000))) as page_size,
    left(nullif(btrim(coalesce(p_search, '')), ''), 120) as search_term
),
term as (
  select
    s.page_size,
    s.search_term,
    case when s.search_term is null then null
         else '%' || replace(replace(replace(s.search_term, '\', '\\'), '%', '\%'), '_', '\_') || '%' end as search_like,
    regexp_replace(coalesce(s.search_term, ''), '[^0-9]', '', 'g') as search_digits
  from settings s
),
-- The export window: the next page_size deals after the cursor, in the grid's order, read from
-- deal_flow alone. Only the deal's own columns filter here, so the window never skips a row the
-- report would show. The joined filters (stage type, search) still apply in filtered below.
keys as (
  select d.id, d.local_date, d.created_at
  from public.deal_flow d
  where d.tenant_id = p_tenant_id
    and (p_from_date is null or d.local_date >= p_from_date)
    and (p_to_date is null or d.local_date <= p_to_date)
    and (p_partner_id is null or d.partner_id = p_partner_id)
    and (p_product_line is null or d.product_line = p_product_line)
    and (p_agent_id is null or d.worked_by = p_agent_id)
    and (p_status is null or d.status = p_status)
    and (d.local_date, d.created_at, d.id) < (
      coalesce(p_after_local_date, 'infinity'::date),
      coalesce(p_after_created_at, 'infinity'::timestamptz),
      coalesce(p_after_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)
    )
  order by d.local_date desc, d.created_at desc, d.id desc
  limit least(5000, greatest(1, coalesce(p_limit, 1000)))
),
-- Inlined into each reference, so the filters below push down into it.
base as not materialized (
  select
    d.id, d.lead_id, d.partner_id, d.submission_id, d.product_line, d.insured_name, d.phone,
    d.initial_quote, d.tracking_id, d.local_date, d.status, d.call_result, d.notes,
    d.carrier, d.product_type, d.monthly_premium_cents, d.face_amount_cents, d.draft_date,
    d.worked_by, d.buffer_agent, d.manual_entry, d.created_at, d.updated_at,
    d.campaign_id, d.vendor_id, d.source, d.disposition_at, d.disposition_by,
    p.name as partner_name,
    c.name as campaign_name,
    case when d.source = 'inbound' and p.name is not null then p.name
         else coalesce(v.name, cv.name, p.name) end as vendor_name,
    dl.label as call_result_label,
    coalesce(ls.id, ds.id) as stage_id,
    coalesce(ls.name, ds.name) as stage_name,
    coalesce(ls.stage_type, ds.stage_type) as stage_type,
    (l.stage_id is not null and l.stage_id is distinct from d.stage_id) as stage_drift,
    left(coalesce(
      nullif(btrim(l.values->>'state'), ''),
      nullif(btrim(l.values->>'state_code'), ''),
      nullif(btrim(l.values->>'primary_state'), '')
    ), 40) as customer_state
  from public.deal_flow d
  left join public.agent_leads l on l.id = d.lead_id and l.tenant_id = d.tenant_id
  left join public.tenant_pipeline_stages ls on ls.id = l.stage_id
  left join public.tenant_pipeline_stages ds on ds.id = d.stage_id
  left join public.partners p on p.id = d.partner_id and p.tenant_id = d.tenant_id
  left join public.tenant_campaigns c on c.id = d.campaign_id and c.tenant_id = d.tenant_id
  left join public.tenant_lead_vendors v on v.id = d.vendor_id and v.tenant_id = d.tenant_id
  left join public.tenant_lead_vendors cv on cv.id = c.vendor_id and cv.tenant_id = d.tenant_id
  left join public.dispositions dl on dl.tenant_id = d.tenant_id and dl.disposition_key = d.call_result
  where d.tenant_id = p_tenant_id
),
filtered as (
  select b.*
  from base b
  cross join term s
  where b.id = any(array(select k.id from keys k))
    and (p_from_date is null or b.local_date >= p_from_date)
    and (p_to_date is null or b.local_date <= p_to_date)
    and (p_partner_id is null or b.partner_id = p_partner_id)
    and (p_product_line is null or b.product_line = p_product_line)
    and (p_agent_id is null or b.worked_by = p_agent_id)
    and (p_status is null or b.status = p_status)
    -- A row with no resolvable stage counts as in progress, here and in the KPIs.
    and (p_stage_type is null or coalesce(b.stage_type, 'open') = p_stage_type)
    and (
      s.search_like is null
      or b.insured_name ilike s.search_like
      or b.phone ilike s.search_like
      or b.partner_name ilike s.search_like
      or b.product_line ilike s.search_like
      or b.carrier ilike s.search_like
      or b.call_result ilike s.search_like
      or b.call_result_label ilike s.search_like
      or b.campaign_name ilike s.search_like
      or b.vendor_name ilike s.search_like
      or b.stage_name ilike s.search_like
      or b.customer_state ilike s.search_like
      -- The copyable short ID is the first characters of the lead id.
      or left(b.lead_id::text, length(s.search_term)) = lower(s.search_term)
      or (length(s.search_digits) >= 3 and regexp_replace(coalesce(b.phone, ''), '[^0-9]', '', 'g') like '%' || s.search_digits || '%')
    )
),
decorated as (
  select
    f.local_date, f.created_at, f.id,
    to_jsonb(f) || jsonb_build_object(
      'worked_by_name', wu.name,
      'buffer_agent_name', bu.name,
      'disposition_by_name', du.name,
      'issued_at', ip.issued_at
    ) as payload
  from filtered f
  left join public.users wu on wu.id = f.worked_by
  left join public.users bu on bu.id = f.buffer_agent
  left join public.users du on du.id = f.disposition_by
  left join lateral (
    select max(t.issued_at) as issued_at
    from public.tenant_issued_policies t
    where t.tenant_id = p_tenant_id and t.lead_id = f.lead_id and t.status = 'issued'
  ) ip on true
)
select jsonb_build_object(
  'version', 1,
  'page_size', (select page_size from settings),
  'rows', coalesce((select jsonb_agg(d.payload order by d.local_date desc, d.created_at desc, d.id desc) from decorated d), '[]'::jsonb),
  -- A full window means there may be more: the caller asks again from its last key.
  'more', (select count(*) from keys) >= (select page_size from settings),
  'next', (
    select jsonb_build_object('local_date', k.local_date, 'created_at', k.created_at, 'id', k.id)
    from keys k
    order by k.local_date, k.created_at, k.id
    limit 1
  )
);
$function$;

revoke all on function public.list_deal_flow_export(uuid, date, date, uuid, text, uuid, text, text, text, date, timestamptz, uuid, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.list_deal_flow_export(uuid, date, date, uuid, text, uuid, text, text, text, date, timestamptz, uuid, integer) to service_role;

do $$
declare
  v_sig regprocedure;
  v_body text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929140200: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  v_sig := to_regprocedure('public.list_deal_flow_export(uuid,date,date,uuid,text,uuid,text,text,text,date,timestamp with time zone,uuid,integer)');
  if v_sig is null then
    raise exception '20260929140200: list_deal_flow_export was not created';
  end if;
  if to_regclass('public.deal_flow_tenant_order_idx') is null then
    raise exception '20260929140200: the deal flow order index was not created';
  end if;
  v_body := replace(pg_get_functiondef(v_sig), E'\r\n', E'\n');
  if position('tenant_lead_activity' in v_body) > 0 or position('row_number()' in v_body) > 0 then
    raise exception '20260929140200: the export still builds history or ranks the whole report';
  end if;
  if position('any(array(select k.id from keys k))' in v_body) = 0 then
    raise exception '20260929140200: the export is not bounded by its keys window';
  end if;
  if has_function_privilege('anon', v_sig, 'execute') or has_function_privilege('authenticated', v_sig, 'execute') or has_function_privilege('tenant_app', v_sig, 'execute') then
    raise exception '20260929140200: the export is callable outside the service role';
  end if;
end
$$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260929140200', 'm1_deal_flow_export_pages') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [17/17] 20260929140300_m1_transfer_inbox_status_seek.sql ──────────────────────
begin;

-- M1 perf · LA-1.10-10, the transfer inbox with 500 waiting (target under 1 s).
--
-- APPLY AFTER 20260925709850 (inbound transfer foundations). list_transfer_inbox below is restated
-- from 709850's version, which carries the LA-1.10-2 age column (lead_values_age). On 2026-09-30 the
-- live body was already identical to it, byte for byte after CRLF normalisation. Starting from 709850
-- keeps the age change whichever of the two files is applied last. This file refuses to run if
-- lead_values_age is missing.
--
-- Measured 2026-09-30: list_transfer_inbox_bundle took 2.0 to 2.4 s warm and 8.1 s cold, and 2 of 5
-- runs hit the statement timeout. The bundle calls list_transfer_inbox, a SQL function, which is
-- planned once for any p_status. Its status test is an OR over the parameter, so that plan cannot
-- seek the (tenant_id, status, queued_at) index and reads every inbound row the tenant ever had
-- (5,500 on the load-test tenant, all but the 500 waiting ones finished) before keeping the newest
-- 500. Generic-plan EXPLAIN, read-only: 5,468 buffers and 1,078 ms for zero waiting rows.
--
-- The one change: the same status test as one list the index can seek on, added beside the
-- original test (which stays, so the result is unchanged). 'all' is every status
-- lead_queue_status_check allows, and the check below fails if that constraint ever allows one the
-- list does not name. After: 20 buffers and 9 ms for the same call. The bundle is not changed.

do $$
begin
  if to_regprocedure('public.lead_values_age(jsonb,date)') is null then
    raise exception '20260929140300: apply 20260925709850 (inbound transfer foundations) first'
      using hint = 'list_transfer_inbox below reads lead_values_age for the LA-1.10-2 age column';
  end if;
end
$$;

create or replace function public.list_transfer_inbox(p_tenant_id uuid, p_status text default 'unclaimed'::text, p_partner_id uuid default null::uuid, p_product_line text default null::text, p_state text default null::text, p_screening_outcome text default null::text, p_claimed_by uuid default null::uuid)
returns table(id uuid, lead_id uuid, partner_id uuid, partner_name text, product_line text, status text, owner_user_id uuid, owner_name text, claimed_at timestamp with time zone, queued_at timestamp with time zone, wait_seconds integer, customer text, age text, state text, screening_outcome text, screening_warning text, duplicate_warning boolean, preflight_status text, preflight_result jsonb)
language sql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select newest.* from (
    select q.id as id, q.lead_id as lead_id, q.partner_id as partner_id, coalesce(p.name, 'Unassigned partner') as partner_name, q.product_line as product_line,
      q.status as status, coalesce(q.owner_user_id, q.claimed_by) as owner_user_id, u.name as owner_name, q.claimed_at as claimed_at, q.queued_at as queued_at,
      greatest(0, floor(extract(epoch from (now() - q.queued_at)))::integer) as wait_seconds,
      coalesce(nullif(btrim(l.values->>'full_name'), ''), nullif(btrim(l.values->>'name'), ''),
        nullif(btrim(concat_ws(' ', l.values->>'first_name', l.values->>'last_name')), ''), 'Unnamed customer') as customer,
      -- LA-1.10-2: the recorded age, else worked out from the date of birth.
      coalesce(public.lead_values_age(l.values), '—') as age,
      coalesce(nullif(btrim(l.values->>'state'), ''), nullif(btrim(l.values->>'state_code'), ''), nullif(btrim(l.values->>'primary_state'), ''), nullif(btrim(l.carrier_state), ''), '—') as state,
      coalesce(nullif(btrim(q.screening_outcome), ''), nullif(btrim(l.screening_outcome), ''), 'not_checked') as screening_outcome,
      coalesce(q.screening_warning, l.screening_warning) as screening_warning,
      coalesce((l.values->>'duplicate_warning')::boolean, false) as duplicate_warning, l.preflight_status as preflight_status, l.preflight_result as preflight_result
    from public.lead_queue q
    join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
    left join public.partners p on p.id = q.partner_id and p.tenant_id = q.tenant_id
    left join public.users u on u.id = coalesce(q.owner_user_id, q.claimed_by)
    where q.tenant_id = p_tenant_id
      -- Inbound transfers only: a dialer lead is served by the dialer, not claimed from the inbox.
      and q.partner_id is not null
      and (p_status = 'all'
        -- Everything still being worked: waiting, or with an agent. Terminal history is not.
        or (p_status = 'open' and q.status in ('unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active'))
        -- "Claimed" in the inbox means with an agent, at whichever stage: a buffer assistant, a
        -- handoff in flight, or the licensed agent. Only the first of those is status 'claimed'.
        or (p_status = 'claimed' and q.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active'))
        or q.status = p_status)
      -- The same statuses as the test above, as one list the (tenant_id, status, queued_at) index can
      -- seek on. The test above cannot: a SQL function is planned once for any p_status, so an OR
      -- over the parameter reads every inbound row the tenant ever had. 'all' is every status
      -- lead_queue_status_check allows, and the check at the end of this file keeps it that way.
      and q.status = any (case p_status
        when 'all' then array['unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active', 'completed', 'closed', 'dropped', 'expired']
        when 'open' then array['unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active']
        when 'claimed' then array['claimed', 'buffer_active', 'handed_pending', 'la_active']
        else array[p_status] end)
      and (p_partner_id is null or q.partner_id = p_partner_id)
      and (p_product_line is null or q.product_line = p_product_line)
      and (p_claimed_by is null or coalesce(q.owner_user_id, q.claimed_by) = p_claimed_by)
      and (p_state is null or coalesce(nullif(btrim(l.values->>'state'), ''), nullif(btrim(l.values->>'state_code'), ''), nullif(btrim(l.values->>'primary_state'), ''), nullif(btrim(l.carrier_state), '')) = p_state)
      and (p_screening_outcome is null or coalesce(q.screening_outcome, l.screening_outcome, 'not_checked') = p_screening_outcome)
    -- The newest 500, so a transfer that just arrived is never the one cut. The bundle's
    -- `truncated` flag reads this same 500.
    order by q.queued_at desc limit 500
  ) newest
  order by newest.queued_at asc
$function$;

revoke all on function public.list_transfer_inbox(uuid, text, uuid, text, text, text, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.list_transfer_inbox(uuid, text, uuid, text, text, text, uuid) to service_role;

do $$
declare
  v_sig regprocedure := 'public.list_transfer_inbox(uuid,text,uuid,text,text,text,uuid)'::regprocedure;
  v_body text;
  v_check text;
  v_allowed text[];
  v_listed constant text[] := array['unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active', 'completed', 'closed', 'dropped', 'expired'];
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929140300: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  v_body := replace(pg_get_functiondef(v_sig), E'\r\n', E'\n');
  if position('lead_values_age(l.values)' in v_body) = 0 then
    raise exception '20260929140300: the LA-1.10-2 age column is missing from list_transfer_inbox';
  end if;
  if position('and q.status = any (case p_status' in v_body) = 0 then
    raise exception '20260929140300: the index-usable status list is not live';
  end if;
  -- Every status the table allows must be in the 'all' list, or 'all' would hide rows.
  select pg_get_constraintdef(oid) into v_check
  from pg_constraint
  where conrelid = 'public.lead_queue'::regclass and conname = 'lead_queue_status_check';
  if v_check is null then
    raise exception '20260929140300: lead_queue_status_check is gone, so the ''all'' list cannot be checked';
  end if;
  select array_agg(m[1]) into v_allowed from regexp_matches(v_check, '''([a-z_]+)''', 'g') m;
  if not (v_listed @> v_allowed) then
    raise exception '20260929140300: lead_queue allows statuses the inbox ''all'' list lacks: %', array(select unnest(v_allowed) except select unnest(v_listed));
  end if;
  if has_function_privilege('anon', v_sig, 'execute') or has_function_privilege('authenticated', v_sig, 'execute') then
    raise exception '20260929140300: list_transfer_inbox is callable by a public role';
  end if;
end
$$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260929140300', 'm1_transfer_inbox_status_seek') on conflict do nothing;
  end if;
end $bundle$;
commit;
