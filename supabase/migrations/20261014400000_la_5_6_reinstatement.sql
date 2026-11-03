-- LA-5.6 (Notion sprint, Module 5 — Retention) · reinstatement: bring a lapsed policy back before
-- the carrier's window closes, with the deadline impossible to miss.
--
--   reinstatement_case   one per lapse (tenant, carrier, policy, lapsed_on). lapsed_on is LA-4.7's,
--                        from the change log — the file pair that showed the lapse, never the file's
--                        date. window_days is the carrier's reinstatement rule (LA-4.17: the agency's
--                        own unless cleared, else the platform's); deadline = lapsed_on + window.
--                        With NO window configured the deadline is NULL — never guessed — and the case
--                        sorts into its own labelled group (as LA-4.16 does).
--                        What the carrier needs (amount owed, health questions, a signed form) is what
--                        the agent was told; the app shows an ESTIMATE until it is entered.
--
--   identified → contacted → client_agreed → submitted → reinstated
--                                (or declined_by_client / declined_by_carrier, each with a reason; or expired)
--
--   sync_reinstatement_cases   the only thing that opens a case, marks it reinstated (the newest
--                        carrier file shows the policy back in force — the file proves it, not a call)
--                        or expired (the window closed: counted apart, a process failure to see), and
--                        alerts as the deadline nears: 14, 7 and 3 days by default (LA-5.11), one alert
--                        per threshold, to whoever works the case, else the writing agent, else the
--                        agency's owner. After each policy file and daily (pg_cron).
--
-- Also on retention_settings (LA-5.11): reinstatement_amber_days 14, reinstatement_red_days 7,
-- reinstatement_pin_days 3.
--
-- Additive. Requires 20261014100000 (retention_settings), 20261008160000 (policy_current) and
-- 20261008150000 (carrier_retention_rule).
--
-- Rollback:
--   select cron.unschedule('la5-reinstatement-daily');
--   drop function if exists public.sync_reinstatement_cases(uuid);
--   drop table if exists public.reinstatement_case;
--   drop function if exists public.reinstatement_case_guard();
--   alter table public.retention_settings drop column if exists reinstatement_amber_days,
--     drop column if exists reinstatement_red_days, drop column if exists reinstatement_pin_days;

alter table public.retention_settings add column if not exists reinstatement_amber_days smallint not null default 14;
alter table public.retention_settings add column if not exists reinstatement_red_days smallint not null default 7;
alter table public.retention_settings add column if not exists reinstatement_pin_days smallint not null default 3;
alter table public.retention_settings drop constraint if exists retention_settings_reinstatement_days;
alter table public.retention_settings add constraint retention_settings_reinstatement_days check (
  reinstatement_pin_days between 1 and 30 and reinstatement_red_days > reinstatement_pin_days and reinstatement_amber_days > reinstatement_red_days and reinstatement_amber_days <= 90
);

