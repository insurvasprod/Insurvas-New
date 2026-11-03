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
