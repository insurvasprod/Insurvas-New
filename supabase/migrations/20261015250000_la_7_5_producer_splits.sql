-- LA-7.5 (Notion sprint, Module 7 — Accounting) · producer commission splits and payouts.
--
-- The agency holds the carrier contract; commission arrives to the agency and each producer is owed
-- a share. Not a flat percentage:
--   · usually a share of the ADVANCE — the agency pays out money the client has not yet paid in;
--   · a chargeback flows through: the producer's share comes back too;
--   · so a producer can go NEGATIVE, and it is never clamped to zero;
--   · splits are effective-dated and never rewrite history.
--
--   producer_split          per producer, optionally per carrier / product (null = all; most specific
--                           wins), effective_from. A change is a new row.
--   producer_ledger_entry   one per commission entry that owes this producer something, pointing at
--                           it (commission_entry_id). The split is resolved by the commission entry's
--                           date — and a chargeback by the date of the advance it claws back, so a
--                           November chargeback on an August sale applies August's split.
--                           Balance = sum(amount_cents): positive the agency owes, negative they owe.
--   producer_payout_run     per producer per period: earned, clawed back, withheld against a negative
--                           balance (carry forward — the default — or a capped recovery), net payable.
--                           Publishing books one cost_entry (producer_split) and one split_paid entry.
--   write-off               an explicit adjustment with a reason and a named actor, never a reset.
--
-- LA-4.12's commission ledger is only read. No money is moved.
--
-- Additive. Rollback: select cron.unschedule('la7-producer-ledger'); drop function public.write_off_producer_balance(uuid, uuid, text, uuid),
--   public.void_producer_run(uuid, uuid, text, uuid), public.mark_producer_run_paid(uuid, uuid, date, text, text),
--   public.publish_producer_run(uuid, uuid, uuid), public.build_producer_run(uuid, uuid, date, date, uuid),
--   public.producer_ledger_sync(uuid), public.resolve_producer_split(uuid, uuid, uuid, text, date), public.producer_balances(uuid, uuid);
--   alter table public.cost_entry drop constraint cost_entry_producer_run_fk;
--   drop table public.producer_payout_run cascade, public.producer_ledger_entry, public.producer_split;
--   alter table public.accounting_settings drop column producer_default_split_bp, drop column producer_default_basis,
--     drop column producer_negative_policy, drop column producer_recovery_cap_bp, drop column producers_see_balance, drop column producer_share_fees;

alter table public.accounting_settings
  add column if not exists producer_default_split_bp integer,
  add column if not exists producer_default_basis text not null default 'advance',
  add column if not exists producer_negative_policy text not null default 'carry_forward',
  add column if not exists producer_recovery_cap_bp integer not null default 5000,
  add column if not exists producers_see_balance boolean not null default true,
  add column if not exists producer_share_fees boolean not null default false;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'accounting_settings_producers' and conrelid = 'public.accounting_settings'::regclass) then
    alter table public.accounting_settings add constraint accounting_settings_producers check (
      (producer_default_split_bp is null or producer_default_split_bp between 0 and 10000)
      and producer_default_basis in ('advance', 'earned', 'both')
      and producer_negative_policy in ('carry_forward', 'cap', 'write_off')
      and producer_recovery_cap_bp between 1 and 10000);
  end if;
end;
$$;

