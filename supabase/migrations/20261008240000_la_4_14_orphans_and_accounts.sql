-- LA-4.14 (Notion sprint) · the orphan queue and the carrier's account statements.
--
-- PART 1 · ORPHANS. A commission line for a policy no policy file has shown yet is normal: the files
-- don't arrive in step. LA-4.12's entries are keyed by carrier + policy number and are never
-- updated, so nothing is "claimed" by writing: a line is an orphan exactly while no policy_current
-- row has its carrier and number, and stops being one the moment the policy arrives; every rollup
-- is computed, so it follows by itself. No person touches a normal orphan.
--
--   commission_orphan_summary  per agency and carrier: policies, lines, amount, held, the oldest
--                              orphan's date and how many are past the agency's threshold.
--   sweep_orphan_commissions   one queue item (orphan_commission, LA-4.9) per policy number still
--                              orphaned after the threshold (queue_assignment_rule.open_after_days,
--                              default 60), and closes those items when the policy arrives.
--
-- PART 2 · CARRIER ACCOUNTS. A statement's header: opening balance, activity, closing balance,
-- what the carrier sent and what it held. A negative closing balance is a debit balance — the agent
-- owes the carrier, which keeps every commission until it clears.
--
--   carrier_account_statement  one per agency, carrier and statement date, tied to the commission
--                              file it heads (when there is one).
--   carrier_account_checks     opening + activity = closing; the file's entries sum to the stated
--                              activity (held excluded: held is reported apart); this opening =
--                              the previous closing (a break means a statement is missing).
--   A statement that fails its arithmetic is flagged and its file's entries are held out of
--   commission_policy_totals until it is corrected.
--
-- Additive. Requires 20261008220000 (commission_entry), 20261008180000 (queue_item).
--
-- Rollback:
--   select cron.unschedule('la4-orphan-commissions-daily');
--   drop function if exists public.sweep_orphan_commissions(uuid, date);
--   drop view if exists public.carrier_account_checks, public.commission_orphan_summary;
--   drop table if exists public.carrier_account_statement;
--   (and re-create commission_policy_totals from 20261008220000)

-- ─── part 1: orphans ───────────────────────────────────────────────────────────────────────────
create or replace view public.commission_orphan_summary
with (security_invoker = true) as
with orphan as (
  select e.tenant_id, e.carrier_id, e.policy_number, e.entry_type, e.corrects_type, e.amount_cents,
         coalesce(e.transaction_date, e.statement_date, e.created_at::date) as seen_on
    from public.commission_entry e
   where not exists (select 1 from public.policy_current pc where pc.tenant_id = e.tenant_id and pc.carrier_id = e.carrier_id and pc.policy_number = e.policy_number)
), per_policy as (
  select tenant_id, carrier_id, policy_number, min(seen_on) as first_seen,
         count(*) as lines,
         coalesce(sum(amount_cents) filter (where coalesce(corrects_type, entry_type) <> 'held'), 0)::bigint as amount_cents,
         coalesce(sum(amount_cents) filter (where coalesce(corrects_type, entry_type) = 'held'), 0)::bigint as held_cents
    from orphan group by tenant_id, carrier_id, policy_number
)
select p.tenant_id, p.carrier_id,
       count(*) as orphan_policies,
       sum(p.lines)::bigint as orphan_lines,
       sum(p.amount_cents)::bigint as orphan_amount_cents,
       sum(p.held_cents)::bigint as orphan_held_cents,
       min(p.first_seen) as oldest_orphan_date,
       count(*) filter (where p.first_seen <= current_date - coalesce(
         (select r.open_after_days from public.queue_assignment_rule r where r.tenant_id = p.tenant_id and r.queue_type = 'orphan_commission'), 60)) as past_threshold
  from per_policy p
 group by p.tenant_id, p.carrier_id;

