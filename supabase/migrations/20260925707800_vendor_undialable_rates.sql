-- ---------------------------------------------------------------------------
-- Vendor returns · the share of every record bought from a vendor that could never be dialed
--
-- Returns concept audit (LA-2 §15, 2026-09-25). User decision: an UNDIALABLE share per vendor, with
-- records purchased as the denominator — every record paid for, including the rows the scrub
-- removed at import, which never became leads. Labelled "undialable", never blended with the claim
-- acceptance rate (decision 11 of the vendor scorecard; lib/vendorScorecard/metricDirections.test.mjs
-- refuses the old blended name anywhere in the code).
--
-- Undialable, per campaign, then summed per vendor (sum then divide, never an average of averages):
--
--   removed_at_import   tenant_campaign_scrub_rejections rows the vendor is answerable for — TCPA
--                       litigator, registry DNC, invalid, a repeat inside the file. The same set
--                       vendor_return_candidates (20260925707500) and create_import_removal_claim
--                       (20260925703200) treat as creditable. A hit on the agency's own
--                       do-not-call list and a 'suppressed' row are the agency's decision, not the
--                       vendor's defect, and are not counted. Nor is a hit a later re-scrub
--                       found (source_key 'scrub:<run>', 20260925706100): that number went onto a
--                       list after it was bought (20260925707900). Those rows still lower the
--                       usable count for cost per usable record; they are just not the vendor's.
--   undialable_leads    imported leads later found undialable: a registry DNC or litigator screening
--                       result (screening_results — an own-list hit has no result row) that no
--                       re-scrub found, or a call
--                       dispositioned wrong number or disconnected. A lead whose number is also a
--                       counted removal of the same campaign is counted once, as the removal.
--   undialable_cents    those rows at the campaign's purchased cost per record.
--
-- The Vendors page reads this (contract: one definition). Read-only (STABLE), service role only.
-- Additive: a new function.
-- ---------------------------------------------------------------------------

