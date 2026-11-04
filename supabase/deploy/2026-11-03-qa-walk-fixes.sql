-- QA walk fixes, 2026-11-03: four migrations in one paste, in order. Each checks itself and fails loudly.
-- Paste the whole file into the Supabase SQL editor and run it once.

-- ════════ 20261103300000_same_day_commission_statements.sql ════════
-- QA 2026-11-03 · two commission statements from one carrier on the same day are two statements.
--
-- register_carrier_file kept one current file per carrier, type and day (file_registry_current_key), so a
-- second American Amicable commission statement dated Nov 3 silently replaced the first and took its lines
-- out of the books. Policy files keep that rule (a day's policy file is one snapshot of the book). Commission
-- files may now have several current files on one day:
--
--   · file_registry_current_key covers every type but commissions;
--   · register_carrier_file takes p_replace (default true, so the bucket and email doors read exactly as
--     before). With p_replace = false a commission file is added beside the day's others; with true (the
--     upload door's "Yes, it replaces it", and "Replace with a corrected file") it replaces the day's newest.
--
-- The upload door (app/api/app/carrier-files) asks the person before it sends p_replace = true.
--
-- Rollback (only while no day has two current commission files):
--   drop function if exists public.register_carrier_file(uuid, uuid, text, date, text, text, text, text, bigint, text, text, text, uuid, text, text, text, text, boolean);
--   re-run section 1 of 20261009210000_la_4_e2e_fixes.sql (the 17-argument function) and its grants;
--   drop index if exists public.file_registry_current_key;
--   create unique index file_registry_current_key on public.file_registry (tenant_id, carrier_id, file_type, file_date, coalesce(path_agency, ''))
--     where superseded_by_file_id is null and carrier_id is not null and file_type is not null and file_date is not null;

-- ─── 1. one current file per day, except commission statements ─────────────────────────────────────────
drop index if exists public.file_registry_current_key;
create unique index file_registry_current_key
  on public.file_registry (tenant_id, carrier_id, file_type, file_date, coalesce(path_agency, ''))
  where superseded_by_file_id is null and carrier_id is not null and file_type is not null and file_date is not null
    and file_type <> 'commissions';
-- The lookup the commission path still makes (the day's newest current file) keeps an index.
create index if not exists file_registry_current_commissions_idx
  on public.file_registry (tenant_id, carrier_id, file_date, received_at desc)
  where superseded_by_file_id is null and file_type = 'commissions';

-- ─── 2. register_carrier_file with p_replace ────────────────────────────────────────────────────────────
-- A new argument is a new signature: the 17-argument function goes, so PostgREST sees one candidate.
drop function if exists public.register_carrier_file(uuid, uuid, text, date, text, text, text, text, bigint, text, text, text, uuid, text, text, text, text);

create or replace function public.register_carrier_file(
  p_tenant_id uuid,
  p_carrier_id uuid,
  p_file_type text,
  p_file_date date,
  p_path_agency text,
  p_original_filename text,
  p_storage_path text,
  p_content_hash text,
  p_file_bytes bigint,
  p_content_type text,
  p_file_kind text,
  p_source text,
  p_uploaded_by uuid,
  p_status text,
  p_error_detail text,
  p_email_from text,
  p_email_message_id text,
  p_replace boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.file_registry%rowtype;
  v_current uuid;
  v_new uuid := gen_random_uuid();
  v_skip uuid;
  v_type text;
begin
  if p_status not in ('received', 'failed') then
    raise exception 'A file is registered as received or failed.' using errcode = '22023';
  end if;

  -- One registration at a time per agency: dedup and reissue read and then write.
  perform pg_advisory_xact_lock(hashtextextended('file_registry:' || p_tenant_id::text, 0));

  select * into v_existing from public.file_registry
   where tenant_id = p_tenant_id and content_hash = p_content_hash;
  if v_existing.id is not null then
    -- The same bytes back in the bucket after they were removed: the same file, restored.
    if p_source = 'bucket' and v_existing.source = 'bucket' and v_existing.removed_from_bucket_at is not null then
      update public.file_registry
         set storage_path = p_storage_path, removed_from_bucket_at = null, restored_at = now()
       where id = v_existing.id;
      return jsonb_build_object('outcome', 'restored', 'file_id', v_existing.id);
    end if;
    -- The same bytes, now with their carrier, after the first copy failed only for want of one (an
    -- email from an unknown sender): that file is told its carrier, type and day and read like a new
    -- arrival, instead of every later copy being skipped as its duplicate (20261009210000).
    if v_existing.carrier_id is null and v_existing.status = 'failed' and v_existing.raw_extracted_at is null
       and p_carrier_id is not null and p_file_type is not null and p_file_date is not null and p_status = 'received' then
      if p_replace or p_file_type <> 'commissions' then
        select id into v_current from public.file_registry
         where tenant_id = p_tenant_id and carrier_id = p_carrier_id and file_type = p_file_type
           and file_date = p_file_date and coalesce(path_agency, '') = coalesce(v_existing.path_agency, '')
           and superseded_by_file_id is null
         order by received_at desc
         limit 1
         for update;
        if v_current is not null then
          update public.file_registry
             set superseded_by_file_id = v_existing.id, superseded_at = now(), status = 'superseded'
           where id = v_current;
        end if;
      end if;
      update public.file_registry
         set carrier_id = p_carrier_id, file_type = p_file_type, file_date = p_file_date,
             file_kind = coalesce(file_kind, p_file_kind), status = 'received', error_detail = null
       where id = v_existing.id;
      -- A bucket drop leaves its own object behind: remember it, so the bucket is not read twice.
      if p_source = 'bucket' then
        insert into public.file_registry_skips (tenant_id, original_file_id, content_hash, source, original_filename, storage_path, uploaded_by, email_from)
        values (p_tenant_id, v_existing.id, p_content_hash, p_source, p_original_filename, p_storage_path, p_uploaded_by, p_email_from)
        on conflict (storage_path) where storage_path is not null do nothing;
      end if;
      return jsonb_build_object('outcome', 'registered', 'file_id', v_existing.id, 'superseded_file_id', v_current,
                                'attributed', true, 'storage_path', v_existing.storage_path);
    end if;
    insert into public.file_registry_skips (tenant_id, original_file_id, content_hash, source, original_filename, storage_path, uploaded_by, email_from)
    -- Only a bucket drop leaves an object behind to remember; the other doors check before storing.
    values (p_tenant_id, v_existing.id, p_content_hash, p_source, p_original_filename,
            case when p_source = 'bucket' then p_storage_path end,
            p_uploaded_by, p_email_from)
    on conflict (storage_path) where storage_path is not null do nothing
    returning id into v_skip;
    return jsonb_build_object('outcome', 'skipped', 'file_id', v_existing.id, 'skip_id', v_skip);
  end if;

  v_type := p_file_type;
  -- One current file per carrier, type and day for each agency (the path's agency folder) — except a
  -- commission statement the person said is a different one (p_replace = false), which sits beside it.
  if p_carrier_id is not null and v_type is not null and p_file_date is not null and (p_replace or v_type <> 'commissions') then
    select id into v_current from public.file_registry
     where tenant_id = p_tenant_id and carrier_id = p_carrier_id and file_type = v_type
       and file_date = p_file_date and coalesce(path_agency, '') = coalesce(p_path_agency, '')
       and superseded_by_file_id is null
     order by received_at desc
     limit 1
     for update;
    if v_current is not null then
      -- The pointer first (the foreign key is deferred), so the current-file index never sees two.
      update public.file_registry
         set superseded_by_file_id = v_new, superseded_at = now(), status = 'superseded'
       where id = v_current;
    end if;
  end if;

  insert into public.file_registry (
    id, tenant_id, path_agency, carrier_id, file_type, file_date, original_filename, storage_path,
    content_hash, file_bytes, content_type, file_kind, status, error_detail, source, uploaded_by,
    email_from, email_message_id
  ) values (
    v_new, p_tenant_id, p_path_agency, p_carrier_id, p_file_type, p_file_date, p_original_filename, p_storage_path,
    p_content_hash, p_file_bytes, p_content_type, p_file_kind, p_status, p_error_detail, p_source, p_uploaded_by,
    p_email_from, p_email_message_id
  );

  return jsonb_build_object('outcome', 'registered', 'file_id', v_new, 'superseded_file_id', v_current);
end;
$$;

revoke all on function public.register_carrier_file(uuid, uuid, text, date, text, text, text, text, bigint, text, text, text, uuid, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.register_carrier_file(uuid, uuid, text, date, text, text, text, text, bigint, text, text, text, uuid, text, text, text, text, boolean) to service_role;

-- ─── check ──────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_def text := pg_get_indexdef('public.file_registry_current_key'::regclass);
begin
  if position('commissions' in v_def) = 0 then
    raise exception '20261103300000: file_registry_current_key still covers commission files';
  end if;
  if (select count(*) from pg_proc where proname = 'register_carrier_file' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception '20261103300000: register_carrier_file has more than one signature';
  end if;
  if position('p_replace' in pg_get_functiondef('public.register_carrier_file(uuid, uuid, text, date, text, text, text, text, bigint, text, text, text, uuid, text, text, text, text, boolean)'::regprocedure)) = 0 then
    raise exception '20261103300000: register_carrier_file does not take p_replace';
  end if;
  if has_function_privilege('authenticated', 'public.register_carrier_file(uuid, uuid, text, date, text, text, text, text, bigint, text, text, text, uuid, text, text, text, text, boolean)', 'EXECUTE') then
    raise exception '20261103300000: register_carrier_file is callable by authenticated';
  end if;
end;
$$;

-- ════════ 20261103301000_discrepancy_accepted_resolution.sql ════════
-- QA 2026-11-03 · "The client cancelled — the chargeback is right" is its own resolution.
--
-- A person could only dismiss a finding ('dismissed') or settle it ('resolved_by_person'). Accepting a
-- chargeback (the client really cancelled) was saved as dismissed with the reason in the note. Now
-- set_discrepancy_status takes 'accepted': the finding closes with status 'dismissed' (so the detection run
-- never reopens it while the files keep showing the chargeback) and resolution 'accepted', which the
-- Closed view and reports can tell apart from a write-off. The resolution column has no value check, so
-- only the function changes. Same signature: create or replace.
--
-- Rollback: re-run set_discrepancy_status from 20261008250000_la_4_15_commission_discrepancies.sql.

create or replace function public.set_discrepancy_status(p_tenant_id uuid, p_id uuid, p_user_id uuid, p_status text, p_note text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('open', 'dismissed', 'resolved', 'accepted') then
    raise exception 'set_discrepancy_status: a person opens, dismisses, accepts or resolves' using errcode = '22023';
  end if;
  update public.commission_discrepancy set status = case p_status when 'accepted' then 'dismissed' else p_status end,
         resolution = case p_status when 'open' then null when 'dismissed' then 'dismissed' when 'accepted' then 'accepted' else 'resolved_by_person' end,
         resolution_note = case when p_status = 'open' then null else nullif(btrim(coalesce(p_note, '')), '') end,
         resolved_by = case when p_status = 'open' then null else p_user_id end,
         resolved_at = case when p_status = 'open' then null else now() end
   where id = p_id and tenant_id = p_tenant_id and status <> 'disputed';
  return found;
end;
$$;

revoke all on function public.set_discrepancy_status(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_discrepancy_status(uuid, uuid, uuid, text, text) to service_role;

do $$
begin
  if position('''accepted''' in pg_get_functiondef('public.set_discrepancy_status(uuid, uuid, uuid, text, text)'::regprocedure)) = 0 then
    raise exception '20261103301000: set_discrepancy_status does not take accepted';
  end if;
end;
$$;

-- ════════ 20261103302000_sale_linked_policy_producer.sql ════════
-- QA 2026-11-03 · a policy linked to a sale names the sale's producer, so a different writing number is asked about.
--
-- agency_entry_candidates gives a commission row two candidates: the writing number's producer and the
-- application's (whoever opened the case). A policy a person linked to a SALE (policy_match deal_flow, no
-- application) had no second candidate, so "Carrier pays Devin Okafor · sold by Demo Agent" never became a
-- "Who gets the credit" item. The application's candidate now falls back to the producer who worked the sale
-- (deal_flow.worked_by) of the policy's current link. Same signature: create or replace.
--
-- Rollback: re-run agency_entry_candidates from 20261018200000_ag_1_4_statement_attribution.sql.

create or replace function public.agency_entry_candidates(p_tenant_id uuid, p_entry_id uuid)
returns table(writing_number_user_id uuid, application_user_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    -- 1. the writing number, mapped now (a number mapped after the row was written still counts)
    coalesce(e.agent_user_id,
             (select m.user_id from public.carrier_agent_map m
               where m.tenant_id = e.tenant_id and m.carrier_id = e.carrier_id and m.agent_identifier = e.agent_identifier)),
    -- 2. the application record: whoever opened the case the policy came from
    coalesce(
      (select c.opened_by from public.policy_current pc join public.tenant_application_cases c on c.id = pc.case_id
        where pc.tenant_id = e.tenant_id and pc.carrier_id = e.carrier_id and pc.policy_number = e.policy_number),
      (select c.opened_by from public.policy_current pc join public.tenant_applications a on a.id = pc.application_id
         join public.tenant_application_cases c on c.id = a.case_id
        where pc.tenant_id = e.tenant_id and pc.carrier_id = e.carrier_id and pc.policy_number = e.policy_number),
      -- 2b (20261103302000). no application: the producer who worked the sale the policy is linked to
      (select d.worked_by from public.policy_match pm join public.deal_flow d on d.id = pm.matched_to_id and d.tenant_id = pm.tenant_id
        where pm.tenant_id = e.tenant_id and pm.carrier_id = e.carrier_id and pm.policy_number = e.policy_number
          and pm.superseded_by_id is null and pm.matched_to_type = 'deal_flow'))
    from public.commission_entry e
   where e.tenant_id = p_tenant_id and e.id = p_entry_id;
$$;

revoke all on function public.agency_entry_candidates(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agency_entry_candidates(uuid, uuid) to service_role;

do $$
begin
  if position('deal_flow' in pg_get_functiondef('public.agency_entry_candidates(uuid, uuid)'::regprocedure)) = 0 then
    raise exception '20261103302000: agency_entry_candidates does not read the sale';
  end if;
end;
$$;

-- ════════ 20261103303000_commission_orphan_policies.sql ════════
-- QA 2026-11-03 · commission paid on a policy we don't have, one row per policy.
--
-- Needs you raises "Paid on a policy we don't have" for a commission line whose policy no policy file has
-- yet, once it has waited ORPHAN_NOTICE_DAYS (lib/needsYou/kinds.ts). commission_orphan_summary counts them
-- per carrier only, so the app read every commission line and every known policy of each such carrier on
-- every Needs-you load. This view gives the per-policy rows the summary is built from, so the app reads only
-- the orphans. security_invoker, as the summary: RLS on commission_entry still applies.
--
-- Rollback: drop view if exists public.commission_orphan_policies;

create or replace view public.commission_orphan_policies
with (security_invoker = true) as
select e.tenant_id, e.carrier_id, e.policy_number,
       min(coalesce(e.transaction_date, e.statement_date, e.created_at::date)) as first_seen,
       count(*)::bigint as lines,
       coalesce(sum(e.amount_cents) filter (where coalesce(e.corrects_type, e.entry_type) <> 'held'), 0)::bigint as amount_cents,
       coalesce(sum(e.amount_cents) filter (where coalesce(e.corrects_type, e.entry_type) = 'held'), 0)::bigint as held_cents,
       array_agg(distinct e.agent_identifier) filter (where e.agent_identifier is not null) as agent_identifiers,
       array_agg(distinct e.file_id) filter (where e.file_id is not null) as file_ids
  from public.commission_entry e
 where e.policy_number is not null
   and not exists (select 1 from public.policy_current pc
                    where pc.tenant_id = e.tenant_id and pc.carrier_id = e.carrier_id and pc.policy_number = e.policy_number)
 group by e.tenant_id, e.carrier_id, e.policy_number;

revoke all on public.commission_orphan_policies from public, anon, authenticated;
grant select on public.commission_orphan_policies to service_role, tenant_app;

do $$
begin
  if to_regclass('public.commission_orphan_policies') is null then
    raise exception '20261103303000: commission_orphan_policies was not created';
  end if;
end;
$$;

