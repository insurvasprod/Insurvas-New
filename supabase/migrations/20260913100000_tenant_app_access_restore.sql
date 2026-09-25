-- Restore the tenant_app read path this repository declares, for the tables that never got it.
--
-- A tenant-plane table needs BOTH a grant and a row-level security policy that covers tenant_app.
-- Neither works alone, and the two fail differently:
--
--   policy, no grant   42501 permission denied -- loud, and the caller sees it
--   grant, no policy   RLS denies every row -- silent, and reads exactly like "there is no data"
--
-- scripts/check-tenant-app-access.mjs compares this repository's declarations against the live
-- database. Of 78 tables declared, 59 were already correct, 4 are superseded by renames
-- (tenant_pipelines and friends carry the access at their new names), and 19 were incomplete.
--
-- Every statement below is this repository's own declaration, taken from the migration named beside
-- it, with the last declaration winning where several exist. No predicate is invented here.
--
-- Why this is safe on a shared database. Each policy names tenant_app, which is NOBYPASSRLS, and
-- each predicate reduces to the session's app.tenant_id -- a session with none set matches nothing,
-- because nullif('', '')::uuid is null and `tenant_id = null` is never true. Postgres evaluates only
-- the policies naming the current role, so adding one for tenant_app cannot change what the CRM's
-- own roles see on the tables the two products share.
--
-- Nothing user-facing changes: the application reads through service_role, which bypasses RLS. What
-- changes is that LA-0.2's isolation guarantee becomes exercisable on these tables, instead of being
-- asserted by checks that could only fail loudly or pass vacuously.
--
-- NOT fixed here, deliberately: tenant_template_fields, tenant_template_forms, tenant_template_stages, tenant_templates.
-- These have a grant declared and no tenant_app policy anywhere in this repository. Granting them
-- without one would create the silent variant above -- a table that reads as empty forever. They
-- need a policy decision first, which belongs to their owning task rather than to this migration.

-- active_calls
grant select on public.active_calls to tenant_app;  -- 20260902230000_la_1_10_transfer_inbox_claim.sql

-- agent_notifications
grant select, insert, update on public.agent_notifications to tenant_app;  -- 20260911100000_live_runtime_compatibility.sql

-- callback_history
grant select on public.callback_history to tenant_app;  -- 20260902183000_la_1_22_callback_write_grants.sql
drop policy if exists callback_history_tenant_scoped on public.callback_history;
create policy callback_history_tenant_scoped on public.callback_history for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);  -- 20260902180000_la_1_22_callbacks.sql

-- callbacks
grant select on public.callbacks to tenant_app;  -- 20260902183000_la_1_22_callback_write_grants.sql
drop policy if exists callbacks_tenant_scoped on public.callbacks;
create policy callbacks_tenant_scoped on public.callbacks for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);  -- 20260902180000_la_1_22_callbacks.sql

-- lead_note_edits
grant select on public.lead_note_edits to tenant_app;  -- 20260902170000_la_1_21_lead_notes.sql

-- lead_note_mentions
grant select on public.lead_note_mentions to tenant_app;  -- 20260902170000_la_1_21_lead_notes.sql

-- lead_notes
grant select on public.lead_notes to tenant_app;  -- 20260902170000_la_1_21_lead_notes.sql
drop policy if exists lead_notes_tenant_scoped on public.lead_notes;
create policy lead_notes_tenant_scoped on public.lead_notes for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);  -- 20260902170000_la_1_21_lead_notes.sql

-- lead_sla_events
drop policy if exists lead_sla_events_scoped on public.lead_sla_events;
create policy lead_sla_events_scoped on public.lead_sla_events for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);  -- 20260903000000_la_1_23_unclaimed_sla.sql

-- partner_message_attachments
grant select, insert, update on public.partner_message_attachments to tenant_app;  -- 20260903140000_la_1_16_partner_chat_notifications.sql

-- partner_message_mentions
grant select, insert, update on public.partner_message_mentions to tenant_app;  -- 20260903140000_la_1_16_partner_chat_notifications.sql

-- partner_message_reads
grant select, insert, update on public.partner_message_reads to tenant_app;  -- 20260903140000_la_1_16_partner_chat_notifications.sql

-- partner_products
drop policy if exists partner_products_tenant_read on public.partner_products;
create policy partner_products_tenant_read on public.partner_products for select to tenant_app
  using (exists (
    select 1 from public.partners p
    where p.id = partner_id
      and p.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid
  ));  -- 20260901140000_la_1_3_rls_initplan_fix.sql

-- screening_audit
grant select on public.screening_audit to tenant_app;  -- 20260902160000_la_1_5_screening_service.sql
drop policy if exists screening_audit_tenant_scoped on public.screening_audit;
create policy screening_audit_tenant_scoped on public.screening_audit for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);  -- 20260902160000_la_1_5_screening_service.sql

-- screening_cache_locks
grant select on public.screening_cache_locks to tenant_app;  -- 20260902160000_la_1_5_screening_service.sql

-- screening_results
grant select on public.screening_results to tenant_app;  -- 20260902160000_la_1_5_screening_service.sql
drop policy if exists screening_results_tenant_scoped on public.screening_results;
create policy screening_results_tenant_scoped on public.screening_results for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);  -- 20260902160000_la_1_5_screening_service.sql

-- Assert both halves for every table touched. Partial success is the failure mode that started this.
do $$
declare
  incomplete text;
begin
  select string_agg(t.name, ', ') into incomplete
  from unnest(array['active_calls', 'agent_notifications', 'callback_history', 'callbacks', 'lead_note_edits', 'lead_note_mentions', 'lead_notes', 'lead_sla_events', 'partner_message_attachments', 'partner_message_mentions', 'partner_message_reads', 'partner_products', 'screening_audit', 'screening_cache_locks', 'screening_results']) as t(name)
  where not (
    exists (select 1 from information_schema.role_table_grants g
             where g.table_schema = 'public' and g.table_name = t.name and g.grantee = 'tenant_app')
    and exists (select 1 from pg_policy p
                 join pg_class c on c.oid = p.polrelid
                 join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relname = t.name
                  and (p.polroles = '{0}'::oid[]
                    or 'tenant_app' = any (select rolname from pg_roles where oid = any (p.polroles))))
  );
  if incomplete is not null then
    raise exception 'still incomplete after this migration: %', incomplete;
  end if;
end;
$$;
