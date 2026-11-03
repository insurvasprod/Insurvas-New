-- LA-4.12 (Notion sprint) · the commission ledger: every money movement a carrier reports, as one
-- permanent row.
--
--   commission_entry   one row per line of a commission file (LA-4.3 reads it through the layout
--                      map; the carrier's action codes become our entry types through the map's
--                      enum values). Eight types; amounts are SIGNED integer cents:
--                        advance, earned, override, held   ≥ 0
--                        chargeback, fee, advance_interest ≤ 0
--                        reversal                          either sign
--                      `held` is earned and acknowledged but not paid; it is never part of net.
--
-- NEVER UPDATED, NEVER DELETED. Rows are written only by record_commission_entries; the app roles
-- cannot insert, update or delete, and a trigger refuses UPDATE and DELETE for everyone else.
-- Reading a file again writes reversals for the lines that changed or vanished, and new rows for
-- the new lines, so the ledger reads as a history. A corrected reissue that replaces a file
-- reverses every live line of the file it replaces.
--
-- A reversal says which type it corrects (corrects_type), so totals per type stay right after a
-- reprocess: an advance read twice is +X, −X (reversal of an advance), +X — advanced once.
--
-- The per-policy rollup is computed, not stored: commission_policy_totals. The unearned advance
-- (advance minus what months paid have earned, by the LA-0.4 advance rule) is computed in the app
-- with its trace (lib/ingestion/commissionLedger.ts), because it needs the rule and LA-4.7's
-- months paid, and every input is shown beside it.
--
-- Additive. Requires 20261008110000 (raw_rows), 20261008170000 (carrier_agent_map).
--
-- Rollback (only while no entry exists — they are permanent):
--   drop view if exists public.commission_policy_totals;
--   drop function if exists public.record_commission_entries(uuid, uuid, jsonb);
--   drop table if exists public.commission_entry;

create table if not exists public.commission_entry (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agency_id uuid,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  policy_number text not null,
  file_id uuid not null,
  raw_row_id uuid not null,
  row_number integer not null,
  entry_type text not null,
  corrects_type text,
  reverses_entry_id uuid references public.commission_entry(id) on delete restrict,
  reversal_reason text,
  transaction_date date,
  statement_date date,
  rate_bp integer,
  commissionable_premium_cents bigint,
  months_advanced integer,
  amount_cents bigint not null,
  agent_identifier text,
  agent_user_id uuid references public.users(id) on delete set null,
  payee_level text,
  fingerprint text not null,
  created_at timestamptz not null default now(),
  constraint commission_entry_source foreign key (file_id, raw_row_id) references public.raw_rows (file_id, id) on delete restrict,
  constraint commission_entry_type check (entry_type in ('advance', 'earned', 'chargeback', 'reversal', 'fee', 'override', 'advance_interest', 'held')),
  constraint commission_entry_corrects check (
    (entry_type = 'reversal' and (corrects_type is null or corrects_type in ('advance', 'earned', 'chargeback', 'fee', 'override', 'advance_interest', 'held')))
    or (entry_type <> 'reversal' and corrects_type is null)
  ),
  constraint commission_entry_sign check (
    (entry_type in ('advance', 'earned', 'override', 'held') and amount_cents >= 0)
    or (entry_type in ('chargeback', 'fee', 'advance_interest') and amount_cents <= 0)
    or entry_type = 'reversal'
  ),
  constraint commission_entry_reverses check (reverses_entry_id is null or (entry_type = 'reversal' and reversal_reason is not null)),
  constraint commission_entry_policy check (char_length(policy_number) between 1 and 100),
  constraint commission_entry_rate check (rate_bp is null or rate_bp between -1000000 and 1000000),
  constraint commission_entry_months check (months_advanced is null or months_advanced between 0 and 240),
  constraint commission_entry_payee check (payee_level is null or payee_level in ('writing_agent', 'upline'))
);
create unique index if not exists commission_entry_one_reversal on public.commission_entry (reverses_entry_id) where reverses_entry_id is not null;
create index if not exists commission_entry_policy_idx on public.commission_entry (tenant_id, carrier_id, policy_number, transaction_date);
create index if not exists commission_entry_file_idx on public.commission_entry (file_id, row_number);
create index if not exists commission_entry_statement_idx on public.commission_entry (tenant_id, statement_date desc);
create index if not exists commission_entry_carrier_idx on public.commission_entry (carrier_id);
create index if not exists commission_entry_agent_idx on public.commission_entry (agent_user_id) where agent_user_id is not null;

