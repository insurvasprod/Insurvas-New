-- AG-1.12 (Notion sprint, Agency Module 0 / AG-1) · the per-producer three-truths reconciliation guard.
--
--   expected  rate card × his contract level   what he SHOULD earn   — LA-0.4's expected_commission per policy,
--                                                                        × (his level ÷ the agency level it was
--                                                                        priced at), as of the policy's date
--   reported  the carrier statement, by AG-1.4  what the carrier SAYS  — his reported ledger entries (AG-1.5)
--   received  the bank                          what actually ARRIVED  — the reported entries whose statement a
--                                                                        CONFIRMED bank deposit covers (LA-7.6
--                                                                        deposit_match), pro rata when partly
-- Three numbers per producer per period, never averaged; the variances are NAMED (expected→reported,
-- reported→received), never netted. A variance over the threshold raises a review item and nothing resolves it
-- automatically toward whichever number is largest; raw_rows is immutable and a correction is an adjustment
-- entry at the ledger layer. The payout run pays on reported (AG-1.7).
--
-- The other half of the guard is static: lib/agency/threeTruths.test.mjs fails the build on a query that sums
-- amount_cents across bases without grouping by basis, and on a producer money figure with no basis label.
--
-- Requires 20261018210000 (basis, agency_ratio_share), LA-0.4 expected_commission, LA-7.6 deposit_match.
--
-- Rollback: drop function agency_three_truths, agency_reconcile, agency_variance_mark; drop table agency_variance_review.

