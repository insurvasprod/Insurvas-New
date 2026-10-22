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
