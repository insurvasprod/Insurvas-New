-- ---------------------------------------------------------------------------
-- LA-3 audit · mask the lead SSNs that applications already hold (backfill)
--
-- Needs 20261015570000 (scrub_lead_ssn). From now on the app masks a lead's SSN the moment the
-- application stores it encrypted; this does the same once for every primary application that
-- already holds one. A lead keeps the masked last four ("***-**-1234"); the full number stays only on
-- the application, encrypted, where every read is logged.
--
-- IRREVERSIBLE for the lead copy: the plaintext on agent_leads.values is overwritten. The encrypted
-- copy on the application is untouched. Kept separate from 570000 so it can be run on its own.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_n integer := 0;
begin
  if to_regprocedure('public.scrub_lead_ssn(uuid, uuid, uuid)') is null then
    raise exception 'apply 20261015570000 first: scrub_lead_ssn is missing';
  end if;
  for r in
    select distinct on (t.lead_id) t.tenant_id, t.lead_id, t.id
      from public.tenant_applications t
      join public.tenant_application_values v
        on v.application_id = t.id and v.tenant_id = t.tenant_id
       and v.field_key = 'insured.ssn' and v.value_ciphertext is not null
     where t.insured_role = 'primary'
     order by t.lead_id, t.created_at desc
  loop
    v_n := v_n + public.scrub_lead_ssn(r.tenant_id, r.lead_id, r.id);
  end loop;
  raise notice '20261015571000: % lead SSN value(s) masked', v_n;

  -- Nothing left behind: no lead whose primary application holds the SSN still carries a full number.
  if exists (
    select 1
      from public.tenant_applications t
      join public.tenant_application_values v
        on v.application_id = t.id and v.tenant_id = t.tenant_id
       and v.field_key = 'insured.ssn' and v.value_ciphertext is not null
      join public.agent_leads l on l.id = t.lead_id and l.tenant_id = t.tenant_id
      cross join lateral unnest(array['ssn', 'social_security_number', 'social_security']) k(key)
     where t.insured_role = 'primary'
       and char_length(regexp_replace(coalesce(l.values ->> k.key, ''), '[^0-9]', '', 'g')) = 9) then
    raise exception 'a lead still holds a full SSN its application already has encrypted';
  end if;
end $$;
