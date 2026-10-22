-- ============================================================================
-- Pending migrations — 10 files, each in its own transaction
-- Generated 2026-10-15 by scripts/build-pending-bundle.mjs. Do not hand-edit; regenerate.
--
-- HOW TO RUN: Supabase dashboard → SQL editor → paste this whole file → Run.
-- Each file is begin … commit on its own. The SQL editor STOPS at the first error: that file is
-- rolled back, the files before it stay applied, and nothing after it runs. Fix the named file,
-- regenerate, and run the whole script again — re-running is safe: the files use
-- create-or-replace / if-not-exists, and history rows use on-conflict-do-nothing.
--
-- AFTERWARDS: node --env-file=.env.local scripts/verify-applied-migrations.mjs
--
-- Files, in order:
--    1. 20261015190000_la_6_index_by_event_type.sql
--    2. 20261015200000_la_7_1_cost_ledger.sql
--    3. 20261015210000_la_7_2_vendor_invoices.sql
--    4. 20261015220000_la_7_3_expenses.sql
--    5. 20261015230000_la_7_7_pnl.sql
--    6. 20261015240000_la_7_4_partner_payouts.sql
--    7. 20261015250000_la_7_5_producer_splits.sql
--    8. 20261015260000_la_7_6_bank_matching.sql
--    9. 20261015270000_la_7_8_tax.sql
--   10. 20261015280000_la_7_9_accounting_settings.sql
-- ============================================================================

-- ─── [1/10] 20261015190000_la_6_index_by_event_type.sql ───────────────────────────
begin;

-- LA-6.3 / LA-6.7 (Notion sprint, Module 6 — Compliance) · the gap checks read the index by agency and
-- record type ("every call of this agency", "every consent of this agency") several times per scan.
-- With only the (agency, number, time) index, each of those reads walked the agency's whole index:
-- the demo agency's book-wide scan took 4.8 s live, against 1 s on a copy that had this index — and
-- the dashboard (LA-6.7) must load in under a second.
--
-- Additive. Rollback: drop index if exists public.compliance_index_type_idx;

create index if not exists compliance_index_type_idx on public.compliance_index (tenant_id, event_type, phone_digits, event_at);
analyze public.compliance_index;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261015190000', 'la_6_index_by_event_type') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [2/10] 20261015200000_la_7_1_cost_ledger.sql ─────────────────────────────────
begin;

-- LA-7.1 (Notion sprint, Module 7 — Accounting) · the cost ledger and the unified money view.
--
-- Money in already has a ledger: LA-4.12's commission_entry (and commission_account_entry for lines
-- with no policy). Money out had none. Two tables, one view: commission_entry keeps the shape built
-- for commissions and is only ever READ here; cost_entry holds lead costs, payouts, splits,
-- subscriptions and fees; money_entry unions both into one row shape so every money question is
-- one query.
--
-- Rules this file enforces:
--   · integer cents (bigint), signed: money out is negative, so net is sum(amount_cents);
--   · immutable: no edit, no delete — a correction is a reversing entry (reverses_entry_id); the one
--     change allowed is recording WHEN money moved (paid_on, null → a date, nothing else);
--   · accrual and cash are two dates: incurred_on (the period it belongs to) and paid_on (when it left).
--
-- Attachments (campaign, vendor, partner, producer, carrier, invoice, payout run, expense) are plain
-- uuids checked against the tenant by the writer, not foreign keys: a ledger row must outlive what
-- it points at, and "on delete set null" would be an edit. 7.2 / 7.3 / 7.4 add the source tables.
--
-- Additive. Rollback: drop view public.money_entry; drop function public.record_cost_entry(uuid, jsonb, uuid);
--   drop function public.reverse_cost_entry(uuid, uuid, text, uuid, date);
--   drop function public.money_net(uuid, date, date, text); drop function public.mark_cost_entries_paid(uuid, uuid[], date);
--   drop table public.cost_entry; drop index if exists public.commission_entry_period_idx, public.commission_account_entry_period_idx;

create table if not exists public.cost_entry (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agency_id uuid,
  entry_type text not null,
  amount_cents bigint not null,
  incurred_on date not null,
  paid_on date,
  counterparty_type text not null,
  counterparty_id uuid,
  counterparty_name text,
  campaign_id uuid,
  vendor_id uuid,
  partner_id uuid,
  policy_number text,
  carrier_id uuid,
  producer_user_id uuid,
  invoice_id uuid,
  payout_run_id uuid,
  expense_id uuid,
  description text not null,
  tax_category text,
  created_by uuid,
  created_at timestamptz not null default now(),
  reverses_entry_id uuid references public.cost_entry(id) on delete restrict,
  reversal_reason text,
  constraint cost_entry_type check (entry_type in ('lead_cost', 'partner_payout', 'producer_split', 'platform_fee', 'tool_subscription', 'insurance', 'professional_fee', 'refund', 'adjustment')),
  constraint cost_entry_counterparty check (counterparty_type in ('vendor', 'partner', 'producer', 'platform', 'other')),
  -- Money out is negative; a refund is money back; an adjustment goes either way. A reversal mirrors
  -- its original (checked by the writer), so it is exempt here.
  constraint cost_entry_sign check (
    reverses_entry_id is not null
    or (entry_type = 'refund' and amount_cents > 0)
    or (entry_type = 'adjustment' and amount_cents <> 0)
    or (entry_type not in ('refund', 'adjustment') and amount_cents < 0)
  ),
  constraint cost_entry_reverses check ((reverses_entry_id is null) = (reversal_reason is null)),
  constraint cost_entry_reason check (reversal_reason is null or char_length(btrim(reversal_reason)) between 1 and 500),
  constraint cost_entry_description check (char_length(btrim(description)) between 1 and 500),
  constraint cost_entry_policy check (policy_number is null or char_length(policy_number) between 1 and 100),
  constraint cost_entry_paid check (paid_on is null or paid_on >= date '2000-01-01')
);
create unique index if not exists cost_entry_one_reversal on public.cost_entry (reverses_entry_id) where reverses_entry_id is not null;
create index if not exists cost_entry_incurred_idx on public.cost_entry (tenant_id, incurred_on);
create index if not exists cost_entry_paid_idx on public.cost_entry (tenant_id, paid_on) where paid_on is not null;
create index if not exists cost_entry_vendor_idx on public.cost_entry (tenant_id, vendor_id) where vendor_id is not null;
create index if not exists cost_entry_campaign_idx on public.cost_entry (tenant_id, campaign_id) where campaign_id is not null;
create index if not exists cost_entry_partner_idx on public.cost_entry (tenant_id, partner_id) where partner_id is not null;
create index if not exists cost_entry_producer_idx on public.cost_entry (tenant_id, producer_user_id) where producer_user_id is not null;
create index if not exists cost_entry_invoice_idx on public.cost_entry (invoice_id) where invoice_id is not null;
create index if not exists cost_entry_payout_idx on public.cost_entry (payout_run_id) where payout_run_id is not null;
create index if not exists cost_entry_expense_idx on public.cost_entry (expense_id) where expense_id is not null;

-- The money view filters commission by its period; the existing indexes lead with carrier or statement date.
create index if not exists commission_entry_period_idx on public.commission_entry (tenant_id, (coalesce(transaction_date, statement_date)));
create index if not exists commission_account_entry_period_idx on public.commission_account_entry (tenant_id, (coalesce(transaction_date, statement_date)));

-- ─── immutable, but for recording when it was paid ─────────────────────────────────────────────
create or replace function public.cost_entry_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A cost entry is never removed; write a reversing entry instead.' using errcode = 'P0001';
  end if;
  -- The one permitted change: recording when the money left. Once, and nothing else.
  if old.paid_on is null and new.paid_on is not null
     and (to_jsonb(new) - 'paid_on') = (to_jsonb(old) - 'paid_on') then
    return new;
  end if;
  raise exception 'A cost entry is never changed; write a reversing entry instead.' using errcode = 'P0001';
end;
$$;
drop trigger if exists cost_entry_guard on public.cost_entry;
create trigger cost_entry_guard before update or delete on public.cost_entry
  for each row execute function public.cost_entry_guard();

