-- ---------------------------------------------------------------------------
-- LA-3 audit fixes (Module 3 — underwriting, quoting, application workspace)
--
-- 1. Extension grants are bound to the sign-in that opened them (tenant_extension_grants.session_id).
--    authenticateExtension refuses a grant whose session has ended; endTenantSessions revokes them.
-- 2. Each insured's issued policy is its own row (tenant_issued_policies.application_id), written by
--    mark_application_policy_issued. A household shares one deal (deal_flow allows one per lead), so
--    the deal-level writer refused the spouse's policy as ISSUED_POLICY_ALREADY_ISSUED and it never
--    reached Module 4. The "already issued" check is now per application, and idempotent.
-- 3. Submission is one transaction (record_application_submission): the attempt is locked, the
--    submission written and the attempt moved to `submitted` together. One submission per attempt
--    is a unique key, and a retry gets the first submission back.
-- 4. Beneficiaries are replaced in one transaction (save_application_beneficiaries); a contingent
--    with no primary is refused at save.
-- 5. scrub_lead_ssn: once the application holds the SSN encrypted, the lead's plaintext copy is
--    masked to its last four ("***-**-1234").
--
-- Every new function is service_role only. Applied in the SQL editor as one script.
-- ---------------------------------------------------------------------------

-- ─── 1 · grants bound to their session ──────────────────────────────────────
alter table public.tenant_extension_grants
  add column if not exists session_id uuid references public.tenant_user_session(id) on delete set null;
create index if not exists tenant_extension_grants_session_idx
  on public.tenant_extension_grants (session_id) where session_id is not null and revoked_at is null;

-- ─── 2 · one issued policy per application ──────────────────────────────────
alter table public.tenant_issued_policies
  add column if not exists application_id uuid references public.tenant_applications(id) on delete set null;
create unique index if not exists tenant_issued_policies_application_key
  on public.tenant_issued_policies (application_id) where application_id is not null;

-- ─── 3 · one submission per attempt ─────────────────────────────────────────
create unique index if not exists tenant_application_submissions_application_key
  on public.tenant_application_submissions (application_id);