create or replace function public.sweep_orphan_commissions(p_tenant_id uuid default null, p_as_of date default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_as_of date := coalesce(p_as_of, current_date);
  v_opened integer := 0;
  v_closed integer := 0;
  r record;
begin
  -- Open (or refresh) one item per policy number orphaned past the agency's threshold.
  for r in
    select e.tenant_id, e.carrier_id, e.policy_number,
           min(coalesce(e.transaction_date, e.statement_date, e.created_at::date)) as first_seen,
           count(*) as lines,
           coalesce(sum(e.amount_cents) filter (where coalesce(e.corrects_type, e.entry_type) <> 'held'), 0) as amount_cents
      from public.commission_entry e
     where (p_tenant_id is null or e.tenant_id = p_tenant_id)
       and not exists (select 1 from public.policy_current pc where pc.tenant_id = e.tenant_id and pc.carrier_id = e.carrier_id and pc.policy_number = e.policy_number)
     group by e.tenant_id, e.carrier_id, e.policy_number
    having min(coalesce(e.transaction_date, e.statement_date, e.created_at::date)) <= v_as_of - coalesce(
      (select q.open_after_days from public.queue_assignment_rule q where q.tenant_id = e.tenant_id and q.queue_type = 'orphan_commission'), 60)
  loop
    begin
      -- Counted only when new: an item already open is refreshed, not opened again.
      if not exists (select 1 from public.queue_item q where q.tenant_id = r.tenant_id and q.queue_type = 'orphan_commission'
                      and q.subject_key = 'orphan:' || r.carrier_id::text || ':' || r.policy_number and q.status = 'open') then
        v_opened := v_opened + 1;
      end if;
      perform public.open_queue_item(r.tenant_id, 'orphan_commission', 'orphan:' || r.carrier_id::text || ':' || r.policy_number, 'commission_policy', null,
        r.carrier_id, r.policy_number, null, null, null,
        jsonb_build_object('lines', r.lines, 'amount_cents', r.amount_cents, 'first_seen', r.first_seen), null, r.first_seen);
    exception when others then
      -- An agency with no owner can't own an item; it is skipped, never left unowned.
      raise notice 'sweep_orphan_commissions: % % %: %', r.tenant_id, r.carrier_id, r.policy_number, sqlerrm;
    end;
  end loop;

  -- Close the items whose policy has since arrived: its lines belong to it now.
  for r in
    select q.id, q.tenant_id from public.queue_item q
     where q.queue_type = 'orphan_commission' and q.status = 'open' and (p_tenant_id is null or q.tenant_id = p_tenant_id)
       and exists (select 1 from public.policy_current pc where pc.tenant_id = q.tenant_id and pc.carrier_id = q.carrier_id and pc.policy_number = q.policy_number)
  loop
    if public.resolve_queue_item(r.tenant_id, r.id, null, 'resolved', 'auto_linked', 'The policy arrived in a carrier file; its commission lines belong to it now.', null) then
      v_closed := v_closed + 1;
    end if;
  end loop;

  return jsonb_build_object('opened', v_opened, 'closed', v_closed);
end;
$$;

-- ─── part 2: carrier account statements ────────────────────────────────────────────────────────
create table if not exists public.carrier_account_statement (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agency_id uuid,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  statement_date date not null,
  file_id uuid references public.file_registry(id) on delete set null,
  opening_balance_cents bigint not null,
  activity_cents bigint not null,
  closing_balance_cents bigint not null,
  debit_balance_cents bigint generated always as (case when closing_balance_cents < 0 then closing_balance_cents else 0 end) stored,
  minimum_payout_cents bigint,
  amount_paid_cents bigint,
  held_cents bigint,
  entered_by uuid references public.users(id) on delete set null,
  entered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint carrier_account_statement_key unique (tenant_id, carrier_id, statement_date),
  constraint carrier_account_statement_money check (
    (minimum_payout_cents is null or minimum_payout_cents >= 0) and (amount_paid_cents is null or amount_paid_cents >= 0) and (held_cents is null or held_cents >= 0)
  )
);
create unique index if not exists carrier_account_statement_file_key on public.carrier_account_statement (file_id) where file_id is not null;
create index if not exists carrier_account_statement_carrier_idx on public.carrier_account_statement (carrier_id);
create index if not exists carrier_account_statement_entered_by_idx on public.carrier_account_statement (entered_by) where entered_by is not null;

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
           coalesce(sum(ce.amount_cents) filter (where coalesce(ce.corrects_type, ce.entry_type) <> 'held'), 0)::bigint as entries_cents
      from public.commission_entry ce
     where ce.tenant_id = s.tenant_id and ce.file_id = s.file_id
    having count(*) > 0
  ) e on true
