-- Two bugs the LA-4 end-to-end run of 2026-10-09 found on a clean test agency.
--
--   1. A file that failed only because its carrier was unknown (an email from an unknown sender)
--      blocked every later copy of the same bytes as its duplicate, though its own error says "add
--      the sender, or upload the file instead". Aflac's policy file could never get in. Now the copy
--      that names the carrier tells the failed file its carrier, type and day, once, and the file is
--      read like a new arrival. Its bytes, name, source and arrival stay as they were; only a file
--      that was never read can be attributed.
--   2. An advance rule saved after the rate never reached policies priced before it: the expected
--      advance stayed empty, so an advance paid short or over could never be found for them. Now an
--      empty expected advance is filled in once; a figure that has one still never changes.
--
-- Rollback: re-run file_registry_guard and register_carrier_file from 20261009100000, and
-- record_expected_commission and expected_commission_guard from 20261009200000.

-- ─── 1. a file that came in without its carrier ──────────────────────────────────────────────────create or replace function public.file_registry_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  -- A file that failed only because no one knew its carrier (never read) may be told its carrier,
  -- type and day once, by the same bytes arriving with them (20261009210000).
  v_attributing boolean := old.carrier_id is null and old.status = 'failed' and old.raw_extracted_at is null
                           and new.carrier_id is not null and new.file_type is not null and new.file_date is not null;
