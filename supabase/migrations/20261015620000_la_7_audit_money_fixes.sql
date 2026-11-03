-- LA-7 (Notion sprint, Module 7 — Accounting) · audit fixes: places where money was counted twice,
-- counted when it is not money, or booked on the wrong day. Every function below is restated from
-- its LIVE definition (checked against 20261015200000–280000 on 2026-10-15: identical) with only the
-- change named beside it.
--
--   P&L          held commission is never part of money in or net (LA-4.12): pnl_lines reports it
--                as its own section, 'held'; pnl_monthly leaves it out. A reversal of held money is
--                held money too.
--   cost ledger  a reversal books no cash: paid_on stays NULL unless money actually comes back
--                (marked paid on its own). The reversed entry's payment stays in its own period, so
--                a cash P&L or a 1099 total never drops retroactively on the day of a void.
--   payouts      one live run per partner per DAY (any overlap is refused, under a per-partner lock);
--                a partner's period is booked once — by its payout run or by an invoice from it,
--                never both; revenue share matches the policy on carrier AND number; a dispute is
--                resolved only on a published run, a voided run's open (and accepted, not yet
--                carried) disputes become void and nothing of them is carried; a partner's claim is
--                at most the disputed item (or the run's gross), and at least the agency's dispute
--                tolerance (LA-7.9, new setting payout_dispute_tolerance_cents, default 0).
--   producers    a share falls back to the policy book's writing agent when the commission line
--                names none; a run's earnings are only split entries — paid, void restorations and
--                write-offs are balance, so a void + rebuild pays once and a write-off is not income.
--   invoices     the comparison counts deal flow from THAT partner (within the line's campaign) and
--                deducts its credits (claims apportioned by the partner's leads).
--   tax          held commission is not gross receipts; a reversal is bucketed as what it reverses
--                (an unattributed one by its sign); a category override is one atomic, audited write.
--
-- Additive. Rollback: restate the functions from 20261015200000–270000; then
--   drop function public.set_tax_category_override(uuid, text, text, text, uuid), public.vendor_invoice_span(uuid);
--   alter table public.payout_dispute drop constraint payout_dispute_status, add constraint payout_dispute_status check (status in ('open', 'accepted', 'upheld'));
--   alter table public.accounting_settings drop constraint accounting_settings_dispute_tolerance, drop column payout_dispute_tolerance_cents;

-- ─── settings: the payout dispute tolerance LA-7.9 names ───────────────────────────────────────
alter table public.accounting_settings
  add column if not exists payout_dispute_tolerance_cents bigint not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'accounting_settings_dispute_tolerance' and conrelid = 'public.accounting_settings'::regclass) then
    alter table public.accounting_settings add constraint accounting_settings_dispute_tolerance check (payout_dispute_tolerance_cents between 0 and 100000000);
  end if;
end;
$$;

-- ─── disputes can be void (their run was voided) ───────────────────────────────────────────────
alter table public.payout_dispute drop constraint if exists payout_dispute_status;
alter table public.payout_dispute add constraint payout_dispute_status check (status in ('open', 'accepted', 'upheld', 'void'));

-- ─── P&L: held is not money in ─────────────────────────────────────────────────────────────────
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
      -- Held money (and a reversal of it) is earned and acknowledged but not paid: its own section, never in net.
      select case when coalesce(e.corrects_type, e.entry_type) = 'held' then 'held' else 'in' end as section, e.entry_type, e.amount_cents
        from public.commission_entry e where e.tenant_id = $1 and %1$s >= $2 and %1$s < $3
      union all
      select case when coalesce(e.corrects_type, e.entry_type) = 'held' then 'held' else 'in' end, e.entry_type, e.amount_cents
        from public.commission_account_entry e where e.tenant_id = $1 and %1$s >= $2 and %1$s < $3
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
    select comm.section, comm.entry_type, null::text, null::uuid, null::text, sum(comm.amount_cents)::bigint, count(*)::bigint
      from comm group by comm.section, comm.entry_type
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
  -- The trend is net money: held commission is left out.
  return query execute format($q$
    select date_trunc('month', %1$s)::date, 'in'::text, sum(e.amount_cents)::bigint
      from public.commission_entry e where e.tenant_id = $1 and %1$s >= $2 and %1$s < $3 and coalesce(e.corrects_type, e.entry_type) <> 'held' group by 1
    union all
    select date_trunc('month', %1$s)::date, 'in'::text, sum(e.amount_cents)::bigint
      from public.commission_account_entry e where e.tenant_id = $1 and %1$s >= $2 and %1$s < $3 and coalesce(e.corrects_type, e.entry_type) <> 'held' group by 1
    union all
    select date_trunc('month', %2$s)::date, public.pnl_section('cost', c.entry_type, c.expense_id, x.is_acquisition_cost, c.vendor_id, c.partner_id), sum(c.amount_cents)::bigint
      from public.cost_entry c left join public.expense x on x.id = c.expense_id
     where c.tenant_id = $1 and %2$s >= $2 and %2$s < $3 group by 1, 2
  $q$, v_comm, v_cost) using p_tenant_id, p_from, p_to;
end;
$$;

-- ─── cost ledger: a reversal books no cash ─────────────────────────────────────────────────────
-- The mirror of the original, same type and attachments, opposite amount, dated today unless told
-- otherwise (a reversal of an August cost made in October is an October event on accrual). paid_on
-- is NULL: voiding a paid cost does not bring the money back. If it does come back, that is marked
-- paid on the reversal like any payment, on the day it arrives.
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
  values (o.tenant_id, o.agency_id, o.entry_type, -o.amount_cents, coalesce(p_on, current_date), null,
          o.counterparty_type, o.counterparty_id, o.counterparty_name, o.campaign_id, o.vendor_id, o.partner_id, o.policy_number, o.carrier_id, o.producer_user_id,
          o.invoice_id, o.payout_run_id, o.expense_id, left('Reversal: ' || o.description, 500), o.tax_category, p_by, o.id, btrim(p_reason))
  returning id into v_id;
  return v_id;
end;
$$;

-- ─── an invoice's period: every line's window (the comparison's own rule), as one range ────────
create or replace function public.vendor_invoice_span(p_invoice_id uuid)
returns daterange
language sql
stable
set search_path = public, pg_catalog
as $$
  select daterange(min(coalesce(l.period_start, i.period_start, date_trunc('month', i.invoice_date)::date)),
                   max(coalesce(l.period_end, i.period_end, (date_trunc('month', i.invoice_date) + interval '1 month - 1 day')::date)), '[]')
    from public.vendor_invoice i
    left join public.vendor_invoice_line l on l.invoice_id = i.id
   where i.id = p_invoice_id
$$;

-- ─── invoices: compare with what THIS partner sent, net of its credits ─────────────────────────
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
      -- A partner's invoice counts that partner's transfers (within the line's campaign, if it names one);
      -- a vendor's, the line's campaign or else the vendor's.
      select count(*)::int into v_acc from public.deal_flow d
       where d.tenant_id = p_tenant_id and d.local_date between v_from and v_to
         and case when i.partner_id is not null then d.partner_id = i.partner_id and (l.campaign_id is null or d.campaign_id = l.campaign_id)
                  when l.campaign_id is not null then d.campaign_id = l.campaign_id
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
    if l.lead_type in ('live_transfer', 'data_list', 'aged_lead') then
      if i.vendor_id is not null then
        select coalesce(sum(c.lead_count), 0)::int, coalesce(sum(c.amount_credited_cents), 0)::bigint into v_cc, v_cents from public.lead_claims c
         where c.tenant_id = p_tenant_id and c.vendor_id = i.vendor_id and c.status in ('accepted', 'partial')
           and c.resolved_at >= v_from::timestamptz and c.resolved_at < (v_to + 1)::timestamptz
           and (l.campaign_id is null or c.campaign_id = l.campaign_id);
      else
        -- A partner's credits: each accepted claim's share whose leads came from this partner — the
        -- payout run's own apportionment.
        select coalesce(sum(x.mine), 0)::int, coalesce(sum((c.amount_credited_cents::bigint * x.mine) / nullif(x.total, 0)), 0)::bigint into v_cc, v_cents
          from public.lead_claims c
          join lateral (
            select count(*) filter (where ld.partner_id = i.partner_id) as mine, count(*) as total
              from public.lead_claim_items ci left join public.agent_leads ld on ld.id = ci.lead_id
             where ci.claim_id = c.id
          ) x on x.mine > 0
         where c.tenant_id = p_tenant_id and c.status in ('accepted', 'partial') and coalesce(c.amount_credited_cents, 0) > 0
           and c.resolved_at >= v_from::timestamptz and c.resolved_at < (v_to + 1)::timestamptz
           and (l.campaign_id is null or c.campaign_id = l.campaign_id);
      end if;
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

-- ─── approve: a partner's period already booked by its payout run is not booked again ──────────
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
  if i.partner_id is not null then
    -- The same lock build_payout_run takes: the two cannot both book one partner's period.
    perform pg_advisory_xact_lock(hashtextextended('la7.partner_period:' || i.partner_id::text, 0));
    if exists (select 1 from public.payout_run r where r.tenant_id = p_tenant_id and r.partner_id = i.partner_id and r.status <> 'void'
                  and daterange(r.period_start, r.period_end, '[]') && public.vendor_invoice_span(i.id)) then
      raise exception 'approve_vendor_invoice: a payout run already books this partner for part of the invoice''s period — compare the invoice with that run instead of approving it, or void the run first' using errcode = '23505';
    end if;
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

-- ─── partner payouts ───────────────────────────────────────────────────────────────────────────
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
  -- One partner's period is booked once: no second live run over any of its days, and not over a
  -- period an approved invoice from the partner already booked. Serialised per partner.
  perform pg_advisory_xact_lock(hashtextextended('la7.partner_period:' || p_partner_id::text, 0));
  if exists (select 1 from public.payout_run r where r.tenant_id = p_tenant_id and r.partner_id = p_partner_id and r.status <> 'void'
                and r.period_start <= p_to and r.period_end >= p_from) then
    raise exception 'build_payout_run: a run for this partner already covers part of this period' using errcode = '23505';
  end if;
  if exists (select 1 from public.vendor_invoice i where i.tenant_id = p_tenant_id and i.partner_id = p_partner_id and i.status in ('approved', 'paid')
                and public.vendor_invoice_span(i.id) && daterange(p_from, p_to, '[]')) then
    raise exception 'build_payout_run: an approved invoice from this partner already books part of this period — void the invoice or choose another period' using errcode = '23505';
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
    -- Revenue share: commission on the partner's policies, per entry, by its transaction date. The
    -- policy is the carrier's AND the number (LA-4.8's rule: the sale's carrier names that carrier,
    -- by name or code) — two carriers can issue the same number. Held money is not commission paid.
    select 'revenue_share', e.id, coalesce(e.transaction_date, e.statement_date), e.amount_cents
      from public.commission_entry e
      join public.carriers ca on ca.id = e.carrier_id
      join public.tenant_issued_policies i on i.tenant_id = e.tenant_id and i.policy_number = e.policy_number
       and lower(btrim(coalesce(i.carrier, ''))) in (lower(btrim(ca.name)), lower(btrim(ca.code)))
      join public.deal_flow d on d.id = i.deal_id
     where e.tenant_id = p_tenant_id and d.partner_id = p_partner_id and e.entry_type in ('advance', 'earned', 'chargeback', 'reversal')
       and coalesce(e.corrects_type, '') <> 'held'
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

  -- Disputes resolved ACCEPTED on this partner's earlier PUBLISHED runs, carried here once. A voided
  -- run's disputes are void, so nothing of a voided run is ever carried.
  insert into public.payout_run_item (tenant_id, run_id, item_type, source_id, occurred_on, amount_cents, note)
  select p_tenant_id, v_run, 'adjustment', d.id, (d.resolved_at at time zone 'UTC')::date, d.claim_cents, left('Dispute accepted: ' || d.reason, 500)
    from public.payout_dispute d join public.payout_run r on r.id = d.run_id
   where d.tenant_id = p_tenant_id and r.partner_id = p_partner_id and r.status in ('published', 'paid')
     and d.status = 'accepted' and d.carried_to_run_id is null and d.claim_cents > 0;
  update public.payout_dispute d set carried_to_run_id = v_run
    from public.payout_run r
   where r.id = d.run_id and d.tenant_id = p_tenant_id and r.partner_id = p_partner_id and r.status in ('published', 'paid')
     and d.status = 'accepted' and d.carried_to_run_id is null and d.claim_cents > 0;

  perform public.payout_run_totals(v_run);
  perform set_config('app.payout_writer', '', true);
  return v_run;
end;
$$;

-- A dispute may also become void — only from open, or accepted and not yet carried — when its run is voided.
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
  if tg_op = 'UPDATE' and old.status <> 'open' and (new.status, new.resolution_note, new.resolved_by, new.resolved_at) is distinct from (old.status, old.resolution_note, old.resolved_by, old.resolved_at)
     and not (old.status = 'accepted' and old.carried_to_run_id is null and new.status = 'void') then
    raise exception 'A resolved dispute stays resolved.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Either side raises a dispute. On a draft the agent's withholds the item; on a published run the
-- partner's is recorded against it (published figures do not change) and settles on a later run.
-- A partner's claim is at most what it disputes — the item, or the run's gross — and at least the
-- agency's dispute tolerance (LA-7.9): a difference below it is ignored.
create or replace function public.raise_payout_dispute(p_tenant_id uuid, p_run_id uuid, p_item_id uuid, p_side text, p_by uuid, p_reason text, p_claim_cents bigint)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r public.payout_run;
  v_amount bigint;
  v_claim bigint;
  v_tol bigint;
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
  if p_side = 'agent' then
    v_claim := greatest(coalesce(v_amount, 0), 0);
  else
    v_claim := greatest(coalesce(p_claim_cents, 0), 0);
    if v_claim > greatest(coalesce(v_amount, r.gross_cents), 0) then
      raise exception 'raise_payout_dispute: the claim is more than what it disputes (% cents)', greatest(coalesce(v_amount, r.gross_cents), 0) using errcode = '22023';
    end if;
    select coalesce((select s.payout_dispute_tolerance_cents from public.accounting_settings s where s.tenant_id = p_tenant_id), 0) into v_tol;
    if v_claim < v_tol then
      raise exception 'raise_payout_dispute: a difference under % cents is below the agency''s dispute tolerance', v_tol using errcode = '22023';
    end if;
  end if;
  perform set_config('app.payout_writer', 'on', true);
  insert into public.payout_dispute (tenant_id, run_id, item_id, raised_by_side, raised_by, reason, claim_cents)
  values (p_tenant_id, r.id, p_item_id, p_side, p_by, btrim(p_reason), v_claim)
  returning id into v_id;
  perform public.payout_run_totals(r.id);
  perform set_config('app.payout_writer', '', true);
  return v_id;
end;
$$;

-- Resolved only once its run is published (a draft's figures can still change; a void run's
-- disputes are void).
create or replace function public.resolve_payout_dispute(p_tenant_id uuid, p_dispute_id uuid, p_status text, p_note text, p_by uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  d public.payout_dispute;
  v_run_status text;
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
  select r.status into v_run_status from public.payout_run r where r.id = d.run_id for update;
  if v_run_status = 'void' then
    raise exception 'resolve_payout_dispute: its run is void, and so is the dispute' using errcode = '22023';
  end if;
  if v_run_status not in ('published', 'paid') then
    raise exception 'resolve_payout_dispute: publish the run first — a dispute is resolved on a published run' using errcode = '22023';
  end if;
  perform set_config('app.payout_writer', 'on', true);
  update public.payout_dispute set status = p_status, resolution_note = left(btrim(p_note), 1000), resolved_by = p_by, resolved_at = now() where id = d.id;
  perform public.payout_run_totals(d.run_id);
  perform set_config('app.payout_writer', '', true);
end;
$$;

-- Void: reversing entries; the run's open disputes, and accepted ones not yet carried, become void
-- (a rebuilt run lists the items again — carrying them too would pay them twice).
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
  update public.payout_dispute
     set status = 'void', resolution_note = left('Run voided: ' || btrim(p_reason), 1000), resolved_by = p_by, resolved_at = now()
   where run_id = r.id and (status = 'open' or (status = 'accepted' and carried_to_run_id is null));
  update public.payout_run set status = 'void', voided_by = p_by, voided_at = now(), void_reason = left(btrim(p_reason), 500) where id = r.id;
  perform set_config('app.payout_writer', '', true);
  return v_n;
end;
$$;

-- ─── producer splits ───────────────────────────────────────────────────────────────────────────
-- The producer is the commission line's writing agent, else the policy book's (LA-4.7) — the
-- carrier_agent_map often has no row for a writing number, and the share is still owed.
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
    select e.id, e.tenant_id, e.agency_id, coalesce(e.agent_user_id, pc.agent_user_id) as producer, e.carrier_id, e.policy_number, e.amount_cents,
           coalesce(case when e.entry_type = 'reversal' then e.corrects_type end, e.entry_type) as kind,
           coalesce(e.transaction_date, e.statement_date) as on_date,
           pc.product_code, pc.issue_date, pc.months_paid
      from public.commission_entry e
      left join public.policy_current pc on pc.tenant_id = e.tenant_id and pc.carrier_id = e.carrier_id and pc.policy_number = e.policy_number
     where (p_tenant_id is null or e.tenant_id = p_tenant_id)
       and coalesce(e.agent_user_id, pc.agent_user_id) is not null and coalesce(e.payee_level, 'writing_agent') = 'writing_agent'
       and exists (select 1 from public.tenant_users u where u.tenant_id = e.tenant_id and u.user_id = coalesce(e.agent_user_id, pc.agent_user_id))
       and not exists (select 1 from public.producer_ledger_entry p where p.commission_entry_id = e.id and p.producer_user_id = coalesce(e.agent_user_id, pc.agent_user_id))
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

-- A run's earned and clawed-back figures are the period's SPLIT entries only. Everything else up to
-- the period's end — what was paid, a voided run's restoration of it, a write-off — is balance: it
-- moves what is owed, never what was earned. So a void + rebuild pays once, and a write-off is not
-- income to recover from.
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

  select coalesce(sum(amount_cents), 0) into v_before from public.producer_ledger_entry
   where tenant_id = p_tenant_id and producer_user_id = p_producer
     and (occurred_on < p_from or (occurred_on <= p_to and entry_type not in ('split_advance', 'split_earned', 'split_chargeback')));
  select coalesce(sum(amount_cents) filter (where amount_cents > 0), 0), coalesce(sum(amount_cents) filter (where amount_cents < 0), 0)
    into v_earned, v_clawed from public.producer_ledger_entry
   where tenant_id = p_tenant_id and producer_user_id = p_producer and occurred_on between p_from and p_to
     and entry_type in ('split_advance', 'split_earned', 'split_chargeback');
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

-- The restoration of a voided run's payment names the run it restores (payout_run_id), dated like
-- its split_paid, so the two always cancel inside any period.
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
    insert into public.producer_ledger_entry (tenant_id, agency_id, producer_user_id, entry_type, amount_cents, occurred_on, payout_run_id, reason, created_by)
    values (p_tenant_id, r.agency_id, r.producer_user_id, 'adjustment', r.net_cents, r.period_end, r.id, left('Run voided: ' || btrim(p_reason), 500), p_by);
  end if;
  perform set_config('app.producer_writer', 'on', true);
  update public.producer_payout_run set status = 'void', voided_by = p_by, voided_at = now(), void_reason = left(btrim(p_reason), 500) where id = r.id;
  perform set_config('app.producer_writer', '', true);
  return v_n;
end;
$$;

-- ─── tax ───────────────────────────────────────────────────────────────────────────────────────
-- The year by bucket. Held commission (and a reversal of it) is not income received; a reversal is
-- bucketed as the type it corrects (a reversed advance reduces gross receipts, a reversed chargeback
-- reduces returns); one that names nothing goes by its sign — money back is gross receipts, money
-- out follows the agency's mapping for 'reversal'.
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
      select 'commission_entry_type'::text as st,
             case when e.entry_type = 'reversal' and e.corrects_type is not null then e.corrects_type else e.entry_type end as sv,
             case when e.entry_type = 'reversal' and e.corrects_type is null and e.amount_cents > 0 then 'gross_receipts' end as forced,
             e.amount_cents
        from public.commission_entry e where e.tenant_id = $1 and %1$s >= $2 and %1$s < $3 and coalesce(e.corrects_type, e.entry_type) <> 'held'
      union all
      select 'commission_entry_type',
             case when e.entry_type = 'reversal' and e.corrects_type is not null then e.corrects_type else e.entry_type end,
             case when e.entry_type = 'reversal' and e.corrects_type is null and e.amount_cents > 0 then 'gross_receipts' end,
             e.amount_cents
        from public.commission_account_entry e where e.tenant_id = $1 and %1$s >= $2 and %1$s < $3 and coalesce(e.corrects_type, e.entry_type) <> 'held'
      union all
      select case when x.id is not null then 'expense_category' else 'cost_entry_type' end, coalesce(x.category, c.entry_type), null::text, c.amount_cents
        from public.cost_entry c left join public.expense x on x.id = c.expense_id
       where c.tenant_id = $1 and %2$s >= $2 and %2$s < $3
    )
    select coalesce(r.forced, t.tax_category, d.tax_category, 'other'), r.st, r.sv, sum(r.amount_cents)::bigint, count(*)::bigint
      from rows r
      left join public.tax_category_map t on t.tenant_id = $1 and t.source_type = r.st and t.source_value = r.sv
      left join public.tax_category_map d on d.tenant_id is null and d.source_type = r.st and d.source_value = r.sv
     group by 1, 2, 3
  $q$, v_comm, v_cost) using p_tenant_id, p_from, p_to;
end;
$$;

-- An agency's override of one mapping, in one transaction with its audit row (LA-7.9: every change,
-- who, what, from, to). Choosing the default again removes the override. Returns what changed.
create or replace function public.set_tax_category_override(p_tenant_id uuid, p_source_type text, p_source_value text, p_category text, p_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_default text;
  v_old text;
begin
  if p_tenant_id is null or p_by is null then
    raise exception 'set_tax_category_override: an agency and a named person are required' using errcode = '22023';
  end if;
  select m.tax_category into v_default from public.tax_category_map m where m.tenant_id is null and m.source_type = p_source_type and m.source_value = p_source_value;
  if not found then
    raise exception 'set_tax_category_override: unknown source' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('la7.tax_map:' || p_tenant_id::text || ':' || p_source_type || ':' || p_source_value, 0));
  select m.tax_category into v_old from public.tax_category_map m where m.tenant_id = p_tenant_id and m.source_type = p_source_type and m.source_value = p_source_value;
  v_old := coalesce(v_old, v_default);
  if p_category = v_default then
    delete from public.tax_category_map m where m.tenant_id = p_tenant_id and m.source_type = p_source_type and m.source_value = p_source_value;
  else
    update public.tax_category_map m set tax_category = p_category, updated_by = p_by, updated_at = now()
     where m.tenant_id = p_tenant_id and m.source_type = p_source_type and m.source_value = p_source_value;
    if not found then
      insert into public.tax_category_map (tenant_id, source_type, source_value, tax_category, is_default, updated_by)
      values (p_tenant_id, p_source_type, p_source_value, p_category, false, p_by);
    end if;
  end if;
  if v_old is distinct from p_category then
    insert into public.accounting_setting_change (tenant_id, field, old_value, new_value, changed_by)
    values (p_tenant_id, left('tax_category:' || p_source_type || ':' || p_source_value, 80), to_jsonb(v_old), to_jsonb(p_category), p_by);
  end if;
  return jsonb_build_object('from', v_old, 'to', p_category, 'changed', v_old is distinct from p_category);
end;
$$;

-- ─── access (new functions; restated ones keep their grants) ───────────────────────────────────
revoke all on function public.vendor_invoice_span(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.vendor_invoice_span(uuid) to service_role;
revoke all on function public.set_tax_category_override(uuid, text, text, text, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.set_tax_category_override(uuid, text, text, text, uuid) to service_role;

-- ─── self-check ────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_src text;
begin
  v_src := replace(pg_get_functiondef('public.reverse_cost_entry(uuid, uuid, text, uuid, date)'::regprocedure), E'\r\n', E'\n');
  if v_src like '%case when o.paid_on is null then null else coalesce(p_on, current_date) end%' then
    raise exception 'LA-7 audit fixes: reverse_cost_entry still books cash on the reversal day';
  end if;
  v_src := replace(pg_get_functiondef('public.build_payout_run(uuid, uuid, date, date, uuid)'::regprocedure), E'\r\n', E'\n');
  if v_src not like '%a run for this partner already covers part of this period%' or v_src not like '%lower(btrim(ca.name))%' then
    raise exception 'LA-7 audit fixes: build_payout_run is not the fixed version';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payout_dispute_status' and conrelid = 'public.payout_dispute'::regclass and pg_get_constraintdef(oid) like '%void%') then
    raise exception 'LA-7 audit fixes: payout_dispute cannot be void';
  end if;
  if (select count(*) from public.pnl_lines('00000000-0000-0000-0000-000000000000'::uuid, date '2026-01-01', date '2026-02-01', 'accrual')) <> 0 then
    raise exception 'LA-7 audit fixes: an empty agency has P&L lines';
  end if;
end;
$$;
