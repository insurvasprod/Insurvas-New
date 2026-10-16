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
