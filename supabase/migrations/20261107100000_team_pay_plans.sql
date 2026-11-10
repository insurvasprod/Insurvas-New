-- Team payouts (owner's Accounting doc, "Team Payouts", round 1 boards T1–T7, 2026-11-07).
--
-- Three ways to share the commission, chosen per team member and dated (a change starts on a date; months already
-- paid keep the old plan):
--   1  solo_owner     the boss keeps 100%: nothing is owed to them
--      sidekick       retention: a flat fee for every deal they save (retention_action.result = 'saved', by acted_by)
--   2  salary_bonus   a monthly base, a small % of the commission on their own sales, a flat bonus per submitted
--                     application, and a switch for whether chargebacks come back off their pay
--   3  big_split      a straight % of the commission; chargebacks always come back at the same %
-- A producer with no plan is paid exactly as before (AG-1.3's contract-level ratio).
--
-- How it reaches the money: one ledger, as ever (producer_ledger_entry, decision D5).
--   - agency_ledger_sync (AG-1.5) learns the plan: a plan's % replaces the level ratio for that producer's part; the
--     owner and sidekicks are posted 0; a chargeback is posted 0 when the plan says the agency absorbs it. Zero rows
--     are written on purpose: they mark the commission row as handled, and the statement shows what was absorbed.
--   - sync_producer_pay posts what isn't commission: 'salary' once per month, 'app_bonus' once per client whose
--     application was submitted, 'save_fee' once per policy saved. Idempotent by pay_source_key.
--   - The monthly run (agency_payout_preview / agency_payout_commit, AG-1.7) counts those lines, and the owner's
--     choice for anyone below zero is one of: Carry it (withhold), Take N% of the debt this month (recover), Let it
--     go (forgive: an explicit adjustment the ledger keeps). Each person is paid their own way (Check, Zelle, Bank
--     transfer…), recorded per run.
--
-- Requires 20261018210000 (agency_ledger_sync), 20261018220000 (preview/commit), 20261015250000 (runs, bp_share from
-- 20261015240000), 20261008260000 (retention_action), 20260926100000 (tenant_applications).
--
-- Rollback: drop function sync_producer_pay(uuid, date), producer_pay_plan_as_of(uuid, uuid, date); drop table
--   producer_pay_plan; drop index producer_ledger_one_pay_source; alter table producer_ledger_entry drop column
--   pay_source_key; restore producer_ledger_type, producer_run_decision, agency_payout_preview and
--   agency_payout_commit from 20261018210000 / 20261018220000; re-run 20261018210000's agency_ledger_sync.

-- ─── the plan ─────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.producer_pay_plan (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  producer_user_id uuid not null references public.users(id) on delete restrict,
  model text not null,
  base_cents bigint not null default 0,
  sales_pct_bp integer,
  app_bonus_cents bigint not null default 0,
  save_fee_cents bigint not null default 0,
  chargebacks_apply boolean not null default true,
  effective_from date not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint producer_pay_plan_model check (model in ('solo_owner', 'sidekick', 'salary_bonus', 'big_split')),
  constraint producer_pay_plan_money check (base_cents >= 0 and app_bonus_cents >= 0 and save_fee_cents >= 0
    and base_cents <= 100000000 and app_bonus_cents <= 10000000 and save_fee_cents <= 10000000),
  constraint producer_pay_plan_pct check (sales_pct_bp is null or sales_pct_bp between 0 and 10000),
  constraint producer_pay_plan_shape check (
    (model = 'solo_owner' and base_cents = 0 and app_bonus_cents = 0 and save_fee_cents = 0 and sales_pct_bp is null)
    or (model = 'sidekick' and base_cents = 0 and app_bonus_cents = 0 and sales_pct_bp is null)
    or (model = 'salary_bonus' and sales_pct_bp is not null and save_fee_cents = 0)
    or (model = 'big_split' and sales_pct_bp is not null and base_cents = 0 and app_bonus_cents = 0 and save_fee_cents = 0 and chargebacks_apply))
);
create unique index if not exists producer_pay_plan_one_per_day on public.producer_pay_plan (tenant_id, producer_user_id, effective_from);
create index if not exists producer_pay_plan_producer_idx on public.producer_pay_plan (producer_user_id);
create index if not exists producer_pay_plan_created_by_idx on public.producer_pay_plan (created_by) where created_by is not null;

alter table public.producer_pay_plan enable row level security;
drop policy if exists producer_pay_plan_read on public.producer_pay_plan;
create policy producer_pay_plan_read on public.producer_pay_plan for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.producer_pay_plan from public, anon, authenticated;
revoke insert, update, delete, truncate on public.producer_pay_plan from tenant_app;
grant select on public.producer_pay_plan to tenant_app;
-- The app saves a plan (a new date is a new row; the same date is corrected in place). A plan is never deleted.
revoke delete, truncate on public.producer_pay_plan from service_role;
grant select, insert, update on public.producer_pay_plan to service_role;

-- The plan in force on a date.
create or replace function public.producer_pay_plan_as_of(p_tenant_id uuid, p_producer uuid, p_on date)
returns setof public.producer_pay_plan
language sql
stable
set search_path = public, pg_catalog
as $$
  select * from public.producer_pay_plan
   where tenant_id = p_tenant_id and producer_user_id = p_producer and effective_from <= p_on
   order by effective_from desc
   limit 1
$$;
revoke all on function public.producer_pay_plan_as_of(uuid, uuid, date) from public, anon, authenticated, tenant_app;
grant execute on function public.producer_pay_plan_as_of(uuid, uuid, date) to service_role;

-- ─── the ledger learns three kinds of line ────────────────────────────────────────────────────────
alter table public.producer_ledger_entry add column if not exists pay_source_key text;
alter table public.producer_ledger_entry drop constraint if exists producer_ledger_type;
alter table public.producer_ledger_entry add constraint producer_ledger_type check (entry_type in (
  'split_advance', 'split_earned', 'split_chargeback', 'split_paid', 'adjustment',
  'earned', 'advance_paid', 'chargeback', 'payout',
  'salary', 'app_bonus', 'save_fee'));
alter table public.producer_ledger_entry drop constraint if exists producer_ledger_pay_source;
alter table public.producer_ledger_entry add constraint producer_ledger_pay_source check (
  (entry_type in ('salary', 'app_bonus', 'save_fee')) = (pay_source_key is not null));
create unique index if not exists producer_ledger_one_pay_source on public.producer_ledger_entry (tenant_id, producer_user_id, pay_source_key) where pay_source_key is not null;

-- ─── the commission writer applies the plan (AG-1.5, patched in place) ─────────────────────────────
do $$
declare
  v_def text := pg_get_functiondef('public.agency_ledger_sync(uuid)'::regprocedure);
  a_decl constant text := 'v_n integer := 0;';
  a_skip constant text := 'continue when v_al is null or v_pl is null or v_al = 0;';
  a_share constant text := 'v_share := public.agency_ratio_share(e.amount_cents, v_pl, v_al);';
  a_part constant text := 'select p.status, p.offboarded_on into v_status, v_offboarded from public.producer p where p.tenant_id = p_tenant_id and p.user_id = v_part.u;';
begin
  if position('/* pay plans */' in v_def) > 0 then return; end if;
  if position(a_decl in v_def) = 0 or position(a_skip in v_def) = 0 or position(a_share in v_def) = 0 or position(a_part in v_def) = 0 then
    raise exception 'Team pay plans: agency_ledger_sync anchors not found';
  end if;
  v_def := replace(v_def, a_decl, a_decl || ' v_plan public.producer_pay_plan; v_pp public.producer_pay_plan;');
  -- A writer on a plan is posted even without contract levels: the plan says what they get.
  v_def := replace(v_def, a_skip,
    'v_plan := null; select * into v_plan from public.producer_pay_plan_as_of(p_tenant_id, v_writer, v_level_on); '
    || 'continue when (v_al is null or v_pl is null or v_al = 0) and v_plan.model is null; /* pay plans */');
  v_def := replace(v_def, a_share,
    'v_share := case when v_al is null or v_pl is null or v_al = 0 then e.amount_cents else public.agency_ratio_share(e.amount_cents, v_pl, v_al) end;');
  -- Each part: the plan's % of what the carrier paid replaces the level ratio; the owner and sidekicks get 0;
  -- a chargeback the plan says the agency absorbs is posted at 0.
  v_def := replace(v_def, a_part,
    'v_pp := null; select * into v_pp from public.producer_pay_plan_as_of(p_tenant_id, v_part.u, v_level_on); '
    || 'if v_pp.model in (''solo_owner'', ''sidekick'') then v_amount := 0; '
    || 'elsif v_pp.model is not null and v_pp.sales_pct_bp is not null then v_amount := public.agency_ratio_share(public.agency_ratio_share(e.amount_cents, v_pp.sales_pct_bp, 10000), v_part.bps, 10000); '
    || 'elsif v_al is null or v_pl is null or v_al = 0 then v_amount := 0; end if; '
    || 'if v_kind = ''chargeback'' and v_pp.model is not null and not v_pp.chargebacks_apply then v_amount := 0; end if; '
    || a_part);
  execute v_def;
end;
$$;

-- ─── salary, application bonuses, save fees ───────────────────────────────────────────────────────
-- Posts what each plan earns up to p_to. Safe to run any number of times: one line per pay_source_key.
create or replace function public.sync_producer_pay(p_tenant_id uuid, p_to date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agency uuid;
  pr record;
  m date;
  v_plan public.producer_pay_plan;
  a record;
  v_n integer := 0;
  v_k integer;
begin
  select id into v_agency from public.agency where tenant_id = p_tenant_id;

  -- Salary: once per month the plan is in force at the month's end (or at p_to, for the month p_to is in).
  for pr in select p.producer_user_id, min(p.effective_from) as since from public.producer_pay_plan p
             where p.tenant_id = p_tenant_id group by p.producer_user_id loop
    m := greatest(date_trunc('month', pr.since)::date, (date_trunc('month', p_to) - interval '24 months')::date);
    while m <= p_to loop
      v_plan := null;
      select * into v_plan from public.producer_pay_plan_as_of(p_tenant_id, pr.producer_user_id, least((m + interval '1 month - 1 day')::date, p_to));
      if v_plan.model = 'salary_bonus' and v_plan.base_cents > 0 then
        insert into public.producer_ledger_entry (tenant_id, agency_id, producer_user_id, entry_type, basis, amount_cents, occurred_on, reason, pay_source_key)
        values (p_tenant_id, v_agency, pr.producer_user_id, 'salary', 'reported', v_plan.base_cents, m, 'Base pay ' || to_char(m, 'FMMonth YYYY'), 'salary:' || to_char(m, 'YYYY-MM'))
        on conflict (tenant_id, producer_user_id, pay_source_key) where pay_source_key is not null do nothing;
        get diagnostics v_k = row_count;
        v_n := v_n + v_k;
      end if;
      m := (m + interval '1 month')::date;
    end loop;
  end loop;

  -- Application bonus: once per client, dated by the producer's first submission for them.
  for a in select x.created_by as producer, x.lead_id, min((x.submitted_at at time zone 'UTC')::date) as on_date
             from public.tenant_applications x
            where x.tenant_id = p_tenant_id and x.submitted_at is not null and (x.submitted_at at time zone 'UTC')::date <= p_to
              and exists (select 1 from public.producer_pay_plan p where p.tenant_id = p_tenant_id and p.producer_user_id = x.created_by and p.app_bonus_cents > 0)
            group by x.created_by, x.lead_id loop
    v_plan := null;
    select * into v_plan from public.producer_pay_plan_as_of(p_tenant_id, a.producer, a.on_date);
    continue when v_plan.model is distinct from 'salary_bonus' or v_plan.app_bonus_cents = 0;
    insert into public.producer_ledger_entry (tenant_id, agency_id, producer_user_id, entry_type, basis, amount_cents, occurred_on, reason, pay_source_key)
    values (p_tenant_id, v_agency, a.producer, 'app_bonus', 'reported', v_plan.app_bonus_cents, a.on_date, 'Bonus: application submitted', 'app:' || a.lead_id)
    on conflict (tenant_id, producer_user_id, pay_source_key) where pay_source_key is not null do nothing;
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
  end loop;

  -- Save fee: once per policy saved (the day the save was seen), to the person who made the call.
  for a in select r.acted_by as producer, r.carrier_id, r.policy_number, min(r.result_snapshot_date) as on_date
             from public.retention_action r
            where r.tenant_id = p_tenant_id and r.result = 'saved' and r.acted_by is not null and r.result_snapshot_date <= p_to
              and exists (select 1 from public.producer_pay_plan p where p.tenant_id = p_tenant_id and p.producer_user_id = r.acted_by and p.save_fee_cents > 0)
            group by r.acted_by, r.carrier_id, r.policy_number loop
    v_plan := null;
    select * into v_plan from public.producer_pay_plan_as_of(p_tenant_id, a.producer, a.on_date);
    continue when v_plan.model is distinct from 'sidekick' or v_plan.save_fee_cents = 0;
    insert into public.producer_ledger_entry (tenant_id, agency_id, producer_user_id, entry_type, basis, policy_number, carrier_id, amount_cents, occurred_on, reason, pay_source_key)
    values (p_tenant_id, v_agency, a.producer, 'save_fee', 'reported', a.policy_number, a.carrier_id, v_plan.save_fee_cents, a.on_date, 'Saved deal', 'save:' || a.carrier_id || ':' || a.policy_number)
    on conflict (tenant_id, producer_user_id, pay_source_key) where pay_source_key is not null do nothing;
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.sync_producer_pay(uuid, date) from public, anon, authenticated, tenant_app;
grant execute on function public.sync_producer_pay(uuid, date) to service_role;

-- ─── the monthly run: preview (nothing is written) ────────────────────────────────────────────────
alter table public.producer_payout_run drop constraint if exists producer_run_decision;
alter table public.producer_payout_run add constraint producer_run_decision check (
  decision_mode is null or (decision_mode in ('pay_full', 'withhold', 'amount', 'recover', 'forgive')
    and (decision_mode <> 'amount' or (decision_amount_cents is not null and decision_amount_cents >= 0))));

drop function if exists public.agency_payout_preview(uuid, date, date);
create function public.agency_payout_preview(p_tenant_id uuid, p_from date, p_to date)
returns table(
  producer_user_id uuid, display_name text, status text,
  balance_before_cents bigint, earned_cents bigint, chargeback_cents bigint, period_cents bigint, balance_cents bigint,
  recommended_mode text, recommended_pay_cents bigint, recommended_withhold_cents bigint,
  negative_policies jsonb, already_run boolean,
  plan_model text, salary_cents bigint, bonus_cents bigint, save_fee_cents bigint, absorbed_count bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with p as (
    select pr.user_id, pr.display_name, pr.status from public.producer pr where pr.tenant_id = p_tenant_id
  ), e as (
    select l.* from public.producer_ledger_entry l where l.tenant_id = p_tenant_id and l.basis = 'reported' and l.occurred_on <= p_to
  ), sums as (
    select p.user_id,
           coalesce((select sum(x.amount_cents) from e x where x.producer_user_id = p.user_id
                      and (x.occurred_on < p_from or x.entry_type not in ('split_advance', 'split_earned', 'split_chargeback', 'earned', 'chargeback', 'salary', 'app_bonus', 'save_fee'))), 0)::bigint as before,
           coalesce((select sum(x.amount_cents) from e x where x.producer_user_id = p.user_id and x.amount_cents > 0
                      and x.occurred_on >= p_from and x.entry_type in ('split_advance', 'split_earned', 'earned')), 0)::bigint as earned,
           coalesce((select sum(x.amount_cents) from e x where x.producer_user_id = p.user_id and x.amount_cents < 0
                      and x.occurred_on >= p_from and x.entry_type in ('split_chargeback', 'chargeback')), 0)::bigint as clawed,
           coalesce((select sum(x.amount_cents) from e x where x.producer_user_id = p.user_id and x.occurred_on >= p_from and x.entry_type = 'salary'), 0)::bigint as salary,
           coalesce((select sum(x.amount_cents) from e x where x.producer_user_id = p.user_id and x.occurred_on >= p_from and x.entry_type = 'app_bonus'), 0)::bigint as bonus,
           coalesce((select sum(x.amount_cents) from e x where x.producer_user_id = p.user_id and x.occurred_on >= p_from and x.entry_type = 'save_fee'), 0)::bigint as fees,
           (select count(*) from e x where x.producer_user_id = p.user_id and x.occurred_on >= p_from and x.entry_type = 'chargeback' and x.amount_cents = 0)::bigint as absorbed
      from p
  ), t as (
    select s.*, s.earned + s.clawed + s.salary + s.bonus + s.fees as period from sums s
  )
  select p.user_id, p.display_name, p.status,
         t.before, t.earned, t.clawed, t.period, t.before + t.period,
         case when t.before + t.period < 0 or t.before < 0 then 'withhold' else 'pay_full' end,
         case when t.before + t.period < 0 then 0 else greatest(t.before + t.period, 0) end,
         case when t.before + t.period < 0 then greatest(t.period, 0) else 0 end,
         case when t.before + t.period < 0 or t.before < 0 then coalesce((
           select jsonb_agg(jsonb_build_object('carrier_id', x.carrier_id, 'policy_number', x.policy_number, 'amount_cents', x.amount_cents, 'occurred_on', x.occurred_on) order by x.occurred_on)
             from e x where x.producer_user_id = p.user_id and x.entry_type in ('chargeback', 'split_chargeback') and x.amount_cents < 0), '[]'::jsonb) else '[]'::jsonb end,
         exists (select 1 from public.producer_payout_run r where r.tenant_id = p_tenant_id and r.producer_user_id = p.user_id and r.status <> 'void'
                   and r.period_start <= p_to and r.period_end >= p_from),
         (select pl.model from public.producer_pay_plan_as_of(p_tenant_id, p.user_id, p_to) pl),
         t.salary, t.bonus, t.fees, t.absorbed
    from p join t on t.user_id = p.user_id
   where p.status <> 'invited'
   order by p.display_name;
$$;
revoke all on function public.agency_payout_preview(uuid, date, date) from public, anon, authenticated, tenant_app;
grant execute on function public.agency_payout_preview(uuid, date, date) to service_role;

-- ─── the monthly run: confirm ─────────────────────────────────────────────────────────────────────
-- p_decisions: [{ producer_user_id, mode: pay_full|withhold|amount|recover|forgive, amount_cents?, pct_bp?, reason?,
--                 method?, reference?, paid_on? }] — method/reference/paid_on fall back to the run's.
--   withhold  "Carry it": what is owed comes off this month first; nothing is paid until it clears
--   recover   "Take N% this month": N% of what was owed before the month comes off this month's pay
--   forgive   "Let it go": the agency writes the debt off (an adjustment the ledger keeps), then pays the month
create or replace function public.agency_payout_commit(
  p_tenant_id uuid, p_from date, p_to date, p_decisions jsonb, p_paid_on date, p_method text, p_reference text, p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d record;
  v_run uuid;
  r public.producer_payout_run%rowtype;
  v_period bigint;
  v_net bigint;
  v_debt bigint;
  v_take bigint;
  v_before bigint;
  v_month bigint;
  v_adj bigint;
  v_cap integer;
  v_out jsonb := '[]'::jsonb;
begin
  if coalesce(public.tenant_plan_audience(p_tenant_id), '') <> 'agency' then raise exception 'agency_plan_required' using errcode = 'P0001'; end if;
  if jsonb_typeof(coalesce(p_decisions, '[]'::jsonb)) <> 'array' or jsonb_array_length(p_decisions) = 0 then raise exception 'payout_no_producers' using errcode = 'P0001'; end if;
  select coalesce(a.producer_recovery_cap_bp, 2000) into v_cap from (select 1) x left join public.accounting_settings a on a.tenant_id = p_tenant_id;

  -- Everything owed up to the month's end is on the ledger before anything is counted.
  perform public.agency_ledger_sync(p_tenant_id);
  perform public.sync_producer_pay(p_tenant_id, p_to);

  for d in select (x->>'producer_user_id')::uuid as producer, coalesce(x->>'mode', 'pay_full') as mode,
                  nullif(x->>'amount_cents', '')::bigint as amount, nullif(x->>'pct_bp', '')::integer as pct,
                  nullif(btrim(coalesce(x->>'reason', '')), '') as reason,
                  coalesce(nullif(btrim(coalesce(x->>'method', '')), ''), nullif(btrim(coalesce(p_method, '')), '')) as method,
                  coalesce(nullif(btrim(coalesce(x->>'reference', '')), ''), nullif(btrim(coalesce(p_reference, '')), '')) as reference,
                  coalesce(nullif(x->>'paid_on', '')::date, p_paid_on) as paid_on
             from jsonb_array_elements(p_decisions) x
  loop
    if d.mode not in ('pay_full', 'withhold', 'amount', 'recover', 'forgive') then raise exception 'payout_mode_unknown' using errcode = 'P0001'; end if;
    if d.mode = 'amount' and d.amount is null then raise exception 'payout_amount_required' using errcode = 'P0001'; end if;
    if d.pct is not null and (d.pct < 1 or d.pct > 10000) then raise exception 'payout_pct_out_of_range' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.producer p where p.tenant_id = p_tenant_id and p.user_id = d.producer and p.status <> 'invited') then
      raise exception 'payout_not_a_producer' using errcode = 'P0001';
    end if;

    if d.mode = 'forgive' then
      -- "Let it go": write off what would leave them below zero, dated the day before the month, so the month is paid.
      select coalesce(sum(amount_cents) filter (where occurred_on < p_from), 0),
             coalesce(sum(amount_cents) filter (where occurred_on between p_from and p_to and entry_type not in ('split_paid', 'payout')), 0)
        into v_before, v_month
        from public.producer_ledger_entry where tenant_id = p_tenant_id and producer_user_id = d.producer and basis = 'reported';
      v_adj := greatest(-(v_before + least(v_month, 0)), 0);
      if v_adj > 0 then
        insert into public.producer_ledger_entry (tenant_id, producer_user_id, entry_type, basis, amount_cents, occurred_on, reason, created_by)
        values (p_tenant_id, d.producer, 'adjustment', 'reported', v_adj, p_from - 1,
                left('Forgiven in the ' || to_char(p_from, 'FMMonth YYYY') || ' payroll' || coalesce(': ' || d.reason, ''), 500), p_actor);
      end if;
    end if;

    -- builds the draft from the ledger (and refuses a period already run: one set of entries per producer and period)
    v_run := public.build_producer_run(p_tenant_id, d.producer, p_from, p_to, p_actor);
    select * into r from public.producer_payout_run where id = v_run;
    v_period := r.earned_cents + r.clawed_back_cents;
    v_take := null;
    if d.mode = 'recover' then
      v_debt := greatest(-r.balance_before_cents, 0);
      v_take := least(v_debt, public.bp_share(v_debt, coalesce(d.pct, v_cap)), greatest(v_period, 0));
    end if;
    v_net := case d.mode
               when 'pay_full' then greatest(v_period, 0)
               when 'forgive' then greatest(least(v_period, r.balance_before_cents + v_period), 0)
               when 'withhold' then greatest(r.balance_before_cents + v_period, 0)
               when 'recover' then greatest(v_period - v_take, 0)
               else least(greatest(coalesce(d.amount, 0), 0), greatest(r.balance_before_cents + v_period, greatest(v_period, 0)))
             end;
    if v_net > 0 and (d.method is null or d.paid_on is null) then raise exception 'payout_method_required' using errcode = 'P0001'; end if;
    perform set_config('app.producer_writer', 'on', true);
    update public.producer_payout_run
       set net_cents = v_net,
           withheld_cents = greatest(greatest(v_period, 0) - v_net, 0),
           balance_after_cents = r.balance_before_cents + r.earned_cents + r.clawed_back_cents - v_net,
           decision_mode = d.mode, decision_reason = d.reason,
           decision_amount_cents = case when d.mode = 'recover' then v_take else d.amount end
     where id = v_run;
    perform set_config('app.producer_writer', '', true);
    perform public.publish_producer_run(p_tenant_id, v_run, p_actor);
    if v_net > 0 then
      perform public.mark_producer_run_paid(p_tenant_id, v_run, d.paid_on, d.method, d.reference);
    end if;
    v_out := v_out || jsonb_build_object('producer_user_id', d.producer, 'run_id', v_run, 'net_cents', v_net, 'mode', d.mode, 'taken_cents', v_take, 'forgiven_cents', case when d.mode = 'forgive' then v_adj end);
  end loop;
  return v_out;
end;
$$;
revoke all on function public.agency_payout_commit(uuid, date, date, jsonb, date, text, text, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.agency_payout_commit(uuid, date, date, jsonb, date, text, text, uuid) to service_role;

-- ─── self-check ───────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if pg_get_functiondef('public.agency_ledger_sync(uuid)'::regprocedure) not like '%/* pay plans */%' then
    raise exception 'Team pay plans: the commission writer does not read the plan';
  end if;
  if pg_get_functiondef('public.agency_payout_preview(uuid,date,date)'::regprocedure) ~* 'insert into|update public' then
    raise exception 'Team pay plans: the preview writes';
  end if;
  if has_table_privilege('service_role', 'public.producer_ledger_entry', 'UPDATE') or has_table_privilege('service_role', 'public.producer_ledger_entry', 'DELETE') then
    raise exception 'Team pay plans: the application role can UPDATE or DELETE ledger entries';
  end if;
end;
$$;
