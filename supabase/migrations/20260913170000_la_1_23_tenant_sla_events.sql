-- LA-1.23: move the SLA event log off the CRM's table. The eighth and last collision.
--
-- Same rule as the other seven (SA-3, commit e7c00ee): this application's table moves, the CRM's does
-- not. Nothing outside this repository changes.
--
-- This one was the least mechanical of the eight, which is why backlog 182 left it for its own task.
-- The other seven disagreed with the CRM about a type or a foreign key. This one disagrees about
-- **which column carries the meaning**:
--
--   live (the CRM's)   rung integer NOT NULL  check (rung between 1 and 4)
--                      action text NOT NULL   check (action in ('notify','warn','escalate',
--                                                               'partner_notify','expire'))
--   declared (ours)    rung text NOT NULL     check (rung in ('warn','escalate','partner','expire'))
--
-- Both designs carry the same ladder. The CRM splits it into a numeric position plus a named action;
-- this repository puts the name in `rung` and has no `action` column at all. So the application
-- writes 'warn' into an integer and gets
--
--   22P02 invalid input syntax for type integer: "warn"
--
-- which is where verify-unclaimed-sla dies -- during setup, before a single check runs. And even if
-- rung were text, the CRM's `action` is NOT NULL and this application never sets it, so the insert
-- would fail anyway. There is no shape both products can share here without one of them changing,
-- and the CRM is not ours to change.
--
-- Ownership checked, not assumed: the live table has 0 rows, and 0 with a tenant_id. Nothing to
-- migrate, nothing of theirs to disturb. Note its lead_id already references agent_leads -- that was
-- 20260913120000 repointing a key on what turns out to be the CRM's table, which is worth knowing:
-- repointing looked like the fix at the time, and was really the CRM's constraint being edited.
--
-- ---------------------------------------------------------------------------------------------
-- The conflict target, which is a second defect and would have survived the rename.
--
-- run_unclaimed_sla is declared TWICE in this repository, and the corrective sorts EARLIER than the
-- file it corrects:
--
--   20260902202056_la_1_23_sla_conflict_target_fix.sql   on conflict on constraint <name>
--   20260903000000_la_1_23_unclaimed_sla.sql             on conflict (work_item_id, rung)
--
-- 20260903000000 applies last, so the fix has never been in effect. Its stated reason was that
-- PostgreSQL exposes work_item_id and rung as PL/pgSQL variables inside this function -- both are
-- output columns of its RETURNS TABLE -- making a column-list target ambiguous at runtime.
--
-- A third migration, 20260912210000, read the same statement differently: it treated the problem as a
-- missing unique index and created lead_sla_events_work_item_rung_idx to satisfy it. Two diagnoses of
-- one statement, neither aware of the other.
--
-- This migration does not adjudicate between them. The named-constraint form is correct under both
-- readings -- it is unambiguous whatever PL/pgSQL does with the identifiers, and it names an index
-- that certainly exists because the table below declares it inline. So the runner is carried forward
-- from 20260903000000 (the definition that actually applies) with the earlier file's conflict target
-- (the one that was right), which is the combination neither file had.
--
-- This matters for criterion 1 specifically -- "each rung fires exactly once per lead, proven by
-- running the job twice". That idempotency IS the upsert. A conflict target that cannot resolve does
-- not fire the rung twice; it raises 42P10 and takes the whole scheduler run with it.

create table if not exists public.tenant_lead_sla_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  work_item_id uuid not null references public.lead_queue(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  partner_id uuid references public.partners(id) on delete set null,
  rung text not null check (rung in ('warn', 'escalate', 'partner', 'expire')),
  occurred_at timestamptz not null default now(),
  claimed_at timestamptz,
  processed_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  unique (work_item_id, rung)
);

create index if not exists tenant_lead_sla_events_pending_idx
  on public.tenant_lead_sla_events (created_at asc) where processed_at is null;

alter table public.tenant_lead_sla_events enable row level security;

drop policy if exists tenant_lead_sla_events_scoped on public.tenant_lead_sla_events;
create policy tenant_lead_sla_events_scoped on public.tenant_lead_sla_events
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_lead_sla_events from anon, authenticated, public;
grant select on public.tenant_lead_sla_events to tenant_app;
grant select, insert, update on public.tenant_lead_sla_events to service_role;

-- claim_unclaimed_sla_events returns `setof public.lead_sla_events`, and a return type cannot be
-- changed by CREATE OR REPLACE -- it has to be dropped first.
drop function if exists public.claim_unclaimed_sla_events(integer);

create or replace function public.run_unclaimed_sla(p_now timestamptz default now(), p_limit integer default 500)
returns table (event_id uuid, tenant_id uuid, work_item_id uuid, lead_id uuid, partner_id uuid, rung text, occurred_at timestamptz)
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  item record; v_age integer; v_id uuid;
  v_warn integer; v_escalate integer; v_partner integer; v_expire integer;
begin
  for item in
    select q.*,
      coalesce(s.warn_after_seconds, 45) as warn_after,
      coalesce(s.escalate_after_seconds, 120) as escalate_after,
      coalesce(s.partner_notify_after_seconds, 300) as partner_after,
      coalesce(s.expire_after_seconds, 14400) as expire_after
    from public.lead_queue q
    left join public.tenant_queue_sla_settings s on s.tenant_id = q.tenant_id
    where q.status = 'unclaimed'
    order by q.queued_at asc
    limit greatest(1, least(coalesce(p_limit, 500), 1000))
    for update of q skip locked
  loop
    v_age := greatest(0, floor(extract(epoch from (p_now - item.queued_at)))::integer);
    v_warn := item.warn_after; v_escalate := item.escalate_after;
    v_partner := item.partner_after; v_expire := item.expire_after;

    if v_age >= v_warn and item.sla_warned_at is null then
      update public.lead_queue set sla_warned_at = p_now where id = item.id and status = 'unclaimed';
      v_id := null;
      insert into public.tenant_lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at)
      values (item.tenant_id, item.id, item.lead_id, item.partner_id, 'warn', p_now)
      on conflict on constraint tenant_lead_sla_events_work_item_id_rung_key do nothing returning id into v_id;
      insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
      values ('system', 'tenant.lead_sla_warned', 'lead_queue', item.id::text, jsonb_build_object('ageSeconds', v_age, 'thresholdSeconds', v_warn));
      if v_id is not null then return query select v_id, item.tenant_id, item.id, item.lead_id, item.partner_id, 'warn'::text, p_now; end if;
    end if;
    if v_age >= v_escalate and item.sla_escalated_at is null then
      update public.lead_queue set sla_escalated_at = p_now where id = item.id and status = 'unclaimed';
      v_id := null;
      insert into public.tenant_lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at)
      values (item.tenant_id, item.id, item.lead_id, item.partner_id, 'escalate', p_now)
      on conflict on constraint tenant_lead_sla_events_work_item_id_rung_key do nothing returning id into v_id;
      insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
      values ('system', 'tenant.lead_sla_escalated', 'lead_queue', item.id::text, jsonb_build_object('ageSeconds', v_age, 'thresholdSeconds', v_escalate));
      if v_id is not null then return query select v_id, item.tenant_id, item.id, item.lead_id, item.partner_id, 'escalate'::text, p_now; end if;
    end if;
    if v_age >= v_partner and item.sla_partner_notified_at is null then
      update public.lead_queue set sla_partner_notified_at = p_now where id = item.id and status = 'unclaimed';
      v_id := null;
      insert into public.tenant_lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at)
      values (item.tenant_id, item.id, item.lead_id, item.partner_id, 'partner', p_now)
      on conflict on constraint tenant_lead_sla_events_work_item_id_rung_key do nothing returning id into v_id;
      insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
      values ('system', 'tenant.lead_sla_partner_notified', 'lead_queue', item.id::text, jsonb_build_object('ageSeconds', v_age, 'thresholdSeconds', v_partner));
      if v_id is not null then return query select v_id, item.tenant_id, item.id, item.lead_id, item.partner_id, 'partner'::text, p_now; end if;
    end if;
    if v_age >= v_expire and item.sla_expired_at is null then
      update public.lead_queue set status = 'expired', sla_expired_at = p_now where id = item.id and status = 'unclaimed';
      if found then
        v_id := null;
        insert into public.tenant_lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at)
        values (item.tenant_id, item.id, item.lead_id, item.partner_id, 'expire', p_now)
        on conflict on constraint tenant_lead_sla_events_work_item_id_rung_key do nothing returning id into v_id;
        insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
        values ('system', 'tenant.lead_sla_expired', 'lead_queue', item.id::text, jsonb_build_object('ageSeconds', v_age, 'thresholdSeconds', v_expire));
        if v_id is not null then return query select v_id, item.tenant_id, item.id, item.lead_id, item.partner_id, 'expire'::text, p_now; end if;
      end if;
    end if;
  end loop;
