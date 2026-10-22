-- LA-4 bucket door, round 2 (2026-10-09) · account-level commission lines: money a carrier moves on
-- the agency's account that names no policy (Sentinel Security Life's advance interest is the first).
-- The owner decided (2026-10-08) that such lines are recorded, not held.
--
--   1. commission_account_entry: one row per account-level line of a commission file. The same rules
--      as commission_entry (20261008220000): signed integer cents, NEVER UPDATED, NEVER DELETED,
--      written only by record_account_entries, a reversal for a line that changed or vanished.
--      Kept apart from commission_entry because every reader of that table works per policy
--      (totals, orphans, discrepancies, scorecards, retention); a line with no policy belongs to none.
--   2. carrier_account_checks counts them: a statement's activity is its policy lines plus its
--      account lines, so a statement with interest on it still adds up.
--   3. Sentinel Security Life's statement layout, version 2 (IN REVIEW, published by staff): the
--      policy number is no longer required, and the line's description is read.
--
-- Additive. Requires 20261008220000, 20261008240000, 20261009110000.
-- Rollback (only while no account entry exists — they are permanent): restore carrier_account_checks
-- from 20261008240000; drop function public.record_account_entries(uuid, uuid, jsonb); drop table
-- public.commission_account_entry; delete the in-review ssl_statement_pdf version 2.

create table if not exists public.commission_account_entry (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agency_id uuid,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  file_id uuid not null,
  raw_row_id uuid not null,
  row_number integer not null,
  entry_type text not null,
  corrects_type text,
  reverses_entry_id uuid references public.commission_account_entry(id) on delete restrict,
  reversal_reason text,
  transaction_date date,
  statement_date date,
  amount_cents bigint not null,
  description text,
  agent_identifier text,
  fingerprint text not null,
  created_at timestamptz not null default now(),
  constraint commission_account_entry_source foreign key (file_id, raw_row_id) references public.raw_rows (file_id, id) on delete restrict,
  constraint commission_account_entry_type check (entry_type in ('advance', 'earned', 'chargeback', 'reversal', 'fee', 'override', 'advance_interest', 'held')),
  constraint commission_account_entry_corrects check (
    (entry_type = 'reversal' and (corrects_type is null or corrects_type in ('advance', 'earned', 'chargeback', 'fee', 'override', 'advance_interest', 'held')))
    or (entry_type <> 'reversal' and corrects_type is null)
  ),
  constraint commission_account_entry_sign check (
    (entry_type in ('advance', 'earned', 'override', 'held') and amount_cents >= 0)
    or (entry_type in ('chargeback', 'fee', 'advance_interest') and amount_cents <= 0)
    or entry_type = 'reversal'
  ),
  constraint commission_account_entry_reverses check (reverses_entry_id is null or (entry_type = 'reversal' and reversal_reason is not null)),
  constraint commission_account_entry_description check (description is null or char_length(description) <= 500)
);
create unique index if not exists commission_account_entry_one_reversal on public.commission_account_entry (reverses_entry_id) where reverses_entry_id is not null;
create index if not exists commission_account_entry_file_idx on public.commission_account_entry (file_id, row_number);
create index if not exists commission_account_entry_tenant_idx on public.commission_account_entry (tenant_id, carrier_id, statement_date desc);
create index if not exists commission_account_entry_carrier_idx on public.commission_account_entry (carrier_id);

create or replace function public.commission_account_entry_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'An account entry is never changed or removed; write a reversal instead.' using errcode = 'P0001';
end;
$$;
drop trigger if exists commission_account_entry_guard on public.commission_account_entry;
create trigger commission_account_entry_guard before update or delete on public.commission_account_entry
  for each row execute function public.commission_account_entry_guard();

-- ─── the only writer ───────────────────────────────────────────────────────────────────────────
-- p_rows: [{ row_number, entry_type, corrects_type, amount_cents, transaction_date, statement_date,
--            description, agent_identifier }] — normalised by the app. Called on every reading of a
-- commission file, with no rows too, so a line that vanished is reversed. Same steps as
-- record_commission_entries: a replaced file's lines reversed, changed lines reversed, new lines added.
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
  select id, tenant_id, carrier_id, agency_id, file_type, status into v_file
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

  if v_file.status = 'superseded' then
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
           g.id, case when v_file.status = 'superseded' then 'replaced by a corrected file' else 'the file was read again and this line changed' end,
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

