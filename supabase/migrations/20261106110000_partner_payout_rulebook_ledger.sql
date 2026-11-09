-- Partner payouts rework (owner, 2026-11-06; extends LA-7.4 and LA-1.1) · rulebook, ledger, invoice machine.
--
-- Until now a payout run was one fixed period per partner: the cadence was the agency's, "paid" was a
-- run's, nothing kept an item from being priced into two runs except that run periods could not
-- overlap, the per-unit models never gave back a chargeback, and a negative run was booked as money
-- owed but never taken off the next one. The owner's four phases:
--
--   partner_payout_profile   the RULEBOOK's non-price half: the pay timer (weekly, every 15 days,
--                            monthly), who carries chargebacks (the partner, taken back on the next
--                            invoice, or the agency), and who gets the money (name, email, method; no
--                            account numbers, ever). The price stays in partner_terms (effective-dated,
--                            insert-only): Model A = per_submitted_application (20261106100000),
--                            Model B = revenue_share. The older models keep pricing what they priced.
--   partner_ledger_entry     the LEDGER: one row per payable thing a partner earned, keyed by
--                            (partner, source type, source) — the never-pay-twice rule is that key.
--                            Locked to an invoice when the invoice is created (run_id), stamped PAID
--                            when the invoice is marked paid (paid_at). Never deleted.
--   sync_partner_ledger      fills it, idempotently: Model A applications submitted from the partner's
--                            transfers; Model B commission entries on the partner's issued policies
--                            (chargebacks skipped when the agency absorbs them); a Model A clawback
--                            once per charged-back policy (when the partner shares them); the older
--                            models; accepted credits. Anything an earlier run already priced, or a
--                            day an approved vendor invoice from the partner booked, is left out.
--   build_payout_run         the INVOICE MACHINE for one partner: sync, then one invoice holding EVERY
--                            unlocked entry up to the period's end (an item from an earlier cycle that
--                            was missed is picked up, not lost), a negative earlier invoice carried in,
--                            numbered INV-YYYYMM-NNNN per agency.
--   run_partner_invoices     every partner whose timer is up, previewed (dry run) or built.
--   publish / paid / void    publish books the cost (a negative invoice is carried, not booked); paid
--                            stamps the ledger; void releases an unpaid invoice's entries.
--   partner_client_tracker   every client a partner sent: transferred, application submitted, issued,
--                            charged back, and what is payable, invoiced and paid on it.
--
-- Rules kept: integer cents; LA-7 never writes commission_entry; no money is moved; the partner reads
-- only its own published invoices. Changed by the owner (2026-11-06): a Model B invoice shows the
-- commission each share was taken from.
--
-- Additive. Rollback: restate build_payout_run / payout_run_totals / publish_payout_run /
--   mark_payout_run_paid / void_payout_run / payout_drafts_due from 20261015620000 and 20261015300000; then
--   drop view public.partner_client_tracker; drop function public.run_partner_invoices(uuid, date, uuid, uuid[], boolean),
--   public.sync_partner_ledger(uuid, uuid), public.set_payout_invoice_pdf(uuid, uuid, text),
--   public.partner_payout_cadence(uuid, uuid), public.partner_payout_cycle(text, date), public.partner_ledger_entry_guard();
--   alter table public.payout_run_item drop column ledger_entry_id; (restore the item type and sign checks);
--   drop table public.partner_ledger_entry, public.partner_payout_profile;
--   alter table public.payout_run drop column invoice_seq, drop column invoice_number, drop column invoice_pdf_path, drop column cadence.

