-- ---------------------------------------------------------------------------
-- Vendor returns · a number that failed a LATER re-scrub is never claimed from the vendor
--
-- User decision (2026-09-25, Returns + Campaigns): "Run the scrub" (20260925706100,
-- lib/campaigns/scrubRun.ts) re-screens a campaign's leads and writes each new DNC / litigator hit
-- into the same ledger the import uses, tenant_campaign_scrub_rejections, with
-- source_key = 'scrub:<run id>' — and stamps the lead's screening columns with the new result. A
-- number that went onto a do-not-call list AFTER it was bought is not the vendor's defect. Only a row
-- recorded at import (source_key 'csv:<line>', or none) can be claimed.
--
-- The rows still count as unusable: tenant_campaign_costs.records_usable is purchased minus every
-- ledger row (20260917140000), and nothing here touches it. They just cannot be claimed.
--
-- Restated from their latest definitions, 20260925703200 (Pool, final), with that one exclusion and
-- nothing else changed:
--
--   vendor_claimable_leads         the scrub branch drops a lead whose number has a 'scrub:' ledger
--                                  row in its campaign (the re-scrub is what put the hit on the lead),
--                                  and a lead whose screening result was stamped by a nurture
--                                  reactivation's re-screen (tenant_nurture_reactivations records the
--                                  same screening_result_id it writes onto the lead — the exact link;
--                                  the column exists since 20260913450000, so nothing here waits on
--                                  20260925706500). Same rule: a DNC found by any screening after
--                                  purchase is not the vendor's defect. The wrong_number /
--                                  disconnected branch is unchanged.
--   create_import_removal_claim    drops ledger rows whose source_key starts 'scrub:'.
--
-- Same signatures, same grants (service role only). Returns' own functions (20260925707500,
-- 20260925707800) apply the same rule in their own bodies. Every assertion of 20260925703200 is
-- kept below, plus one for the new exclusion.
-- ---------------------------------------------------------------------------

