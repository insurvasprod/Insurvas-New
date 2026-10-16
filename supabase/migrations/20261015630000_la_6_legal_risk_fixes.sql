-- LA-6 audit (Notion sprint, Module 6 — Compliance) · legal-risk fixes found by the module audit,
-- 2026-10-15. Every function restated here was taken from its LIVE definition (pg_get_functiondef,
-- read-only, 2026-10-15; each matched its migration file) and changed only where named below.
--
--   Phone at the time (audit 8). A call and a consent artefact were keyed in the compliance index by
--     the lead's CURRENT number, so editing a lead's phone moved its whole history to the new number
--     and a report on the original number no longer found the calls made to it. Now the number is
--     recorded on the record when it is written (tenant_call_attempts.dialled_phone_digits,
--     tenant_consent_artefacts.phone_digits; a BEFORE trigger fills it from the lead at that moment)
--     and the index reads it. Rows written before this migration are backfilled from the lead's
--     number today — the best that is known; a phone edited before today cannot be recovered.
--   compliance_consent_valid_at (audits 1, 2). ONE rule for whether a consent artefact covered a
--     contact at a moment: consent given after the contact never covered it; claimed covers; pending
--     covers only inside the provider's claim window. The transfer gate applies the same rule in
--     TypeScript (lib/compliance/consentValidity.ts, held to the same corpus by its test).
--   compliance_gaps (audits 1, 14). Gap 1 counts a call as covered only by consent given at or
--     before it; gap 6 uses the shared rule at the call's time, so a claimed certificate captured
--     after the call no longer passes; gap 4 counts only ACTIVE do-not-call entries — the same set the
--     dashboard counts (dnc_active) and the dialler enforces.
--   legal_hold_active_for_lead (audit 5). Calls, consent and lead data were checked against holds
--     with no policy and only the lead's current number. Now: the record's own number, every number
--     the index has ever held for the lead or its client, the client, and every policy of the client.
--   retention_execute (audits 5, 6, 7). Consent ages from its LAST RELIANCE — the last call to that
--     number or transfer verdict that passed on it — not from capture. A live run needs the dry run's
--     summary delivered to someone (or acknowledged) and the rules unchanged since that dry run.
--   retention_scheduled (audit 7). When the live run's preconditions fail it does not run: the dry
--     run is marked live_skipped (the dashboard shows it) and a fresh dry run follows the next day.
--   compliance_dashboard_figures adds purge_live_skipped.
--   deletion_request.requester_phone_digits / requester_email (audit 4): the channel the request came
--     from, which identity is matched on; frozen once the request is verified.
--   compliance_settings_save (audit 13): a settings change and its change rows in one transaction.
--
-- Requires 20261015100000–20261015190000 (all live). Rollback: restate the functions and the view
-- from those files, then
--   drop function if exists public.compliance_consent_valid_at(text, text, timestamptz, timestamptz, timestamptz, jsonb),
--     public.legal_hold_active_for_lead(uuid, uuid, text), public.retention_rules_fingerprint(uuid),
--     public.compliance_settings_save(uuid, uuid, jsonb, jsonb), public.compliance_phone_at_time() cascade;
--   alter table public.tenant_call_attempts drop column if exists dialled_phone_digits;
--   alter table public.tenant_consent_artefacts drop column if exists phone_digits;
--   alter table public.retention_run drop column if exists rules_fingerprint, drop column if exists summary_delivered_count,
--     drop column if exists summary_acknowledged_at, drop column if exists summary_acknowledged_by,
--     drop column if exists live_skipped_at, drop column if exists live_skipped_reason;
--   alter table public.deletion_request drop column if exists requester_phone_digits, drop column if exists requester_email;

-- ─── the number at the time ─────────────────────────────────────────────────────────────────────
alter table public.tenant_call_attempts add column if not exists dialled_phone_digits text;
alter table public.tenant_consent_artefacts add column if not exists phone_digits text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_call_attempts_dialled_phone') then
    alter table public.tenant_call_attempts add constraint tenant_call_attempts_dialled_phone check (dialled_phone_digits is null or dialled_phone_digits ~ '^[0-9]{10}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_consent_artefacts_phone') then
    alter table public.tenant_consent_artefacts add constraint tenant_consent_artefacts_phone check (phone_digits is null or phone_digits ~ '^[0-9]{10}$');
  end if;
end $$;

-- Written with the record: the number the lead had when the call was made or the consent captured.
-- A writer that knows the number it dialled may set it itself; a lead change re-reads it.
create or replace function public.compliance_phone_at_time()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_phone text;
begin
  if tg_op = 'UPDATE' and new.lead_id is not distinct from old.lead_id then
    return new;
  end if;
  select public.compliance_lead_phone(l.values) into v_phone
    from public.agent_leads l where l.id = new.lead_id and l.tenant_id = new.tenant_id;
  if tg_table_name = 'tenant_call_attempts' then
    if tg_op = 'UPDATE' or new.dialled_phone_digits is null then
      new.dialled_phone_digits := v_phone;
    end if;
  else
    if tg_op = 'UPDATE' or new.phone_digits is null then
      new.phone_digits := v_phone;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.compliance_phone_at_time() from public, anon, authenticated, tenant_app, service_role;
drop trigger if exists compliance_phone_at_time on public.tenant_call_attempts;
create trigger compliance_phone_at_time before insert or update of lead_id on public.tenant_call_attempts
  for each row execute function public.compliance_phone_at_time();
drop trigger if exists compliance_phone_at_time on public.tenant_consent_artefacts;
create trigger compliance_phone_at_time before insert or update of lead_id on public.tenant_consent_artefacts
  for each row execute function public.compliance_phone_at_time();

-- Backfill. The call update touches only the new column, which no trigger on the table watches. The
-- consent table's index trigger fires on any update, so it is paused for the backfill: the index rows
-- already carry exactly this number (they were keyed from the same lead phone).
update public.tenant_call_attempts a
   set dialled_phone_digits = public.compliance_lead_phone(l.values)
  from public.agent_leads l
 where l.id = a.lead_id and l.tenant_id = a.tenant_id and a.dialled_phone_digits is null
   and public.compliance_lead_phone(l.values) is not null;
alter table public.tenant_consent_artefacts disable trigger compliance_index_sync;
update public.tenant_consent_artefacts c
   set phone_digits = public.compliance_lead_phone(l.values)
  from public.agent_leads l
 where l.id = c.lead_id and l.tenant_id = c.tenant_id and c.phone_digits is null
   and public.compliance_lead_phone(l.values) is not null;
alter table public.tenant_consent_artefacts enable trigger compliance_index_sync;

-- The index reads the recorded number. The whole view is restated from its live definition (6.1's
-- branches plus 6.2's transfer_verdict and 6.4's complaint, added by compliance_index_add_source);
-- refuse if a branch this file does not know about has been added since.
do $$
declare
  v_tables text[];
