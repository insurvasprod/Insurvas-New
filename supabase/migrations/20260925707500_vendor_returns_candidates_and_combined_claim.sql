-- ---------------------------------------------------------------------------
-- Vendor returns · one list of what can be claimed, what it is worth, and one claim per campaign
--
-- Returns concept audit (LA-2 §15, 2026-09-25). User decisions:
--   * One claim per campaign combines the lead-based rows (a scrub hit on an imported lead, a call
--     dispositioned wrong number or disconnected) AND the rows the scrub removed at import, with a
--     preview first: count, dollars and evidence per reason, and a toggle per reason.
--   * The rate is the campaign's purchased cost per record — total_spend_cents / records_purchased —
--     exactly what create_vendor_return_claim (20260913440000) and create_import_removal_claim
--     (20260925703200) charge.
--   * Evidence carries the attempt number and time of a call, never the agent.
--
-- Three functions, service role only:
--
--   vendor_return_candidates(tenant, campaign?)
--       Every row that is or was claimable and is on no claim yet, from both sources, one row each:
--         source 'lead'    vendor_claimable_leads (Pool, latest 20260925703200) — NOT restated here.
--         source 'import'  tenant_campaign_scrub_rejections, filtered exactly as
--                          create_import_removal_claim filters: TCPA litigator, registry DNC,
--                          invalid, a repeat inside the file; never a hit on the agency's own
--                          do-not-call list; never a hit a later re-scrub found (source_key
--                          'scrub:<run>' — the number went onto the list after it was bought; the
--                          same rule 20260925707900 adds to Pool's two functions); not already on a
--                          claim, as a removal or as a lead of the same campaign with the same
--                          number. Window = rejected_at + the vendor's return_window_days.
--                          A lead whose screening hit came from such a re-scrub is not offered either.
--       One number, one claim: a lead whose number is also an unclaimed removal of the same campaign
--       (an imported-and-suppressed DNC row is both) is offered once, as the removal — it carries the
--       line of the vendor's file.
--       The import source exists only once 20260925703200 is applied (lead_claim_items can hold a
--       removal). Until then — to_regprocedure on Pool's create_import_removal_claim — this returns
--       the lead rows alone, which is today's behaviour.
--
--   vendor_returns_candidates_summary(tenant, vendor?, campaign?)
--       The ONE definition of claimable dollars and days left (Vendors aggregates it by vendor).
--       Per campaign: the window, the first import, the rate, claimable and expired rows and dollars,
--       the soonest close, and the same split per reason and source. Expired counts only when the
--       vendor has a return window at all: a 0-day vendor never accepted returns, nothing lapsed.
--
--   create_combined_vendor_return_claim(tenant, campaign, actor, reasons?)
--       Drafts one claim from the campaign's claimable candidates, optionally only some reasons, at
--       the purchased rate, and writes one audit row (tenant.vendor_claim_drafted). The claim is a
--       normal draft, submitted and resolved through update_vendor_return_claim.
--
-- Additive. Nothing existing is restated.
-- ---------------------------------------------------------------------------

create or replace function public.vendor_return_candidates(
  p_tenant_id uuid,
  p_campaign_id uuid default null
)
returns table(
  source text,
  lead_id uuid,
  scrub_rejection_id uuid,
  campaign_id uuid,
  vendor_id uuid,
  campaign_name text,
  vendor_name text,
  reason text,
  phone_digits text,
  evidence jsonb,
  claimable_until timestamptz,
  days_remaining integer,
  claimable boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
#variable_conflict use_column
declare
  -- Removals can sit in the claim ledger only once Pool's 20260925703200 is applied.
  v_removals boolean := to_regprocedure('public.create_import_removal_claim(uuid, uuid, uuid, text)') is not null;
begin
  if not v_removals then
    return query
      select 'lead'::text, k.lead_id, null::uuid, k.campaign_id, k.vendor_id, k.campaign_name, k.vendor_name,
             k.reason, right(regexp_replace(coalesce(k.evidence->>'phone', ''), '[^0-9]', '', 'g'), 10),
             k.evidence, k.claimable_until, k.days_remaining, k.claimable
        from public.vendor_claimable_leads(p_tenant_id, p_campaign_id) k
       -- Never a hit a later re-scrub found (see rescrub_numbers below).
       where k.source_type <> 'scrub'
          or (not exists (
                select 1 from public.tenant_campaign_scrub_rejections rs
                 where rs.tenant_id = p_tenant_id and rs.campaign_id = k.campaign_id
                   and rs.source_key like 'scrub:%'
                   and rs.phone_digits = right(regexp_replace(coalesce(k.evidence->>'phone', ''), '[^0-9]', '', 'g'), 10)
              )
              and not exists (
                select 1 from public.tenant_nurture_reactivations nr
                 where nr.tenant_id = p_tenant_id and nr.lead_id = k.lead_id
                   and nr.screening_result_id::text = k.evidence->>'screening_result_id'
              ));
    return;
  end if;

  return query
    with claimed_lead_numbers as (
      -- Numbers already claimed as a lead of a campaign: a removal of that campaign with the same
      -- number is the same person, already asked for.
      select distinct l.campaign_id as cid,
             right(regexp_replace(coalesce(l.values->>'phone', l.values->>'phone_number', l.values->>'primary_phone', ''), '[^0-9]', '', 'g'), 10) as digits
        from public.lead_claim_items i
        join public.agent_leads l on l.id = i.lead_id and l.tenant_id = i.tenant_id
       where i.tenant_id = p_tenant_id
         and i.lead_id is not null
         and (p_campaign_id is null or l.campaign_id = p_campaign_id)
    ),
    claimed_removal_numbers as (
      -- And the other way: a number already claimed as a removal is not asked for again as a lead.
      -- vendor_claimable_leads (20260925703200) applies the same rule; restated here so the two
      -- sources cannot disagree whichever version of it is live.
      select distinct r.campaign_id as cid, r.phone_digits as digits
        from public.lead_claim_items i
        join public.tenant_campaign_scrub_rejections r on r.id = i.scrub_rejection_id and r.tenant_id = i.tenant_id
       where i.tenant_id = p_tenant_id
         and (p_campaign_id is null or r.campaign_id = p_campaign_id)
    ),
    removals as (
      select 'import'::text as src, null::uuid as lid, r.id as rid, r.campaign_id as cid, c.vendor_id as vid,
             c.name as cname, v.name as vname,
             case r.outcome when 'invalid' then 'invalid_phone' else r.outcome end as why,
             r.phone_digits as digits,
             -- The same evidence create_import_removal_claim writes, key for key.
             jsonb_build_object('source', 'import_removal', 'scrub_rejection_id', r.id, 'phone', r.phone_digits,
                                'outcome', r.outcome, 'detail', r.detail, 'source_row', r.source_key,
                                'occurrence', r.occurrence, 'rejected_at', r.rejected_at) as ev,
             r.rejected_at + make_interval(days => v.return_window_days) as until
        from public.tenant_campaign_scrub_rejections r
        join public.tenant_campaigns c on c.id = r.campaign_id and c.tenant_id = r.tenant_id
        join public.tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = r.tenant_id
       where r.tenant_id = p_tenant_id
         and (p_campaign_id is null or r.campaign_id = p_campaign_id)
         and r.outcome in ('tcpa_litigator', 'dnc', 'invalid', 'duplicate_in_file')
         -- The agency's own list is its decision, not the vendor's defect.
         and not (r.outcome = 'dnc' and coalesce(r.detail, '') ~* 'your do-not-call list')
         -- Only a row recorded at import. A later re-scrub's hit ('scrub:<run>', 20260925706100)
         -- went onto the list after the number was bought (20260925707900).
         and coalesce(r.source_key, '') not like 'scrub:%'
         and not exists (
           select 1 from public.lead_claim_items i
            where i.tenant_id = p_tenant_id and i.scrub_rejection_id = r.id
         )
         and not exists (
           select 1 from claimed_lead_numbers n where n.cid = r.campaign_id and n.digits = r.phone_digits
         )
    ),
    rescrub_numbers as (
      -- Numbers a later re-scrub found (20260925706100). A lead whose screening hit came from one is
      -- not claimable; vendor_claimable_leads (20260925707900) says the same, restated here so this
      -- holds whichever version of it is live.
      select distinct rs.campaign_id as cid, rs.phone_digits as digits
        from public.tenant_campaign_scrub_rejections rs
       where rs.tenant_id = p_tenant_id
         and (p_campaign_id is null or rs.campaign_id = p_campaign_id)
         and rs.source_key like 'scrub:%'
    ),
    leads as (
      select 'lead'::text as src, k.lead_id as lid, null::uuid as rid, k.campaign_id as cid, k.vendor_id as vid,
             k.campaign_name as cname, k.vendor_name as vname, k.reason as why,
             right(regexp_replace(coalesce(k.evidence->>'phone', ''), '[^0-9]', '', 'g'), 10) as digits,
             k.evidence as ev, k.claimable_until as until
        from public.vendor_claimable_leads(p_tenant_id, p_campaign_id) k
       where k.source_type <> 'scrub'
          or (not exists (
                select 1 from rescrub_numbers n
                 where n.cid = k.campaign_id
                   and n.digits = right(regexp_replace(coalesce(k.evidence->>'phone', ''), '[^0-9]', '', 'g'), 10)
              )
              -- Nor a hit a nurture reactivation's re-screen stamped on the lead: the reactivation
              -- records the same screening_result_id it wrote onto the lead (20260925707900).
              and not exists (
                select 1 from public.tenant_nurture_reactivations nr
                 where nr.tenant_id = p_tenant_id and nr.lead_id = k.lead_id
                   and nr.screening_result_id::text = k.evidence->>'screening_result_id'
              ))
    ),
    unified as (
      select * from removals
      union all
      -- One number, one claim: offered as the removal when both exist.
      select l.* from leads l
       where l.digits = ''
          or (not exists (select 1 from removals r where r.cid = l.cid and r.digits = l.digits)
              and not exists (select 1 from claimed_removal_numbers n where n.cid = l.cid and n.digits = l.digits))
    )
    select u.src, u.lid, u.rid, u.cid, u.vid, u.cname, u.vname, u.why, u.digits, u.ev, u.until,
           greatest(0, floor(extract(epoch from (u.until - now())) / 86400))::integer,
           u.until > now()
      from unified u
     order by u.until asc, u.cid, u.src, u.digits;
end;
$function$;

create or replace function public.vendor_returns_candidates_summary(
  p_tenant_id uuid,
  p_vendor_id uuid default null,
  p_campaign_id uuid default null
)
returns table(
  campaign_id uuid,
  campaign_name text,
  vendor_id uuid,
  vendor_name text,
  return_window_days integer,
  first_import_at timestamptz,
  unit_cost_cents numeric,
  claimable_rows integer,
  claimable_cents integer,
  expired_rows integer,
  expired_cents integer,
  soonest_closes_at timestamptz,
  days_left integer,
  reasons jsonb
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  with cand as (
    select x.* from public.vendor_return_candidates(p_tenant_id, p_campaign_id) x
     where p_vendor_id is null or x.vendor_id = p_vendor_id
  ),
  camp as (
    select c.id, c.name, c.vendor_id, v.name as vname, coalesce(v.return_window_days, 0) as window_days,
           c.total_spend_cents::numeric / nullif(c.records_purchased, 0) as rate
      from public.tenant_campaigns c
      join public.tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = c.tenant_id
     where c.tenant_id = p_tenant_id
       and c.id in (select distinct cand.campaign_id from cand)
  ),
  first_import as (
    select s.campaign_id as cid, min(s.created_at) as at
      from public.tenant_lead_sources s
     where s.tenant_id = p_tenant_id and s.source_type = 'import'
       and s.campaign_id in (select camp.id from camp)
     group by s.campaign_id
  ),
  per_reason as (
    select cand.campaign_id as cid, cand.reason, cand.source,
           count(*) filter (where cand.claimable)::integer as claimable_rows,
           count(*) filter (where not cand.claimable)::integer as expired_rows,
           min(cand.claimable_until) filter (where cand.claimable) as soonest
      from cand
     group by cand.campaign_id, cand.reason, cand.source
  ),
  per_campaign as (
    select p.cid,
           sum(p.claimable_rows)::integer as claimable_rows,
           sum(p.expired_rows)::integer as expired_rows,
           min(p.soonest) as soonest,
           jsonb_agg(jsonb_build_object(
             'reason', p.reason, 'source', p.source,
             'claimable_rows', p.claimable_rows,
             'claimable_cents', round(p.claimable_rows * coalesce(c.rate, 0))::integer,
             'expired_rows', case when c.window_days > 0 then p.expired_rows else 0 end,
             'expired_cents', case when c.window_days > 0 then round(p.expired_rows * coalesce(c.rate, 0))::integer else 0 end,
             'soonest_closes_at', p.soonest
           ) order by p.reason, p.source) as reasons
      from per_reason p
      join camp c on c.id = p.cid
     group by p.cid
  )
  select c.id, c.name, c.vendor_id, c.vname, c.window_days, f.at, c.rate,
         pc.claimable_rows,
         -- The amount the combined claim would ask for with every reason on: rows x rate, rounded once.
         round(pc.claimable_rows * coalesce(c.rate, 0))::integer,
         case when c.window_days > 0 then pc.expired_rows else 0 end,
         case when c.window_days > 0 then round(pc.expired_rows * coalesce(c.rate, 0))::integer else 0 end,
         pc.soonest,
         case when pc.soonest is null then null
              else greatest(0, floor(extract(epoch from (pc.soonest - now())) / 86400))::integer end,
         pc.reasons
    from per_campaign pc
    join camp c on c.id = pc.cid
    left join first_import f on f.cid = c.id
   where pc.claimable_rows > 0 or (c.window_days > 0 and pc.expired_rows > 0)
   order by pc.soonest asc nulls last, c.vname, c.name;
$function$;

create or replace function public.create_combined_vendor_return_claim(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_created_by uuid default null,
  p_reasons text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_allowed constant text[] := array['wrong_number', 'disconnected', 'dnc', 'tcpa_litigator', 'invalid_phone', 'duplicate_in_file'];
  v_vendor uuid;
  v_rate numeric;
  v_claim uuid;
  v_rows integer;
  v_lead_rows integer;
  v_removal_rows integer;
  v_amount integer;
  v_claim_reason text;
begin
  if p_reasons is not null then
    if cardinality(p_reasons) = 0 then raise exception 'LEAD_CLAIM_NO_REASON_CHOSEN'; end if;
    if not (p_reasons <@ v_allowed) then raise exception 'LEAD_CLAIM_REASON_INVALID'; end if;
  end if;

  -- Locked, as create_import_removal_claim locks it, so two presses (or this and the lead list's
  -- Claim button) cannot both draft the same rows.
  select c.vendor_id, c.total_spend_cents::numeric / nullif(c.records_purchased, 0)
    into v_vendor, v_rate
    from public.tenant_campaigns c
   where c.id = p_campaign_id and c.tenant_id = p_tenant_id
     for update of c;
  if not found then raise exception 'LEAD_CLAIM_CAMPAIGN_NOT_FOUND'; end if;
  if v_rate is null then raise exception 'LEAD_CLAIM_CAMPAIGN_HAS_NO_UNIT_COST'; end if;

  create temporary table if not exists pg_temp.combined_claim_rows (
    source text, lead_id uuid, scrub_rejection_id uuid, reason text, evidence jsonb
  ) on commit drop;
  truncate pg_temp.combined_claim_rows;

  insert into pg_temp.combined_claim_rows (source, lead_id, scrub_rejection_id, reason, evidence)
  select k.source, k.lead_id, k.scrub_rejection_id, k.reason, k.evidence
    from public.vendor_return_candidates(p_tenant_id, p_campaign_id) k
   where k.claimable
     and (p_reasons is null or k.reason = any (p_reasons));

  select count(*)::integer,
         count(*) filter (where x.source = 'lead')::integer,
         count(*) filter (where x.source = 'import')::integer,
         case when count(distinct x.reason) = 1 then min(x.reason) else 'mixed' end
    into v_rows, v_lead_rows, v_removal_rows, v_claim_reason
    from pg_temp.combined_claim_rows x;
  if v_rows = 0 then raise exception 'LEAD_CLAIM_NO_CLAIMABLE_LEADS'; end if;
  v_amount := round(v_rows * v_rate)::integer;

  insert into public.lead_claims (tenant_id, campaign_id, vendor_id, reason, lead_count, amount_claimed_cents, created_by)
  values (p_tenant_id, p_campaign_id, v_vendor, v_claim_reason, v_rows, v_amount, p_created_by)
  returning id into v_claim;

  insert into public.lead_claim_items (claim_id, tenant_id, lead_id, reason, evidence)
  select v_claim, p_tenant_id, x.lead_id, x.reason, x.evidence
    from pg_temp.combined_claim_rows x
   where x.source = 'lead';

  -- Only reached when removals exist, which needs 20260925703200's scrub_rejection_id.
  if v_removal_rows > 0 then
    insert into public.lead_claim_items (claim_id, tenant_id, lead_id, scrub_rejection_id, reason, evidence)
    select v_claim, p_tenant_id, null, x.scrub_rejection_id, x.reason, x.evidence
      from pg_temp.combined_claim_rows x
     where x.source = 'import';
  end if;

  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, reason, metadata)
  values ('tenant', p_created_by, 'tenant.vendor_claim_drafted', 'lead_claim', v_claim::text, null,
          jsonb_build_object(
            'tenantId', p_tenant_id,
            'campaign_id', p_campaign_id,
            'vendor_id', v_vendor,
            'claim_id', v_claim,
            'rows', v_rows,
            'lead_rows', v_lead_rows,
            'removal_rows', v_removal_rows,
            'amount_claimed_cents', v_amount,
            'reasons', coalesce(to_jsonb(p_reasons), '"all"'::jsonb)));

  return jsonb_build_object('claim_id', v_claim, 'rows', v_rows, 'lead_rows', v_lead_rows,
                            'removal_rows', v_removal_rows, 'amount_claimed_cents', v_amount);
end;
$function$;

revoke all on function public.vendor_return_candidates(uuid, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.vendor_returns_candidates_summary(uuid, uuid, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.create_combined_vendor_return_claim(uuid, uuid, uuid, text[]) from public, anon, authenticated, tenant_app;
grant execute on function public.vendor_return_candidates(uuid, uuid) to service_role;
grant execute on function public.vendor_returns_candidates_summary(uuid, uuid, uuid) to service_role;
grant execute on function public.create_combined_vendor_return_claim(uuid, uuid, uuid, text[]) to service_role;

-- ── proof ──────────────────────────────────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_summary_rows bigint;
  v_candidate_rows bigint;
  v_bad integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925707500: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if to_regprocedure('public.vendor_return_candidates(uuid, uuid)') is null
     or to_regprocedure('public.vendor_returns_candidates_summary(uuid, uuid, uuid)') is null
     or to_regprocedure('public.create_combined_vendor_return_claim(uuid, uuid, uuid, text[])') is null then
    raise exception '20260925707500: a vendor returns function did not land';
  end if;
  if has_function_privilege('tenant_app', 'public.create_combined_vendor_return_claim(uuid, uuid, uuid, text[])', 'execute')
     or has_function_privilege('anon', 'public.vendor_returns_candidates_summary(uuid, uuid, uuid)', 'execute') then
    raise exception '20260925707500: vendor returns functions must be service-role only';
  end if;
  -- The removal filter is Pool's, word for word where it matters.
  if strpos(pg_get_functiondef('public.vendor_return_candidates(uuid, uuid)'::regprocedure), 'your do-not-call list') = 0 then
    raise exception '20260925707500: own-list DNC hits would be claimed against the vendor';
  end if;
  if to_regprocedure('public.create_import_removal_claim(uuid, uuid, uuid, text)') is not null
     and strpos(pg_get_functiondef('public.create_import_removal_claim(uuid, uuid, uuid, text)'::regprocedure), 'your do-not-call list') = 0 then
    raise exception '20260925707500: create_import_removal_claim no longer excludes own-list DNC — the two filters disagree';
  end if;

  -- The summary is the candidates, counted: nothing added, nothing lost, dollars = rows x rate.
  select c.tenant_id into v_tenant
    from public.tenant_campaigns c
   where c.records_purchased > 0
   limit 1;
  if v_tenant is null then
    raise notice '20260925707500: behavioural check skipped, no vendor campaign in this database';
    return;
  end if;
  select coalesce(sum(s.claimable_rows), 0) into v_summary_rows from public.vendor_returns_candidates_summary(v_tenant) s;
  select count(*) into v_candidate_rows from public.vendor_return_candidates(v_tenant) k where k.claimable;
  if v_summary_rows <> v_candidate_rows then
    raise exception '20260925707500: summary counts % claimable rows, candidates %', v_summary_rows, v_candidate_rows;
  end if;
  select count(*) into v_bad from public.vendor_returns_candidates_summary(v_tenant) s
   where s.claimable_cents <> round(s.claimable_rows * coalesce(s.unit_cost_cents, 0));
  if v_bad > 0 then
    raise exception '20260925707500: % campaign(s) whose claimable dollars are not rows x purchased rate', v_bad;
  end if;
  raise notice '20260925707500: % claimable row(s) for the first vendor tenant, summary agrees', v_candidate_rows;
end $$;
