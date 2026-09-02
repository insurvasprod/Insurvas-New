-- LA-1.24 corrective migration: normalize lead DOB values to digits before comparing.
create or replace function public.find_existing_customer_preflight(
  p_tenant_id uuid,
  p_full_name text default null,
  p_dob date default null,
  p_phone_digits text default null,
  p_address_search text default null,
  p_exclude_lead_id uuid default null,
  p_limit integer default 20
)
returns table (
  lead_id uuid,
  contact_id uuid,
  submitted_at timestamptz,
  partner_id uuid,
  partner_name text,
  product_line text,
  outcome text,
  score numeric,
  matched_on text[],
  source_type text
)
language sql
security definer
set search_path = public, pg_catalog
as $$
with input as (
  select
    nullif(regexp_replace(lower(coalesce(p_full_name, '')), '[^a-z0-9]', '', 'g'), '') as name_key,
    nullif(regexp_replace(coalesce(p_phone_digits, ''), '[^0-9]', '', 'g'), '') as phone_key,
    nullif(regexp_replace(lower(coalesce(p_address_search, '')), '[^a-z0-9]', '', 'g'), '') as address_key
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
), contact_values as (
  select c.id as contact_id, c.created_at as submitted_at, c.first_name, c.last_name, c.dob, c.primary_phone, c.name_search, h.address_search, h.address_hash, c.household_id
  from public.contacts c
  left join public.households h on h.id = c.household_id and h.tenant_id = p_tenant_id
  cross join input i
  where c.tenant_id = p_tenant_id and c.merged_into_id is null
    and (i.phone_key is not null or p_dob is not null or i.name_key is not null or i.address_key is not null)
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
$$;

revoke all on function public.find_existing_customer_preflight(uuid, text, date, text, text, uuid, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.find_existing_customer_preflight(uuid, text, date, text, text, uuid, integer) to service_role;
