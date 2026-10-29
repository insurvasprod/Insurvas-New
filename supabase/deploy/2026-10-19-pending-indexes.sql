-- ============================================================================
-- SUPERSEDED 2026-10-19: pasting this whole file fails with 25001 ("cannot run inside a transaction
-- block") — the SQL editor runs a multi-statement paste as one transaction. Use the three files
-- 2026-10-19-index-1-of-3.sql, -2-of-3.sql, -3-of-3.sql instead: each holds ONE statement; run each in an
-- otherwise EMPTY editor tab, in order, waiting for each to finish.
-- ============================================================================
-- ============================================================================
-- Pending CONCURRENT index builds — 2 files (2026-10-19). RUN AFTER 2026-10-19-pending.sql.
--
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction, and the SQL editor runs a multi-statement
-- paste as one. So: select ONE statement below, run it, wait for it to finish, then the next.
-- They do not block reads or writes on agent_leads while they build. If one fails it can leave an
-- INVALID index: drop it with  drop index concurrently if exists public.<name>;  and run it again.
-- Last, run the history block at the bottom (it is one statement).
-- ============================================================================

-- ─── RUN 1 of 3: 20260929203100_m2_fresh_lead_serving_index.sql
create index concurrently if not exists agent_leads_fresh_serving_idx
  on public.agent_leads (tenant_id, campaign_id, (upper(values->>'state')), created_at, id)
  where lead_state = 'fresh';

-- ─── RUN 2 of 3: 20260929203200_m2_fresh_zoned_lead_index.sql
create index concurrently if not exists agent_leads_fresh_zoned_idx
  on public.agent_leads (tenant_id)
  where lead_state = 'fresh' and dial_timezone is not null;

-- ─── RUN 3 of 3: record them in migration history
do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260929203100', 'm2_fresh_lead_serving_index') on conflict do nothing;
    insert into supabase_migrations.schema_migrations (version, name) values ('20260929203200', 'm2_fresh_zoned_lead_index') on conflict do nothing;
  end if;
end $bundle$;
