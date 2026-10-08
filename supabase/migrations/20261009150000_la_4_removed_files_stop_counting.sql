-- LA-4 bucket door, round 2 (2026-10-09) · a file removed from the bucket stops counting.
--
-- The owner decided (2026-10-08) that a file deleted from the bucket is marked removed and its
-- history kept (20261009100000). Until now it was only marked: its policies and commission lines
-- still counted. Now, when a removed (or restored) file is read again from its raw rows:
--
--   · its policy snapshots are kept, marked superseded (as a reissued file's are), so the book,
--     policy_current and every figure built on it stop counting them. A policy only that file
--     listed leaves the book; one other files list falls back to them;
--   · its commission lines, and its account lines, are reversed with the reason "the file was
--     removed from the bucket" — the ledger is never edited, so the removal is a line too;
--   · restored (the same bytes back at their path), it is read again: its snapshots count again
--     and its lines are recorded anew.
--
-- Who reads it again: Check now does at once, and the five-minute poll picks up any file whose
-- removal changed since it was last derived (bucket_files_to_rederive), so a scheduled check's
-- removals follow within minutes. When a policy file changes, the same day's new-business files of
-- that carrier are read again too, since the policy file wins the day over them (20261009140000).
--
-- The three writers are otherwise exactly as in 20261009140000, 20261008220000 and 20261009130000.
-- Rollback: re-run those three definitions; drop function public.bucket_files_to_rederive(uuid, integer);
-- the reprocess trigger 'bucket_removal' can stay.

alter table public.reprocess_runs drop constraint if exists reprocess_runs_trigger;
alter table public.reprocess_runs add constraint reprocess_runs_trigger
  check (trigger in ('manual', 'parser_update', 'status_map_approval', 'reissue', 'scheduled', 'bucket_removal'));
-- ─── policy snapshots ──────────────────────────────────────────────────────────────────────────
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
begin
  select * into v_file from public.file_registry where id = p_file_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'That file is not in this workspace.' using errcode = 'P0002'; end if;
  if v_file.file_type not in ('policies', 'new_business') or v_file.raw_extracted_at is null or v_file.carrier_id is null or v_file.file_date is null then
    raise exception 'Snapshots come from a policy or new-business file whose raw rows are sealed.' using errcode = 'P0001';
  end if;
  -- A file removed from the bucket keeps its snapshots, marked superseded: kept, counted nowhere.
  v_superseded := v_file.superseded_by_file_id is not null or v_file.removed_from_bucket_at is not null;

  -- A reissue: the replaced file's snapshots for that day stop being the current ones.
  update public.policy_snapshot s set superseded = true
   where s.tenant_id = p_tenant_id and s.carrier_id = v_file.carrier_id and s.snapshot_date = v_file.file_date and not s.superseded
     and s.file_id in (select f.id from public.file_registry f where f.tenant_id = p_tenant_id and f.carrier_id = v_file.carrier_id
                        and f.file_type = v_file.file_type and f.file_date = v_file.file_date and f.superseded_by_file_id is not null);

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
  -- A new-business line adds nothing on a day the policy file already lists the policy.
  where v_file.file_type = 'policies' or v_superseded or not exists (
    select 1 from public.policy_snapshot s join public.file_registry f on f.id = s.file_id
     where s.tenant_id = p_tenant_id and s.carrier_id = v_file.carrier_id and s.policy_number = r.policy_number
       and s.snapshot_date = v_file.file_date and not s.superseded and f.file_type = 'policies');

  select count(*) into v_changed from (
    (select policy_number, content_hash from public.policy_snapshot where file_id = p_file_id except select * from pg_temp.la46_old)
    union all
    (select * from pg_temp.la46_old except select policy_number, content_hash from public.policy_snapshot where file_id = p_file_id)
  ) d;
  select coalesce(array_agg(distinct p), '{}') into v_policies from (
    select policy_number p from public.policy_snapshot where file_id = p_file_id union select policy_number from pg_temp.la46_old
  ) x;
  return jsonb_build_object('changed', v_changed, 'policies', to_jsonb(v_policies), 'carrier_id', v_file.carrier_id);
end;
$$;

-- ─── commission lines ─────────────────────────────────────────────────────────────────────────
create or replace function public.record_commission_entries(p_tenant_id uuid, p_file_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_file record;
  v_reversed integer := 0;
  v_replaced integer := 0;
  v_inserted integer := 0;
  v_kept integer := 0;
  v_missing integer := 0;
begin
  select id, tenant_id, carrier_id, agency_id, file_type, status, removed_from_bucket_at into v_file
    from public.file_registry where id = p_file_id and tenant_id = p_tenant_id;
  if v_file.id is null then
    raise exception 'record_commission_entries: file % is not in this agency', p_file_id using errcode = 'P0002';
  end if;
  if v_file.file_type <> 'commissions' or v_file.carrier_id is null then
    raise exception 'record_commission_entries: file % is not a commission file of a known carrier', p_file_id using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'record_commission_entries: rows must be an array' using errcode = '22023';
  end if;
  -- One reader of a file at a time: two reprocesses must not both reverse the same line.
  perform pg_advisory_xact_lock(hashtextextended('commission_entry:' || p_file_id::text, 0));

  create temp table if not exists pg_temp.incoming (
    row_number integer, policy_number text, entry_type text, corrects_type text, amount_cents bigint,
    transaction_date date, statement_date date, rate_bp integer, commissionable_premium_cents bigint,
    months_advanced integer, agent_identifier text, payee_level text, fingerprint text
  ) on commit drop;
  truncate pg_temp.incoming;
  insert into pg_temp.incoming
  select r.row_number, btrim(r.policy_number), r.entry_type, r.corrects_type, r.amount_cents,
         r.transaction_date, r.statement_date, r.rate_bp, r.commissionable_premium_cents,
         r.months_advanced, nullif(r.agent_identifier, ''), r.payee_level,
         -- A row literal keeps every position, so an empty field never shifts the next one into its place.
         md5(row(btrim(r.policy_number), r.entry_type, r.corrects_type, r.amount_cents, r.transaction_date, r.statement_date,
                 r.rate_bp, r.commissionable_premium_cents, r.months_advanced, nullif(r.agent_identifier, ''), r.payee_level)::text)
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      row_number integer, policy_number text, entry_type text, corrects_type text, amount_cents bigint,
      transaction_date date, statement_date date, rate_bp integer, commissionable_premium_cents bigint,
      months_advanced integer, agent_identifier text, payee_level text)
   where r.row_number is not null and nullif(btrim(r.policy_number), '') is not null and r.entry_type is not null and r.amount_cents is not null;

  -- A file a corrected reissue has replaced, or one removed from the bucket, adds nothing: read again,
  -- its live lines are only reversed. Restored, it is read again and its lines are recorded anew.
  if v_file.status = 'superseded' or v_file.removed_from_bucket_at is not null then
    truncate pg_temp.incoming;
  end if;

  -- 1. A file this one replaces (a corrected reissue): every live line of it is reversed.
  with live as (
    select e.* from public.commission_entry e
      join public.file_registry f on f.id = e.file_id
     where f.tenant_id = p_tenant_id and f.superseded_by_file_id = p_file_id
       and e.reverses_entry_id is null
       and not exists (select 1 from public.commission_entry r where r.reverses_entry_id = e.id)
  ), ins as (
    insert into public.commission_entry (tenant_id, agency_id, carrier_id, policy_number, file_id, raw_row_id, row_number,
      entry_type, corrects_type, reverses_entry_id, reversal_reason, transaction_date, statement_date, rate_bp,
      commissionable_premium_cents, months_advanced, amount_cents, agent_identifier, agent_user_id, payee_level, fingerprint)
    select l.tenant_id, l.agency_id, l.carrier_id, l.policy_number, l.file_id, l.raw_row_id, l.row_number,
           'reversal', coalesce(l.corrects_type, l.entry_type), l.id, 'replaced by a corrected file', l.transaction_date, l.statement_date, l.rate_bp,
           l.commissionable_premium_cents, l.months_advanced, -l.amount_cents, l.agent_identifier, l.agent_user_id, l.payee_level, 'reversal:' || l.id::text
      from live l
    returning 1
  )
  select count(*) into v_replaced from ins;

  -- 2. This file's own live lines that the new reading no longer has (or has differently): reversed.
  with live as (
    select e.* from public.commission_entry e
     where e.tenant_id = p_tenant_id and e.file_id = p_file_id and e.reverses_entry_id is null
       and not exists (select 1 from public.commission_entry r where r.reverses_entry_id = e.id)
  ), gone as (
    select l.* from live l
     where not exists (select 1 from pg_temp.incoming i where i.row_number = l.row_number and i.fingerprint = l.fingerprint)
  ), ins as (
    insert into public.commission_entry (tenant_id, agency_id, carrier_id, policy_number, file_id, raw_row_id, row_number,
      entry_type, corrects_type, reverses_entry_id, reversal_reason, transaction_date, statement_date, rate_bp,
      commissionable_premium_cents, months_advanced, amount_cents, agent_identifier, agent_user_id, payee_level, fingerprint)
    select g.tenant_id, g.agency_id, g.carrier_id, g.policy_number, g.file_id, g.raw_row_id, g.row_number,
           'reversal', coalesce(g.corrects_type, g.entry_type), g.id, case when v_file.removed_from_bucket_at is not null then 'the file was removed from the bucket' when v_file.status = 'superseded' then 'replaced by a corrected file' else 'the file was read again and this line changed' end, g.transaction_date, g.statement_date, g.rate_bp,
           g.commissionable_premium_cents, g.months_advanced, -g.amount_cents, g.agent_identifier, g.agent_user_id, g.payee_level, 'reversal:' || g.id::text
      from gone g
    returning 1
  )
  select count(*) into v_reversed from ins;

  -- 3. New lines: those with no identical live entry on the same row.
  select count(*) into v_kept from pg_temp.incoming i
   where exists (select 1 from public.commission_entry e
                  where e.tenant_id = p_tenant_id and e.file_id = p_file_id and e.row_number = i.row_number and e.fingerprint = i.fingerprint
                    and e.reverses_entry_id is null and not exists (select 1 from public.commission_entry r where r.reverses_entry_id = e.id));

  select count(*) into v_missing from pg_temp.incoming i
   where not exists (select 1 from public.raw_rows rr where rr.tenant_id = p_tenant_id and rr.file_id = p_file_id and rr.row_number = i.row_number);

  with fresh as (
    select i.* from pg_temp.incoming i
     where not exists (select 1 from public.commission_entry e
                        where e.tenant_id = p_tenant_id and e.file_id = p_file_id and e.row_number = i.row_number and e.fingerprint = i.fingerprint
                          and e.reverses_entry_id is null and not exists (select 1 from public.commission_entry r where r.reverses_entry_id = e.id))
  ), ins as (
    insert into public.commission_entry (tenant_id, agency_id, carrier_id, policy_number, file_id, raw_row_id, row_number,
      entry_type, corrects_type, transaction_date, statement_date, rate_bp, commissionable_premium_cents, months_advanced,
      amount_cents, agent_identifier, agent_user_id, payee_level, fingerprint)
    select p_tenant_id, v_file.agency_id, v_file.carrier_id, f.policy_number, p_file_id, rr.id, f.row_number,
           f.entry_type, f.corrects_type, f.transaction_date, f.statement_date, f.rate_bp, f.commissionable_premium_cents, f.months_advanced,
           f.amount_cents, f.agent_identifier,
           (select m.user_id from public.carrier_agent_map m where m.tenant_id = p_tenant_id and m.carrier_id = v_file.carrier_id and m.agent_identifier = f.agent_identifier),
           f.payee_level, f.fingerprint
      from fresh f
      join public.raw_rows rr on rr.tenant_id = p_tenant_id and rr.file_id = p_file_id and rr.row_number = f.row_number
    returning 1
  )
  select count(*) into v_inserted from ins;

  return jsonb_build_object('inserted', v_inserted, 'kept', v_kept, 'reversed', v_reversed, 'replaced', v_replaced, 'without_raw_row', v_missing);
end;
$$;

-- ─── account lines ────────────────────────────────────────────────────────────────────────────
create or replace function public.record_account_entries(p_tenant_id uuid, p_file_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_file record;
  v_reversed integer := 0;
  v_replaced integer := 0;
  v_inserted integer := 0;
  v_kept integer := 0;
begin
  select id, tenant_id, carrier_id, agency_id, file_type, status, removed_from_bucket_at into v_file
    from public.file_registry where id = p_file_id and tenant_id = p_tenant_id;
  if v_file.id is null then
    raise exception 'record_account_entries: file % is not in this agency', p_file_id using errcode = 'P0002';
  end if;
  if v_file.file_type <> 'commissions' or v_file.carrier_id is null then
    raise exception 'record_account_entries: file % is not a commission file of a known carrier', p_file_id using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'record_account_entries: rows must be an array' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('commission_account_entry:' || p_file_id::text, 0));

  create temp table if not exists pg_temp.incoming_account (
    row_number integer, entry_type text, corrects_type text, amount_cents bigint, transaction_date date,
    statement_date date, description text, agent_identifier text, fingerprint text
  ) on commit drop;
  truncate pg_temp.incoming_account;
  insert into pg_temp.incoming_account
  select r.row_number, r.entry_type, r.corrects_type, r.amount_cents, r.transaction_date, r.statement_date,
         nullif(btrim(r.description), ''), nullif(btrim(r.agent_identifier), ''),
         md5(row(r.entry_type, r.corrects_type, r.amount_cents, r.transaction_date, r.statement_date,
                 nullif(btrim(r.description), ''), nullif(btrim(r.agent_identifier), ''))::text)
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      row_number integer, entry_type text, corrects_type text, amount_cents bigint, transaction_date date,
      statement_date date, description text, agent_identifier text)
   where r.row_number is not null and r.entry_type is not null and r.amount_cents is not null;

  if v_file.status = 'superseded' or v_file.removed_from_bucket_at is not null then
    truncate pg_temp.incoming_account;
  end if;

  -- 1. A file this one replaces: every live account line of it is reversed.
  with live as (
    select e.* from public.commission_account_entry e
      join public.file_registry f on f.id = e.file_id
     where f.tenant_id = p_tenant_id and f.superseded_by_file_id = p_file_id
       and e.reverses_entry_id is null
       and not exists (select 1 from public.commission_account_entry r where r.reverses_entry_id = e.id)
  ), ins as (
    insert into public.commission_account_entry (tenant_id, agency_id, carrier_id, file_id, raw_row_id, row_number, entry_type, corrects_type,
      reverses_entry_id, reversal_reason, transaction_date, statement_date, amount_cents, description, agent_identifier, fingerprint)
    select l.tenant_id, l.agency_id, l.carrier_id, l.file_id, l.raw_row_id, l.row_number, 'reversal', coalesce(l.corrects_type, l.entry_type),
           l.id, 'replaced by a corrected file', l.transaction_date, l.statement_date, -l.amount_cents, l.description, l.agent_identifier, 'reversal:' || l.id::text
      from live l
    returning 1
  )
  select count(*) into v_replaced from ins;

  -- 2. This file's own live account lines the new reading no longer has (or has differently): reversed.
  with live as (
    select e.* from public.commission_account_entry e
     where e.tenant_id = p_tenant_id and e.file_id = p_file_id and e.reverses_entry_id is null
       and not exists (select 1 from public.commission_account_entry r where r.reverses_entry_id = e.id)
  ), gone as (
    select l.* from live l
     where not exists (select 1 from pg_temp.incoming_account i where i.row_number = l.row_number and i.fingerprint = l.fingerprint)
  ), ins as (
    insert into public.commission_account_entry (tenant_id, agency_id, carrier_id, file_id, raw_row_id, row_number, entry_type, corrects_type,
      reverses_entry_id, reversal_reason, transaction_date, statement_date, amount_cents, description, agent_identifier, fingerprint)
    select g.tenant_id, g.agency_id, g.carrier_id, g.file_id, g.raw_row_id, g.row_number, 'reversal', coalesce(g.corrects_type, g.entry_type),
           g.id, case when v_file.removed_from_bucket_at is not null then 'the file was removed from the bucket' when v_file.status = 'superseded' then 'replaced by a corrected file' else 'the file was read again and this line changed' end,
           g.transaction_date, g.statement_date, -g.amount_cents, g.description, g.agent_identifier, 'reversal:' || g.id::text
      from gone g
    returning 1
  )
  select count(*) into v_reversed from ins;

  -- 3. New lines: those with no identical live entry on the same row.
  select count(*) into v_kept from pg_temp.incoming_account i
   where exists (select 1 from public.commission_account_entry e
                  where e.tenant_id = p_tenant_id and e.file_id = p_file_id and e.row_number = i.row_number and e.fingerprint = i.fingerprint
                    and e.reverses_entry_id is null and not exists (select 1 from public.commission_account_entry r where r.reverses_entry_id = e.id));

  with fresh as (
    select i.* from pg_temp.incoming_account i
     where not exists (select 1 from public.commission_account_entry e
                        where e.tenant_id = p_tenant_id and e.file_id = p_file_id and e.row_number = i.row_number and e.fingerprint = i.fingerprint
                          and e.reverses_entry_id is null and not exists (select 1 from public.commission_account_entry r where r.reverses_entry_id = e.id))
  ), ins as (
    insert into public.commission_account_entry (tenant_id, agency_id, carrier_id, file_id, raw_row_id, row_number, entry_type, corrects_type,
      transaction_date, statement_date, amount_cents, description, agent_identifier, fingerprint)
    select p_tenant_id, v_file.agency_id, v_file.carrier_id, p_file_id, rr.id, f.row_number, f.entry_type, f.corrects_type,
           f.transaction_date, f.statement_date, f.amount_cents, f.description, f.agent_identifier, f.fingerprint
      from fresh f
      join public.raw_rows rr on rr.tenant_id = p_tenant_id and rr.file_id = p_file_id and rr.row_number = f.row_number
    returning 1
  )
  select count(*) into v_inserted from ins;

  return jsonb_build_object('inserted', v_inserted, 'kept', v_kept, 'reversed', v_reversed, 'replaced', v_replaced);
