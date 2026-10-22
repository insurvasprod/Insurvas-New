-- LA-6.1 (Notion sprint, Module 6 — Compliance) · the compliance record index.
--
-- Given a phone number, every compliance-relevant record about it, across the tables five modules
-- already write, in one query. It creates no new records: it points at existing ones.
--
--   compliance_index               one row per (event type, source row): tenant, phone_digits (THE key),
--                                  contact/lead when resolved, event_at (when it happened, never when
--                                  indexed), source_table + source_id (+ source_sub_id), a short
--                                  outcome_summary for display, and the module that owns the record.
--   compliance_index_source        the one definition of what is indexed (a view over the sources).
--                                  The triggers, the nightly reconciliation and the rebuild all read it,
--                                  so they cannot disagree.
--   compliance_index_reconciliation  one row per tenant per nightly run: rows missing (a non-zero count
--                                  is a bug), stale rows removed, events that have no usable number.
--
-- The spec's table names, mapped to the tables this app really writes (checked 2026-10-15):
--   screening_results / screening_audit  → screening_audit (one row per check; results is the cache)
--   scrub_results                        → tenant_campaign_scrub_rejections, tenant_suppression_list
--                                          (vendor DNC / litigator hits), tenant_dial_dnc_checks
--   suppression_lists (internal DNC)     → tenant_do_not_call
--   consent tables                       → tenant_consent_artefacts (tenant_dnc_exemptions is not live:
--                                          20260925709700 never landed, so it is left out until it does)
--   call_attempts                        → tenant_call_attempts (+ its script-disclosure confirmation)
--   application_disclosure               → tenant_application_disclosures (acknowledged only)
--   transfer_verdict, complaint, deletion → added by LA-6.2, LA-6.4 and LA-6.5.
--
-- Phone numbers: the TypeScript key is LA-1.5's getUsPhone10Digits (lib/compliance/scrub.ts). The
-- triggers run in the database, which cannot call it, so us_phone_10_digits is its exact twin — same
-- characters allowed, a leading 1 on eleven digits dropped, anything else no number. Both are held to
-- one corpus: the self-check below and lib/compliance/recordIndex.test.mjs list the same cases.
--
-- Additive. Rollback:
--   select cron.unschedule('la6-compliance-index-nightly');
--   drop trigger if exists compliance_index_sync on public.screening_audit;  (and the other eight)
--   drop function if exists public.compliance_index_reconcile(uuid, text), public.compliance_index_rebuild(uuid),
--     public.compliance_index_add_source(text, text),
--     public.compliance_index_sync(), public.compliance_index_sync_disclosure(), public.compliance_index_sync_lead(),
--     public.compliance_lead_phone(jsonb), public.us_phone_10_digits(text);
--   drop view if exists public.compliance_index_source;
--   drop table if exists public.compliance_index_reconciliation, public.compliance_index;

