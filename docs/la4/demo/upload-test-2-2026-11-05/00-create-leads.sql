-- Upload test 2, 2026-11-05 · Ellery & Fields (test agency, tenant d6f3950f) · paste once in the Supabase SQL editor.
--
-- Owner: "another one like the Riley upload test, and whenever we upload policies, do the same for commissions:
-- all of the statuses for policies and all of the statuses for commissions."
--
-- Eight leads, because one card cannot show them all: Declined, Withdrawn, Not taken and a chargeback each end a
-- card, and an ended card is not moved again. Sam walks the whole life of a policy; the other seven each take one
-- of the dead ends. Each gets an American Amicable application submitted under its own policy number (through
-- record_application_submission, the function the Submit button calls), and its card on Sales pipeline › Submitted.
-- No SSN is written: each submission carries a note that it was made for this test.
--
-- Then upload the files in this folder, day by day (README.md says what each one should do).
-- Safe to run again: a lead whose policy is already submitted is skipped.

begin;

do $$
declare
  v_tenant constant uuid := 'd6f3950f-0d88-4e66-869f-0de2ea6b396b';
  v_owner constant uuid := '1a01e923-c071-422d-96dd-08ff23e23075';   -- demo.agent@insurvas.test, the owner
  v_amam constant uuid := '5bd2ff41-fd83-485e-9373-9ada7a0aa3c7';    -- American Amicable
  v_sales uuid;
  v_submitted uuid;
  v_qualified uuid;
  v_form record;
  v_lead uuid;
  v_item uuid;
  v_case uuid;
  v_app uuid;
  v_made integer := 0;
  r record;
begin
  select id into v_sales from public.tenant_pipelines where tenant_id = v_tenant and partner_type is null and is_default;
  select id into v_submitted from public.tenant_pipeline_stages where pipeline_id = v_sales and not is_archived and name = 'Submitted';
  select id into v_qualified from public.tenant_pipeline_stages where pipeline_id = v_sales and not is_archived and name = 'Qualified';
  if v_submitted is null then raise exception 'Upload test 2: the Sales pipeline has no Submitted stage'; end if;
  select template_id, template_version, tenant_template_id, definition_version into v_form
    from public.agent_leads where tenant_id = v_tenant and tenant_template_id is not null order by created_at desc limit 1;
  if v_form.template_id is null then raise exception 'Upload test 2: no lead form found on this agency'; end if;

  for r in
    select * from (values
      ('0119990301', 'Sam',  'Fulltest',    '1961-03-01', '8135550301', 'female'),
      ('0119990302', 'Bea',  'Declinetwo',  '1962-03-02', '8135550302', 'female'),
      ('0119990303', 'Cal',  'Withdrawtwo', '1963-03-03', '8135550303', 'male'),
      ('0119990304', 'Dee',  'Incomplete',  '1964-03-04', '8135550304', 'female'),
      ('0119990305', 'Eli',  'Nottaken',    '1965-03-05', '8135550305', 'male'),
      ('0119990306', 'Fern', 'Infnottaken', '1966-03-06', '8135550306', 'female'),
      ('0119990307', 'Gus',  'Chargeback',  '1967-03-07', '8135550307', 'male'),
      ('0119990308', 'Hana', 'Nopremium',   '1968-03-08', '8135550308', 'female')
    ) as t(policy, first_name, last_name, dob, phone, gender)
  loop
    continue when exists (select 1 from public.tenant_application_submissions where tenant_id = v_tenant and carrier_id = v_amam and carrier_reference = r.policy);

    insert into public.agent_leads (tenant_id, template_id, template_version, tenant_template_id, definition_version, stage_key, product_line,
                                    "values", created_by, pipeline_id, stage_id, preflight_status, preflight_result, lead_state)
    values (v_tenant, v_form.template_id, v_form.template_version, v_form.tenant_template_id, v_form.definition_version, 'new', 'term_life',
            jsonb_build_object('first_name', r.first_name, 'last_name', r.last_name, 'date_of_birth', r.dob, 'phone', r.phone,
                               'state', 'FL', 'zip', '33602', 'tobacco', false, 'language', 'English', 'coverage_amount', 50000),
            v_owner, v_sales, v_submitted, 'unchecked', '{}'::jsonb, 'fresh')
    returning id into v_lead;

    insert into public.lead_queue (tenant_id, lead_id, product_line, stage_key, pipeline_id, stage_id, status, claimed_by, owner_user_id, owner_role, claimed_at, tier)
    values (v_tenant, v_lead, 'term_life', 'new', v_sales, v_submitted, 'claimed', v_owner, v_owner, 'owner', now(), 100)
    returning id into v_item;

    insert into public.deal_flow (tenant_id, lead_id, product_line, stage_key, pipeline_id, stage_id, insured_name, phone, local_date, status, worked_by, source,
                                  carrier, product_type, monthly_premium_cents, face_amount_cents)
    values (v_tenant, v_lead, 'term_life', 'new', v_sales, v_submitted, r.first_name || ' ' || r.last_name, r.phone, current_date, 'partial', v_owner, 'outbound',
            'American Amicable', 'term_life', 6130, 5000000);

    insert into public.tenant_application_cases (tenant_id, lead_id, work_item_id, product_line, source, status, opened_by)
    values (v_tenant, v_lead, v_item, 'term_life', 'outbound', 'open', v_owner)
    returning id into v_case;

    insert into public.tenant_applications (tenant_id, case_id, lead_id, insured_role, attempt_no, carrier_id, product_code, status, created_by)
    values (v_tenant, v_case, v_lead, 'primary', 1, v_amam, 'term_life', 'ready', v_owner)
    returning id into v_app;

    perform public.record_application_submission(
      v_tenant, v_app, v_owner, r.policy, 'policy_no', r.policy, now(), 'carrier_portal_manual',
      jsonb_build_object('verdict', 'pass', 'items', '[]'::jsonb, 'note', 'Upload test 2, 2026-11-05: recorded by SQL, no SSN entered'),
      '{}'::jsonb, 'Upload test 2, 2026-11-05');

    insert into public.tenant_lead_stage_events (tenant_id, lead_id, from_pipeline_id, from_stage_id, to_pipeline_id, to_stage_id, disposition_key, source, actor_user_id)
    values (v_tenant, v_lead, v_sales, coalesce(v_qualified, v_submitted), v_sales, v_submitted, null, 'application_sync', null);
    v_made := v_made + 1;
  end loop;
  raise notice 'Upload test 2: % leads made, each on Sales pipeline › Submitted.', v_made;
end $$;

-- ─── check ─────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_n integer;
begin
  select count(*) into v_n from public.tenant_application_submissions s join public.tenant_applications a on a.id = s.application_id
   where s.tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b' and s.reference_kind = 'policy_no'
     and s.carrier_reference in ('0119990301', '0119990302', '0119990303', '0119990304', '0119990305', '0119990306', '0119990307', '0119990308');
  if v_n <> 8 then
    raise exception 'Upload test 2: expected 8 submitted applications, found %', v_n;
  end if;
end $$;

commit;