create table if not exists public.agency_variance_review (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  producer_user_id uuid not null references public.users(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  kind text not null,
  expected_cents bigint,
  reported_cents bigint not null,
  received_cents bigint,
  variance_cents bigint not null,
  status text not null default 'open',
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  constraint agency_variance_one unique (tenant_id, producer_user_id, period_start, period_end, kind),
  constraint agency_variance_kind check (kind in ('expected_reported', 'reported_received')),
  constraint agency_variance_status check (status in ('open', 'reviewed')),
  constraint agency_variance_review_note check (status = 'open' or (reviewed_at is not null and length(btrim(coalesce(note, ''))) between 1 and 500))
);
revoke all on public.agency_variance_review from public, anon, authenticated;
revoke insert, update, delete, truncate on public.agency_variance_review from service_role, tenant_app;
grant select on public.agency_variance_review to service_role, tenant_app;
alter table public.agency_variance_review enable row level security;
drop policy if exists agency_variance_review_read on public.agency_variance_review;
create policy agency_variance_review_read on public.agency_variance_review for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- ─── the three numbers, per producer, for a period ────────────────────────────────────────────────
create or replace function public.agency_three_truths(p_tenant_id uuid, p_from date, p_to date)
returns table(producer_user_id uuid, expected_cents bigint, reported_cents bigint, received_cents bigint, expected_missing_levels integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with producers as (
    select p.user_id from public.producer p where p.tenant_id = p_tenant_id and p.status <> 'invited'
  ),
  expected as (
    select pc.agent_user_id as producer,
           coalesce(sum(public.agency_ratio_share(coalesce(ec.expected_advance_cents, ec.expected_amount_cents),
                   public.producer_level_bps_as_of(p_tenant_id, pc.agent_user_id, ec.carrier_id, coalesce(pc.effective_date, pc.issue_date, ec.trigger_occurred_on)),
                   ec.contract_level_bp))
             filter (where public.producer_level_bps_as_of(p_tenant_id, pc.agent_user_id, ec.carrier_id, coalesce(pc.effective_date, pc.issue_date, ec.trigger_occurred_on)) is not null
                       and coalesce(ec.contract_level_bp, 0) > 0), 0)::bigint as cents,
           count(*) filter (where public.producer_level_bps_as_of(p_tenant_id, pc.agent_user_id, ec.carrier_id, coalesce(pc.effective_date, pc.issue_date, ec.trigger_occurred_on)) is null
                              or coalesce(ec.contract_level_bp, 0) = 0)::integer as missing
      from public.expected_commission ec
      join public.policy_current pc on pc.tenant_id = ec.tenant_id and pc.carrier_id = ec.carrier_id and pc.policy_number = ec.policy_number
     where ec.tenant_id = p_tenant_id and ec.trigger_occurred_on between p_from and p_to and pc.agent_user_id is not null
       and coalesce(ec.expected_advance_cents, ec.expected_amount_cents) is not null
     group by pc.agent_user_id
  ),
  reported as (
    select e.producer_user_id as producer, e.id, e.amount_cents, ce.file_id
      from public.producer_ledger_entry e
      left join public.commission_entry ce on ce.id = e.commission_entry_id
     where e.tenant_id = p_tenant_id and e.basis = 'reported' and e.occurred_on between p_from and p_to
       and e.entry_type in ('earned', 'chargeback', 'split_advance', 'split_earned', 'split_chargeback')
  ),
  statement_cover as (
    select s.file_id,
           s.amount_paid_cents,
           coalesce((select sum(m.amount_applied_cents) from public.deposit_match m where m.carrier_account_statement_id = s.id and m.confirmed_at is not null), 0) as applied
      from public.carrier_account_statement s
     where s.tenant_id = p_tenant_id and s.file_id is not null
  )
  select pr.user_id,
         (select x.cents from expected x where x.producer = pr.user_id),
         coalesce((select sum(r.amount_cents) from reported r where r.producer = pr.user_id), 0)::bigint,
         coalesce((select sum(case when sc.amount_paid_cents is null or sc.amount_paid_cents <= 0 then 0
                                   else public.agency_ratio_share(r.amount_cents, least(sc.applied, sc.amount_paid_cents)::integer, sc.amount_paid_cents::integer) end)
                     from reported r join statement_cover sc on sc.file_id = r.file_id
                    where r.producer = pr.user_id), 0)::bigint,
         coalesce((select x.missing from expected x where x.producer = pr.user_id), 0)
    from producers pr;
$$;

-- ─── raise review items for variances over the threshold; never correct anything ──────────────────
create or replace function public.agency_reconcile(p_tenant_id uuid, p_from date, p_to date, p_threshold_cents bigint)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer := 0;
  v_k integer;
begin
  insert into public.agency_variance_review (tenant_id, producer_user_id, period_start, period_end, kind, expected_cents, reported_cents, received_cents, variance_cents)
  select p_tenant_id, t.producer_user_id, p_from, p_to, 'expected_reported', t.expected_cents, t.reported_cents, t.received_cents, t.reported_cents - t.expected_cents
    from public.agency_three_truths(p_tenant_id, p_from, p_to) t
   where t.expected_cents is not null and abs(t.reported_cents - t.expected_cents) > p_threshold_cents
  on conflict on constraint agency_variance_one do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;
  insert into public.agency_variance_review (tenant_id, producer_user_id, period_start, period_end, kind, expected_cents, reported_cents, received_cents, variance_cents)
  select p_tenant_id, t.producer_user_id, p_from, p_to, 'reported_received', t.expected_cents, t.reported_cents, t.received_cents, t.received_cents - t.reported_cents
    from public.agency_three_truths(p_tenant_id, p_from, p_to) t
   where abs(t.received_cents - t.reported_cents) > p_threshold_cents
  on conflict on constraint agency_variance_one do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;
  return v_n;
end;
$$;

create or replace function public.agency_variance_mark(p_tenant_id uuid, p_item_id uuid, p_note text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if length(btrim(coalesce(p_note, ''))) = 0 then raise exception 'variance_note_required' using errcode = 'P0001'; end if;
  update public.agency_variance_review set status = 'reviewed', reviewed_by = p_actor, reviewed_at = now(), note = btrim(p_note)
   where tenant_id = p_tenant_id and id = p_item_id and status = 'open';
  if not found then raise exception 'variance_not_open' using errcode = 'P0001'; end if;
end;
$$;
revoke all on function public.agency_three_truths(uuid, date, date), public.agency_reconcile(uuid, date, date, bigint), public.agency_variance_mark(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.agency_three_truths(uuid, date, date), public.agency_reconcile(uuid, date, date, bigint), public.agency_variance_mark(uuid, uuid, text, uuid) to service_role;

-- ─── self-check ───────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if pg_get_functiondef('public.agency_reconcile(uuid,date,date,bigint)'::regprocedure) ~* 'producer_ledger_entry|commission_entry|raw_rows' then
    raise exception 'AG-1.12: reconciliation writes to a money layer instead of raising a review item';
  end if;
end;
$$;