-- ─── the rulebook ──────────────────────────────────────────────────────────────────────────────
create table if not exists public.partner_payout_profile (
  partner_id uuid primary key references public.partners(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  cadence text not null default 'monthly',
  chargeback_policy text not null default 'partner_shares',
  payee_name text,
  payee_email text,
  payment_method text,
  payment_note text,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint partner_payout_profile_cadence check (cadence in ('weekly', 'semi_monthly', 'monthly')),
  constraint partner_payout_profile_chargebacks check (chargeback_policy in ('partner_shares', 'agency_absorbs')),
  constraint partner_payout_profile_method check (payment_method is null or payment_method in ('bank_transfer', 'paypal', 'zelle', 'check', 'wire', 'other')),
  constraint partner_payout_profile_payee check (
    (payee_name is null or char_length(btrim(payee_name)) between 1 and 200)
    and (payee_email is null or payee_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    and (payment_note is null or char_length(payment_note) <= 500))
);
create index if not exists partner_payout_profile_tenant_idx on public.partner_payout_profile (tenant_id);

-- ─── the ledger ────────────────────────────────────────────────────────────────────────────────
create table if not exists public.partner_ledger_entry (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  partner_id uuid not null references public.partners(id) on delete restrict,
  source_type text not null,
  source_id uuid not null,
  deal_id uuid,
  lead_id uuid,
  policy_number text,
  carrier text,
  earned_on date not null,
  terms_id uuid,
  rate_cents bigint,
  rate_pct_bp integer,
  basis_cents bigint,
  amount_cents bigint not null,
  note text,
  run_id uuid references public.payout_run(id) on delete restrict,
  locked_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  constraint partner_ledger_entry_type check (source_type in ('submitted_application', 'commission', 'chargeback_clawback', 'credit', 'carried_balance', 'transfer', 'lead', 'sale', 'issued_policy')),
  constraint partner_ledger_entry_sign check (
    (source_type in ('submitted_application', 'transfer', 'lead', 'sale', 'issued_policy') and amount_cents >= 0)
    or (source_type in ('chargeback_clawback', 'credit') and amount_cents <= 0)
    or (source_type in ('commission', 'carried_balance'))),
  constraint partner_ledger_entry_lock check ((run_id is null) = (locked_at is null) and (paid_at is null or run_id is not null)),
  -- The never-pay-twice rule: one entry per thing the partner earned.
  constraint partner_ledger_entry_once unique (tenant_id, partner_id, source_type, source_id)
);
create index if not exists partner_ledger_entry_open_idx on public.partner_ledger_entry (tenant_id, partner_id, earned_on) where run_id is null;
create index if not exists partner_ledger_entry_run_idx on public.partner_ledger_entry (run_id) where run_id is not null;
create index if not exists partner_ledger_entry_deal_idx on public.partner_ledger_entry (tenant_id, deal_id) where deal_id is not null;

-- An entry is written by the sync and moves only through the invoice actions: locked to an invoice,
-- released when an unpaid invoice is voided, stamped paid. What it says it earned never changes.
create or replace function public.partner_ledger_entry_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'A ledger entry is never removed: void its invoice instead.' using errcode = 'P0001';
  end if;
  if coalesce(current_setting('app.payout_writer', true), '') <> 'on' then
    raise exception 'The partner ledger is written by the payout actions, never by hand.' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    if (new.tenant_id, new.partner_id, new.source_type, new.source_id, new.deal_id, new.lead_id, new.policy_number, new.carrier, new.earned_on, new.terms_id, new.rate_cents, new.rate_pct_bp, new.basis_cents, new.amount_cents, new.note)
       is distinct from (old.tenant_id, old.partner_id, old.source_type, old.source_id, old.deal_id, old.lead_id, old.policy_number, old.carrier, old.earned_on, old.terms_id, old.rate_cents, old.rate_pct_bp, old.basis_cents, old.amount_cents, old.note) then
      raise exception 'What a ledger entry earned never changes.' using errcode = 'P0001';
    end if;
    if old.paid_at is not null and (new.paid_at is distinct from old.paid_at or new.run_id is distinct from old.run_id) then
      raise exception 'A paid ledger entry stays paid.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists partner_ledger_entry_guard on public.partner_ledger_entry;
create trigger partner_ledger_entry_guard before update or delete on public.partner_ledger_entry for each row execute function public.partner_ledger_entry_guard();

-- ─── the invoice: a payout run, numbered, with its PDF ─────────────────────────────────────────
alter table public.payout_run
  add column if not exists invoice_seq integer,
  add column if not exists invoice_number text,
  add column if not exists invoice_pdf_path text,
  add column if not exists cadence text;
create unique index if not exists payout_run_invoice_seq on public.payout_run (tenant_id, invoice_seq) where invoice_seq is not null;

alter table public.payout_run_item add column if not exists ledger_entry_id uuid references public.partner_ledger_entry(id) on delete restrict;
create index if not exists payout_run_item_source_idx on public.payout_run_item (source_id) where source_id is not null;
alter table public.payout_run_item drop constraint if exists payout_run_item_type;
alter table public.payout_run_item add constraint payout_run_item_type check (item_type in (
  'transfer', 'lead', 'sale', 'issued_policy', 'submitted_application', 'revenue_share', 'clawback', 'carried_balance', 'rejected', 'credit', 'dispute', 'adjustment'));
alter table public.payout_run_item drop constraint if exists payout_run_item_sign;
alter table public.payout_run_item add constraint payout_run_item_sign check (
  (item_type in ('transfer', 'lead', 'sale', 'issued_policy', 'submitted_application') and amount_cents >= 0)
  or (item_type in ('revenue_share', 'carried_balance', 'dispute', 'adjustment'))
  or (item_type = 'rejected' and amount_cents = 0)
  or (item_type in ('credit', 'clawback') and amount_cents <= 0));

-- ─── the timer ─────────────────────────────────────────────────────────────────────────────────
-- The cycle a day falls in: weekly is Monday to Sunday; every 15 days is the 1st–15th and the 16th to
-- the month's end; monthly is the calendar month.
create or replace function public.partner_payout_cycle(p_cadence text, p_on date)
returns table (cycle_start date, cycle_end date)
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case p_cadence
           when 'weekly' then date_trunc('week', p_on::timestamp)::date
           when 'semi_monthly' then case when extract(day from p_on) <= 15 then date_trunc('month', p_on::timestamp)::date else date_trunc('month', p_on::timestamp)::date + 15 end
           else date_trunc('month', p_on::timestamp)::date end,
         case p_cadence
           when 'weekly' then date_trunc('week', p_on::timestamp)::date + 6
           when 'semi_monthly' then case when extract(day from p_on) <= 15 then date_trunc('month', p_on::timestamp)::date + 14 else (date_trunc('month', p_on::timestamp) + interval '1 month - 1 day')::date end
           else (date_trunc('month', p_on::timestamp) + interval '1 month - 1 day')::date end
$$;

-- The partner's own timer, else the agency's, else monthly.
create or replace function public.partner_payout_cadence(p_tenant_id uuid, p_partner_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    (select pp.cadence from public.partner_payout_profile pp where pp.partner_id = p_partner_id and pp.tenant_id = p_tenant_id),
    (select s.payout_cadence from public.accounting_settings s where s.tenant_id = p_tenant_id),
    'monthly')
$$;

-- ─── filling the ledger ────────────────────────────────────────────────────────────────────────
create or replace function public.sync_partner_ledger(p_tenant_id uuid, p_partner_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_policy text;
  v_first date;
  v_n integer := 0;
  v_k integer;
begin
  if not exists (select 1 from public.partners p where p.id = p_partner_id and p.tenant_id = p_tenant_id) then
    raise exception 'sync_partner_ledger: partner % is not in this agency', p_partner_id using errcode = 'P0002';
  end if;
  select min(t.effective_from) into v_first from public.partner_terms t where t.partner_id = p_partner_id;
  if v_first is null then
    return 0;
  end if;
  v_policy := coalesce((select pp.chargeback_policy from public.partner_payout_profile pp where pp.partner_id = p_partner_id and pp.tenant_id = p_tenant_id), 'partner_shares');
  perform set_config('app.payout_writer', 'on', true);

  -- Everything the partner earned, each priced by the term in force on its own date.
  with terms as (
    select t.id, t.payout_model::text as model, t.rate_cents, t.rate_pct_bp as rate_bp, t.effective_from as eff
      from public.partner_terms t where t.partner_id = p_partner_id
  ),
  basis as (
    -- Model A: a transfer (it passed the compliance gate, or it would have no lead) whose client's
    -- application was submitted, dated by the first submission.
    select 'submitted_application'::text as source_type, 'submitted_application'::text as legacy_item, d.id as source_id, d.id as deal_id, d.lead_id,
           null::text as policy_number, null::text as carrier, s.on_date, null::bigint as base_cents, 'per_submitted_application'::text as model_needed
      from public.deal_flow d
      join lateral (
        select min((a.submitted_at at time zone 'UTC')::date) as on_date
          from public.tenant_applications a
         where a.tenant_id = d.tenant_id and a.lead_id = d.lead_id and a.submitted_at is not null
      ) s on s.on_date is not null
     where d.tenant_id = p_tenant_id and d.partner_id = p_partner_id
    union all
    -- Model B: each commission entry on the partner's issued policies (the carrier's AND the number,
    -- LA-4.8's rule). Held money is not commission paid. Chargebacks (and their reversals) stay out
    -- when the agency absorbs them.
    select 'commission', 'revenue_share', e.id, d.id, d.lead_id, e.policy_number, ca.name, coalesce(e.transaction_date, e.statement_date), e.amount_cents, 'revenue_share'
      from public.commission_entry e
      join public.carriers ca on ca.id = e.carrier_id
      join public.tenant_issued_policies i on i.tenant_id = e.tenant_id and i.policy_number = e.policy_number
       and lower(btrim(coalesce(i.carrier, ''))) in (lower(btrim(ca.name)), lower(btrim(ca.code)))
      join public.deal_flow d on d.id = i.deal_id
     where e.tenant_id = p_tenant_id and d.partner_id = p_partner_id and e.entry_type in ('advance', 'earned', 'chargeback', 'reversal')
       and coalesce(e.corrects_type, '') <> 'held'
       and (v_policy = 'partner_shares' or not (e.entry_type = 'chargeback' or (e.entry_type = 'reversal' and coalesce(e.corrects_type, '') = 'chargeback')))
    union all
    -- The older models, priced as they always were.
    select 'transfer', 'transfer', d.id, d.id, d.lead_id, null, null, d.local_date, null, 'per_transfer'
      from public.deal_flow d where d.tenant_id = p_tenant_id and d.partner_id = p_partner_id and d.local_date is not null
    union all
    select 'lead', 'lead', l.id, null, l.id, null, null, (l.created_at at time zone 'UTC')::date, null, 'per_lead'
      from public.agent_leads l where l.tenant_id = p_tenant_id and l.partner_id = p_partner_id
    union all
    select 'sale', 'sale', d.id, d.id, d.lead_id, null, null, (d.disposition_at at time zone 'UTC')::date, null, 'per_sale'
      from public.deal_flow d where d.tenant_id = p_tenant_id and d.partner_id = p_partner_id and d.status = 'completed' and d.disposition_at is not null
    union all
    select 'issued_policy', 'issued_policy', i.id, d.id, d.lead_id, i.policy_number, i.carrier, (i.issued_at at time zone 'UTC')::date, null, 'per_issued_policy'
      from public.tenant_issued_policies i join public.deal_flow d on d.id = i.deal_id
     where i.tenant_id = p_tenant_id and d.partner_id = p_partner_id and i.status = 'issued' and i.issued_at is not null
  ),
  priced as (
    select b.*, t.id as terms_id, t.rate_cents, t.rate_bp
      from basis b
      join lateral (select * from terms t where t.eff <= b.on_date order by t.eff desc limit 1) t on t.model = b.model_needed
  ),
  ins as (
    insert into public.partner_ledger_entry (tenant_id, partner_id, source_type, source_id, deal_id, lead_id, policy_number, carrier, earned_on, terms_id, rate_cents, rate_pct_bp, basis_cents, amount_cents)
    select p_tenant_id, p_partner_id, p.source_type, p.source_id, p.deal_id, p.lead_id, p.policy_number, p.carrier, p.on_date, p.terms_id,
           case when p.source_type = 'commission' then null else p.rate_cents end,
           case when p.source_type = 'commission' then p.rate_bp end,
           p.base_cents,
           case when p.source_type = 'commission' then public.bp_share(p.base_cents, p.rate_bp) else p.rate_cents end
      from priced p
     -- Priced by a run before the ledger existed: already paid or on an invoice.
     where not exists (select 1 from public.payout_run_item ri join public.payout_run r on r.id = ri.run_id
                        where r.tenant_id = p_tenant_id and r.partner_id = p_partner_id and r.status <> 'void'
                          and ri.item_type = p.legacy_item and ri.source_id = p.source_id)
       -- A day an approved invoice from this partner already booked is not booked again.
       and not exists (select 1 from public.vendor_invoice vi
                        where vi.tenant_id = p_tenant_id and vi.partner_id = p_partner_id and vi.status in ('approved', 'paid')
                          and public.vendor_invoice_span(vi.id) @> p.on_date)
    on conflict (tenant_id, partner_id, source_type, source_id) do nothing
    returning 1
  )
  select count(*) into v_k from ins;
  v_n := v_n + v_k;

  -- Model A clawback: the fee for a client whose policy charged back is taken back once, on the
  -- partner's next invoice — only when the partner shares chargebacks.
  if v_policy = 'partner_shares' then
    with cb as (
      insert into public.partner_ledger_entry (tenant_id, partner_id, source_type, source_id, deal_id, lead_id, policy_number, carrier, earned_on, terms_id, rate_cents, amount_cents, note)
      select l.tenant_id, l.partner_id, 'chargeback_clawback', l.source_id, l.deal_id, l.lead_id, i.policy_number, i.carrier, greatest(c.on_date, l.earned_on), l.terms_id, l.rate_cents, -l.amount_cents,
             left('Chargeback on policy ' || i.policy_number, 500)
        from public.partner_ledger_entry l
        join public.tenant_issued_policies i on i.tenant_id = l.tenant_id and i.deal_id = l.deal_id
        join lateral (
          select min(coalesce(e.transaction_date, e.statement_date)) as on_date
            from public.commission_entry e join public.carriers ca on ca.id = e.carrier_id
           where e.tenant_id = l.tenant_id and e.policy_number = i.policy_number and e.entry_type = 'chargeback' and e.amount_cents < 0
             and lower(btrim(coalesce(i.carrier, ''))) in (lower(btrim(ca.name)), lower(btrim(ca.code)))
        ) c on c.on_date is not null
       where l.tenant_id = p_tenant_id and l.partner_id = p_partner_id and l.source_type = 'submitted_application' and l.amount_cents > 0
      on conflict (tenant_id, partner_id, source_type, source_id) do nothing
      returning 1
    )
    select count(*) into v_k from cb;
    v_n := v_n + v_k;
  end if;

  -- Credits accepted on LA-2.19 claims, this partner's share of each claim's leads, once each.
  with cr as (
    insert into public.partner_ledger_entry (tenant_id, partner_id, source_type, source_id, earned_on, amount_cents, note)
    select p_tenant_id, p_partner_id, 'credit', c.id, (c.resolved_at at time zone 'UTC')::date,
           -((c.amount_credited_cents::bigint * x.mine) / nullif(x.total, 0)), x.mine || ' of ' || x.total || ' claimed leads'
      from public.lead_claims c
      join lateral (
        select count(*) filter (where l.partner_id = p_partner_id) as mine, count(*) as total
          from public.lead_claim_items ci left join public.agent_leads l on l.id = ci.lead_id
         where ci.claim_id = c.id
      ) x on x.mine > 0
     where c.tenant_id = p_tenant_id and c.status in ('accepted', 'partial') and coalesce(c.amount_credited_cents, 0) > 0
       and c.resolved_at is not null and (c.resolved_at at time zone 'UTC')::date >= v_first
       and not exists (select 1 from public.payout_run_item ri join public.payout_run r on r.id = ri.run_id
                        where r.tenant_id = p_tenant_id and r.partner_id = p_partner_id and r.status <> 'void'
                          and ri.item_type = 'credit' and ri.source_id = c.id)
    on conflict (tenant_id, partner_id, source_type, source_id) do nothing
    returning 1
  )
  select count(*) into v_k from cr;
  v_n := v_n + v_k;

  perform set_config('app.payout_writer', '', true);
  return v_n;
end;
$$;

-- ─── totals, with the new lines ────────────────────────────────────────────────────────────────
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
  select coalesce(sum(amount_cents) filter (where item_type in ('transfer', 'lead', 'sale', 'issued_policy', 'submitted_application', 'revenue_share', 'adjustment', 'carried_balance') and amount_cents > 0), 0),
         coalesce(sum(amount_cents) filter (where item_type in ('credit', 'clawback') or (item_type in ('revenue_share', 'adjustment', 'carried_balance') and amount_cents < 0)), 0)
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

-- ─── the invoice machine, one partner ──────────────────────────────────────────────────────────
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
  v_seq integer;
begin
  if p_to < p_from then
    raise exception 'build_payout_run: the period ends before it starts' using errcode = '22023';
  end if;
  if not exists (select 1 from public.partners p where p.id = p_partner_id and p.tenant_id = p_tenant_id) then
    raise exception 'build_payout_run: partner % is not in this agency', p_partner_id using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('la7.partner_period:' || p_partner_id::text, 0));
  if exists (select 1 from public.payout_run r where r.tenant_id = p_tenant_id and r.partner_id = p_partner_id and r.status <> 'void'
                and r.period_start = p_from and r.period_end = p_to) then
    raise exception 'build_payout_run: an invoice for this partner already covers this period' using errcode = '23505';
  end if;
  if exists (select 1 from public.vendor_invoice i where i.tenant_id = p_tenant_id and i.partner_id = p_partner_id and i.status in ('approved', 'paid')
                and public.vendor_invoice_span(i.id) && daterange(p_from, p_to, '[]')) then
    raise exception 'build_payout_run: an approved invoice from this partner already books part of this period — void the invoice or choose another period' using errcode = '23505';
  end if;

  perform public.sync_partner_ledger(p_tenant_id, p_partner_id);

  -- The terms the invoice prices with: every term an attached entry used, and the one in force at the end.
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'payout_model', t.payout_model::text, 'rate_cents', t.rate_cents, 'rate_pct_bp', t.rate_pct_bp, 'effective_from', t.effective_from) order by t.effective_from), '[]'::jsonb)
    into v_terms
    from public.partner_terms t
   where t.partner_id = p_partner_id
     and (t.id in (select l.terms_id from public.partner_ledger_entry l where l.tenant_id = p_tenant_id and l.partner_id = p_partner_id and l.run_id is null and l.earned_on <= p_to and l.terms_id is not null)
          or t.effective_from = (select max(t2.effective_from) from public.partner_terms t2 where t2.partner_id = p_partner_id and t2.effective_from <= p_to));
  if jsonb_array_length(v_terms) = 0 then
    raise exception 'build_payout_run: this partner has no terms in force for the period — record them on the partner first' using errcode = '22023';
  end if;
  select s.payout_statement_footer into v_footer from public.accounting_settings s where s.tenant_id = p_tenant_id;

  -- Invoice numbers run per agency: INV-YYYYMM-NNNN.
  perform pg_advisory_xact_lock(hashtextextended('la7.invoice_seq:' || p_tenant_id::text, 0));
  select coalesce(max(r.invoice_seq), 0) + 1 into v_seq from public.payout_run r where r.tenant_id = p_tenant_id;

  perform set_config('app.payout_writer', 'on', true);
  insert into public.payout_run (tenant_id, partner_id, period_start, period_end, terms_snapshot_json, statement_footer, created_by, invoice_seq, invoice_number, cadence)
  values (p_tenant_id, p_partner_id, p_from, p_to, v_terms, v_footer, p_by, v_seq, 'INV-' || to_char(p_to, 'YYYYMM') || '-' || lpad(v_seq::text, 4, '0'),
          public.partner_payout_cadence(p_tenant_id, p_partner_id))
  returning id into v_run;

  -- An earlier invoice that ended negative (more came back than was earned) is carried in, once.
  insert into public.partner_ledger_entry (tenant_id, partner_id, source_type, source_id, earned_on, amount_cents, note)
  select p_tenant_id, p_partner_id, 'carried_balance', r.id, r.period_end, r.net_cents, left('Balance from ' || coalesce(r.invoice_number, 'an earlier invoice'), 500)
    from public.payout_run r
   where r.tenant_id = p_tenant_id and r.partner_id = p_partner_id and r.status = 'published' and r.net_cents < 0 and r.id <> v_run
  on conflict (tenant_id, partner_id, source_type, source_id) do nothing;

  -- Every unpaid entry up to the period's end, earlier cycles included, locked to this invoice. A
  -- carried balance from an invoice since voided is not carried.
  update public.partner_ledger_entry l set run_id = v_run, locked_at = now()
   where l.tenant_id = p_tenant_id and l.partner_id = p_partner_id and l.run_id is null and l.earned_on <= p_to
     and not (l.source_type = 'carried_balance' and exists (select 1 from public.payout_run x where x.id = l.source_id and x.status = 'void'));

  insert into public.payout_run_item (tenant_id, run_id, item_type, source_id, occurred_on, terms_id, rate_applied_cents, rate_pct_bp, amount_cents, note, ledger_entry_id)
  select p_tenant_id, v_run,
         case l.source_type when 'commission' then 'revenue_share' when 'chargeback_clawback' then 'clawback' else l.source_type end,
         l.id, l.earned_on, l.terms_id, l.rate_cents, l.rate_pct_bp, l.amount_cents, l.note, l.id
    from public.partner_ledger_entry l where l.run_id = v_run;

  -- Rejected at the compliance gate: never billable; a count on the statement (amount zero).
  if to_regclass('public.transfer_verdict') is not null then
    execute 'insert into public.payout_run_item (tenant_id, run_id, item_type, source_id, occurred_on, amount_cents, note)
             select $1, $2, ''rejected'', v.id, (v.evaluated_at at time zone ''UTC'')::date, 0, v.blocking_reason
               from public.transfer_verdict v
              where v.tenant_id = $1 and v.partner_id = $3 and v.verdict = ''reject''
                and v.evaluated_at >= $4::timestamptz and v.evaluated_at < ($5 + 1)::timestamptz'
      using p_tenant_id, v_run, p_partner_id, p_from, p_to;
  end if;

  -- Disputes resolved ACCEPTED on this partner's earlier published runs, carried here once.
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