create or replace function public.vendor_claimable_leads(
  p_tenant_id uuid,
  p_campaign_id uuid default null
)
returns table(
  lead_id uuid,
  campaign_id uuid,
  vendor_id uuid,
  campaign_name text,
  vendor_name text,
  lead_created_at timestamptz,
  reason text,
  source_type text,
  source_id uuid,
  evidence jsonb,
  claimable_until timestamptz,
  days_remaining integer,
  claimable boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with candidates as (
    select l.id as lead_id, l.campaign_id, c.vendor_id, c.name as campaign_name, v.name as vendor_name,
           l.created_at as lead_created_at,
            case coalesce(sr.outcome, l.screening_outcome) when 'dnc' then 'dnc' when 'tcpa_litigator' then 'tcpa_litigator' else 'invalid_phone' end as reason,
           'scrub'::text as source_type, l.screening_result_id as source_id,
           jsonb_build_object('source', 'scrub', 'lead_id', l.id, 'lead_created_at', l.created_at,
              'phone', coalesce(l.values->>'phone', l.values->>'phone_number', l.values->>'primary_phone'), 'state', l.values->>'state', 'screening_outcome', coalesce(sr.outcome, l.screening_outcome),
             'screening_result_id', l.screening_result_id, 'screening_checked_at', l.screening_checked_at,
             'screening_version', l.screening_version) as evidence,
           l.created_at + make_interval(days => v.return_window_days) as claimable_until,
           1 as priority
       from agent_leads l
       left join screening_results sr on sr.id = l.screening_result_id and sr.tenant_id = l.tenant_id
      join tenant_campaigns c on c.id = l.campaign_id and c.tenant_id = l.tenant_id
      join tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = l.tenant_id
     where l.tenant_id = p_tenant_id
       and (p_campaign_id is null or l.campaign_id = p_campaign_id)
       and coalesce(sr.outcome, l.screening_outcome) in ('dnc', 'tcpa_litigator', 'invalid_phone')
       -- A hit on the agency's OWN do-not-call list is stored as 'dnc' with no screening result
       -- (lib/compliance/screening.ts): it is the agency's decision, not the vendor's defect, and is
       -- never charged back. Only a registry hit — one with a screening result — is.
       and not (coalesce(sr.outcome, l.screening_outcome) = 'dnc' and l.screening_result_id is null)
       -- A hit found by a later re-scrub (source_key 'scrub:<run>', 20260925706100) is not the
       -- vendor's defect either: the number went onto the list after it was bought (20260925707900).
       and not exists (
         select 1 from tenant_campaign_scrub_rejections rs
          where rs.tenant_id = l.tenant_id
            and rs.campaign_id = l.campaign_id
            and rs.source_key like 'scrub:%'
            and rs.phone_digits = right(regexp_replace(coalesce(l.values->>'phone', l.values->>'phone_number', l.values->>'primary_phone', ''), '[^0-9]', '', 'g'), 10)
       )
       -- Nor a hit a nurture reactivation's re-screen stamped on the lead (lib/nurture/service.ts,
       -- complete_nurture_reactivation — 20260913450000, restated by 20260925706500). The exact link:
       -- the reactivation row records the same screening_result_id it wrote onto the lead.
       and not exists (
         select 1 from tenant_nurture_reactivations nr
          where nr.tenant_id = l.tenant_id
            and nr.lead_id = l.id
            and nr.screening_result_id = l.screening_result_id
       )
    union all
    select l.id, l.campaign_id, c.vendor_id, c.name, v.name, l.created_at,
           a.disposition, 'disposition', a.id,
           jsonb_build_object('source', 'disposition', 'lead_id', l.id, 'lead_created_at', l.created_at,
              'phone', coalesce(l.values->>'phone', l.values->>'phone_number', l.values->>'primary_phone'), 'state', l.values->>'state', 'disposition', a.disposition,
             'attempt_id', a.id, 'attempted_at', a.attempted_at, 'dial_clicked_at', a.dial_clicked_at,
             'attempt_number', a.attempt_number) as evidence,
           l.created_at + make_interval(days => v.return_window_days), 2
      from agent_leads l
      join tenant_campaigns c on c.id = l.campaign_id and c.tenant_id = l.tenant_id
      join tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = l.tenant_id
      join lateral (
        select a.* from tenant_call_attempts a
         where a.tenant_id = l.tenant_id and a.lead_id = l.id
           and a.disposition in ('wrong_number', 'disconnected')
         order by a.attempted_at desc, a.id desc limit 1
      ) a on true
     where l.tenant_id = p_tenant_id
       and (p_campaign_id is null or l.campaign_id = p_campaign_id)
  ),
  one_per_lead as (
    select distinct on (lead_id) * from candidates
     where not exists (
       select 1 from lead_claim_items i join lead_claims cl on cl.id = i.claim_id
        where i.tenant_id = p_tenant_id and i.lead_id = candidates.lead_id
     )
       -- One number, one claim: not a lead whose number this campaign already claimed as an
       -- import removal (20260925703200).
       and not exists (
         select 1 from lead_claim_items ri
           join tenant_campaign_scrub_rejections r on r.id = ri.scrub_rejection_id
          where ri.tenant_id = p_tenant_id
            and r.tenant_id = p_tenant_id
            and r.campaign_id = candidates.campaign_id
            and r.phone_digits = right(regexp_replace(coalesce(candidates.evidence->>'phone', ''), '[^0-9]', '', 'g'), 10)
       )
     order by lead_id, priority, claimable_until desc
  )
  select lead_id, campaign_id, vendor_id, campaign_name, vendor_name, lead_created_at, reason,
         source_type, source_id, evidence, claimable_until,
         greatest(0, floor(extract(epoch from (claimable_until - now())) / 86400))::integer as days_remaining,
         claimable_until > now() as claimable
    from one_per_lead
   order by claimable_until asc, lead_created_at asc;
$function$;