begin
  if new.tenant_id is distinct from old.tenant_id
     or (new.carrier_id is distinct from old.carrier_id and not v_attributing)
     or (new.file_type is distinct from old.file_type and not v_attributing)
     or (new.file_date is distinct from old.file_date and not v_attributing)
     or new.agency_id is distinct from old.agency_id
     or new.path_agency is distinct from old.path_agency
     or new.original_filename is distinct from old.original_filename
     or (new.storage_path is distinct from old.storage_path
         and not (old.removed_from_bucket_at is not null and new.removed_from_bucket_at is null))
     or new.content_hash is distinct from old.content_hash
     or new.file_bytes is distinct from old.file_bytes
     or new.source is distinct from old.source
     or new.uploaded_by is distinct from old.uploaded_by
     or new.email_from is distinct from old.email_from
     or new.received_at is distinct from old.received_at then
    raise exception 'A registered file''s identity cannot change; register the corrected file instead.'
      using errcode = 'P0001';
  end if;
  if old.superseded_by_file_id is not null and new.superseded_by_file_id is distinct from old.superseded_by_file_id then
    raise exception 'A superseded file stays superseded by the file that replaced it.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

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
  p_email_message_id text
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
      select id into v_current from public.file_registry
       where tenant_id = p_tenant_id and carrier_id = p_carrier_id and file_type = p_file_type
         and file_date = p_file_date and coalesce(path_agency, '') = coalesce(v_existing.path_agency, '')
         and superseded_by_file_id is null
       for update;
      if v_current is not null then
        update public.file_registry
           set superseded_by_file_id = v_existing.id, superseded_at = now(), status = 'superseded'
         where id = v_current;
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

  if p_carrier_id is not null and p_file_type is not null and p_file_date is not null then
    -- One current file per carrier, type and day for each agency (the path's agency folder).
    select id into v_current from public.file_registry
     where tenant_id = p_tenant_id and carrier_id = p_carrier_id and file_type = p_file_type
       and file_date = p_file_date and coalesce(path_agency, '') = coalesce(p_path_agency, '')
       and superseded_by_file_id is null
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

-- ─── 2. an advance worked out after the rate ─────────────────────────────────────────────────────
-- Forward-only on the figure: a priced row may change only when it is due, and its advance once
-- while it has none.
create or replace function public.expected_commission_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_free text[] := array['commission_trigger', 'trigger_occurred_on', 'overdue_from', 'computed_at'];
begin
  if tg_op = 'DELETE' then
    raise exception 'An expected commission row is never removed.' using errcode = 'P0001';
  end if;
  if old.expected_advance_cents is null then
    v_free := v_free || array['advance_months', 'advance_pct_bp', 'expected_advance_cents'];
  end if;
  if old.confidence <> 'no_rate_card' and (to_jsonb(new) - v_free) is distinct from (to_jsonb(old) - v_free) then
    raise exception 'An expected commission figure is never rewritten; a rate change applies to later rows.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create or replace function public.record_expected_commission(p_tenant_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted integer := 0;
  v_filled integer := 0;
begin
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'record_expected_commission: rows must be an array' using errcode = '22023';
  end if;
  with incoming as (
    select r.* from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      carrier_id uuid, policy_number text, policy_year integer, commission_trigger text, trigger_occurred_on date, overdue_from date,
      confidence text, reason text, product_family text, contract_level_bp integer, issue_age smallint, schedule_id uuid,
      schedule_version date, band_id uuid, rate_bp_applied integer, commissionable_premium_cents bigint, expected_amount_cents bigint,
      advance_months integer, advance_pct_bp integer, expected_advance_cents bigint)
     -- Only for policies this agency holds.
     where exists (select 1 from public.policy_current pc where pc.tenant_id = p_tenant_id and pc.carrier_id = r.carrier_id and pc.policy_number = r.policy_number)
  ), ins as (
    insert into public.expected_commission (tenant_id, carrier_id, policy_number, policy_year, commission_trigger, trigger_occurred_on,
      overdue_from, confidence, reason, product_family, contract_level_bp, issue_age, schedule_id, schedule_version, band_id,
      rate_bp_applied, commissionable_premium_cents, expected_amount_cents, advance_months, advance_pct_bp, expected_advance_cents)
    select p_tenant_id, i.carrier_id, i.policy_number, coalesce(i.policy_year, 1), i.commission_trigger, i.trigger_occurred_on,
      i.overdue_from, i.confidence, i.reason, i.product_family, i.contract_level_bp, i.issue_age, i.schedule_id, i.schedule_version, i.band_id,
      i.rate_bp_applied, i.commissionable_premium_cents, i.expected_amount_cents, i.advance_months, i.advance_pct_bp, i.expected_advance_cents
      from incoming i
    on conflict (tenant_id, carrier_id, policy_number, policy_year) do update set
      -- When it is due always follows the carrier's current trigger and lag (20261009200000): a lag set
      -- after the rates is what makes a priced policy "missing" at all.
      commission_trigger = excluded.commission_trigger, trigger_occurred_on = excluded.trigger_occurred_on, overdue_from = excluded.overdue_from,
      -- The figure is forward-only: a row that has one keeps it; a row without one is filled in once.
      -- The advance likewise: priced before any advance rule existed, it is filled in once (20261009210000).
      confidence = case when expected_commission.confidence = 'no_rate_card' then excluded.confidence else expected_commission.confidence end,
      reason = case when expected_commission.confidence = 'no_rate_card' then excluded.reason else expected_commission.reason end,
      product_family = case when expected_commission.confidence = 'no_rate_card' then excluded.product_family else expected_commission.product_family end,
      contract_level_bp = case when expected_commission.confidence = 'no_rate_card' then excluded.contract_level_bp else expected_commission.contract_level_bp end,
      issue_age = case when expected_commission.confidence = 'no_rate_card' then excluded.issue_age else expected_commission.issue_age end,
      schedule_id = case when expected_commission.confidence = 'no_rate_card' then excluded.schedule_id else expected_commission.schedule_id end,
      schedule_version = case when expected_commission.confidence = 'no_rate_card' then excluded.schedule_version else expected_commission.schedule_version end,
      band_id = case when expected_commission.confidence = 'no_rate_card' then excluded.band_id else expected_commission.band_id end,
      rate_bp_applied = case when expected_commission.confidence = 'no_rate_card' then excluded.rate_bp_applied else expected_commission.rate_bp_applied end,
      commissionable_premium_cents = case when expected_commission.confidence = 'no_rate_card' then excluded.commissionable_premium_cents else expected_commission.commissionable_premium_cents end,
      expected_amount_cents = case when expected_commission.confidence = 'no_rate_card' then excluded.expected_amount_cents else expected_commission.expected_amount_cents end,
      advance_months = case when expected_commission.confidence = 'no_rate_card' or expected_commission.expected_advance_cents is null then excluded.advance_months else expected_commission.advance_months end,
      advance_pct_bp = case when expected_commission.confidence = 'no_rate_card' or expected_commission.expected_advance_cents is null then excluded.advance_pct_bp else expected_commission.advance_pct_bp end,
      expected_advance_cents = case when expected_commission.confidence = 'no_rate_card' or expected_commission.expected_advance_cents is null then excluded.expected_advance_cents else expected_commission.expected_advance_cents end,
      computed_at = now()
      -- Touched only by a change: a figure filled in, or when it is due moved.
      where (expected_commission.confidence = 'no_rate_card'
             and (excluded.confidence <> 'no_rate_card' or excluded.reason is distinct from expected_commission.reason))
         or excluded.commission_trigger is distinct from expected_commission.commission_trigger
         or excluded.trigger_occurred_on is distinct from expected_commission.trigger_occurred_on
         or excluded.overdue_from is distinct from expected_commission.overdue_from
         or (expected_commission.confidence <> 'no_rate_card' and expected_commission.expected_advance_cents is null
             and excluded.expected_advance_cents is not null)
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted) into v_inserted, v_filled from ins;
  return jsonb_build_object('inserted', v_inserted, 'filled', v_filled);
end;
$$;

revoke all on function public.register_carrier_file(uuid, uuid, text, date, text, text, text, text, bigint, text, text, text, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.register_carrier_file(uuid, uuid, text, date, text, text, text, text, bigint, text, text, text, uuid, text, text, text, text) to service_role;
revoke all on function public.record_expected_commission(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_expected_commission(uuid, jsonb) to service_role;
revoke all on function public.file_registry_guard() from public, anon, authenticated;
revoke all on function public.expected_commission_guard() from public, anon, authenticated;

-- ─── self-check ────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if position('''attributed'', true' in pg_get_functiondef('public.register_carrier_file(uuid, uuid, text, date, text, text, text, text, bigint, text, text, text, uuid, text, text, text, text)'::regprocedure)) = 0 then
    raise exception '20261009210000: a file without its carrier would still block its copies';
  end if;
  if position('v_attributing' in pg_get_functiondef('public.file_registry_guard()'::regprocedure)) = 0 then
    raise exception '20261009210000: the file guard would refuse the attribution';
  end if;
  if position('expected_commission.expected_advance_cents is null' in pg_get_functiondef('public.record_expected_commission(uuid, jsonb)'::regprocedure)) = 0 then
    raise exception '20261009210000: an advance worked out after the rate would still be dropped';
  end if;
end $$;