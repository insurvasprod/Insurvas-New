-- LA-0.6 regression fix: restore secondary-phone duplicate matching.
--
-- `20260901101500_la_0_6_secondary_phone_dedupe_fix.sql` added it. The LA-0 compatibility bridge
-- (`20260910120000_la_0_tenant_compatibility_bridge.sql`) then re-declared
-- `find_contact_duplicates` with `create or replace` and, in doing so, silently reverted it: the
-- deployed function scores a phone match only against `contacts.primary_phone` and never looks at
-- `contact_phones`.
--
-- Why it matters more than it looks. LA-0.6's whole argument is that phone-only matching is not
-- enough BECAUSE one consumer arrives with a mobile from one publisher and a landline from
-- another: "matching on phone number alone catches roughly half of them". A contact whose
-- alternate number is the incoming number is exactly the case the agent pays twice for. Detection
-- still fired in the verifier via name + DOB + address, which is how this stayed hidden — the
-- duplicate was found, just never *by phone*, so a lead sharing only a secondary number with an
-- existing contact would score 0.35 lower and could fall under the 0.45 candidate floor entirely.
--
-- This restores the secondary-phone clause and keeps the null-safety the bridge version added
-- (`coalesce(c.name_search, '')`, `coalesce(h.address_search, '')`), which the original lacked.
--
-- Verify with: npm run verify:contacts — "misspelled surname and second phone are detected"
-- asserts matched_on contains 'phone'.

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
      -- A phone match counts whether the incoming number is the contact's primary OR any of its
      -- alternates. This is the clause the bridge dropped.
      (case when p_phone is not null and (
             c.primary_phone = p_phone
             or exists (select 1 from public.contact_phones cp
                         where cp.contact_id = c.id and cp.tenant_id = p_tenant_id and cp.phone = p_phone)
           ) then 0.35 else 0 end) +
      (case when p_dob is not null and c.dob = p_dob then 0.25 else 0 end) +
      (case when p_address_hash is not null and h.address_hash = p_address_hash then 0.20 else 0 end) +
      (case when nullif(p_name_search, '') is not null
            then greatest(similarity(coalesce(c.name_search, ''), p_name_search), 0) * 0.40 else 0 end) +
      (case when nullif(p_address_search, '') is not null and h.address_search is not null
            then greatest(similarity(h.address_search, p_address_search), 0) * 0.20 else 0 end)
    )::numeric as raw_score,
    array_remove(array[
      case when p_phone is not null and (
             c.primary_phone = p_phone
             or exists (select 1 from public.contact_phones cp
                         where cp.contact_id = c.id and cp.tenant_id = p_tenant_id and cp.phone = p_phone)
           ) then 'phone' end,
      case when p_dob is not null and c.dob = p_dob then 'dob' end,
      case when p_address_hash is not null and h.address_hash = p_address_hash then 'address' end,
      case when nullif(p_name_search, '') is not null
            and similarity(coalesce(c.name_search, ''), p_name_search) >= 0.45 then 'name' end
    ], null) as matched_on
  from public.contacts c
  left join public.households h on h.id = c.household_id and h.tenant_id = p_tenant_id
  where c.tenant_id = p_tenant_id
    and c.merged_into_id is null
    and (
      (p_phone is not null and (
         c.primary_phone = p_phone
         or exists (select 1 from public.contact_phones cp
                     where cp.contact_id = c.id and cp.tenant_id = p_tenant_id and cp.phone = p_phone))) or
      (p_dob is not null and c.dob = p_dob) or
      (p_address_hash is not null and h.address_hash = p_address_hash) or
      (nullif(p_name_search, '') is not null and coalesce(c.name_search, '') % p_name_search) or
      (nullif(p_address_search, '') is not null and coalesce(h.address_search, '') % p_address_search)
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

-- Supports the `exists` lookup above; without it the secondary-phone clause is a scan per
-- candidate, which matters at the 20,000-contact / 500ms budget LA-0.6 sets.
create index if not exists contact_phones_tenant_phone_idx
  on public.contact_phones (tenant_id, phone);

revoke all on function public.find_contact_duplicates(uuid, text, date, text, text, text, integer)
  from public, anon, authenticated, tenant_app;
grant execute on function public.find_contact_duplicates(uuid, text, date, text, text, text, integer) to service_role;
