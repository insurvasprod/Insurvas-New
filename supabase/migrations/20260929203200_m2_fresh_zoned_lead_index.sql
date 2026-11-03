-- M2 LA-2.8-7 and LA-2.2-4 · the index 20260929203000 reads for fresh leads with their own
-- dial_timezone (2 of 2). Needs 20260925709600 (the column).
--
-- PASTE THIS FILE ON ITS OWN, after 20260929203100. CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction block. If the build is interrupted, drop the INVALID index with
--   drop index concurrently if exists public.agent_leads_fresh_zoned_idx
-- and paste this again.

create index concurrently if not exists agent_leads_fresh_zoned_idx
  on public.agent_leads (tenant_id)
  where lead_state = 'fresh' and dial_timezone is not null;
