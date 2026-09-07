-- LA-1.6: partner submission guards and durable duplicate-override evidence.
-- The browser is only a convenience layer. These checks are repeated by the API and
-- backed by the database so a hand-crafted request cannot bypass them.

alter table public.agent_leads
  add column if not exists screening_warning_acknowledged boolean not null default false,
  add column if not exists screening_warning_acknowledged_at timestamptz,
  add column if not exists duplicate_override_justification text,
  add column if not exists duplicate_override_by uuid references public.users(id) on delete set null,
  add column if not exists duplicate_override_at timestamptz;

alter table public.agent_leads drop constraint if exists agent_leads_duplicate_override_justification_check;
alter table public.agent_leads add constraint agent_leads_duplicate_override_justification_check
  check (duplicate_override_justification is null or char_length(btrim(duplicate_override_justification)) between 10 and 1000);

create index if not exists agent_leads_partner_identity_idx
  on public.agent_leads (tenant_id, created_at desc)
  where partner_id is not null;

create or replace function public.find_partner_lead_duplicates(
  p_tenant_id uuid,
  p_phone_digits text,
  p_full_name text,
  p_ssn_digits text
)
returns table(lead_id uuid, matched_on text[])
language sql
security definer
set search_path = public
as $$
  with candidates as (
    select
      l.id,
      array_remove(array[
        case
          when p_ssn_digits is not null
           and regexp_replace(coalesce(l.values->>'ssn', l.values->>'ssn_number'), '[^0-9]', '', 'g') = regexp_replace(p_ssn_digits, '[^0-9]', '', 'g')
          then 'ssn'
        end,
        case
          when p_phone_digits is not null
           and p_full_name is not null
           and regexp_replace(coalesce(l.values->>'phone', l.values->>'phone_number'), '[^0-9]', '', 'g') = regexp_replace(p_phone_digits, '[^0-9]', '', 'g')
           and lower(btrim(coalesce(l.values->>'full_name', trim(concat_ws(' ', l.values->>'first_name', l.values->>'last_name'))))) = lower(btrim(p_full_name))
          then 'phone_and_name'
        end
      ], null) as matched_on
    from public.agent_leads l
    where l.tenant_id = p_tenant_id
  )
  select id, matched_on
  from candidates
  where cardinality(matched_on) > 0;
$$;

revoke all on function public.find_partner_lead_duplicates(uuid, text, text, text)
  from public, anon, authenticated, tenant_app;
grant execute on function public.find_partner_lead_duplicates(uuid, text, text, text)
  to service_role;