create or replace function public.record_application_submission(
  p_tenant_id uuid,
  p_application_id uuid,
  p_actor uuid,
  p_carrier_reference text,
  p_reference_kind text,
  p_policy_number text,
  p_submitted_at timestamptz,
  p_submitted_via text,
  p_qa_verdict jsonb,
  p_health_snapshot jsonb,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a record;
  v_id uuid;
begin
  select t.id, t.status, t.attempt_no, t.carrier_id into a
    from public.tenant_applications t
   where t.id = p_application_id and t.tenant_id = p_tenant_id
   for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;

  -- Already submitted (a double click, a retry, a second tab): the first submission comes back. One
  -- left half-done before this function existed (row written, attempt still `ready`) is finished.
  select s.id into v_id
    from public.tenant_application_submissions s
   where s.tenant_id = p_tenant_id and s.application_id = a.id;
  if v_id is not null then
    if a.status = 'ready' then
      perform public.application_transition(p_tenant_id, a.id, p_actor, 'submitted', null, null, null);
    end if;
    return jsonb_build_object('submission_id', v_id, 'replayed', true);
  end if;

  if a.status <> 'ready' then raise exception 'APPLICATION_NOT_READY'; end if;
  if a.carrier_id is null then raise exception 'APPLICATION_NOT_READY'; end if;
  -- A few minutes of clock skew on the agent's device, no more.
  if p_submitted_at is not null and p_submitted_at > now() + interval '5 minutes' then
    raise exception 'SUBMISSION_IN_FUTURE';
  end if;

  insert into public.tenant_application_submissions (
    tenant_id, application_id, attempt_no, carrier_id, carrier_reference, reference_kind, policy_number,
    submitted_at, submitted_via, qa_verdict, health_snapshot, notes, created_by)
  values (
    p_tenant_id, a.id, a.attempt_no, a.carrier_id, p_carrier_reference, p_reference_kind, p_policy_number,
    coalesce(p_submitted_at, now()), p_submitted_via, coalesce(p_qa_verdict, '{}'::jsonb), coalesce(p_health_snapshot, '{}'::jsonb), p_notes, p_actor)
  returning id into v_id;

  perform public.application_transition(p_tenant_id, a.id, p_actor, 'submitted', null, null, null);
  return jsonb_build_object('submission_id', v_id, 'replayed', false);
end;
$function$;

-- ─── 2 · the per-application issued-policy writer ───────────────────────────
create or replace function public.mark_application_policy_issued(
  p_tenant_id uuid,
  p_application_id uuid,
  p_carrier text,
  p_policy_number text,
  p_issued_on date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a record;
  v_deal uuid;
  v_product text;
  v_policy public.tenant_issued_policies%rowtype;
begin
  if p_carrier is null or char_length(btrim(p_carrier)) not between 1 and 160 then
    raise exception 'ISSUED_POLICY_CARRIER_REQUIRED';
  end if;
  if p_policy_number is null or char_length(btrim(p_policy_number)) not between 1 and 120 then
    raise exception 'ISSUED_POLICY_NUMBER_REQUIRED';
  end if;
  if p_issued_on is null or p_issued_on > current_date then
    raise exception 'ISSUED_POLICY_DATE_INVALID';
  end if;

  select t.id, t.case_id, t.lead_id, t.outcome into a
    from public.tenant_applications t
   where t.id = p_application_id and t.tenant_id = p_tenant_id
   for update;
  if not found then raise exception 'ISSUED_POLICY_APPLICATION_NOT_FOUND'; end if;
  if a.outcome is distinct from 'issued' then raise exception 'ISSUED_POLICY_APPLICATION_NOT_ISSUED'; end if;

  -- This application's policy, already recorded: the same number again is a retry.
  select * into v_policy from public.tenant_issued_policies p
   where p.tenant_id = p_tenant_id and p.application_id = a.id;
  if found then
    if v_policy.policy_number = btrim(p_policy_number) then return to_jsonb(v_policy); end if;
    raise exception 'ISSUED_POLICY_APPLICATION_HAS_POLICY';
  end if;

  -- The same sale recorded on its deal before policies carried their application: adopted, not doubled.
  select * into v_policy from public.tenant_issued_policies p
   where p.tenant_id = p_tenant_id and p.lead_id = a.lead_id and p.application_id is null
     and p.carrier = btrim(p_carrier) and p.policy_number = btrim(p_policy_number)
   for update;
  if found then
    update public.tenant_issued_policies
       set application_id = a.id, application_case_id = coalesce(application_case_id, a.case_id), updated_at = now()
     where id = v_policy.id
    returning * into v_policy;
    return to_jsonb(v_policy);
  end if;

  -- The household's deal (one per lead) is shared: both insureds' policies point at it.
  select d.id into v_deal from public.deal_flow d where d.tenant_id = p_tenant_id and d.lead_id = a.lead_id;
  select c.product_line into v_product from public.tenant_application_cases c where c.id = a.case_id and c.tenant_id = p_tenant_id;

  insert into public.tenant_issued_policies (tenant_id, lead_id, application_case_id, application_id, deal_id, product_line, carrier, policy_number, status, issued_at)
  values (p_tenant_id, a.lead_id, a.case_id, a.id, v_deal, v_product, btrim(p_carrier), btrim(p_policy_number), 'issued', p_issued_on::timestamptz)
  returning * into v_policy;
  return to_jsonb(v_policy);
end;
$function$;

-- ─── 4 · beneficiaries, replaced atomically ─────────────────────────────────
create or replace function public.save_application_beneficiaries(
  p_tenant_id uuid,
  p_application_id uuid,
  p_actor uuid,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a record;
  v_n integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'BENEFICIARY_ROWS_INVALID'; end if;
  select t.id, t.status into a
    from public.tenant_applications t
   where t.id = p_application_id and t.tenant_id = p_tenant_id
   for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND'; end if;
  if a.status = 'closed' then raise exception 'APPLICATION_CLOSED'; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r where r ->> 'tier' = 'contingent')
     and not exists (select 1 from jsonb_array_elements(p_rows) r where r ->> 'tier' = 'primary') then
    raise exception 'BENEFICIARY_CONTINGENT_WITHOUT_PRIMARY';
  end if;

  delete from public.tenant_application_beneficiaries b
   where b.tenant_id = p_tenant_id and b.application_id = a.id;
  insert into public.tenant_application_beneficiaries (
    id, application_id, tenant_id, tier, first_name, last_name, relationship, relationship_other, dob, share_bp, phone, sort_order, updated_by)
  select coalesce(nullif(x.r ->> 'id', '')::uuid, gen_random_uuid()), a.id, p_tenant_id, x.r ->> 'tier', x.r ->> 'first_name', x.r ->> 'last_name',
         x.r ->> 'relationship', x.r ->> 'relationship_other', nullif(x.r ->> 'dob', '')::date, (x.r ->> 'share_bp')::integer,
         nullif(x.r ->> 'phone', ''), coalesce((x.r ->> 'sort_order')::integer, (x.ord - 1)::integer), p_actor
    from jsonb_array_elements(p_rows) with ordinality as x(r, ord);
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

-- ─── 5 · the lead's SSN, masked once the application holds it ───────────────
create or replace function public.scrub_lead_ssn(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_application_id uuid
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_values jsonb;
  v_key text;
  v_digits text;
  v_n integer := 0;
begin
  -- Only when this lead's application really holds the number, encrypted.
  if not exists (
    select 1 from public.tenant_application_values v
      join public.tenant_applications t on t.id = v.application_id
     where v.tenant_id = p_tenant_id and t.tenant_id = p_tenant_id
       and v.application_id = p_application_id and t.lead_id = p_lead_id
       and v.field_key = 'insured.ssn' and v.value_ciphertext is not null) then
    return 0;
  end if;

  select l.values into v_values from public.agent_leads l
   where l.id = p_lead_id and l.tenant_id = p_tenant_id
   for update;
  if not found or v_values is null then return 0; end if;

  -- The keys a lead's SSN arrives under (lib/applications/prefill.ts LEAD_SSN_KEYS). A full number
  -- becomes its masked last four; a value already masked, or not a full number, is left alone.
  foreach v_key in array array['ssn', 'social_security_number', 'social_security'] loop
    if v_values ? v_key then
      v_digits := regexp_replace(coalesce(v_values ->> v_key, ''), '[^0-9]', '', 'g');
      if char_length(v_digits) = 9 then
        v_values := jsonb_set(v_values, array[v_key], to_jsonb('***-**-' || right(v_digits, 4)));
        v_n := v_n + 1;
      end if;
    end if;
  end loop;

  if v_n > 0 then
    update public.agent_leads set values = v_values where id = p_lead_id and tenant_id = p_tenant_id;
  end if;
  return v_n;
end;
$function$;

-- ─── privileges ─────────────────────────────────────────────────────────────
revoke all on function public.record_application_submission(uuid, uuid, uuid, text, text, text, timestamptz, text, jsonb, jsonb, text) from public, anon, authenticated, tenant_app;
revoke all on function public.mark_application_policy_issued(uuid, uuid, text, text, date) from public, anon, authenticated, tenant_app;
revoke all on function public.save_application_beneficiaries(uuid, uuid, uuid, jsonb) from public, anon, authenticated, tenant_app;
revoke all on function public.scrub_lead_ssn(uuid, uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.record_application_submission(uuid, uuid, uuid, text, text, text, timestamptz, text, jsonb, jsonb, text) to service_role;
grant execute on function public.mark_application_policy_issued(uuid, uuid, text, text, date) to service_role;
grant execute on function public.save_application_beneficiaries(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.scrub_lead_ssn(uuid, uuid, uuid) to service_role;

-- ─── self-check ─────────────────────────────────────────────────────────────
do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20261015570000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenant_extension_grants' and column_name = 'session_id') then
    raise exception 'tenant_extension_grants.session_id did not land';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenant_issued_policies' and column_name = 'application_id') then
    raise exception 'tenant_issued_policies.application_id did not land';
  end if;
  if to_regclass('public.tenant_application_submissions_application_key') is null
     or to_regclass('public.tenant_issued_policies_application_key') is null then
    raise exception 'the one-per-application unique keys did not land';
  end if;
  if to_regprocedure('public.record_application_submission(uuid, uuid, uuid, text, text, text, timestamptz, text, jsonb, jsonb, text)') is null
     or to_regprocedure('public.mark_application_policy_issued(uuid, uuid, text, text, date)') is null
     or to_regprocedure('public.save_application_beneficiaries(uuid, uuid, uuid, jsonb)') is null
     or to_regprocedure('public.scrub_lead_ssn(uuid, uuid, uuid)') is null then
    raise exception 'the LA-3 audit functions did not land';
  end if;
  if has_function_privilege('tenant_app', 'public.record_application_submission(uuid, uuid, uuid, text, text, text, timestamptz, text, jsonb, jsonb, text)', 'execute')
     or has_function_privilege('tenant_app', 'public.mark_application_policy_issued(uuid, uuid, text, text, date)', 'execute')
     or has_function_privilege('tenant_app', 'public.save_application_beneficiaries(uuid, uuid, uuid, jsonb)', 'execute')
     or has_function_privilege('tenant_app', 'public.scrub_lead_ssn(uuid, uuid, uuid)', 'execute') then
    raise exception 'the tenant plane can call an LA-3 audit function directly';
  end if;

  -- Each function runs, and refuses an application that is not the tenant's before writing anything.
  begin
    perform public.record_application_submission(gen_random_uuid(), gen_random_uuid(), null, null, null, null, null, 'copy_assist', '{}'::jsonb, '{}'::jsonb, null);
    raise exception 'record_application_submission accepted an application that does not exist';
  exception when others then
    if sqlerrm <> 'APPLICATION_NOT_FOUND' then raise; end if;
  end;
  begin
    perform public.mark_application_policy_issued(gen_random_uuid(), gen_random_uuid(), 'Carrier', 'P-1', current_date);
    raise exception 'mark_application_policy_issued accepted an application that does not exist';
  exception when others then
    if sqlerrm <> 'ISSUED_POLICY_APPLICATION_NOT_FOUND' then raise; end if;
  end;
  begin
    perform public.save_application_beneficiaries(gen_random_uuid(), gen_random_uuid(), null, '[]'::jsonb);
    raise exception 'save_application_beneficiaries accepted an application that does not exist';
  exception when others then
    if sqlerrm <> 'APPLICATION_NOT_FOUND' then raise; end if;
  end;
  if public.scrub_lead_ssn(gen_random_uuid(), gen_random_uuid(), gen_random_uuid()) <> 0 then
    raise exception 'scrub_lead_ssn touched a lead with no encrypted SSN behind it';
  end if;
  raise notice '20261015570000: grants bound to sessions, one policy and one submission per application, atomic beneficiaries, lead SSN masking';
end $$;