window w as (partition by s.tenant_id, s.carrier_id order by s.statement_date);

-- The rollup from 20261008220000, now holding out the entries of a statement that doesn't add up.
create or replace view public.commission_policy_totals
with (security_invoker = true) as
select e.tenant_id, e.carrier_id, e.policy_number,
       sum(e.amount_cents) filter (where coalesce(e.corrects_type, e.entry_type) = 'advance')::bigint as advanced_cents,
       sum(e.amount_cents) filter (where coalesce(e.corrects_type, e.entry_type) = 'earned')::bigint as earned_cents,
       sum(e.amount_cents) filter (where coalesce(e.corrects_type, e.entry_type) = 'chargeback')::bigint as charged_back_cents,
       sum(e.amount_cents) filter (where coalesce(e.corrects_type, e.entry_type) = 'override')::bigint as override_cents,
       sum(e.amount_cents) filter (where coalesce(e.corrects_type, e.entry_type) = 'fee')::bigint as fee_cents,
       sum(e.amount_cents) filter (where coalesce(e.corrects_type, e.entry_type) = 'advance_interest')::bigint as interest_cents,
       sum(e.amount_cents) filter (where e.entry_type = 'reversal' and e.corrects_type is null)::bigint as other_reversal_cents,
       sum(e.amount_cents) filter (where coalesce(e.corrects_type, e.entry_type) = 'held')::bigint as held_cents,
       sum(e.amount_cents) filter (where coalesce(e.corrects_type, e.entry_type) <> 'held')::bigint as net_received_cents,
       count(*) as entries,
       max(e.statement_date) as last_statement_date
  from public.commission_entry e
 where not exists (select 1 from public.carrier_account_checks c where c.tenant_id = e.tenant_id and c.file_id = e.file_id and c.flagged)
 group by e.tenant_id, e.carrier_id, e.policy_number;

-- ─── access ─────────────────────────────────────────────────────────────────────────────────────
alter table public.carrier_account_statement enable row level security;
drop policy if exists carrier_account_statement_read on public.carrier_account_statement;
create policy carrier_account_statement_read on public.carrier_account_statement for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.carrier_account_statement from public, anon, authenticated;
revoke truncate on public.carrier_account_statement from service_role, tenant_app;
grant select, insert, update, delete on public.carrier_account_statement to service_role;
grant select on public.carrier_account_statement to tenant_app;
revoke all on public.carrier_account_checks, public.commission_orphan_summary from public, anon, authenticated;
grant select on public.carrier_account_checks, public.commission_orphan_summary, public.commission_policy_totals to service_role, tenant_app;
revoke all on function public.sweep_orphan_commissions(uuid, date) from public, anon, authenticated;
grant execute on function public.sweep_orphan_commissions(uuid, date) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('la4-orphan-commissions-daily', '45 6 * * *', $cron$select public.sweep_orphan_commissions()$cron$);
    exception when others then
      raise notice '20261008240000: the daily orphan sweep could not be scheduled (%).', sqlerrm;
    end;
  else
    raise notice '20261008240000: pg_cron is not installed; run sweep_orphan_commissions() from another scheduler.';
  end if;
end $$;

-- Run the sweep the way the job will (a job that fails at 06:45 fails silently), then check.
do $$
declare
  v jsonb;
begin
  v := public.sweep_orphan_commissions();
  if v ? 'opened' is not true then
    raise exception '20261008240000: the orphan sweep did not report';
  end if;
  perform 1 from public.carrier_account_checks limit 1;
  perform 1 from public.commission_orphan_summary limit 1;
end $$;