-- ─── publish: a negative invoice is carried, not booked ────────────────────────────────────────
create or replace function public.publish_payout_run(p_tenant_id uuid, p_run_id uuid, p_by uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r public.payout_run;
  v_entry uuid;
  v_missing text[];
begin
  select * into r from public.payout_run where id = p_run_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'publish_payout_run: run % is not in this agency', p_run_id using errcode = 'P0002';
  end if;
  if r.status <> 'draft' then
    raise exception 'publish_payout_run: only a draft is published (this one is %)', r.status using errcode = '22023';
  end if;
  v_missing := public.business_identity_missing(p_tenant_id, 'payout_statement');
  if cardinality(v_missing) > 0 then
    raise exception 'publish_payout_run: Add your % before generating a payout statement. Partner statements must show who they are from.',
      array_to_string(array(select case m when 'trading_name' then 'trading name' when 'address' then 'business address' else m end from unnest(v_missing) m), ' and ')
      using errcode = '22023';
  end if;
  perform public.payout_run_totals(r.id);
  select * into r from public.payout_run where id = p_run_id;
  if r.net_cents > 0 then
    v_entry := public.record_cost_entry(p_tenant_id, jsonb_build_object('agency_id', r.agency_id, 'entry_type', 'partner_payout', 'amount_cents', -r.net_cents,
      'incurred_on', r.period_end, 'counterparty_type', 'partner', 'counterparty_id', r.partner_id, 'partner_id', r.partner_id, 'payout_run_id', r.id,
      'description', coalesce(r.invoice_number || ' · ', '') || 'Payout ' || to_char(r.period_start, 'DD Mon') || ' – ' || to_char(r.period_end, 'DD Mon YYYY')), p_by);
  end if;
  -- Below zero, the partner owes the agency: the balance is taken off the partner's next invoice
  -- (build_payout_run carries it) rather than booked here, so it is never counted twice.
  perform set_config('app.payout_writer', 'on', true);
  update public.payout_run set status = 'published', published_by = p_by, published_at = now() where id = r.id;
  perform set_config('app.payout_writer', '', true);
  return v_entry;
end;
$$;

-- ─── paid: the PAID stamp ──────────────────────────────────────────────────────────────────────
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
  -- Every entry on the invoice is stamped PAID: it can never be invoiced again.
  update public.partner_ledger_entry set paid_at = now() where run_id = r.id and paid_at is null;
  perform set_config('app.payout_writer', '', true);
  return v_n;
end;
$$;

-- ─── void: an unpaid invoice's entries go back to waiting ──────────────────────────────────────
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
  if r.status = 'paid' then
    raise exception 'void_payout_run: a paid invoice stays on record; correct it on the next one' using errcode = '22023';
  end if;
  -- Its negative balance already sits on a later invoice: that one goes first.
  if exists (select 1 from public.partner_ledger_entry l join public.payout_run x on x.id = l.run_id
              where l.source_type = 'carried_balance' and l.source_id = r.id and x.status <> 'void') then
    raise exception 'void_payout_run: this balance was carried to a later invoice — void that one first' using errcode = '22023';
  end if;
  for e in select c.id from public.cost_entry c where c.tenant_id = p_tenant_id and c.payout_run_id = r.id and c.reverses_entry_id is null
              and not exists (select 1 from public.cost_entry x where x.reverses_entry_id = c.id) loop
    perform public.reverse_cost_entry(p_tenant_id, e.id, 'Payout run voided: ' || btrim(p_reason), p_by);
    v_n := v_n + 1;
  end loop;
  perform set_config('app.payout_writer', 'on', true);
  update public.payout_dispute set carried_to_run_id = null where carried_to_run_id = r.id;
  update public.payout_dispute
     set status = 'void', resolution_note = left('Run voided: ' || btrim(p_reason), 1000), resolved_by = p_by, resolved_at = now()
   where run_id = r.id and (status = 'open' or (status = 'accepted' and carried_to_run_id is null));
  -- The entries were never paid: back to waiting for the next invoice.
  update public.partner_ledger_entry set run_id = null, locked_at = null where run_id = r.id and paid_at is null;
  update public.payout_run set status = 'void', voided_by = p_by, voided_at = now(), void_reason = left(btrim(p_reason), 500) where id = r.id;
  perform set_config('app.payout_writer', '', true);
  return v_n;
end;
$$;

-- The stored PDF of a published invoice (the app writes the file to Storage, then records where).
create or replace function public.set_payout_invoice_pdf(p_tenant_id uuid, p_run_id uuid, p_path text)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  perform set_config('app.payout_writer', 'on', true);
  update public.payout_run set invoice_pdf_path = nullif(btrim(p_path), '') where id = p_run_id and tenant_id = p_tenant_id and status in ('published', 'paid');
  perform set_config('app.payout_writer', '', true);
end;
$$;

-- ─── every partner whose timer is up ───────────────────────────────────────────────────────────
-- The cycle that ended last as of p_as_of, per partner, with what an invoice would hold. A dry run
-- only fills the ledger (idempotent bookkeeping) and returns the preview; otherwise each partner's
-- invoice is built in its own block, so one partner's problem never stops the others.
create or replace function public.run_partner_invoices(p_tenant_id uuid, p_as_of date, p_by uuid, p_partner_ids uuid[] default null, p_dry_run boolean default false)
returns table (partner_id uuid, partner_name text, cadence text, period_start date, period_end date, items integer, net_cents bigint, run_id uuid, problem text)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
#variable_conflict use_column
declare
  p record;
  v_cad text;
  v_from date;
  v_to date;
  v_items integer;
  v_net bigint;
  v_carry bigint;
begin
  for p in select pa.id, pa.name from public.partners pa
            where pa.tenant_id = p_tenant_id and pa.status in ('active', 'paused')
              and exists (select 1 from public.partner_terms t where t.partner_id = pa.id)
              and (p_partner_ids is null or pa.id = any (p_partner_ids))
            order by pa.name loop
    v_cad := public.partner_payout_cadence(p_tenant_id, p.id);
    select c.cycle_start, c.cycle_end into v_from, v_to
      from public.partner_payout_cycle(v_cad, (select c0.cycle_start from public.partner_payout_cycle(v_cad, p_as_of) c0) - 1) c;
    continue when exists (select 1 from public.payout_run r where r.tenant_id = p_tenant_id and r.partner_id = p.id and r.status <> 'void'
                             and r.period_start = v_from and r.period_end = v_to);
    perform public.sync_partner_ledger(p_tenant_id, p.id);
    select count(*), coalesce(sum(l.amount_cents), 0) into v_items, v_net
      from public.partner_ledger_entry l
     where l.tenant_id = p_tenant_id and l.partner_id = p.id and l.run_id is null and l.earned_on <= v_to and l.source_type <> 'carried_balance';
    select coalesce(sum(r.net_cents), 0) into v_carry from public.payout_run r
     where r.tenant_id = p_tenant_id and r.partner_id = p.id and r.status = 'published' and r.net_cents < 0
       and not exists (select 1 from public.partner_ledger_entry l join public.payout_run x on x.id = l.run_id
                        where l.source_type = 'carried_balance' and l.source_id = r.id and x.status <> 'void');
    continue when v_items = 0 and v_carry = 0;
    partner_id := p.id; partner_name := p.name; cadence := v_cad; period_start := v_from; period_end := v_to;
    items := v_items; net_cents := v_net + v_carry; run_id := null; problem := null;
    if not p_dry_run then
      begin
        run_id := public.build_payout_run(p_tenant_id, p.id, v_from, v_to, p_by);
        select r.net_cents into net_cents from public.payout_run r where r.id = run_id;
      exception when others then
        problem := regexp_replace(sqlerrm, '^\w+: ', '');
      end;
    end if;
    return next;
  end loop;
end;
$$;

-- Overnight: each partner on its own timer, the agency's draft days after its cycle ends. Never
-- publishes unless the agency turned auto-publish on.
create or replace function public.payout_drafts_due()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  s record;
  v_n integer := 0;
  x record;
begin
  for s in select t.id as tenant_id, coalesce(a.payout_draft_days, 3) as draft_days, coalesce(a.payout_auto_publish, false) as auto_publish
             from public.tenants t
             left join public.accounting_settings a on a.tenant_id = t.id
            where exists (select 1 from public.partners pa join public.partner_terms pt on pt.partner_id = pa.id
                           where pa.tenant_id = t.id and pa.status in ('active', 'paused')) loop
    begin
      for x in select * from public.run_partner_invoices(s.tenant_id, current_date - s.draft_days, null, null, false) loop
        continue when x.run_id is null;
        v_n := v_n + 1;
        if s.auto_publish then
          begin
            perform public.publish_payout_run(s.tenant_id, x.run_id, null);
          exception when others then
            -- Left as a draft: publishing needs the agency's trading name and address (LA-8.3).
            null;
          end;
        end if;
      end loop;
    exception when others then
      -- One agency's problem must not stop the others' drafts.
      continue;
    end;
  end loop;
  return v_n;
end;
$$;

-- ─── every client a partner sent ───────────────────────────────────────────────────────────────
create or replace view public.partner_client_tracker with (security_invoker = true) as
select d.tenant_id,
       d.partner_id,
       d.id as deal_id,
       d.lead_id,
       coalesce(nullif(btrim(l.values->>'full_name'), ''), nullif(btrim(concat_ws(' ', l.values->>'first_name', l.values->>'last_name')), ''), nullif(btrim(l.values->>'name'), ''), 'Unnamed lead') as client_name,
       d.local_date as transferred_on,
       app.submitted_on,
       pol.issued_on,
       pol.policy_number,
       pol.carrier,
       cb.charged_back_on,
       coalesce(led.payable_cents, 0) as payable_cents,
       coalesce(led.unpaid_cents, 0) as unpaid_cents,
       coalesce(led.invoiced_cents, 0) as invoiced_cents,
       coalesce(led.paid_cents, 0) as paid_cents,
       coalesce(led.entries, 0) as entries,
       led.open_from,
       led.last_run_id
  from public.deal_flow d
  left join public.agent_leads l on l.id = d.lead_id
  left join lateral (
    select min((a.submitted_at at time zone 'UTC')::date) as submitted_on
      from public.tenant_applications a where a.tenant_id = d.tenant_id and a.lead_id = d.lead_id and a.submitted_at is not null
  ) app on true
  left join lateral (
    select (i.issued_at at time zone 'UTC')::date as issued_on, i.policy_number, i.carrier
      from public.tenant_issued_policies i where i.tenant_id = d.tenant_id and i.deal_id = d.id
     order by i.issued_at desc nulls last limit 1
  ) pol on true
  left join lateral (
    select min(coalesce(e.transaction_date, e.statement_date)) as charged_back_on
      from public.commission_entry e join public.carriers ca on ca.id = e.carrier_id
     where pol.policy_number is not null and e.tenant_id = d.tenant_id and e.policy_number = pol.policy_number
       and e.entry_type = 'chargeback' and e.amount_cents < 0
       and lower(btrim(coalesce(pol.carrier, ''))) in (lower(btrim(ca.name)), lower(btrim(ca.code)))
  ) cb on true
  left join lateral (
    select sum(e.amount_cents) as payable_cents,
           sum(e.amount_cents) filter (where e.run_id is null) as unpaid_cents,
           sum(e.amount_cents) filter (where e.run_id is not null and e.paid_at is null) as invoiced_cents,
           sum(e.amount_cents) filter (where e.paid_at is not null) as paid_cents,
           count(*) as entries,
           min(e.earned_on) filter (where e.run_id is null) as open_from,
           (array_agg(e.run_id order by e.locked_at desc nulls last))[1] as last_run_id
      from public.partner_ledger_entry e where e.tenant_id = d.tenant_id and e.partner_id = d.partner_id and e.deal_id = d.id
  ) led on true
 where d.partner_id is not null;

-- ─── access ────────────────────────────────────────────────────────────────────────────────────
alter table public.partner_payout_profile enable row level security;
alter table public.partner_ledger_entry enable row level security;
drop policy if exists partner_payout_profile_read on public.partner_payout_profile;
create policy partner_payout_profile_read on public.partner_payout_profile for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists partner_ledger_entry_read on public.partner_ledger_entry;
create policy partner_ledger_entry_read on public.partner_ledger_entry for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.partner_payout_profile, public.partner_ledger_entry, public.partner_client_tracker from public, anon, authenticated;
-- The rulebook is the agency's to edit (through the app, audited); the ledger only through the functions.
revoke delete, truncate on public.partner_payout_profile from service_role, tenant_app;
revoke insert, update on public.partner_payout_profile from tenant_app;
grant select, insert, update on public.partner_payout_profile to service_role;
grant select on public.partner_payout_profile to tenant_app;
revoke insert, update, delete, truncate on public.partner_ledger_entry from service_role, tenant_app;
grant select on public.partner_ledger_entry to service_role, tenant_app;
grant select on public.partner_client_tracker to service_role, tenant_app;

revoke all on function public.partner_ledger_entry_guard() from public, anon, authenticated;
revoke all on function public.partner_payout_cycle(text, date) from public, anon, authenticated;
grant execute on function public.partner_payout_cycle(text, date) to service_role, tenant_app;
revoke all on function public.partner_payout_cadence(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.partner_payout_cadence(uuid, uuid) to service_role;
revoke all on function public.sync_partner_ledger(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.sync_partner_ledger(uuid, uuid) to service_role;
revoke all on function public.run_partner_invoices(uuid, date, uuid, uuid[], boolean) from public, anon, authenticated, tenant_app;
grant execute on function public.run_partner_invoices(uuid, date, uuid, uuid[], boolean) to service_role;
revoke all on function public.set_payout_invoice_pdf(uuid, uuid, text) from public, anon, authenticated, tenant_app;
grant execute on function public.set_payout_invoice_pdf(uuid, uuid, text) to service_role;