create or replace function public.create_import_removal_claim(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_created_by uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_vendor uuid;
  v_window integer;
  v_rate numeric;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_claim uuid;
  v_rows integer;
  v_amount integer;
  v_claim_reason text;
begin
  if v_reason is not null and v_reason not in ('tcpa_litigator', 'dnc', 'invalid', 'duplicate_in_file') then
    raise exception 'LEAD_CLAIM_REASON_INVALID';
  end if;

  -- The campaign row is locked so two presses cannot both draft the same rows; the partial unique
  -- index on lead_claim_items would refuse the second anyway, but as an error rather than a no-op.
  select c.vendor_id, c.total_spend_cents::numeric / nullif(c.records_purchased, 0), v.return_window_days
    into v_vendor, v_rate, v_window
    from tenant_campaigns c
    join tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = c.tenant_id
   where c.id = p_campaign_id and c.tenant_id = p_tenant_id
     for update of c;
  if not found then raise exception 'LEAD_CLAIM_CAMPAIGN_NOT_FOUND'; end if;
  if v_rate is null then raise exception 'LEAD_CLAIM_CAMPAIGN_HAS_NO_UNIT_COST'; end if;

  create temporary table if not exists pg_temp.import_removal_claim_rows (
    id uuid, phone_digits text, reason text, evidence jsonb
  ) on commit drop;
  truncate pg_temp.import_removal_claim_rows;

  insert into pg_temp.import_removal_claim_rows (id, phone_digits, reason, evidence)
  select r.id, r.phone_digits,
         case r.outcome when 'invalid' then 'invalid_phone' else r.outcome end,
         jsonb_build_object('source', 'import_removal', 'scrub_rejection_id', r.id, 'phone', r.phone_digits,
                            'outcome', r.outcome, 'detail', r.detail, 'source_row', r.source_key,
                            'occurrence', r.occurrence, 'rejected_at', r.rejected_at)
    from tenant_campaign_scrub_rejections r
   where r.tenant_id = p_tenant_id
     and r.campaign_id = p_campaign_id
     and r.outcome in ('tcpa_litigator', 'dnc', 'invalid', 'duplicate_in_file')
     -- The agency's own list is its decision, not the vendor's defect.
     and not (r.outcome = 'dnc' and coalesce(r.detail, '') ~* 'your do-not-call list')
     -- Only a row recorded at import: a later re-scrub's hit ('scrub:<run>') went onto the list
     -- after the number was bought (20260925707900).
     and coalesce(r.source_key, '') not like 'scrub:%'
     and (v_reason is null or r.outcome = v_reason)
     and r.rejected_at + make_interval(days => v_window) > now()
     and not exists (
       select 1 from lead_claim_items i where i.tenant_id = p_tenant_id and i.scrub_rejection_id = r.id
     )
     -- Already claimed as a lead of this campaign (an imported-and-suppressed DNC row is both).
     and not exists (
       select 1 from lead_claim_items i
         join agent_leads l on l.id = i.lead_id and l.tenant_id = i.tenant_id
        where i.tenant_id = p_tenant_id
          and l.campaign_id = p_campaign_id
          and right(regexp_replace(coalesce(l.values->>'phone', l.values->>'phone_number', l.values->>'primary_phone', ''), '[^0-9]', '', 'g'), 10) = r.phone_digits
     );

  select count(*)::integer, round(count(*) * v_rate)::integer,
         case when count(distinct reason) = 1 then min(reason) else 'mixed' end
    into v_rows, v_amount, v_claim_reason
    from pg_temp.import_removal_claim_rows;
  if v_rows = 0 then raise exception 'LEAD_CLAIM_NO_CLAIMABLE_LEADS'; end if;

  insert into lead_claims (tenant_id, campaign_id, vendor_id, reason, lead_count, amount_claimed_cents, created_by)
  values (p_tenant_id, p_campaign_id, v_vendor, v_claim_reason, v_rows, v_amount, p_created_by)
  returning id into v_claim;

  insert into lead_claim_items (claim_id, tenant_id, lead_id, scrub_rejection_id, reason, evidence)
  select v_claim, p_tenant_id, null, x.id, x.reason, x.evidence
    from pg_temp.import_removal_claim_rows x;

  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, reason, metadata)
  values ('tenant', p_created_by, 'tenant.vendor_claim_drafted_from_import', 'lead_claim', v_claim::text, null,
          jsonb_build_object(
            'tenantId', p_tenant_id,
            'campaign_id', p_campaign_id,
            'vendor_id', v_vendor,
            'claim_id', v_claim,
            'rows', v_rows,
            'amount_claimed_cents', v_amount,
            'reason', coalesce(v_reason, 'all')));

  return jsonb_build_object('claim_id', v_claim, 'rows', v_rows, 'amount_claimed_cents', v_amount);
end;
$function$;