begin
  select array_agg(distinct m[1] order by m[1]) into v_tables
    from regexp_matches(pg_get_viewdef('public.compliance_index_source'::regclass), '''([a-z_]+)''::text AS source_table', 'g') m;
  if v_tables is distinct from array['complaint', 'screening_audit', 'tenant_application_disclosures', 'tenant_call_attempts', 'tenant_campaign_scrub_rejections',
                                     'tenant_consent_artefacts', 'tenant_dial_dnc_checks', 'tenant_do_not_call', 'tenant_suppression_list', 'transfer_verdict'] then
    raise exception '20261015630000: compliance_index_source has branches this file does not restate (%); merge them first', v_tables;
  end if;
end $$;

create or replace view public.compliance_index_source as
  select s.tenant_id, s.phone_digits, l.contact_id, s.lead_id, 'screening'::text as event_type, s.ts as event_at,
         'screening_audit'::text as source_table, s.id as source_id, '00000000-0000-0000-0000-000000000000'::uuid as source_sub_id,
         ('Screening: ' || replace(s.outcome, '_', ' ') || case when s.cached then ' (cached)' else '' end
           || coalesce(' · ' || s.vendor, ''))::text as outcome_summary,
         'LA-1.5'::text as module
    from public.screening_audit s
    left join public.agent_leads l on l.id = s.lead_id and l.tenant_id = s.tenant_id
   where s.tenant_id is not null and s.phone_digits ~ '^[0-9]{10}$'
  union all
  select v.tenant_id, v.phone_digits, null::uuid, null::uuid, 'scrub', v.added_at,
         'tenant_suppression_list', v.id, '00000000-0000-0000-0000-000000000000'::uuid,
         'Listed: ' || replace(v.list_type, '_', ' ') || ' (' || v.source || ')', 'LA-2.3'
    from public.tenant_suppression_list v
   where v.phone_digits ~ '^[0-9]{10}$'
  union all
  select r.tenant_id, r.phone_digits, null::uuid, null::uuid, 'scrub', r.rejected_at,
         'tenant_campaign_scrub_rejections', r.id, '00000000-0000-0000-0000-000000000000'::uuid,
         'Removed in campaign scrub: ' || replace(r.outcome, '_', ' '), 'LA-2.3'
    from public.tenant_campaign_scrub_rejections r
   where r.phone_digits ~ '^[0-9]{10}$'
  union all
  select d.tenant_id, public.compliance_lead_phone(l.values), l.contact_id, d.lead_id, 'scrub', d.checked_at,
         'tenant_dial_dnc_checks', d.id, '00000000-0000-0000-0000-000000000000'::uuid,
         'DNC check at dial: ' || d.result, 'LA-2.3'
    from public.tenant_dial_dnc_checks d
    join public.agent_leads l on l.id = d.lead_id and l.tenant_id = d.tenant_id
   where public.compliance_lead_phone(l.values) is not null
  union all
  select n.tenant_id, n.phone_digits, l.contact_id, n.lead_id, 'dnc_add', n.created_at,
         'tenant_do_not_call', n.id, '00000000-0000-0000-0000-000000000000'::uuid,
         'Internal do-not-call: ' || left(n.reason, 120) || case when n.is_active then '' else ' (inactive)' end, 'LA-2.3'
    from public.tenant_do_not_call n
    left join public.agent_leads l on l.id = n.lead_id and l.tenant_id = n.tenant_id
   where n.phone_digits ~ '^[0-9]{10}$'
  union all
  -- LA-2.6 consent artefacts: the number the consent was captured for.
  select c.tenant_id, coalesce(c.phone_digits, public.compliance_lead_phone(l.values)), l.contact_id, c.lead_id, 'consent', coalesce(c.consent_timestamp, c.captured_at),
         'tenant_consent_artefacts', c.id, '00000000-0000-0000-0000-000000000000'::uuid,
         'Consent: ' || c.provider || ' certificate, ' || c.capture_status, 'LA-2.6'
    from public.tenant_consent_artefacts c
    join public.agent_leads l on l.id = c.lead_id and l.tenant_id = c.tenant_id
   where coalesce(c.phone_digits, public.compliance_lead_phone(l.values)) is not null
  union all
  -- LA-2.7 call attempts: the number dialled.
  select a.tenant_id, coalesce(a.dialled_phone_digits, public.compliance_lead_phone(l.values)), l.contact_id, a.lead_id, 'call_attempt', a.attempted_at,
         'tenant_call_attempts', a.id, '00000000-0000-0000-0000-000000000000'::uuid,
         'Call #' || a.attempt_number || coalesce(' · ' || a.disposition, ' · no disposition'), 'LA-2.7'
    from public.tenant_call_attempts a
    join public.agent_leads l on l.id = a.lead_id and l.tenant_id = a.tenant_id
   where coalesce(a.dialled_phone_digits, public.compliance_lead_phone(l.values)) is not null
  union all
  select a.tenant_id, coalesce(a.dialled_phone_digits, public.compliance_lead_phone(l.values)), l.contact_id, a.lead_id, 'disclosure', a.disclosure_confirmed_at,
         'tenant_call_attempts', a.id, '00000000-0000-0000-0000-000000000000'::uuid,
         'Call disclosure confirmed' || coalesce(' (' || a.disclosure_state || ')', ''), 'LA-2.23'
    from public.tenant_call_attempts a
    join public.agent_leads l on l.id = a.lead_id and l.tenant_id = a.tenant_id
   where a.disclosure_confirmed_at is not null and coalesce(a.dialled_phone_digits, public.compliance_lead_phone(l.values)) is not null
  union all
  select t.tenant_id, public.compliance_lead_phone(l.values), l.contact_id, ap.lead_id, 'disclosure', t.acknowledged_at,
         'tenant_application_disclosures', t.application_id, t.disclosure_id,
         'Disclosure acknowledged: ' || coalesce(ad.title, 'disclosure') || coalesce(' (' || replace(t.method, '_', ' ') || ')', ''), 'LA-3.10'
    from public.tenant_application_disclosures t
    join public.tenant_applications ap on ap.id = t.application_id and ap.tenant_id = t.tenant_id
    join public.agent_leads l on l.id = ap.lead_id and l.tenant_id = ap.tenant_id
    left join public.application_disclosures ad on ad.id = t.disclosure_id
   where t.status = 'acknowledged' and t.acknowledged_at is not null and public.compliance_lead_phone(l.values) is not null
  union all
  select v.tenant_id, v.phone_digits, l.contact_id, v.lead_id, 'transfer_verdict', v.evaluated_at,
         'transfer_verdict', v.id, '00000000-0000-0000-0000-000000000000'::uuid,
         'Transfer ' || replace(v.verdict, '_', ' ') || coalesce(': ' || replace(v.blocking_reason, '_', ' '), '')
           || case v.stage when 'number_entry' then ' (on number entry)' else ' (at submit)' end, 'LA-6.2'
    from public.transfer_verdict v
    left join public.agent_leads l on l.id = v.lead_id and l.tenant_id = v.tenant_id
   where v.phone_digits is not null
  union all
  select c.tenant_id, c.phone_digits, c.contact_id, null::uuid, 'complaint', c.received_at,
         'complaint', c.id, '00000000-0000-0000-0000-000000000000'::uuid,
         'Complaint (' || c.channel || coalesce(' ' || c.regulator_state, '') || '): ' || replace(c.category, '_', ' ')
           || case when c.dnc_entry_id is not null then ' · number added to do-not-call' else '' end, 'LA-6.4'
    from public.complaint c
   where c.phone_digits is not null;
revoke all on public.compliance_index_source from public, anon, authenticated, tenant_app, service_role;

-- The nightly reconciliation counts a call or consent as unkeyed only when it has no number at all.
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

    -- Events with no usable number (none recorded, none on the lead): they cannot be found by number, and say so.
    select (select count(*) from public.tenant_call_attempts a join public.agent_leads l on l.id = a.lead_id
             where a.tenant_id = v_tenant and coalesce(a.dialled_phone_digits, public.compliance_lead_phone(l.values)) is null)
         + (select count(*) from public.tenant_consent_artefacts c join public.agent_leads l on l.id = c.lead_id
             where c.tenant_id = v_tenant and coalesce(c.phone_digits, public.compliance_lead_phone(l.values)) is null)
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
revoke all on function public.compliance_index_reconcile(uuid, text) from public, anon, authenticated, tenant_app;
grant execute on function public.compliance_index_reconcile(uuid, text) to service_role;

-- ─── one consent rule ───────────────────────────────────────────────────────────────────────────
-- Did this artefact cover a contact at p_at? p_claim_hours: provider → claim-window hours (null = no
-- window), as LA-2.6 publishes them (lib/consent/claimWindow.ts). TypeScript twin: consentValidAt.
create or replace function public.compliance_consent_valid_at(p_status text, p_provider text, p_consent_at timestamptz, p_captured_at timestamptz,
                                                              p_at timestamptz, p_claim_hours jsonb)
returns boolean
language sql
stable
set search_path = pg_catalog
as $$
  select coalesce(p_consent_at, p_captured_at) is not null and p_at is not null
     and coalesce(p_consent_at, p_captured_at) <= p_at
     and (p_status = 'claimed'
          or (p_status = 'pending'
              and (nullif(coalesce(p_claim_hours, '{}'::jsonb)->>p_provider, '') is null
                   or coalesce(p_consent_at, p_captured_at) + make_interval(hours => (p_claim_hours->>p_provider)::int) >= p_at)))
$$;

-- ─── the gap checks ─────────────────────────────────────────────────────────────────────────────
create or replace function public.compliance_gaps(
  p_tenant_id uuid,
  p_phone_digits text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_claim_hours jsonb default '{}'::jsonb
)
returns table(category text, phone_digits text, status text, calls integer, first_at timestamptz, last_at timestamptz, detail jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_first_verdict timestamptz;
begin
  if p_tenant_id is null then
    raise exception 'compliance_gaps: a tenant is required';
  end if;

  -- 1. Calls with no consent: no consent for the number given at or before the call. A call made
  --    before the consent's own time was not covered by it.
  return query
  with calls as (
    select i.phone_digits as p, i.event_at as at from public.compliance_index i
     where i.tenant_id = p_tenant_id and i.event_type = 'call_attempt'
       and (p_phone_digits is null or i.phone_digits = p_phone_digits)
       and (p_from is null or i.event_at >= p_from) and (p_to is null or i.event_at < p_to)
  )
  select 'calls_without_consent'::text, c.p, 'gap'::text, count(*)::int, min(c.at), max(c.at), '{}'::jsonb
    from calls c
   where not exists (select 1 from public.compliance_index k
                      where k.tenant_id = p_tenant_id and k.phone_digits = c.p and k.event_type = 'consent' and k.event_at <= c.at)
   group by c.p;

  -- 2. Calls on a never-scrubbed number: no scrub or screening before the first call, and no scrub of
  --    the lead's campaign finished before it.
  return query
  with calls as (
    select i.phone_digits as p, i.event_at as at, i.source_id from public.compliance_index i
     where i.tenant_id = p_tenant_id and i.event_type = 'call_attempt'
       and (p_phone_digits is null or i.phone_digits = p_phone_digits)
       and (p_from is null or i.event_at >= p_from) and (p_to is null or i.event_at < p_to)
  ), firsts as (
    select c.p, min(c.at) as first_call, max(c.at) as last_call, count(*)::int as n from calls c group by c.p
  )
  select 'never_scrubbed'::text, f.p, 'gap'::text, f.n, f.first_call, f.last_call, '{}'::jsonb
    from firsts f
   where not exists (select 1 from public.compliance_index s
                      where s.tenant_id = p_tenant_id and s.phone_digits = f.p
                        and s.event_type in ('scrub', 'screening') and s.event_at <= f.first_call)
     and not exists (select 1 from public.compliance_index ci
                       join public.tenant_call_attempts a on a.id = ci.source_id and a.tenant_id = ci.tenant_id
                       join public.agent_leads l on l.id = a.lead_id and l.tenant_id = a.tenant_id
                       join public.tenant_campaigns tc on tc.id = l.campaign_id and tc.tenant_id = l.tenant_id
                      where ci.tenant_id = p_tenant_id and ci.phone_digits = f.p and ci.event_type = 'call_attempt'
                        and (tc.scrubbed_at <= f.first_call
                             or exists (select 1 from public.tenant_campaign_scrub_runs r
                                         where r.tenant_id = tc.tenant_id and r.campaign_id = tc.id
                                           and r.status = 'scrubbed' and r.finished_at <= f.first_call)));

  -- 3. Calls outside the legal window, as LA-2.4 judged each call when it was made. A call it could
  --    not judge (no state on the lead, stale rules, unknown zone) is undetermined, never a pass.
  return query
  select 'outside_legal_hours'::text, i.phone_digits,
         case when a.window_verdict = 'outside' then 'gap' else 'undetermined' end,
         count(*)::int, min(i.event_at), max(i.event_at),
         jsonb_build_object('states', coalesce(jsonb_agg(distinct a.window_state) filter (where a.window_state is not null), '[]'::jsonb),
                            'reasons', coalesce(jsonb_agg(distinct coalesce(a.window_reason, 'not_recorded')), '[]'::jsonb),
                            'calls', coalesce(jsonb_agg(jsonb_build_object('at', i.event_at, 'state', a.window_state, 'local_minute', a.window_local_minute,
                                                                           'start_minute', a.window_start_minute, 'end_minute', a.window_end_minute,
                                                                           'reason', a.window_reason) order by i.event_at), '[]'::jsonb))
    from public.compliance_index i
    join public.tenant_call_attempts a on a.id = i.source_id and a.tenant_id = i.tenant_id
   where i.tenant_id = p_tenant_id and i.event_type = 'call_attempt'
     and (p_phone_digits is null or i.phone_digits = p_phone_digits)
     and (p_from is null or i.event_at >= p_from) and (p_to is null or i.event_at < p_to)
     and a.window_verdict is distinct from 'inside'
   group by i.phone_digits, (a.window_verdict = 'outside');

  -- 4. Calls after the number went on our do-not-call list. We were told to stop. Active entries only:
  --    the list the dialler enforces and the dashboard counts (an inactive entry predates permanence).
  return query
  with calls as (
    select i.phone_digits as p, i.event_at as at from public.compliance_index i
     where i.tenant_id = p_tenant_id and i.event_type = 'call_attempt'
       and (p_phone_digits is null or i.phone_digits = p_phone_digits)
       and (p_from is null or i.event_at >= p_from) and (p_to is null or i.event_at < p_to)
  ), listed as (
    select k.phone_digits as p, min(k.event_at) as at from public.compliance_index k
      join public.tenant_do_not_call n on n.id = k.source_id and n.tenant_id = k.tenant_id
     where k.tenant_id = p_tenant_id and k.event_type = 'dnc_add' and k.source_table = 'tenant_do_not_call' and n.is_active
       and (p_phone_digits is null or k.phone_digits = p_phone_digits)
     group by k.phone_digits
  )
  select 'called_after_dnc'::text, c.p, 'gap'::text, count(*)::int, min(c.at), max(c.at), jsonb_build_object('listed_at', min(d.at))
    from calls c join listed d on d.p = c.p
   where c.at > d.at
   group by c.p;

  -- 5. Calls after a complaint. Until complaints are recorded (LA-6.4) this cannot be checked.
  if to_regclass('public.complaint') is null then
    return query select 'called_after_complaint'::text, p_phone_digits, 'undetermined'::text, 0, null::timestamptz, null::timestamptz,
                        jsonb_build_object('reason', 'Complaints are not recorded yet.');
  else
    return query
    with calls as (
      select i.phone_digits as p, i.event_at as at from public.compliance_index i
       where i.tenant_id = p_tenant_id and i.event_type = 'call_attempt'
         and (p_phone_digits is null or i.phone_digits = p_phone_digits)
         and (p_from is null or i.event_at >= p_from) and (p_to is null or i.event_at < p_to)
    ), complained as (
      select k.phone_digits as p, min(k.event_at) as at from public.compliance_index k
       where k.tenant_id = p_tenant_id and k.event_type = 'complaint'
         and (p_phone_digits is null or k.phone_digits = p_phone_digits)
       group by k.phone_digits
    )
    select 'called_after_complaint'::text, c.p, 'gap'::text, count(*)::int, min(c.at), max(c.at), jsonb_build_object('complaint_at', min(d.at))
      from calls c join complained d on d.p = c.p
     where c.at > d.at
     group by c.p;
  end if;

  -- 6. Consent artefact no longer valid at the call: consent given before the call is on file, but
  --    none of it covered the call by the one rule (compliance_consent_valid_at) — not retained and
  --    past its claim window, or failed. (A call with no consent before it is gap 1, not this.)
  return query
  with calls as (
    select i.phone_digits as p, i.event_at as at from public.compliance_index i
     where i.tenant_id = p_tenant_id and i.event_type = 'call_attempt'
       and (p_phone_digits is null or i.phone_digits = p_phone_digits)
       and (p_from is null or i.event_at >= p_from) and (p_to is null or i.event_at < p_to)
  )
  select 'consent_expired_before_call'::text, c.p, 'gap'::text, count(*)::int, min(c.at), max(c.at), '{}'::jsonb
    from calls c
   where exists (select 1 from public.compliance_index k
                  where k.tenant_id = p_tenant_id and k.phone_digits = c.p and k.event_type = 'consent' and k.event_at <= c.at)
     and not exists (
       select 1 from public.compliance_index k
         join public.tenant_consent_artefacts t on t.id = k.source_id and t.tenant_id = k.tenant_id
        where k.tenant_id = p_tenant_id and k.phone_digits = c.p and k.event_type = 'consent' and k.source_table = 'tenant_consent_artefacts'
          and public.compliance_consent_valid_at(t.capture_status, t.provider, t.consent_timestamp, t.captured_at, c.at, p_claim_hours))
   group by c.p;

  -- 7. A partner transfer accepted with no LA-6.2 verdict — from the day the gate first recorded one.
  if to_regclass('public.transfer_verdict') is null then
    return query select 'transfer_without_verdict'::text, p_phone_digits, 'undetermined'::text, 0, null::timestamptz, null::timestamptz,
                        jsonb_build_object('reason', 'The transfer gate is not set up yet.');
  else
    execute 'select min(evaluated_at) from public.transfer_verdict where tenant_id = $1' into v_first_verdict using p_tenant_id;
    if v_first_verdict is null then
      return query select 'transfer_without_verdict'::text, p_phone_digits, 'undetermined'::text, 0, null::timestamptz, null::timestamptz,
                          jsonb_build_object('reason', 'The transfer gate has not recorded a verdict yet.');
    else
      return query execute $q$
        select 'transfer_without_verdict'::text, public.compliance_lead_phone(l.values), 'gap'::text, count(*)::int,
               min(l.created_at), max(l.created_at), jsonb_build_object('since', $2, 'leads', jsonb_agg(l.id))
          from public.agent_leads l
         where l.tenant_id = $1 and l.partner_id is not null and l.created_at >= $2
           and ($3::text is null or l.id in (select i.lead_id from public.compliance_index i
                                              where i.tenant_id = $1 and i.phone_digits = $3 and i.lead_id is not null))
           and ($4::timestamptz is null or l.created_at >= $4) and ($5::timestamptz is null or l.created_at < $5)
           and public.compliance_lead_phone(l.values) is not null
           and not exists (select 1 from public.transfer_verdict v where v.tenant_id = $1 and v.lead_id = l.id)
         group by 2$q$
      using p_tenant_id, v_first_verdict, p_phone_digits, p_from, p_to;
    end if;
  end if;

  -- 8. A replacement (or other LA-3.10) disclosure required on a submitted application, never acknowledged.
  return query
  select 'disclosure_missing'::text, public.compliance_lead_phone(l.values), 'gap'::text, count(*)::int,
         min(ap.submitted_at), max(ap.submitted_at),
         jsonb_build_object('disclosures', coalesce(jsonb_agg(distinct ad.title) filter (where ad.title is not null), '[]'::jsonb), 'applications', jsonb_agg(distinct ap.id))
    from public.tenant_application_disclosures t
    join public.tenant_applications ap on ap.id = t.application_id and ap.tenant_id = t.tenant_id
    join public.agent_leads l on l.id = ap.lead_id and l.tenant_id = ap.tenant_id
    left join public.application_disclosures ad on ad.id = t.disclosure_id
   where t.tenant_id = p_tenant_id and t.status = 'required' and ap.submitted_at is not null
     and (p_phone_digits is null or ap.lead_id in (select i.lead_id from public.compliance_index i
                                                    where i.tenant_id = p_tenant_id and i.phone_digits = p_phone_digits and i.lead_id is not null))
     and (p_from is null or ap.submitted_at >= p_from) and (p_to is null or ap.submitted_at < p_to)
     and public.compliance_lead_phone(l.values) is not null
   group by 2;
end $$;
revoke all on function public.compliance_gaps(uuid, text, timestamptz, timestamptz, jsonb) from public, anon, authenticated, tenant_app;
grant execute on function public.compliance_gaps(uuid, text, timestamptz, timestamptz, jsonb) to service_role;

-- ─── holds that follow the person, not the lead's number today ─────────────────────────────────
-- A record about a lead is held when an active hold covers: the whole tenant; the record's own number,
-- the lead's number, or any number the index has ever held for the lead or its client; the client;
-- or any policy of the client (a policy hold — a commission dispute — reaches the calls behind it).
create or replace function public.legal_hold_active_for_lead(p_tenant_id uuid, p_lead_id uuid, p_phone text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with h as (
    select h.scope, h.scope_value from public.legal_hold h where h.tenant_id = p_tenant_id and h.released_at is null
  ), lead as (
    select l.contact_id, public.compliance_lead_phone(l.values) as phone from public.agent_leads l where l.tenant_id = p_tenant_id and l.id = p_lead_id
  )
  select exists (select 1 from h)
     and (exists (select 1 from h where h.scope = 'tenant_wide')
          or exists (select 1 from h where h.scope = 'phone_digits'
                       and (h.scope_value = p_phone
                            or h.scope_value = (select phone from lead)
                            or h.scope_value in (select i.phone_digits from public.compliance_index i
                                                  where i.tenant_id = p_tenant_id
                                                    and (i.lead_id = p_lead_id or i.contact_id = (select contact_id from lead)))))
          or exists (select 1 from h where h.scope = 'contact_id' and h.scope_value = (select contact_id::text from lead))
          or exists (select 1 from h where h.scope = 'policy_number'
                       and h.scope_value in (select pc.policy_number from public.policy_current pc
                                              where pc.tenant_id = p_tenant_id and pc.contact_id = (select contact_id from lead))))
$$;
revoke all on function public.legal_hold_active_for_lead(uuid, uuid, text) from public, anon, authenticated, tenant_app;
grant execute on function public.legal_hold_active_for_lead(uuid, uuid, text) to service_role;

-- ─── the purge: what the dry run showed is what the live run does ──────────────────────────────
alter table public.retention_run
  add column if not exists rules_fingerprint text,
  add column if not exists summary_delivered_count integer,
  add column if not exists summary_acknowledged_at timestamptz,
  add column if not exists summary_acknowledged_by uuid references public.users(id) on delete set null,
  add column if not exists live_skipped_at timestamptz,
  add column if not exists live_skipped_reason text;
create index if not exists retention_run_ack_by_idx on public.retention_run (summary_acknowledged_by) where summary_acknowledged_by is not null;

-- The rules a run resolved against (this tenant's and the platform's), as one value: a change to any
-- of them after a dry run means the dry run no longer describes what a live run would delete.
create or replace function public.retention_rules_fingerprint(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select md5(coalesce(string_agg(concat_ws('|', r.id, r.tenant_id, r.record_type, r.state, r.retain_days, r.action, r.effective_from), ';' order by r.id), ''))
    from public.retention_rule r
   where r.tenant_id = p_tenant_id or r.tenant_id is null
$$;
revoke all on function public.retention_rules_fingerprint(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.retention_rules_fingerprint(uuid) to service_role;

create or replace function public.retention_execute(p_tenant_id uuid, p_mode text, p_triggered_by text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_run uuid;
  v_live boolean := p_mode = 'live';
  v_window integer;
  v_results jsonb := '[]'::jsonb;
  v_held integer := 0;
  v_unruled text[] := '{}';
  v_type text;
  v_rules jsonb;
  m integer; h integer; p integer; v_old timestamptz; v_new timestamptz;
  v_tokens jsonb;
  pol record;
  v_dry_fingerprint text;
  v_dry_delivered integer;
  v_dry_ack timestamptz;
  v_fingerprint text := public.retention_rules_fingerprint(p_tenant_id);
begin
  if p_mode not in ('dry_run', 'live') then
    raise exception 'retention_execute: mode is dry_run or live';
  end if;
  if v_live then
    select coalesce(s.purge_dry_run_window_days, 7) into v_window from public.compliance_settings s where s.tenant_id = p_tenant_id;
    v_window := coalesce(v_window, 7);
    select r.rules_fingerprint, r.summary_delivered_count, r.summary_acknowledged_at into v_dry_fingerprint, v_dry_delivered, v_dry_ack
      from public.retention_run r
     where r.tenant_id = p_tenant_id and r.mode = 'dry_run' and r.finished_at >= now() - make_interval(days => v_window)
     order by r.finished_at desc limit 1;
    if not found then
      raise exception 'retention_execute: a live run needs a dry run in the last % days', v_window using errcode = 'check_violation';
    end if;
    -- The live run deletes what the dry run showed — not what different rules would select.
    if v_dry_fingerprint is distinct from v_fingerprint then
      raise exception 'retention_execute: the retention rules changed after the last dry run; run a new dry run first' using errcode = 'check_violation';
    end if;
    -- Someone must have seen what it will delete.
    if coalesce(v_dry_delivered, 0) = 0 and v_dry_ack is null then
      raise exception 'retention_execute: nobody has received or acknowledged the last dry run''s summary' using errcode = 'check_violation';
    end if;
    perform set_config('app.retention_purge', 'on', true);
  end if;
  insert into public.retention_run (tenant_id, mode, triggered_by, rules_fingerprint) values (p_tenant_id, p_mode, coalesce(p_triggered_by, 'manual'), v_fingerprint) returning id into v_run;

  foreach v_type in array array['consent_artefacts', 'call_attempt_logs', 'scrub_screening_results', 'transfer_verdicts', 'lead_data_unconverted',
                                'nurture_winback_candidates', 'complaint_records', 'policy_commission_records', 'compliance_evidence_reports'] loop
    select jsonb_object_agg(x.state, jsonb_build_object('days', x.retain_days, 'action', x.action)) into v_rules from public.retention_cutoffs(p_tenant_id, v_type) x;
    if v_rules is null or v_rules = '{}'::jsonb then
      v_unruled := v_unruled || v_type;
      continue;
    end if;

    if v_type = 'consent_artefacts' then
      -- Aged from its last reliance, not its capture: a consent a call or a transfer relied on last
      -- month is the defence for that contact, whenever it was captured.
      create temp table if not exists retention_due (id uuid, held boolean, at timestamptz) on commit drop;
      truncate retention_due;
      insert into retention_due
      select c.id, public.legal_hold_active_for_lead(p_tenant_id, c.lead_id, coalesce(c.phone_digits, public.compliance_lead_phone(l.values))), rel.last_relied
        from public.tenant_consent_artefacts c
        join public.agent_leads l on l.id = c.lead_id and l.tenant_id = c.tenant_id
        cross join lateral (
          select greatest(
                   coalesce(c.consent_timestamp, c.captured_at),
                   (select max(i.event_at) from public.compliance_index i
                     where i.tenant_id = c.tenant_id and i.event_type = 'call_attempt'
                       and i.phone_digits = coalesce(c.phone_digits, public.compliance_lead_phone(l.values))
                       and i.event_at >= coalesce(c.consent_timestamp, c.captured_at)),
                   (select max(v.evaluated_at) from public.transfer_verdict v
                     where v.tenant_id = c.tenant_id
                       and v.checks_json @> jsonb_build_array(jsonb_build_object('check', 'consent_artefact', 'result', 'pass', 'source_record_id', c.id::text)))
                 ) as last_relied
        ) rel
        cross join lateral (select coalesce(v_rules->upper(l.values->>'state'), v_rules->'**') r) rr
       where c.tenant_id = p_tenant_id and rr.r->>'action' = 'purge'
         and rel.last_relied < now() - make_interval(days => (rr.r->>'days')::int);
      select count(*), count(*) filter (where held), min(at), max(at) into m, h, v_old, v_new from retention_due;
      p := 0;
      if v_live then
        with d as (delete from public.tenant_consent_artefacts t using retention_due x where t.id = x.id and not x.held returning 1) select count(*) into p from d;
      end if;
      v_results := v_results || jsonb_build_array(jsonb_build_object('record_type', v_type, 'table', 'tenant_consent_artefacts', 'rows_matched', m, 'rows_held', h, 'rows_purged', p, 'oldest', v_old, 'newest', v_new,
                                                                     'note', 'Aged from the last call or transfer that relied on it.'));
      v_held := v_held + h;

    elsif v_type = 'call_attempt_logs' then
      create temp table if not exists retention_due (id uuid, held boolean, at timestamptz) on commit drop;
      truncate retention_due;
      insert into retention_due
      select a.id, public.legal_hold_active_for_lead(p_tenant_id, a.lead_id, coalesce(a.dialled_phone_digits, public.compliance_lead_phone(l.values))), a.attempted_at
        from public.tenant_call_attempts a
        join public.agent_leads l on l.id = a.lead_id and l.tenant_id = a.tenant_id
        cross join lateral (select coalesce(v_rules->upper(coalesce(a.window_state, l.values->>'state')), v_rules->'**') r) rr
       where a.tenant_id = p_tenant_id and rr.r->>'action' = 'purge'
         and a.attempted_at < now() - make_interval(days => (rr.r->>'days')::int);
      select count(*), count(*) filter (where held), min(at), max(at) into m, h, v_old, v_new from retention_due;
      p := 0;
      if v_live then
        delete from public.tenant_dial_dnc_checks k using retention_due x where k.attempt_id = x.id and not x.held;
        with d as (delete from public.tenant_call_attempts t using retention_due x where t.id = x.id and not x.held returning 1) select count(*) into p from d;
      end if;
      v_results := v_results || jsonb_build_array(jsonb_build_object('record_type', v_type, 'table', 'tenant_call_attempts', 'rows_matched', m, 'rows_held', h, 'rows_purged', p, 'oldest', v_old, 'newest', v_new));
      v_held := v_held + h;

    elsif v_type = 'scrub_screening_results' then
      -- No state on a screen: the all-states rule.
      if v_rules->'**'->>'action' = 'purge' then
        select count(*), count(*) filter (where public.legal_hold_active(p_tenant_id, s.phone_digits, null, null)), min(s.ts), max(s.ts) into m, h, v_old, v_new
          from public.screening_audit s where s.tenant_id = p_tenant_id and s.ts < now() - make_interval(days => (v_rules->'**'->>'days')::int);
        p := 0;
        if v_live then
          with d as (delete from public.screening_audit s where s.tenant_id = p_tenant_id and s.ts < now() - make_interval(days => (v_rules->'**'->>'days')::int)
                       and not public.legal_hold_active(p_tenant_id, s.phone_digits, null, null) returning 1) select count(*) into p from d;
        end if;
        v_results := v_results || jsonb_build_array(jsonb_build_object('record_type', v_type, 'table', 'screening_audit', 'rows_matched', m, 'rows_held', h, 'rows_purged', p, 'oldest', v_old, 'newest', v_new));
        v_held := v_held + h;
        select count(*), count(*) filter (where public.legal_hold_active(p_tenant_id, r.phone_digits, null, null)), min(r.rejected_at), max(r.rejected_at) into m, h, v_old, v_new
          from public.tenant_campaign_scrub_rejections r where r.tenant_id = p_tenant_id and r.rejected_at < now() - make_interval(days => (v_rules->'**'->>'days')::int);
        p := 0;
        if v_live then
          update public.lead_claim_items i set scrub_rejection_id = null from public.tenant_campaign_scrub_rejections r
           where i.scrub_rejection_id = r.id and r.tenant_id = p_tenant_id and r.rejected_at < now() - make_interval(days => (v_rules->'**'->>'days')::int)
             and not public.legal_hold_active(p_tenant_id, r.phone_digits, null, null);
          with d as (delete from public.tenant_campaign_scrub_rejections r where r.tenant_id = p_tenant_id and r.rejected_at < now() - make_interval(days => (v_rules->'**'->>'days')::int)
                       and not public.legal_hold_active(p_tenant_id, r.phone_digits, null, null) returning 1) select count(*) into p from d;
        end if;
        v_results := v_results || jsonb_build_array(jsonb_build_object('record_type', v_type, 'table', 'tenant_campaign_scrub_rejections', 'rows_matched', m, 'rows_held', h, 'rows_purged', p, 'oldest', v_old, 'newest', v_new));
        v_held := v_held + h;
      end if;

    elsif v_type = 'transfer_verdicts' then
      select count(*), count(*) filter (where public.legal_hold_active(p_tenant_id, v.phone_digits, null, null)), min(v.evaluated_at), max(v.evaluated_at) into m, h, v_old, v_new
        from public.transfer_verdict v cross join lateral (select coalesce(v_rules->v.carrier_state, v_rules->'**') r) rr
       where v.tenant_id = p_tenant_id and rr.r->>'action' = 'purge' and v.evaluated_at < now() - make_interval(days => (rr.r->>'days')::int);
      p := 0;
      if v_live then
        with d as (delete from public.transfer_verdict v
                    where v.tenant_id = p_tenant_id and coalesce(v_rules->v.carrier_state, v_rules->'**')->>'action' = 'purge'
                      and v.evaluated_at < now() - make_interval(days => (coalesce(v_rules->v.carrier_state, v_rules->'**')->>'days')::int)
                      and not public.legal_hold_active(p_tenant_id, v.phone_digits, null, null) returning 1) select count(*) into p from d;
      end if;
      v_results := v_results || jsonb_build_array(jsonb_build_object('record_type', v_type, 'table', 'transfer_verdict', 'rows_matched', m, 'rows_held', h, 'rows_purged', p, 'oldest', v_old, 'newest', v_new));
      v_held := v_held + h;

    elsif v_type = 'lead_data_unconverted' then
      -- Never converted: no submitted application, no client with a policy. The row stays (vendor cost
      -- reporting counts it); the person's fields go. The number stays only while a call or consent
      -- record still within its own retention points at the lead.
      create temp table if not exists retention_due (id uuid, held boolean, at timestamptz) on commit drop;
      truncate retention_due;
      insert into retention_due
      select l.id, public.legal_hold_active_for_lead(p_tenant_id, l.id, public.compliance_lead_phone(l.values)), l.created_at
        from public.agent_leads l
        cross join lateral (select coalesce(v_rules->upper(l.values->>'state'), v_rules->'**') r) rr
       where l.tenant_id = p_tenant_id and rr.r->>'action' in ('purge', 'anonymise')
         and l.created_at < now() - make_interval(days => (rr.r->>'days')::int)
         and not (l.values ? '_retention_purged') and not (l.values ? '_erased')
         and not exists (select 1 from public.tenant_applications a where a.tenant_id = l.tenant_id and a.lead_id = l.id and a.submitted_at is not null)
         and not exists (select 1 from public.policy_current pc where pc.tenant_id = l.tenant_id and l.contact_id is not null and pc.contact_id = l.contact_id);
      select count(*), count(*) filter (where held), min(at), max(at) into m, h, v_old, v_new from retention_due;
      p := 0;
      if v_live then
        with u as (
          update public.agent_leads l
             set values = jsonb_strip_nulls(jsonb_build_object(
                   '_retention_purged', now()::date,
                   'state', l.values->>'state',
                   'phone', case when exists (select 1 from public.tenant_call_attempts a where a.lead_id = l.id)
                                   or exists (select 1 from public.tenant_consent_artefacts c where c.lead_id = l.id)
                                 then l.values->>'phone' end))
            from retention_due x where l.id = x.id and not x.held
          returning 1) select count(*) into p from u;
      end if;
      v_results := v_results || jsonb_build_array(jsonb_build_object('record_type', v_type, 'table', 'agent_leads', 'rows_matched', m, 'rows_held', h, 'rows_purged', p, 'oldest', v_old, 'newest', v_new,
                                                                     'note', 'Personal fields removed; the row stays for vendor cost reporting.'));
      v_held := v_held + h;

    elsif v_type = 'nurture_winback_candidates' then
      if v_rules->'**'->>'action' = 'purge' then
        select count(*), 0, min(w.created_at), max(w.created_at) into m, h, v_old, v_new
          from public.winback_candidate w where w.tenant_id = p_tenant_id and w.created_at < now() - make_interval(days => (v_rules->'**'->>'days')::int);
        select count(*) into h from public.winback_candidate w
         where w.tenant_id = p_tenant_id and w.created_at < now() - make_interval(days => (v_rules->'**'->>'days')::int)
           and public.legal_hold_active(p_tenant_id, null, null, w.source_policy_number);
        p := 0;
        if v_live then
          with d as (delete from public.winback_candidate w where w.tenant_id = p_tenant_id and w.created_at < now() - make_interval(days => (v_rules->'**'->>'days')::int)
                       and not public.legal_hold_active(p_tenant_id, null, null, w.source_policy_number) returning 1) select count(*) into p from d;
        end if;
        v_results := v_results || jsonb_build_array(jsonb_build_object('record_type', v_type, 'table', 'winback_candidate', 'rows_matched', m, 'rows_held', h, 'rows_purged', p, 'oldest', v_old, 'newest', v_new));
        v_held := v_held + h;
      end if;

    elsif v_type = 'complaint_records' then
      select count(*), count(*) filter (where public.legal_hold_active(p_tenant_id, c.phone_digits, c.contact_id, c.policy_number)), min(c.received_at), max(c.received_at) into m, h, v_old, v_new
        from public.complaint c cross join lateral (select coalesce(v_rules->c.regulator_state, v_rules->'**') r) rr
       where c.tenant_id = p_tenant_id and c.status = 'resolved' and c.complainant_name is distinct from null
         and c.received_at < now() - make_interval(days => (rr.r->>'days')::int);
      p := 0;
      if v_live then
        with u as (update public.complaint c set complainant_name = null, phone_digits = null, contact_id = null, policy_number = null,
                          summary = 'Anonymised under the retention schedule.', response_text = case when c.response_text is null then null else 'Anonymised under the retention schedule.' end,
                          attachments_json = '[]'::jsonb, response_attachments_json = '[]'::jsonb, notes = null
                    where c.tenant_id = p_tenant_id and c.status = 'resolved' and c.complainant_name is distinct from null
                      and c.received_at < now() - make_interval(days => (coalesce(v_rules->c.regulator_state, v_rules->'**')->>'days')::int)
                      and not public.legal_hold_active(p_tenant_id, c.phone_digits, c.contact_id, c.policy_number) returning 1) select count(*) into p from u;
      end if;
      v_results := v_results || jsonb_build_array(jsonb_build_object('record_type', v_type, 'table', 'complaint', 'rows_matched', m, 'rows_held', h, 'rows_purged', p, 'oldest', v_old, 'newest', v_new, 'note', 'Anonymised, kept.'));
      v_held := v_held + h;

    elsif v_type = 'policy_commission_records' then
      -- Policies that ended more than the period ago: the person's identifiers are erased from the
      -- carrier rows behind them; the money and the policy stay.
      m := 0; h := 0; p := 0; v_old := null; v_new := null;
      for pol in
        select pc.carrier_id, pc.policy_number, pc.contact_id, coalesce(pc.termination_date, pc.lapsed_on) as ended,
               public.legal_hold_active(p_tenant_id, null, pc.contact_id, pc.policy_number) as held
          from public.policy_current pc
          cross join lateral (select v_rules->'**' r) rr
         where pc.tenant_id = p_tenant_id and coalesce(pc.termination_date, pc.lapsed_on) is not null and rr.r->>'action' = 'anonymise'
           and coalesce(pc.termination_date, pc.lapsed_on) < (now() - make_interval(days => (rr.r->>'days')::int))::date
           and pc.contact_id is not null
      loop
        m := m + 1;
        v_old := least(coalesce(v_old, pol.ended), pol.ended);
        v_new := greatest(coalesce(v_new, pol.ended), pol.ended);
        if pol.held then h := h + 1; continue; end if;
        if v_live then
          v_tokens := public.data_subject_discover(p_tenant_id, null, null, pol.contact_id);
          perform set_config('app.data_subject_deletion', 'retention', true);
          update public.raw_rows r set payload = public.erase_matching_values(r.payload, array(select jsonb_array_elements_text(v_tokens->'tokens')), array(select jsonb_array_elements_text(v_tokens->'digits')))
            from public.policy_snapshot s where s.tenant_id = p_tenant_id and s.carrier_id = pol.carrier_id and s.policy_number = pol.policy_number and r.id = s.raw_row_id;
          update public.policy_snapshot s set extra = public.erase_matching_values(s.extra, array(select jsonb_array_elements_text(v_tokens->'tokens')), array(select jsonb_array_elements_text(v_tokens->'digits')))
           where s.tenant_id = p_tenant_id and s.carrier_id = pol.carrier_id and s.policy_number = pol.policy_number;
          update public.policy_current pc set extra = public.erase_matching_values(pc.extra, array(select jsonb_array_elements_text(v_tokens->'tokens')), array(select jsonb_array_elements_text(v_tokens->'digits')))
           where pc.tenant_id = p_tenant_id and pc.carrier_id = pol.carrier_id and pc.policy_number = pol.policy_number;
          perform set_config('app.data_subject_deletion', '', true);
          p := p + 1;
        end if;
      end loop;
      v_results := v_results || jsonb_build_array(jsonb_build_object('record_type', v_type, 'table', 'policy_current', 'rows_matched', m, 'rows_held', h, 'rows_purged', p, 'oldest', v_old, 'newest', v_new,
                                                                     'note', 'Anonymised, kept: the carrier rows behind each policy lose the person''s identifiers.'));
      v_held := v_held + h;

    elsif v_type = 'compliance_evidence_reports' then
      v_results := v_results || jsonb_build_array(jsonb_build_object('record_type', v_type, 'table', null, 'rows_matched', 0, 'rows_held', 0, 'rows_purged', 0,
                                                                     'note', 'No report copies are stored; each report is generated from the index when asked for.'));
    end if;
  end loop;

  -- Stated, never run: the do-not-call list.
  v_results := v_results || jsonb_build_array(jsonb_build_object('record_type', 'internal_dnc', 'table', 'tenant_do_not_call', 'rows_matched', 0, 'rows_held', 0, 'rows_purged', 0, 'note', 'Never deleted.'));
  update public.retention_run set finished_at = now(), results_json = v_results, held_count = v_held, unruled = v_unruled where id = v_run;
  -- The win-back guard's exception ends with this run.
  perform set_config('app.retention_purge', '', true);
  return v_run;
end $$;
revoke all on function public.retention_execute(uuid, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.retention_execute(uuid, text, text) to service_role;

-- The schedule: a dry run first (its summary is emailed by the app), and the live run once the window
-- has passed — only if that summary reached someone (or was acknowledged) and the rules are unchanged.
-- Otherwise the live run is skipped, the dry run says why (the dashboard shows it), and a fresh dry
-- run follows the next day. One tenant failing never stops the others.
create or replace function public.retention_scheduled()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  s record;
  v_dry_id uuid;
  v_dry_fingerprint text;
  v_dry_delivered integer;
  v_dry_ack timestamptz;
  v_dry_skipped timestamptz;
  v_dry timestamptz;
  v_live timestamptz;
  v_reason text;
  v_out jsonb := '[]'::jsonb;
begin
  for s in select * from public.compliance_settings where purge_schedule_enabled loop
    v_dry_id := null; v_dry := null; v_dry_fingerprint := null; v_dry_delivered := null; v_dry_ack := null; v_dry_skipped := null;
    select r.id, r.finished_at, r.rules_fingerprint, r.summary_delivered_count, r.summary_acknowledged_at, r.live_skipped_at
      into v_dry_id, v_dry, v_dry_fingerprint, v_dry_delivered, v_dry_ack, v_dry_skipped
      from public.retention_run r where r.tenant_id = s.tenant_id and r.mode = 'dry_run' and r.finished_at is not null order by r.finished_at desc limit 1;
    select max(finished_at) into v_live from public.retention_run where tenant_id = s.tenant_id and mode = 'live';
    begin
      if v_dry is null or v_dry < now() - make_interval(days => s.purge_dry_run_window_days) or (v_live is not null and v_live > v_dry) or v_dry_skipped is not null then
        perform public.retention_execute(s.tenant_id, 'dry_run', 'schedule');
        v_out := v_out || jsonb_build_array(jsonb_build_object('tenant', s.tenant_id, 'ran', 'dry_run'));
      elsif v_dry <= now() - make_interval(days => greatest(s.purge_dry_run_window_days - 1, 1)) and (v_live is null or v_live < v_dry) then
        v_reason := case
          when v_dry_fingerprint is distinct from public.retention_rules_fingerprint(s.tenant_id) then 'rules_changed'
          when coalesce(v_dry_delivered, 0) = 0 and v_dry_ack is null then 'summary_not_delivered'
        end;
        if v_reason is not null then
          update public.retention_run set live_skipped_at = now(), live_skipped_reason = v_reason where id = v_dry_id;
          v_out := v_out || jsonb_build_array(jsonb_build_object('tenant', s.tenant_id, 'ran', 'skipped', 'reason', v_reason));
        else
          perform public.retention_execute(s.tenant_id, 'live', 'schedule');
          v_out := v_out || jsonb_build_array(jsonb_build_object('tenant', s.tenant_id, 'ran', 'live'));
        end if;
      end if;
    exception when others then
      if v_dry_id is not null then
        update public.retention_run set live_skipped_at = now(), live_skipped_reason = left('failed: ' || sqlerrm, 300) where id = v_dry_id;
      end if;
      v_out := v_out || jsonb_build_array(jsonb_build_object('tenant', s.tenant_id, 'ran', 'failed', 'error', sqlerrm));
    end;
  end loop;
  return v_out;
end $$;
revoke all on function public.retention_scheduled() from public, anon, authenticated, tenant_app;
grant execute on function public.retention_scheduled() to service_role;

-- ─── the dashboard: a skipped purge is said ────────────────────────────────────────────────────
create or replace function public.compliance_dashboard_figures(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with called as (
    select distinct i.phone_digits from public.compliance_index i where i.tenant_id = p_tenant_id and i.event_type = 'call_attempt'
  ), consented as (
    select distinct k.phone_digits from public.compliance_index k where k.tenant_id = p_tenant_id and k.event_type = 'consent'
  )
  select jsonb_build_object(
    'called_numbers', (select count(*) from called),
    'consented_called_numbers', (select count(*) from called c where exists (select 1 from consented s where s.phone_digits = c.phone_digits)),
    'dnc_active', (select count(*) from public.tenant_do_not_call d where d.tenant_id = p_tenant_id and d.is_active),
    'campaigns_active', (select count(*) from public.tenant_campaigns c where c.tenant_id = p_tenant_id and c.status = 'active'),
    'campaigns_scrubbed_30d', (select count(*) from public.tenant_campaigns c where c.tenant_id = p_tenant_id and c.status = 'active' and c.scrubbed_at >= now() - interval '30 days'),
    'transfers_accepted', (select count(*) from public.transfer_verdict v where v.tenant_id = p_tenant_id and v.stage = 'submit' and v.verdict <> 'reject'),
    'transfers_screened_before', (select count(*) from public.transfer_verdict v where v.tenant_id = p_tenant_id and v.stage = 'submit' and v.verdict <> 'reject' and v.screened_before_transfer),
    'deletions_open', (select count(*) from public.deletion_request r where r.tenant_id = p_tenant_id and r.status in ('received', 'verifying', 'verified', 'scheduled')),
    'holds_active', (select count(*) from public.legal_hold h where h.tenant_id = p_tenant_id and h.released_at is null),
    'last_run_held', (select r.held_count from public.retention_run r where r.tenant_id = p_tenant_id order by r.started_at desc limit 1),
    'purge_scheduled', coalesce((select s.purge_schedule_enabled from public.compliance_settings s where s.tenant_id = p_tenant_id), false),
    'unruled_types', coalesce((select to_jsonb(r.unruled) from public.retention_run r where r.tenant_id = p_tenant_id order by r.started_at desc limit 1), '[]'::jsonb),
    -- The latest skipped scheduled purge with no live run since.
    'purge_live_skipped', (select jsonb_build_object('at', r.live_skipped_at, 'reason', r.live_skipped_reason)
                             from public.retention_run r
                            where r.tenant_id = p_tenant_id and r.live_skipped_at is not null
                              and not exists (select 1 from public.retention_run x where x.tenant_id = p_tenant_id and x.mode = 'live' and x.started_at > r.live_skipped_at)
                            order by r.live_skipped_at desc limit 1)
  )
$$;
revoke all on function public.compliance_dashboard_figures(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.compliance_dashboard_figures(uuid) to service_role;

-- ─── deletion: who asked, by which channel ─────────────────────────────────────────────────────
alter table public.deletion_request
  add column if not exists requester_phone_digits text,
  add column if not exists requester_email text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'deletion_request_requester_phone') then
    alter table public.deletion_request add constraint deletion_request_requester_phone check (requester_phone_digits is null or requester_phone_digits ~ '^[0-9]{10}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deletion_request_requester_email') then
    alter table public.deletion_request add constraint deletion_request_requester_email check (requester_email is null or (requester_email = lower(requester_email) and requester_email like '%_@_%'));
  end if;
end $$;

-- The channel identity was matched on cannot change once the request is verified (only cleared with
-- the rest of the person's identifiers when it completes).
create or replace function public.deletion_request_guard()
returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $$
begin
  if new.tenant_id <> old.tenant_id or new.received_at <> old.received_at or new.created_at <> old.created_at
     or new.phone_digits is distinct from old.phone_digits and old.status <> 'received' then
    raise exception 'deletion_request: what was asked, and when, cannot change' using errcode = 'check_violation';
  end if;
  if (new.requester_phone_digits is distinct from old.requester_phone_digits or new.requester_email is distinct from old.requester_email)
     and old.status not in ('received', 'verifying')
     and not (new.status = 'completed' and new.requester_phone_digits is null and new.requester_email is null) then
    raise exception 'deletion_request: the channel identity was verified on cannot change' using errcode = 'check_violation';
  end if;
  if old.status in ('completed', 'rejected', 'cancelled') and (to_jsonb(new) - 'updated_at' - 'subject_json' - 'certificate_url') is distinct from (to_jsonb(old) - 'updated_at' - 'subject_json' - 'certificate_url') then
    raise exception 'deletion_request: a % request is final', old.status using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ─── settings: the change and its record, together ─────────────────────────────────────────────
-- p_row: column → new value (only compliance_settings columns); p_changes: [{section, setting,
-- old_value, new_value}]. Both land, or neither does.
create or replace function public.compliance_settings_save(p_tenant_id uuid, p_user_id uuid, p_row jsonb, p_changes jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  k text;
  v_set text := '';
begin
  if p_tenant_id is null or jsonb_typeof(p_row) is distinct from 'object' or jsonb_typeof(p_changes) is distinct from 'array'
     or p_row = '{}'::jsonb or jsonb_array_length(p_changes) = 0 then
    raise exception 'compliance_settings_save: a tenant, the values and their change records are required' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_row) loop
    if k in ('tenant_id', 'updated_by', 'updated_at')
       or not exists (select 1 from pg_attribute a where a.attrelid = 'public.compliance_settings'::regclass and a.attname = k and a.attnum > 0 and not a.attisdropped) then
      raise exception 'compliance_settings_save: % is not a setting', k using errcode = '22023';
    end if;
    v_set := v_set || format('%I = r.%I, ', k, k);
  end loop;
  insert into public.compliance_settings (tenant_id) values (p_tenant_id) on conflict (tenant_id) do nothing;
  execute format('update public.compliance_settings s set %s updated_by = $2, updated_at = now() from jsonb_populate_record(null::public.compliance_settings, $1) r where s.tenant_id = $3', v_set)
    using p_row, p_user_id, p_tenant_id;
  insert into public.compliance_setting_change (tenant_id, section, setting, old_value, new_value, changed_by)
  select p_tenant_id, c->>'section', c->>'setting', nullif(c->'old_value', 'null'::jsonb), nullif(c->'new_value', 'null'::jsonb), p_user_id
    from jsonb_array_elements(p_changes) c;
end $$;
revoke all on function public.compliance_settings_save(uuid, uuid, jsonb, jsonb) from public, anon, authenticated, tenant_app;
grant execute on function public.compliance_settings_save(uuid, uuid, jsonb, jsonb) to service_role;

-- ─── self-check ─────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_unkeyed integer;
begin
  -- The consent rule's corpus (the same cases as lib/compliance/consentValidity.test.mjs).
  if public.compliance_consent_valid_at('claimed', 'trustedform', '2026-01-01T10:00Z', '2026-01-01T10:05Z', '2026-01-01T09:00Z', '{"trustedform": 72}') is distinct from false
     or public.compliance_consent_valid_at('claimed', 'trustedform', '2026-01-01T10:00Z', '2026-01-01T10:05Z', '2026-06-01T09:00Z', '{"trustedform": 72}') is distinct from true
     or public.compliance_consent_valid_at('pending', 'trustedform', '2026-01-01T10:00Z', '2026-01-01T10:05Z', '2026-01-04T10:00Z', '{"trustedform": 72}') is distinct from true
     or public.compliance_consent_valid_at('pending', 'trustedform', '2026-01-01T10:00Z', '2026-01-01T10:05Z', '2026-01-04T10:01Z', '{"trustedform": 72}') is distinct from false
     or public.compliance_consent_valid_at('pending', 'jornaya', null, '2026-01-01T10:05Z', '2027-01-01T00:00Z', '{"trustedform": 72, "jornaya": null}') is distinct from true
     or public.compliance_consent_valid_at('expired', 'trustedform', '2026-01-01T10:00Z', '2026-01-01T10:05Z', '2026-01-01T11:00Z', '{"trustedform": 72}') is distinct from false then
    raise exception '20261015630000: compliance_consent_valid_at disagrees with consentValidAt';
  end if;
  select count(*) into v_unkeyed from public.tenant_call_attempts a join public.agent_leads l on l.id = a.lead_id and l.tenant_id = a.tenant_id
   where a.dialled_phone_digits is null and public.compliance_lead_phone(l.values) is not null;
  if v_unkeyed > 0 then
    raise exception '20261015630000: % call(s) with a lead number were not given their number', v_unkeyed;
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'compliance_index_sync' and tgrelid = 'public.tenant_consent_artefacts'::regclass and tgenabled = 'O') then
    raise exception '20261015630000: the consent index trigger was left disabled';
  end if;
  perform * from public.compliance_gaps('00000000-0000-0000-0000-000000000000'::uuid, '8175550142', null, null, '{"trustedform": 72}'::jsonb);
  perform public.compliance_dashboard_figures('00000000-0000-0000-0000-000000000000'::uuid);
  if public.legal_hold_active_for_lead('00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid, '8175550142') then
    raise exception '20261015630000: a tenant with no holds reported a hold';
  end if;
  if has_function_privilege('tenant_app', 'public.compliance_settings_save(uuid, uuid, jsonb, jsonb)', 'EXECUTE') then
    raise exception '20261015630000: only the server may save settings';
  end if;
end $$;
