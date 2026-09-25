-- ---------------------------------------------------------------------------
-- Vendor returns · a row removed at import can be claimed in the ledger, not only exported
--
-- User decision (2026-09-25, Pool concept audit): the rows the scrub removed at import go into the
-- claim ledger. Until now they could only be downloaded as a CSV (Export claimable rows): the
-- ledger's item row required a lead, and a removed row never became one — it is evidence in
-- tenant_campaign_scrub_rejections, not a lead.
--
--   lead_claim_items      lead_id becomes nullable; a new scrub_rejection_id points at the ledger
--                         row instead. Exactly one of the two is set. A removed row can be on one
--                         claim at most (partial unique index). Reason widened with
--                         'duplicate_in_file' (20260925703100), here and on lead_claims.
--   enforce_lead_claim_item_tenant   restated from 20260913440000: a removal item must belong to
--                         the claim's tenant and campaign, exactly as a lead item must.
--   vendor_claimable_leads           restated from 20260913440000 with two more exclusions:
--                         · a lead whose number is already claimed as an import removal of the same
--                           campaign is not offered again (a DNC row imported-and-suppressed is
--                           both a lead and a ledger row — one number, one claim);
--                         · a hit on the agency's OWN do-not-call list (screening outcome 'dnc'
--                           with no screening result) is not offered at all — the Returns audit
--                           found the lead-based branch charging them to the vendor, against the
--                           lead-list rule. Only a registry hit, which has a screening result, is.
--   create_import_removal_claim(tenant, campaign, actor, reason?)   drafts a claim from the
--                         campaign's creditable, unclaimed removals still inside the vendor's
--                         return window, at the same per-record rate create_vendor_return_claim
--                         uses, and writes one audit row. The claim is a normal draft: it is
--                         submitted and resolved through the existing update_vendor_return_claim.
--
-- Creditable is the lead-list screen's rule (lib/leadLists/detail.ts CREDITABLE): TCPA litigator,
-- registry DNC, invalid, and a repeat inside the file. A hit on the agency's OWN do-not-call list
-- is the agency's decision, not the vendor's defect, and is never claimed; the ledger records it as
-- 'dnc' with the screening sentence "…on your do-not-call list…", which is how it is told apart.
--
-- The existing lead-based flows (create_vendor_return_claim, vendor_returns_report,
-- vendor_return_claim_detail, update_vendor_return_claim) keep their signatures and behaviour.
-- ---------------------------------------------------------------------------

alter table public.lead_claim_items alter column lead_id drop not null;

alter table public.lead_claim_items
  add column if not exists scrub_rejection_id uuid references public.tenant_campaign_scrub_rejections(id);

do $$
declare
  v_name text;
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.lead_claim_items'::regclass and conname = 'lead_claim_items_subject_check') then
    alter table public.lead_claim_items
      add constraint lead_claim_items_subject_check check (num_nonnulls(lead_id, scrub_rejection_id) = 1);
  end if;

  -- The reason checks, whatever they were named when the tables were created.
  for v_name in
    select c.conname from pg_constraint c
     where c.conrelid = 'public.lead_claim_items'::regclass and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ~ 'reason' and c.conname <> 'lead_claim_items_reason_check_v2'
  loop
    execute format('alter table public.lead_claim_items drop constraint %I', v_name);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.lead_claim_items'::regclass and conname = 'lead_claim_items_reason_check_v2') then
    alter table public.lead_claim_items add constraint lead_claim_items_reason_check_v2
      check (reason in ('wrong_number', 'disconnected', 'dnc', 'tcpa_litigator', 'invalid_phone', 'duplicate_in_file'));
  end if;

  for v_name in
    select c.conname from pg_constraint c
     where c.conrelid = 'public.lead_claims'::regclass and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ~ '''mixed''' and c.conname <> 'lead_claims_reason_check_v2'
  loop
    execute format('alter table public.lead_claims drop constraint %I', v_name);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.lead_claims'::regclass and conname = 'lead_claims_reason_check_v2') then
    alter table public.lead_claims add constraint lead_claims_reason_check_v2
      check (reason in ('mixed', 'wrong_number', 'disconnected', 'dnc', 'tcpa_litigator', 'invalid_phone', 'duplicate_in_file'));
  end if;
end $$;

create unique index if not exists lead_claim_items_scrub_rejection_key
  on public.lead_claim_items (tenant_id, scrub_rejection_id)
  where scrub_rejection_id is not null;

