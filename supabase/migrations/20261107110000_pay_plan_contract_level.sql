-- Team payouts, follow-up to 20261107100000 (2026-11-07).
--
-- 1. "As before: by contract level" as a pay plan (model 'contract_level'). Plans are dated and never deleted, so
--    without it a person, once on a plan, could never be switched back to AG-1.3's contract-level ratio. The
--    commission writer treats it exactly like having no plan.
-- 2. adjust_producer_balance: a correction to a team member's balance, with a reason and who made it — the ledger's
--    own rule ("a correction is an adjustment", LA-7.5), for a bonus or base pay posted by mistake. The application
--    cannot insert into the ledger directly (revoked in 20261015250000), so this is the one door for it.
--
-- Requires 20261107100000.
-- Rollback: restore producer_pay_plan_model / producer_pay_plan_shape from 20261107100000 (after moving any
--   contract_level rows), put back "and v_plan.model is null; /* pay plans */" in agency_ledger_sync, and
--   drop function adjust_producer_balance(uuid, uuid, bigint, date, text, uuid).

alter table public.producer_pay_plan drop constraint if exists producer_pay_plan_model;
alter table public.producer_pay_plan add constraint producer_pay_plan_model check (model in ('solo_owner', 'sidekick', 'salary_bonus', 'big_split', 'contract_level'));
alter table public.producer_pay_plan drop constraint if exists producer_pay_plan_shape;
alter table public.producer_pay_plan add constraint producer_pay_plan_shape check (
  (model = 'solo_owner' and base_cents = 0 and app_bonus_cents = 0 and save_fee_cents = 0 and sales_pct_bp is null)
  or (model = 'sidekick' and base_cents = 0 and app_bonus_cents = 0 and sales_pct_bp is null)
  or (model = 'salary_bonus' and sales_pct_bp is not null and save_fee_cents = 0)
  or (model = 'big_split' and sales_pct_bp is not null and base_cents = 0 and app_bonus_cents = 0 and save_fee_cents = 0 and chargebacks_apply)
  or (model = 'contract_level' and base_cents = 0 and app_bonus_cents = 0 and save_fee_cents = 0 and sales_pct_bp is null and chargebacks_apply));

-- The writer: a writer on 'contract_level' with no levels is skipped, as a writer with no plan is (absent, not guessed).
do $$
declare
  v_def text := pg_get_functiondef('public.agency_ledger_sync(uuid)'::regprocedure);
  a_old constant text := 'and v_plan.model is null; /* pay plans */';
  a_new constant text := 'and coalesce(v_plan.model, ''contract_level'') = ''contract_level''; /* pay plans */ /* contract level */';
begin
  if position('/* contract level */' in v_def) > 0 then return; end if;
  if position(a_old in v_def) = 0 then raise exception 'Pay plan contract level: agency_ledger_sync anchor not found (is 20261107100000 applied?)'; end if;
  execute replace(v_def, a_old, a_new);
end;
$$;

create or replace function public.adjust_producer_balance(p_tenant_id uuid, p_producer uuid, p_amount_cents bigint, p_on date, p_reason text, p_by uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_by is null then raise exception 'adjust_producer_balance: a correction is made by a named person' using errcode = '22023'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then raise exception 'adjust_producer_balance: say why' using errcode = '22023'; end if;
  if p_amount_cents is null or p_amount_cents = 0 or abs(p_amount_cents) > 100000000 then raise exception 'adjust_producer_balance: enter an amount' using errcode = '22023'; end if;
  if not exists (select 1 from public.producer p where p.tenant_id = p_tenant_id and p.user_id = p_producer) then
    raise exception 'adjust_producer_balance: % is not on this team', p_producer using errcode = 'P0002';
  end if;
  insert into public.producer_ledger_entry (tenant_id, agency_id, producer_user_id, entry_type, basis, amount_cents, occurred_on, reason, created_by)
  values (p_tenant_id, (select id from public.agency where tenant_id = p_tenant_id), p_producer, 'adjustment', 'reported', p_amount_cents, coalesce(p_on, current_date), left(btrim(p_reason), 500), p_by)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.adjust_producer_balance(uuid, uuid, bigint, date, text, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.adjust_producer_balance(uuid, uuid, bigint, date, text, uuid) to service_role;

do $$
begin
  if pg_get_functiondef('public.agency_ledger_sync(uuid)'::regprocedure) not like '%/* contract level */%' then
    raise exception 'Pay plan contract level: the commission writer still treats contract_level as a plan';
  end if;
end;
$$;
