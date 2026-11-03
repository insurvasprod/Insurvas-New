-- ---------------------------------------------------------------------------
-- Scrub ledger · a number repeated inside one file is a removed, claimable row
--
-- User decision (2026-09-25, Pool concept audit): duplicates INSIDE THE SAME FILE are not usable
-- and ARE claimable — the vendor billed the same person twice. Duplicates of a lead the agency
-- already had stay usable and are not claimable (the import attaches the campaign to that lead).
--
-- Until now the ledger could not hold them, for two reasons:
--
--   1. The outcome check allowed only ('dnc', 'tcpa_litigator', 'invalid', 'suppressed').
--      Widened with 'duplicate_in_file'.
--
--   2. The ledger was unique on (tenant, campaign, phone). A number that appears three times has
--      TWO repeats, both billed, and a phone-level key can hold one. So each row now carries an
--      `occurrence`: 1 for every existing outcome (unchanged — the same number is still recorded
--      once per campaign, which is what stops a retried import from billing the vendor twice), and
--      2, 3, … for the second, third, … appearance of a number inside a file. The key becomes
--      (tenant, campaign, phone, occurrence). Re-importing the same file produces the same
--      occurrences, so it is still idempotent on the fact itself.
--
-- record_campaign_scrub_rejections is restated from its only definition (20260917140000) with the
-- occurrence read from the payload — forced to 1 for every outcome but a duplicate, so no caller
-- can use it to record the same DNC number twice — and the conflict target moved to the new key.
-- Same signature, same grants (service role only).
--
-- tenant_campaign_costs needs no change: records_usable is purchased minus count(*) of ledger rows,
-- so each recorded repeat lowers the usable count by one from the day this is applied. Earlier
-- imports are not backfilled — the files are not kept — which is why the lead-list screen says
-- from when repeats are counted.
-- ---------------------------------------------------------------------------

alter table public.tenant_campaign_scrub_rejections
  add column if not exists occurrence integer not null default 1;

do $$
declare
  v_name text;
begin
  -- The occurrence is a small positive count; a file is at most 20,000 rows (MAX_LEAD_IMPORT_ROWS).
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tenant_campaign_scrub_rejections'::regclass
       and conname = 'tenant_campaign_scrub_rejections_occurrence_check'
  ) then
    alter table public.tenant_campaign_scrub_rejections
      add constraint tenant_campaign_scrub_rejections_occurrence_check check (occurrence between 1 and 20000);
  end if;

  -- The outcome check, whatever it was named when the table was created.
  for v_name in
    select c.conname from pg_constraint c
     where c.conrelid = 'public.tenant_campaign_scrub_rejections'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ~ 'outcome'
       and c.conname not in ('tenant_campaign_scrub_rejections_outcome_check_v2',
                             'tenant_campaign_scrub_rejections_occurrence_outcome_check')
  loop
    execute format('alter table public.tenant_campaign_scrub_rejections drop constraint %I', v_name);
  end loop;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tenant_campaign_scrub_rejections'::regclass
       and conname = 'tenant_campaign_scrub_rejections_outcome_check_v2'
  ) then
    alter table public.tenant_campaign_scrub_rejections
      add constraint tenant_campaign_scrub_rejections_outcome_check_v2
      check (outcome in ('dnc', 'tcpa_litigator', 'invalid', 'suppressed', 'duplicate_in_file'));
  end if;
  -- Only a duplicate may be a second or later occurrence.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tenant_campaign_scrub_rejections'::regclass
       and conname = 'tenant_campaign_scrub_rejections_occurrence_outcome_check'
  ) then
    alter table public.tenant_campaign_scrub_rejections
      add constraint tenant_campaign_scrub_rejections_occurrence_outcome_check
      check (occurrence = 1 or outcome = 'duplicate_in_file');
  end if;

  -- The phone-level key, whatever it was named, is replaced by the occurrence-level one.
  for v_name in
    select c.conname from pg_constraint c
     where c.conrelid = 'public.tenant_campaign_scrub_rejections'::regclass
       and c.contype = 'u'
       and c.conname <> 'tenant_campaign_scrub_rejections_occurrence_key'
       and (select array_agg(a.attname::text order by a.attname)
              from unnest(c.conkey) k(attnum)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum)
           = array['campaign_id', 'phone_digits', 'tenant_id']
  loop
    execute format('alter table public.tenant_campaign_scrub_rejections drop constraint %I', v_name);
  end loop;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tenant_campaign_scrub_rejections'::regclass
       and conname = 'tenant_campaign_scrub_rejections_occurrence_key'
  ) then
    alter table public.tenant_campaign_scrub_rejections
      add constraint tenant_campaign_scrub_rejections_occurrence_key
      unique (tenant_id, campaign_id, phone_digits, occurrence);
  end if;
end $$;

