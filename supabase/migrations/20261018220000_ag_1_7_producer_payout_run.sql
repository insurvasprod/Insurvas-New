-- AG-1.7 (Notion sprint, Agency Module 0 / AG-1) · the producer payout run — preview, then commit.
--
--   1. owner or bookkeeper picks a period and the producers
--   2. each producer's movement since his last committed run: earned, charged back, adjusted (REPORTED basis only —
--      paying on expected commission is advancing the agency's money on the agency's guess, AG-1.12)
--   3. PREVIEW (agency_payout_preview): NOTHING is written. Producers with a negative balance are listed with the
--      recommended withhold, the reason, and the policies behind it.
--   4. COMMIT (agency_payout_commit): per producer the owner's decision — pay in full, withhold against the negative
--      balance, or pay a stated amount — recorded with the run; one payout entry per producer in the ledger (the
--      'split_paid' entry LA-7.5's publish writes) and the run as the statement's anchor (AG-1.8).
--
-- Not a second payout engine (spec): LA-7.5's build_producer_run / publish_producer_run / mark_producer_run_paid,
-- extended to the AG entry types and to the reported basis. Idempotent per (producer, period) by the existing
-- unique index producer_run_one_live — committing the same period twice fails as a whole and writes nothing.
-- A preview is never persisted as ledger rows. Suspended producers can be paid; offboarded producers are paid out
-- to their frozen balance. No ACH: commit records the method and reference the owner enters.
--
-- Requires 20261018210000 (agency_ledger_sync, AG entry types).
--
-- Rollback: drop functions agency_payout_preview, agency_payout_commit; drop run columns decision_mode,
--   decision_reason, decision_amount_cents; restore build_producer_run from 20261015250000.

alter table public.producer_payout_run add column if not exists decision_mode text;
alter table public.producer_payout_run add column if not exists decision_reason text;
alter table public.producer_payout_run add column if not exists decision_amount_cents bigint;
alter table public.producer_payout_run drop constraint if exists producer_run_decision;
alter table public.producer_payout_run add constraint producer_run_decision check (
  decision_mode is null or (decision_mode in ('pay_full', 'withhold', 'amount')
    and (decision_mode <> 'amount' or (decision_amount_cents is not null and decision_amount_cents >= 0))));

-- ─── LA-7.5's run builder reads the AG entry types, reported basis only, and syncs the agency writer ──
do $$
declare
  v_def text := pg_get_functiondef('public.build_producer_run(uuid,uuid,date,date,uuid)'::regprocedure);
begin
  if position('/* AG-1.7 */' in v_def) > 0 then return; end if;
  if position('(''split_advance'', ''split_earned'', ''split_chargeback'')' in v_def) = 0
     or position('and producer_user_id = p_producer' in v_def) = 0
     or position('perform public.producer_ledger_sync(p_tenant_id);' in v_def) = 0 then
    raise exception 'AG-1.7: build_producer_run anchors not found';
  end if;
  v_def := replace(v_def, '(''split_advance'', ''split_earned'', ''split_chargeback'')', '(''split_advance'', ''split_earned'', ''split_chargeback'', ''earned'', ''chargeback'')');
  v_def := replace(v_def, 'and producer_user_id = p_producer', 'and producer_user_id = p_producer and basis = ''reported''');
  v_def := replace(v_def, 'perform public.producer_ledger_sync(p_tenant_id);', 'perform public.producer_ledger_sync(p_tenant_id); perform public.agency_ledger_sync(p_tenant_id); /* AG-1.7 */');
  execute v_def;
end;
$$;

-- ─── preview: nothing is written ──────────────────────────────────────────────────────────────────
create or replace function public.agency_payout_preview(p_tenant_id uuid, p_from date, p_to date)
returns table(
  producer_user_id uuid, display_name text, status text,
  balance_before_cents bigint, earned_cents bigint, chargeback_cents bigint, period_cents bigint, balance_cents bigint,
  recommended_mode text, recommended_pay_cents bigint, recommended_withhold_cents bigint,
  negative_policies jsonb, already_run boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with p as (
    select pr.user_id, pr.display_name, pr.status from public.producer pr where pr.tenant_id = p_tenant_id
  ), sums as (
    select p.user_id,
           coalesce((select sum(e.amount_cents) from public.producer_ledger_entry e
                      where e.tenant_id = p_tenant_id and e.producer_user_id = p.user_id and e.basis = 'reported'
                        and (e.occurred_on < p_from or (e.occurred_on <= p_to and e.entry_type not in ('split_advance', 'split_earned', 'split_chargeback', 'earned', 'chargeback')))), 0)::bigint as before,
           coalesce((select sum(e.amount_cents) from public.producer_ledger_entry e
                      where e.tenant_id = p_tenant_id and e.producer_user_id = p.user_id and e.basis = 'reported' and e.amount_cents > 0
                        and e.occurred_on between p_from and p_to and e.entry_type in ('split_advance', 'split_earned', 'earned')), 0)::bigint as earned,
           coalesce((select sum(e.amount_cents) from public.producer_ledger_entry e
                      where e.tenant_id = p_tenant_id and e.producer_user_id = p.user_id and e.basis = 'reported' and e.amount_cents < 0
                        and e.occurred_on between p_from and p_to and e.entry_type in ('split_chargeback', 'chargeback')), 0)::bigint as clawed
      from p
  )
  select p.user_id, p.display_name, p.status,
         s.before, s.earned, s.clawed, s.earned + s.clawed, s.before + s.earned + s.clawed,
         case when s.before + s.earned + s.clawed < 0 then 'withhold' else 'pay_full' end,
         case when s.before + s.earned + s.clawed < 0 then 0 else greatest(s.before + s.earned + s.clawed, 0) end,
         case when s.before + s.earned + s.clawed < 0 then greatest(s.earned + s.clawed, 0) else 0 end,
         case when s.before + s.earned + s.clawed < 0 then coalesce((
           select jsonb_agg(jsonb_build_object('carrier_id', e.carrier_id, 'policy_number', e.policy_number, 'amount_cents', e.amount_cents, 'occurred_on', e.occurred_on) order by e.occurred_on)
             from public.producer_ledger_entry e
            where e.tenant_id = p_tenant_id and e.producer_user_id = p.user_id and e.basis = 'reported' and e.entry_type in ('chargeback', 'split_chargeback')
              and e.occurred_on <= p_to), '[]'::jsonb) else '[]'::jsonb end,
         exists (select 1 from public.producer_payout_run r where r.tenant_id = p_tenant_id and r.producer_user_id = p.user_id and r.status <> 'void'
                   and r.period_start <= p_to and r.period_end >= p_from)
    from p join sums s on s.user_id = p.user_id
   where p.status <> 'invited'
   order by p.display_name;
$$;

-- ─── commit: the owner's decision per producer, recorded with the run ─────────────────────────────
-- p_decisions: [{ "producer_user_id": uuid, "mode": "pay_full"|"withhold"|"amount", "amount_cents": int?, "reason": text? }]
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
  v_out jsonb := '[]'::jsonb;
begin
  if coalesce(public.tenant_plan_audience(p_tenant_id), '') <> 'agency' then raise exception 'agency_plan_required' using errcode = 'P0001'; end if;
  if p_paid_on is null or length(btrim(coalesce(p_method, ''))) = 0 then raise exception 'payout_method_required' using errcode = 'P0001'; end if;
  if jsonb_typeof(coalesce(p_decisions, '[]'::jsonb)) <> 'array' or jsonb_array_length(p_decisions) = 0 then raise exception 'payout_no_producers' using errcode = 'P0001'; end if;

  for d in select (x->>'producer_user_id')::uuid as producer, coalesce(x->>'mode', 'pay_full') as mode,
                  nullif(x->>'amount_cents', '')::bigint as amount, nullif(btrim(coalesce(x->>'reason', '')), '') as reason
             from jsonb_array_elements(p_decisions) x
  loop
    if d.mode not in ('pay_full', 'withhold', 'amount') then raise exception 'payout_mode_unknown' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.producer p where p.tenant_id = p_tenant_id and p.user_id = d.producer and p.status <> 'invited') then
      raise exception 'payout_not_a_producer' using errcode = 'P0001';
    end if;
    -- builds the draft from the ledger (and refuses a period already run: one set of entries per producer and period)
    v_run := public.build_producer_run(p_tenant_id, d.producer, p_from, p_to, p_actor);
    select * into r from public.producer_payout_run where id = v_run;
    v_period := r.earned_cents + r.clawed_back_cents;
    v_net := case d.mode
               when 'pay_full' then greatest(v_period, 0)
               when 'withhold' then greatest(r.balance_before_cents + v_period, 0)
               else least(greatest(coalesce(d.amount, 0), 0), greatest(r.balance_before_cents + v_period, greatest(v_period, 0)))
             end;
    if d.mode = 'amount' and d.amount is null then raise exception 'payout_amount_required' using errcode = 'P0001'; end if;
    perform set_config('app.producer_writer', 'on', true);
    update public.producer_payout_run
       set net_cents = v_net,
           withheld_cents = greatest(greatest(v_period, 0) - v_net, 0),
           balance_after_cents = r.balance_before_cents + r.earned_cents + r.clawed_back_cents - v_net,
           decision_mode = d.mode, decision_reason = d.reason, decision_amount_cents = d.amount
     where id = v_run;
    perform set_config('app.producer_writer', '', true);
    perform public.publish_producer_run(p_tenant_id, v_run, p_actor);
    if v_net > 0 then
      perform public.mark_producer_run_paid(p_tenant_id, v_run, p_paid_on, p_method, p_reference);
    end if;
    v_out := v_out || jsonb_build_object('producer_user_id', d.producer, 'run_id', v_run, 'net_cents', v_net, 'mode', d.mode);
  end loop;
  return v_out;
end;
$$;
revoke all on function public.agency_payout_preview(uuid, date, date), public.agency_payout_commit(uuid, date, date, jsonb, date, text, text, uuid) from public, anon, authenticated;
grant execute on function public.agency_payout_preview(uuid, date, date), public.agency_payout_commit(uuid, date, date, jsonb, date, text, text, uuid) to service_role;

-- ─── self-check ───────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if pg_get_functiondef('public.build_producer_run(uuid,uuid,date,date,uuid)'::regprocedure) not like '%/* AG-1.7 */%' then
    raise exception 'AG-1.7: the run builder does not read the agency ledger';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'producer_run_one_live') then
    raise exception 'AG-1.7: nothing stops a period being paid twice';
  end if;
  if pg_get_functiondef('public.agency_payout_preview(uuid,date,date)'::regprocedure) ~* 'insert into|update public' then
    raise exception 'AG-1.7: the preview writes';
  end if;
end;
$$;