-- ─── a statement's activity: its policy lines and its account lines ─────────────────────────────
create or replace view public.carrier_account_checks
with (security_invoker = true) as
select s.*,
       e.entries_cents,
       e.entries,
       (s.opening_balance_cents + s.activity_cents = s.closing_balance_cents) as arithmetic_ok,
       (s.file_id is null or e.entries is null or e.entries_cents = s.activity_cents) as entries_ok,
       lag(s.closing_balance_cents) over w as previous_closing_cents,
       lag(s.statement_date) over w as previous_statement_date,
       (lag(s.closing_balance_cents) over w is null or lag(s.closing_balance_cents) over w = s.opening_balance_cents) as continuity_ok,
       not (s.opening_balance_cents + s.activity_cents = s.closing_balance_cents and (s.file_id is null or e.entries is null or e.entries_cents = s.activity_cents)) as flagged
  from public.carrier_account_statement s
  left join lateral (
    select count(*) as entries,
           coalesce(sum(l.amount_cents) filter (where coalesce(l.corrects_type, l.entry_type) <> 'held'), 0)::bigint as entries_cents
      from (
        select ce.amount_cents, ce.entry_type, ce.corrects_type from public.commission_entry ce
         where ce.tenant_id = s.tenant_id and ce.file_id = s.file_id
        union all
        select ae.amount_cents, ae.entry_type, ae.corrects_type from public.commission_account_entry ae
         where ae.tenant_id = s.tenant_id and ae.file_id = s.file_id
      ) l
    having count(*) > 0
  ) e on true
window w as (partition by s.tenant_id, s.carrier_id order by s.statement_date);

-- ─── access ─────────────────────────────────────────────────────────────────────────────────────
alter table public.commission_account_entry enable row level security;
drop policy if exists commission_account_entry_read on public.commission_account_entry;
create policy commission_account_entry_read on public.commission_account_entry for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.commission_account_entry from public, anon, authenticated;
-- Supabase grants service_role everything on a new table: take back all but reading.
revoke insert, update, delete, truncate on public.commission_account_entry from service_role, tenant_app;
grant select on public.commission_account_entry to service_role, tenant_app;
revoke all on function public.record_account_entries(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_account_entries(uuid, uuid, jsonb) to service_role;
revoke all on function public.commission_account_entry_guard() from public, anon, authenticated;

-- ─── Sentinel Security Life's statement, version 2 (in review) ─────────────────────────────────
do $$
declare
  v_one public.carrier_layout_map%rowtype;
  v_map uuid;
begin
  select * into v_one from public.carrier_layout_map where tenant_id is null and layout_key = 'ssl_statement_pdf' and version = 1;
  if v_one.id is null then
    raise exception '20261009130000: ssl_statement_pdf version 1 is missing (20261009110000)';
  end if;
  if not exists (select 1 from public.carrier_layout_map where tenant_id is null and layout_key = 'ssl_statement_pdf' and version = 2) then
    insert into public.carrier_layout_map (tenant_id, layout_key, name, file_type, version, status, header_row_index, sheet_name, pdf_layout, proposal_source)
    values (null, 'ssl_statement_pdf', v_one.name, 'commissions', 2, 'in_review', v_one.header_row_index, v_one.sheet_name, v_one.pdf_layout, 'manual')
    returning id into v_map;
    insert into public.carrier_layout_map_entry (map_id, source_column, target_field, data_type, transform, required, sort_order, enum_values) values
      (v_map, 'Policy #', 'policy_number', 'text', 'none', false, 1, null),
      (v_map, 'Adjustment Type', 'entry_type', 'enum', 'none', true, 2, '{"AI":"advance_interest"}'::jsonb),
      (v_map, '(+/-) Adjustment Amount', 'amount_cents', 'int_cents', 'strip_currency', true, 3, null),
      (v_map, 'Adjustment Description', 'description', 'text', 'none', false, 4, null);
  end if;
end $$;

-- ─── self-check ────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if has_table_privilege('service_role', 'public.commission_account_entry', 'INSERT') or has_table_privilege('service_role', 'public.commission_account_entry', 'UPDATE')
     or has_table_privilege('service_role', 'public.commission_account_entry', 'DELETE') or has_table_privilege('service_role', 'public.commission_account_entry', 'TRUNCATE') then
    raise exception '20261009130000: account entries must be written only by record_account_entries';
  end if;
  if has_table_privilege('tenant_app', 'public.commission_account_entry', 'UPDATE') or has_table_privilege('tenant_app', 'public.commission_account_entry', 'DELETE') then
    raise exception '20261009130000: the application role must not update or delete account entries';
  end if;
  if has_function_privilege('authenticated', 'public.record_account_entries(uuid, uuid, jsonb)', 'execute') then
    raise exception '20261009130000: record_account_entries is open to signed-in users';
  end if;
  if position('commission_account_entry' in pg_get_viewdef('public.carrier_account_checks'::regclass)) = 0 then
    raise exception '20261009130000: carrier_account_checks does not count account lines';
  end if;
  if (select count(*) from public.carrier_layout_map_entry e join public.carrier_layout_map m on m.id = e.map_id
       where m.tenant_id is null and m.layout_key = 'ssl_statement_pdf' and m.version = 2) <> 4 then
    raise exception '20261009130000: ssl_statement_pdf version 2 does not have its four columns';
  end if;
end $$;
