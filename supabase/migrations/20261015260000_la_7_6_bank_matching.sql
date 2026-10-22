-- LA-7.6 (Notion sprint, Module 7 — Accounting) · bank import and deposit matching.
--
-- The third truth about money. LA-4 has two: EXPECTED (the rate card) and REPORTED (the carrier's
-- statement). This is RECEIVED: what actually landed in the bank. A CSV the agent exports from the
-- bank, mapped once per account; matched against LA-4.14's carrier account statements.
--
--   bank_account       nickname, bank, last four, the remembered column mapping.
--   bank_transaction   one row per bank line: signed cents (deposits positive), the bank's own text
--                      VERBATIM, and a content hash so re-importing an overlapping range adds nothing.
--   deposit_match      MANY-TO-MANY: two statements into one deposit, one statement over two
--                      deposits, a statement with no deposit at all. amount_applied_cents says how
--                      much of the deposit applies to that statement.
--
-- The system SUGGESTS (exact amount; two or three statements of one carrier summing to the deposit;
-- the carrier's name in the bank's text) and a HUMAN CONFIRMS. Nothing is applied without
-- confirmation: a wrong automatic match makes a reconciled-looking P&L that is wrong.
--
-- Findings: deposits we cannot explain, and statements the carrier says it paid that never arrived
-- past its expected lag — the second feeds LA-4.15 as a 'not_received' discrepancy. Nothing here
-- writes to commission_entry; the match is its own record.
--
-- Additive. Rollback: drop function public.deposit_unreceived_statements(uuid, date), public.deposit_unmatched_deposits(uuid),
--   public.suggest_deposit_matches(uuid), public.confirm_deposit_matches(uuid, uuid[], uuid), public.manual_deposit_match(uuid, uuid, uuid, bigint, uuid),
--   public.remove_deposit_match(uuid, uuid, uuid), public.import_bank_rows(uuid, uuid, text, text, jsonb, uuid), public.refresh_bank_match_status(uuid);
--   drop table public.deposit_match, public.bank_transaction, public.bank_import, public.bank_account;
--   alter table public.accounting_settings drop column bank_amount_tolerance_cents, drop column bank_window_days;
--   (and restore commission_discrepancy_type without 'not_received').

alter table public.accounting_settings
  add column if not exists bank_amount_tolerance_cents bigint not null default 0,
  add column if not exists bank_window_days integer not null default 21;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'accounting_settings_bank' and conrelid = 'public.accounting_settings'::regclass) then
    alter table public.accounting_settings add constraint accounting_settings_bank check (bank_amount_tolerance_cents between 0 and 1000000 and bank_window_days between 1 and 120);
  end if;
end;
$$;

create table if not exists public.bank_account (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agency_id uuid,
  nickname text not null,
  bank_name text,
  last_four text,
  column_map_json jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bank_account_nickname check (char_length(btrim(nickname)) between 1 and 80),
  constraint bank_account_last_four check (last_four is null or last_four ~ '^[0-9]{4}$')
);
create index if not exists bank_account_tenant_idx on public.bank_account (tenant_id);

create table if not exists public.bank_import (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  bank_account_id uuid not null references public.bank_account(id) on delete restrict,
  file_name text,
  file_sha256 text,
  rows_total integer not null default 0,
  rows_new integer not null default 0,
  rows_duplicate integer not null default 0,
  imported_by uuid,
  imported_at timestamptz not null default now()
);
create index if not exists bank_import_account_idx on public.bank_import (bank_account_id, imported_at desc);