revoke all on function public.create_import_removal_claim(uuid, uuid, uuid, text) from public, anon, authenticated, tenant_app;
grant execute on function public.create_import_removal_claim(uuid, uuid, uuid, text) to service_role;
revoke all on function public.vendor_claimable_leads(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.vendor_claimable_leads(uuid, uuid) to service_role;

-- ── proof ──────────────────────────────────────────────────────────────────
do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925707900: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  -- 20260925703200's assertions, kept.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'lead_claim_items' and column_name = 'scrub_rejection_id') then
    raise exception '20260925707900: lead_claim_items.scrub_rejection_id was not added';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'lead_claim_items' and column_name = 'lead_id' and is_nullable = 'NO') then
    raise exception '20260925707900: lead_claim_items.lead_id is still not null';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.lead_claim_items'::regclass and conname = 'lead_claim_items_subject_check') then
    raise exception '20260925707900: an item must name exactly one of a lead or a removal';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'lead_claim_items_scrub_rejection_key') then
    raise exception '20260925707900: a removal could be claimed twice';
  end if;
  if to_regprocedure('public.create_import_removal_claim(uuid, uuid, uuid, text)') is null then
    raise exception '20260925707900: create_import_removal_claim was not created';
  end if;
  if has_function_privilege('anon', 'public.create_import_removal_claim(uuid, uuid, uuid, text)', 'execute')
     or has_function_privilege('tenant_app', 'public.create_import_removal_claim(uuid, uuid, uuid, text)', 'execute') then
    raise exception '20260925707900: create_import_removal_claim must be service-role only';
  end if;
  if strpos(pg_get_functiondef('public.vendor_claimable_leads(uuid, uuid)'::regprocedure), 'scrub_rejection_id') = 0 then
    raise exception '20260925707900: vendor_claimable_leads does not exclude numbers claimed as removals';
  end if;
  if strpos(pg_get_functiondef('public.vendor_claimable_leads(uuid, uuid)'::regprocedure),
            'and not (coalesce(sr.outcome, l.screening_outcome) = ''dnc'' and l.screening_result_id is null)') = 0 then
    raise exception '20260925707900: vendor_claimable_leads offers hits on the agency''s own do-not-call list to the vendor';
  end if;
  if strpos(pg_get_functiondef('public.vendor_claimable_leads(uuid, uuid)'::regprocedure), '''wrong_number'', ''disconnected''') = 0 then
    raise exception '20260925707900: vendor_claimable_leads lost the wrong-number / disconnected branch';
  end if;
  if strpos(pg_get_functiondef('public.create_import_removal_claim(uuid, uuid, uuid, text)'::regprocedure), 'your do-not-call list') = 0 then
    raise exception '20260925707900: create_import_removal_claim claims hits on the agency''s own list';
  end if;

  -- The new exclusion, in both functions and in Returns' own.
  if strpos(pg_get_functiondef('public.vendor_claimable_leads(uuid, uuid)'::regprocedure), 'rs.source_key like ''scrub:%''') = 0 then
    raise exception '20260925707900: vendor_claimable_leads offers a re-scrub hit to the vendor';
  end if;
  if strpos(pg_get_functiondef('public.vendor_claimable_leads(uuid, uuid)'::regprocedure), 'nr.screening_result_id = l.screening_result_id') = 0 then
    raise exception '20260925707900: vendor_claimable_leads offers a nurture re-screen''s DNC hit to the vendor';
  end if;
  if to_regprocedure('public.vendor_return_candidates(uuid, uuid)') is not null
     and strpos(pg_get_functiondef('public.vendor_return_candidates(uuid, uuid)'::regprocedure), 'tenant_nurture_reactivations') = 0 then
    raise exception '20260925707900: vendor_return_candidates offers a nurture re-screen''s DNC hit to the vendor';
  end if;
  if to_regprocedure('public.vendor_undialable_rates(uuid, uuid)') is not null
     and strpos(pg_get_functiondef('public.vendor_undialable_rates(uuid, uuid)'::regprocedure), 'tenant_nurture_reactivations') = 0 then
    raise exception '20260925707900: vendor_undialable_rates counts a nurture re-screen''s DNC hit against the vendor';
  end if;
  if strpos(pg_get_functiondef('public.create_import_removal_claim(uuid, uuid, uuid, text)'::regprocedure), 'not like ''scrub:%''') = 0 then
    raise exception '20260925707900: create_import_removal_claim claims a re-scrub hit from the vendor';
  end if;
  if to_regprocedure('public.vendor_return_candidates(uuid, uuid)') is not null
     and strpos(pg_get_functiondef('public.vendor_return_candidates(uuid, uuid)'::regprocedure), 'scrub:%') = 0 then
    raise exception '20260925707900: vendor_return_candidates offers a re-scrub hit to the vendor';
  end if;
  if to_regprocedure('public.vendor_undialable_rates(uuid, uuid)') is not null
     and strpos(pg_get_functiondef('public.vendor_undialable_rates(uuid, uuid)'::regprocedure), 'scrub:%') = 0 then
    raise exception '20260925707900: vendor_undialable_rates counts a re-scrub hit against the vendor';
  end if;
  raise notice '20260925707900: only rows recorded at import can be claimed from the vendor';
end $$;