end;
$$;

create or replace function public.claim_unclaimed_sla_events(p_limit integer default 500)
returns setof public.tenant_lead_sla_events language plpgsql security definer set search_path = public, pg_catalog as $$
declare e public.tenant_lead_sla_events;
begin
  for e in select * from public.tenant_lead_sla_events
    where processed_at is null and (claimed_at is null or claimed_at < now() - interval '10 minutes')
    order by created_at asc for update skip locked limit greatest(1, least(coalesce(p_limit, 500), 1000)) loop
    update public.tenant_lead_sla_events set claimed_at = now(), attempts = attempts + 1 where id = e.id returning * into e;
    return next e;
  end loop;
end;
$$;

revoke all on function public.run_unclaimed_sla(timestamptz, integer), public.claim_unclaimed_sla_events(integer) from public, anon, authenticated, tenant_app;
grant execute on function public.run_unclaimed_sla(timestamptz, integer), public.claim_unclaimed_sla_events(integer) to service_role;

do $$
declare
  probe record;
begin
  if to_regclass('public.tenant_lead_sla_events') is null then raise exception 'tenant_lead_sla_events was not created'; end if;

  -- rung must be text here. This is the whole collision in one assertion.
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'tenant_lead_sla_events' and column_name = 'rung') <> 'text' then
    raise exception 'tenant_lead_sla_events.rung is not text -- the collision is not resolved';
  end if;

  -- The named conflict target must exist, or the runner raises 42P10 on its first upsert and the
  -- whole scheduler run dies. Assert the constraint by the exact name the functions reference.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tenant_lead_sla_events'::regclass
      and conname = 'tenant_lead_sla_events_work_item_id_rung_key' and contype = 'u'
  ) then
    raise exception 'the idempotency constraint % is missing; run_unclaimed_sla cannot upsert', 'tenant_lead_sla_events_work_item_id_rung_key';
  end if;

  -- Neither function may still name the CRM's table.
  for probe in
    select p.proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('run_unclaimed_sla', 'claim_unclaimed_sla_events')
      and p.prosrc like '%public.lead_sla_events%'
  loop
    raise exception 'function % still writes the CRM lead_sla_events table', probe.proname;
  end loop;

  -- And the CRM's table is exactly as it was. This migration must only add.
  if to_regclass('public.lead_sla_events') is null then
    raise exception 'the CRM lead_sla_events table disappeared -- this migration must only add';
  end if;
  if (select count(*) from public.lead_sla_events) <> 0 then
    raise exception 'the CRM lead_sla_events table gained rows; it should be untouched';
  end if;
end;
$$;
