-- Security review 2026-11 · H-1 steps 2–3: SSN and bank numbers on a lead are sealed at rest.
--
-- The application now stores those values in agent_leads.values as one sealed string
-- (lib/leadValues/seal.ts):
--
--     sealed1:<last four>:<lookup>:<AES-256-GCM ciphertext>
--
-- Storing it needs no DDL. The one thing in the database that read an SSN back is the partner
-- duplicate check, which compared the lead's SSN digits with the typed ones. A sealed SSN carries
-- `lookup`, a per-tenant keyed HMAC of its nine digits, which the application computes for the typed
-- SSN too; this function now matches on it as well as on the old plaintext (rows not yet sealed by the
-- backfill, scripts/seal-lead-sensitive-values.mjs).
--
-- The 4-argument function is dropped rather than overloaded: PostgREST cannot choose between a 4- and a
-- 5-argument function when a call names only the first four. The application tries the 5-argument call
-- first and falls back to the 4-argument one, so either order of deploy and apply works.
--
-- Execute is limited to the server (service_role): the function is SECURITY DEFINER and reads every
-- lead of a tenant, and it had the default PUBLIC grant (security review M-5).


drop function if exists public.find_partner_lead_duplicates(uuid, text, text, text);

create function public.find_partner_lead_duplicates(
  p_tenant_id uuid,
  p_phone_digits text,
  p_full_name text,
  p_ssn_digits text,
  p_ssn_lookup text default null
)
returns table(lead_id uuid, matched_on text[])
language sql
security definer
set search_path to 'public'
as $function$
  with candidates as (
    select
      l.id,
      array_remove(array[
        case
          when p_ssn_lookup is not null
           and coalesce(l.values->>'ssn', l.values->>'ssn_number') like 'sealed1:%'
           and split_part(coalesce(l.values->>'ssn', l.values->>'ssn_number'), ':', 3) = p_ssn_lookup
          then 'ssn'
          when p_ssn_digits is not null
           and coalesce(l.values->>'ssn', l.values->>'ssn_number') not like 'sealed1:%'
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
$function$;

revoke all on function public.find_partner_lead_duplicates(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.find_partner_lead_duplicates(uuid, text, text, text, text) to service_role;

-- Check: the new signature exists, the old one is gone, and only the server can run it.
do $$
begin
  if to_regprocedure('public.find_partner_lead_duplicates(uuid, text, text, text, text)') is null then
    raise exception 'find_partner_lead_duplicates(uuid, text, text, text, text) is missing';
  end if;
  if to_regprocedure('public.find_partner_lead_duplicates(uuid, text, text, text)') is not null then
    raise exception 'the 4-argument find_partner_lead_duplicates is still there';
  end if;
  if has_function_privilege('anon', 'public.find_partner_lead_duplicates(uuid, text, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.find_partner_lead_duplicates(uuid, text, text, text, text)', 'execute') then
    raise exception 'find_partner_lead_duplicates is still executable by anon or authenticated';
  end if;
end $$;