-- ── recording a rejection ──────────────────────────────────────────────────
create or replace function public.record_campaign_scrub_rejections(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_created_by uuid,
  p_rejections jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_item jsonb;
  v_recorded integer := 0;
  v_inserted integer := 0;
  v_digits text;
  v_outcome text;
  v_occurrence integer;
begin
  if p_tenant_id is null or p_campaign_id is null then
    raise exception 'REJECTION_SCOPE_INVALID';
  end if;
  if jsonb_typeof(p_rejections) <> 'array' then
    raise exception 'REJECTION_PAYLOAD_INVALID';
  end if;
  if not exists (
    select 1 from public.tenant_campaigns
     where id = p_campaign_id and tenant_id = p_tenant_id
  ) then
    raise exception 'REJECTION_CAMPAIGN_SCOPE_INVALID';
  end if;

  for v_item in select value from jsonb_array_elements(p_rejections)
  loop
    v_digits := regexp_replace(coalesce(v_item->>'phone_digits', ''), '[^0-9]', '', 'g');
    if length(v_digits) = 11 and left(v_digits, 1) = '1' then
      v_digits := right(v_digits, 10);
    end if;
    -- A rejection with no usable phone cannot be claimed from a vendor and cannot be matched to a
    -- suppression entry, so it is not evidence. Skipped rather than raised: one unparseable cell
    -- must not fail an import that is otherwise correct.
    if length(v_digits) <> 10 then
      continue;
    end if;

    v_outcome := coalesce(nullif(v_item->>'outcome', ''), 'suppressed');
    -- A repeat inside a file is the second appearance or later; every other outcome is recorded
    -- once per number per campaign, whatever the payload says.
    if v_outcome = 'duplicate_in_file' then
      v_occurrence := case when coalesce(v_item->>'occurrence', '') ~ '^[0-9]{1,5}$'
                           then least(greatest((v_item->>'occurrence')::integer, 2), 20000)
                           else 2 end;
    else
      v_occurrence := 1;
    end if;

    insert into public.tenant_campaign_scrub_rejections
      (tenant_id, campaign_id, phone_digits, outcome, detail, source_key, created_by, occurrence)
    values (
      p_tenant_id,
      p_campaign_id,
      v_digits,
      v_outcome,
      nullif(v_item->>'detail', ''),
      nullif(v_item->>'source_key', ''),
      p_created_by,
      v_occurrence
    )
    on conflict (tenant_id, campaign_id, phone_digits, occurrence) do nothing;

    -- ROW_COUNT rather than FOUND. Both would work here, but FOUND is also written by the
    -- enclosing FOR loop, and a reader should not have to know which statement set it last to
    -- know whether this vendor is about to be billed for a number twice.
    get diagnostics v_inserted = row_count;
    v_recorded := v_recorded + v_inserted;
  end loop;

  return v_recorded;
end;
$function$;

revoke all on function public.record_campaign_scrub_rejections(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, tenant_app;
grant execute on function public.record_campaign_scrub_rejections(uuid, uuid, uuid, jsonb)
  to service_role;

-- ── proof ──────────────────────────────────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_vendor uuid;
  v_campaign uuid;
  v_recorded integer;
  v_usable integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925703100: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  select id into v_tenant from public.tenants order by created_at limit 1;
  if v_tenant is null then
    raise notice '20260925703100: behavioural check skipped, no tenant in this database';
    return;
  end if;

  insert into public.tenant_lead_vendors (tenant_id, name, lead_type)
    values (v_tenant, '703100 duplicate check ' || gen_random_uuid()::text, 'list')
    returning id into v_vendor;
  insert into public.tenant_campaigns (tenant_id, vendor_id, name, lead_type, total_spend_cents, records_purchased)
    values (v_tenant, v_vendor, '703100 duplicate check ' || gen_random_uuid()::text, 'list', 1000, 10)
    returning id into v_campaign;

  -- One DNC hit, and one number that appears three times: two repeats. A DNC payload that claims
  -- occurrence 5 is still recorded once.
  select public.record_campaign_scrub_rejections(v_tenant, v_campaign, null, jsonb_build_array(
    jsonb_build_object('phone_digits', '3125550100', 'outcome', 'dnc', 'occurrence', 5),
    jsonb_build_object('phone_digits', '3125550101', 'outcome', 'duplicate_in_file', 'occurrence', 2),
    jsonb_build_object('phone_digits', '3125550101', 'outcome', 'duplicate_in_file', 'occurrence', 3)
  )) into v_recorded;
  if v_recorded <> 3 then
    raise exception '20260925703100: expected 3 rows recorded, got %', v_recorded;
  end if;

  -- The same file again records nothing.
  select public.record_campaign_scrub_rejections(v_tenant, v_campaign, null, jsonb_build_array(
    jsonb_build_object('phone_digits', '3125550100', 'outcome', 'dnc'),
    jsonb_build_object('phone_digits', '3125550101', 'outcome', 'duplicate_in_file', 'occurrence', 2),
    jsonb_build_object('phone_digits', '3125550101', 'outcome', 'duplicate_in_file', 'occurrence', 3)
  )) into v_recorded;
  if v_recorded <> 0 then
    raise exception '20260925703100: re-recording must record 0, got %', v_recorded;
  end if;

  select records_usable into v_usable from public.tenant_campaign_costs where campaign_id = v_campaign;
  if v_usable <> 7 then
    raise exception '20260925703100: expected 7 usable of 10, got %', v_usable;
  end if;

  delete from public.tenant_campaign_scrub_rejections where campaign_id = v_campaign;
  delete from public.tenant_campaigns where id = v_campaign;
  delete from public.tenant_lead_vendors where id = v_vendor;
end $$;