create table if not exists public.producer_split (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agency_id uuid,
  producer_user_id uuid not null,
  carrier_id uuid,
  product_code text,
  split_pct_bp integer not null,
  basis text not null default 'advance',
  pays_on text not null default 'advance_received',
  effective_from date not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint producer_split_pct check (split_pct_bp between 0 and 10000),
  constraint producer_split_basis check (basis in ('advance', 'earned', 'both')),
  constraint producer_split_pays_on check (pays_on in ('advance_received', 'first_draft', 'issue')),
  constraint producer_split_product check (product_code is null or char_length(btrim(product_code)) between 1 and 100)
);
create unique index if not exists producer_split_one_per_day on public.producer_split (tenant_id, producer_user_id, coalesce(carrier_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(product_code, ''), effective_from);
create index if not exists producer_split_lookup on public.producer_split (tenant_id, producer_user_id, effective_from desc);

create table if not exists public.producer_ledger_entry (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agency_id uuid,
  producer_user_id uuid not null,
  entry_type text not null,
  policy_number text,
  carrier_id uuid,
  commission_entry_id uuid references public.commission_entry(id) on delete restrict,
  split_id uuid references public.producer_split(id) on delete restrict,
  split_pct_bp_applied integer,
  amount_cents bigint not null,
  occurred_on date not null,
  payout_run_id uuid,
  reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint producer_ledger_type check (entry_type in ('split_advance', 'split_earned', 'split_chargeback', 'split_paid', 'adjustment')),
  constraint producer_ledger_caused check ((entry_type in ('split_advance', 'split_earned', 'split_chargeback')) = (commission_entry_id is not null)),
  constraint producer_ledger_reason check (entry_type <> 'adjustment' or char_length(btrim(coalesce(reason, ''))) between 1 and 500),
  constraint producer_ledger_paid check ((entry_type = 'split_paid') = (payout_run_id is not null) or entry_type = 'adjustment')
);
-- One entry per commission entry per producer: the sync is idempotent.
create unique index if not exists producer_ledger_one_per_commission on public.producer_ledger_entry (commission_entry_id, producer_user_id) where commission_entry_id is not null;
create index if not exists producer_ledger_producer_idx on public.producer_ledger_entry (tenant_id, producer_user_id, occurred_on);

create table if not exists public.producer_payout_run (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agency_id uuid,
  producer_user_id uuid not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft',
  negative_policy text not null,
  balance_before_cents bigint not null default 0,
  earned_cents bigint not null default 0,
  clawed_back_cents bigint not null default 0,
  withheld_cents bigint not null default 0,
  net_cents bigint not null default 0,
  balance_after_cents bigint not null default 0,
  cost_entry_id uuid references public.cost_entry(id) on delete restrict,
  created_by uuid,
  created_at timestamptz not null default now(),
  published_by uuid,
  published_at timestamptz,
  paid_on date,
  paid_method text,
  payment_reference text,
  voided_by uuid,
  voided_at timestamptz,
  void_reason text,
  constraint producer_run_status check (status in ('draft', 'published', 'paid', 'void')),
  constraint producer_run_period check (period_end >= period_start),
  constraint producer_run_policy check (negative_policy in ('carry_forward', 'cap', 'write_off')),
  constraint producer_run_money check (earned_cents >= 0 and clawed_back_cents <= 0 and withheld_cents >= 0 and net_cents >= 0
    and balance_after_cents = balance_before_cents + earned_cents + clawed_back_cents - net_cents),
  constraint producer_run_paid check ((status = 'paid') = (paid_on is not null) or (status = 'void' and voided_at is not null)),
  constraint producer_run_void check ((status = 'void') = (voided_at is not null) and ((status = 'void') = (void_reason is not null)))
);
create unique index if not exists producer_run_one_live on public.producer_payout_run (tenant_id, producer_user_id, period_start) where status <> 'void';
create index if not exists producer_run_tenant_idx on public.producer_payout_run (tenant_id, period_start desc);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'producer_ledger_run_fk' and conrelid = 'public.producer_ledger_entry'::regclass) then
    alter table public.producer_ledger_entry add constraint producer_ledger_run_fk foreign key (payout_run_id) references public.producer_payout_run(id) on delete restrict;
  end if;
end;
$$;

-- ─── history is not rewritten ──────────────────────────────────────────────────────────────────
create or replace function public.producer_immutable_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  raise exception '% is never changed or removed: a split changes with a new effective date; a correction is an adjustment.', tg_table_name using errcode = 'P0001';
end;
$$;
drop trigger if exists producer_split_guard on public.producer_split;
create trigger producer_split_guard before update or delete on public.producer_split for each row execute function public.producer_immutable_guard();
drop trigger if exists producer_ledger_guard on public.producer_ledger_entry;
create trigger producer_ledger_guard before update or delete on public.producer_ledger_entry for each row execute function public.producer_immutable_guard();

create or replace function public.producer_run_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A producer payout run is never removed; void it instead.' using errcode = 'P0001';
  end if;
  if coalesce(current_setting('app.producer_writer', true), '') <> 'on' then
    raise exception 'A producer payout run changes only through its own actions.' using errcode = 'P0001';
  end if;
  if old.status <> 'draft' and (new.balance_before_cents, new.earned_cents, new.clawed_back_cents, new.withheld_cents, new.net_cents, new.period_start, new.period_end)
       is distinct from (old.balance_before_cents, old.earned_cents, old.clawed_back_cents, old.withheld_cents, old.net_cents, old.period_start, old.period_end) then
    raise exception 'A published run is history: void it and build it again.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists producer_run_guard on public.producer_payout_run;
