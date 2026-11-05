-- Upload test, 2026-11-05 · Ellery & Fields (test agency) · paste once in the Supabase SQL editor, after 00-create-lead.sql.
--
-- Owner: "fill every step: interview, quote, beneficiaries, application, payment… I'll do the payment myself."
-- Fills Riley Uploadtest's application in every step except two, which you do in the app:
--   * the Social Security number: typed into the Application step, where the app encrypts it (SQL would store it
--     in plain text, and Claude does not enter SSNs, test ones included);
--   * the payment: you said you would do it yourself.
-- The interview (20 answers, complete) was already filled through the app on 2026-11-05: its answers are sealed by
-- the app's key, which SQL does not have.
--
-- What this does:
--   1. Reopens the application: 00-create-lead.sql recorded a test submission so the files could link at once. That
--      submission is removed (only the database owner can; the app never deletes one) and the application goes
--      back to draft. The card goes back to Sales pipeline › Qualified; your own Submit moves it to Submitted.
--   2. Quote: American Amicable, term life, level, $50,000 face, $61.30 a month, 10 years, selected.
--   3. Application fields: name, date of birth, gender, tobacco, birth state, height, weight, phone, address,
--      and the coverage from the quote. Every one is marked checked, as if you had reviewed it.
--   4. Beneficiary: Jordan Uploadtest, spouse, 100% primary.
-- Safe to run again: each part is skipped when it is already done.

begin;

do $$
declare
  v_tenant constant uuid := 'd6f3950f-0d88-4e66-869f-0de2ea6b396b';
  v_owner constant uuid := '1a01e923-c071-422d-96dd-08ff23e23075';
  v_amam constant uuid := '5bd2ff41-fd83-485e-9373-9ada7a0aa3c7';
  v_lead uuid;
  v_case uuid;
  v_app uuid;
  v_status text;
  v_quote uuid;
  v_sales uuid;
  v_qualified uuid;
  v_card uuid;
  v_removed integer := 0;
