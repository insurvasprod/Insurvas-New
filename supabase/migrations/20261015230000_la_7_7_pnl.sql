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
