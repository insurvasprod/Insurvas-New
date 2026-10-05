-- Stage history accepts 'inbound' again, after 20260925711300 dropped it.
--
--   20260925709850 widened tenant_lead_stage_events.source to include 'inbound' (LA-1.12-10), and
--   restated 'dialer' so it and 711300 could be applied in either order. 711300 then restated the
--   check with 'dialer' only. Applied by filename, 711300 runs second and the inbound source is gone,
--   while 20260925709870's inbound disposition patch writes source 'inbound' — every inbound
--   disposition that moves a stage would fail the check.
--
--   Live on 2026-09-28: 711300 is applied, 709850 and 709870 are not, and the constraint allows
--   board, table, list, lead_detail, owner_fix, dialer. Nothing writes 'inbound' yet, so nothing fails
--   today. This file makes the final state right in either order: before 709850, after it, or on a
--   fresh replay.
--
--   LA-3 (20260926100000 onward) adds 'application_sync' to this same check and keeps 'inbound'.
--
-- Down: re-run 20260925711300's section 0 (the check without 'inbound'). Only safe while no row has
-- source = 'inbound'.

alter table public.tenant_lead_stage_events
  drop constraint if exists tenant_lead_stage_events_source_check,
  add constraint tenant_lead_stage_events_source_check
    check (source = any (array['board', 'table', 'list', 'lead_detail', 'owner_fix', 'dialer', 'inbound'])) not valid;
alter table public.tenant_lead_stage_events validate constraint tenant_lead_stage_events_source_check;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_lead_stage_events_source_check'
                  and pg_get_constraintdef(oid) like '%''inbound''%'
                  and pg_get_constraintdef(oid) like '%''dialer''%'
                  and pg_get_constraintdef(oid) like '%''owner_fix''%'
                  and convalidated) then
    raise exception '20260926000100: stage history does not accept inbound, dialer and owner_fix';
  end if;
end $$;