-- ─── phone key ──────────────────────────────────────────────────────────────────────────────────
create or replace function public.us_phone_10_digits(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when p_value is null or p_value !~ '^[[:space:]]*[+()0-9[:space:].-]+[[:space:]]*$' then null
    else (
      select case
        when length(d) = 11 and left(d, 1) = '1' then right(d, 10)
        when length(d) = 10 then d
      end
      from (select regexp_replace(p_value, '[^0-9]', '', 'g') as d) x
    )
  end
$$;

-- A lead's number, from the same keys the LA-1.24 preflight reads.
create or replace function public.compliance_lead_phone(p_values jsonb)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_catalog
as $$
  select public.us_phone_10_digits(coalesce(p_values->>'phone', p_values->>'phone_number', p_values->>'primary_phone'))
$$;

-- ─── the index ──────────────────────────────────────────────────────────────────────────────────
create table if not exists public.compliance_index (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone_digits text not null,
  contact_id uuid,
  lead_id uuid,
  event_type text not null,
  event_at timestamptz not null,
  source_table text not null,
  source_id uuid not null,
  -- A second key for a source whose row is keyed by two ids (an application's disclosure); otherwise the zero id.
  source_sub_id uuid not null default '00000000-0000-0000-0000-000000000000',
  outcome_summary text not null,
  module text not null,
  constraint compliance_index_pkey primary key (tenant_id, event_type, source_table, source_id, source_sub_id),
  constraint compliance_index_phone check (phone_digits ~ '^[0-9]{10}$'),
  constraint compliance_index_event_type check (event_type in (
    'screening', 'scrub', 'dnc_add', 'consent', 'call_attempt', 'disclosure', 'transfer_verdict', 'complaint', 'deletion'))
);
create index if not exists compliance_index_phone_idx on public.compliance_index (tenant_id, phone_digits, event_at);
create index if not exists compliance_index_contact_idx on public.compliance_index (tenant_id, contact_id, event_at) where contact_id is not null;
create index if not exists compliance_index_lead_idx on public.compliance_index (tenant_id, lead_id) where lead_id is not null;
create index if not exists compliance_index_source_idx on public.compliance_index (source_table, source_id);

alter table public.compliance_index enable row level security;
drop policy if exists compliance_index_read on public.compliance_index;
create policy compliance_index_read on public.compliance_index for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.compliance_index from public, anon, authenticated;
-- Only the triggers and the reconciliation write it (as the table owner).
revoke insert, update, delete, truncate on public.compliance_index from service_role, tenant_app;
grant select on public.compliance_index to service_role, tenant_app;

create table if not exists public.compliance_index_reconciliation (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ran_at timestamptz not null default now(),
  missing_count integer not null,
  stale_count integer not null,
  unkeyed_count integer not null,
  triggered_by text not null default 'schedule',
  constraint compliance_index_reconciliation_trigger check (triggered_by in ('schedule', 'manual', 'migration'))
);
create index if not exists compliance_index_reconciliation_tenant_idx on public.compliance_index_reconciliation (tenant_id, ran_at desc);
alter table public.compliance_index_reconciliation enable row level security;
drop policy if exists compliance_index_reconciliation_read on public.compliance_index_reconciliation;
create policy compliance_index_reconciliation_read on public.compliance_index_reconciliation for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.compliance_index_reconciliation from public, anon, authenticated;
revoke insert, update, delete, truncate on public.compliance_index_reconciliation from service_role, tenant_app;
grant select on public.compliance_index_reconciliation to service_role, tenant_app;

-- ─── what is indexed: one definition ────────────────────────────────────────────────────────────
-- Columns in the table's order. A row whose number cannot be keyed is left out (counted as unkeyed).
create or replace view public.compliance_index_source as
  -- LA-1.5 screening: one row per check.
  select s.tenant_id, s.phone_digits, l.contact_id, s.lead_id, 'screening'::text as event_type, s.ts as event_at,
         'screening_audit'::text as source_table, s.id as source_id, '00000000-0000-0000-0000-000000000000'::uuid as source_sub_id,
         ('Screening: ' || replace(s.outcome, '_', ' ') || case when s.cached then ' (cached)' else '' end
           || coalesce(' · ' || s.vendor, ''))::text as outcome_summary,
         'LA-1.5'::text as module
    from public.screening_audit s
    left join public.agent_leads l on l.id = s.lead_id and l.tenant_id = s.tenant_id
   where s.tenant_id is not null and s.phone_digits ~ '^[0-9]{10}$'
  union all
  -- LA-2.3 vendor lists: federal / state DNC, litigator, invalid.
  select v.tenant_id, v.phone_digits, null::uuid, null::uuid, 'scrub', v.added_at,
         'tenant_suppression_list', v.id, '00000000-0000-0000-0000-000000000000'::uuid,
         'Listed: ' || replace(v.list_type, '_', ' ') || ' (' || v.source || ')', 'LA-2.3'
    from public.tenant_suppression_list v
   where v.phone_digits ~ '^[0-9]{10}$'
  union all
  -- LA-2.3 campaign scrub: a number removed from a list before it could be dialled.
  select r.tenant_id, r.phone_digits, null::uuid, null::uuid, 'scrub', r.rejected_at,
         'tenant_campaign_scrub_rejections', r.id, '00000000-0000-0000-0000-000000000000'::uuid,
         'Removed in campaign scrub: ' || replace(r.outcome, '_', ' '), 'LA-2.3'
    from public.tenant_campaign_scrub_rejections r
   where r.phone_digits ~ '^[0-9]{10}$'
  union all
  -- LA-2.3 dial-time DNC check.
  select d.tenant_id, public.compliance_lead_phone(l.values), l.contact_id, d.lead_id, 'scrub', d.checked_at,
         'tenant_dial_dnc_checks', d.id, '00000000-0000-0000-0000-000000000000'::uuid,
         'DNC check at dial: ' || d.result, 'LA-2.3'
    from public.tenant_dial_dnc_checks d
    join public.agent_leads l on l.id = d.lead_id and l.tenant_id = d.tenant_id
   where public.compliance_lead_phone(l.values) is not null
  union all
  -- LA-2.3 internal do-not-call list.
  select n.tenant_id, n.phone_digits, l.contact_id, n.lead_id, 'dnc_add', n.created_at,
         'tenant_do_not_call', n.id, '00000000-0000-0000-0000-000000000000'::uuid,
         'Internal do-not-call: ' || left(n.reason, 120) || case when n.is_active then '' else ' (inactive)' end, 'LA-2.3'
    from public.tenant_do_not_call n
    left join public.agent_leads l on l.id = n.lead_id and l.tenant_id = n.tenant_id
   where n.phone_digits ~ '^[0-9]{10}$'
  union all
  -- LA-2.6 consent artefacts (certificate per lead).
  select c.tenant_id, public.compliance_lead_phone(l.values), l.contact_id, c.lead_id, 'consent', coalesce(c.consent_timestamp, c.captured_at),
         'tenant_consent_artefacts', c.id, '00000000-0000-0000-0000-000000000000'::uuid,
         'Consent: ' || c.provider || ' certificate, ' || c.capture_status, 'LA-2.6'
    from public.tenant_consent_artefacts c
    join public.agent_leads l on l.id = c.lead_id and l.tenant_id = c.tenant_id
   where public.compliance_lead_phone(l.values) is not null
  union all
  -- LA-2.7 call attempts.
  select a.tenant_id, public.compliance_lead_phone(l.values), l.contact_id, a.lead_id, 'call_attempt', a.attempted_at,
         'tenant_call_attempts', a.id, '00000000-0000-0000-0000-000000000000'::uuid,
         'Call #' || a.attempt_number || coalesce(' · ' || a.disposition, ' · no disposition'), 'LA-2.7'
    from public.tenant_call_attempts a
    join public.agent_leads l on l.id = a.lead_id and l.tenant_id = a.tenant_id
   where public.compliance_lead_phone(l.values) is not null
  union all
  -- LA-2.23 the script's state disclosure, confirmed on the call.
  select a.tenant_id, public.compliance_lead_phone(l.values), l.contact_id, a.lead_id, 'disclosure', a.disclosure_confirmed_at,
         'tenant_call_attempts', a.id, '00000000-0000-0000-0000-000000000000'::uuid,
         'Call disclosure confirmed' || coalesce(' (' || a.disclosure_state || ')', ''), 'LA-2.23'
    from public.tenant_call_attempts a
    join public.agent_leads l on l.id = a.lead_id and l.tenant_id = a.tenant_id
   where a.disclosure_confirmed_at is not null and public.compliance_lead_phone(l.values) is not null
  union all
  -- LA-3.10 application disclosures, once acknowledged.
  select t.tenant_id, public.compliance_lead_phone(l.values), l.contact_id, ap.lead_id, 'disclosure', t.acknowledged_at,
         'tenant_application_disclosures', t.application_id, t.disclosure_id,
         'Disclosure acknowledged: ' || coalesce(ad.title, 'disclosure') || coalesce(' (' || replace(t.method, '_', ' ') || ')', ''), 'LA-3.10'
    from public.tenant_application_disclosures t
    join public.tenant_applications ap on ap.id = t.application_id and ap.tenant_id = t.tenant_id
    join public.agent_leads l on l.id = ap.lead_id and l.tenant_id = ap.tenant_id
    left join public.application_disclosures ad on ad.id = t.disclosure_id
   where t.status = 'acknowledged' and t.acknowledged_at is not null and public.compliance_lead_phone(l.values) is not null;

revoke all on public.compliance_index_source from public, anon, authenticated, tenant_app, service_role;

-- Later LA-6 tasks (the transfer verdict, complaints, deletions) add their own branch to the view
-- through this, rather than restating the whole definition. Re-running it with a branch already
-- present does nothing.
create or replace function public.compliance_index_add_source(p_source_table text, p_branch text)
returns boolean
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_def text;
begin
  v_def := pg_get_viewdef('public.compliance_index_source'::regclass, true);
  if position('''' || p_source_table || '''' in v_def) > 0 then
    return false;
  end if;
  execute format('create or replace view public.compliance_index_source as %s union all %s',
                 rtrim(btrim(v_def), ';'), p_branch);
  revoke all on public.compliance_index_source from public, anon, authenticated, tenant_app, service_role;
  return true;
end $$;
revoke all on function public.compliance_index_add_source(text, text) from public, anon, authenticated, tenant_app, service_role;

-- ─── keeping it current: written when the source row is written ─────────────────────────────────
create or replace function public.compliance_index_sync()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    delete from public.compliance_index
     where tenant_id = old.tenant_id and source_table = tg_table_name and source_id = old.id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    insert into public.compliance_index
    select * from public.compliance_index_source s
     where s.tenant_id = new.tenant_id and s.source_table = tg_table_name and s.source_id = new.id
    on conflict do nothing;
  end if;
  return null;
end $$;

-- tenant_application_disclosures is keyed by (application, disclosure).
create or replace function public.compliance_index_sync_disclosure()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    delete from public.compliance_index
     where tenant_id = old.tenant_id and source_table = 'tenant_application_disclosures'
       and source_id = old.application_id and source_sub_id = old.disclosure_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    insert into public.compliance_index
    select * from public.compliance_index_source s
     where s.tenant_id = new.tenant_id and s.source_table = 'tenant_application_disclosures'
       and s.source_id = new.application_id and s.source_sub_id = new.disclosure_id
    on conflict do nothing;
  end if;
  return null;
end $$;

-- A lead's number or client changed: every row that reached its number through the lead is re-keyed.
create or replace function public.compliance_index_sync_lead()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  delete from public.compliance_index where tenant_id = new.tenant_id and lead_id = new.id;
  insert into public.compliance_index
  select * from public.compliance_index_source s where s.tenant_id = new.tenant_id and s.lead_id = new.id
  on conflict do nothing;
  return null;
end $$;

revoke all on function public.compliance_index_sync() from public, anon, authenticated, tenant_app, service_role;
revoke all on function public.compliance_index_sync_disclosure() from public, anon, authenticated, tenant_app, service_role;
revoke all on function public.compliance_index_sync_lead() from public, anon, authenticated, tenant_app, service_role;

drop trigger if exists compliance_index_sync on public.screening_audit;
create trigger compliance_index_sync after insert or update or delete on public.screening_audit for each row execute function public.compliance_index_sync();
drop trigger if exists compliance_index_sync on public.tenant_suppression_list;
create trigger compliance_index_sync after insert or update or delete on public.tenant_suppression_list for each row execute function public.compliance_index_sync();
drop trigger if exists compliance_index_sync on public.tenant_campaign_scrub_rejections;
create trigger compliance_index_sync after insert or update or delete on public.tenant_campaign_scrub_rejections for each row execute function public.compliance_index_sync();
drop trigger if exists compliance_index_sync on public.tenant_dial_dnc_checks;
create trigger compliance_index_sync after insert or update or delete on public.tenant_dial_dnc_checks for each row execute function public.compliance_index_sync();
drop trigger if exists compliance_index_sync on public.tenant_do_not_call;
create trigger compliance_index_sync after insert or update or delete on public.tenant_do_not_call for each row execute function public.compliance_index_sync();
drop trigger if exists compliance_index_sync on public.tenant_consent_artefacts;
create trigger compliance_index_sync after insert or update or delete on public.tenant_consent_artefacts for each row execute function public.compliance_index_sync();
drop trigger if exists compliance_index_sync on public.tenant_call_attempts;
-- Only the columns the index reads: a call row is updated often for other reasons.
create trigger compliance_index_sync after insert or delete or update of lead_id, attempted_at, attempt_number, disposition, disclosure_confirmed_at, disclosure_state on public.tenant_call_attempts for each row execute function public.compliance_index_sync();
drop trigger if exists compliance_index_sync on public.tenant_application_disclosures;
create trigger compliance_index_sync after insert or update or delete on public.tenant_application_disclosures for each row execute function public.compliance_index_sync_disclosure();
drop trigger if exists compliance_index_sync_lead on public.agent_leads;
create trigger compliance_index_sync_lead after update of values, contact_id on public.agent_leads for each row
  when (public.compliance_lead_phone(old.values) is distinct from public.compliance_lead_phone(new.values) or old.contact_id is distinct from new.contact_id)
  execute function public.compliance_index_sync_lead();

-- ─── rebuild and nightly reconciliation ─────────────────────────────────────────────────────────
-- Rebuild: drop a tenant's rows and write them again from the sources. Idempotent; the rows are
-- determined entirely by the sources, so a rebuild reproduces them exactly.
create or replace function public.compliance_index_rebuild(p_tenant_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_count integer;
begin
  if p_tenant_id is null then
    raise exception 'compliance_index_rebuild: a tenant is required';
  end if;
  delete from public.compliance_index where tenant_id = p_tenant_id;
  insert into public.compliance_index select * from public.compliance_index_source where tenant_id = p_tenant_id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Reconcile: add what the triggers missed, remove what no longer matches its source, and record the
-- counts. A missing row is a bug, not maintenance — the count is the alarm.
create or replace function public.compliance_index_reconcile(p_tenant_id uuid default null, p_triggered_by text default 'schedule')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_tenant uuid;
  v_missing integer;
  v_stale integer;
  v_unkeyed integer;
  v_total_missing integer := 0;
  v_total_stale integer := 0;
  v_total_unkeyed integer := 0;
  v_tenants integer := 0;
begin
  for v_tenant in
    select id from public.tenants where p_tenant_id is null or id = p_tenant_id order by id
  loop
    with stale as (
      select * from public.compliance_index where tenant_id = v_tenant
      except
      select * from public.compliance_index_source where tenant_id = v_tenant
    ), gone as (
      delete from public.compliance_index i
       using stale s
       where i.tenant_id = s.tenant_id and i.event_type = s.event_type and i.source_table = s.source_table
         and i.source_id = s.source_id and i.source_sub_id = s.source_sub_id
      returning 1
    )
    select count(*) into v_stale from gone;

    with missing as (
      select * from public.compliance_index_source where tenant_id = v_tenant
      except
      select * from public.compliance_index where tenant_id = v_tenant
    ), added as (
      insert into public.compliance_index select * from missing on conflict do nothing returning 1
    )
    select count(*) into v_missing from added;

    -- Events with no usable number on their lead: they cannot be found by number, and say so.
    select (select count(*) from public.tenant_call_attempts a join public.agent_leads l on l.id = a.lead_id
             where a.tenant_id = v_tenant and public.compliance_lead_phone(l.values) is null)
         + (select count(*) from public.tenant_consent_artefacts c join public.agent_leads l on l.id = c.lead_id
             where c.tenant_id = v_tenant and public.compliance_lead_phone(l.values) is null)
      into v_unkeyed;

    -- A tenant with nothing indexed and nothing wrong leaves no row (most tenants hold no compliance records).
    if v_missing + v_stale + v_unkeyed > 0 or exists (select 1 from public.compliance_index where tenant_id = v_tenant) then
      insert into public.compliance_index_reconciliation (tenant_id, missing_count, stale_count, unkeyed_count, triggered_by)
      values (v_tenant, v_missing, v_stale, v_unkeyed, coalesce(p_triggered_by, 'schedule'));
    end if;
    v_total_missing := v_total_missing + v_missing;
    v_total_stale := v_total_stale + v_stale;
    v_total_unkeyed := v_total_unkeyed + v_unkeyed;
    v_tenants := v_tenants + 1;
  end loop;
  return jsonb_build_object('tenants', v_tenants, 'missing', v_total_missing, 'stale', v_total_stale, 'unkeyed', v_total_unkeyed);
end $$;

revoke all on function public.compliance_index_rebuild(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.compliance_index_rebuild(uuid) to service_role;
revoke all on function public.compliance_index_reconcile(uuid, text) from public, anon, authenticated, tenant_app;
grant execute on function public.compliance_index_reconcile(uuid, text) to service_role;
-- us_phone_10_digits and compliance_lead_phone keep their default execute grant: they are pure, and
-- the agent_leads trigger's WHEN clause runs them as whichever role updates a lead.

-- ─── backfill ───────────────────────────────────────────────────────────────────────────────────
-- One statement for every tenant (a per-tenant loop costs a view build per tenant: 565 of them).
-- Only tenants that still exist: some older source rows (screening_audit) outlived their tenant.
insert into public.compliance_index
select s.* from public.compliance_index_source s where exists (select 1 from public.tenants t where t.id = s.tenant_id)
on conflict do nothing;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('la6-compliance-index-nightly', '30 5 * * *', $cron$select public.compliance_index_reconcile(null, 'schedule')$cron$);
    exception when others then
      raise notice '20261015100000: the nightly reconciliation could not be scheduled (%).', sqlerrm;
    end;
  end if;
end $$;

-- ─── self-check ─────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v jsonb;
begin
  -- The phone corpus (the same cases as lib/compliance/recordIndex.test.mjs).
  if public.us_phone_10_digits('(817) 555-0142') is distinct from '8175550142'
     or public.us_phone_10_digits('8175550142') is distinct from '8175550142'
     or public.us_phone_10_digits('+18175550142') is distinct from '8175550142'
     or public.us_phone_10_digits('817-555-0142') is distinct from '8175550142'
     or public.us_phone_10_digits('1 817.555.0142') is distinct from '8175550142'
     or public.us_phone_10_digits(' 817 555 0142 ') is distinct from '8175550142'
     or public.us_phone_10_digits('28175550142') is not null
     or public.us_phone_10_digits('555-0142') is not null
     or public.us_phone_10_digits('817555014x') is not null
     or public.us_phone_10_digits('') is not null
     or public.us_phone_10_digits(null) is not null then
    raise exception '20261015100000: us_phone_10_digits disagrees with getUsPhone10Digits';
  end if;
  -- The reconciliation runs clean straight after the backfill (rolled back: no history row is left).
  begin
    -- The largest tenant: the whole loop is the nightly job's, and too slow for an editor run.
    v := public.compliance_index_reconcile((select tenant_id from public.compliance_index group by tenant_id order by count(*) desc limit 1), 'migration');
    if (v->>'missing')::int <> 0 or (v->>'stale')::int <> 0 then
      raise exception '20261015100000: the backfill and the sources disagree (%)', v;
    end if;
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  if has_table_privilege('service_role', 'public.compliance_index', 'INSERT') or has_table_privilege('tenant_app', 'public.compliance_index', 'DELETE') then
    raise exception '20261015100000: only the triggers and the reconciliation write the index';
  end if;
end $$;