-- ── an item belongs to its claim's tenant and campaign ─────────────────────
create or replace function public.enforce_lead_claim_item_tenant()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_claim_tenant uuid;
  v_claim_campaign uuid;
  v_claim_vendor uuid;
  v_lead_tenant uuid;
  v_lead_campaign uuid;
  v_campaign_vendor uuid;
begin
  select tenant_id, campaign_id, vendor_id into v_claim_tenant, v_claim_campaign, v_claim_vendor
    from lead_claims where id = new.claim_id;
  -- A lead item is checked against the lead; a removal item against the ledger row. Both carry a
  -- tenant and a campaign, and the check is the same one.
  if new.scrub_rejection_id is not null then
    select tenant_id, campaign_id into v_lead_tenant, v_lead_campaign
      from tenant_campaign_scrub_rejections where id = new.scrub_rejection_id;
  else
    select tenant_id, campaign_id into v_lead_tenant, v_lead_campaign
      from agent_leads where id = new.lead_id;
  end if;
  select vendor_id into v_campaign_vendor from tenant_campaigns where id = v_claim_campaign;
  if v_claim_tenant is null or v_lead_tenant is distinct from new.tenant_id
     or v_claim_tenant is distinct from new.tenant_id
     or v_lead_campaign is distinct from v_claim_campaign
     or v_campaign_vendor is distinct from v_claim_vendor then
    raise exception 'LEAD_CLAIM_ITEM_TENANT_MISMATCH';
  end if;
  if tg_op = 'UPDATE' and (old.claim_id is distinct from new.claim_id or old.lead_id is distinct from new.lead_id
                           or old.scrub_rejection_id is distinct from new.scrub_rejection_id
                           or old.tenant_id is distinct from new.tenant_id) then
    raise exception 'LEAD_CLAIM_ITEM_ATTRIBUTION_IMMUTABLE';
  end if;
  return new;
end;
$function$;

-- ── the lead-based candidates, minus numbers already claimed as removals ────
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

-- ── drafting a claim from the import removals ──────────────────────────────
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
    raise notice '20260925703200: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'lead_claim_items' and column_name = 'scrub_rejection_id') then
    raise exception '20260925703200: lead_claim_items.scrub_rejection_id was not added';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'lead_claim_items' and column_name = 'lead_id' and is_nullable = 'NO') then
    raise exception '20260925703200: lead_claim_items.lead_id is still not null';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.lead_claim_items'::regclass and conname = 'lead_claim_items_subject_check') then
    raise exception '20260925703200: an item must name exactly one of a lead or a removal';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'lead_claim_items_scrub_rejection_key') then
    raise exception '20260925703200: a removal could be claimed twice';
  end if;
  if to_regprocedure('public.create_import_removal_claim(uuid, uuid, uuid, text)') is null then
    raise exception '20260925703200: create_import_removal_claim was not created';
  end if;
  if has_function_privilege('anon', 'public.create_import_removal_claim(uuid, uuid, uuid, text)', 'execute')
     or has_function_privilege('tenant_app', 'public.create_import_removal_claim(uuid, uuid, uuid, text)', 'execute') then
    raise exception '20260925703200: create_import_removal_claim must be service-role only';
  end if;
  if strpos(pg_get_functiondef('public.vendor_claimable_leads(uuid, uuid)'::regprocedure), 'scrub_rejection_id') = 0 then
    raise exception '20260925703200: vendor_claimable_leads does not exclude numbers claimed as removals';
  end if;
  if strpos(pg_get_functiondef('public.vendor_claimable_leads(uuid, uuid)'::regprocedure),
            'and not (coalesce(sr.outcome, l.screening_outcome) = ''dnc'' and l.screening_result_id is null)') = 0 then
    raise exception '20260925703200: vendor_claimable_leads offers hits on the agency''s own do-not-call list to the vendor';
  end if;
  if strpos(pg_get_functiondef('public.vendor_claimable_leads(uuid, uuid)'::regprocedure), '''wrong_number'', ''disconnected''') = 0 then
    raise exception '20260925703200: vendor_claimable_leads lost the wrong-number / disconnected branch';
  end if;
  if strpos(pg_get_functiondef('public.create_import_removal_claim(uuid, uuid, uuid, text)'::regprocedure), 'your do-not-call list') = 0 then
    raise exception '20260925703200: create_import_removal_claim claims hits on the agency''s own list';
  end if;
end $$;
