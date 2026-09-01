-- LA-0.6 corrective migration: a contact's alternate phone is part of the duplicate key.
-- The original migration is already live; keep this replacement separate so migration history
-- remains append-only and a fresh database gets the same final function definition.
create or replace function public.find_contact_duplicates(
  p_tenant_id uuid,
  p_name_search text,
  p_dob date default null,
  p_phone text default null,
  p_address_search text default null,
  p_address_hash text default null,
  p_limit integer default 20
)
returns table (
  contact_id uuid,
  household_id uuid,
  first_name text,
  last_name text,
  dob date,
  primary_phone text,
  state text,
  custom_fields jsonb,
  address_line1 text,
  city text,
  postal_code text,
  score numeric,
  confidence text,
  matched_on text[]
)
language sql stable security invoker set search_path = public
as $$
with candidates as (
  select
    c.id as contact_id,
    c.household_id,
    c.first_name,
    c.last_name,
    c.dob,
    c.primary_phone,
    c.state,
    c.custom_fields,
    h.address_line1,
    h.city,
    h.postal_code,
    (
      (case when p_phone is not null and (c.primary_phone = p_phone or exists (select 1 from public.contact_phones cp where cp.contact_id = c.id and cp.tenant_id = p_tenant_id and cp.phone = p_phone)) then 0.35 else 0 end) +
      (case when p_dob is not null and c.dob = p_dob then 0.25 else 0 end) +
      (case when p_address_hash is not null and h.address_hash = p_address_hash then 0.20 else 0 end) +
      (case when nullif(p_name_search, '') is not null then greatest(similarity(c.name_search, p_name_search), 0) * 0.40 else 0 end) +
      (case when nullif(p_address_search, '') is not null and h.address_search is not null then greatest(similarity(h.address_search, p_address_search), 0) * 0.20 else 0 end)
    )::numeric as raw_score,
    array_remove(array[
      case when p_phone is not null and (c.primary_phone = p_phone or exists (select 1 from public.contact_phones cp where cp.contact_id = c.id and cp.tenant_id = p_tenant_id and cp.phone = p_phone)) then 'phone' end,
      case when p_dob is not null and c.dob = p_dob then 'dob' end,
      case when p_address_hash is not null and h.address_hash = p_address_hash then 'address' end,
      case when nullif(p_name_search, '') is not null and similarity(c.name_search, p_name_search) >= 0.45 then 'name' end
    ], null) as matched_on
  from public.contacts c
  left join public.households h on h.id = c.household_id and h.tenant_id = p_tenant_id
  where c.tenant_id = p_tenant_id
    and c.merged_into_id is null
    and (
      (p_phone is not null and (c.primary_phone = p_phone or exists (select 1 from public.contact_phones cp where cp.contact_id = c.id and cp.tenant_id = p_tenant_id and cp.phone = p_phone))) or
      (p_dob is not null and c.dob = p_dob) or
      (p_address_hash is not null and h.address_hash = p_address_hash) or
      (nullif(p_name_search, '') is not null and c.name_search % p_name_search) or
      (nullif(p_address_search, '') is not null and h.address_search % p_address_search)
    )
), filtered as (
  select *, round(raw_score, 4) as rounded_score from candidates where raw_score >= 0.45
)
select contact_id, household_id, first_name, last_name, dob, primary_phone, state, custom_fields,
       address_line1, city, postal_code, rounded_score,
       case when rounded_score >= 0.78 then 'high' when rounded_score >= 0.60 then 'medium' else 'low' end,
       matched_on
from filtered
order by rounded_score desc, contact_id
limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke all on function public.find_contact_duplicates(uuid, text, date, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.find_contact_duplicates(uuid, text, date, text, text, text, integer) to service_role;
