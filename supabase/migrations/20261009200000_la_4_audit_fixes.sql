-- LA-4 audit fixes (2026-10-09). A full review of the LA-4 workflows found these in the database:
--
--   1. Expected commission (LA-4.13): a priced row kept the trigger and lag it was first written with,
--      so a lag set after the rates never made a policy "missing", and a corrected trigger was
--      ignored. When commission is due (commission_trigger, trigger_occurred_on, overdue_from) now
--      always follows the carrier's settings; the figure itself stays forward-only, as before.
--   2. The daily policy_current refresh ran at 06:15 UTC, still yesterday in the Pacific, Alaska and
--      Hawaii, so their countdowns were a day behind all day. It now runs at 10:15 UTC: after
--      midnight in every US time zone, and the same calendar day in Europe and Asia.
--   3. Snapshots (LA-4.6): a reissued file that drops a policy now returns it, so its history and
--      current row are recomputed; and a new-business line adds nothing for a policy a policy file
--      has already listed (an issued policy no longer goes back to pending).
--   4. Two indexes, so the book-wide ledger reads (ordered by id, and by created_at) stay inside the
--      agency's rows instead of walking every tenant's.
--
-- Rollback: re-run record_expected_commission and expected_commission_guard from 20261008230000 and
-- replace_file_snapshots from 20261009170000; reschedule la4-policy-current-daily at '15 6 * * *';
-- the indexes can stay.

-- ─── 1. expected commission ───────────────────────────────────────────────────────────────────────
-- Forward-only, on the figure: a priced row may have only when it is due changed.
create or replace function public.expected_commission_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'An expected commission row is never removed.' using errcode = 'P0001';
  end if;
  if old.confidence <> 'no_rate_card'
     and (to_jsonb(new) - array['commission_trigger', 'trigger_occurred_on', 'overdue_from', 'computed_at'])
         is distinct from (to_jsonb(old) - array['commission_trigger', 'trigger_occurred_on', 'overdue_from', 'computed_at']) then
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
      advance_months = case when expected_commission.confidence = 'no_rate_card' then excluded.advance_months else expected_commission.advance_months end,
      advance_pct_bp = case when expected_commission.confidence = 'no_rate_card' then excluded.advance_pct_bp else expected_commission.advance_pct_bp end,
      expected_advance_cents = case when expected_commission.confidence = 'no_rate_card' then excluded.expected_advance_cents else expected_commission.expected_advance_cents end,
      computed_at = now()
      -- Touched only by a change: a figure filled in, or when it is due moved.
      where (expected_commission.confidence = 'no_rate_card'
             and (excluded.confidence <> 'no_rate_card' or excluded.reason is distinct from expected_commission.reason))
         or excluded.commission_trigger is distinct from expected_commission.commission_trigger
         or excluded.trigger_occurred_on is distinct from expected_commission.trigger_occurred_on
         or excluded.overdue_from is distinct from expected_commission.overdue_from
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted) into v_inserted, v_filled from ins;
  return jsonb_build_object('inserted', v_inserted, 'filled', v_filled);
end;
$$;

