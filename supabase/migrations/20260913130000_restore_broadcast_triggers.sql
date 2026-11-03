-- Two Realtime broadcasts that fire from nothing.
--
-- Four broadcast_* functions exist in this database. Two are wired to triggers and two are not:
--
--   broadcast_la_1_15_floor_change   4 triggers   LA-1.15 works
--   broadcast_partner_message        1 trigger    restored by 20260912470000
--   broadcast_partner_lead_change    NONE         LA-1.17
--   broadcast_agent_notification     NONE         LA-1.21
--
-- Both triggers are declared in this repository and neither is here:
--
--   lead_queue_partner_pipeline_broadcast  on lead_queue    20260903090000
--   agent_notifications_broadcast          on agent_notifications  20260902170000
--
-- Same pattern as LA-1.16's five, and as tenants_seed_pipelines before that: the function survived
-- the reconciliation and the trigger did not, so the code looks complete and fires for nothing.
--
-- What it costs. LA-1.17's third acceptance criterion is "the board reflects a disposition within
-- seconds of the agent recording it". Without lead_queue_partner_pipeline_broadcast the partner's
-- board is only ever as fresh as its last manual load -- the disposition lands in the database and
-- no signal goes out, so the screen this task exists to provide ("the screen that stops the daily
-- 'what happened to mine' message") silently returns to being a page you refresh and hope.
--
-- LA-1.21's agent notifications have the same shape: the row is written, nothing is broadcast, and
-- a mention reaches the teammate whenever they next reload.
--
-- Neither gap is visible from the application. A broadcast that never fires raises nothing, logs
-- nothing and fails no request -- it is the quietest member of the family of defects this module
-- keeps producing. LA-1.15's suite proves the technique works when the trigger is present: its
-- "database change reaches every open floor in under one second" measures a real event arriving.
--
-- Both definitions below are this repository's, unchanged -- the same columns, the same timing.

drop trigger if exists lead_queue_partner_pipeline_broadcast on public.lead_queue;
create trigger lead_queue_partner_pipeline_broadcast
after insert or update of stage_id, status, disposition, disposition_at, updated_at on public.lead_queue
for each row execute function public.broadcast_partner_lead_change();

drop trigger if exists agent_notifications_broadcast on public.agent_notifications;
create trigger agent_notifications_broadcast
after insert on public.agent_notifications
for each row execute function public.broadcast_agent_notification();

-- Four more, found by the same sweep. All four functions exist and none of the triggers does, so
-- each is code that reads as wired and runs for nothing.
--
--   lead_queue_floor_broadcast      LA-1.15. The Agent Floor updates live for active_calls,
--                                   agent_presence, buffer_handoffs and nudges -- those four
--                                   triggers are attached -- but NOT for lead_queue. A lead arriving
--                                   or being claimed never reaches an open floor.
--
--                                   Confirmed rather than assumed: verify-agent-floor fails
--                                   "database change reaches every open floor in under one second"
--                                   with the detail "no event", and "database change emits a
--                                   tenant-scoped Realtime floor signal" alongside it. That suite
--                                   updates lead_queue and waits five seconds for a broadcast that
--                                   nothing sends. It is the only assertion in this module that
--                                   measures propagation, and it has been reporting this correctly
--                                   the whole time -- backlog 166 recorded LA-1.15 realtime as
--                                   passing on 2026-09-07, so this regressed or was never true.
--   lead_queue_sync_owner_columns   LA-1.10. Keeps the queue's denormalised owner columns in step
--                                   with a claim. Without it they hold whatever the insert set.
--   deal_flow_set_worked_by         LA-1.13. Stamps who worked a deal-flow row.
--   callbacks_assignee_role         LA-1.22. A GUARD, not a convenience: it refuses a callback
--                                   assigned to a user whose role may not take one. Absent, the
--                                   rule is unenforced -- and unlike the others this one fails open.

drop trigger if exists lead_queue_floor_broadcast on public.lead_queue;
create trigger lead_queue_floor_broadcast
after insert or update or delete on public.lead_queue
for each row execute function public.broadcast_la_1_15_floor_change();

drop trigger if exists lead_queue_sync_owner_columns on public.lead_queue;
create trigger lead_queue_sync_owner_columns
before insert or update on public.lead_queue
for each row execute function public.sync_lead_queue_owner_columns();

drop trigger if exists deal_flow_set_worked_by on public.deal_flow;
create trigger deal_flow_set_worked_by
before insert or update on public.deal_flow
for each row execute function public.set_deal_flow_worked_by();

drop trigger if exists callbacks_assignee_role on public.callbacks;
create trigger callbacks_assignee_role
before insert or update of tenant_id, assigned_to on public.callbacks
for each row execute function public.enforce_callback_assignee_role();

-- Assert both, and assert the two that already worked still do -- this migration touches tables the
-- intake path writes on every submission, so "I changed only what I meant to" is worth checking.
do $$
declare
  missing text;
  intact text;
begin
  select string_agg(t.name, ', ') into missing
  from unnest(array['lead_queue_partner_pipeline_broadcast', 'agent_notifications_broadcast',
                     'lead_queue_floor_broadcast', 'lead_queue_sync_owner_columns',
                     'deal_flow_set_worked_by', 'callbacks_assignee_role']) as t(name)
  where not exists (select 1 from pg_trigger g where g.tgname = t.name and not g.tgisinternal);
  if missing is not null then
    raise exception 'broadcast trigger(s) still missing: %', missing;
  end if;

  select string_agg(t.name, ', ') into intact
  from unnest(array['active_calls_floor_broadcast', 'buffer_handoffs_floor_broadcast',
                    'agent_presence_floor_broadcast', 'agent_floor_nudges_broadcast',
                    'partner_messages_broadcast']) as t(name)
  where not exists (select 1 from pg_trigger g where g.tgname = t.name and not g.tgisinternal);
  if intact is not null then
    raise exception 'pre-existing broadcast trigger(s) lost: %', intact;
  end if;
end;
$$;
