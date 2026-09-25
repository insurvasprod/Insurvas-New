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
  v_total integer := 0;
  v_alerts_before bigint;
  v_messages_before bigint;
  v_partner_alerts_before bigint;
  v_nurture_before bigint;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709900: backlog skip not run, % cannot create in public', current_user;
    return;
  end if;

  select count(*) into v_alerts_before from public.agent_notifications where source_key like 'unclaimed-sla:%';
  select count(*) into v_messages_before from public.partner_messages where event_key like 'unclaimed-sla:%';
  select count(*) into v_partner_alerts_before from public.partner_notifications;
  select count(*) into v_nurture_before from public.lead_queue where nurtured_from_work_item_id is not null;

  for r in
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
    )
    select s.tenant_id, t.name,
           count(*)::integer as skipped,
           count(*) filter (where s.rung = 'warn')::integer as warn,
           count(*) filter (where s.rung = 'escalate')::integer as escalate,
           count(*) filter (where s.rung = 'partner')::integer as partner,
           count(*) filter (where s.rung = 'expire')::integer as expire
      from skipped s
      left join public.tenants t on t.id = s.tenant_id
     group by s.tenant_id, t.name
     order by count(*) desc
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

  -- Nothing was sent: the skip wrote no alert, no partner message, no partner alert, no nurture item.
  if (select count(*) from public.agent_notifications where source_key like 'unclaimed-sla:%') <> v_alerts_before
     or (select count(*) from public.partner_messages where event_key like 'unclaimed-sla:%') <> v_messages_before
     or (select count(*) from public.partner_notifications) <> v_partner_alerts_before
     or (select count(*) from public.lead_queue where nurtured_from_work_item_id is not null) <> v_nurture_before then
    raise exception 'the backlog skip wrote a side effect; it must only mark events';
  end if;
  if exists (select 1 from public.tenant_lead_sla_events
              where processed_at is null and occurred_at < now() - interval '24 hours') then
    raise exception 'an unprocessed SLA event older than 24 hours is left';
  end if;
end $$;
