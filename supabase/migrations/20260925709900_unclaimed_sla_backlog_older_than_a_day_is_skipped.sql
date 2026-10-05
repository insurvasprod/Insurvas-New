-- ---------------------------------------------------------------------------
-- Unclaimed SLA · a side effect older than a day is recorded as skipped, never sent (LA-1.23, W5)
--
-- The ladder has run in the database every minute since 20260924250100, but its side effects (the
-- owner's escalation alert, the partner's notice, the nurture lead on expiry) only happen when the
-- app runs lib/queueSla, and nothing hosts that. So tenant_lead_sla_events has piled up: on
-- 2026-09-25 about 34,700 rows had processed_at null across 11 tenants, 34,613 of them more than
-- 24 hours old (most from two QA tenants that seeded thousands of transfers).
--
-- User decision (2026-09-25): mark every side effect older than 24 hours as skipped, recorded and
-- not sent, and from then on run the side effects from pg_cron every minute (20260925709910).
-- A day-old "this lead needs attention" is news about nobody, and sending thousands at once would
-- bury today's real alerts.
--
-- This file
--   1. adds what the side-effect job records on each event
--        handled_by      'database' (pg_cron) or 'app' (lib/queueSla) or 'skipped'
--        skipped_reason  why nothing was sent: older_than_24_hours, no_longer_unclaimed,
--                        gave_up_after_failures
--        outcome         what was done, as counts, so a reader can see nothing was sent
--        email_due_at / email_done_at / email_outcome
--                        the escalation email stays with the app job. The database marks it
--                        owed, the app sends it and says what happened.
--   2. skips the backlog. Each skipped row keeps its rung, times and ids, gets processed_at and
--      skipped_reason 'older_than_24_hours', and no other table is written except one audit row per
--      tenant with the count. The check block below proves no alert, partner message, partner
--      alert or nurture work item was written by it.
--
-- Additive. Re-running it skips only what has become more than a day old since.
--
-- Reviewed against the live catalog on 2026-09-29: tenant_lead_sla_events had none of these columns
-- and no trigger (so an UPDATE of it can write nothing else), and 34,735 events were pending, every
-- one older than 24 hours. The skip is one statement whose per-tenant counts are collected first and
-- then written to the audit log, rather than a loop over a data-modifying WITH.
-- ---------------------------------------------------------------------------