create or replace function public.vendor_undialable_rates(
  p_tenant_id uuid,
  p_vendor_id uuid default null
)
returns table(
  vendor_id uuid,
  vendor_name text,
  records_purchased integer,
  removed_at_import integer,
  undialable_leads integer,
  undialable_rows integer,
  undialable_percent numeric,
  undialable_cents integer
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  with camp as (
    select c.id, c.vendor_id, v.name as vname, c.records_purchased as purchased,
           c.total_spend_cents::numeric / nullif(c.records_purchased, 0) as rate
      from public.tenant_campaigns c
      join public.tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = c.tenant_id
     where c.tenant_id = p_tenant_id
       and (p_vendor_id is null or c.vendor_id = p_vendor_id)
  ),
  removed as (
    select distinct r.campaign_id as cid, r.phone_digits as digits, r.id
      from public.tenant_campaign_scrub_rejections r
     where r.tenant_id = p_tenant_id
       and r.campaign_id in (select camp.id from camp)
       and r.outcome in ('tcpa_litigator', 'dnc', 'invalid', 'duplicate_in_file')
       and not (r.outcome = 'dnc' and coalesce(r.detail, '') ~* 'your do-not-call list')
       -- Recorded at import only. A later re-scrub's hit ('scrub:<run>') is a number that went onto
       -- a list after it was bought — not the vendor's defect (20260925707900).
       and coalesce(r.source_key, '') not like 'scrub:%'
  ),
  rescrub as (
    select distinct rs.campaign_id as cid, rs.phone_digits as digits
      from public.tenant_campaign_scrub_rejections rs
     where rs.tenant_id = p_tenant_id
       and rs.campaign_id in (select camp.id from camp)
       and rs.source_key like 'scrub:%'
  ),
  lead_numbers as (
    select l.id, l.tenant_id, l.campaign_id as cid, sr.outcome as screened, l.screening_result_id as result_id,
           right(regexp_replace(coalesce(l.values->>'phone', l.values->>'phone_number', l.values->>'primary_phone', ''), '[^0-9]', '', 'g'), 10) as digits
      from public.agent_leads l
      left join public.screening_results sr on sr.id = l.screening_result_id and sr.tenant_id = l.tenant_id
     where l.tenant_id = p_tenant_id
       and l.campaign_id in (select camp.id from camp)
  ),
  bad_leads as (
    select ln.id, ln.cid, ln.digits
      from lead_numbers ln
     where (ln.screened in ('dnc', 'tcpa_litigator')
            -- a registry hit a later re-scrub found is not the vendor's defect
            and not exists (select 1 from rescrub rx where rx.cid = ln.cid and rx.digits = ln.digits)
            -- nor one a nurture reactivation's re-screen stamped on the lead (same result id)
            and not exists (select 1 from public.tenant_nurture_reactivations nr
                             where nr.tenant_id = ln.tenant_id and nr.lead_id = ln.id
                               and nr.screening_result_id = ln.result_id))
        or exists (
             select 1 from public.tenant_call_attempts a
              where a.tenant_id = ln.tenant_id and a.lead_id = ln.id
                and a.disposition in ('wrong_number', 'disconnected')
           )
  ),
  per_campaign as (
    select c.id, c.vendor_id, c.vname, c.purchased, c.rate,
           coalesce(r.n, 0) as removed_n,
           coalesce(b.n, 0) as lead_n
      from camp c
      left join (select removed.cid, count(*)::integer as n from removed group by removed.cid) r on r.cid = c.id
      left join (
        select bl.cid, count(*)::integer as n
          from bad_leads bl
         where bl.digits = ''
            or not exists (select 1 from removed rm where rm.cid = bl.cid and rm.digits = bl.digits)
         group by bl.cid
      ) b on b.cid = c.id
  )
  select p.vendor_id, min(p.vname),
         sum(p.purchased)::integer,
         sum(p.removed_n)::integer,
         sum(p.lead_n)::integer,
         sum(p.removed_n + p.lead_n)::integer,
         round(100.0 * sum(p.removed_n + p.lead_n) / nullif(sum(p.purchased), 0), 1),
         round(sum((p.removed_n + p.lead_n) * coalesce(p.rate, 0)))::integer
    from per_campaign p
   group by p.vendor_id
   order by round(100.0 * sum(p.removed_n + p.lead_n) / nullif(sum(p.purchased), 0), 1) desc nulls last, min(p.vname);
$function$;

revoke all on function public.vendor_undialable_rates(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.vendor_undialable_rates(uuid, uuid) to service_role;

-- ── proof ──────────────────────────────────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_bad integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925707800: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if to_regprocedure('public.vendor_undialable_rates(uuid, uuid)') is null then
    raise exception '20260925707800: vendor_undialable_rates did not land';
  end if;
  if has_function_privilege('tenant_app', 'public.vendor_undialable_rates(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.vendor_undialable_rates(uuid, uuid)', 'execute') then
    raise exception '20260925707800: vendor_undialable_rates must be service-role only';
  end if;
  if strpos(pg_get_functiondef('public.vendor_undialable_rates(uuid, uuid)'::regprocedure), 'your do-not-call list') = 0 then
    raise exception '20260925707800: own-list DNC hits would count against the vendor';
  end if;

  select c.tenant_id into v_tenant from public.tenant_campaigns c where c.records_purchased > 0 limit 1;
  if v_tenant is null then
    raise notice '20260925707800: behavioural check skipped, no campaign with records purchased';
    return;
  end if;
  -- The parts add up, and a share exists exactly when something was bought.
  select count(*) into v_bad from public.vendor_undialable_rates(v_tenant) u
   where u.undialable_rows <> u.removed_at_import + u.undialable_leads
      or (u.records_purchased > 0) <> (u.undialable_percent is not null);
  if v_bad > 0 then
    raise exception '20260925707800: % vendor row(s) whose undialable parts do not add up', v_bad;
  end if;
  raise notice '20260925707800: undialable share per vendor over records purchased';
end $$;