end;
$$;

-- The bucket files whose removal changed since they were last derived, and the same day's
-- new-business files of a carrier whose policy file changed. Oldest change first.
create or replace function public.bucket_files_to_rederive(p_tenant_id uuid default null, p_limit integer default 50)
returns table (tenant_id uuid, file_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with changed as (
    select f.tenant_id, f.id, f.carrier_id, f.file_type, f.file_date, coalesce(f.removed_from_bucket_at, f.restored_at) as changed_at
      from public.file_registry f
     where f.source = 'bucket' and f.status = 'parsed'
       and f.file_type in ('policies', 'new_business', 'commissions')
       and (p_tenant_id is null or f.tenant_id = p_tenant_id)
       and coalesce(f.removed_from_bucket_at, f.restored_at) is not null
       and (f.derived_at is null or f.derived_at < coalesce(f.removed_from_bucket_at, f.restored_at))
  ), alongside as (
    select nb.tenant_id, nb.id, c.changed_at
      from changed c
      join public.file_registry nb on nb.tenant_id = c.tenant_id and nb.carrier_id = c.carrier_id and nb.file_date = c.file_date
                                  and nb.file_type = 'new_business' and nb.status = 'parsed' and nb.id <> c.id
     where c.file_type = 'policies' and (nb.derived_at is null or nb.derived_at < c.changed_at)
  ), both_kinds as (
    select c.tenant_id, c.id, c.changed_at, 0 as pass from changed c
    union all
    select a.tenant_id, a.id, a.changed_at, 1 from alongside a
  )
  -- The changed files first, then the new-business files beside them, so a day is read in order.
  select x.tenant_id, x.id from (
    select distinct on (b.id) b.tenant_id, b.id, b.changed_at, b.pass from both_kinds b order by b.id, b.pass
  ) x
  order by x.pass, x.changed_at, x.id
  limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;

revoke all on function public.replace_file_snapshots(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_file_snapshots(uuid, uuid, jsonb) to service_role;
revoke all on function public.record_commission_entries(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_commission_entries(uuid, uuid, jsonb) to service_role;
revoke all on function public.record_account_entries(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_account_entries(uuid, uuid, jsonb) to service_role;
revoke all on function public.bucket_files_to_rederive(uuid, integer) from public, anon, authenticated;
grant execute on function public.bucket_files_to_rederive(uuid, integer) to service_role;

-- ─── self-check ────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if position('v_file.removed_from_bucket_at is not null' in pg_get_functiondef('public.replace_file_snapshots(uuid, uuid, jsonb)'::regprocedure)) = 0 then
    raise exception '20261009150000: a removed file''s snapshots still count';
  end if;
  if position('the file was removed from the bucket' in pg_get_functiondef('public.record_commission_entries(uuid, uuid, jsonb)'::regprocedure)) = 0
     or position('the file was removed from the bucket' in pg_get_functiondef('public.record_account_entries(uuid, uuid, jsonb)'::regprocedure)) = 0 then
    raise exception '20261009150000: a removed file''s commission lines still count';
  end if;
  if has_function_privilege('authenticated', 'public.bucket_files_to_rederive(uuid, integer)', 'execute') then
    raise exception '20261009150000: bucket_files_to_rederive is open to signed-in users';
  end if;
end $$;