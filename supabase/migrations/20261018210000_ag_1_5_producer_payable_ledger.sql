-- AG-1.5 (Notion sprint, Agency Module 0 / AG-1) · the producer payable ledger — immutable, signed, three truths.
-- With AG-1.3's arithmetic (the writer below) and AG-1.6's splits applied to the producer pool.
--
-- This table is the product: the agency's real exposure is the negative balance of a producer who has left.
--
-- Decision D5: the spec's `producer_payable_entry` is LA-7.5's producer_ledger_entry, evolved — one ledger, not
-- two. It keeps every guard it had (no UPDATE / DELETE for any app role; producer_immutable_guard), and gains:
--   basis              'expected' | 'reported' | 'received' — never blended. Existing rows are 'reported' (they come
--                      from carrier statements). The payout run pays on 'reported' only (AG-1.12).
--   source_raw_row_id  the immutable layer-1 row the money came from; an entry with no source must be an
--                      explicit 'adjustment' with a reason.
--   adjusts_entry_id   a correction references the entry it corrects — history is never edited.
--   entry types        'earned' | 'advance_paid' | 'chargeback' | 'adjustment' | 'payout' alongside LA-7.5's split_*.
-- Balance = SUM(amount_cents), no branch. A negative balance is normal, never clamped.
--
-- agency_ledger_sync(tenant) — the AG-1.3 engine posting reported money, for AGENCY tenants:
--   for each statement row (advance / earned / chargeback) with a resolved producer (AG-1.4):
--     levels AS OF the policy's effective date: agency level al, writing producer's level pl (AG-0.9)
--     the producer pool's share of what the carrier paid = amount × pl / al   (integer, rounded half away from 0)
--        — the same ratio as pool ÷ agency commission, so the override stays with the agency: amount − share
--     missing al or pl → nothing is posted (absent, not guessed); AG-1.12 lists the row
--     a live policy split (AG-1.6) divides the share: floor each part, the remainder to the writer
--     a CHARGEBACK dated after a producer's offboarding is the AGENCY's (AG-0.7): an agency-level cost entry
--       ('producer_chargeback_absorbed'), no producer debit
--   LA-7.5's producer_ledger_sync skips agency tenants (decision D4); a solo agent's splits run as before.
--
-- Requires 20261018200000 (agency_entry_producer), 20261018205000 (policy_split), 20261018155000 (levels),
-- 20261018150000 (offboarded_on).
--
-- Rollback: drop function agency_ledger_sync(uuid); drop table agency_absorbed_chargeback; restore the
--   producer_ledger_entry checks and producer_ledger_sync from 20261015250000; drop the added columns.

-- ─── the ledger, evolved ──────────────────────────────────────────────────────────────────────────
alter table public.producer_ledger_entry add column if not exists basis text not null default 'reported';
alter table public.producer_ledger_entry add column if not exists source_raw_row_id uuid;
alter table public.producer_ledger_entry add column if not exists adjusts_entry_id uuid references public.producer_ledger_entry(id) on delete restrict;
alter table public.producer_ledger_entry drop constraint if exists producer_ledger_basis;
alter table public.producer_ledger_entry add constraint producer_ledger_basis check (basis in ('expected', 'reported', 'received'));
alter table public.producer_ledger_entry drop constraint if exists producer_ledger_type;
alter table public.producer_ledger_entry add constraint producer_ledger_type check (entry_type in (
  'split_advance', 'split_earned', 'split_chargeback', 'split_paid', 'adjustment',
  'earned', 'advance_paid', 'chargeback', 'payout'));
alter table public.producer_ledger_entry drop constraint if exists producer_ledger_caused;
alter table public.producer_ledger_entry add constraint producer_ledger_caused check (
  (entry_type in ('split_advance', 'split_earned', 'split_chargeback') and commission_entry_id is not null)
  or (entry_type in ('earned', 'chargeback') and (basis <> 'reported' or commission_entry_id is not null))
  or entry_type not in ('split_advance', 'split_earned', 'split_chargeback', 'earned', 'chargeback'));
alter table public.producer_ledger_entry drop constraint if exists producer_ledger_paid;
alter table public.producer_ledger_entry add constraint producer_ledger_paid check (
  (entry_type in ('split_paid', 'payout')) = (payout_run_id is not null) or entry_type in ('adjustment', 'advance_paid'));
-- A reported entry names the immutable row it came from, or is an explicit adjustment with a reason.
alter table public.producer_ledger_entry drop constraint if exists producer_ledger_traceable;
alter table public.producer_ledger_entry add constraint producer_ledger_traceable check (
  entry_type not in ('earned', 'chargeback') or basis <> 'reported' or source_raw_row_id is not null or commission_entry_id is not null) not valid;
revoke update, delete, truncate on public.producer_ledger_entry from service_role, tenant_app, authenticated;

-- ─── a chargeback the agency absorbs ──────────────────────────────────────────────────────────────
alter table public.cost_entry drop constraint if exists cost_entry_type;
alter table public.cost_entry add constraint cost_entry_type check (entry_type in (
  'lead_cost', 'partner_payout', 'producer_split', 'platform_fee', 'tool_subscription', 'insurance', 'professional_fee', 'refund', 'adjustment',
  'producer_chargeback_absorbed'));