alter table public.tenant_lead_sla_events
  add column if not exists handled_by text,
  add column if not exists skipped_reason text,
  add column if not exists outcome jsonb not null default '{}'::jsonb,
  add column if not exists email_due_at timestamptz,
  add column if not exists email_done_at timestamptz,
  add column if not exists email_outcome text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.tenant_lead_sla_events'::regclass
                  and conname = 'tenant_lead_sla_events_handled_by_check') then
    alter table public.tenant_lead_sla_events
      add constraint tenant_lead_sla_events_handled_by_check
      check (handled_by is null or handled_by in ('database', 'app', 'skipped'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.tenant_lead_sla_events'::regclass
                  and conname = 'tenant_lead_sla_events_skipped_reason_check') then
    alter table public.tenant_lead_sla_events
      add constraint tenant_lead_sla_events_skipped_reason_check
      check (skipped_reason is null or skipped_reason in ('older_than_24_hours', 'no_longer_unclaimed', 'gave_up_after_failures'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.tenant_lead_sla_events'::regclass
                  and conname = 'tenant_lead_sla_events_email_outcome_check') then
    alter table public.tenant_lead_sla_events
      add constraint tenant_lead_sla_events_email_outcome_check
      check (email_outcome is null or char_length(email_outcome) between 1 and 200);
  end if;
end $$;

-- The app's email pass reads the owed escalation emails by this.
create index if not exists tenant_lead_sla_events_email_due_idx
  on public.tenant_lead_sla_events (email_due_at)
  where email_due_at is not null and email_done_at is null;

grant select, insert, update on public.tenant_lead_sla_events to service_role;

-- ── the backlog ────────────────────────────────────────────────────────────
-- Only the owner role runs this part. The parse check (tenant_app) skips it.
do $$
declare
  r record;
  v_rows jsonb;
  v_total integer := 0;
  v_alerts_before bigint;
  v_messages_before bigint;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709900: backlog skip not run, % cannot create in public', current_user;
    return;
  end if;

  -- The skip only marks events. It can write nowhere else because nothing fires on the table: a
  -- trigger added here later would have to be reviewed against this rule first.
  if exists (select 1 from pg_trigger where tgrelid = 'public.tenant_lead_sla_events'::regclass and not tgisinternal) then
    raise exception 'tenant_lead_sla_events has a trigger; review it before skipping the backlog';
  end if;

  -- The only writers of these keys are the SLA side effects (lib/queueSla, 20260925709910).
  select count(*) into v_alerts_before from public.agent_notifications where source_key like 'unclaimed-sla:%';
  select count(*) into v_messages_before from public.partner_messages where event_key like 'unclaimed-sla:%';

  with skipped as (
    update public.tenant_lead_sla_events e
       set processed_at = now(),
           handled_by = 'skipped',
           skipped_reason = 'older_than_24_hours',
           outcome = jsonb_build_object('sent', false, 'skippedAt', now()),
           last_error = null
     where e.processed_at is null
       and e.occurred_at < now() - interval '24 hours'
    returning e.tenant_id, e.rung
  ), counted as (
    select s.tenant_id,
           count(*)::integer as skipped,
           count(*) filter (where s.rung = 'warn')::integer as warn,
           count(*) filter (where s.rung = 'escalate')::integer as escalate,
           count(*) filter (where s.rung = 'partner')::integer as partner,
           count(*) filter (where s.rung = 'expire')::integer as expire
      from skipped s
     group by s.tenant_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('tenant_id', c.tenant_id, 'name', t.name, 'skipped', c.skipped,
                                               'warn', c.warn, 'escalate', c.escalate, 'partner', c.partner,
                                               'expire', c.expire) order by c.skipped desc), '[]'::jsonb)
    into v_rows
    from counted c
    left join public.tenants t on t.id = c.tenant_id;

  for r in
    select * from jsonb_to_recordset(v_rows)
      as x(tenant_id uuid, name text, skipped integer, warn integer, escalate integer, partner integer, expire integer)
  loop
    v_total := v_total + r.skipped;
    raise notice '20260925709900: tenant % (%) skipped % (warn %, escalate %, partner %, expire %)',
      r.tenant_id, coalesce(r.name, '?'), r.skipped, r.warn, r.escalate, r.partner, r.expire;
    insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
    values ('system', null, 'tenant.lead_sla_backlog_skipped', 'tenant', r.tenant_id::text,
            jsonb_build_object('tenantId', r.tenant_id, 'skipped', r.skipped, 'olderThanHours', 24,
                               'byRung', jsonb_build_object('warn', r.warn, 'escalate', r.escalate,
                                                            'partner', r.partner, 'expire', r.expire),
                               'sent', false));
  end loop;
  raise notice '20260925709900: % side effects older than 24 hours skipped, none sent', v_total;

  -- Nothing was sent: no SLA alert and no partner notice was written by the skip.
  if (select count(*) from public.agent_notifications where source_key like 'unclaimed-sla:%') <> v_alerts_before
     or (select count(*) from public.partner_messages where event_key like 'unclaimed-sla:%') <> v_messages_before then
    raise exception 'the backlog skip wrote a side effect; it must only mark events';
  end if;
  if exists (select 1 from public.tenant_lead_sla_events
              where processed_at is null and occurred_at < now() - interval '24 hours') then
    raise exception 'an unprocessed SLA event older than 24 hours is left';
  end if;
end $$;

-- ── check ──────────────────────────────────────────────────────────────────
do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709900: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'tenant_lead_sla_events'
         and column_name in ('handled_by', 'skipped_reason', 'outcome', 'email_due_at', 'email_done_at', 'email_outcome')) <> 6 then
    raise exception '20260925709900 check failed: a tenant_lead_sla_events column is missing';
  end if;
  if (select count(*) from pg_constraint where conrelid = 'public.tenant_lead_sla_events'::regclass
       and conname in ('tenant_lead_sla_events_handled_by_check', 'tenant_lead_sla_events_skipped_reason_check',
                       'tenant_lead_sla_events_email_outcome_check')) <> 3 then
    raise exception '20260925709900 check failed: a tenant_lead_sla_events check constraint is missing';
  end if;
  if to_regclass('public.tenant_lead_sla_events_email_due_idx') is null then
    raise exception '20260925709900 check failed: tenant_lead_sla_events_email_due_idx is missing';
  end if;
  if exists (select 1 from public.tenant_lead_sla_events where skipped_reason is not null and processed_at is null) then
    raise exception '20260925709900 check failed: a skipped event is not marked processed';
  end if;
  raise notice '20260925709900: columns, constraints and index present; no day-old event left pending';
end $$;