create trigger producer_run_guard before update or delete on public.producer_payout_run for each row execute function public.producer_run_guard();

-- ─── which split applies ───────────────────────────────────────────────────────────────────────
-- Most specific first (carrier and product, carrier, product, everything), then the latest in force on the date.
create or replace function public.resolve_producer_split(p_tenant_id uuid, p_producer uuid, p_carrier uuid, p_product text, p_on date)
returns public.producer_split
language sql
stable
set search_path = public, pg_catalog
as $$
  select s.* from public.producer_split s
   where s.tenant_id = p_tenant_id and s.producer_user_id = p_producer and s.effective_from <= p_on
     and (s.carrier_id is null or s.carrier_id = p_carrier) and (s.product_code is null or s.product_code = p_product)
   order by (s.carrier_id is not null and s.product_code is not null) desc, (s.carrier_id is not null) desc, (s.product_code is not null) desc, s.effective_from desc
   limit 1
$$;

-- ─── the sync: commission entries → producer entries ───────────────────────────────────────────
create or replace function public.producer_ledger_sync(p_tenant_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_n integer;
begin
  with src as (
    select e.id, e.tenant_id, e.agency_id, e.agent_user_id as producer, e.carrier_id, e.policy_number, e.amount_cents,
           coalesce(case when e.entry_type = 'reversal' then e.corrects_type end, e.entry_type) as kind,
           coalesce(e.transaction_date, e.statement_date) as on_date,
           pc.product_code, pc.issue_date, pc.months_paid
      from public.commission_entry e
      left join public.policy_current pc on pc.tenant_id = e.tenant_id and pc.carrier_id = e.carrier_id and pc.policy_number = e.policy_number
     where (p_tenant_id is null or e.tenant_id = p_tenant_id)
       and e.agent_user_id is not null and coalesce(e.payee_level, 'writing_agent') = 'writing_agent'
       and exists (select 1 from public.tenant_users u where u.tenant_id = e.tenant_id and u.user_id = e.agent_user_id)
       and not exists (select 1 from public.producer_ledger_entry p where p.commission_entry_id = e.id and p.producer_user_id = e.agent_user_id)
  ),
  dated as (
    -- A chargeback is split at the rate of the sale it claws back: the policy's first advance.
    select s.*,
           case when s.kind = 'chargeback' then coalesce((select min(coalesce(a.transaction_date, a.statement_date)) from public.commission_entry a
                                                            where a.tenant_id = s.tenant_id and a.carrier_id = s.carrier_id and a.policy_number = s.policy_number and a.entry_type = 'advance'), s.on_date)
                else s.on_date end as split_on
      from src s
     where s.kind in ('advance', 'earned', 'chargeback')
        or (s.kind = 'fee' and coalesce((select a.producer_share_fees from public.accounting_settings a where a.tenant_id = s.tenant_id), false))
  ),
  resolved as (
    select d.*, sp.id as split_id, sp.split_pct_bp, sp.basis, sp.pays_on
      from dated d
      cross join lateral public.resolve_producer_split(d.tenant_id, d.producer, d.carrier_id, d.product_code, d.split_on) sp
     where sp.id is not null
  ),
  owed as (
    select r.* from resolved r
     where (r.kind = 'chargeback' or r.kind = 'fee' or r.basis = 'both' or (r.basis = 'advance' and r.kind = 'advance') or (r.basis = 'earned' and r.kind = 'earned'))
       -- When the share becomes owed: on the advance, at issue, or once the first draft has been paid.
       and (r.kind = 'chargeback' or r.pays_on = 'advance_received'
            or (r.pays_on = 'issue' and r.issue_date is not null and r.issue_date <= current_date)
            or (r.pays_on = 'first_draft' and coalesce(r.months_paid, 0) >= 1))
  )
  insert into public.producer_ledger_entry (tenant_id, agency_id, producer_user_id, entry_type, policy_number, carrier_id, commission_entry_id, split_id, split_pct_bp_applied, amount_cents, occurred_on)
  select o.tenant_id, o.agency_id, o.producer,
         case o.kind when 'advance' then 'split_advance' when 'earned' then 'split_earned' when 'fee' then 'split_earned' else 'split_chargeback' end,
         o.policy_number, o.carrier_id, o.id, o.split_id, o.split_pct_bp, public.bp_share(o.amount_cents, o.split_pct_bp),
         case when o.pays_on = 'issue' and o.kind <> 'chargeback' then greatest(o.on_date, o.issue_date) else o.on_date end
    from owed o
  on conflict (commission_entry_id, producer_user_id) where commission_entry_id is not null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('la7-producer-ledger', '15 5 * * *', $job$select public.producer_ledger_sync(null)$job$);
  end if;
end;
$$;

-- ─── runs ──────────────────────────────────────────────────────────────────────────────────────
create or replace function public.build_producer_run(p_tenant_id uuid, p_producer uuid, p_from date, p_to date, p_by uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_policy text;
  v_cap integer;
  v_before bigint;
  v_earned bigint;
  v_clawed bigint;
  v_period bigint;
  v_due bigint;
  v_net bigint;
  v_withheld bigint;
  v_run uuid;
begin
  if p_to < p_from then
    raise exception 'build_producer_run: the period ends before it starts' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenant_users u where u.tenant_id = p_tenant_id and u.user_id = p_producer) then
    raise exception 'build_producer_run: % is not in this agency', p_producer using errcode = 'P0002';
  end if;
  if exists (select 1 from public.producer_payout_run r where r.tenant_id = p_tenant_id and r.producer_user_id = p_producer and r.status <> 'void'
                and r.period_start <= p_to and r.period_end >= p_from) then
    raise exception 'build_producer_run: a run already covers part of this period' using errcode = '23505';
  end if;
  perform public.producer_ledger_sync(p_tenant_id);
  select coalesce(a.producer_negative_policy, 'carry_forward'), coalesce(a.producer_recovery_cap_bp, 5000) into v_policy, v_cap
    from (select 1) x left join public.accounting_settings a on a.tenant_id = p_tenant_id;

  select coalesce(sum(amount_cents), 0) into v_before from public.producer_ledger_entry where tenant_id = p_tenant_id and producer_user_id = p_producer and occurred_on < p_from;
  select coalesce(sum(amount_cents) filter (where amount_cents > 0), 0), coalesce(sum(amount_cents) filter (where amount_cents < 0), 0)
    into v_earned, v_clawed from public.producer_ledger_entry
   where tenant_id = p_tenant_id and producer_user_id = p_producer and occurred_on between p_from and p_to and entry_type <> 'split_paid';
  v_period := v_earned + v_clawed;
  v_due := v_before + v_period;
  if v_policy = 'cap' and v_before < 0 then
    -- Recover at most the configured share of what this period earned; the rest is paid.
    v_withheld := least(-v_before, public.bp_share(greatest(v_period, 0), v_cap));
    v_net := greatest(v_period - v_withheld, 0);
  else
    -- Carry forward (and write-off, which is an explicit action, not a quiet reset): nothing is paid until the balance clears.
    v_net := greatest(v_due, 0);
    v_withheld := greatest(greatest(v_period, 0) - v_net, 0);
  end if;

  perform set_config('app.producer_writer', 'on', true);
  insert into public.producer_payout_run (tenant_id, producer_user_id, period_start, period_end, negative_policy, balance_before_cents, earned_cents, clawed_back_cents, withheld_cents, net_cents, balance_after_cents, created_by)
  values (p_tenant_id, p_producer, p_from, p_to, v_policy, v_before, v_earned, v_clawed, v_withheld, v_net, v_due - v_net, p_by)
  returning id into v_run;
  perform set_config('app.producer_writer', '', true);
  return v_run;
end;
$$;

create or replace function public.publish_producer_run(p_tenant_id uuid, p_run_id uuid, p_by uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r public.producer_payout_run;
  v_entry uuid;
begin
  select * into r from public.producer_payout_run where id = p_run_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'publish_producer_run: run % is not in this agency', p_run_id using errcode = 'P0002';
  end if;
  if r.status <> 'draft' then
    raise exception 'publish_producer_run: only a draft is published' using errcode = '22023';
  end if;
  if r.net_cents > 0 then
    v_entry := public.record_cost_entry(p_tenant_id, jsonb_build_object('agency_id', r.agency_id, 'entry_type', 'producer_split', 'amount_cents', -r.net_cents,
      'incurred_on', r.period_end, 'counterparty_type', 'producer', 'counterparty_id', r.producer_user_id, 'producer_user_id', r.producer_user_id,
      'description', 'Producer split ' || to_char(r.period_start, 'DD Mon') || ' – ' || to_char(r.period_end, 'DD Mon YYYY')), p_by);
    -- What is paid comes off what is owed.
    insert into public.producer_ledger_entry (tenant_id, agency_id, producer_user_id, entry_type, amount_cents, occurred_on, payout_run_id, created_by)
    values (p_tenant_id, r.agency_id, r.producer_user_id, 'split_paid', -r.net_cents, r.period_end, r.id, p_by);
  end if;
  perform set_config('app.producer_writer', 'on', true);
  update public.producer_payout_run set status = 'published', published_by = p_by, published_at = now(), cost_entry_id = v_entry where id = r.id;
  perform set_config('app.producer_writer', '', true);
  return v_entry;
end;
$$;

create or replace function public.mark_producer_run_paid(p_tenant_id uuid, p_run_id uuid, p_paid_on date, p_method text, p_reference text)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r public.producer_payout_run;
  v_ids uuid[];
  v_n integer;
begin
  select * into r from public.producer_payout_run where id = p_run_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'mark_producer_run_paid: run % is not in this agency', p_run_id using errcode = 'P0002';
  end if;
  if r.status <> 'published' or p_paid_on is null then
    raise exception 'mark_producer_run_paid: a published run and a payment date are needed' using errcode = '22023';
  end if;
  v_ids := case when r.cost_entry_id is null then '{}'::uuid[] else array[r.cost_entry_id] end;
  v_n := public.mark_cost_entries_paid(p_tenant_id, v_ids, p_paid_on);
  perform set_config('app.producer_writer', 'on', true);
  update public.producer_payout_run set status = 'paid', paid_on = p_paid_on, paid_method = nullif(btrim(p_method), ''), payment_reference = nullif(btrim(p_reference), '') where id = r.id;
  perform set_config('app.producer_writer', '', true);
  return v_n;
end;
$$;

create or replace function public.void_producer_run(p_tenant_id uuid, p_run_id uuid, p_reason text, p_by uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r public.producer_payout_run;
  e record;
  v_n integer := 0;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'void_producer_run: say why' using errcode = '22023';
  end if;
  select * into r from public.producer_payout_run where id = p_run_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'void_producer_run: run % is not in this agency', p_run_id using errcode = 'P0002';
  end if;
  if r.status = 'void' then
    raise exception 'void_producer_run: already void' using errcode = '22023';
  end if;
  if r.status <> 'draft' and r.net_cents > 0 then
    for e in select c.id from public.cost_entry c
              where c.tenant_id = p_tenant_id and c.id = r.cost_entry_id
                and not exists (select 1 from public.cost_entry x where x.reverses_entry_id = c.id) loop
      perform public.reverse_cost_entry(p_tenant_id, e.id, 'Producer run voided: ' || btrim(p_reason), p_by);
      v_n := v_n + 1;
    end loop;
    -- The paid amount goes back onto what is owed.
    insert into public.producer_ledger_entry (tenant_id, agency_id, producer_user_id, entry_type, amount_cents, occurred_on, reason, created_by)
    values (p_tenant_id, r.agency_id, r.producer_user_id, 'adjustment', r.net_cents, r.period_end, left('Run voided: ' || btrim(p_reason), 500), p_by);
  end if;
  perform set_config('app.producer_writer', 'on', true);
  update public.producer_payout_run set status = 'void', voided_by = p_by, voided_at = now(), void_reason = left(btrim(p_reason), 500) where id = r.id;
  perform set_config('app.producer_writer', '', true);
  return v_n;
end;
$$;

-- The agency absorbs a negative balance: an explicit adjustment, with the reason and who decided.
create or replace function public.write_off_producer_balance(p_tenant_id uuid, p_producer uuid, p_reason text, p_by uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_balance bigint;
begin
  if p_by is null then
    raise exception 'write_off_producer_balance: a write-off is made by a named person' using errcode = '22023';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'write_off_producer_balance: say why the agency is absorbing it' using errcode = '22023';
  end if;
  select coalesce(sum(amount_cents), 0) into v_balance from public.producer_ledger_entry where tenant_id = p_tenant_id and producer_user_id = p_producer;
  if v_balance >= 0 then
    raise exception 'write_off_producer_balance: there is no negative balance to write off' using errcode = '22023';
  end if;
  insert into public.producer_ledger_entry (tenant_id, producer_user_id, entry_type, amount_cents, occurred_on, reason, created_by)
  values (p_tenant_id, p_producer, 'adjustment', -v_balance, current_date, left('Written off: ' || btrim(p_reason), 500), p_by);
  return -v_balance;
end;
$$;

-- Each producer's balance, summed in the database (the API caps a read at 1,000 rows).
create or replace function public.producer_balances(p_tenant_id uuid, p_producer uuid default null)
returns table (producer_user_id uuid, balance_cents bigint, owed_cents bigint, clawed_back_cents bigint, paid_cents bigint, adjusted_cents bigint, entries bigint, last_on date)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select e.producer_user_id,
         sum(e.amount_cents)::bigint,
         coalesce(sum(e.amount_cents) filter (where e.entry_type in ('split_advance', 'split_earned')), 0)::bigint,
         coalesce(sum(e.amount_cents) filter (where e.entry_type = 'split_chargeback'), 0)::bigint,
         coalesce(sum(e.amount_cents) filter (where e.entry_type = 'split_paid'), 0)::bigint,
         coalesce(sum(e.amount_cents) filter (where e.entry_type = 'adjustment'), 0)::bigint,
         count(*)::bigint,
         max(e.occurred_on)
    from public.producer_ledger_entry e
   where e.tenant_id = p_tenant_id and (p_producer is null or e.producer_user_id = p_producer)
   group by e.producer_user_id
$$;

-- ─── access ────────────────────────────────────────────────────────────────────────────────────
alter table public.producer_split enable row level security;
alter table public.producer_ledger_entry enable row level security;
alter table public.producer_payout_run enable row level security;
drop policy if exists producer_split_read on public.producer_split;
create policy producer_split_read on public.producer_split for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists producer_ledger_read on public.producer_ledger_entry;
create policy producer_ledger_read on public.producer_ledger_entry for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists producer_run_read on public.producer_payout_run;
create policy producer_run_read on public.producer_payout_run for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.producer_split, public.producer_ledger_entry, public.producer_payout_run from public, anon, authenticated;
revoke insert, update, delete, truncate on public.producer_split, public.producer_ledger_entry, public.producer_payout_run from tenant_app;
revoke update, delete, truncate on public.producer_split, public.producer_ledger_entry, public.producer_payout_run from service_role;
revoke insert on public.producer_ledger_entry, public.producer_payout_run from service_role;
grant select on public.producer_split, public.producer_ledger_entry, public.producer_payout_run to service_role, tenant_app;
-- A split is recorded directly (a new row is the only change there is).
grant insert on public.producer_split to service_role;

revoke all on function public.producer_immutable_guard() from public, anon, authenticated;
revoke all on function public.producer_run_guard() from public, anon, authenticated;
revoke all on function public.resolve_producer_split(uuid, uuid, uuid, text, date) from public, anon, authenticated;
grant execute on function public.resolve_producer_split(uuid, uuid, uuid, text, date) to service_role, tenant_app;
revoke all on function public.producer_ledger_sync(uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.build_producer_run(uuid, uuid, date, date, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.publish_producer_run(uuid, uuid, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.mark_producer_run_paid(uuid, uuid, date, text, text) from public, anon, authenticated, tenant_app;
revoke all on function public.void_producer_run(uuid, uuid, text, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.write_off_producer_balance(uuid, uuid, text, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.producer_ledger_sync(uuid) to service_role;
grant execute on function public.build_producer_run(uuid, uuid, date, date, uuid) to service_role;
grant execute on function public.publish_producer_run(uuid, uuid, uuid) to service_role;
grant execute on function public.mark_producer_run_paid(uuid, uuid, date, text, text) to service_role;
grant execute on function public.void_producer_run(uuid, uuid, text, uuid) to service_role;
grant execute on function public.write_off_producer_balance(uuid, uuid, text, uuid) to service_role;
revoke all on function public.producer_balances(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.producer_balances(uuid, uuid) to service_role;