-- ─── 3. snapshots ────────────────────────────────────────────────────────────────────────────────
create or replace function public.replace_file_snapshots(p_tenant_id uuid, p_file_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_file public.file_registry%rowtype;
  v_superseded boolean;
  v_changed integer;
  v_policies text[];
  v_dropped text[];
begin
  select * into v_file from public.file_registry where id = p_file_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'That file is not in this workspace.' using errcode = 'P0002'; end if;
  if v_file.file_type not in ('policies', 'new_business') or v_file.raw_extracted_at is null or v_file.carrier_id is null or v_file.file_date is null then
    raise exception 'Snapshots come from a policy or new-business file whose raw rows are sealed.' using errcode = 'P0001';
  end if;
  v_superseded := v_file.superseded_by_file_id is not null;

  -- A reissue: the replaced file's snapshots for that day stop being the current ones. A policy the
  -- reissue no longer lists is returned too, so its history and current row are recomputed.
  with set_aside as (
    update public.policy_snapshot s set superseded = true
     where s.tenant_id = p_tenant_id and s.carrier_id = v_file.carrier_id and s.snapshot_date = v_file.file_date and not s.superseded
       and s.file_id in (select f.id from public.file_registry f where f.tenant_id = p_tenant_id and f.carrier_id = v_file.carrier_id
                          and f.file_type = v_file.file_type and f.file_date = v_file.file_date and f.superseded_by_file_id is not null)
    returning s.policy_number
  )
  select coalesce(array_agg(distinct policy_number), '{}') into v_dropped from set_aside;

  -- The policy file wins the day: the same policies' new-business snapshots of that day step aside.
  if v_file.file_type = 'policies' and not v_superseded then
    update public.policy_snapshot s set superseded = true
     where s.tenant_id = p_tenant_id and s.carrier_id = v_file.carrier_id and s.snapshot_date = v_file.file_date and not s.superseded
       and s.file_id in (select f.id from public.file_registry f where f.tenant_id = p_tenant_id and f.carrier_id = v_file.carrier_id
                          and f.file_type = 'new_business' and f.file_date = v_file.file_date)
       and s.policy_number in (select r.policy_number from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(policy_number text));
  end if;

  create temp table if not exists pg_temp.la46_old (policy_number text, content_hash text) on commit drop;
  truncate pg_temp.la46_old;
  insert into pg_temp.la46_old select policy_number, content_hash from public.policy_snapshot where file_id = p_file_id;
  delete from public.policy_snapshot where file_id = p_file_id;

  insert into public.policy_snapshot (tenant_id, agency_id, carrier_id, policy_number, snapshot_date, file_id, raw_row_id,
    carrier_status_raw, status_normalized, paid_to_date, effective_date, issue_date, application_date, termination_date,
    premium_cents, premium_mode, payment_method, face_amount_cents, product_code, product_tier, agent_identifier, extra, superseded, content_hash)
  select p_tenant_id, v_file.agency_id, v_file.carrier_id, r.policy_number, v_file.file_date, p_file_id, r.raw_row_id,
    r.carrier_status_raw, r.status_normalized, r.paid_to_date, r.effective_date, r.issue_date, r.application_date, r.termination_date,
    r.premium_cents, r.premium_mode, r.payment_method, r.face_amount_cents, r.product_code, r.product_tier, r.agent_identifier,
    coalesce(r.extra, '{}'::jsonb), v_superseded, r.content_hash
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
    policy_number text, raw_row_id uuid, carrier_status_raw text, status_normalized text, paid_to_date date, effective_date date,
    issue_date date, application_date date, termination_date date, premium_cents bigint, premium_mode text, payment_method text,
    face_amount_cents bigint, product_code text, product_tier text, agent_identifier text, extra jsonb, content_hash text)
  -- A new-business line adds nothing for a policy a policy file has already listed, that day or any
  -- day before: an issued policy does not go back to pending because a later new-business file
  -- still carries it.
  where v_file.file_type = 'policies' or v_superseded or not exists (
    select 1 from public.policy_snapshot s join public.file_registry f on f.id = s.file_id
     where s.tenant_id = p_tenant_id and s.carrier_id = v_file.carrier_id and s.policy_number = r.policy_number
       and s.snapshot_date <= v_file.file_date and not s.superseded and f.file_type = 'policies');

  select count(*) into v_changed from (
    (select policy_number, content_hash from public.policy_snapshot where file_id = p_file_id except select * from pg_temp.la46_old)
    union all
    (select * from pg_temp.la46_old except select policy_number, content_hash from public.policy_snapshot where file_id = p_file_id)
  ) d;
  select coalesce(array_agg(distinct p), '{}') into v_policies from (
    select policy_number p from public.policy_snapshot where file_id = p_file_id union select policy_number from pg_temp.la46_old
    union select unnest(v_dropped)
  ) x;
  return jsonb_build_object('changed', v_changed, 'policies', to_jsonb(v_policies), 'carrier_id', v_file.carrier_id);
end;
$$;

-- ─── 2. the daily refresh, after midnight everywhere in the US ──────────────────────────────────
do $$
begin
  if exists (select 1 from cron.job where jobname = 'la4-policy-current-daily') then
    perform cron.unschedule('la4-policy-current-daily');
  end if;
  perform cron.schedule('la4-policy-current-daily', '15 10 * * *', $cron$select public.refresh_policy_current_daily()$cron$);
end $$;

-- ─── 4. indexes ──────────────────────────────────────────────────────────────────────────────────
create index if not exists commission_entry_tenant_id_idx on public.commission_entry (tenant_id, id);
create index if not exists commission_entry_tenant_created_idx on public.commission_entry (tenant_id, created_at);

revoke all on function public.record_expected_commission(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_expected_commission(uuid, jsonb) to service_role;
revoke all on function public.replace_file_snapshots(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_file_snapshots(uuid, uuid, jsonb) to service_role;
revoke all on function public.expected_commission_guard() from public, anon, authenticated;

-- ─── self-check ────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if position('excluded.overdue_from is distinct from expected_commission.overdue_from' in pg_get_functiondef('public.record_expected_commission(uuid, jsonb)'::regprocedure)) = 0 then
    raise exception '20261009200000: a priced row would still keep a stale trigger or lag';
  end if;
  if (select schedule from cron.job where jobname = 'la4-policy-current-daily') is distinct from '15 10 * * *' then
    raise exception '20261009200000: the daily refresh is not at 10:15 UTC';
  end if;
  if position('v_dropped' in pg_get_functiondef('public.replace_file_snapshots(uuid, uuid, jsonb)'::regprocedure)) = 0 then
    raise exception '20261009200000: a policy a reissue drops would not be recomputed';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'commission_entry_tenant_id_idx') then
    raise exception '20261009200000: the ledger index is missing';
  end if;
end $$;