create table if not exists public.agency_absorbed_chargeback (
  commission_entry_id uuid not null references public.commission_entry(id) on delete restrict,
  producer_user_id uuid not null references public.users(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  amount_cents bigint not null,
  cost_entry_id uuid not null references public.cost_entry(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (commission_entry_id, producer_user_id)
);
revoke all on public.agency_absorbed_chargeback from public, anon, authenticated;
revoke insert, update, delete, truncate on public.agency_absorbed_chargeback from service_role, tenant_app;
grant select on public.agency_absorbed_chargeback to service_role, tenant_app;
alter table public.agency_absorbed_chargeback enable row level security;
drop policy if exists agency_absorbed_chargeback_read on public.agency_absorbed_chargeback;
create policy agency_absorbed_chargeback_read on public.agency_absorbed_chargeback for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- amount × num / den, integers only, half away from zero (AG-1.3: no float at any layer).
create or replace function public.agency_ratio_share(p_cents bigint, p_num integer, p_den integer)
returns bigint
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case when p_cents >= 0 then (p_cents * p_num * 2 + p_den) / (2 * p_den::bigint)
              else -((-p_cents * p_num * 2 + p_den) / (2 * p_den::bigint)) end
$$;

-- ─── the writer ───────────────────────────────────────────────────────────────────────────────────
create or replace function public.agency_ledger_sync(p_tenant_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e record;
  v_writer uuid;
  v_on date;
  v_level_on date;
  v_al integer;
  v_pl integer;
  v_share bigint;
  v_kind text;
  v_parts jsonb;
  v_part record;
  v_allocated bigint;
  v_amount bigint;
  v_offboarded date;
  v_status text;
  v_cost uuid;
  v_agency uuid;
  v_n integer := 0;
begin
  if coalesce(public.tenant_plan_audience(p_tenant_id), '') <> 'agency' then return 0; end if;
  select id into v_agency from public.agency where tenant_id = p_tenant_id;
  perform public.agency_attribution_scan(p_tenant_id);

  for e in
    select ce.*, coalesce(case when ce.entry_type = 'reversal' then ce.corrects_type end, ce.entry_type) as kind,
           coalesce(ce.transaction_date, ce.statement_date) as on_date,
           pc.effective_date, pc.issue_date
      from public.commission_entry ce
      left join public.policy_current pc on pc.tenant_id = ce.tenant_id and pc.carrier_id = ce.carrier_id and pc.policy_number = ce.policy_number
     where ce.tenant_id = p_tenant_id
       and coalesce(ce.payee_level, 'writing_agent') = 'writing_agent'
       and coalesce(case when ce.entry_type = 'reversal' then ce.corrects_type end, ce.entry_type) in ('advance', 'earned', 'chargeback')
       and not exists (select 1 from public.producer_ledger_entry l where l.commission_entry_id = ce.id)
       and not exists (select 1 from public.agency_absorbed_chargeback a where a.commission_entry_id = ce.id)
     order by coalesce(ce.transaction_date, ce.statement_date), ce.id
  loop
    v_writer := public.agency_entry_producer(p_tenant_id, e.id);
    continue when v_writer is null;                                    -- waiting for a person (AG-1.4)
    v_on := e.on_date;
    v_level_on := coalesce(e.effective_date, e.issue_date, v_on);      -- AS OF the policy's effective date
    v_al := public.agency_level_bps_as_of(p_tenant_id, e.carrier_id, v_level_on);
    v_pl := public.producer_level_bps_as_of(p_tenant_id, v_writer, e.carrier_id, v_level_on);
    continue when v_al is null or v_pl is null or v_al = 0;            -- absent, not guessed (AG-1.12 lists it)
    v_share := public.agency_ratio_share(e.amount_cents, v_pl, v_al);  -- the producer pool's part of this row
    v_kind := case when e.kind = 'chargeback' then 'chargeback' else 'earned' end;

    -- the live split, writer first; no split = the writer's whole pool
    select coalesce(jsonb_agg(jsonb_build_object('u', s.producer_user_id, 'bps', s.share_bps) order by s.is_writer desc, s.producer_user_id), '[]'::jsonb)
      into v_parts
      from public.policy_split s
     where s.tenant_id = p_tenant_id and s.carrier_id = e.carrier_id and s.policy_number = e.policy_number and s.superseded_at is null;
    if jsonb_array_length(v_parts) = 0 then v_parts := jsonb_build_array(jsonb_build_object('u', v_writer, 'bps', 10000)); end if;

    v_allocated := 0;
    for v_part in select (p->>'u')::uuid as u, (p->>'bps')::int as bps, ord from jsonb_array_elements(v_parts) with ordinality as t(p, ord) loop
      -- floor toward zero; the remainder goes to the first (the writer) after the loop
      v_amount := case when v_share >= 0 then (v_share * v_part.bps) / 10000 else -((-v_share * v_part.bps) / 10000) end;
      if v_part.ord = 1 then
        v_amount := v_amount + (v_share - (select coalesce(sum(case when v_share >= 0 then (v_share * (q->>'bps')::int) / 10000 else -((-v_share * (q->>'bps')::int) / 10000) end), 0)
                                             from jsonb_array_elements(v_parts) q));
      end if;
      v_allocated := v_allocated + v_amount;

      select p.status, p.offboarded_on into v_status, v_offboarded from public.producer p where p.tenant_id = p_tenant_id and p.user_id = v_part.u;
      if v_kind = 'chargeback' and v_status = 'offboarded' and v_offboarded is not null and v_on > v_offboarded then
        -- AG-0.7: the agency eats a lapse on a departed producer's policy
        if v_amount <> 0 then
          v_cost := public.record_cost_entry(p_tenant_id, jsonb_build_object(
            'agency_id', v_agency, 'entry_type', 'producer_chargeback_absorbed', 'amount_cents', v_amount, 'incurred_on', v_on,
            'counterparty_type', 'producer', 'counterparty_id', v_part.u, 'producer_user_id', v_part.u, 'carrier_id', e.carrier_id,
            'policy_number', e.policy_number, 'description', 'Chargeback after offboarding, absorbed by the agency'), null);
          insert into public.agency_absorbed_chargeback (commission_entry_id, producer_user_id, tenant_id, amount_cents, cost_entry_id)
          values (e.id, v_part.u, p_tenant_id, v_amount, v_cost);
        end if;
        continue;
      end if;
      insert into public.producer_ledger_entry (tenant_id, agency_id, producer_user_id, entry_type, basis, policy_number, carrier_id,
                                                commission_entry_id, source_raw_row_id, split_pct_bp_applied, amount_cents, occurred_on)
      values (p_tenant_id, v_agency, v_part.u, v_kind, 'reported', e.policy_number, e.carrier_id, e.id, e.raw_row_id, v_part.bps, v_amount, v_on)
      on conflict (commission_entry_id, producer_user_id) where commission_entry_id is not null do nothing;
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.agency_ledger_sync(uuid) from public, anon, authenticated;
grant execute on function public.agency_ledger_sync(uuid) to service_role;

-- ─── LA-7.5's writer leaves agency tenants to this one (decision D4) ──────────────────────────────
do $$
declare
  v_def text := pg_get_functiondef('public.producer_ledger_sync(uuid)'::regprocedure);
  v_anchor constant text := 'and coalesce(e.agent_user_id, pc.agent_user_id) is not null and coalesce(e.payee_level, ''writing_agent'') = ''writing_agent''';
  v_patch constant text := ' and coalesce(public.tenant_plan_audience(e.tenant_id), '''') <> ''agency'' /* AG-1.5 */';
begin
  if position('/* AG-1.5 */' in v_def) = 0 then
    if position(v_anchor in v_def) = 0 then raise exception 'AG-1.5: producer_ledger_sync anchor not found'; end if;
    execute replace(v_def, v_anchor, v_anchor || v_patch);
  end if;
end;
$$;

-- ─── what each producer is owed, by basis ─────────────────────────────────────────────────────────
create or replace function public.agency_producer_balances(p_tenant_id uuid, p_as_of date default current_date)
returns table(producer_user_id uuid, basis text, balance_cents bigint, earned_cents bigint, chargeback_cents bigint, paid_cents bigint, adjusted_cents bigint, entries bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.producer_user_id, e.basis,
         sum(e.amount_cents)::bigint,
         coalesce(sum(e.amount_cents) filter (where e.entry_type in ('earned', 'split_advance', 'split_earned')), 0)::bigint,
         coalesce(sum(e.amount_cents) filter (where e.entry_type in ('chargeback', 'split_chargeback')), 0)::bigint,
         coalesce(sum(e.amount_cents) filter (where e.entry_type in ('payout', 'split_paid', 'advance_paid')), 0)::bigint,
         coalesce(sum(e.amount_cents) filter (where e.entry_type = 'adjustment'), 0)::bigint,
         count(*)::bigint
    from public.producer_ledger_entry e
   where e.tenant_id = p_tenant_id and e.occurred_on <= p_as_of
   group by e.producer_user_id, e.basis
$$;
revoke all on function public.agency_producer_balances(uuid, date) from public, anon, authenticated;
grant execute on function public.agency_producer_balances(uuid, date) to service_role;

-- ─── self-check ───────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if has_table_privilege('service_role', 'public.producer_ledger_entry', 'UPDATE') or has_table_privilege('service_role', 'public.producer_ledger_entry', 'DELETE') then
    raise exception 'AG-1.5: the application role can UPDATE or DELETE ledger entries';
  end if;
  if pg_get_functiondef('public.producer_ledger_sync(uuid)'::regprocedure) not like '%/* AG-1.5 */%' then
    raise exception 'AG-1.5: LA-7.5 would still post splits for agency tenants';
  end if;
  if pg_get_functiondef('public.agency_producer_balances(uuid,date)'::regprocedure) ~* 'greatest\(\s*0' then
    raise exception 'AG-1.5: a balance is clamped at zero';
  end if;
end;
$$;