create table if not exists public.reinstatement_case (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agency_id uuid,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  policy_number text not null,
  contact_id uuid references public.contacts(id) on delete set null,
  lapsed_on date not null,
  window_days integer,
  deadline date,

  -- what the carrier needs: what the agent was told (null until entered)
  amount_owed_cents bigint,
  months_owed integer,
  requires_health_questions boolean,
  requires_signed_form boolean,
  carrier_requirements_note text,

  status text not null default 'identified',
  contacted_at timestamptz,
  agreed_at timestamptz,
  submitted_at timestamptz,
  resolved_at timestamptz,
  decline_reason text,
  carrier_reference text,
  worked_by uuid references public.users(id) on delete set null,
  note text,
  alerted_days integer[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint reinstatement_case_one_per_lapse unique (tenant_id, carrier_id, policy_number, lapsed_on),
  constraint reinstatement_case_status check (status in ('identified', 'contacted', 'client_agreed', 'submitted', 'reinstated', 'declined_by_client', 'declined_by_carrier', 'expired')),
  -- A deadline is the window from the real lapse date, or nothing: never guessed.
  constraint reinstatement_case_deadline check ((window_days is null and deadline is null) or (window_days is not null and deadline = lapsed_on + window_days)),
  constraint reinstatement_case_window check (window_days is null or window_days between 0 and 730),
  constraint reinstatement_case_resolved check ((status in ('reinstated', 'declined_by_client', 'declined_by_carrier', 'expired')) = (resolved_at is not null)),
  constraint reinstatement_case_declined check ((status in ('declined_by_client', 'declined_by_carrier')) = (decline_reason is not null)),
  constraint reinstatement_case_amount check (amount_owed_cents is null or amount_owed_cents between 0 and 100000000),
  constraint reinstatement_case_months check (months_owed is null or months_owed between 0 and 60),
  constraint reinstatement_case_lengths check (
    (note is null or char_length(note) <= 2000) and (carrier_requirements_note is null or char_length(carrier_requirements_note) <= 1000)
    and (carrier_reference is null or char_length(carrier_reference) <= 120) and (decline_reason is null or char_length(btrim(decline_reason)) between 3 and 500)
  )
);
create index if not exists reinstatement_case_open_idx on public.reinstatement_case (tenant_id, deadline) where status in ('identified', 'contacted', 'client_agreed', 'submitted');
create index if not exists reinstatement_case_recent_idx on public.reinstatement_case (tenant_id, created_at desc);
create index if not exists reinstatement_case_carrier_idx on public.reinstatement_case (carrier_id);
create index if not exists reinstatement_case_contact_idx on public.reinstatement_case (contact_id) where contact_id is not null;
create index if not exists reinstatement_case_by_idx on public.reinstatement_case (worked_by) where worked_by is not null;

-- The ladder. A person moves a case forward or records a decline; reinstated and expired are the
-- sync's alone (it sets app.reinstatement_sync for its own transaction).
create or replace function public.reinstatement_case_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_sync boolean := coalesce(current_setting('app.reinstatement_sync', true), '') = 'on';
  v_open text[] := array['identified', 'contacted', 'client_agreed', 'submitted'];
begin
  if tg_op = 'DELETE' then
    raise exception 'A reinstatement case is never removed.' using errcode = 'P0001';
  end if;
  if (new.tenant_id, new.carrier_id, new.policy_number, new.lapsed_on, new.window_days, new.deadline, new.created_at)
     is distinct from (old.tenant_id, old.carrier_id, old.policy_number, old.lapsed_on, old.window_days, old.deadline, old.created_at) then
    raise exception 'A case''s policy, lapse date and deadline never change.' using errcode = 'P0001';
  end if;
  if new.alerted_days is distinct from old.alerted_days and not v_sync then
    raise exception 'Only the daily check records its alerts.' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status then
    if not (old.status = any (v_open)) then
      raise exception 'A % case is closed.', old.status using errcode = 'P0001';
    end if;
    if new.status in ('reinstated', 'expired') then
      if not v_sync then
        raise exception 'Only the carrier file says a policy is reinstated, and only the calendar says a window closed.' using errcode = 'P0001';
      end if;
    elsif new.status in ('declined_by_client', 'declined_by_carrier') then
      null;
    elsif array_position(v_open, new.status) is null or array_position(v_open, new.status) < array_position(v_open, old.status) then
      raise exception 'A reinstatement case cannot go from % to %.', old.status, new.status using errcode = 'P0001';
    end if;
  elsif not (old.status = any (v_open)) and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') and not v_sync then
    raise exception 'A % case is closed.', old.status using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists reinstatement_case_guard on public.reinstatement_case;
create trigger reinstatement_case_guard before update or delete on public.reinstatement_case
  for each row execute function public.reinstatement_case_guard();

-- ─── the sync: open, reinstate, expire, alert ───────────────────────────────────────────────────
create or replace function public.sync_reinstatement_cases(p_tenant_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_opened integer := 0;
  v_reinstated integer := 0;
  v_expired integer := 0;
  v_alerts integer := 0;
  r record;
  v_crossed integer[];
  v_new integer[];
  v_recipient uuid;
  v_days integer;
begin
  perform set_config('app.reinstatement_sync', 'on', true);

  -- 1. Open a case for every lapse inside its carrier window. With no window configured, only a lapse
  --    the newest file brought (nothing is invented about an old one).
  with lapses as (
    select pc.tenant_id, pc.agency_id, pc.carrier_id, pc.policy_number, pc.contact_id, pc.lapsed_on, pc.last_snapshot_date,
           (select case when own.cleared then plat.window_days else coalesce(own.window_days, plat.window_days) end
              from (select 1) one
              left join lateral (
                select r1.window_days, r1.cleared from public.carrier_retention_rule r1
                 where r1.tenant_id = pc.tenant_id and r1.carrier_id = pc.carrier_id and r1.rule_type = 'reinstatement' and r1.effective_from <= current_date
                 order by r1.effective_from desc, r1.created_at desc limit 1) own on true
              left join lateral (
                select r2.window_days from public.carrier_retention_rule r2
                 where r2.tenant_id is null and r2.carrier_id = pc.carrier_id and r2.rule_type = 'reinstatement' and r2.effective_from <= current_date
                 order by r2.effective_from desc, r2.created_at desc limit 1) plat on true) as window_days
      from public.policy_current pc
     where pc.status_normalized = 'lapsed' and pc.lapsed_on is not null
       and (p_tenant_id is null or pc.tenant_id = p_tenant_id)
  ), opened as (
    insert into public.reinstatement_case (tenant_id, agency_id, carrier_id, policy_number, contact_id, lapsed_on, window_days, deadline)
    select l.tenant_id, l.agency_id, l.carrier_id, l.policy_number, l.contact_id, l.lapsed_on, l.window_days, l.lapsed_on + l.window_days
      from lapses l
     where (l.window_days is not null and l.lapsed_on + l.window_days >= current_date)
        or (l.window_days is null and l.lapsed_on = l.last_snapshot_date)
    on conflict (tenant_id, carrier_id, policy_number, lapsed_on) do nothing
    returning 1
  )
  select count(*) into v_opened from opened;

  -- 2. Reinstated: a newer file shows the policy back in force. The file proves it, not a call.
  with back as (
    update public.reinstatement_case c set status = 'reinstated', resolved_at = now()
      from public.policy_current pc
     where c.status in ('identified', 'contacted', 'client_agreed', 'submitted')
       and (p_tenant_id is null or c.tenant_id = p_tenant_id)
       and pc.tenant_id = c.tenant_id and pc.carrier_id = c.carrier_id and pc.policy_number = c.policy_number
       and pc.status_normalized in ('active', 'at_risk', 'paid_up')
       and pc.last_snapshot_date > c.lapsed_on
    returning 1
  )
  select count(*) into v_reinstated from back;

  -- 3. Expired: the window closed. Counted apart from declines.
  with gone as (
    update public.reinstatement_case c set status = 'expired', resolved_at = now()
     where c.status in ('identified', 'contacted', 'client_agreed', 'submitted')
       and (p_tenant_id is null or c.tenant_id = p_tenant_id)
       and c.deadline is not null and c.deadline < current_date
    returning 1
  )
  select count(*) into v_expired from gone;

  -- 4. Alerts as the deadline nears: once per threshold; a case found already late gets one alert, for the nearest.
  for r in
    select c.*, coalesce(rs.reinstatement_amber_days, 14) as amber, coalesce(rs.reinstatement_red_days, 7) as red, coalesce(rs.reinstatement_pin_days, 3) as pin, pc.agent_user_id
      from public.reinstatement_case c
      left join public.retention_settings rs on rs.tenant_id = c.tenant_id
      left join public.policy_current pc on pc.tenant_id = c.tenant_id and pc.carrier_id = c.carrier_id and pc.policy_number = c.policy_number
     where c.status in ('identified', 'contacted', 'client_agreed', 'submitted')
       and (p_tenant_id is null or c.tenant_id = p_tenant_id)
       and c.deadline is not null
       and c.deadline - current_date <= coalesce(rs.reinstatement_amber_days, 14)
  loop
    v_days := r.deadline - current_date;
    v_crossed := array(select t from unnest(array[r.amber, r.red, r.pin]) t where v_days <= t);
    v_new := array(select t from unnest(v_crossed) t where not (t = any (r.alerted_days)));
    if cardinality(v_new) = 0 then continue; end if;

    select tu.user_id into v_recipient from public.tenant_users tu join public.users u on u.id = tu.user_id
     where tu.tenant_id = r.tenant_id and u.status = 'active' and tu.user_id = coalesce(r.worked_by, r.agent_user_id) and tu.role::text in ('owner', 'producer');
    if v_recipient is null then
      select tu.user_id into v_recipient from public.tenant_users tu join public.users u on u.id = tu.user_id
       where tu.tenant_id = r.tenant_id and tu.role::text = 'owner' and u.status = 'active'
       order by tu.accepted_at nulls last, tu.invited_at nulls last, tu.user_id limit 1;
    end if;
    if v_recipient is not null then
      insert into public.agent_notifications (tenant_id, recipient_user_id, kind, title, body, link, source_key)
      values (r.tenant_id, v_recipient, 'reinstatement_closing',
              case when v_days <= 0 then 'Reinstatement window closes today: ' || r.policy_number
                   else 'Reinstatement window closes in ' || v_days || (case when v_days = 1 then ' day: ' else ' days: ' end) || r.policy_number end,
              'Policy ' || r.policy_number || ' lapsed on ' || to_char(r.lapsed_on, 'FMDD Mon') || '. The carrier stops taking it back after ' || to_char(r.deadline, 'FMDD Mon') || '. After that it is gone for good.',
              '/app/reinstatement', 'reinstatement:' || r.id || ':' || (select min(t) from unnest(v_new) t))
      on conflict (tenant_id, recipient_user_id, source_key) do nothing;
      v_alerts := v_alerts + 1;
    end if;
    update public.reinstatement_case set alerted_days = (select array_agg(distinct t order by t) from unnest(r.alerted_days || v_crossed) t) where id = r.id;
  end loop;

  return jsonb_build_object('opened', v_opened, 'reinstated', v_reinstated, 'expired', v_expired, 'alerts', v_alerts);
end;
$$;

-- ─── access ─────────────────────────────────────────────────────────────────────────────────────
alter table public.reinstatement_case enable row level security;
drop policy if exists reinstatement_case_read on public.reinstatement_case;
create policy reinstatement_case_read on public.reinstatement_case for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.reinstatement_case from public, anon, authenticated;
-- Cases are opened by the sync; the app moves them along.
grant select, update on public.reinstatement_case to service_role;
revoke insert, delete, truncate on public.reinstatement_case from service_role, tenant_app;
revoke update on public.reinstatement_case from tenant_app;
grant select on public.reinstatement_case to tenant_app;
revoke all on function public.sync_reinstatement_cases(uuid) from public, anon, authenticated;
grant execute on function public.sync_reinstatement_cases(uuid) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('la5-reinstatement-daily', '45 7 * * *', $cron$select public.sync_reinstatement_cases()$cron$);
    exception when others then
      raise notice '20261014400000: the daily reinstatement check could not be scheduled (%).', sqlerrm;
    end;
  end if;
end $$;

-- ─── self-check ─────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v jsonb;
begin
  -- Run the job once, as cron will, and roll it back.
  begin
    v := public.sync_reinstatement_cases();
    if v ? 'opened' is not true then
      raise exception '20261014400000: the reinstatement check did not report';
    end if;
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  if has_table_privilege('service_role', 'public.reinstatement_case', 'INSERT') or has_table_privilege('service_role', 'public.reinstatement_case', 'DELETE') then
    raise exception '20261014400000: only the sync opens a case, and none is removed (service_role insert=%, delete=%)',
      has_table_privilege('service_role', 'public.reinstatement_case', 'INSERT'), has_table_privilege('service_role', 'public.reinstatement_case', 'DELETE');
  end if;
end $$;
