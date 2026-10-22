-- LA-4.16 (Notion sprint) · the retention board: who to phone today, in what order.
--
-- The board itself is computed from LA-4.7's policy_current and the carrier rules (LA-4.17); nothing
-- on it is a prediction. What is stored is what the agent DID, and what then happened:
--
--   retention_action   one row per logged call: the reason the policy was on the board, the outcome
--                      (promised to pay, refused, voicemail, wrong number, already paid, converting to
--                      bank draft), who and when, and board_state — what the board claimed at that
--                      moment (days left, days past due, paid-to, advance at risk), as of the file
--                      dated board_snapshot_date. Never edited or removed.
--   evaluate_retention_actions   when a newer carrier file arrives, marks each call from the DATA:
--                      paid-to moved past what the board saw → saved; the policy lapsed or was not
--                      taken → lost; otherwise still at risk (re-marked on later files). Runs after
--                      every policy file and daily.
--
-- Additive. Requires 20261008160000 (policy_current).
--
-- Rollback:
--   select cron.unschedule('la4-retention-results-daily');
--   drop function if exists public.evaluate_retention_actions(uuid);
--   drop table if exists public.retention_action;

create table if not exists public.retention_action (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  policy_number text not null,
  reason text not null,
  outcome text not null,
  note text,
  acted_by uuid references public.users(id) on delete set null,
  acted_at timestamptz not null default now(),
  board_snapshot_date date,
  board_state jsonb not null default '{}'::jsonb,
  result text,
  result_at timestamptz,
  result_snapshot_date date,
  constraint retention_action_reason check (reason in ('first_payment_missed', 'bounced_draft', 'later_payment_missed', 'conservation', 'cancellation_request', 'recently_lapsed', 'direct_bill')),
  constraint retention_action_outcome check (outcome in ('promised_to_pay', 'refused', 'voicemail', 'wrong_number', 'already_paid', 'converting_to_draft')),
  constraint retention_action_result check (result is null or result in ('saved', 'still_at_risk', 'lost')),
  constraint retention_action_result_dated check ((result is null) = (result_at is null) and (result is null) = (result_snapshot_date is null)),
  constraint retention_action_note check (note is null or char_length(note) <= 2000),
  constraint retention_action_state check (jsonb_typeof(board_state) = 'object')
);
create index if not exists retention_action_policy_idx on public.retention_action (tenant_id, carrier_id, policy_number, acted_at desc);
create index if not exists retention_action_open_idx on public.retention_action (tenant_id) where result is null or result = 'still_at_risk';
create index if not exists retention_action_carrier_idx on public.retention_action (carrier_id);
create index if not exists retention_action_acted_by_idx on public.retention_action (acted_by) where acted_by is not null;

-- What the agent did is a record: only the result moves, and only by the function below.
create or replace function public.retention_action_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A logged retention call is never removed.' using errcode = 'P0001';
  end if;
  if (new.tenant_id, new.carrier_id, new.policy_number, new.reason, new.outcome, new.note, new.acted_by, new.acted_at, new.board_snapshot_date, new.board_state)
     is distinct from (old.tenant_id, old.carrier_id, old.policy_number, old.reason, old.outcome, old.note, old.acted_by, old.acted_at, old.board_snapshot_date, old.board_state) then
    raise exception 'A logged retention call never changes; log another.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists retention_action_guard on public.retention_action;
create trigger retention_action_guard before update or delete on public.retention_action
  for each row execute function public.retention_action_guard();

create or replace function public.evaluate_retention_actions(p_tenant_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_saved integer := 0;
  v_lost integer := 0;
  v_still integer := 0;
begin
  with judged as (
    select a.id, pc.last_snapshot_date,
           case
             when pc.status_normalized in ('lapsed', 'not_taken') then 'lost'
             when pc.paid_to_date is not null and (a.board_state->>'paid_to' is null or pc.paid_to_date > (a.board_state->>'paid_to')::date) then 'saved'
             else 'still_at_risk'
           end as verdict
      from public.retention_action a
      join public.policy_current pc on pc.tenant_id = a.tenant_id and pc.carrier_id = a.carrier_id and pc.policy_number = a.policy_number
     where (p_tenant_id is null or a.tenant_id = p_tenant_id)
       and (a.result is null or a.result = 'still_at_risk')
       -- Only a file newer than the one the board was reading (and than the last verdict) decides.
       and pc.last_snapshot_date > coalesce(a.result_snapshot_date, a.board_snapshot_date, '-infinity'::date)
  ), upd as (
    update public.retention_action a set result = j.verdict, result_at = now(), result_snapshot_date = j.last_snapshot_date
      from judged j where a.id = j.id
    returning a.result
  )
  select count(*) filter (where result = 'saved'), count(*) filter (where result = 'lost'), count(*) filter (where result = 'still_at_risk')
    into v_saved, v_lost, v_still from upd;
  return jsonb_build_object('saved', v_saved, 'lost', v_lost, 'still_at_risk', v_still);
end;
$$;

-- ─── access ─────────────────────────────────────────────────────────────────────────────────────
alter table public.retention_action enable row level security;
drop policy if exists retention_action_read on public.retention_action;
create policy retention_action_read on public.retention_action for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.retention_action from public, anon, authenticated;
-- The app logs calls (insert) and reads them; results are the function's.
revoke update, delete, truncate on public.retention_action from service_role, tenant_app;
grant select, insert on public.retention_action to service_role;
grant select on public.retention_action to tenant_app;
revoke all on function public.evaluate_retention_actions(uuid) from public, anon, authenticated;
grant execute on function public.evaluate_retention_actions(uuid) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('la4-retention-results-daily', '0 7 * * *', $cron$select public.evaluate_retention_actions()$cron$);
    exception when others then
      raise notice '20261008260000: the daily retention check could not be scheduled (%).', sqlerrm;
    end;
  end if;
end $$;

do $$
declare
  v jsonb;
begin
  v := public.evaluate_retention_actions();
  if v ? 'saved' is not true then
    raise exception '20261008260000: the retention check did not report';
  end if;
  if has_table_privilege('service_role', 'public.retention_action', 'UPDATE') or has_table_privilege('service_role', 'public.retention_action', 'DELETE') then
    raise exception '20261008260000: logged calls must not be editable (service_role update=%, delete=%)',
      has_table_privilege('service_role', 'public.retention_action', 'UPDATE'), has_table_privilege('service_role', 'public.retention_action', 'DELETE');
  end if;
end $$;