begin
  select l.id into v_lead from public.agent_leads l
   where l.tenant_id = v_tenant and l."values"->>'first_name' = 'Riley' and l."values"->>'last_name' = 'Uploadtest'
   order by l.created_at desc limit 1;
  if v_lead is null then raise exception 'Fill: Riley Uploadtest not found. Run 00-create-lead.sql first.'; end if;
  select a.id, a.case_id, a.status into v_app, v_case, v_status from public.tenant_applications a
   where a.tenant_id = v_tenant and a.lead_id = v_lead and a.insured_role = 'primary' order by a.attempt_no desc limit 1;
  if v_app is null then raise exception 'Fill: Riley has no application'; end if;

  -- 1. Reopen.
  if v_status = 'submitted' then
    delete from public.tenant_application_submissions where tenant_id = v_tenant and application_id = v_app;
    get diagnostics v_removed = row_count;
    update public.tenant_applications set status = 'draft', submitted_at = null, updated_at = now() where id = v_app;
  elsif v_status not in ('draft', 'ready') then
    raise exception 'Fill: the application is %; only a test submission is taken back', v_status;
  end if;
  select id into v_sales from public.tenant_pipelines where tenant_id = v_tenant and partner_type is null and is_default;
  select id into v_qualified from public.tenant_pipeline_stages where pipeline_id = v_sales and not is_archived and name = 'Qualified';
  select stage_id into v_card from public.agent_leads where id = v_lead;
  if v_qualified is not null and v_card is distinct from v_qualified then
    update public.agent_leads set pipeline_id = v_sales, stage_id = v_qualified where id = v_lead;
    update public.lead_queue set pipeline_id = v_sales, stage_id = v_qualified where tenant_id = v_tenant and lead_id = v_lead;
    update public.deal_flow set pipeline_id = v_sales, stage_id = v_qualified where tenant_id = v_tenant and lead_id = v_lead;
    insert into public.tenant_lead_stage_events (tenant_id, lead_id, from_pipeline_id, from_stage_id, to_pipeline_id, to_stage_id, disposition_key, source, actor_user_id)
    values (v_tenant, v_lead, v_sales, v_card, v_sales, v_qualified, null, 'application_sync', null);
  end if;

  -- 2. Quote, selected.
  select quote_id into v_quote from public.tenant_applications where id = v_app;
  if v_quote is null then
    insert into public.tenant_quotes (tenant_id, case_id, lead_id, insured_role, application_id, carrier_id, product_code, tier, face_amount_cents,
                                      monthly_premium_cents, annual_premium_cents, age_used, term_length, assumed_health_class, rating_inputs, riders, warnings, status, created_by)
    values (v_tenant, v_case, v_lead, 'primary', v_app, v_amam, 'term_life', 'level', 5000000, 6130, 73560, 62, 10, 'Standard',
            jsonb_build_object('dob', '1964-02-14', 'tier', 'level', 'state', 'FL', 'gender', 'female', 'tobacco', false, 'age_used', 62, 'age_basis', 'nearest',
                               'face_amount', 5000000, 'term_length', 10, 'health_class', 'Standard'),
            '[]'::jsonb, '[]'::jsonb, 'selected', v_owner)
    returning id into v_quote;
    update public.tenant_applications set quote_id = v_quote, carrier_id = v_amam, product_code = 'term_life', updated_at = now() where id = v_app;
  end if;

  -- 3. Application fields, each checked. The SSN is left for the app.
  insert into public.tenant_application_values (application_id, field_key, tenant_id, value, source, reviewed_at, reviewed_by, updated_at, updated_by)
  select v_app, f.key, v_tenant, f.value, f.source, now(), v_owner, now(), v_owner
    from (values
      ('insured.first_name', to_jsonb('Riley'::text), 'manual'), ('insured.last_name', to_jsonb('Uploadtest'::text), 'manual'),
      ('insured.dob', to_jsonb('1964-02-14'::text), 'manual'), ('insured.gender', to_jsonb('female'::text), 'manual'),
      ('insured.tobacco', to_jsonb('no'::text), 'manual'), ('insured.birth_state', to_jsonb('FL'::text), 'manual'),
      ('insured.height_in', to_jsonb(66), 'manual'), ('insured.weight_lb', to_jsonb(160), 'manual'),
      ('contact.phone', to_jsonb('8135550201'::text), 'manual'), ('addr.line1', to_jsonb('1 Upload Test Way'::text), 'manual'),
      ('addr.city', to_jsonb('Tampa'::text), 'manual'), ('addr.state', to_jsonb('FL'::text), 'manual'), ('addr.zip', to_jsonb('33602'::text), 'manual'),
      ('cov.face_amount', to_jsonb(5000000), 'quote'), ('cov.monthly_premium', to_jsonb(6130), 'quote'), ('cov.product_tier', to_jsonb('level'::text), 'quote')
    ) as f(key, value, source)
  on conflict (application_id, field_key) do update
     set value = excluded.value, source = excluded.source, reviewed_at = excluded.reviewed_at, reviewed_by = excluded.reviewed_by, updated_at = excluded.updated_at, updated_by = excluded.updated_by
   where public.tenant_application_values.value_ciphertext is null;

  -- 4. Beneficiary, 100% primary.
  if not exists (select 1 from public.tenant_application_beneficiaries where application_id = v_app) then
    insert into public.tenant_application_beneficiaries (application_id, tenant_id, tier, first_name, last_name, relationship, share_bp, sort_order, updated_by)
    values (v_app, v_tenant, 'primary', 'Jordan', 'Uploadtest', 'spouse', 10000, 0, v_owner);
  end if;

  raise notice 'Fill: Riley''s application % is % (test submission removed: %), quote %, card on Qualified. Next: SSN and payment in the app, then Submit.',
    v_app, (select status from public.tenant_applications where id = v_app), v_removed, v_quote;
end $$;

-- ─── check ─────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_app uuid;
  v_n integer;
begin
  select a.id into v_app from public.tenant_applications a join public.agent_leads l on l.id = a.lead_id
   where a.tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b' and l."values"->>'last_name' = 'Uploadtest' and l."values"->>'first_name' = 'Riley'
   order by a.attempt_no desc limit 1;
  if (select status from public.tenant_applications where id = v_app) not in ('draft', 'ready') then raise exception 'Fill: the application is not open'; end if;
  if (select quote_id from public.tenant_applications where id = v_app) is null then raise exception 'Fill: no quote selected'; end if;
  select count(*) into v_n from public.tenant_application_values where application_id = v_app and reviewed_at is not null;
  if v_n < 16 then raise exception 'Fill: only % checked fields', v_n; end if;
  if (select coalesce(sum(share_bp), 0) from public.tenant_application_beneficiaries where application_id = v_app and tier = 'primary') <> 10000 then
    raise exception 'Fill: primary beneficiaries do not add up to 100%%';
  end if;
end $$;

commit;
