-- LA-4.4 · a commission file that fails when it is read again writes nothing, so the lines an
-- earlier reading recorded are reversed (2026-10-09, owner's decision). Example: the synthetic
-- Corebridge statement read before the balance gate (20261009180000) recorded seven lines; read
-- again under the gate it fails (the lines don't add up to its total), so those seven lines are
-- reversed, each with the reason "the file failed when it was read again: <why>". Read again once
-- it is fixed, its lines are recorded anew. The ledger is never edited: the reversal is a line too.
--
-- record_commission_entries and record_account_entries are otherwise exactly as in 20261009170000
-- (= 20261008220000 and 20261009130000). The app calls them with no lines when a commission
-- file's parse fails (lib/ingestion/parser.ts).
--
-- Rollback: re-run the two definitions from 20261009170000.
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
  select id, tenant_id, carrier_id, agency_id, file_type, status, error_detail into v_file
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

  -- A file a corrected reissue has replaced adds nothing: read again, its live lines are only reversed.
  -- So does a file that failed when it was read again (LA-4.4: a failing file writes nothing).
  if v_file.status in ('superseded', 'failed') then
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
           'reversal', coalesce(g.corrects_type, g.entry_type), g.id, case when v_file.status = 'superseded' then 'replaced by a corrected file' when v_file.status = 'failed' then left('the file failed when it was read again: ' || coalesce(v_file.error_detail, 'it could not be read'), 500) else 'the file was read again and this line changed' end, g.transaction_date, g.statement_date, g.rate_bp,
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
  select id, tenant_id, carrier_id, agency_id, file_type, status, error_detail into v_file
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

  if v_file.status in ('superseded', 'failed') then
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
           g.id, case when v_file.status = 'superseded' then 'replaced by a corrected file' when v_file.status = 'failed' then left('the file failed when it was read again: ' || coalesce(v_file.error_detail, 'it could not be read'), 500) else 'the file was read again and this line changed' end,
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

revoke all on function public.record_commission_entries(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_commission_entries(uuid, uuid, jsonb) to service_role;
revoke all on function public.record_account_entries(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_account_entries(uuid, uuid, jsonb) to service_role;

-- ─── self-check ────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if position('the file failed when it was read again' in pg_get_functiondef('public.record_commission_entries(uuid, uuid, jsonb)'::regprocedure)) = 0
     or position('the file failed when it was read again' in pg_get_functiondef('public.record_account_entries(uuid, uuid, jsonb)'::regprocedure)) = 0 then
    raise exception '20261009190000: a failed file''s lines would still count';
  end if;
  if has_function_privilege('authenticated', 'public.record_commission_entries(uuid, uuid, jsonb)', 'execute') then
    raise exception '20261009190000: record_commission_entries is open to signed-in users';
  end if;
end $$;