-- Upload test, 2026-11-05 · Ellery & Fields (test agency, tenant d6f3950f) · paste once in the Supabase SQL editor.
--
-- Makes one lead, Riley Uploadtest, the way the app would after a sale: lead, work item (claimed by the owner),
-- deal, open case, and an American Amicable application submitted under policy number 0119990201 (through
-- record_application_submission, the function the Submit button calls). The card is put on
-- Sales pipeline › Submitted, as the application sync would. No SSN is written: the submission is recorded with
-- a note that it was made for this test.
--
-- Then upload the files in this folder in order (README.md says what each one should do).
--
-- Safe to run again: it stops without writing if policy 0119990201 is already submitted on this agency.
-- Remove: delete the lead from the Leads page, or ask Claude for the clean-up script.

begin;

do $$
declare
  v_tenant constant uuid := 'd6f3950f-0d88-4e66-869f-0de2ea6b396b';
  v_owner constant uuid := '1a01e923-c071-422d-96dd-08ff23e23075';   -- demo.agent@insurvas.test, the owner
  v_amam constant uuid := '5bd2ff41-fd83-485e-9373-9ada7a0aa3c7';    -- American Amicable
  v_policy constant text := '0119990201';
  v_sales uuid;
  v_submitted uuid;
  v_qualified uuid;
  v_form record;
  v_lead uuid;
  v_item uuid;
  v_case uuid;
  v_app uuid;
  v_result jsonb;
begin
  if exists (select 1 from public.tenant_application_submissions where tenant_id = v_tenant and carrier_id = v_amam and carrier_reference = v_policy) then
    raise notice 'Upload test: policy % is already submitted on Ellery & Fields; nothing written.', v_policy;
    return;
  end if;

  select id into v_sales from public.tenant_pipelines where tenant_id = v_tenant and partner_type is null and is_default;
  select id into v_submitted from public.tenant_pipeline_stages where pipeline_id = v_sales and not is_archived and name = 'Submitted';
  select id into v_qualified from public.tenant_pipeline_stages where pipeline_id = v_sales and not is_archived and name = 'Qualified';
  if v_submitted is null then raise exception 'Upload test: the Sales pipeline has no Submitted stage'; end if;

  -- The agency's current lead form, from its newest lead on one (so the lead shows on the Leads page).
  select template_id, template_version, tenant_template_id, definition_version into v_form
    from public.agent_leads where tenant_id = v_tenant and tenant_template_id is not null order by created_at desc limit 1;
  if v_form.template_id is null then raise exception 'Upload test: no lead form found on this agency'; end if;

  insert into public.agent_leads (tenant_id, template_id, template_version, tenant_template_id, definition_version, stage_key, product_line,
                                  "values", created_by, pipeline_id, stage_id, preflight_status, preflight_result, lead_state)
  values (v_tenant, v_form.template_id, v_form.template_version, v_form.tenant_template_id, v_form.definition_version, 'new', 'term_life',
          jsonb_build_object('first_name', 'Riley', 'last_name', 'Uploadtest', 'date_of_birth', '1964-02-14', 'age', 62, 'phone', '8135550201',
                             'state', 'FL', 'zip', '33602', 'tobacco', false, 'language', 'English', 'coverage_amount', 50000),
          v_owner, v_sales, v_submitted, 'unchecked', '{}'::jsonb, 'fresh')
  returning id into v_lead;

  insert into public.lead_queue (tenant_id, lead_id, product_line, stage_key, pipeline_id, stage_id, status, claimed_by, owner_user_id, owner_role, claimed_at, tier)
  values (v_tenant, v_lead, 'term_life', 'new', v_sales, v_submitted, 'claimed', v_owner, v_owner, 'owner', now(), 100)
  returning id into v_item;

  insert into public.deal_flow (tenant_id, lead_id, product_line, stage_key, pipeline_id, stage_id, insured_name, phone, local_date, status, worked_by, source,
                                carrier, product_type, monthly_premium_cents, face_amount_cents)
  values (v_tenant, v_lead, 'term_life', 'new', v_sales, v_submitted, 'Riley Uploadtest', '8135550201', current_date, 'partial', v_owner, 'outbound',
          'American Amicable', 'term_life', 6130, 5000000);

  insert into public.tenant_application_cases (tenant_id, lead_id, work_item_id, product_line, source, status, opened_by)
  values (v_tenant, v_lead, v_item, 'term_life', 'outbound', 'open', v_owner)
  returning id into v_case;

  insert into public.tenant_applications (tenant_id, case_id, lead_id, insured_role, attempt_no, carrier_id, product_code, status, created_by)
  values (v_tenant, v_case, v_lead, 'primary', 1, v_amam, 'term_life', 'ready', v_owner)
  returning id into v_app;

  -- Submitted under its policy number, as the Submit button records it.
  v_result := public.record_application_submission(
    v_tenant, v_app, v_owner, v_policy, 'policy_no', v_policy, now(), 'carrier_portal_manual',
    jsonb_build_object('verdict', 'pass', 'items', '[]'::jsonb, 'note', 'Upload test 2026-11-05: recorded by SQL, no SSN entered'),
    '{}'::jsonb, 'Upload test 2026-11-05');

  -- The card's history: Qualified → Submitted by the application sync.
  insert into public.tenant_lead_stage_events (tenant_id, lead_id, from_pipeline_id, from_stage_id, to_pipeline_id, to_stage_id, disposition_key, source, actor_user_id)
  values (v_tenant, v_lead, v_sales, coalesce(v_qualified, v_submitted), v_sales, v_submitted, null, 'application_sync', null);

  raise notice 'Upload test: lead % (Riley Uploadtest) on Sales pipeline › Submitted, application %, policy %.', v_lead, v_app, v_policy;
end $$;

-- ─── check ─────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_ok integer;
begin
  select count(*) into v_ok
    from public.tenant_application_submissions s
    join public.tenant_applications a on a.id = s.application_id
    join public.agent_leads l on l.id = a.lead_id
   where s.tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b' and s.carrier_reference = '0119990201' and s.reference_kind = 'policy_no';
  if v_ok <> 1 then
    raise exception 'Upload test: expected one submission for 0119990201 with its lead, found %', v_ok;
  end if;
end $$;

commit;
