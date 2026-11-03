-- M2 LA-2.8-7 · the index 20260929203000's fresh-lead probe reads (1 of 2).
--
-- PASTE THIS FILE ON ITS OWN, after 20260929203000. CREATE INDEX CONCURRENTLY builds without
-- blocking writes to agent_leads (the dialer and the importer keep working), but it cannot run
-- inside a transaction block, so it cannot share a paste with any other statement.
--
-- A campaign's fresh leads, per state, in creation order (the leads with no campaign sit under a
-- NULL key), so Serve next reads a campaign's first eligible fresh lead in an open state without
-- walking the leads already worked or the states that are closed. If the build is interrupted it
-- leaves an INVALID index: drop it with
--   drop index concurrently if exists public.agent_leads_fresh_serving_idx
-- and paste this again.

create index concurrently if not exists agent_leads_fresh_serving_idx
  on public.agent_leads (tenant_id, campaign_id, (upper(values->>'state')), created_at, id)
  where lead_state = 'fresh';