-- An entry is a record of what a statement said. It is never changed or removed.
create or replace function public.commission_entry_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'A commission entry is never changed or removed; write a reversal instead.' using errcode = 'P0001';
end;
$$;
drop trigger if exists commission_entry_guard on public.commission_entry;
create trigger commission_entry_guard before update or delete on public.commission_entry
  for each row execute function public.commission_entry_guard();

-- ─── the only writer ───────────────────────────────────────────────────────────────────────────
-- p_rows: [{ row_number, policy_number, entry_type, corrects_type, amount_cents, transaction_date,
--            statement_date, rate_bp, commissionable_premium_cents, months_advanced,
--            agent_identifier, payee_level }]
-- already normalised by the app (signs, types); the table's checks enforce them again.
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
  select id, tenant_id, carrier_id, agency_id, file_type, status into v_file
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
  if v_file.status = 'superseded' then
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
           'reversal', coalesce(g.corrects_type, g.entry_type), g.id, case when v_file.status = 'superseded' then 'replaced by a corrected file' else 'the file was read again and this line changed' end, g.transaction_date, g.statement_date, g.rate_bp,
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

-- ─── the per-policy rollup (computed, never stored) ────────────────────────────────────────────
-- A reversal counts toward the type it corrects; `held` is reported apart and never in net.
create or replace view public.commission_policy_totals
with (security_invoker = true) as
select e.tenant_id, e.carrier_id, e.policy_number,
       sum(e.amount_cents) filter (where coalesce(e.corrects_type, e.entry_type) = 'advance')::bigint as advanced_cents,
       sum(e.amount_cents) filter (where coalesce(e.corrects_type, e.entry_type) = 'earned')::bigint as earned_cents,
       sum(e.amount_cents) filter (where coalesce(e.corrects_type, e.entry_type) = 'chargeback')::bigint as charged_back_cents,
       sum(e.amount_cents) filter (where coalesce(e.corrects_type, e.entry_type) = 'override')::bigint as override_cents,
       sum(e.amount_cents) filter (where coalesce(e.corrects_type, e.entry_type) = 'fee')::bigint as fee_cents,
       sum(e.amount_cents) filter (where coalesce(e.corrects_type, e.entry_type) = 'advance_interest')::bigint as interest_cents,
       sum(e.amount_cents) filter (where e.entry_type = 'reversal' and e.corrects_type is null)::bigint as other_reversal_cents,
       sum(e.amount_cents) filter (where coalesce(e.corrects_type, e.entry_type) = 'held')::bigint as held_cents,
       sum(e.amount_cents) filter (where coalesce(e.corrects_type, e.entry_type) <> 'held')::bigint as net_received_cents,
       count(*) as entries,
       max(e.statement_date) as last_statement_date
  from public.commission_entry e
 group by e.tenant_id, e.carrier_id, e.policy_number;

-- ─── access ─────────────────────────────────────────────────────────────────────────────────────
alter table public.commission_entry enable row level security;
drop policy if exists commission_entry_read on public.commission_entry;
create policy commission_entry_read on public.commission_entry for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.commission_entry from public, anon, authenticated;
-- Supabase grants service_role everything on a new table: take back all but reading.
revoke insert, update, delete, truncate on public.commission_entry from service_role, tenant_app;
grant select on public.commission_entry to service_role, tenant_app;
revoke all on public.commission_policy_totals from public, anon, authenticated;
grant select on public.commission_policy_totals to service_role, tenant_app;
revoke all on function public.record_commission_entries(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_commission_entries(uuid, uuid, jsonb) to service_role;
revoke all on function public.commission_entry_guard() from public, anon, authenticated;

do $$
begin
  if has_table_privilege('service_role', 'public.commission_entry', 'INSERT') or has_table_privilege('service_role', 'public.commission_entry', 'UPDATE')
     or has_table_privilege('service_role', 'public.commission_entry', 'DELETE') or has_table_privilege('service_role', 'public.commission_entry', 'TRUNCATE') then
    raise exception '20261008220000: commission entries must be written only by record_commission_entries (service_role still has insert=%, update=%, delete=%, truncate=%)',
      has_table_privilege('service_role', 'public.commission_entry', 'INSERT'), has_table_privilege('service_role', 'public.commission_entry', 'UPDATE'),
      has_table_privilege('service_role', 'public.commission_entry', 'DELETE'), has_table_privilege('service_role', 'public.commission_entry', 'TRUNCATE');
  end if;
  if has_table_privilege('tenant_app', 'public.commission_entry', 'UPDATE') or has_table_privilege('tenant_app', 'public.commission_entry', 'DELETE') then
    raise exception '20261008220000: the application role must not update or delete commission entries';
  end if;
end $$;