create table if not exists public.bank_transaction (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  bank_account_id uuid not null references public.bank_account(id) on delete restrict,
  import_id uuid not null references public.bank_import(id) on delete restrict,
  posted_on date not null,
  amount_cents bigint not null,
  description_raw text not null,
  reference text,
  content_hash text not null,
  match_status text not null default 'unmatched',
  ignored_reason text,
  created_at timestamptz not null default now(),
  constraint bank_transaction_status check (match_status in ('unmatched', 'suggested', 'matched', 'partially_matched', 'ignored')),
  constraint bank_transaction_ignored check ((match_status = 'ignored') = (ignored_reason is not null)),
  constraint bank_transaction_hash check (content_hash ~ '^[0-9a-f]{64}$')
);
create unique index if not exists bank_transaction_dedupe on public.bank_transaction (bank_account_id, content_hash);
create index if not exists bank_transaction_tenant_idx on public.bank_transaction (tenant_id, posted_on);
create index if not exists bank_transaction_open_idx on public.bank_transaction (tenant_id, match_status) where match_status in ('unmatched', 'suggested', 'partially_matched');

create table if not exists public.deposit_match (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  bank_transaction_id uuid not null references public.bank_transaction(id) on delete restrict,
  carrier_account_statement_id uuid not null references public.carrier_account_statement(id) on delete restrict,
  amount_applied_cents bigint not null,
  confidence text not null,
  matched_by uuid,
  matched_at timestamptz not null default now(),
  confirmed_by uuid,
  confirmed_at timestamptz,
  reason text,
  constraint deposit_match_amount check (amount_applied_cents > 0),
  constraint deposit_match_confidence check (confidence in ('exact', 'suggested', 'manual')),
  constraint deposit_match_confirmed check ((confirmed_by is null) = (confirmed_at is null)),
  -- A person's own match is confirmed by its making; only the system suggests.
  constraint deposit_match_manual check (confidence <> 'manual' or confirmed_by is not null)
);
create unique index if not exists deposit_match_pair on public.deposit_match (bank_transaction_id, carrier_account_statement_id);
create index if not exists deposit_match_statement_idx on public.deposit_match (carrier_account_statement_id);
create index if not exists deposit_match_tenant_idx on public.deposit_match (tenant_id) where confirmed_by is not null;

-- ─── guards ────────────────────────────────────────────────────────────────────────────────────
-- A bank line is what the bank said: only its match state (and an ignore reason) ever changes.
create or replace function public.bank_transaction_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A bank line is never removed; mark it ignored with a reason.' using errcode = 'P0001';
  end if;
  if (to_jsonb(new) - 'match_status' - 'ignored_reason') <> (to_jsonb(old) - 'match_status' - 'ignored_reason') then
    raise exception 'A bank line is kept as the bank wrote it.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists bank_transaction_guard on public.bank_transaction;
create trigger bank_transaction_guard before update or delete on public.bank_transaction for each row execute function public.bank_transaction_guard();

-- Confirmed matches are records: one cannot be edited, only removed by its writer (with a reason
-- in the audit). Applying more than a deposit holds, or more than a statement paid, is refused.
create or replace function public.deposit_match_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_txn bigint;
  v_stmt bigint;
  v_txn_applied bigint;
  v_stmt_applied bigint;
begin
  if tg_op = 'DELETE' then
    if old.confirmed_by is not null and coalesce(current_setting('app.deposit_writer', true), '') <> 'on' then
      raise exception 'A confirmed match is removed only through its own action.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.confirmed_by is not null then
    raise exception 'A confirmed match is not edited; remove it and match again.' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and (new.bank_transaction_id, new.carrier_account_statement_id, new.amount_applied_cents, new.tenant_id)
       is distinct from (old.bank_transaction_id, old.carrier_account_statement_id, old.amount_applied_cents, old.tenant_id) then
    raise exception 'A suggestion is confirmed or removed, not edited.' using errcode = 'P0001';
  end if;
  if new.confirmed_by is not null then
    select t.amount_cents into v_txn from public.bank_transaction t where t.id = new.bank_transaction_id and t.tenant_id = new.tenant_id;
    select s.amount_paid_cents into v_stmt from public.carrier_account_statement s where s.id = new.carrier_account_statement_id and s.tenant_id = new.tenant_id;
    if v_txn is null or v_stmt is null then
      raise exception 'Both the deposit and the statement must be in this agency.' using errcode = 'P0001';
    end if;
    select coalesce(sum(amount_applied_cents), 0) into v_txn_applied from public.deposit_match where bank_transaction_id = new.bank_transaction_id and confirmed_by is not null and id <> new.id;
    select coalesce(sum(amount_applied_cents), 0) into v_stmt_applied from public.deposit_match where carrier_account_statement_id = new.carrier_account_statement_id and confirmed_by is not null and id <> new.id;
    if v_txn_applied + new.amount_applied_cents > v_txn then
      raise exception 'That applies more than the deposit holds.' using errcode = 'P0001';
    end if;
    if v_stmt_applied + new.amount_applied_cents > v_stmt then
      raise exception 'That applies more than the statement says was paid.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists deposit_match_guard on public.deposit_match;