-- ─── the only writers ──────────────────────────────────────────────────────────────────────────
-- One entry, attachments checked against the tenant. Returns its id.
create or replace function public.record_cost_entry(p_tenant_id uuid, p_entry jsonb, p_created_by uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_id uuid;
  v_campaign uuid := nullif(p_entry->>'campaign_id', '')::uuid;
  v_vendor uuid := nullif(p_entry->>'vendor_id', '')::uuid;
  v_partner uuid := nullif(p_entry->>'partner_id', '')::uuid;
  v_producer uuid := nullif(p_entry->>'producer_user_id', '')::uuid;
  v_carrier uuid := nullif(p_entry->>'carrier_id', '')::uuid;
  v_amount bigint;
begin
  if p_tenant_id is null then
    raise exception 'record_cost_entry: tenant is required' using errcode = '22023';
  end if;
  -- Integer cents only: "12.5" or 12.5 is refused rather than rounded.
  if jsonb_typeof(p_entry->'amount_cents') is distinct from 'number' or (p_entry->>'amount_cents') !~ '^-?[0-9]+$' then
    raise exception 'record_cost_entry: amount_cents must be a whole number of cents' using errcode = '22023';
  end if;
  v_amount := (p_entry->>'amount_cents')::bigint;
  if v_campaign is not null and not exists (select 1 from public.tenant_campaigns c where c.id = v_campaign and c.tenant_id = p_tenant_id) then
    raise exception 'record_cost_entry: campaign % is not in this agency', v_campaign using errcode = 'P0002';
  end if;
  if v_vendor is not null and not exists (select 1 from public.tenant_lead_vendors v where v.id = v_vendor and v.tenant_id = p_tenant_id) then
    raise exception 'record_cost_entry: vendor % is not in this agency', v_vendor using errcode = 'P0002';
  end if;
  if v_partner is not null and not exists (select 1 from public.partners p where p.id = v_partner and p.tenant_id = p_tenant_id) then
    raise exception 'record_cost_entry: partner % is not in this agency', v_partner using errcode = 'P0002';
  end if;
  if v_producer is not null and not exists (select 1 from public.tenant_users u where u.user_id = v_producer and u.tenant_id = p_tenant_id) then
    raise exception 'record_cost_entry: producer % is not in this agency', v_producer using errcode = 'P0002';
  end if;
  if v_carrier is not null and not exists (select 1 from public.carriers c where c.id = v_carrier) then
    raise exception 'record_cost_entry: carrier % is unknown', v_carrier using errcode = 'P0002';
  end if;

  insert into public.cost_entry (tenant_id, agency_id, entry_type, amount_cents, incurred_on, paid_on, counterparty_type, counterparty_id, counterparty_name,
                                 campaign_id, vendor_id, partner_id, policy_number, carrier_id, producer_user_id, invoice_id, payout_run_id, expense_id,
                                 description, tax_category, created_by)
  values (p_tenant_id, nullif(p_entry->>'agency_id', '')::uuid, p_entry->>'entry_type', v_amount, (p_entry->>'incurred_on')::date, nullif(p_entry->>'paid_on', '')::date,
          p_entry->>'counterparty_type', nullif(p_entry->>'counterparty_id', '')::uuid, nullif(btrim(p_entry->>'counterparty_name'), ''),
          v_campaign, v_vendor, v_partner, nullif(btrim(p_entry->>'policy_number'), ''), v_carrier, v_producer,
          nullif(p_entry->>'invoice_id', '')::uuid, nullif(p_entry->>'payout_run_id', '')::uuid, nullif(p_entry->>'expense_id', '')::uuid,
          btrim(coalesce(p_entry->>'description', '')), nullif(btrim(p_entry->>'tax_category'), ''), p_created_by)
  returning id into v_id;
  return v_id;
end;
$$;

-- A correction: the mirror of the original, same type and attachments, opposite amount, dated today
-- unless told otherwise (a reversal of an August cost made in October is an October event).
create or replace function public.reverse_cost_entry(p_tenant_id uuid, p_entry_id uuid, p_reason text, p_by uuid, p_on date default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  o public.cost_entry;
  v_id uuid;
begin
  select * into o from public.cost_entry where id = p_entry_id and tenant_id = p_tenant_id;
  if not found then
    raise exception 'reverse_cost_entry: entry % is not in this agency', p_entry_id using errcode = 'P0002';
  end if;
  if o.reverses_entry_id is not null then
    raise exception 'reverse_cost_entry: a reversal is not itself reversed; record a new entry instead' using errcode = '22023';
  end if;
  if exists (select 1 from public.cost_entry r where r.reverses_entry_id = o.id) then
    raise exception 'reverse_cost_entry: entry % is already reversed', o.id using errcode = '23505';
  end if;
  insert into public.cost_entry (tenant_id, agency_id, entry_type, amount_cents, incurred_on, paid_on, counterparty_type, counterparty_id, counterparty_name,
                                 campaign_id, vendor_id, partner_id, policy_number, carrier_id, producer_user_id, invoice_id, payout_run_id, expense_id,
                                 description, tax_category, created_by, reverses_entry_id, reversal_reason)
  values (o.tenant_id, o.agency_id, o.entry_type, -o.amount_cents, coalesce(p_on, current_date), case when o.paid_on is null then null else coalesce(p_on, current_date) end,
          o.counterparty_type, o.counterparty_id, o.counterparty_name, o.campaign_id, o.vendor_id, o.partner_id, o.policy_number, o.carrier_id, o.producer_user_id,
          o.invoice_id, o.payout_run_id, o.expense_id, left('Reversal: ' || o.description, 500), o.tax_category, p_by, o.id, btrim(p_reason))
  returning id into v_id;
  return v_id;
end;
$$;

-- Payment records only when money moved; it never changes what the cost was or when it was incurred.
create or replace function public.mark_cost_entries_paid(p_tenant_id uuid, p_ids uuid[], p_paid_on date)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_count integer;
begin
  if p_paid_on is null then
    raise exception 'mark_cost_entries_paid: a payment date is required' using errcode = '22023';
  end if;
  update public.cost_entry set paid_on = p_paid_on
   where tenant_id = p_tenant_id and id = any(p_ids) and paid_on is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ─── the unified view: both directions, one row shape ──────────────────────────────────────────
-- Commission rows: incurred_on is the transaction date (the statement date when the carrier gave
-- none); paid_on is the statement date — what the carrier SAYS it paid (reported). What actually
-- landed in the bank is LA-7.6 and is never blended into this column.
-- Lead source of a commission row resolves the way LA-4.18's scorecards do: the agent's own
-- attribution on the policy (policy_annotation) wins, else policy_current's; a campaign supplies
-- its vendor. Through the primary keys of both, so the join is indexed.
create or replace view public.money_entry
with (security_invoker = true) as
select 'commission'::text as side,
       e.id as entry_id, e.tenant_id, e.agency_id, e.entry_type, e.amount_cents,
       coalesce(e.transaction_date, e.statement_date) as incurred_on,
       e.statement_date as paid_on,
       'carrier'::text as counterparty_type, e.carrier_id as counterparty_id,
       e.carrier_id, e.policy_number,
       case when a.lead_vendor_id is not null or a.lead_campaign_id is not null then a.lead_campaign_id else pc.campaign_id end as campaign_id,
       case when a.lead_vendor_id is not null or a.lead_campaign_id is not null
            then coalesce(a.lead_vendor_id, (select c.vendor_id from public.tenant_campaigns c where c.id = a.lead_campaign_id))
            else coalesce(pc.vendor_id, (select c.vendor_id from public.tenant_campaigns c where c.id = pc.campaign_id)) end as vendor_id,
       null::uuid as partner_id, e.agent_user_id as producer_user_id,
       null::uuid as invoice_id, null::uuid as payout_run_id, null::uuid as expense_id, e.file_id as source_file_id,
       null::text as description, e.reverses_entry_id, e.created_at
  from public.commission_entry e
  left join public.policy_current pc on pc.tenant_id = e.tenant_id and pc.carrier_id = e.carrier_id and pc.policy_number = e.policy_number
  left join public.policy_annotation a on a.tenant_id = e.tenant_id and a.carrier_id = e.carrier_id and a.policy_number = e.policy_number
union all
select 'commission'::text, e.id, e.tenant_id, e.agency_id, e.entry_type, e.amount_cents,
       coalesce(e.transaction_date, e.statement_date), e.statement_date,
       'carrier'::text, e.carrier_id, e.carrier_id, null::text,
       null::uuid, null::uuid, null::uuid, null::uuid,
       null::uuid, null::uuid, null::uuid, e.file_id,
       e.description, e.reverses_entry_id, e.created_at
  from public.commission_account_entry e
union all
select 'cost'::text, c.id, c.tenant_id, c.agency_id, c.entry_type, c.amount_cents,
       c.incurred_on, c.paid_on,
       c.counterparty_type, c.counterparty_id, c.carrier_id, c.policy_number,
       c.campaign_id, c.vendor_id, c.partner_id, c.producer_user_id,
       c.invoice_id, c.payout_run_id, c.expense_id, null::uuid,
       c.description, c.reverses_entry_id, c.created_at
  from public.cost_entry c;

-- Net for a period, on either basis, summed in the database in bigint (no float at any layer). One
-- query per basis so the period predicate reaches each branch's index.
create or replace function public.money_net(p_tenant_id uuid, p_from date, p_to date, p_basis text default 'accrual')
returns table (side text, entry_type text, amount_cents bigint, entries bigint)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  if p_basis not in ('accrual', 'cash') then
    raise exception 'money_net: basis is accrual or cash' using errcode = '22023';
  end if;
  if p_basis = 'cash' then
    return query select m.side, m.entry_type, sum(m.amount_cents)::bigint, count(*)::bigint
                   from public.money_entry m
                  where m.tenant_id = p_tenant_id and m.paid_on >= p_from and m.paid_on < p_to
                  group by m.side, m.entry_type;
  else
    return query select m.side, m.entry_type, sum(m.amount_cents)::bigint, count(*)::bigint
                   from public.money_entry m
                  where m.tenant_id = p_tenant_id and m.incurred_on >= p_from and m.incurred_on < p_to
                  group by m.side, m.entry_type;
  end if;
end;
$$;

-- ─── access ────────────────────────────────────────────────────────────────────────────────────
alter table public.cost_entry enable row level security;
drop policy if exists cost_entry_read on public.cost_entry;
create policy cost_entry_read on public.cost_entry for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.cost_entry from public, anon, authenticated;
-- Supabase grants service_role everything on a new table: take back all but reading.
revoke insert, update, delete, truncate on public.cost_entry from service_role, tenant_app;
grant select on public.cost_entry to service_role, tenant_app;
revoke all on public.money_entry from public, anon, authenticated;
grant select on public.money_entry to service_role, tenant_app;
revoke all on function public.cost_entry_guard() from public, anon, authenticated;
revoke all on function public.record_cost_entry(uuid, jsonb, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.reverse_cost_entry(uuid, uuid, text, uuid, date) from public, anon, authenticated, tenant_app;
revoke all on function public.mark_cost_entries_paid(uuid, uuid[], date) from public, anon, authenticated, tenant_app;
revoke all on function public.money_net(uuid, date, date, text) from public, anon, authenticated, tenant_app;
grant execute on function public.record_cost_entry(uuid, jsonb, uuid) to service_role;
grant execute on function public.reverse_cost_entry(uuid, uuid, text, uuid, date) to service_role;
grant execute on function public.mark_cost_entries_paid(uuid, uuid[], date) to service_role;
grant execute on function public.money_net(uuid, date, date, text) to service_role;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261015200000', 'la_7_1_cost_ledger') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [3/10] 20261015210000_la_7_2_vendor_invoices.sql ─────────────────────────────
begin;

-- LA-7.2 (Notion sprint, Module 7 — Accounting) · lead cost and vendor invoice capture.
--
-- LA-2.1's campaign spend is a number someone typed: no date, no document, nothing a bank statement
-- reconciles to. An invoice is the document: who, how much, what for, which campaign — per LINE,
-- because one invoice routinely covers three campaigns — and whether it was paid.
--
--   approve → one cost_entry per line (lead_cost, negative, incurred_on = the line's period start,
--             else the invoice date), plus one for any tax on the invoice. Approval creates the cost.
--   paid    → sets paid_on on the invoice and its entries. Payment only records when money moved.
--   void    → reversing entries (LA-7.1); nothing is deleted.
--
-- Before approving, the invoice is compared with what WE counted for that source and period: deal
-- flow (LA-1), transfers rejected at the gate (LA-6.2), credits accepted (LA-2.19), list rows
-- bought (LA-2.2). A difference beyond the agency's tolerance FLAGS the invoice; it never blocks it
-- — the vendor may be right and our count the one missing something.
--
-- accounting_settings starts here with the tolerance; LA-7.9 adds the rest of the module's settings.
--
-- Additive. Rollback: drop function public.vendor_invoice_comparison(uuid, uuid), public.approve_vendor_invoice(uuid, uuid, uuid),
--   public.mark_vendor_invoice_paid(uuid, uuid, date, text, text, uuid), public.void_vendor_invoice(uuid, uuid, text, uuid);
--   alter table public.cost_entry drop constraint cost_entry_invoice_fk; drop table public.vendor_invoice_template,
--   public.vendor_invoice_line, public.vendor_invoice, public.accounting_settings; delete from storage.buckets where id = 'accounting-files';

-- ─── settings (LA-7.9 extends) ─────────────────────────────────────────────────────────────────
create table if not exists public.accounting_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  invoice_tolerance_cents bigint not null default 5000,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint accounting_settings_tolerance check (invoice_tolerance_cents between 0 and 100000000)
);

-- ─── the documents ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('accounting-files', 'accounting-files', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg']::text[])
on conflict (id) do nothing;

-- ─── invoices ──────────────────────────────────────────────────────────────────────────────────
create table if not exists public.vendor_invoice (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agency_id uuid,
  vendor_id uuid references public.tenant_lead_vendors(id) on delete restrict,
  partner_id uuid references public.partners(id) on delete restrict,
  invoice_number text not null,
  invoice_date date not null,
  period_start date,
  period_end date,
  due_date date,
  subtotal_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  total_cents bigint not null default 0,
  status text not null default 'received',
  paid_on date,
  paid_method text,
  payment_reference text,
  document_path text,
  document_name text,
  note text,
  template_id uuid,
  comparison_json jsonb,
  difference_cents bigint,
  flagged boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  voided_by uuid,
  voided_at timestamptz,
  void_reason text,
  updated_at timestamptz not null default now(),
  constraint vendor_invoice_source check ((vendor_id is null) <> (partner_id is null)),
  constraint vendor_invoice_status check (status in ('draft', 'received', 'approved', 'paid', 'disputed', 'void')),
  constraint vendor_invoice_number check (char_length(btrim(invoice_number)) between 1 and 80),
  constraint vendor_invoice_money check (subtotal_cents >= 0 and tax_cents >= 0 and total_cents = subtotal_cents + tax_cents),
  constraint vendor_invoice_period check (period_start is null or period_end is null or period_end >= period_start),
  constraint vendor_invoice_method check (paid_method is null or paid_method in ('ach', 'card', 'cheque', 'wire', 'other')),
  constraint vendor_invoice_paid check ((status = 'paid') = (paid_on is not null) or (status = 'void' and voided_at is not null)),
  constraint vendor_invoice_void check ((status = 'void') = (voided_at is not null) and ((status = 'void') = (void_reason is not null))),
  constraint vendor_invoice_note check (note is null or char_length(note) <= 2000),
  constraint vendor_invoice_reference check (payment_reference is null or char_length(payment_reference) <= 200)
);
create unique index if not exists vendor_invoice_number_vendor on public.vendor_invoice (tenant_id, vendor_id, lower(invoice_number)) where vendor_id is not null;
create unique index if not exists vendor_invoice_number_partner on public.vendor_invoice (tenant_id, partner_id, lower(invoice_number)) where partner_id is not null;
create index if not exists vendor_invoice_tenant_idx on public.vendor_invoice (tenant_id, invoice_date desc);
create index if not exists vendor_invoice_status_idx on public.vendor_invoice (tenant_id, status);
create index if not exists vendor_invoice_vendor_idx on public.vendor_invoice (vendor_id) where vendor_id is not null;
create index if not exists vendor_invoice_partner_idx on public.vendor_invoice (partner_id) where partner_id is not null;

create table if not exists public.vendor_invoice_line (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invoice_id uuid not null references public.vendor_invoice(id) on delete restrict,
  position integer not null default 0,
  description text not null,
  campaign_id uuid references public.tenant_campaigns(id) on delete restrict,
  lead_type text not null,
  quantity integer not null default 0,
  unit_price_cents bigint not null default 0,
  amount_cents bigint not null,
  period_start date,
  period_end date,
  created_at timestamptz not null default now(),
  constraint vendor_invoice_line_type check (lead_type in ('live_transfer', 'data_list', 'aged_lead', 'direct_mail', 'other')),
  constraint vendor_invoice_line_money check (quantity >= 0 and unit_price_cents >= 0 and amount_cents >= 0),
  constraint vendor_invoice_line_description check (char_length(btrim(description)) between 1 and 300),
  constraint vendor_invoice_line_period check (period_start is null or period_end is null or period_end >= period_start)
);
create index if not exists vendor_invoice_line_invoice_idx on public.vendor_invoice_line (invoice_id, position);
create index if not exists vendor_invoice_line_campaign_idx on public.vendor_invoice_line (campaign_id) where campaign_id is not null;

-- A monthly invoice from the same source is the same shape every month: number, date, quantity.
create table if not exists public.vendor_invoice_template (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vendor_id uuid references public.tenant_lead_vendors(id) on delete cascade,
  partner_id uuid references public.partners(id) on delete cascade,
  name text not null,
  lines_json jsonb not null default '[]'::jsonb,
  tax_cents bigint not null default 0,
  active boolean not null default true,
  last_used_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_invoice_template_source check ((vendor_id is null) <> (partner_id is null)),
  constraint vendor_invoice_template_name check (char_length(btrim(name)) between 1 and 120),
  constraint vendor_invoice_template_lines check (jsonb_typeof(lines_json) = 'array' and jsonb_array_length(lines_json) between 1 and 20),
  constraint vendor_invoice_template_tax check (tax_cents >= 0)
);
create index if not exists vendor_invoice_template_tenant_idx on public.vendor_invoice_template (tenant_id);

-- The ledger's invoice column now points at a real invoice (invoices are never deleted).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cost_entry_invoice_fk' and conrelid = 'public.cost_entry'::regclass) then
    alter table public.cost_entry add constraint cost_entry_invoice_fk foreign key (invoice_id) references public.vendor_invoice(id) on delete restrict;
  end if;
end;
$$;

-- ─── what may change, and when ─────────────────────────────────────────────────────────────────
-- Approval, payment and voiding move money in the ledger, so only their writers below may make
-- those moves (a transaction-local flag they set and clear). Once approved, the invoice's money,
-- source, dates and lines are history.
create or replace function public.vendor_invoice_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_writer boolean := coalesce(current_setting('app.vendor_invoice_writer', true), '') = 'on';
  v_ok boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'An invoice is never removed; void it instead.' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status then
    v_ok := (old.status, new.status) in (('draft', 'received'), ('received', 'disputed'), ('disputed', 'received'), ('received', 'draft'))
         or (v_writer and (old.status, new.status) in (('draft', 'approved'), ('received', 'approved'), ('disputed', 'approved'), ('approved', 'paid'),
                                                         ('draft', 'void'), ('received', 'void'), ('disputed', 'void'), ('approved', 'void'), ('paid', 'void')));
    if not v_ok then
      raise exception 'An invoice cannot go from % to %.', old.status, new.status using errcode = 'P0001';
    end if;
  end if;
  if old.status in ('approved', 'paid', 'void') and (
       new.vendor_id is distinct from old.vendor_id or new.partner_id is distinct from old.partner_id
    or new.invoice_number is distinct from old.invoice_number or new.invoice_date is distinct from old.invoice_date
    or new.period_start is distinct from old.period_start or new.period_end is distinct from old.period_end
    or new.subtotal_cents is distinct from old.subtotal_cents or new.tax_cents is distinct from old.tax_cents
    or new.total_cents is distinct from old.total_cents or new.comparison_json is distinct from old.comparison_json
    or new.difference_cents is distinct from old.difference_cents or new.flagged is distinct from old.flagged
    or new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at
    or new.tenant_id is distinct from old.tenant_id) then
    raise exception 'An approved invoice is history: void it and enter it again.' using errcode = 'P0001';
  end if;
  if old.status = 'void' and new.status = 'void' and (new.voided_at is distinct from old.voided_at or new.void_reason is distinct from old.void_reason) then
    raise exception 'A voided invoice stays as it was voided.' using errcode = 'P0001';
  end if;
  if (new.paid_on is distinct from old.paid_on or new.paid_method is distinct from old.paid_method or new.payment_reference is distinct from old.payment_reference)
     and not (v_writer and old.status = 'approved' and new.status = 'paid') then
    raise exception 'Payment is recorded by marking the invoice paid.' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists vendor_invoice_guard on public.vendor_invoice;
create trigger vendor_invoice_guard before update or delete on public.vendor_invoice
  for each row execute function public.vendor_invoice_guard();

create or replace function public.vendor_invoice_line_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_status text;
  v_tenant uuid;
begin
  select i.status, i.tenant_id into v_status, v_tenant from public.vendor_invoice i where i.id = coalesce(new.invoice_id, old.invoice_id);
  if v_status is null or v_status not in ('draft', 'received', 'disputed') then
    raise exception 'The lines of an approved or voided invoice are history.' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.invoice_id is distinct from old.invoice_id then
    raise exception 'A line stays on its invoice.' using errcode = 'P0001';
  end if;
  if tg_op <> 'DELETE' then
    if new.tenant_id is distinct from v_tenant then
      raise exception 'A line belongs to its invoice''s agency.' using errcode = 'P0001';
    end if;
    if new.campaign_id is not null and not exists (select 1 from public.tenant_campaigns c where c.id = new.campaign_id and c.tenant_id = v_tenant) then
      raise exception 'Campaign % is not in this agency.', new.campaign_id using errcode = 'P0001';
    end if;
    return new;
  end if;
  return old;
end;
$$;
drop trigger if exists vendor_invoice_line_guard on public.vendor_invoice_line;
create trigger vendor_invoice_line_guard before insert or update or delete on public.vendor_invoice_line
  for each row execute function public.vendor_invoice_line_guard();

-- ─── invoiced vs what we counted ───────────────────────────────────────────────────────────────
-- Per line. The window is the line's period, else the invoice's, else the invoice date's month.
--   live transfers — accepted: deal-flow rows from that partner (or vendor, or the line's campaign);
--                    rejected: LA-6.2 rejects for that partner (they never became leads);
--   data lists / aged leads — records bought on list imports for that campaign (or vendor);
--   credits — LA-2.19 claims accepted or partly accepted for that vendor (and campaign).
-- Our amount = accepted × the line's unit price − credits. (The spec's worked example does not add
-- up — 63 × $90 is $5,670, not $5,940 — so the count is priced at the line's own unit price.)
-- Direct mail and "other" lines cannot be counted and say so (countable = false).
create or replace function public.vendor_invoice_comparison(p_tenant_id uuid, p_invoice_id uuid)
returns table (line_id uuid, campaign_id uuid, lead_type text, invoiced_quantity integer, invoiced_cents bigint, unit_price_cents bigint,
               period_from date, period_to date, countable boolean, accepted integer, rejected integer, recorded integer,
               credited_count integer, credited_cents bigint, our_count integer, our_cents bigint, difference_cents bigint)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  i public.vendor_invoice;
  l record;
  v_from date;
  v_to date;
  v_acc integer;
  v_rej integer;
  v_cc integer;
  v_cents bigint;
begin
  select * into i from public.vendor_invoice where id = p_invoice_id and tenant_id = p_tenant_id;
  if not found then
    raise exception 'vendor_invoice_comparison: invoice % is not in this agency', p_invoice_id using errcode = 'P0002';
  end if;
  for l in select * from public.vendor_invoice_line x where x.invoice_id = i.id order by x.position, x.created_at loop
    v_from := coalesce(l.period_start, i.period_start, date_trunc('month', i.invoice_date)::date);
    v_to := coalesce(l.period_end, i.period_end, (date_trunc('month', i.invoice_date) + interval '1 month - 1 day')::date);
    v_acc := 0; v_rej := 0; v_cc := 0; v_cents := 0;
    if l.lead_type = 'live_transfer' then
      select count(*)::int into v_acc from public.deal_flow d
       where d.tenant_id = p_tenant_id and d.local_date between v_from and v_to
         and case when l.campaign_id is not null then d.campaign_id = l.campaign_id
                  when i.partner_id is not null then d.partner_id = i.partner_id
                  else d.vendor_id = i.vendor_id end;
      if i.partner_id is not null and to_regclass('public.transfer_verdict') is not null then
        execute 'select count(*)::int from public.transfer_verdict v where v.tenant_id = $1 and v.partner_id = $2 and v.verdict = ''reject''
                   and v.evaluated_at >= $3::timestamptz and v.evaluated_at < ($4 + 1)::timestamptz'
          into v_rej using p_tenant_id, i.partner_id, v_from, v_to;
      end if;
    elsif l.lead_type in ('data_list', 'aged_lead') then
      select coalesce(sum(b.records_purchased), 0)::int into v_acc from public.agent_lead_import_batches b
       where b.tenant_id = p_tenant_id and b.created_at >= v_from::timestamptz and b.created_at < (v_to + 1)::timestamptz
         and case when l.campaign_id is not null then b.campaign_id = l.campaign_id else b.vendor_id = i.vendor_id end;
    end if;
    if i.vendor_id is not null and l.lead_type in ('live_transfer', 'data_list', 'aged_lead') then
      select coalesce(sum(c.lead_count), 0)::int, coalesce(sum(c.amount_credited_cents), 0)::bigint into v_cc, v_cents from public.lead_claims c
       where c.tenant_id = p_tenant_id and c.vendor_id = i.vendor_id and c.status in ('accepted', 'partial')
         and c.resolved_at >= v_from::timestamptz and c.resolved_at < (v_to + 1)::timestamptz
         and (l.campaign_id is null or c.campaign_id = l.campaign_id);
    end if;
    line_id := l.id; campaign_id := l.campaign_id; lead_type := l.lead_type;
    invoiced_quantity := l.quantity; invoiced_cents := l.amount_cents; unit_price_cents := l.unit_price_cents;
    period_from := v_from; period_to := v_to;
    countable := l.lead_type in ('live_transfer', 'data_list', 'aged_lead');
    accepted := v_acc; rejected := v_rej; recorded := v_acc + v_rej;
    credited_count := v_cc; credited_cents := v_cents;
    our_count := greatest(v_acc - v_cc, 0);
    our_cents := case when countable then v_acc::bigint * l.unit_price_cents - v_cents else l.amount_cents end;
    difference_cents := our_cents - l.amount_cents;
    return next;
  end loop;
end;
$$;

-- ─── approve: the cost is created ──────────────────────────────────────────────────────────────
create or replace function public.approve_vendor_invoice(p_tenant_id uuid, p_invoice_id uuid, p_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  i public.vendor_invoice;
  l record;
  v_lines integer;
  v_sum bigint;
  v_cmp jsonb;
  v_diff bigint;
  v_tol bigint;
  v_entries integer := 0;
  v_counterparty uuid;
  v_type text;
begin
  select * into i from public.vendor_invoice where id = p_invoice_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'approve_vendor_invoice: invoice % is not in this agency', p_invoice_id using errcode = 'P0002';
  end if;
  if i.status not in ('draft', 'received', 'disputed') then
    raise exception 'approve_vendor_invoice: a % invoice cannot be approved', i.status using errcode = '22023';
  end if;
  select count(*)::int, coalesce(sum(amount_cents), 0)::bigint into v_lines, v_sum from public.vendor_invoice_line where invoice_id = i.id;
  if v_lines = 0 then
    raise exception 'approve_vendor_invoice: an invoice needs at least one line' using errcode = '22023';
  end if;
  if v_sum <> i.subtotal_cents then
    raise exception 'approve_vendor_invoice: the lines add up to % cents but the subtotal is % cents', v_sum, i.subtotal_cents using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb), coalesce(sum(c.difference_cents) filter (where c.countable), 0)::bigint
    into v_cmp, v_diff from public.vendor_invoice_comparison(p_tenant_id, i.id) c;
  select coalesce((select s.invoice_tolerance_cents from public.accounting_settings s where s.tenant_id = p_tenant_id), 5000) into v_tol;

  v_counterparty := coalesce(i.vendor_id, i.partner_id);
  v_type := case when i.vendor_id is not null then 'vendor' else 'partner' end;
  for l in select * from public.vendor_invoice_line where invoice_id = i.id and amount_cents > 0 order by position, created_at loop
    perform public.record_cost_entry(p_tenant_id, jsonb_build_object(
      'agency_id', i.agency_id, 'entry_type', 'lead_cost', 'amount_cents', -l.amount_cents,
      'incurred_on', coalesce(l.period_start, i.invoice_date), 'counterparty_type', v_type, 'counterparty_id', v_counterparty,
      'campaign_id', l.campaign_id,
      'vendor_id', coalesce(i.vendor_id, (select c.vendor_id from public.tenant_campaigns c where c.id = l.campaign_id)),
      'partner_id', i.partner_id, 'invoice_id', i.id,
      'description', left(l.description || ' — invoice ' || i.invoice_number, 500)), p_by);
    v_entries := v_entries + 1;
  end loop;
  if i.tax_cents > 0 then
    perform public.record_cost_entry(p_tenant_id, jsonb_build_object(
      'agency_id', i.agency_id, 'entry_type', 'lead_cost', 'amount_cents', -i.tax_cents, 'incurred_on', i.invoice_date,
      'counterparty_type', v_type, 'counterparty_id', v_counterparty, 'vendor_id', i.vendor_id, 'partner_id', i.partner_id, 'invoice_id', i.id,
      'description', left('Tax on invoice ' || i.invoice_number, 500)), p_by);
    v_entries := v_entries + 1;
  end if;

  perform set_config('app.vendor_invoice_writer', 'on', true);
  update public.vendor_invoice
     set status = 'approved', approved_by = p_by, approved_at = now(), comparison_json = v_cmp, difference_cents = v_diff,
         flagged = abs(v_diff) > v_tol
   where id = i.id;
  perform set_config('app.vendor_invoice_writer', '', true);
  return jsonb_build_object('entries', v_entries, 'difference_cents', v_diff, 'flagged', abs(v_diff) > v_tol, 'tolerance_cents', v_tol);
end;
$$;

-- ─── paid: when the money moved, nothing else ──────────────────────────────────────────────────
create or replace function public.mark_vendor_invoice_paid(p_tenant_id uuid, p_invoice_id uuid, p_paid_on date, p_method text, p_reference text, p_by uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  i public.vendor_invoice;
  v_ids uuid[];
  v_n integer;
begin
  select * into i from public.vendor_invoice where id = p_invoice_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'mark_vendor_invoice_paid: invoice % is not in this agency', p_invoice_id using errcode = 'P0002';
  end if;
  if i.status <> 'approved' then
    raise exception 'mark_vendor_invoice_paid: only an approved invoice is paid (this one is %)', i.status using errcode = '22023';
  end if;
  if p_paid_on is null then
    raise exception 'mark_vendor_invoice_paid: a payment date is required' using errcode = '22023';
  end if;
  select coalesce(array_agg(e.id), '{}') into v_ids from public.cost_entry e
   where e.tenant_id = p_tenant_id and e.invoice_id = i.id and e.reverses_entry_id is null;
  v_n := public.mark_cost_entries_paid(p_tenant_id, v_ids, p_paid_on);
  perform set_config('app.vendor_invoice_writer', 'on', true);
  update public.vendor_invoice set status = 'paid', paid_on = p_paid_on, paid_method = nullif(btrim(p_method), ''), payment_reference = nullif(btrim(p_reference), '')
   where id = i.id;
  perform set_config('app.vendor_invoice_writer', '', true);
  return v_n;
end;
$$;

-- ─── void: reversing entries, nothing deleted ──────────────────────────────────────────────────
create or replace function public.void_vendor_invoice(p_tenant_id uuid, p_invoice_id uuid, p_reason text, p_by uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  i public.vendor_invoice;
  e record;
  v_n integer := 0;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'void_vendor_invoice: say why the invoice is void' using errcode = '22023';
  end if;
  select * into i from public.vendor_invoice where id = p_invoice_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'void_vendor_invoice: invoice % is not in this agency', p_invoice_id using errcode = 'P0002';
  end if;
  if i.status = 'void' then
    raise exception 'void_vendor_invoice: the invoice is already void' using errcode = '22023';
  end if;
  for e in select c.id from public.cost_entry c
            where c.tenant_id = p_tenant_id and c.invoice_id = i.id and c.reverses_entry_id is null
              and not exists (select 1 from public.cost_entry r where r.reverses_entry_id = c.id) loop
    perform public.reverse_cost_entry(p_tenant_id, e.id, 'Invoice ' || i.invoice_number || ' voided: ' || btrim(p_reason), p_by);
    v_n := v_n + 1;
  end loop;
  perform set_config('app.vendor_invoice_writer', 'on', true);
  update public.vendor_invoice set status = 'void', voided_by = p_by, voided_at = now(), void_reason = left(btrim(p_reason), 500) where id = i.id;
  perform set_config('app.vendor_invoice_writer', '', true);
  return v_n;
end;
$$;

-- ─── access ────────────────────────────────────────────────────────────────────────────────────
alter table public.accounting_settings enable row level security;
alter table public.vendor_invoice enable row level security;
alter table public.vendor_invoice_line enable row level security;
alter table public.vendor_invoice_template enable row level security;
drop policy if exists accounting_settings_read on public.accounting_settings;
create policy accounting_settings_read on public.accounting_settings for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists vendor_invoice_read on public.vendor_invoice;
create policy vendor_invoice_read on public.vendor_invoice for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists vendor_invoice_line_read on public.vendor_invoice_line;
create policy vendor_invoice_line_read on public.vendor_invoice_line for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists vendor_invoice_template_read on public.vendor_invoice_template;
create policy vendor_invoice_template_read on public.vendor_invoice_template for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.accounting_settings, public.vendor_invoice, public.vendor_invoice_line, public.vendor_invoice_template from public, anon, authenticated;
revoke insert, update, delete, truncate on public.accounting_settings, public.vendor_invoice, public.vendor_invoice_line, public.vendor_invoice_template from tenant_app;
grant select on public.accounting_settings, public.vendor_invoice, public.vendor_invoice_line, public.vendor_invoice_template to tenant_app;
-- The app edits drafts and templates directly; an invoice is never deleted (void it), and nothing is truncated.
revoke delete, truncate on public.vendor_invoice from service_role;
revoke truncate on public.accounting_settings, public.vendor_invoice_line, public.vendor_invoice_template from service_role;
grant select, insert, update on public.accounting_settings, public.vendor_invoice to service_role;
grant select, insert, update, delete on public.vendor_invoice_line, public.vendor_invoice_template to service_role;

revoke all on function public.vendor_invoice_guard() from public, anon, authenticated;
revoke all on function public.vendor_invoice_line_guard() from public, anon, authenticated;
revoke all on function public.vendor_invoice_comparison(uuid, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.approve_vendor_invoice(uuid, uuid, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.mark_vendor_invoice_paid(uuid, uuid, date, text, text, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.void_vendor_invoice(uuid, uuid, text, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.vendor_invoice_comparison(uuid, uuid) to service_role;
grant execute on function public.approve_vendor_invoice(uuid, uuid, uuid) to service_role;
grant execute on function public.mark_vendor_invoice_paid(uuid, uuid, date, text, text, uuid) to service_role;
grant execute on function public.void_vendor_invoice(uuid, uuid, text, uuid) to service_role;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261015210000', 'la_7_2_vendor_invoices') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [4/10] 20261015220000_la_7_3_expenses.sql ────────────────────────────────────
begin;

-- LA-7.3 (Notion sprint, Module 7 — Accounting) · platform and tool expenses.
--
-- Everything the agent spends that is not a lead: the dialer, the CRM, our own subscription,
-- skip-trace credits, the E&O premium, the accountant. Small — about 4% of acquisition cost — and
-- worth capturing because without it cost per policy is quietly too low.
--
--   is_acquisition_cost decides whether an expense divides into cost per policy or only reduces net
--   profit. It defaults by category (accounting_settings.acquisition_defaults, editable in LA-7.9)
--   and can be overridden per expense — visibly (acquisition_overridden).
--
--   Recurring: a template generates one instance per period, UNCONFIRMED. An unconfirmed instance
--   writes no cost entry: a subscription cancelled in March must not keep booking cost through
--   December because nobody told the system. Confirming books it (LA-7.1 cost_entry, negative).
--   Changing a template's amount reaches future instances only; past ones are rows of their own.
--
--   No campaign or policy attribution, deliberately: a dialer subscription belongs to the business.
--
-- Additive. Rollback: select cron.unschedule('la7-recurring-expenses'); drop function public.generate_recurring_expenses(uuid, date),
--   public.confirm_expense(uuid, uuid, uuid), public.void_expense(uuid, uuid, text, uuid), public.mark_expense_paid(uuid, uuid, date, text, text),
--   public.expense_entry_type(text), public.expense_next_period(date, text); alter table public.cost_entry drop constraint cost_entry_expense_fk;
--   drop table public.expense; alter table public.accounting_settings drop column acquisition_defaults;

alter table public.accounting_settings
  add column if not exists acquisition_defaults jsonb not null default
    '{"software": true, "telephony": true, "data_services": true, "insurance": false, "professional_fees": false, "licensing": false, "office": false, "other": false}'::jsonb;

create table if not exists public.expense (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agency_id uuid,
  category text not null,
  vendor_name text not null,
  description text,
  amount_cents bigint not null,
  incurred_on date not null,
  paid_on date,
  paid_method text,
  payment_reference text,
  recurrence text not null default 'one_off',
  recurrence_end_on date,
  parent_expense_id uuid references public.expense(id) on delete restrict,
  status text not null,
  is_acquisition_cost boolean not null,
  acquisition_overridden boolean not null default false,
  tax_category text,
  document_path text,
  document_name text,
  created_by uuid,
  created_at timestamptz not null default now(),
  confirmed_by uuid,
  confirmed_at timestamptz,
  voided_by uuid,
  voided_at timestamptz,
  void_reason text,
  updated_at timestamptz not null default now(),
  constraint expense_category check (category in ('software', 'telephony', 'data_services', 'insurance', 'professional_fees', 'licensing', 'office', 'other')),
  constraint expense_recurrence check (recurrence in ('one_off', 'monthly', 'quarterly', 'annual')),
  constraint expense_status check (status in ('template', 'unconfirmed', 'confirmed', 'void')),
  -- A template recurs and is never booked; an instance points at its template and does not recur itself.
  constraint expense_shape check (
    (status = 'template' and recurrence <> 'one_off' and parent_expense_id is null)
    or (status <> 'template' and recurrence = 'one_off')
  ),
  constraint expense_amount check (amount_cents > 0),
  constraint expense_vendor check (char_length(btrim(vendor_name)) between 1 and 120),
  constraint expense_description check (description is null or char_length(description) <= 500),
  constraint expense_method check (paid_method is null or paid_method in ('ach', 'card', 'cheque', 'wire', 'other')),
  constraint expense_paid check (paid_on is null or status in ('confirmed', 'void')),
  constraint expense_void check ((status = 'void') = (voided_at is not null) and ((status = 'void') = (void_reason is not null))),
  constraint expense_end check (recurrence_end_on is null or recurrence_end_on >= incurred_on)
);
create unique index if not exists expense_one_per_period on public.expense (parent_expense_id, incurred_on) where parent_expense_id is not null;
create index if not exists expense_tenant_idx on public.expense (tenant_id, incurred_on desc);
create index if not exists expense_status_idx on public.expense (tenant_id, status);
create index if not exists expense_templates_idx on public.expense (tenant_id) where status = 'template';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cost_entry_expense_fk' and conrelid = 'public.cost_entry'::regclass) then
    alter table public.cost_entry add constraint cost_entry_expense_fk foreign key (expense_id) references public.expense(id) on delete restrict;
  end if;
end;
$$;

-- ─── the ledger type a category books as ───────────────────────────────────────────────────────
create or replace function public.expense_entry_type(p_category text)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case p_category
           when 'insurance' then 'insurance'
           when 'professional_fees' then 'professional_fee'
           when 'licensing' then 'professional_fee'
           else 'tool_subscription'
         end
$$;

create or replace function public.expense_next_period(p_from date, p_recurrence text)
returns date
language sql
immutable
set search_path = public, pg_catalog
as $$
  select (p_from + case p_recurrence when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months' when 'annual' then interval '1 year' end)::date
$$;

-- ─── what may change ───────────────────────────────────────────────────────────────────────────
create or replace function public.expense_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_writer boolean := coalesce(current_setting('app.expense_writer', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    raise exception 'An expense is never removed: void it, or end a recurring one.' using errcode = 'P0001';
  end if;
  if new.tenant_id is distinct from old.tenant_id or new.parent_expense_id is distinct from old.parent_expense_id then
    raise exception 'An expense stays with its agency and its template.' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'unconfirmed' and new.status = 'void')
         or (v_writer and (old.status, new.status) in (('unconfirmed', 'confirmed'), ('confirmed', 'void')))) then
      raise exception 'An expense cannot go from % to %.', old.status, new.status using errcode = 'P0001';
    end if;
  end if;
  -- Booked or voided: the money, the date and what it was are history. Its classification
  -- (acquisition or overhead, tax bucket) and its receipt may still be set.
  if old.status in ('confirmed', 'void') and (
       new.category is distinct from old.category or new.vendor_name is distinct from old.vendor_name
    or new.description is distinct from old.description or new.amount_cents is distinct from old.amount_cents
    or new.incurred_on is distinct from old.incurred_on or new.recurrence is distinct from old.recurrence
    or new.confirmed_at is distinct from old.confirmed_at or new.confirmed_by is distinct from old.confirmed_by) then
    raise exception 'A confirmed expense is history: void it and enter it again.' using errcode = 'P0001';
  end if;
  if old.status = 'void' and new.status = 'void' and (new.voided_at is distinct from old.voided_at or new.void_reason is distinct from old.void_reason) then
    raise exception 'A voided expense stays as it was voided.' using errcode = 'P0001';
  end if;
  if (new.paid_on is distinct from old.paid_on or new.paid_method is distinct from old.paid_method or new.payment_reference is distinct from old.payment_reference)
     and not v_writer then
    raise exception 'Payment is recorded by marking the expense paid.' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists expense_guard on public.expense;
create trigger expense_guard before update or delete on public.expense
  for each row execute function public.expense_guard();

-- ─── confirm: the cost is booked ───────────────────────────────────────────────────────────────
create or replace function public.confirm_expense(p_tenant_id uuid, p_expense_id uuid, p_by uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  x public.expense;
  v_entry uuid;
begin
  select * into x from public.expense where id = p_expense_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'confirm_expense: expense % is not in this agency', p_expense_id using errcode = 'P0002';
  end if;
  if x.status <> 'unconfirmed' then
    raise exception 'confirm_expense: a % expense cannot be confirmed', x.status using errcode = '22023';
  end if;
  v_entry := public.record_cost_entry(p_tenant_id, jsonb_build_object(
    'agency_id', x.agency_id, 'entry_type', public.expense_entry_type(x.category), 'amount_cents', -x.amount_cents,
    'incurred_on', x.incurred_on, 'paid_on', x.paid_on, 'counterparty_type', 'other', 'counterparty_name', x.vendor_name,
    'expense_id', x.id, 'tax_category', x.tax_category,
    'description', left(x.vendor_name || coalesce(' — ' || nullif(btrim(x.description), ''), ''), 500)), p_by);
  perform set_config('app.expense_writer', 'on', true);
  update public.expense set status = 'confirmed', confirmed_by = p_by, confirmed_at = now() where id = x.id;
  perform set_config('app.expense_writer', '', true);
  return v_entry;
end;
$$;

create or replace function public.void_expense(p_tenant_id uuid, p_expense_id uuid, p_reason text, p_by uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  x public.expense;
  e record;
  v_n integer := 0;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'void_expense: say why' using errcode = '22023';
  end if;
  select * into x from public.expense where id = p_expense_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'void_expense: expense % is not in this agency', p_expense_id using errcode = 'P0002';
  end if;
  if x.status not in ('unconfirmed', 'confirmed') then
    raise exception 'void_expense: a % expense cannot be voided (end a recurring one instead)', x.status using errcode = '22023';
  end if;
  for e in select c.id from public.cost_entry c where c.tenant_id = p_tenant_id and c.expense_id = x.id and c.reverses_entry_id is null
              and not exists (select 1 from public.cost_entry r where r.reverses_entry_id = c.id) loop
    perform public.reverse_cost_entry(p_tenant_id, e.id, 'Expense voided: ' || btrim(p_reason), p_by);
    v_n := v_n + 1;
  end loop;
  perform set_config('app.expense_writer', 'on', true);
  update public.expense set status = 'void', voided_by = p_by, voided_at = now(), void_reason = left(btrim(p_reason), 500) where id = x.id;
  perform set_config('app.expense_writer', '', true);
  return v_n;
end;
$$;

create or replace function public.mark_expense_paid(p_tenant_id uuid, p_expense_id uuid, p_paid_on date, p_method text, p_reference text)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  x public.expense;
  v_ids uuid[];
  v_n integer := 0;
begin
  select * into x from public.expense where id = p_expense_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'mark_expense_paid: expense % is not in this agency', p_expense_id using errcode = 'P0002';
  end if;
  if x.status <> 'confirmed' or x.paid_on is not null then
    raise exception 'mark_expense_paid: only a confirmed, unpaid expense is marked paid' using errcode = '22023';
  end if;
  if p_paid_on is null then
    raise exception 'mark_expense_paid: a payment date is required' using errcode = '22023';
  end if;
  select coalesce(array_agg(c.id), '{}') into v_ids from public.cost_entry c where c.tenant_id = p_tenant_id and c.expense_id = x.id and c.reverses_entry_id is null;
  v_n := public.mark_cost_entries_paid(p_tenant_id, v_ids, p_paid_on);
  perform set_config('app.expense_writer', 'on', true);
  update public.expense set paid_on = p_paid_on, paid_method = nullif(btrim(p_method), ''), payment_reference = nullif(btrim(p_reference), '') where id = x.id;
  perform set_config('app.expense_writer', '', true);
  return v_n;
end;
$$;

-- ─── recurring: one unconfirmed instance per period, up to a date ──────────────────────────────
-- The template's own incurred_on is the first period. An instance copies the template as it is
-- when the instance is made — so changing the template's amount changes the months still to come.
create or replace function public.generate_recurring_expenses(p_tenant_id uuid, p_through date default current_date)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  t public.expense;
  v_on date;
  v_n integer := 0;
  v_guard integer;
begin
  for t in select * from public.expense
            where status = 'template' and (p_tenant_id is null or tenant_id = p_tenant_id)
              and exists (select 1 from public.tenants x where x.id = expense.tenant_id) loop
    v_on := t.incurred_on;
    v_guard := 0;
    while v_on <= p_through and (t.recurrence_end_on is null or v_on <= t.recurrence_end_on) and v_guard < 240 loop
      insert into public.expense (tenant_id, agency_id, category, vendor_name, description, amount_cents, incurred_on, recurrence, parent_expense_id,
                                  status, is_acquisition_cost, acquisition_overridden, tax_category, created_by)
      values (t.tenant_id, t.agency_id, t.category, t.vendor_name, t.description, t.amount_cents, v_on, 'one_off', t.id,
              'unconfirmed', t.is_acquisition_cost, t.acquisition_overridden, t.tax_category, null)
      on conflict (parent_expense_id, incurred_on) where parent_expense_id is not null do nothing;
      if found then
        v_n := v_n + 1;
      end if;
      v_on := public.expense_next_period(v_on, t.recurrence);
      v_guard := v_guard + 1;
    end loop;
  end loop;
  return v_n;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('la7-recurring-expenses', '0 5 * * *', $job$select public.generate_recurring_expenses(null, current_date)$job$);
  end if;
end;
$$;

-- ─── access ────────────────────────────────────────────────────────────────────────────────────
alter table public.expense enable row level security;
drop policy if exists expense_read on public.expense;
create policy expense_read on public.expense for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.expense from public, anon, authenticated;
revoke insert, update, delete, truncate on public.expense from tenant_app;
grant select on public.expense to tenant_app;
revoke delete, truncate on public.expense from service_role;
grant select, insert, update on public.expense to service_role;

revoke all on function public.expense_guard() from public, anon, authenticated;
revoke all on function public.expense_entry_type(text) from public, anon, authenticated;
revoke all on function public.expense_next_period(date, text) from public, anon, authenticated;
revoke all on function public.confirm_expense(uuid, uuid, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.void_expense(uuid, uuid, text, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.mark_expense_paid(uuid, uuid, date, text, text) from public, anon, authenticated, tenant_app;
revoke all on function public.generate_recurring_expenses(uuid, date) from public, anon, authenticated, tenant_app;
grant execute on function public.expense_entry_type(text) to service_role, tenant_app;
grant execute on function public.expense_next_period(date, text) to service_role, tenant_app;
grant execute on function public.confirm_expense(uuid, uuid, uuid) to service_role;
grant execute on function public.void_expense(uuid, uuid, text, uuid) to service_role;
grant execute on function public.mark_expense_paid(uuid, uuid, date, text, text) to service_role;
grant execute on function public.generate_recurring_expenses(uuid, date) to service_role;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261015220000', 'la_7_3_expenses') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [5/10] 20261015230000_la_7_7_pnl.sql ─────────────────────────────────────────
begin;

-- LA-7.7 (Notion sprint, Module 7 — Accounting) · the P&L.
--
-- One screen: money in, money out, what is left — and the two cost-per-policy numbers. Everything
-- here reads the three ledgers LA-7.1's money_entry view unions; nothing is stored, so there is no snapshot and no as-of time.
--
--   pnl_lines     the period's money by section, summed in the database (bigint; the API's
--                 1,000-row cap never truncates a P&L):
--                   in          — commission as the carriers REPORTED it (LA-4.12), per entry type;
--                   acquisition — lead costs and partner payouts per source, plus every tool or
--                                 expense marked acquisition (LA-7.3) — what divides into cost per policy;
--                   overhead    — everything else that is not a split: E&O, licences, fees;
--                   splits      — producers' shares (LA-7.5), reduce profit, not cost per policy.
--   pnl_monthly   the same sections per calendar month, for the trend.
--   pnl_received  what the BANK confirms arrived from carriers (LA-7.6), or NULL — "not imported" —
--                 when no bank data covers the period. Never blended with reported.
--
-- The issued and persisting counts come from LA-4's policy book in the application, through
-- LA-4.18's own persistency function — not a second definition here.
--
-- The settings this reads are LA-7.9's, created here because the P&L needs them first.
--
-- Additive. Rollback: drop function public.pnl_lines(uuid, date, date, text), public.pnl_monthly(uuid, date, date, text),
--   public.pnl_received(uuid, date, date), public.pnl_section(text, text, uuid, boolean, uuid, uuid);
--   alter table public.accounting_settings drop column default_basis, drop column fy_start_month, drop column persistency_month, drop column sample_threshold;

alter table public.accounting_settings
  add column if not exists default_basis text not null default 'accrual',
  add column if not exists fy_start_month integer not null default 1,
  add column if not exists persistency_month integer not null default 9,
  add column if not exists sample_threshold integer not null default 10;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'accounting_settings_reporting' and conrelid = 'public.accounting_settings'::regclass) then
    alter table public.accounting_settings add constraint accounting_settings_reporting check (
      default_basis in ('accrual', 'cash') and fy_start_month between 1 and 12
      -- LA-4.18's persistency is computed at these months; the horizon picks one of them.
      and persistency_month in (3, 6, 9, 13) and sample_threshold between 1 and 1000);
  end if;
end;
$$;

-- Which section a money row belongs to. One definition, used by every P&L function.
create or replace function public.pnl_section(p_side text, p_entry_type text, p_expense_id uuid, p_expense_acquisition boolean, p_vendor_id uuid, p_partner_id uuid)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case
    when p_side = 'commission' then 'in'
    when p_entry_type = 'producer_split' then 'splits'
    when p_expense_id is not null then case when p_expense_acquisition then 'acquisition' else 'overhead' end
    when p_entry_type in ('lead_cost', 'partner_payout', 'platform_fee', 'tool_subscription') then 'acquisition'
    when p_entry_type = 'refund' and (p_vendor_id is not null or p_partner_id is not null) then 'acquisition'
    else 'overhead'
  end
$$;

-- The period's lines. Acquisition lines name their source (the vendor or partner); expense lines
-- name their category; commission lines their entry type.
--
-- Read straight from the three ledgers rather than through money_entry: the view resolves every
-- commission row's lead source through the policy book, which the P&L does not need and which made
-- a month's read several times slower. The dates are the view's own expressions — commission:
-- coalesce(transaction_date, statement_date) on accrual, statement_date on cash; cost: incurred_on
-- / paid_on — and the sections reconcile to the view to the cent (asserted in the tests).
create or replace function public.pnl_lines(p_tenant_id uuid, p_from date, p_to date, p_basis text default 'accrual')
returns table (section text, entry_type text, source_type text, source_id uuid, source_name text, amount_cents bigint, entries bigint)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_comm text;
  v_cost text;
begin
  if p_basis not in ('accrual', 'cash') then
    raise exception 'pnl_lines: basis is accrual or cash' using errcode = '22023';
  end if;
  v_comm := case when p_basis = 'cash' then 'e.statement_date' else 'coalesce(e.transaction_date, e.statement_date)' end;
  v_cost := case when p_basis = 'cash' then 'c.paid_on' else 'c.incurred_on' end;
  return query execute format($q$
    with comm as (
      select e.entry_type, e.amount_cents from public.commission_entry e where e.tenant_id = $1 and %1$s >= $2 and %1$s < $3
      union all
      select e.entry_type, e.amount_cents from public.commission_account_entry e where e.tenant_id = $1 and %1$s >= $2 and %1$s < $3
    ),
    cost as (
      select c.entry_type, c.amount_cents, c.vendor_id, c.partner_id, c.expense_id, x.category as x_category,
             public.pnl_section('cost', c.entry_type, c.expense_id, x.is_acquisition_cost, c.vendor_id, c.partner_id) as section
        from public.cost_entry c
        left join public.expense x on x.id = c.expense_id
       where c.tenant_id = $1 and %2$s >= $2 and %2$s < $3
    ),
    cost_lines as (
      select m.section, m.entry_type,
             case when m.section = 'acquisition' and m.entry_type in ('lead_cost', 'partner_payout', 'refund') and m.partner_id is not null then 'partner'
                  when m.section = 'acquisition' and m.entry_type in ('lead_cost', 'partner_payout', 'refund') and m.vendor_id is not null then 'vendor'
                  when m.expense_id is not null then 'expense_category'
                  else null end as source_type,
             case when m.section = 'acquisition' and m.entry_type in ('lead_cost', 'partner_payout', 'refund') then coalesce(m.partner_id, m.vendor_id) end as source_id,
             case when m.expense_id is not null then m.x_category end as category,
             sum(m.amount_cents)::bigint as amount_cents, count(*)::bigint as entries
        from cost m
       group by 1, 2, 3, 4, 5
    )
    select 'in'::text, comm.entry_type, null::text, null::uuid, null::text, sum(comm.amount_cents)::bigint, count(*)::bigint
      from comm group by comm.entry_type
    union all
    select l.section, l.entry_type, l.source_type, l.source_id,
           case when l.source_type = 'partner' then (select p.name from public.partners p where p.id = l.source_id)
                when l.source_type = 'vendor' then (select v.name from public.tenant_lead_vendors v where v.id = l.source_id)
                else l.category end,
           l.amount_cents, l.entries
      from cost_lines l
  $q$, v_comm, v_cost) using p_tenant_id, p_from, p_to;
end;
$$;

-- Section totals per calendar month: the trend (direction over six months is the signal).
create or replace function public.pnl_monthly(p_tenant_id uuid, p_from date, p_to date, p_basis text default 'accrual')
returns table (month date, section text, amount_cents bigint)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_comm text;
  v_cost text;
begin
  if p_basis not in ('accrual', 'cash') then
    raise exception 'pnl_monthly: basis is accrual or cash' using errcode = '22023';
  end if;
  v_comm := case when p_basis = 'cash' then 'e.statement_date' else 'coalesce(e.transaction_date, e.statement_date)' end;
  v_cost := case when p_basis = 'cash' then 'c.paid_on' else 'c.incurred_on' end;
  return query execute format($q$
    select date_trunc('month', %1$s)::date, 'in'::text, sum(e.amount_cents)::bigint
      from public.commission_entry e where e.tenant_id = $1 and %1$s >= $2 and %1$s < $3 group by 1
    union all
    select date_trunc('month', %1$s)::date, 'in'::text, sum(e.amount_cents)::bigint
      from public.commission_account_entry e where e.tenant_id = $1 and %1$s >= $2 and %1$s < $3 group by 1
    union all
    select date_trunc('month', %2$s)::date, public.pnl_section('cost', c.entry_type, c.expense_id, x.is_acquisition_cost, c.vendor_id, c.partner_id), sum(c.amount_cents)::bigint
      from public.cost_entry c left join public.expense x on x.id = c.expense_id
     where c.tenant_id = $1 and %2$s >= $2 and %2$s < $3 group by 1, 2
  $q$, v_comm, v_cost) using p_tenant_id, p_from, p_to;
end;
$$;

-- What the bank says arrived from carriers in the period (confirmed matches only), or NULL when no
-- bank data has been imported for it. NULL and zero are different statements.
create or replace function public.pnl_received(p_tenant_id uuid, p_from date, p_to date)
returns bigint
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_any boolean;
  v_sum bigint;
begin
  if to_regclass('public.bank_transaction') is null or to_regclass('public.deposit_match') is null then
    return null;
  end if;
  execute 'select exists (select 1 from public.bank_transaction t where t.tenant_id = $1 and t.posted_on >= $2 and t.posted_on < $3)'
    into v_any using p_tenant_id, p_from, p_to;
  if not v_any then
    return null;
  end if;
  execute 'select coalesce(sum(d.amount_applied_cents), 0)::bigint
             from public.deposit_match d join public.bank_transaction t on t.id = d.bank_transaction_id
            where d.tenant_id = $1 and d.confirmed_by is not null and t.posted_on >= $2 and t.posted_on < $3'
    into v_sum using p_tenant_id, p_from, p_to;
  return v_sum;
end;
$$;

revoke all on function public.pnl_section(text, text, uuid, boolean, uuid, uuid) from public, anon, authenticated;
revoke all on function public.pnl_lines(uuid, date, date, text) from public, anon, authenticated, tenant_app;
revoke all on function public.pnl_monthly(uuid, date, date, text) from public, anon, authenticated, tenant_app;
revoke all on function public.pnl_received(uuid, date, date) from public, anon, authenticated, tenant_app;
grant execute on function public.pnl_section(text, text, uuid, boolean, uuid, uuid) to service_role, tenant_app;
grant execute on function public.pnl_lines(uuid, date, date, text) to service_role;
grant execute on function public.pnl_monthly(uuid, date, date, text) to service_role;
grant execute on function public.pnl_received(uuid, date, date) to service_role;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261015230000', 'la_7_7_pnl') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [6/10] 20261015240000_la_7_4_partner_payouts.sql ─────────────────────────────
begin;

-- LA-7.4 (Notion sprint, Module 7 — Accounting) · partner payout engine, statements, portal view.
--
-- Ends the forty-minute monthly call where the agent and the call centre read different numbers at
-- each other. We CALCULATE and produce an itemised statement; we never move money.
--
--   build_payout_run    one partner, one period: every billable item priced by the LA-1.1 terms in
--                       force ON THAT ITEM'S DATE (a rate changed mid-month gives two rates in one
--                       run); then the deductions — transfers rejected at the compliance gate
--                       (LA-6.2; never billable, shown to the partner as a COUNT only), credits
--                       accepted (LA-2.19, apportioned by the claim's leads from this partner) and
--                       disputed items (withheld until resolved). The terms as applied are frozen
--                       in terms_snapshot_json.
--     per_transfer     deal-flow rows from the partner (local_date)
--     per_lead         leads the partner submitted (agent_leads.created_at)
--     per_sale         deal-flow rows completed as a sale (disposition_at)
--     per_issued       LA-2.17 issued policies from the partner's deals (issued_at)
--     revenue_share    the rate × commission (LA-4.12) on policies from the partner's deals —
--                      the commission itself never reaches the partner
--   publish             the liability: one cost_entry (partner_payout, negative, incurred_on =
--                       period_end). A draft is invisible to the partner.
--   paid                records when the money moved — paid_on, nothing else.
--   void                reversing entry; nothing deleted.
--   disputes            raised by either side; withheld (a draft's) and resolved accepted (carried
--                       to the partner's next run) or upheld (stays deducted), with who and why.
--
-- Additive. Rollback: select cron.unschedule('la7-payout-drafts'); drop function public.payout_drafts_due(),
--   public.void_payout_run(uuid, uuid, text, uuid), public.mark_payout_run_paid(uuid, uuid, date, text, text),
--   public.publish_payout_run(uuid, uuid, uuid), public.resolve_payout_dispute(uuid, uuid, text, text, uuid),
--   public.raise_payout_dispute(uuid, uuid, uuid, text, uuid, text, bigint), public.payout_run_totals(uuid),
--   public.build_payout_run(uuid, uuid, date, date, uuid), public.bp_share(bigint, integer);
--   alter table public.cost_entry drop constraint cost_entry_payout_run_fk;
--   drop table public.payout_dispute, public.payout_run_item, public.payout_run;
--   alter table public.accounting_settings drop column payout_cadence, drop column payout_draft_days,
--     drop column payout_auto_publish, drop column payout_statement_footer;

alter table public.accounting_settings
  add column if not exists payout_cadence text not null default 'monthly',
  add column if not exists payout_draft_days integer not null default 3,
  add column if not exists payout_auto_publish boolean not null default false,
  add column if not exists payout_statement_footer text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'accounting_settings_payouts' and conrelid = 'public.accounting_settings'::regclass) then
    alter table public.accounting_settings add constraint accounting_settings_payouts check (
      payout_cadence in ('monthly', 'semi_monthly', 'weekly') and payout_draft_days between 0 and 28
      and (payout_statement_footer is null or char_length(payout_statement_footer) <= 1000));
  end if;
end;
$$;

create table if not exists public.payout_run (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agency_id uuid,
  partner_id uuid not null references public.partners(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft',
  gross_cents bigint not null default 0,
  deductions_cents bigint not null default 0,
  disputed_cents bigint not null default 0,
  net_cents bigint not null default 0,
  terms_snapshot_json jsonb not null default '[]'::jsonb,
  statement_footer text,
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
  constraint payout_run_status check (status in ('draft', 'published', 'paid', 'void')),
  constraint payout_run_period check (period_end >= period_start),
  constraint payout_run_money check (gross_cents >= 0 and deductions_cents <= 0 and disputed_cents >= 0 and net_cents = gross_cents + deductions_cents - disputed_cents),
  constraint payout_run_method check (paid_method is null or paid_method in ('ach', 'card', 'cheque', 'wire', 'other')),
  constraint payout_run_paid check ((status = 'paid') = (paid_on is not null) or (status = 'void' and voided_at is not null)),
  constraint payout_run_void check ((status = 'void') = (voided_at is not null) and ((status = 'void') = (void_reason is not null)))
);
create index if not exists payout_run_partner_idx on public.payout_run (tenant_id, partner_id, period_start desc);
create index if not exists payout_run_status_idx on public.payout_run (tenant_id, status);
-- One live run per partner per period.
create unique index if not exists payout_run_one_live on public.payout_run (tenant_id, partner_id, period_start, period_end) where status <> 'void';

create table if not exists public.payout_run_item (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null references public.payout_run(id) on delete restrict,
  item_type text not null,
  source_id uuid,
  occurred_on date not null,
  terms_id uuid,
  rate_applied_cents bigint,
  rate_pct_bp integer,
  amount_cents bigint not null,
  note text,
  constraint payout_run_item_type check (item_type in ('transfer', 'lead', 'sale', 'issued_policy', 'revenue_share', 'rejected', 'credit', 'dispute', 'adjustment')),
  constraint payout_run_item_sign check (
    (item_type in ('transfer', 'lead', 'sale', 'issued_policy') and amount_cents >= 0)
    or (item_type = 'revenue_share')
    or (item_type = 'rejected' and amount_cents = 0)
    or (item_type = 'credit' and amount_cents <= 0)
    or (item_type in ('dispute', 'adjustment'))
  )
);
create index if not exists payout_run_item_run_idx on public.payout_run_item (run_id, item_type, occurred_on);

create table if not exists public.payout_dispute (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null references public.payout_run(id) on delete restrict,
  item_id uuid references public.payout_run_item(id) on delete restrict,
  raised_by_side text not null,
  raised_by uuid,
  raised_at timestamptz not null default now(),
  reason text not null,
  claim_cents bigint not null,
  status text not null default 'open',
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text,
  carried_to_run_id uuid references public.payout_run(id) on delete restrict,
  constraint payout_dispute_side check (raised_by_side in ('agent', 'partner')),
  constraint payout_dispute_status check (status in ('open', 'accepted', 'upheld')),
  constraint payout_dispute_reason check (char_length(btrim(reason)) between 1 and 1000),
  constraint payout_dispute_resolution check ((status = 'open') = (resolved_at is null) and (status = 'open' or resolution_note is not null)),
  constraint payout_dispute_claim check (claim_cents >= 0)
);
create index if not exists payout_dispute_run_idx on public.payout_dispute (run_id);
create index if not exists payout_dispute_carry_idx on public.payout_dispute (tenant_id, status) where carried_to_run_id is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cost_entry_payout_run_fk' and conrelid = 'public.cost_entry'::regclass) then
    alter table public.cost_entry add constraint cost_entry_payout_run_fk foreign key (payout_run_id) references public.payout_run(id) on delete restrict;
  end if;
end;
$$;

-- ─── guards ────────────────────────────────────────────────────────────────────────────────────
-- Runs move only through their writers; a published run's figures are history.
create or replace function public.payout_run_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_writer boolean := coalesce(current_setting('app.payout_writer', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    raise exception 'A payout run is never removed; void it instead.' using errcode = 'P0001';
  end if;
  if not v_writer then
    raise exception 'A payout run changes only through its own actions (build, dispute, publish, paid, void).' using errcode = 'P0001';
  end if;
  if old.status <> 'draft' and (new.gross_cents, new.deductions_cents, new.disputed_cents, new.net_cents, new.terms_snapshot_json, new.period_start, new.period_end, new.partner_id)
       is distinct from (old.gross_cents, old.deductions_cents, old.disputed_cents, old.net_cents, old.terms_snapshot_json, old.period_start, old.period_end, old.partner_id) then
    raise exception 'A published run is history: void it and build it again.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists payout_run_guard on public.payout_run;
create trigger payout_run_guard before update or delete on public.payout_run for each row execute function public.payout_run_guard();

create or replace function public.payout_run_item_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if coalesce(current_setting('app.payout_writer', true), '') <> 'on' then
    raise exception 'Payout items are written by the run, never by hand.' using errcode = 'P0001';
  end if;
  if (select r.status from public.payout_run r where r.id = coalesce(new.run_id, old.run_id)) <> 'draft' then
    raise exception 'The items of a published run are history.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists payout_run_item_guard on public.payout_run_item;
create trigger payout_run_item_guard before insert or update or delete on public.payout_run_item for each row execute function public.payout_run_item_guard();

create or replace function public.payout_dispute_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A dispute never silently disappears: resolve it accepted or upheld.' using errcode = 'P0001';
  end if;
  if coalesce(current_setting('app.payout_writer', true), '') <> 'on' then
    raise exception 'Disputes are raised and resolved through their own actions.' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and old.status <> 'open' and (new.status, new.resolution_note, new.resolved_by, new.resolved_at) is distinct from (old.status, old.resolution_note, old.resolved_by, old.resolved_at) then
    raise exception 'A resolved dispute stays resolved.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists payout_dispute_guard on public.payout_dispute;
create trigger payout_dispute_guard before insert or update or delete on public.payout_dispute for each row execute function public.payout_dispute_guard();

-- ─── the money ─────────────────────────────────────────────────────────────────────────────────
-- A share in basis points of integer cents, rounded half away from zero, in integers only.
create or replace function public.bp_share(p_cents bigint, p_bp integer)
returns bigint
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case when p_cents >= 0 then (p_cents * p_bp + 5000) / 10000 else -((-p_cents * p_bp + 5000) / 10000) end
$$;

-- Totals from the items and the run's open disputes. Draft only: a published run is frozen.
create or replace function public.payout_run_totals(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_gross bigint;
  v_ded bigint;
  v_disp bigint;
begin
  select coalesce(sum(amount_cents) filter (where item_type in ('transfer', 'lead', 'sale', 'issued_policy', 'revenue_share', 'adjustment') and amount_cents > 0), 0),
         coalesce(sum(amount_cents) filter (where item_type in ('credit') or (item_type in ('revenue_share', 'adjustment') and amount_cents < 0)), 0)
    into v_gross, v_ded from public.payout_run_item where run_id = p_run_id;
  -- An item the agency disputed stays out of THIS run however the dispute resolves: accepted pays
  -- it on the next run (carried once), upheld keeps it deducted. Never both.
  select coalesce(sum(d.claim_cents), 0) into v_disp from public.payout_dispute d
   where d.run_id = p_run_id and d.raised_by_side = 'agent';
  perform set_config('app.payout_writer', 'on', true);
  update public.payout_run set gross_cents = v_gross, deductions_cents = v_ded, disputed_cents = v_disp, net_cents = v_gross + v_ded - v_disp
   where id = p_run_id and status = 'draft';
end;
$$;

create or replace function public.build_payout_run(p_tenant_id uuid, p_partner_id uuid, p_from date, p_to date, p_by uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_run uuid;
  v_terms jsonb;
  v_footer text;
begin
  if p_to < p_from then
    raise exception 'build_payout_run: the period ends before it starts' using errcode = '22023';
  end if;
  if not exists (select 1 from public.partners p where p.id = p_partner_id and p.tenant_id = p_tenant_id) then
    raise exception 'build_payout_run: partner % is not in this agency', p_partner_id using errcode = 'P0002';
  end if;
  -- Every term that can apply to an item in the period: the latest one in force at its start, and any that begin inside it.
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'payout_model', t.payout_model::text, 'rate_cents', t.rate_cents, 'rate_pct_bp', t.rate_pct_bp, 'effective_from', t.effective_from) order by t.effective_from), '[]'::jsonb)
    into v_terms
    from public.partner_terms t
   where t.partner_id = p_partner_id
     and (t.effective_from > p_from and t.effective_from <= p_to
          or t.effective_from = (select max(t2.effective_from) from public.partner_terms t2 where t2.partner_id = p_partner_id and t2.effective_from <= p_from));
  if jsonb_array_length(v_terms) = 0 then
    raise exception 'build_payout_run: this partner has no terms in force for the period — record them on the partner first' using errcode = '22023';
  end if;
  select s.payout_statement_footer into v_footer from public.accounting_settings s where s.tenant_id = p_tenant_id;

  perform set_config('app.payout_writer', 'on', true);
  insert into public.payout_run (tenant_id, partner_id, period_start, period_end, terms_snapshot_json, statement_footer, created_by)
  values (p_tenant_id, p_partner_id, p_from, p_to, v_terms, v_footer, p_by)
  returning id into v_run;

  -- Each item priced by the term in force on its own date (from the frozen snapshot).
  with terms as (
    select (j->>'id')::uuid as id, j->>'payout_model' as model, (j->>'rate_cents')::bigint as rate_cents, (j->>'rate_pct_bp')::int as rate_bp, (j->>'effective_from')::date as eff
      from jsonb_array_elements(v_terms) j
  ),
  basis as (
    select 'transfer'::text as item_type, d.id as source_id, d.local_date as on_date, null::bigint as base_cents
      from public.deal_flow d where d.tenant_id = p_tenant_id and d.partner_id = p_partner_id and d.local_date between p_from and p_to
    union all
    select 'lead', l.id, (l.created_at at time zone 'UTC')::date, null
      from public.agent_leads l where l.tenant_id = p_tenant_id and l.partner_id = p_partner_id and l.created_at >= p_from::timestamptz and l.created_at < (p_to + 1)::timestamptz
    union all
    select 'sale', d.id, (d.disposition_at at time zone 'UTC')::date, null
      from public.deal_flow d where d.tenant_id = p_tenant_id and d.partner_id = p_partner_id and d.status = 'completed'
       and d.disposition_at >= p_from::timestamptz and d.disposition_at < (p_to + 1)::timestamptz
    union all
    select 'issued_policy', i.id, (i.issued_at at time zone 'UTC')::date, null
      from public.tenant_issued_policies i join public.deal_flow d on d.id = i.deal_id
     where i.tenant_id = p_tenant_id and d.partner_id = p_partner_id and i.status = 'issued'
       and i.issued_at >= p_from::timestamptz and i.issued_at < (p_to + 1)::timestamptz
    union all
    -- Revenue share: commission on the partner's policies, per entry, by its transaction date.
    select 'revenue_share', e.id, coalesce(e.transaction_date, e.statement_date), e.amount_cents
      from public.commission_entry e
      join public.tenant_issued_policies i on i.tenant_id = e.tenant_id and i.policy_number = e.policy_number
      join public.deal_flow d on d.id = i.deal_id
     where e.tenant_id = p_tenant_id and d.partner_id = p_partner_id and e.entry_type in ('advance', 'earned', 'chargeback', 'reversal')
       and coalesce(e.transaction_date, e.statement_date) between p_from and p_to
  ),
  priced as (
    select b.*, t.id as terms_id, t.model, t.rate_cents, t.rate_bp
      from basis b
      join lateral (select * from terms t where t.eff <= b.on_date order by t.eff desc limit 1) t on true
     where (b.item_type = 'transfer' and t.model = 'per_transfer') or (b.item_type = 'lead' and t.model = 'per_lead')
        or (b.item_type = 'sale' and t.model = 'per_sale') or (b.item_type = 'issued_policy' and t.model = 'per_issued_policy')
        or (b.item_type = 'revenue_share' and t.model = 'revenue_share')
  )
  insert into public.payout_run_item (tenant_id, run_id, item_type, source_id, occurred_on, terms_id, rate_applied_cents, rate_pct_bp, amount_cents)
  select p_tenant_id, v_run, p.item_type, p.source_id, p.on_date, p.terms_id,
         case when p.item_type = 'revenue_share' then null else p.rate_cents end,
         case when p.item_type = 'revenue_share' then p.rate_bp end,
         case when p.item_type = 'revenue_share' then public.bp_share(p.base_cents, p.rate_bp) else p.rate_cents end
    from priced p;

  -- Rejected at the compliance gate: never billable; a count on the statement (amount zero).
  if to_regclass('public.transfer_verdict') is not null then
    execute 'insert into public.payout_run_item (tenant_id, run_id, item_type, source_id, occurred_on, amount_cents, note)
             select $1, $2, ''rejected'', v.id, (v.evaluated_at at time zone ''UTC'')::date, 0, v.blocking_reason
               from public.transfer_verdict v
              where v.tenant_id = $1 and v.partner_id = $3 and v.verdict = ''reject''
                and v.evaluated_at >= $4::timestamptz and v.evaluated_at < ($5 + 1)::timestamptz'
      using p_tenant_id, v_run, p_partner_id, p_from, p_to;
  end if;

  -- Credits accepted on LA-2.19 claims, the share of each claim whose leads came from this partner.
  insert into public.payout_run_item (tenant_id, run_id, item_type, source_id, occurred_on, amount_cents, note)
  select p_tenant_id, v_run, 'credit', c.id, (c.resolved_at at time zone 'UTC')::date,
         -((c.amount_credited_cents::bigint * x.mine) / nullif(x.total, 0)),
         x.mine || ' of ' || x.total || ' claimed leads'
    from public.lead_claims c
    join lateral (
      select count(*) filter (where l.partner_id = p_partner_id) as mine, count(*) as total
        from public.lead_claim_items ci left join public.agent_leads l on l.id = ci.lead_id
       where ci.claim_id = c.id
    ) x on x.mine > 0
   where c.tenant_id = p_tenant_id and c.status in ('accepted', 'partial') and coalesce(c.amount_credited_cents, 0) > 0
     and c.resolved_at >= p_from::timestamptz and c.resolved_at < (p_to + 1)::timestamptz;

  -- Disputes resolved ACCEPTED on earlier runs of this partner, carried here once.
  insert into public.payout_run_item (tenant_id, run_id, item_type, source_id, occurred_on, amount_cents, note)
  select p_tenant_id, v_run, 'adjustment', d.id, (d.resolved_at at time zone 'UTC')::date, d.claim_cents, left('Dispute accepted: ' || d.reason, 500)
    from public.payout_dispute d join public.payout_run r on r.id = d.run_id
   where d.tenant_id = p_tenant_id and r.partner_id = p_partner_id and d.status = 'accepted' and d.carried_to_run_id is null and d.claim_cents > 0;
  update public.payout_dispute d set carried_to_run_id = v_run
    from public.payout_run r
   where r.id = d.run_id and d.tenant_id = p_tenant_id and r.partner_id = p_partner_id and d.status = 'accepted' and d.carried_to_run_id is null and d.claim_cents > 0;

  perform public.payout_run_totals(v_run);
  perform set_config('app.payout_writer', '', true);
  return v_run;
end;
$$;

-- Either side raises a dispute. On a draft the agent's withholds the item; on a published run the
-- partner's is recorded against it (published figures do not change) and settles on a later run.
create or replace function public.raise_payout_dispute(p_tenant_id uuid, p_run_id uuid, p_item_id uuid, p_side text, p_by uuid, p_reason text, p_claim_cents bigint)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r public.payout_run;
  v_amount bigint;
  v_id uuid;
begin
  select * into r from public.payout_run where id = p_run_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'raise_payout_dispute: run % is not in this agency', p_run_id using errcode = 'P0002';
  end if;
  if p_side = 'agent' and r.status <> 'draft' then
    raise exception 'raise_payout_dispute: the agency disputes items while the run is a draft' using errcode = '22023';
  end if;
  if p_side = 'partner' and r.status not in ('published', 'paid') then
    raise exception 'raise_payout_dispute: a partner disputes a published run' using errcode = '22023';
  end if;
  if p_item_id is not null then
    select i.amount_cents into v_amount from public.payout_run_item i where i.id = p_item_id and i.run_id = r.id;
    if not found then
      raise exception 'raise_payout_dispute: that item is not on this run' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.payout_dispute d where d.item_id = p_item_id and d.status = 'open') then
      raise exception 'raise_payout_dispute: that item is already disputed' using errcode = '23505';
    end if;
  elsif p_side = 'agent' then
    raise exception 'raise_payout_dispute: the agency disputes a specific item' using errcode = '22023';
  end if;
  perform set_config('app.payout_writer', 'on', true);
  insert into public.payout_dispute (tenant_id, run_id, item_id, raised_by_side, raised_by, reason, claim_cents)
  values (p_tenant_id, r.id, p_item_id, p_side, p_by, btrim(p_reason), case when p_side = 'agent' then greatest(coalesce(v_amount, 0), 0) else greatest(coalesce(p_claim_cents, 0), 0) end)
  returning id into v_id;
  perform public.payout_run_totals(r.id);
  perform set_config('app.payout_writer', '', true);
  return v_id;
end;
$$;

create or replace function public.resolve_payout_dispute(p_tenant_id uuid, p_dispute_id uuid, p_status text, p_note text, p_by uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  d public.payout_dispute;
begin
  if p_status not in ('accepted', 'upheld') then
    raise exception 'resolve_payout_dispute: a dispute is accepted or upheld' using errcode = '22023';
  end if;
  if p_note is null or btrim(p_note) = '' then
    raise exception 'resolve_payout_dispute: say why' using errcode = '22023';
  end if;
  select * into d from public.payout_dispute where id = p_dispute_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'resolve_payout_dispute: dispute % is not in this agency', p_dispute_id using errcode = 'P0002';
  end if;
  if d.status <> 'open' then
    raise exception 'resolve_payout_dispute: already resolved' using errcode = '22023';
  end if;
  perform set_config('app.payout_writer', 'on', true);
  update public.payout_dispute set status = p_status, resolution_note = left(btrim(p_note), 1000), resolved_by = p_by, resolved_at = now() where id = d.id;
  perform public.payout_run_totals(d.run_id);
  perform set_config('app.payout_writer', '', true);
end;
$$;

-- Publish: the partner can now read it, and the cost exists — dated the period's end.
create or replace function public.publish_payout_run(p_tenant_id uuid, p_run_id uuid, p_by uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r public.payout_run;
  v_entry uuid;
begin
  select * into r from public.payout_run where id = p_run_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'publish_payout_run: run % is not in this agency', p_run_id using errcode = 'P0002';
  end if;
  if r.status <> 'draft' then
    raise exception 'publish_payout_run: only a draft is published (this one is %)', r.status using errcode = '22023';
  end if;
  perform public.payout_run_totals(r.id);
  select * into r from public.payout_run where id = p_run_id;
  if r.net_cents > 0 then
    v_entry := public.record_cost_entry(p_tenant_id, jsonb_build_object('agency_id', r.agency_id, 'entry_type', 'partner_payout', 'amount_cents', -r.net_cents,
      'incurred_on', r.period_end, 'counterparty_type', 'partner', 'counterparty_id', r.partner_id, 'partner_id', r.partner_id, 'payout_run_id', r.id,
      'description', 'Payout ' || to_char(r.period_start, 'DD Mon') || ' – ' || to_char(r.period_end, 'DD Mon YYYY')), p_by);
  elsif r.net_cents < 0 then
    -- More came back than was earned: the partner owes the agency.
    v_entry := public.record_cost_entry(p_tenant_id, jsonb_build_object('agency_id', r.agency_id, 'entry_type', 'refund', 'amount_cents', -r.net_cents,
      'incurred_on', r.period_end, 'counterparty_type', 'partner', 'counterparty_id', r.partner_id, 'partner_id', r.partner_id, 'payout_run_id', r.id,
      'description', 'Owed by the partner ' || to_char(r.period_start, 'DD Mon') || ' – ' || to_char(r.period_end, 'DD Mon YYYY')), p_by);
  end if;
  perform set_config('app.payout_writer', 'on', true);
  update public.payout_run set status = 'published', published_by = p_by, published_at = now() where id = r.id;
  perform set_config('app.payout_writer', '', true);
  return v_entry;
end;
$$;

create or replace function public.mark_payout_run_paid(p_tenant_id uuid, p_run_id uuid, p_paid_on date, p_method text, p_reference text)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r public.payout_run;
  v_ids uuid[];
  v_n integer;
begin
  select * into r from public.payout_run where id = p_run_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'mark_payout_run_paid: run % is not in this agency', p_run_id using errcode = 'P0002';
  end if;
  if r.status <> 'published' or p_paid_on is null then
    raise exception 'mark_payout_run_paid: a published run and a payment date are needed' using errcode = '22023';
  end if;
  select coalesce(array_agg(c.id), '{}') into v_ids from public.cost_entry c where c.tenant_id = p_tenant_id and c.payout_run_id = r.id and c.reverses_entry_id is null;
  v_n := public.mark_cost_entries_paid(p_tenant_id, v_ids, p_paid_on);
  perform set_config('app.payout_writer', 'on', true);
  update public.payout_run set status = 'paid', paid_on = p_paid_on, paid_method = nullif(btrim(p_method), ''), payment_reference = nullif(btrim(p_reference), '') where id = r.id;
  perform set_config('app.payout_writer', '', true);
  return v_n;
end;
$$;

create or replace function public.void_payout_run(p_tenant_id uuid, p_run_id uuid, p_reason text, p_by uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r public.payout_run;
  e record;
  v_n integer := 0;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'void_payout_run: say why' using errcode = '22023';
  end if;
  select * into r from public.payout_run where id = p_run_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'void_payout_run: run % is not in this agency', p_run_id using errcode = 'P0002';
  end if;
  if r.status = 'void' then
    raise exception 'void_payout_run: already void' using errcode = '22023';
  end if;
  for e in select c.id from public.cost_entry c where c.tenant_id = p_tenant_id and c.payout_run_id = r.id and c.reverses_entry_id is null
              and not exists (select 1 from public.cost_entry x where x.reverses_entry_id = c.id) loop
    perform public.reverse_cost_entry(p_tenant_id, e.id, 'Payout run voided: ' || btrim(p_reason), p_by);
    v_n := v_n + 1;
  end loop;
  perform set_config('app.payout_writer', 'on', true);
  -- Accepted disputes this run had carried go back to waiting for the next run.
  update public.payout_dispute set carried_to_run_id = null where carried_to_run_id = r.id;
  update public.payout_run set status = 'void', voided_by = p_by, voided_at = now(), void_reason = left(btrim(p_reason), 500) where id = r.id;
  perform set_config('app.payout_writer', '', true);
  return v_n;
end;
$$;

-- Draft generation on the agency's cadence, the configured days after a period ends. Never
-- publishes: a published run is visible to the partner, and a wrong number already read is far
-- harder to correct than one caught in draft (auto-publish is off unless the agency turned it on).
create or replace function public.payout_drafts_due()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  s record;
  v_from date;
  v_to date;
  v_n integer := 0;
  v_run uuid;
begin
  for s in select a.tenant_id, a.payout_cadence, a.payout_draft_days, a.payout_auto_publish, p.id as partner_id
             from public.accounting_settings a
             join public.partners p on p.tenant_id = a.tenant_id and p.status in ('active', 'paused')
            where exists (select 1 from public.partner_terms t where t.partner_id = p.id) loop
    if s.payout_cadence = 'weekly' then
      v_to := (date_trunc('week', current_date - s.payout_draft_days) - interval '1 day')::date;
      v_from := v_to - 6;
    elsif s.payout_cadence = 'semi_monthly' then
      v_to := current_date - s.payout_draft_days - 1;
      if extract(day from v_to) >= 16 then
        v_from := date_trunc('month', v_to)::date; v_to := v_from + 14;
      else
        v_from := (date_trunc('month', v_to) - interval '1 month')::date + 15; v_to := (date_trunc('month', v_to) - interval '1 day')::date;
      end if;
    else
      v_to := (date_trunc('month', current_date - s.payout_draft_days) - interval '1 day')::date;
      v_from := date_trunc('month', v_to)::date;
    end if;
    continue when exists (select 1 from public.payout_run r where r.tenant_id = s.tenant_id and r.partner_id = s.partner_id and r.period_start = v_from and r.period_end = v_to and r.status <> 'void');
    begin
      v_run := public.build_payout_run(s.tenant_id, s.partner_id, v_from, v_to, null);
      if s.payout_auto_publish then
        perform public.publish_payout_run(s.tenant_id, v_run, null);
      end if;
      v_n := v_n + 1;
    exception when others then
      -- One partner's missing terms must not stop the others' drafts.
      null;
    end;
  end loop;
  return v_n;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('la7-payout-drafts', '0 6 * * *', $job$select public.payout_drafts_due()$job$);
  end if;
end;
$$;

-- ─── access ────────────────────────────────────────────────────────────────────────────────────
alter table public.payout_run enable row level security;
alter table public.payout_run_item enable row level security;
alter table public.payout_dispute enable row level security;
drop policy if exists payout_run_read on public.payout_run;
create policy payout_run_read on public.payout_run for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists payout_run_item_read on public.payout_run_item;
create policy payout_run_item_read on public.payout_run_item for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists payout_dispute_read on public.payout_dispute;
create policy payout_dispute_read on public.payout_dispute for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.payout_run, public.payout_run_item, public.payout_dispute from public, anon, authenticated;
-- Everything is written by the functions above; the roles only read.
revoke insert, update, delete, truncate on public.payout_run, public.payout_run_item, public.payout_dispute from service_role, tenant_app;
grant select on public.payout_run, public.payout_run_item, public.payout_dispute to service_role, tenant_app;

revoke all on function public.payout_run_guard() from public, anon, authenticated;
revoke all on function public.payout_run_item_guard() from public, anon, authenticated;
revoke all on function public.payout_dispute_guard() from public, anon, authenticated;
revoke all on function public.bp_share(bigint, integer) from public, anon, authenticated;
grant execute on function public.bp_share(bigint, integer) to service_role, tenant_app;
revoke all on function public.payout_run_totals(uuid) from public, anon, authenticated, tenant_app, service_role;
revoke all on function public.build_payout_run(uuid, uuid, date, date, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.raise_payout_dispute(uuid, uuid, uuid, text, uuid, text, bigint) from public, anon, authenticated, tenant_app;
revoke all on function public.resolve_payout_dispute(uuid, uuid, text, text, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.publish_payout_run(uuid, uuid, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.mark_payout_run_paid(uuid, uuid, date, text, text) from public, anon, authenticated, tenant_app;
revoke all on function public.void_payout_run(uuid, uuid, text, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.payout_drafts_due() from public, anon, authenticated, tenant_app;
grant execute on function public.build_payout_run(uuid, uuid, date, date, uuid) to service_role;
grant execute on function public.raise_payout_dispute(uuid, uuid, uuid, text, uuid, text, bigint) to service_role;
grant execute on function public.resolve_payout_dispute(uuid, uuid, text, text, uuid) to service_role;
grant execute on function public.publish_payout_run(uuid, uuid, uuid) to service_role;
grant execute on function public.mark_payout_run_paid(uuid, uuid, date, text, text) to service_role;
grant execute on function public.void_payout_run(uuid, uuid, text, uuid) to service_role;
grant execute on function public.payout_drafts_due() to service_role;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261015240000', 'la_7_4_partner_payouts') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [7/10] 20261015250000_la_7_5_producer_splits.sql ─────────────────────────────
begin;

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

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261015250000', 'la_7_5_producer_splits') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [8/10] 20261015260000_la_7_6_bank_matching.sql ───────────────────────────────
begin;

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

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261015260000', 'la_7_6_bank_matching') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [9/10] 20261015270000_la_7_8_tax.sql ─────────────────────────────────────────
begin;

-- LA-7.8 (Notion sprint, Module 7 — Accounting) · 1099s and tax-ready exports.
--
-- We produce FIGURES from records we hold. We do not file anything, do not generate the official
-- form, do not say what is deductible, and do not categorise an ambiguous expense without the agent
-- choosing. The screen and the export say so, and the notice cannot be dismissed or edited.
--
--   payee_tax_profile       legal name (often not the trading name), tax ID encrypted at rest
--                           (the application's per-agency key, bound to this row) and masked —
--                           a sole proprietor's tax ID IS their SSN, so every tax ID gets SSN handling.
--   payee_tax_reveal_log    one row per reveal; append-only.
--   contractor_payments     per payee, per calendar year, on PAID_ON — the one place in LA-7 where
--                           cash is correct: a 1099 follows when money actually moved.
--   tax_category_map        every cost, expense and commission type → a bucket. Shipped defaults
--                           (tenant null) and the agency's overrides; the bucket is shown per line.
--
-- Additive. Rollback: drop function public.tax_category_totals(uuid, date, date, text), public.contractor_payments(uuid, integer);
--   drop table public.tax_category_map, public.payee_tax_reveal_log, public.payee_tax_profile;
--   alter table public.accounting_settings drop column tax_1099_threshold_cents, drop column tax_id_viewer_roles;

-- $2,000: the 1099-NEC / 1099-MISC threshold for payments from 1 January 2026 (raised from $600;
-- indexed for inflation from 2027). Editable — it moves; check the year's IRS instructions.
alter table public.accounting_settings
  add column if not exists tax_1099_threshold_cents bigint not null default 200000,
  add column if not exists tax_id_viewer_roles text[] not null default array['owner']::text[];
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'accounting_settings_tax' and conrelid = 'public.accounting_settings'::regclass) then
    alter table public.accounting_settings add constraint accounting_settings_tax check (
      tax_1099_threshold_cents between 0 and 100000000 and tax_id_viewer_roles <@ array['owner', 'bookkeeper']::text[] and 'owner' = any(tax_id_viewer_roles));
  end if;
end;
$$;

create table if not exists public.payee_tax_profile (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  payee_type text not null,
  payee_id uuid not null,
  legal_name text,
  tax_id_ciphertext text,
  tax_id_key_version integer,
  tax_id_last4 text,
  tax_id_type text not null default 'none',
  entity_type text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text not null default 'US',
  w9_on_file boolean not null default false,
  w9_document_path text,
  exempt_reason text,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint payee_tax_profile_type check (payee_type in ('partner', 'producer', 'vendor')),
  constraint payee_tax_profile_id_type check (tax_id_type in ('ein', 'ssn', 'foreign', 'none')),
  constraint payee_tax_profile_entity check (entity_type is null or entity_type in ('individual', 'sole_prop', 'llc', 'corp', 'foreign')),
  constraint payee_tax_profile_exempt check (exempt_reason is null or exempt_reason in ('corporation', 'foreign', 'employee')),
  constraint payee_tax_profile_last4 check (tax_id_last4 is null or tax_id_last4 ~ '^[0-9A-Za-z]{4}$'),
  constraint payee_tax_profile_cipher check ((tax_id_ciphertext is null) = (tax_id_last4 is null) and (tax_id_ciphertext is null) = (tax_id_key_version is null)),
  constraint payee_tax_profile_name check (legal_name is null or char_length(btrim(legal_name)) between 1 and 200)
);
create unique index if not exists payee_tax_profile_one on public.payee_tax_profile (tenant_id, payee_type, payee_id);

create table if not exists public.payee_tax_reveal_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  profile_id uuid not null references public.payee_tax_profile(id) on delete cascade,
  user_id uuid not null,
  revealed_at timestamptz not null default now(),
  ip text
);
create index if not exists payee_tax_reveal_log_profile_idx on public.payee_tax_reveal_log (profile_id, revealed_at desc);

create table if not exists public.tax_category_map (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  source_type text not null,
  source_value text not null,
  tax_category text not null,
  is_default boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint tax_category_map_source check (source_type in ('cost_entry_type', 'expense_category', 'commission_entry_type')),
  constraint tax_category_map_category check (tax_category in ('gross_receipts', 'returns_allowances', 'advertising', 'contract_labor', 'commissions_paid', 'software', 'insurance', 'professional_fees', 'licenses', 'office', 'bank_charges', 'other')),
  constraint tax_category_map_default check (is_default = (tenant_id is null))
);
create unique index if not exists tax_category_map_one on public.tax_category_map (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), source_type, source_value);

-- The shipped defaults: a suggestion, not a determination. Every one is overridable per agency.
insert into public.tax_category_map (tenant_id, source_type, source_value, tax_category, is_default) values
  (null, 'commission_entry_type', 'advance', 'gross_receipts', true),
  (null, 'commission_entry_type', 'earned', 'gross_receipts', true),
  (null, 'commission_entry_type', 'override', 'gross_receipts', true),
  (null, 'commission_entry_type', 'held', 'gross_receipts', true),
  (null, 'commission_entry_type', 'chargeback', 'returns_allowances', true),
  (null, 'commission_entry_type', 'reversal', 'returns_allowances', true),
  (null, 'commission_entry_type', 'fee', 'bank_charges', true),
  (null, 'commission_entry_type', 'advance_interest', 'bank_charges', true),
  (null, 'cost_entry_type', 'lead_cost', 'advertising', true),
  (null, 'cost_entry_type', 'partner_payout', 'contract_labor', true),
  (null, 'cost_entry_type', 'producer_split', 'commissions_paid', true),
  (null, 'cost_entry_type', 'platform_fee', 'software', true),
  (null, 'cost_entry_type', 'tool_subscription', 'software', true),
  (null, 'cost_entry_type', 'insurance', 'insurance', true),
  (null, 'cost_entry_type', 'professional_fee', 'professional_fees', true),
  (null, 'cost_entry_type', 'refund', 'advertising', true),
  (null, 'cost_entry_type', 'adjustment', 'other', true),
  (null, 'expense_category', 'software', 'software', true),
  (null, 'expense_category', 'telephony', 'software', true),
  (null, 'expense_category', 'data_services', 'advertising', true),
  (null, 'expense_category', 'insurance', 'insurance', true),
  (null, 'expense_category', 'professional_fees', 'professional_fees', true),
  (null, 'expense_category', 'licensing', 'licenses', true),
  (null, 'expense_category', 'office', 'office', true),
  (null, 'expense_category', 'other', 'other', true)
on conflict do nothing;

-- ─── what was paid to each payee in a calendar year — on paid_on ───────────────────────────────
create or replace function public.contractor_payments(p_tenant_id uuid, p_year integer)
returns table (payee_type text, payee_id uuid, paid_cents bigint, entries bigint)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select x.payee_type, x.payee_id, (-sum(x.amount_cents))::bigint, count(*)::bigint
    from (
      select case when c.partner_id is not null then 'partner' when c.producer_user_id is not null then 'producer' else 'vendor' end as payee_type,
             coalesce(c.partner_id, c.producer_user_id, c.vendor_id) as payee_id, c.amount_cents
        from public.cost_entry c
       where c.tenant_id = p_tenant_id and c.paid_on >= make_date(p_year, 1, 1) and c.paid_on < make_date(p_year + 1, 1, 1)
         and coalesce(c.partner_id, c.producer_user_id, c.vendor_id) is not null
         and c.entry_type in ('lead_cost', 'partner_payout', 'producer_split', 'refund', 'adjustment')
    ) x
   group by x.payee_type, x.payee_id
$$;

-- The year by bucket: every money row mapped through the agency's override, else the default.
-- Expense rows map by their category; other cost rows by type; commission rows by type.
create or replace function public.tax_category_totals(p_tenant_id uuid, p_from date, p_to date, p_basis text default 'accrual')
returns table (tax_category text, source_type text, source_value text, amount_cents bigint, entries bigint)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_comm text;
  v_cost text;
begin
  if p_basis not in ('accrual', 'cash') then
    raise exception 'tax_category_totals: basis is accrual or cash' using errcode = '22023';
  end if;
  v_comm := case when p_basis = 'cash' then 'e.statement_date' else 'coalesce(e.transaction_date, e.statement_date)' end;
  v_cost := case when p_basis = 'cash' then 'c.paid_on' else 'c.incurred_on' end;
  return query execute format($q$
    with rows as (
      select 'commission_entry_type'::text as st, e.entry_type as sv, e.amount_cents from public.commission_entry e where e.tenant_id = $1 and %1$s >= $2 and %1$s < $3
      union all
      select 'commission_entry_type', e.entry_type, e.amount_cents from public.commission_account_entry e where e.tenant_id = $1 and %1$s >= $2 and %1$s < $3
      union all
      select case when x.id is not null then 'expense_category' else 'cost_entry_type' end, coalesce(x.category, c.entry_type), c.amount_cents
        from public.cost_entry c left join public.expense x on x.id = c.expense_id
       where c.tenant_id = $1 and %2$s >= $2 and %2$s < $3
    )
    select coalesce(t.tax_category, d.tax_category, 'other'), r.st, r.sv, sum(r.amount_cents)::bigint, count(*)::bigint
      from rows r
      left join public.tax_category_map t on t.tenant_id = $1 and t.source_type = r.st and t.source_value = r.sv
      left join public.tax_category_map d on d.tenant_id is null and d.source_type = r.st and d.source_value = r.sv
     group by 1, 2, 3
  $q$, v_comm, v_cost) using p_tenant_id, p_from, p_to;
end;
$$;

-- ─── access ────────────────────────────────────────────────────────────────────────────────────
alter table public.payee_tax_profile enable row level security;
alter table public.payee_tax_reveal_log enable row level security;
alter table public.tax_category_map enable row level security;
drop policy if exists payee_tax_profile_read on public.payee_tax_profile;
create policy payee_tax_profile_read on public.payee_tax_profile for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists payee_tax_reveal_log_read on public.payee_tax_reveal_log;
create policy payee_tax_reveal_log_read on public.payee_tax_reveal_log for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists tax_category_map_read on public.tax_category_map;
create policy tax_category_map_read on public.tax_category_map for select to tenant_app using (tenant_id is null or tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.payee_tax_profile, public.payee_tax_reveal_log, public.tax_category_map from public, anon, authenticated;
revoke insert, update, delete, truncate on public.payee_tax_profile, public.payee_tax_reveal_log, public.tax_category_map from tenant_app;
-- The ciphertext is the server's alone: tenant_app reads the profile without it.
revoke select on public.payee_tax_profile from tenant_app;
grant select (id, tenant_id, payee_type, payee_id, legal_name, tax_id_last4, tax_id_type, entity_type, address_line1, address_line2, city, state, postal_code, country, w9_on_file, w9_document_path, exempt_reason, updated_by, updated_at) on public.payee_tax_profile to tenant_app;
grant select on public.payee_tax_reveal_log, public.tax_category_map to tenant_app;
revoke delete, truncate on public.payee_tax_profile, public.payee_tax_reveal_log from service_role;
revoke update on public.payee_tax_reveal_log from service_role;
grant select, insert, update on public.payee_tax_profile to service_role;
grant select, insert on public.payee_tax_reveal_log to service_role;
grant select, insert, update, delete on public.tax_category_map to service_role;
revoke truncate on public.tax_category_map from service_role;

revoke all on function public.contractor_payments(uuid, integer) from public, anon, authenticated, tenant_app;
revoke all on function public.tax_category_totals(uuid, date, date, text) from public, anon, authenticated, tenant_app;
grant execute on function public.contractor_payments(uuid, integer) to service_role;
grant execute on function public.tax_category_totals(uuid, date, date, text) to service_role;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261015270000', 'la_7_8_tax') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [10/10] 20261015280000_la_7_9_accounting_settings.sql ─────────────────────────
begin;

-- LA-7.9 (Notion sprint, Module 7 — Accounting) · accounting settings.
--
-- Every LA-7 setting is already a column of accounting_settings (added by the task that reads it,
-- 7.2–7.8). This adds the trail: every change, who, what, from, to, when — because "why did cost per
-- policy drop in April" is a question that gets asked, and the answer is sometimes that someone moved
-- a category from acquisition to overhead.
--
-- Changing a setting never rewrites recorded figures: payout runs keep their frozen terms, expenses
-- keep the acquisition flag they were booked with, published statements stay as published.
--
-- Additive. Rollback: drop table public.accounting_setting_change;

create table if not exists public.accounting_setting_change (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  field text not null,
  old_value jsonb,
  new_value jsonb,
  changed_by uuid not null,
  changed_at timestamptz not null default now(),
  constraint accounting_setting_change_field check (char_length(field) between 1 and 80)
);
create index if not exists accounting_setting_change_tenant_idx on public.accounting_setting_change (tenant_id, changed_at desc);

alter table public.accounting_setting_change enable row level security;
drop policy if exists accounting_setting_change_read on public.accounting_setting_change;
create policy accounting_setting_change_read on public.accounting_setting_change for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.accounting_setting_change from public, anon, authenticated;
-- Append-only.
revoke insert, update, delete, truncate on public.accounting_setting_change from tenant_app;
revoke update, delete, truncate on public.accounting_setting_change from service_role;
grant select on public.accounting_setting_change to tenant_app;
grant select, insert on public.accounting_setting_change to service_role;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261015280000', 'la_7_9_accounting_settings') on conflict do nothing;
  end if;
end $bundle$;
commit;
