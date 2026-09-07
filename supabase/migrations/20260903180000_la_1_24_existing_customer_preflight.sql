-- LA-1.24: tenant-scoped existing-customer pre-flight evidence.
-- This is deliberately lead-level evidence, not a policy lookup. The Book of Business
-- module owns policy matching later.

alter table public.intake_failures drop constraint if exists intake_failures_step_check;
alter table public.intake_failures add constraint intake_failures_step_check
  check (step in ('preflight', 'work_item', 'deal_flow', 'notification'));

alter table public.agent_leads
  add column if not exists preflight_status text not null default 'new_household',
  add column if not exists preflight_checked_at timestamptz,
  add column if not exists preflight_result jsonb not null default '{"policy_matching_included":false,"matches":[]}'::jsonb;

alter table public.agent_leads drop constraint if exists agent_leads_preflight_status_check;
alter table public.agent_leads add constraint agent_leads_preflight_status_check
  check (preflight_status in ('new_household', 'spoken_before', 'already_customer', 'not_checked'));
alter table public.agent_leads drop constraint if exists agent_leads_preflight_result_check;
alter table public.agent_leads add constraint agent_leads_preflight_result_check
  check (jsonb_typeof(preflight_result) = 'object');

create index if not exists agent_leads_preflight_tenant_idx
  on public.agent_leads (tenant_id, preflight_status, created_at desc);

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

-- The inbox is an existing read model. Replace its signature so the pre-flight evidence is
-- delivered with the same tenant-filtered query as the rest of the transfer card.
drop function if exists public.list_transfer_inbox(uuid, text, uuid, text, text, text, uuid);
create function public.list_transfer_inbox(
  p_tenant_id uuid,
  p_status text default 'unclaimed',
  p_partner_id uuid default null,
  p_product_line text default null,
  p_state text default null,
  p_screening_outcome text default null,
  p_claimed_by uuid default null
)
returns table (
  id uuid, lead_id uuid, partner_id uuid, partner_name text, product_line text, status text,
  owner_user_id uuid, owner_name text, claimed_at timestamptz, queued_at timestamptz,
  wait_seconds integer, customer text, age text, state text, screening_outcome text,
  screening_warning text, duplicate_warning boolean, preflight_status text, preflight_result jsonb
)
language sql security definer set search_path = public, pg_catalog
as $$
with shaped as (
  select q.id, q.lead_id, q.partner_id, p.name as partner_name, q.product_line, q.status,
    coalesce(q.owner_user_id, q.claimed_by) as owner_user_id, u.name as owner_name, q.claimed_at, q.queued_at,
    greatest(0, floor(extract(epoch from (now() - q.queued_at)))::integer) as wait_seconds,
    coalesce(nullif(btrim(l.values ->> 'full_name'), ''), nullif(btrim(l.values ->> 'name'), ''), nullif(btrim(concat_ws(' ', l.values ->> 'first_name', l.values ->> 'last_name')), ''), 'Unnamed customer') as customer,
    case when nullif(btrim(l.values ->> 'age'), '') is not null then btrim(l.values ->> 'age')
      when (l.values ->> 'date_of_birth') ~ '^\\d{4}-\\d{2}-\\d{2}$' then extract(year from age(current_date, (l.values ->> 'date_of_birth')::date))::integer::text
      when (l.values ->> 'dob') ~ '^\\d{4}-\\d{2}-\\d{2}$' then extract(year from age(current_date, (l.values ->> 'dob')::date))::integer::text else '—' end as age,
    coalesce(nullif(btrim(l.values ->> 'state'), ''), nullif(btrim(l.values ->> 'state_code'), ''), nullif(btrim(l.values ->> 'primary_state'), ''), '—') as state,
    coalesce(nullif(btrim(l.screening_outcome), ''), 'not_checked') as screening_outcome, l.screening_warning,
    (nullif(btrim(l.duplicate_override_justification), '') is not null or coalesce((l.values ->> 'duplicate_warning')::boolean, false)) as duplicate_warning,
    l.preflight_status, l.preflight_result
  from public.lead_queue q join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
    left join public.partners p on p.id = q.partner_id and p.tenant_id = q.tenant_id
    left join public.users u on u.id = coalesce(q.owner_user_id, q.claimed_by)
  where q.tenant_id = p_tenant_id and (p_status = 'all' or q.status = p_status)
    and (p_partner_id is null or q.partner_id = p_partner_id) and (p_product_line is null or q.product_line = p_product_line)
    and (p_claimed_by is null or coalesce(q.owner_user_id, q.claimed_by) = p_claimed_by)
  order by q.queued_at asc limit 500
)
select * from shaped where (p_state is null or shaped.state = p_state)
  and (p_screening_outcome is null or shaped.screening_outcome = p_screening_outcome);
$$;
revoke all on function public.list_transfer_inbox(uuid, text, uuid, text, text, text, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.list_transfer_inbox(uuid, text, uuid, text, text, text, uuid) to service_role;