create trigger deposit_match_guard before insert or update or delete on public.deposit_match for each row execute function public.deposit_match_guard();

-- The status on a bank line follows from its matches.
create or replace function public.refresh_bank_match_status(p_transaction_id uuid)
returns void
language sql
security definer
set search_path = public, pg_catalog
as $$
  update public.bank_transaction t
     set match_status = case
           when t.match_status = 'ignored' then 'ignored'
           when coalesce(m.confirmed, 0) >= t.amount_cents then 'matched'
           when coalesce(m.confirmed, 0) > 0 then 'partially_matched'
           when coalesce(m.suggested, 0) > 0 then 'suggested'
           else 'unmatched' end
    from (select sum(amount_applied_cents) filter (where confirmed_by is not null) as confirmed, count(*) filter (where confirmed_by is null) as suggested
            from public.deposit_match where bank_transaction_id = p_transaction_id) m
   where t.id = p_transaction_id
$$;

-- ─── import ────────────────────────────────────────────────────────────────────────────────────
-- Rows arrive parsed (the column mapping is the application's): {posted_on, amount_cents,
-- description_raw, reference, content_hash}. A hash already on the account is a duplicate — counted, not added.
create or replace function public.import_bank_rows(p_tenant_id uuid, p_account_id uuid, p_file_name text, p_file_sha256 text, p_rows jsonb, p_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_import uuid;
  v_total integer;
  v_new integer;
begin
  if not exists (select 1 from public.bank_account a where a.id = p_account_id and a.tenant_id = p_tenant_id) then
    raise exception 'import_bank_rows: account % is not in this agency', p_account_id using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'import_bank_rows: rows must be an array' using errcode = '22023';
  end if;
  v_total := jsonb_array_length(p_rows);
  insert into public.bank_import (tenant_id, bank_account_id, file_name, file_sha256, rows_total, imported_by)
  values (p_tenant_id, p_account_id, left(p_file_name, 200), p_file_sha256, v_total, p_by)
  returning id into v_import;
  insert into public.bank_transaction (tenant_id, bank_account_id, import_id, posted_on, amount_cents, description_raw, reference, content_hash)
  select p_tenant_id, p_account_id, v_import, (r->>'posted_on')::date, (r->>'amount_cents')::bigint, r->>'description_raw', nullif(r->>'reference', ''), r->>'content_hash'
    from jsonb_array_elements(p_rows) r
   where (r->>'amount_cents') ~ '^-?[0-9]+$'
  on conflict (bank_account_id, content_hash) do nothing;
  get diagnostics v_new = row_count;
  update public.bank_import set rows_new = v_new, rows_duplicate = v_total - v_new where id = v_import;
  return jsonb_build_object('import_id', v_import, 'rows', v_total, 'new', v_new, 'duplicates', v_total - v_new);
end;
$$;

-- ─── suggestions ───────────────────────────────────────────────────────────────────────────────
-- For each deposit with nothing confirmed and nothing suggested yet. Statements of the window before
-- the deposit (the agency's setting) that still have money unaccounted for. Suggestions only.
create or replace function public.suggest_deposit_matches(p_tenant_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  t record;
  v_window integer;
  v_tol bigint;
  v_n integer := 0;
  v_pick uuid[];
  v_amounts bigint[];
begin
  select coalesce((select bank_window_days from public.accounting_settings where tenant_id = p_tenant_id), 21),
         coalesce((select bank_amount_tolerance_cents from public.accounting_settings where tenant_id = p_tenant_id), 0)
    into v_window, v_tol;
  for t in select * from public.bank_transaction b
            where b.tenant_id = p_tenant_id and b.amount_cents > 0 and b.match_status = 'unmatched' order by b.posted_on loop
    v_pick := null;
    -- Open statements in the window: paid by the carrier, not yet fully accounted for.
    create temp table if not exists _open_stmt (id uuid, carrier_id uuid, statement_date date, remaining bigint, named boolean) on commit drop;
    truncate _open_stmt;
    insert into _open_stmt
    select s.id, s.carrier_id, s.statement_date,
           s.amount_paid_cents - coalesce((select sum(m.amount_applied_cents) from public.deposit_match m where m.carrier_account_statement_id = s.id and m.confirmed_by is not null), 0),
           t.description_raw ilike '%' || split_part(c.name, ' ', 1) || '%'
      from public.carrier_account_statement s join public.carriers c on c.id = s.carrier_id
     where s.tenant_id = p_tenant_id and coalesce(s.amount_paid_cents, 0) > 0
       and s.statement_date between t.posted_on - v_window and t.posted_on;
    delete from _open_stmt where remaining <= 0;

    -- 1. one statement, exact (named first, then nearest date)
    select array[o.id], array[t.amount_cents] into v_pick, v_amounts from _open_stmt o
     where abs(o.remaining - t.amount_cents) <= v_tol order by o.named desc, t.posted_on - o.statement_date limit 1;
    if v_pick is not null then
      insert into public.deposit_match (tenant_id, bank_transaction_id, carrier_account_statement_id, amount_applied_cents, confidence, reason)
      select p_tenant_id, t.id, v_pick[1], least(t.amount_cents, (select remaining from _open_stmt where id = v_pick[1])), 'exact', 'Same amount within the window';
    else
      -- 2. two or three statements of one carrier summing to the deposit
      select array[a.id, b.id], array[a.remaining, b.remaining] into v_pick, v_amounts
        from _open_stmt a join _open_stmt b on b.carrier_id = a.carrier_id and b.id > a.id
       where abs(a.remaining + b.remaining - t.amount_cents) <= v_tol
       order by (a.named or b.named) desc limit 1;
      if v_pick is null then
        select array[a.id, b.id, c.id], array[a.remaining, b.remaining, c.remaining] into v_pick, v_amounts
          from _open_stmt a join _open_stmt b on b.carrier_id = a.carrier_id and b.id > a.id join _open_stmt c on c.carrier_id = a.carrier_id and c.id > b.id
         where abs(a.remaining + b.remaining + c.remaining - t.amount_cents) <= v_tol
         order by (a.named or b.named or c.named) desc limit 1;
      end if;
      if v_pick is not null then
        insert into public.deposit_match (tenant_id, bank_transaction_id, carrier_account_statement_id, amount_applied_cents, confidence, reason)
        select p_tenant_id, t.id, v_pick[i], v_amounts[i], 'suggested', 'Statements of one carrier that add up to the deposit'
          from generate_subscripts(v_pick, 1) i;
      else
        -- 3. the carrier is named in the bank's text and the deposit is part of what it paid
        select array[o.id] into v_pick from _open_stmt o where o.named and o.remaining > t.amount_cents order by t.posted_on - o.statement_date limit 1;
        if v_pick is not null then
          insert into public.deposit_match (tenant_id, bank_transaction_id, carrier_account_statement_id, amount_applied_cents, confidence, reason)
          values (p_tenant_id, t.id, v_pick[1], t.amount_cents, 'suggested', 'The carrier is named on the deposit; part of what the statement says it paid');
        end if;
      end if;
    end if;
    if v_pick is not null then
      perform public.refresh_bank_match_status(t.id);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- A person confirms suggestions (all of a deposit's, or chosen ones).
create or replace function public.confirm_deposit_matches(p_tenant_id uuid, p_match_ids uuid[], p_by uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  m record;
  v_n integer := 0;
begin
  if p_by is null then
    raise exception 'confirm_deposit_matches: a match is confirmed by a person' using errcode = '22023';
  end if;
  for m in select * from public.deposit_match where tenant_id = p_tenant_id and id = any(p_match_ids) and confirmed_by is null loop
    update public.deposit_match set confirmed_by = p_by, confirmed_at = now() where id = m.id;
    perform public.refresh_bank_match_status(m.bank_transaction_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function public.manual_deposit_match(p_tenant_id uuid, p_transaction_id uuid, p_statement_id uuid, p_amount_cents bigint, p_by uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_id uuid;
begin
  if p_by is null then
    raise exception 'manual_deposit_match: a match is made by a person' using errcode = '22023';
  end if;
  -- A pending suggestion for the same pair gives way to the person's own match.
  delete from public.deposit_match where bank_transaction_id = p_transaction_id and carrier_account_statement_id = p_statement_id and confirmed_by is null and tenant_id = p_tenant_id;
  insert into public.deposit_match (tenant_id, bank_transaction_id, carrier_account_statement_id, amount_applied_cents, confidence, matched_by, confirmed_by, confirmed_at, reason)
  values (p_tenant_id, p_transaction_id, p_statement_id, p_amount_cents, 'manual', p_by, p_by, now(), 'Matched by hand')
  returning id into v_id;
  perform public.refresh_bank_match_status(p_transaction_id);
  return v_id;
end;
$$;

create or replace function public.remove_deposit_match(p_tenant_id uuid, p_match_id uuid, p_by uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_txn uuid;
begin
  select bank_transaction_id into v_txn from public.deposit_match where id = p_match_id and tenant_id = p_tenant_id;
  if v_txn is null then
    raise exception 'remove_deposit_match: match % is not in this agency', p_match_id using errcode = 'P0002';
  end if;
  perform set_config('app.deposit_writer', 'on', true);
  delete from public.deposit_match where id = p_match_id;
  perform set_config('app.deposit_writer', '', true);
  perform public.refresh_bank_match_status(v_txn);
end;
$$;

-- ─── findings ──────────────────────────────────────────────────────────────────────────────────
-- Money that arrived and that we cannot explain.
create or replace function public.deposit_unmatched_deposits(p_tenant_id uuid)
returns table (id uuid, bank_account_id uuid, posted_on date, amount_cents bigint, applied_cents bigint, description_raw text)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select t.id, t.bank_account_id, t.posted_on, t.amount_cents,
         coalesce((select sum(m.amount_applied_cents) from public.deposit_match m where m.bank_transaction_id = t.id and m.confirmed_by is not null), 0)::bigint,
         t.description_raw
    from public.bank_transaction t
   where t.tenant_id = p_tenant_id and t.amount_cents > 0 and t.match_status in ('unmatched', 'suggested', 'partially_matched')
$$;

-- Money a carrier says it paid that never arrived — past its expected lag (LA-4.17, else the
-- agency's matching window), and only where imported bank data covers the date it should have
-- landed by (otherwise it is "not imported", not "not received").
create or replace function public.deposit_unreceived_statements(p_tenant_id uuid, p_today date default current_date)
returns table (statement_id uuid, carrier_id uuid, statement_date date, amount_paid_cents bigint, received_cents bigint, lag_days integer, due_by date)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with s as (
    select s.id, s.carrier_id, s.statement_date, s.amount_paid_cents,
           coalesce((select m.amount_applied_cents from (select sum(d.amount_applied_cents) as amount_applied_cents from public.deposit_match d where d.carrier_account_statement_id = s.id and d.confirmed_by is not null) m), 0)::bigint as received,
           coalesce((select o.expected_lag_days from public.carrier_operating_settings o where o.carrier_id = s.carrier_id and (o.tenant_id = p_tenant_id or o.tenant_id is null) order by o.tenant_id nulls last limit 1),
                    (select a.bank_window_days from public.accounting_settings a where a.tenant_id = p_tenant_id), 21) as lag
      from public.carrier_account_statement s
     where s.tenant_id = p_tenant_id and coalesce(s.amount_paid_cents, 0) > 0
  )
  select s.id, s.carrier_id, s.statement_date, s.amount_paid_cents, s.received, s.lag, s.statement_date + s.lag
    from s
   where s.received < s.amount_paid_cents
     and s.statement_date + s.lag < p_today
     and exists (select 1 from public.bank_transaction t where t.tenant_id = p_tenant_id and t.posted_on >= s.statement_date + s.lag)
$$;

-- LA-4.15 learns the new kind of discrepancy.
alter table public.commission_discrepancy drop constraint if exists commission_discrepancy_type;
alter table public.commission_discrepancy add constraint commission_discrepancy_type check (discrepancy_type in (
  'missing', 'short_paid', 'over_paid', 'mis_rated', 'duplicate_chargeback', 'unexpected_chargeback', 'missing_chargeback', 'held_building_up', 'debit_balance_growing', 'not_received'));

-- ─── access ────────────────────────────────────────────────────────────────────────────────────
alter table public.bank_account enable row level security;
alter table public.bank_import enable row level security;
alter table public.bank_transaction enable row level security;
alter table public.deposit_match enable row level security;
drop policy if exists bank_account_read on public.bank_account;
create policy bank_account_read on public.bank_account for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists bank_import_read on public.bank_import;
create policy bank_import_read on public.bank_import for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists bank_transaction_read on public.bank_transaction;
create policy bank_transaction_read on public.bank_transaction for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists deposit_match_read on public.deposit_match;
create policy deposit_match_read on public.deposit_match for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.bank_account, public.bank_import, public.bank_transaction, public.deposit_match from public, anon, authenticated;
revoke insert, update, delete, truncate on public.bank_account, public.bank_import, public.bank_transaction, public.deposit_match from tenant_app;
grant select on public.bank_account, public.bank_import, public.bank_transaction, public.deposit_match to tenant_app;
-- The account (its name and mapping) is edited directly; lines, imports and matches only by the functions above —
-- except marking a line ignored, and removing a pending suggestion.
revoke delete, truncate on public.bank_account, public.bank_import, public.bank_transaction from service_role;
revoke insert, update on public.bank_import, public.bank_transaction from service_role;
grant select, insert, update on public.bank_account to service_role;
grant select on public.bank_import to service_role;
grant select, update (match_status, ignored_reason) on public.bank_transaction to service_role;
revoke insert, update, truncate on public.deposit_match from service_role;
grant select, delete on public.deposit_match to service_role;

revoke all on function public.bank_transaction_guard() from public, anon, authenticated;
revoke all on function public.deposit_match_guard() from public, anon, authenticated;
revoke all on function public.refresh_bank_match_status(uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.import_bank_rows(uuid, uuid, text, text, jsonb, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.suggest_deposit_matches(uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.confirm_deposit_matches(uuid, uuid[], uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.manual_deposit_match(uuid, uuid, uuid, bigint, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.remove_deposit_match(uuid, uuid, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.deposit_unmatched_deposits(uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.deposit_unreceived_statements(uuid, date) from public, anon, authenticated, tenant_app;
grant execute on function public.refresh_bank_match_status(uuid) to service_role;
grant execute on function public.import_bank_rows(uuid, uuid, text, text, jsonb, uuid) to service_role;
grant execute on function public.suggest_deposit_matches(uuid) to service_role;
grant execute on function public.confirm_deposit_matches(uuid, uuid[], uuid) to service_role;
grant execute on function public.manual_deposit_match(uuid, uuid, uuid, bigint, uuid) to service_role;
grant execute on function public.remove_deposit_match(uuid, uuid, uuid) to service_role;
grant execute on function public.deposit_unmatched_deposits(uuid) to service_role;
grant execute on function public.deposit_unreceived_statements(uuid, date) to service_role;
