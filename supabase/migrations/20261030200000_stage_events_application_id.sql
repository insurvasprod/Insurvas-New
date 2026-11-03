-- Pipeline sync history names the application that moved the card (Notion LA-3.23: "every automatic
-- move writes a stage-history row: old stage, new stage, application_id, trigger, timestamp").
--
-- tenant_lead_stage_events has had no application column, so Settings › Pipeline sync › Activity reads
-- the state back from the stage the card went to, and a person cannot open the attempt that caused a
-- move. Written 2026-10-30 with the Pipeline sync redesign; applied by the owner 2026-10-30 (catalog verified).
--
--   1. application_id: the attempt whose change moved the card. Null for every move a person made and
--      for every row written before this; set null if the attempt is ever removed.
--   2. A partial index for the sync's own rows, newest first per tenant: Activity's list and 30-day
--      count read it instead of one range per stage.
--
-- lib/applications/stageSyncService.ts moveLead() writes the attempt (attemptForTarget in stageSync.ts),
-- and getStageMapActivity links each move to its application.
--
-- Down: drop index tenant_lead_stage_events_sync_idx; alter table … drop column application_id.

set local lock_timeout = '5s';

-- ── 1 · the attempt behind an automatic move ────────────────────────────────
alter table public.tenant_lead_stage_events
  add column if not exists application_id uuid references public.tenant_applications(id) on delete set null;

-- ── 2 · the sync's rows, newest first ────────────────────────────────────────
create index if not exists tenant_lead_stage_events_sync_idx
  on public.tenant_lead_stage_events (tenant_id, created_at desc)
  where source = 'application_sync';

-- ── checks ───────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenant_lead_stage_events' and column_name = 'application_id') then
    raise exception '20261030200000: application_id is missing';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'tenant_lead_stage_events_sync_idx') then
    raise exception '20261030200000: the sync index is missing';
  end if;
end $$;

notify pgrst, 'reload schema';
