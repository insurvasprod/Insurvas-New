-- ============================================================================
-- Pending migrations — 7 files, each in its own transaction
-- Generated 2026-10-15 by scripts/build-pending-bundle.mjs. Do not hand-edit; regenerate.
--
-- HOW TO RUN: Supabase dashboard → SQL editor → paste this whole file → Run.
-- Each file is begin … commit on its own. The SQL editor STOPS at the first error: that file is
-- rolled back, the files before it stay applied, and nothing after it runs. Fix the named file,
-- regenerate, and run the whole script again — re-running is safe: the files use
-- create-or-replace / if-not-exists, and history rows use on-conflict-do-nothing.
--
-- AFTERWARDS: node --env-file=.env.local scripts/verify-applied-migrations.mjs
--
-- Files, in order:
--    1. 20261015110000_la_6_2_transfer_gate.sql
--    2. 20261015120000_la_6_3_evidence_report.sql
--    3. 20261015130000_la_6_4_complaints.sql
--    4. 20261015140000_la_6_5_consumer_deletion.sql
--    5. 20261015150000_la_6_6_retention.sql
--    6. 20261015160000_la_6_7_dashboard_figures.sql
--    7. 20261015170000_la_6_8_compliance_settings.sql
-- ============================================================================

-- ─── [1/7] 20261015110000_la_6_2_transfer_gate.sql ───────────────────────────────
begin;

-- LA-6.2 (Notion sprint, Module 6 — Compliance) · the pre-transfer gate and its recorded verdict.
--
-- Before a partner's transfer is accepted, every check runs once (each in the module that owns it —
-- LA-1.5 screening, LA-2.3 do-not-call, LA-2.6 consent, LA-1.24 existing customer, LA-2.4 calling
-- hours, LA-1.3 partner product approval) and ONE row records the verdict, with every check's answer
-- and a pointer to the record that produced it. That row answers "why did you accept that call?".
--
--   transfer_verdict      one row per evaluation: on number entry (the real gate, before anyone is
--                         connected) and again at submit. Append-only: the only change ever made is
--                         linking the lead once it exists (lead_id, null → value).
--   compliance_settings   one row per tenant: the LA-6 settings (LA-6.8 adds the screen and the
--                         rest). For the gate: which optional checks run, whether a missing consent
--                         artefact warns or blocks (default warn), and the time budget. The litigator
--                         and internal do-not-call checks have no switch: they always run.
--
-- The verdict is indexed by LA-6.1 (event 'transfer_verdict').
--
-- Requires 20261015100000 (LA-6.1). Additive. Rollback:
--   drop trigger if exists compliance_index_sync on public.transfer_verdict;
--   drop table if exists public.transfer_verdict, public.compliance_settings;
--   (the view keeps a branch reading transfer_verdict: rebuild it from 20261015100000 first)

create table if not exists public.compliance_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  gate_consent_missing text not null default 'warn',
  gate_timeout_ms integer not null default 2000,
  gate_check_federal_dnc boolean not null default true,
  gate_check_consent boolean not null default true,
  gate_check_existing_customer boolean not null default true,
  gate_check_calling_hours boolean not null default true,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint compliance_settings_gate_consent check (gate_consent_missing in ('warn', 'block')),
  constraint compliance_settings_gate_timeout check (gate_timeout_ms between 500 and 10000)
);
alter table public.compliance_settings enable row level security;
drop policy if exists compliance_settings_read on public.compliance_settings;
create policy compliance_settings_read on public.compliance_settings for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.compliance_settings from public, anon, authenticated;
revoke delete, truncate on public.compliance_settings from service_role, tenant_app;
revoke insert, update on public.compliance_settings from tenant_app;
grant select on public.compliance_settings to tenant_app;
grant select, insert, update on public.compliance_settings to service_role;

create table if not exists public.transfer_verdict (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  partner_id uuid references public.partners(id) on delete set null,
  partner_user_id uuid references public.users(id) on delete set null,
  submission_id uuid,
  -- Null only when the number was not a valid US number (that is itself the reject).
  phone_digits text,
  lead_id uuid references public.agent_leads(id) on delete set null,
  product_code text not null,
  carrier_state text,
  stage text not null,
  verdict text not null,
  checks_json jsonb not null,
  blocking_reason text,
  warnings_json jsonb not null default '[]'::jsonb,
  evaluated_at timestamptz not null default now(),
  total_duration_ms integer not null,
  screened_before_transfer boolean not null,
  constraint transfer_verdict_phone check (phone_digits is null or phone_digits ~ '^[0-9]{10}$'),
  constraint transfer_verdict_stage check (stage in ('number_entry', 'submit')),
  constraint transfer_verdict_verdict check (verdict in ('accept', 'accept_with_warnings', 'reject')),
  constraint transfer_verdict_reject_reason check ((verdict = 'reject') = (blocking_reason is not null)),
  constraint transfer_verdict_reject_no_lead check (verdict <> 'reject' or lead_id is null),
  constraint transfer_verdict_checks check (jsonb_typeof(checks_json) = 'array' and jsonb_array_length(checks_json) > 0),
  constraint transfer_verdict_state check (carrier_state is null or carrier_state ~ '^[A-Z]{2}$')
);
create index if not exists transfer_verdict_partner_idx on public.transfer_verdict (tenant_id, partner_id, evaluated_at desc);
create index if not exists transfer_verdict_submission_idx on public.transfer_verdict (tenant_id, submission_id, evaluated_at) where submission_id is not null;
create index if not exists transfer_verdict_phone_idx on public.transfer_verdict (tenant_id, phone_digits, evaluated_at) where phone_digits is not null;
create index if not exists transfer_verdict_lead_idx on public.transfer_verdict (lead_id) where lead_id is not null;
create index if not exists transfer_verdict_partner_fk_idx on public.transfer_verdict (partner_id) where partner_id is not null;
create index if not exists transfer_verdict_user_idx on public.transfer_verdict (partner_user_id) where partner_user_id is not null;

alter table public.transfer_verdict enable row level security;
drop policy if exists transfer_verdict_read on public.transfer_verdict;
create policy transfer_verdict_read on public.transfer_verdict for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.transfer_verdict from public, anon, authenticated;
revoke insert, update, delete, truncate on public.transfer_verdict from tenant_app;
revoke delete, truncate on public.transfer_verdict from service_role;
grant select on public.transfer_verdict to tenant_app;
grant select, insert, update on public.transfer_verdict to service_role;

-- Evidence does not change: the only update allowed links the lead once (null → value), and only on
-- an accepted verdict (the check constraint refuses it on a reject). A lead deleted later sets it
-- back to null through the foreign key, which is the one other change let through.
create or replace function public.transfer_verdict_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if (to_jsonb(new) - 'lead_id') is distinct from (to_jsonb(old) - 'lead_id') then
    raise exception 'transfer_verdict is evidence: only the lead link may be set' using errcode = 'check_violation';
  end if;
  if old.lead_id is not null and new.lead_id is not null and new.lead_id <> old.lead_id then
    raise exception 'transfer_verdict: the lead link is set once' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function public.transfer_verdict_guard() from public, anon, authenticated, tenant_app, service_role;
drop trigger if exists transfer_verdict_guard on public.transfer_verdict;
create trigger transfer_verdict_guard before update on public.transfer_verdict for each row execute function public.transfer_verdict_guard();

-- ─── LA-6.1: verdicts are findable by number ────────────────────────────────────────────────────
select public.compliance_index_add_source('transfer_verdict', $branch$
  select v.tenant_id, v.phone_digits, l.contact_id, v.lead_id, 'transfer_verdict'::text, v.evaluated_at,
         'transfer_verdict'::text, v.id, '00000000-0000-0000-0000-000000000000'::uuid,
         ('Transfer ' || replace(v.verdict, '_', ' ') || coalesce(': ' || replace(v.blocking_reason, '_', ' '), '')
           || case v.stage when 'number_entry' then ' (on number entry)' else ' (at submit)' end)::text,
         'LA-6.2'::text
    from public.transfer_verdict v
    left join public.agent_leads l on l.id = v.lead_id and l.tenant_id = v.tenant_id
   where v.phone_digits is not null
$branch$);

drop trigger if exists compliance_index_sync on public.transfer_verdict;
create trigger compliance_index_sync after insert or update or delete on public.transfer_verdict for each row execute function public.compliance_index_sync();

-- ─── self-check ─────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if position('''transfer_verdict''' in pg_get_viewdef('public.compliance_index_source'::regclass, true)) = 0 then
    raise exception '20261015110000: the index does not read transfer verdicts';
  end if;
  if has_table_privilege('service_role', 'public.transfer_verdict', 'DELETE') or has_table_privilege('tenant_app', 'public.transfer_verdict', 'INSERT') then
    raise exception '20261015110000: verdicts are written by the server only and never deleted';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'transfer_verdict_guard' and tgrelid = 'public.transfer_verdict'::regclass) then
    raise exception '20261015110000: the verdict guard is missing';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261015110000', 'la_6_2_transfer_gate') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [2/7] 20261015120000_la_6_3_evidence_report.sql ─────────────────────────────
begin;

-- LA-6.3 (Notion sprint, Module 6 — Compliance) · the compliance evidence report: what we hold about a
-- number — and what is missing.
--
--   tenant_call_attempts.window_*   LA-2.4's own answer for each call, recorded when the call is
--                                   written: inside / outside / undetermined, with the reason and the
--                                   state. It is tenant_dial_window's verdict at the call's time —
--                                   the same function the dialer enforces with — kept on the call
--                                   (the module that owns the subject keeps the record). Asking it
--                                   live for every call of a book took 6.5 s for 19,433 calls.
--   compliance_gaps(...)            the eight gap checks, computed (never stored), for one number or a
--                                   whole book. The per-number report and the book-wide scan (and the
--                                   LA-6.7 dashboard) all read this one function, so they cannot
--                                   disagree. A check that cannot be computed answers 'undetermined'.
--   compliance_report_log           every report generation: who, what scope, which format, when.
--                                   A report discloses personal data; the log says who has seen what.
--
-- The claim windows for consent certificates are LA-2.6's (lib/consent/claimWindow.ts) and are passed
-- in by the caller, not restated here.
--
-- Requires 20261015100000 (LA-6.1). Additive. Rollback:
--   drop trigger if exists tenant_call_attempts_window_record on public.tenant_call_attempts;
--   drop function if exists public.tenant_call_attempts_window_record(), public.compliance_gaps(uuid, text, timestamptz, timestamptz, jsonb);
--   alter table public.tenant_call_attempts drop column if exists window_verdict, drop column if exists window_reason,
--     drop column if exists window_state, drop column if exists window_local_minute,
--     drop column if exists window_start_minute, drop column if exists window_end_minute;
--   drop table if exists public.compliance_report_log;

-- ─── LA-2.4's answer, recorded on each call ─────────────────────────────────────────────────────
alter table public.tenant_call_attempts
  add column if not exists window_verdict text,
  add column if not exists window_reason text,
  add column if not exists window_state text,
  add column if not exists window_local_minute integer,
  add column if not exists window_start_minute integer,
  add column if not exists window_end_minute integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_call_attempts_window_verdict') then
    alter table public.tenant_call_attempts add constraint tenant_call_attempts_window_verdict
      check (window_verdict is null or window_verdict in ('inside', 'outside', 'undetermined'));
  end if;
end $$;

-- The reasons tenant_dial_window gives when it cannot decide (no state, stale rules, no time zone).
create or replace function public.tenant_call_attempts_window_record()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_state text;
  v_campaign uuid;
  w record;
begin
  select l.values->>'state', l.campaign_id into v_state, v_campaign
    from public.agent_leads l where l.id = new.lead_id and l.tenant_id = new.tenant_id;
  begin
    select * into w from public.tenant_dial_window(new.tenant_id, v_state, v_campaign, new.attempted_at);
    new.window_state := upper(nullif(btrim(coalesce(v_state, '')), ''));
    new.window_local_minute := w.local_minute;
    new.window_start_minute := w.start_minute;
    new.window_end_minute := w.end_minute;
    new.window_reason := w.reason;
    new.window_verdict := case
      when w.allowed then 'inside'
      when w.reason is null or w.reason in ('no_state', 'rules_stale', 'no_zone') then 'undetermined'
      else 'outside' end;
  exception when others then
    -- Recording the window must never stop a call being written.
    new.window_verdict := 'undetermined';
    new.window_reason := 'check_failed';
  end;
  return new;
end $$;
revoke all on function public.tenant_call_attempts_window_record() from public, anon, authenticated, tenant_app, service_role;
drop trigger if exists tenant_call_attempts_window_record on public.tenant_call_attempts;
create trigger tenant_call_attempts_window_record before insert or update of attempted_at, lead_id on public.tenant_call_attempts
  for each row execute function public.tenant_call_attempts_window_record();

-- Backfill: the calls already made, judged at their own time. Only the window columns change, so
-- no other trigger on the table fires (each of them watches named columns).
update public.tenant_call_attempts a
   set window_state = upper(nullif(btrim(coalesce(x.state, '')), '')),
       window_local_minute = x.local_minute,
       window_start_minute = x.start_minute,
       window_end_minute = x.end_minute,
       window_reason = x.reason,
       window_verdict = case when x.allowed then 'inside'
                             when x.reason is null or x.reason in ('no_state', 'rules_stale', 'no_zone') then 'undetermined'
                             else 'outside' end
  from (
    select a2.id, l.values->>'state' as state, w.allowed, w.reason, w.local_minute, w.start_minute, w.end_minute
      from public.tenant_call_attempts a2
      join public.agent_leads l on l.id = a2.lead_id and l.tenant_id = a2.tenant_id
      cross join lateral public.tenant_dial_window(a2.tenant_id, l.values->>'state', l.campaign_id, a2.attempted_at) w
     where a2.window_verdict is null
  ) x
 where a.id = x.id;

create index if not exists tenant_call_attempts_window_idx on public.tenant_call_attempts (tenant_id, attempted_at)
  where window_verdict is distinct from 'inside';

-- ─── who generated which report ─────────────────────────────────────────────────────────────────
create table if not exists public.compliance_report_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  scope_type text not null,
  scope_value text,
  range_from timestamptz,
  range_to timestamptz,
  output text not null,
  event_count integer,
  gap_count integer,
  generated_at timestamptz not null default now(),
  constraint compliance_report_log_scope check (scope_type in ('phone', 'lead', 'contact', 'date_range', 'book_scan')),
  constraint compliance_report_log_output check (output in ('screen', 'pdf', 'csv'))
);
create index if not exists compliance_report_log_tenant_idx on public.compliance_report_log (tenant_id, generated_at desc);
create index if not exists compliance_report_log_user_idx on public.compliance_report_log (user_id) where user_id is not null;
alter table public.compliance_report_log enable row level security;
drop policy if exists compliance_report_log_read on public.compliance_report_log;
create policy compliance_report_log_read on public.compliance_report_log for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.compliance_report_log from public, anon, authenticated;
-- Append-only, by grants (a trigger refusing deletes would also refuse the tenant-delete cascade).
revoke update, delete, truncate on public.compliance_report_log from service_role, tenant_app;
revoke insert on public.compliance_report_log from tenant_app;
grant select on public.compliance_report_log to tenant_app;
grant select, insert on public.compliance_report_log to service_role;

-- ─── the gap checks ─────────────────────────────────────────────────────────────────────────────
-- One row per (gap category, number): status 'gap' or 'undetermined', how many calls (or leads), the
-- first and last time, and detail. No row for a category and number means the check passed.
-- p_phone_digits null = the whole book. p_from / p_to bound the calls (or leads) considered.
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

  -- 1. Calls with no consent artefact: calls exist, no consent record for the number.
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
                      where k.tenant_id = p_tenant_id and k.phone_digits = c.p and k.event_type = 'consent')
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

  -- 4. Calls after the number went on our do-not-call list. We were told to stop.
  return query
  with calls as (
    select i.phone_digits as p, i.event_at as at from public.compliance_index i
     where i.tenant_id = p_tenant_id and i.event_type = 'call_attempt'
       and (p_phone_digits is null or i.phone_digits = p_phone_digits)
       and (p_from is null or i.event_at >= p_from) and (p_to is null or i.event_at < p_to)
  ), listed as (
    select k.phone_digits as p, min(k.event_at) as at from public.compliance_index k
     where k.tenant_id = p_tenant_id and k.event_type = 'dnc_add'
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

  -- 6. Consent artefact no longer valid at the call: consent is on file, but no certificate was
  --    retained (claimed) or still inside its provider's claim window when the call was made.
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
                  where k.tenant_id = p_tenant_id and k.phone_digits = c.p and k.event_type = 'consent')
     and not exists (
       select 1 from public.compliance_index k
         join public.tenant_consent_artefacts t on t.id = k.source_id and t.tenant_id = k.tenant_id
        where k.tenant_id = p_tenant_id and k.phone_digits = c.p and k.event_type = 'consent' and k.source_table = 'tenant_consent_artefacts'
          and (t.capture_status = 'claimed'
               or (t.capture_status = 'pending'
                   and (nullif(p_claim_hours->>t.provider, '') is null
                        or coalesce(t.consent_timestamp, t.captured_at) + make_interval(hours => (p_claim_hours->>t.provider)::int) >= c.at))))
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

-- ─── self-check ─────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_null integer;
begin
  select count(*) into v_null from public.tenant_call_attempts where window_verdict is null;
  if v_null > 0 then
    raise exception '20261015120000: % call(s) have no recorded window', v_null;
  end if;
  if has_table_privilege('service_role', 'public.compliance_report_log', 'DELETE') or has_table_privilege('service_role', 'public.compliance_report_log', 'UPDATE') then
    raise exception '20261015120000: the report log must not be editable';
  end if;
  -- Every category answers (on an empty tenant: the two that need later modules say undetermined).
  perform * from public.compliance_gaps('00000000-0000-0000-0000-000000000000'::uuid, '8175550142', null, null, '{"trustedform": 72}'::jsonb);
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261015120000', 'la_6_3_evidence_report') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [3/7] 20261015130000_la_6_4_complaints.sql ──────────────────────────────────
begin;

-- LA-6.4 (Notion sprint, Module 6 — Compliance) · complaint handling.
--
-- Every complaint gets a record, an owner, a deadline and a countdown — and a complaint about
-- unwanted calls stops the calls before anyone drafts a reply.
--
--   complaint                        one row per complaint: who, about what, which channel, the
--                                    statutory deadline (DOI and FTC only), what was said back, how it
--                                    ended. Never deleted (the retention job of LA-6.6 anonymises it).
--   compliance_complaint_deadline    response days per regulator (a state's DOI, or the FTC), per
--                                    tenant. Configuration, not code (LA-6.8 edits it). A regulator
--                                    with no row gives NO deadline and a prompt — never a guessed
--                                    default: "30 days" when the statute says 15 is the worst error
--                                    this screen could make.
--   compliance_complaint_checklist   what a response typically needs, per category. Platform content.
--   open_complaint(...)              creates the complaint and, for unwanted calls, adds the number to
--                                    the internal do-not-call list (LA-2.3's suppress_phone) in the
--                                    same transaction, logged on the complaint as caused by it.
--   compliance_settings              + the escalation thresholds (amber 10 days, red 5).
--
-- Complaints are findable by number (LA-6.1, event 'complaint'), which also switches on the evidence
-- report's "called after a complaint" check.
--
-- Requires 20261015100000 (LA-6.1) and 20261015110000 (compliance_settings). Additive. Rollback:
--   drop trigger if exists compliance_index_sync on public.complaint;
--   drop function if exists public.open_complaint(uuid, uuid, jsonb), public.complaint_guard(), public.tenant_owner_user(uuid);
--   drop table if exists public.complaint, public.compliance_complaint_deadline, public.compliance_complaint_checklist;
--   alter table public.compliance_settings drop column if exists complaint_amber_days, drop column if exists complaint_red_days;
--   (the 'compliance-files' bucket holds complaint letters: empty it deliberately before deleting it)
--   (the index view keeps a branch reading complaint: rebuild it from the earlier files first)

-- The letter, the carrier notice, what was sent back: private, served through 60-second signed links.
-- Path: <tenant_id>/complaints/<complaint_id>/<file>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('compliance-files', 'compliance-files', false, 10485760,
        array['application/pdf', 'image/png', 'image/jpeg', 'text/plain', 'message/rfc822',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document']::text[])
on conflict (id) do nothing;

alter table public.compliance_settings
  add column if not exists complaint_amber_days integer not null default 10,
  add column if not exists complaint_red_days integer not null default 5;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'compliance_settings_complaint_thresholds') then
    alter table public.compliance_settings add constraint compliance_settings_complaint_thresholds
      check (complaint_red_days between 1 and 60 and complaint_amber_days between complaint_red_days and 90);
  end if;
end $$;

create table if not exists public.compliance_complaint_deadline (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- A state's insurance department ('TX') or the FTC ('FTC').
  regulator text not null,
  response_days integer not null,
  notes text,
  set_by uuid references public.users(id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (tenant_id, regulator),
  constraint compliance_complaint_deadline_regulator check (regulator ~ '^([A-Z]{2}|FTC)$'),
  constraint compliance_complaint_deadline_days check (response_days between 1 and 180)
);
alter table public.compliance_complaint_deadline enable row level security;
drop policy if exists compliance_complaint_deadline_read on public.compliance_complaint_deadline;
create policy compliance_complaint_deadline_read on public.compliance_complaint_deadline for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.compliance_complaint_deadline from public, anon, authenticated;
revoke insert, update, delete, truncate on public.compliance_complaint_deadline from tenant_app;
revoke truncate on public.compliance_complaint_deadline from service_role;
grant select on public.compliance_complaint_deadline to tenant_app;
grant select, insert, update, delete on public.compliance_complaint_deadline to service_role;

create table if not exists public.compliance_complaint_checklist (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  position integer not null,
  item text not null,
  unique (category, position)
);
revoke all on public.compliance_complaint_checklist from public, anon, authenticated;
grant select on public.compliance_complaint_checklist to service_role, tenant_app;
insert into public.compliance_complaint_checklist (category, position, item) values
  ('any', 1, 'Acknowledge receipt and name the person handling it.'),
  ('any', 2, 'State the facts in date order, from the record — not from memory.'),
  ('any', 3, 'Attach the evidence report for the number.'),
  ('any', 4, 'Say what was done about it, and what changes now.'),
  ('any', 5, 'Sign it yourself: it is a document in your name.'),
  ('unwanted_calls', 1, 'Show the consent artefact: who captured it, when, on which page.'),
  ('unwanted_calls', 2, 'Show each scrub result before the calls.'),
  ('unwanted_calls', 3, 'List every call with its time and that it was inside legal hours.'),
  ('unwanted_calls', 4, 'Confirm the number is now on your do-not-call list, and since when.'),
  ('misrepresentation', 1, 'Quote the disclosures shown or read, with the dates.'),
  ('misrepresentation', 2, 'Attach the application and any replacement notice.'),
  ('billing', 1, 'Show the draft date the client chose and any change to it.'),
  ('agent_conduct', 1, 'Name the agent and include their own account of the contact.')
on conflict (category, position) do nothing;

create table if not exists public.complaint (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel text not null,
  regulator_state text,
  received_at timestamptz not null,
  received_via text not null,
  complainant_name text,
  phone_digits text,
  contact_id uuid references public.contacts(id) on delete set null,
  policy_number text,
  about_agent_user_id uuid references public.users(id) on delete set null,
  partner_id uuid references public.partners(id) on delete set null,
  category text not null,
  summary text not null,
  attachments_json jsonb not null default '[]'::jsonb,
  response_due_at timestamptz,
  responded_at timestamptz,
  response_text text,
  response_attachments_json jsonb not null default '[]'::jsonb,
  checklist_json jsonb not null default '{}'::jsonb,
  status text not null default 'open',
  outcome text,
  owner_user_id uuid not null references public.users(id),
  -- The internal do-not-call entry this complaint caused (unwanted calls), and when.
  dnc_entry_id uuid,
  dnc_added_at timestamptz,
  resolved_at timestamptz,
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint complaint_channel check (channel in ('agent', 'carrier', 'doi', 'ftc', 'other')),
  constraint complaint_received_via check (received_via in ('phone', 'email', 'letter', 'portal', 'carrier_notice')),
  constraint complaint_category check (category in ('unwanted_calls', 'misrepresentation', 'billing', 'service', 'claim_handling', 'agent_conduct', 'other')),
  constraint complaint_status check (status in ('open', 'investigating', 'responded', 'awaiting_regulator', 'resolved', 'escalated')),
  constraint complaint_outcome check (outcome is null or outcome in ('no_action', 'agent_corrected', 'restitution', 'fine', 'licence_action')),
  constraint complaint_phone check (phone_digits is null or phone_digits ~ '^[0-9]{10}$'),
  constraint complaint_calls_need_number check (category <> 'unwanted_calls' or phone_digits is not null),
  constraint complaint_doi_state check (channel <> 'doi' or (regulator_state is not null and regulator_state ~ '^[A-Z]{2}$')),
  constraint complaint_state_shape check (regulator_state is null or regulator_state ~ '^[A-Z]{2}$'),
  constraint complaint_summary check (length(btrim(summary)) between 1 and 4000),
  constraint complaint_resolved check ((status = 'resolved') = (resolved_at is not null))
);
create index if not exists complaint_tenant_due_idx on public.complaint (tenant_id, response_due_at) where status not in ('resolved');
create index if not exists complaint_tenant_received_idx on public.complaint (tenant_id, received_at desc);
create index if not exists complaint_phone_idx on public.complaint (tenant_id, phone_digits) where phone_digits is not null;
create index if not exists complaint_partner_idx on public.complaint (partner_id) where partner_id is not null;
create index if not exists complaint_contact_idx on public.complaint (contact_id) where contact_id is not null;
create index if not exists complaint_owner_idx on public.complaint (owner_user_id);
create index if not exists complaint_agent_idx on public.complaint (about_agent_user_id) where about_agent_user_id is not null;
create index if not exists complaint_created_by_idx on public.complaint (created_by) where created_by is not null;
create index if not exists complaint_search_idx on public.complaint using gin (to_tsvector('english', summary || ' ' || coalesce(response_text, '')));

alter table public.complaint enable row level security;
drop policy if exists complaint_read on public.complaint;
create policy complaint_read on public.complaint for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.complaint from public, anon, authenticated;
revoke insert, update, delete, truncate on public.complaint from tenant_app;
-- Never deleted by the app; LA-6.6's retention job anonymises instead.
revoke delete, truncate on public.complaint from service_role;
grant select on public.complaint to tenant_app;
grant select, insert, update on public.complaint to service_role;

-- What was received, and when, is the record: it does not change after the fact. The workflow
-- (status, owner, response, outcome, notes, checklist, attachments) moves; a deadline may be set
-- once it was missing.
create or replace function public.complaint_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.tenant_id <> old.tenant_id or new.channel <> old.channel or new.received_at <> old.received_at
     or new.created_at <> old.created_at or new.created_by is distinct from old.created_by
     or new.dnc_entry_id is distinct from old.dnc_entry_id and old.dnc_entry_id is not null then
    raise exception 'complaint: what was received, and when, cannot change' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.complaint_guard() from public, anon, authenticated, tenant_app, service_role;
drop trigger if exists complaint_guard on public.complaint;
create trigger complaint_guard before update on public.complaint for each row execute function public.complaint_guard();

-- The tenant admin: the earliest accepted owner.
create or replace function public.tenant_owner_user(p_tenant_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select tu.user_id from public.tenant_users tu
   where tu.tenant_id = p_tenant_id and tu.role = 'owner'
   order by (tu.accepted_at is null), tu.accepted_at, tu.invited_at
   limit 1
$$;
revoke all on function public.tenant_owner_user(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_owner_user(uuid) to service_role;

-- Open a complaint. For unwanted calls the number goes on the internal do-not-call list in the same
-- transaction — before anyone drafts a reply.
create or replace function public.open_complaint(p_tenant_id uuid, p_actor uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_id uuid;
  v_channel text := p->>'channel';
  v_state text := upper(nullif(btrim(coalesce(p->>'regulator_state', '')), ''));
  v_received timestamptz := coalesce((p->>'received_at')::timestamptz, now());
  v_phone text := public.us_phone_10_digits(p->>'phone');
  v_owner uuid;
  v_days integer;
  v_due timestamptz;
  v_dnc uuid;
begin
  if p_tenant_id is null then
    raise exception 'open_complaint: a tenant is required';
  end if;
  if nullif(btrim(coalesce(p->>'phone', '')), '') is not null and v_phone is null then
    raise exception 'open_complaint: % is not a US phone number', p->>'phone' using errcode = 'check_violation';
  end if;
  -- The owner is never null: the named person if they belong to this tenant, else the tenant admin.
  select tu.user_id into v_owner from public.tenant_users tu
   where tu.tenant_id = p_tenant_id and tu.user_id = nullif(p->>'owner_user_id', '')::uuid;
  v_owner := coalesce(v_owner, public.tenant_owner_user(p_tenant_id));
  if v_owner is null then
    raise exception 'open_complaint: this tenant has no owner to hold the complaint';
  end if;
  -- A deadline only where one is configured; otherwise null, and the screen asks for it.
  if v_channel in ('doi', 'ftc') then
    select d.response_days into v_days from public.compliance_complaint_deadline d
     where d.tenant_id = p_tenant_id and d.regulator = case when v_channel = 'ftc' then 'FTC' else v_state end;
    if v_days is not null then
      v_due := v_received + make_interval(days => v_days);
    end if;
  end if;

  insert into public.complaint (tenant_id, channel, regulator_state, received_at, received_via, complainant_name, phone_digits,
                                contact_id, policy_number, about_agent_user_id, partner_id, category, summary, attachments_json,
                                response_due_at, owner_user_id, notes, created_by)
  values (p_tenant_id, v_channel, v_state, v_received, p->>'received_via', nullif(btrim(coalesce(p->>'complainant_name', '')), ''), v_phone,
          nullif(p->>'contact_id', '')::uuid, nullif(btrim(coalesce(p->>'policy_number', '')), ''), nullif(p->>'about_agent_user_id', '')::uuid,
          nullif(p->>'partner_id', '')::uuid, p->>'category', p->>'summary', coalesce(p->'attachments', '[]'::jsonb),
          v_due, v_owner, nullif(btrim(coalesce(p->>'notes', '')), ''), p_actor)
  returning id into v_id;

  if p->>'category' = 'unwanted_calls' then
    v_dnc := public.suppress_phone(p_tenant_id, v_phone, 'internal', 'Complaint ' || v_id || ': asked not to be called', 'complaint', p_actor);
    update public.complaint set dnc_entry_id = v_dnc, dnc_added_at = now() where id = v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.open_complaint(uuid, uuid, jsonb) from public, anon, authenticated, tenant_app;
grant execute on function public.open_complaint(uuid, uuid, jsonb) to service_role;

-- ─── LA-6.1: complaints are findable by number ──────────────────────────────────────────────────
select public.compliance_index_add_source('complaint', $branch$
  select c.tenant_id, c.phone_digits, c.contact_id, null::uuid, 'complaint'::text, c.received_at,
         'complaint'::text, c.id, '00000000-0000-0000-0000-000000000000'::uuid,
         ('Complaint (' || c.channel || coalesce(' ' || c.regulator_state, '') || '): ' || replace(c.category, '_', ' ')
           || case when c.dnc_entry_id is not null then ' · number added to do-not-call' else '' end)::text,
         'LA-6.4'::text
    from public.complaint c
   where c.phone_digits is not null
$branch$);
drop trigger if exists compliance_index_sync on public.complaint;
create trigger compliance_index_sync after insert or delete or update of phone_digits, contact_id, channel, regulator_state, category, dnc_entry_id on public.complaint
  for each row execute function public.compliance_index_sync();

-- ─── self-check ─────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_id uuid;
  v_row record;
begin
  if has_table_privilege('service_role', 'public.complaint', 'DELETE') then
    raise exception '20261015130000: complaints are never deleted';
  end if;
  -- Exercise the function on a real tenant, then roll it back.
  select t.id into v_tenant from public.tenants t where public.tenant_owner_user(t.id) is not null limit 1;
  if v_tenant is null then
    return;
  end if;
  begin
    v_id := public.open_complaint(v_tenant, null, jsonb_build_object('channel', 'doi', 'regulator_state', 'ZZ', 'received_via', 'letter',
              'phone', '(817) 555-0199', 'category', 'unwanted_calls', 'summary', 'self-check'));
    select * into v_row from public.complaint where id = v_id;
    if v_row.response_due_at is not null then
      raise exception '20261015130000: a deadline was invented for a regulator with none configured';
    end if;
    if v_row.dnc_entry_id is null or not public.is_tenant_phone_suppressed(v_tenant, '8175550199') then
      raise exception '20261015130000: an unwanted-calls complaint did not reach the do-not-call list';
    end if;
    if v_row.owner_user_id is null then
      raise exception '20261015130000: the complaint has no owner';
    end if;
    if not exists (select 1 from public.compliance_index where tenant_id = v_tenant and source_table = 'complaint' and source_id = v_id) then
      raise exception '20261015130000: the complaint is not findable by number';
    end if;
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261015130000', 'la_6_4_complaints') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [4/7] 20261015140000_la_6_5_consumer_deletion.sql ───────────────────────────
begin;

-- LA-6.5 (Notion sprint, Module 6 — Compliance) · consumer data-subject deletion.
--
-- One person asks to be deleted. Find them everywhere, remove or anonymise what we can, keep what we
-- must, and record exactly which was which — the certificate is built from that record.
--
--   deletion_request         the request, its identity check, the hold, and the per-table results.
--   deletion_request_event   its audit trail: every step, who, when, what it touched. Kept in full.
--   erase_matching_values    replaces, inside a JSON document, every value that is one of the
--                            person's identifiers (names, numbers, emails, addresses, dates of birth).
--   data_subject_discover    finds the person: clients, numbers, emails, leads, applications, cases,
--                            policies and the carrier rows behind them.
--   data_subject_purge_group runs ONE group of the purge (one transaction each), idempotently, and
--                            records per-table counts. The groups, in order:
--                              dnc          keep the number on the internal do-not-call list, reduced
--                                           to the number and a reason (added if it was not there).
--                              activity     calls, notes, callbacks, appointments, dispositions …
--                              checks       consent artefacts (purged); screening, scrub and transfer
--                                           records anonymised (partner quality and vendor credits
--                                           still count them).
--                              applications health answers, medications, verification fields,
--                                           application answers, beneficiaries, payment methods.
--                              leads        lead rows and deal flow anonymised (vendor cost reporting
--                                           still reconciles); partner drafts and chat cards scrubbed.
--                              clients      the client record anonymised; phones, emails, income,
--                                           queue items purged; policy and commission records kept,
--                                           with the person's identifiers erased from the carrier rows.
--                              records      complaints anonymised (kept: the regulatory record), report
--                                           log and email log entries anonymised.
--
-- The do-not-call entry is NEVER deleted — not here, not by LA-6.6, not by anyone (the LA-2.3 guard
-- refuses it). The number is kept precisely so the person is never called again.
--
-- Carrier raw rows and policy snapshots are immutable (LA-4). Their guards now let ONE thing through:
-- a payload / `extra` change made by this purge (app.data_subject_deletion set), with every other
-- column unchanged. The rows stay, so every figure and trace still reconciles.
--
-- Requires 20261015100000–20261015130000. Additive apart from the two guard bodies. Rollback:
--   drop function if exists public.data_subject_purge_group(uuid, text, uuid), public.data_subject_discover(uuid, text, text, uuid),
--     public.erase_matching_values(jsonb, text[], text[]), public.deletion_request_guard();
--   drop table if exists public.deletion_request_event, public.deletion_request;
--   restore raw_rows_immutable / policy_snapshot_guard from 20261008100000 / 20261008150000 (their bodies are quoted in this file).

alter table public.compliance_settings
  add column if not exists deletion_hold_days integer not null default 7,
  add column if not exists deletion_methods text[] not null default array['known_customer', 'phone_match', 'email_match', 'document'];
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'compliance_settings_deletion_hold_floor') then
    -- The platform floor is 3 days: a request made in anger at 11pm is sometimes withdrawn on Monday.
    alter table public.compliance_settings add constraint compliance_settings_deletion_hold_floor check (deletion_hold_days between 3 and 45);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'compliance_settings_deletion_methods') then
    alter table public.compliance_settings add constraint compliance_settings_deletion_methods
      check (deletion_methods <@ array['known_customer', 'phone_match', 'email_match', 'document'] and cardinality(deletion_methods) >= 1);
  end if;
end $$;

create table if not exists public.deletion_request (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone_digits text,
  email text,
  contact_id uuid references public.contacts(id) on delete set null,
  requester_name text,
  received_at timestamptz not null,
  received_via text not null,
  verified_at timestamptz,
  verified_by uuid references public.users(id) on delete set null,
  verification_method text,
  verification_note text,
  scheduled_purge_at timestamptz,
  status text not null default 'received',
  rejection_reason text,
  certificate_url text,
  -- The person as discovered when the purge starts. Cleared to counts on completion.
  subject_json jsonb,
  -- Per group, per table: rows purged / anonymised / kept, and why.
  results_json jsonb not null default '{}'::jsonb,
  groups_done text[] not null default '{}',
  completed_at timestamptz,
  performed_by uuid references public.users(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deletion_request_via check (received_via in ('phone', 'email', 'letter', 'web_form')),
  constraint deletion_request_method check (verification_method is null or verification_method in ('known_customer', 'phone_match', 'email_match', 'document')),
  constraint deletion_request_status check (status in ('received', 'verifying', 'verified', 'scheduled', 'completed', 'rejected', 'cancelled')),
  constraint deletion_request_phone check (phone_digits is null or phone_digits ~ '^[0-9]{10}$'),
  constraint deletion_request_who check (phone_digits is not null or email is not null or contact_id is not null),
  constraint deletion_request_rejected check ((status = 'rejected') = (rejection_reason is not null)),
  constraint deletion_request_verified check (status not in ('verified', 'scheduled', 'completed') or (verified_at is not null and verification_method is not null)),
  constraint deletion_request_completed check ((status = 'completed') = (completed_at is not null))
);
create index if not exists deletion_request_tenant_idx on public.deletion_request (tenant_id, received_at desc);
create index if not exists deletion_request_due_idx on public.deletion_request (scheduled_purge_at) where status = 'scheduled';
create index if not exists deletion_request_contact_idx on public.deletion_request (contact_id) where contact_id is not null;
create index if not exists deletion_request_users_idx on public.deletion_request (verified_by, performed_by, created_by);

create table if not exists public.deletion_request_event (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.deletion_request(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  at timestamptz not null default now(),
  actor_user_id uuid references public.users(id) on delete set null,
  action text not null,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists deletion_request_event_request_idx on public.deletion_request_event (request_id, at);
create index if not exists deletion_request_event_tenant_idx on public.deletion_request_event (tenant_id);
create index if not exists deletion_request_event_actor_idx on public.deletion_request_event (actor_user_id) where actor_user_id is not null;

alter table public.deletion_request enable row level security;
alter table public.deletion_request_event enable row level security;
drop policy if exists deletion_request_read on public.deletion_request;
create policy deletion_request_read on public.deletion_request for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists deletion_request_event_read on public.deletion_request_event;
create policy deletion_request_event_read on public.deletion_request_event for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.deletion_request, public.deletion_request_event from public, anon, authenticated;
revoke insert, update, delete, truncate on public.deletion_request, public.deletion_request_event from tenant_app;
grant select on public.deletion_request, public.deletion_request_event to tenant_app;
-- The request moves through the app; its audit trail is never edited or removed.
revoke delete, truncate on public.deletion_request from service_role;
grant select, insert, update on public.deletion_request to service_role;
revoke update, delete, truncate on public.deletion_request_event from service_role;
grant select, insert on public.deletion_request_event to service_role;

-- A completed, rejected or cancelled request is final; a request's who and when never change.
create or replace function public.deletion_request_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.tenant_id <> old.tenant_id or new.received_at <> old.received_at or new.created_at <> old.created_at
     or new.phone_digits is distinct from old.phone_digits and old.status <> 'received' then
    raise exception 'deletion_request: what was asked, and when, cannot change' using errcode = 'check_violation';
  end if;
  if old.status in ('completed', 'rejected', 'cancelled') and (to_jsonb(new) - 'updated_at' - 'subject_json' - 'certificate_url') is distinct from (to_jsonb(old) - 'updated_at' - 'subject_json' - 'certificate_url') then
    raise exception 'deletion_request: a % request is final', old.status using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.deletion_request_guard() from public, anon, authenticated, tenant_app, service_role;
drop trigger if exists deletion_request_guard on public.deletion_request;
create trigger deletion_request_guard before update on public.deletion_request for each row execute function public.deletion_request_guard();

-- ─── erasing identifiers inside JSON ────────────────────────────────────────────────────────────
-- A string (or number) leaf is erased when it IS one of the person's identifiers (case and spacing
-- ignored), when its digits are one of their numbers or dates, or when it contains one of their
-- longer identifiers (a full name, an email, an address). Keys and everything else are kept.
create or replace function public.erase_matching_values(p_doc jsonb, p_tokens text[], p_digits text[])
returns jsonb
language plpgsql
immutable
set search_path = public, pg_catalog
as $$
declare
  v_kind text := jsonb_typeof(p_doc);
  v_out jsonb;
  v_key text;
  v_val jsonb;
  v_text text;
  v_norm text;
  v_digits text;
  v_token text;
begin
  if p_doc is null then
    return null;
  end if;
  if v_kind = 'object' then
    v_out := '{}'::jsonb;
    for v_key, v_val in select * from jsonb_each(p_doc) loop
      v_out := v_out || jsonb_build_object(v_key, public.erase_matching_values(v_val, p_tokens, p_digits));
    end loop;
    return v_out;
  elsif v_kind = 'array' then
    select coalesce(jsonb_agg(public.erase_matching_values(e, p_tokens, p_digits)), '[]'::jsonb) into v_out from jsonb_array_elements(p_doc) e;
    return v_out;
  elsif v_kind in ('string', 'number') then
    v_text := case when v_kind = 'string' then p_doc #>> '{}' else p_doc::text end;
    v_norm := lower(btrim(regexp_replace(v_text, '\s+', ' ', 'g')));
    v_digits := regexp_replace(v_text, '[^0-9]', '', 'g');
    if v_norm = '' then
      return p_doc;
    end if;
    if v_norm = any(p_tokens) or (length(v_digits) >= 6 and v_digits = any(p_digits)) then
      return to_jsonb('[erased]'::text);
    end if;
    foreach v_token in array coalesce(p_tokens, '{}') loop
      if length(v_token) >= 8 and position(v_token in v_norm) > 0 then
        return to_jsonb('[erased]'::text);
      end if;
    end loop;
    return p_doc;
  end if;
  return p_doc;
end $$;
revoke all on function public.erase_matching_values(jsonb, text[], text[]) from public, anon, authenticated, tenant_app;
grant execute on function public.erase_matching_values(jsonb, text[], text[]) to service_role;

-- ─── the carrier rows: immutable, except for this ───────────────────────────────────────────────
-- Was (20261008100000): raise exception 'Raw rows are never changed or removed; register a corrected file instead.'
create or replace function public.raw_rows_immutable()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- LA-6.5: a consumer deletion may erase the person's identifiers from a row's payload. Nothing
  -- else about the row may change, and a row is still never removed.
  if tg_op = 'UPDATE' and coalesce(current_setting('app.data_subject_deletion', true), '') <> ''
     and (to_jsonb(new) - 'payload') = (to_jsonb(old) - 'payload') then
    return new;
  end if;
  raise exception 'Raw rows are never changed or removed; register a corrected file instead.' using errcode = 'P0001';
end;
$function$;

-- Was: the same body without the LA-6.5 branch.
create or replace function public.policy_snapshot_guard()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- LA-6.5: a consumer deletion may erase the person's identifiers from `extra`; nothing else.
  if coalesce(current_setting('app.data_subject_deletion', true), '') <> ''
     and (to_jsonb(new) - 'extra') = (to_jsonb(old) - 'extra') then
    return new;
  end if;
  if (to_jsonb(new) - 'superseded') is distinct from (to_jsonb(old) - 'superseded') or (old.superseded and not new.superseded) then
    raise exception 'A policy snapshot is never edited; it is rebuilt from its file''s raw rows.' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

-- LA-6.2's verdict guard: the purge may clear the number and the lead link, nothing else.
create or replace function public.transfer_verdict_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if coalesce(current_setting('app.data_subject_deletion', true), '') <> ''
     and (to_jsonb(new) - 'lead_id' - 'phone_digits') = (to_jsonb(old) - 'lead_id' - 'phone_digits')
     and new.phone_digits is null then
    return new;
  end if;
  if (to_jsonb(new) - 'lead_id') is distinct from (to_jsonb(old) - 'lead_id') then
    raise exception 'transfer_verdict is evidence: only the lead link may be set' using errcode = 'check_violation';
  end if;
  if old.lead_id is not null and new.lead_id is not null and new.lead_id <> old.lead_id then
    raise exception 'transfer_verdict: the lead link is set once' using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- ─── finding the person ─────────────────────────────────────────────────────────────────────────
create or replace function public.data_subject_discover(p_tenant_id uuid, p_phone text, p_email text, p_contact_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_phones text[] := array_remove(array[public.us_phone_10_digits(p_phone)], null);
  v_emails text[] := array_remove(array[lower(nullif(btrim(coalesce(p_email, '')), ''))], null);
  v_contacts uuid[] := array_remove(array[p_contact_id], null);
  v_leads uuid[];
  v_apps uuid[];
  v_cases uuid[];
  v_policies jsonb;
  v_raw uuid[];
  v_tokens text[];
  v_digits text[];
begin
  -- Clients: the one named, any whose numbers or emails match, and any merged into them.
  select coalesce(array_agg(distinct c.id), '{}') into v_contacts
    from public.contacts c
   where c.tenant_id = p_tenant_id
     and (c.id = any(v_contacts)
          or public.us_phone_10_digits(c.primary_phone) = any(v_phones)
          or exists (select 1 from public.contact_phones cp where cp.contact_id = c.id and public.us_phone_10_digits(cp.phone) = any(v_phones))
          or exists (select 1 from public.contact_emails ce where ce.contact_id = c.id and lower(ce.email) = any(v_emails)));
  select coalesce(array_agg(distinct c.id), '{}') || v_contacts into v_contacts
    from public.contacts c where c.tenant_id = p_tenant_id and c.merged_into_id = any(v_contacts);

  select v_phones || coalesce(array_agg(distinct x.p) filter (where x.p is not null), '{}') into v_phones from (
    select public.us_phone_10_digits(c.primary_phone) p from public.contacts c where c.id = any(v_contacts)
    union select public.us_phone_10_digits(cp.phone) from public.contact_phones cp where cp.contact_id = any(v_contacts)
  ) x;
  select v_emails || coalesce(array_agg(distinct lower(ce.email)), '{}') into v_emails from public.contact_emails ce where ce.contact_id = any(v_contacts);

  -- Leads: the clients', and any whose number or email matches. (A scan of the tenant's leads: this
  -- runs once per deletion, and the LA-1.24 phone-key index, 20260929140100, is not live everywhere.)
  select coalesce(array_agg(distinct l.id), '{}') into v_leads
    from public.agent_leads l
   where l.tenant_id = p_tenant_id
     and (l.contact_id = any(v_contacts)
          or public.compliance_lead_phone(l.values) = any(v_phones)
          or (cardinality(v_emails) > 0 and lower(l.values->>'email') = any(v_emails)));
  select v_leads || coalesce(array_agg(distinct i.lead_id), '{}') into v_leads
    from public.compliance_index i where i.tenant_id = p_tenant_id and i.phone_digits = any(v_phones) and i.lead_id is not null;
  select coalesce(array_agg(distinct x), '{}') into v_leads from unnest(v_leads) x;

  select (select coalesce(array_agg(distinct p), '{}') from unnest(v_phones || coalesce(array_agg(public.compliance_lead_phone(l.values)), '{}')) p where p is not null),
         (select coalesce(array_agg(distinct e), '{}') from unnest(v_emails || coalesce(array_agg(lower(l.values->>'email')) filter (where l.values ? 'email'), '{}')) e where e is not null)
    into v_phones, v_emails
    from public.agent_leads l where l.id = any(v_leads);

  select coalesce(array_agg(distinct a.id), '{}') into v_apps from public.tenant_applications a where a.tenant_id = p_tenant_id and a.lead_id = any(v_leads);
  select coalesce(array_agg(distinct k.id), '{}') into v_cases from public.tenant_application_cases k where k.tenant_id = p_tenant_id and k.lead_id = any(v_leads);
  select coalesce(jsonb_agg(distinct jsonb_build_object('carrier_id', pc.carrier_id, 'policy_number', pc.policy_number)), '[]'::jsonb) into v_policies
    from public.policy_current pc where pc.tenant_id = p_tenant_id and (pc.contact_id = any(v_contacts) or pc.application_id = any(v_apps));
  select coalesce(array_agg(distinct s.raw_row_id), '{}') into v_raw
    from public.policy_snapshot s
    join jsonb_array_elements(v_policies) p on (p->>'carrier_id')::uuid = s.carrier_id and p->>'policy_number' = s.policy_number
   where s.tenant_id = p_tenant_id and s.raw_row_id is not null;
  select v_raw || coalesce(array_agg(distinct ce.raw_row_id) filter (where ce.raw_row_id is not null), '{}') into v_raw
    from public.commission_entry ce
    join jsonb_array_elements(v_policies) p on (p->>'carrier_id')::uuid = ce.carrier_id and p->>'policy_number' = ce.policy_number
   where ce.tenant_id = p_tenant_id;

  -- What identifies them, for erasing it from documents (names, emails, addresses; numbers and dates as digits).
  select coalesce(array_agg(distinct t) filter (where t is not null and length(t) >= 2), '{}') into v_tokens from (
    select lower(btrim(c.first_name)) t from public.contacts c where c.id = any(v_contacts)
    union select lower(btrim(c.last_name)) from public.contacts c where c.id = any(v_contacts)
    union select lower(btrim(c.first_name || ' ' || c.last_name)) from public.contacts c where c.id = any(v_contacts)
    union select lower(btrim(c.last_name || ', ' || c.first_name)) from public.contacts c where c.id = any(v_contacts)
    union select lower(btrim(c.last_name || ' ' || c.first_name)) from public.contacts c where c.id = any(v_contacts)
    union select lower(btrim(c.address_line1)) from public.contacts c where c.id = any(v_contacts) and length(btrim(c.address_line1)) >= 6
    union select lower(btrim(l.values->>k)) from public.agent_leads l, unnest(array['first_name', 'last_name', 'full_name', 'name', 'address', 'address_line1']) k where l.id = any(v_leads)
    union select lower(btrim(coalesce(l.values->>'first_name', '') || ' ' || coalesce(l.values->>'last_name', ''))) from public.agent_leads l where l.id = any(v_leads)
    union select lower(btrim(coalesce(l.values->>'last_name', '') || ', ' || coalesce(l.values->>'first_name', ''))) from public.agent_leads l where l.id = any(v_leads)
    union select e from unnest(v_emails) e
  ) x;
  select coalesce(array_agg(distinct d) filter (where d is not null and length(d) >= 6), '{}') into v_digits from (
    select p d from unnest(v_phones) p
    union select '1' || p from unnest(v_phones) p
    union select to_char(dob, f) from (
      select c.dob from public.contacts c where c.id = any(v_contacts) and c.dob is not null
      union select (l.values->>k)::date from public.agent_leads l, unnest(array['dob', 'date_of_birth']) k
       where l.id = any(v_leads) and l.values->>k ~ '^\d{4}-\d{2}-\d{2}$'
    ) dobs, unnest(array['YYYYMMDD', 'MMDDYYYY', 'FMMMFMDDYYYY']) f
  ) y;

  return jsonb_build_object(
    'phones', to_jsonb(coalesce(v_phones, '{}')), 'emails', to_jsonb(coalesce(v_emails, '{}')), 'contact_ids', to_jsonb(v_contacts),
    'lead_ids', to_jsonb(v_leads), 'application_ids', to_jsonb(v_apps), 'case_ids', to_jsonb(v_cases), 'policies', v_policies,
    'raw_row_ids', to_jsonb(coalesce(v_raw, '{}')), 'tokens', to_jsonb(coalesce(v_tokens, '{}')), 'digits', to_jsonb(coalesce(v_digits, '{}')));
end $$;
revoke all on function public.data_subject_discover(uuid, text, text, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.data_subject_discover(uuid, text, text, uuid) to service_role;

-- ─── the purge, one group at a time ─────────────────────────────────────────────────────────────
create or replace function public.data_subject_purge_group(p_request_id uuid, p_group text, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r public.deletion_request%rowtype;
  s jsonb;
  t uuid;
  v_phones text[];
  v_emails text[];
  v_contacts uuid[];
  v_leads uuid[];
  v_apps uuid[];
  v_cases uuid[];
  v_raw uuid[];
  v_tokens text[];
  v_digits text[];
  v_out jsonb := '{}'::jsonb;
  v_held boolean;
  n integer;
  p text;
begin
  select * into r from public.deletion_request where id = p_request_id for update;
  if not found then
    raise exception 'data_subject_purge_group: no such request';
  end if;
  if r.status <> 'scheduled' or r.scheduled_purge_at > now() then
    raise exception 'data_subject_purge_group: the request is not due (status %, due %)', r.status, r.scheduled_purge_at using errcode = 'check_violation';
  end if;
  if r.subject_json is null then
    raise exception 'data_subject_purge_group: discover the person first';
  end if;
  if p_group = any(r.groups_done) then
    return coalesce(r.results_json->p_group, '{}'::jsonb);
  end if;
  s := r.subject_json;
  t := r.tenant_id;
  v_phones := array(select jsonb_array_elements_text(s->'phones'));
  v_emails := array(select jsonb_array_elements_text(s->'emails'));
  v_contacts := array(select jsonb_array_elements_text(s->'contact_ids')::uuid);
  v_leads := array(select jsonb_array_elements_text(s->'lead_ids')::uuid);
  v_apps := array(select jsonb_array_elements_text(s->'application_ids')::uuid);
  v_cases := array(select jsonb_array_elements_text(s->'case_ids')::uuid);
  v_raw := array(select jsonb_array_elements_text(s->'raw_row_ids')::uuid);
  v_tokens := array(select jsonb_array_elements_text(s->'tokens'));
  v_digits := array(select jsonb_array_elements_text(s->'digits'));
  -- A legal hold beats a deletion request too (LA-6.6): nothing under a hold is purged by anything.
  if to_regclass('public.legal_hold') is not null then
    execute 'select exists (select 1 from public.legal_hold h where h.tenant_id = $1 and h.released_at is null
               and (h.scope = ''tenant_wide'' or (h.scope = ''phone_digits'' and h.scope_value = any($2))
                    or (h.scope = ''contact_id'' and h.scope_value = any($3))
                    or (h.scope = ''policy_number'' and h.scope_value = any($4))))'
      into v_held using t, v_phones, array(select x::text from unnest(v_contacts) x), array(select pol->>'policy_number' from jsonb_array_elements(s->'policies') pol);
    if v_held then
      raise exception 'data_subject_purge_group: this person''s records are under a legal hold; the deletion waits until it is released' using errcode = 'check_violation';
    end if;
  end if;
  perform set_config('app.data_subject_deletion', p_request_id::text, true);

  if p_group = 'dnc' then
    -- Never deleted. Every number is (or now goes) on the internal list, reduced to number + reason.
    foreach p in array v_phones loop
      perform public.suppress_phone(t, p, 'internal', 'Retained under a deletion request: do not contact', 'manual', p_actor);
    end loop;
    with u as (update public.tenant_do_not_call set reason = 'Retained under a deletion request: do not contact', lead_id = null
                where tenant_id = t and phone_digits = any(v_phones) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('tenant_do_not_call', jsonb_build_object('kept', n, 'reason', 'Kept so the number is never called again; reduced to the number and a reason.'));
    select count(*) into n from public.tenant_suppression_list where tenant_id = t and phone_digits = any(v_phones);
    v_out := v_out || jsonb_build_object('tenant_suppression_list', jsonb_build_object('kept', n, 'reason', 'Federal, state and litigator listings of the number; kept so it is never called.'));

  elsif p_group = 'activity' then
    with d as (delete from public.tenant_appointment_reminder_events e using public.tenant_appointments a
                where e.appointment_id = a.id and a.tenant_id = t and a.lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_appointment_reminder_events', jsonb_build_object('purged', n));
    with d as (delete from public.tenant_appointments where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_appointments', jsonb_build_object('purged', n));
    with d as (delete from public.tenant_callbacks where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_callbacks', jsonb_build_object('purged', n));
    with d as (delete from public.callbacks where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('callbacks', jsonb_build_object('purged', n));
    with d as (delete from public.callback_history where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('callback_history', jsonb_build_object('purged', n));
    with d as (delete from public.tenant_lead_activity where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_lead_activity', jsonb_build_object('purged', n));
    with d as (delete from public.tenant_dial_dnc_checks where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_dial_dnc_checks', jsonb_build_object('purged', n));
    with d as (delete from public.tenant_call_attempts where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_call_attempts', jsonb_build_object('purged', n));
    with d as (delete from public.active_calls where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('active_calls', jsonb_build_object('purged', n));
    with d as (delete from public.disposition_walks where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('disposition_walks', jsonb_build_object('purged', n));
    with d as (delete from public.tenant_lead_notes where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_lead_notes', jsonb_build_object('purged', n));
    with d as (delete from public.lead_notes where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('lead_notes', jsonb_build_object('purged', n));
    with d as (delete from public.lead_note_edits where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('lead_note_edits', jsonb_build_object('purged', n));
    with d as (delete from public.lead_notifications where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('lead_notifications', jsonb_build_object('purged', n));
    with d as (delete from public.tenant_lead_sla_events where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_lead_sla_events', jsonb_build_object('purged', n));
    with d as (delete from public.lead_sla_events where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('lead_sla_events', jsonb_build_object('purged', n));
    with d as (delete from public.tenant_lead_stage_events where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_lead_stage_events', jsonb_build_object('purged', n));
    with d as (delete from public.tenant_nurture_reactivations where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_nurture_reactivations', jsonb_build_object('purged', n));
    with d as (delete from public.tenant_scoring_decisions where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_scoring_decisions', jsonb_build_object('purged', n));
    with d as (delete from public.tenant_lead_signature_readiness where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_lead_signature_readiness', jsonb_build_object('purged', n));
    with d as (delete from public.intake_failures where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('intake_failures', jsonb_build_object('purged', n));
    with d as (delete from public.lead_assignment_events where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('lead_assignment_events', jsonb_build_object('purged', n));

  elsif p_group = 'checks' then
    with d as (delete from public.tenant_consent_artefacts where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_consent_artefacts', jsonb_build_object('purged', n));
    -- LA-2.6's exemptions (20260925709700) are purged when that file is live.
    if to_regclass('public.tenant_dnc_exemption_uses') is not null then
      execute 'with d as (delete from public.tenant_dnc_exemption_uses where tenant_id = $1 and (phone_digits = any($2) or lead_id = any($3)) returning 1) select count(*) from d'
        into n using t, v_phones, v_leads;
      v_out := v_out || jsonb_build_object('tenant_dnc_exemption_uses', jsonb_build_object('purged', n));
    end if;
    if to_regclass('public.tenant_dnc_exemptions') is not null then
      execute 'with d as (delete from public.tenant_dnc_exemptions where tenant_id = $1 and phone_digits = any($2) returning 1) select count(*) from d'
        into n using t, v_phones;
      v_out := v_out || jsonb_build_object('tenant_dnc_exemptions', jsonb_build_object('purged', n));
    end if;
    with d as (delete from public.tenant_lead_post_log where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_lead_post_log', jsonb_build_object('purged', n));
    with d as (delete from public.lead_income where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('lead_income', jsonb_build_object('purged', n));
    with d as (delete from public.screening_results where tenant_id = t and phone_digits = any(v_phones) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('screening_results', jsonb_build_object('purged', n, 'reason', 'A 24-hour cache of vendor answers.'));
    with d as (delete from public.screening_cache_locks where tenant_id = t and phone_digits = any(v_phones) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('screening_cache_locks', jsonb_build_object('purged', n));
    with u as (update public.screening_audit set phone_digits = null, raw_response = '{}'::jsonb, lead_id = null
                where tenant_id = t and (phone_digits = any(v_phones) or lead_id = any(v_leads)) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('screening_audit', jsonb_build_object('anonymised', n, 'reason', 'Kept without the number: partner quality counts each screen.'));
    with u as (update public.tenant_campaign_scrub_rejections set phone_digits = '0000000000', detail = null, source_key = null
                where tenant_id = t and phone_digits = any(v_phones) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('tenant_campaign_scrub_rejections', jsonb_build_object('anonymised', n, 'reason', 'Kept without the number: vendor credits count each rejected row.'));
    with u as (update public.transfer_verdict set phone_digits = null, lead_id = null
                where tenant_id = t and (phone_digits = any(v_phones) or lead_id = any(v_leads)) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('transfer_verdict', jsonb_build_object('anonymised', n, 'reason', 'Kept without the number: partner quality counts each verdict.'));
    with u as (update public.lead_claim_items set evidence = public.erase_matching_values(evidence, v_tokens, v_digits)
                where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('lead_claim_items', jsonb_build_object('anonymised', n, 'reason', 'Vendor credit claims stay so vendor cost reporting reconciles.'));

  elsif p_group = 'applications' then
    with d as (delete from public.tenant_uw_interviews where tenant_id = t and case_id = any(v_cases) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_uw_interviews', jsonb_build_object('purged', n, 'note', 'with their answers, answer history and medications'));
    with d as (delete from public.tenant_verification_sessions where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_verification_sessions', jsonb_build_object('purged', n, 'note', 'with their verified fields and changes'));
    with d as (delete from public.verification_sessions where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('verification_sessions', jsonb_build_object('purged', n, 'note', 'with their items and audit'));
    with d as (delete from public.tenant_application_values where tenant_id = t and application_id = any(v_apps) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_application_values', jsonb_build_object('purged', n));
    with d as (delete from public.tenant_application_beneficiaries where tenant_id = t and application_id = any(v_apps) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_application_beneficiaries', jsonb_build_object('purged', n));
    with d as (delete from public.tenant_application_payment_methods where tenant_id = t and application_id = any(v_apps) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_application_payment_methods', jsonb_build_object('purged', n));
    with u as (update public.tenant_application_counteroffers set client_response_note = null where tenant_id = t and application_id = any(v_apps) and client_response_note is not null returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('tenant_application_counteroffers', jsonb_build_object('anonymised', n));
    with u as (update public.tenant_welcome_packs set recipient_email = null where tenant_id = t and application_id = any(v_apps) and recipient_email is not null returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('tenant_welcome_packs', jsonb_build_object('anonymised', n));
    with u as (update public.tenant_applications set outcome_reason_text = null where tenant_id = t and id = any(v_apps) and outcome_reason_text is not null returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('tenant_applications', jsonb_build_object('anonymised', n, 'reason', 'The application row stays (carrier, product, status, dates): it is part of the policy record.'));
    with u as (update public.tenant_quotes set rating_inputs = '{}'::jsonb where tenant_id = t and lead_id = any(v_leads) and rating_inputs <> '{}'::jsonb returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('tenant_quotes', jsonb_build_object('anonymised', n));

  elsif p_group = 'leads' then
    with u as (update public.agent_leads set values = jsonb_build_object('_erased', p_request_id), contact_id = null
                where tenant_id = t and id = any(v_leads) and values is distinct from jsonb_build_object('_erased', p_request_id) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('agent_leads', jsonb_build_object('anonymised', n, 'reason', 'Kept without the person so vendor cost reporting still reconciles.'));
    with u as (update public.deal_flow set insured_name = null, phone = null, notes = null
                where tenant_id = t and lead_id = any(v_leads) and (insured_name is not null or phone is not null or notes is not null) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('deal_flow', jsonb_build_object('anonymised', n, 'reason', 'Kept without the person: sales and cost figures still reconcile.'));
    with u as (update public.form_drafts set payload = public.erase_matching_values(payload, v_tokens, v_digits)
                where tenant_id = t and payload is distinct from public.erase_matching_values(payload, v_tokens, v_digits) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('form_drafts', jsonb_build_object('anonymised', n));
    with u as (update public.partner_messages set card_payload = public.erase_matching_values(card_payload, v_tokens, v_digits)
                where tenant_id = t and card_payload is not null and card_payload is distinct from public.erase_matching_values(card_payload, v_tokens, v_digits) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('partner_messages', jsonb_build_object('anonymised', n));

  elsif p_group = 'clients' then
    with d as (delete from public.contact_phones where contact_id = any(v_contacts) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('contact_phones', jsonb_build_object('purged', n));
    with d as (delete from public.contact_emails where contact_id = any(v_contacts) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('contact_emails', jsonb_build_object('purged', n));
    with d as (delete from public.contact_income where tenant_id = t and contact_id = any(v_contacts) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('contact_income', jsonb_build_object('purged', n));
    with d as (delete from public.queue_item where tenant_id = t and (contact_id = any(v_contacts) or related_contact_id = any(v_contacts)) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('queue_item', jsonb_build_object('purged', n));
    with d as (delete from public.contact_duplicate_reviews where tenant_id = t and (contact_id = any(v_contacts) or candidate_id = any(v_contacts)) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('contact_duplicate_reviews', jsonb_build_object('purged', n));
    with u as (update public.household_claim_followup set note = null where tenant_id = t and contact_id = any(v_contacts) and note is not null returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('household_claim_followup', jsonb_build_object('anonymised', n));
    with u as (update public.contacts set first_name = '[erased]', last_name = '[erased]', dob = null, primary_phone = null, address_line1 = null, city = null,
                      postal_code = null, custom_fields = '{}'::jsonb, name_search = '', provisional_source = null
                where tenant_id = t and id = any(v_contacts) and first_name is distinct from '[erased]' returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('contacts', jsonb_build_object('anonymised', n, 'reason', 'The client row stays (no name, number, birth date or address) so policies and commissions still reconcile.'));
    with u as (update public.households h set address_line1 = null, address_search = '', address_hash = 'erased:' || h.id
                where h.tenant_id = t and h.id in (select c.household_id from public.contacts c where c.id = any(v_contacts) and c.household_id is not null)
                  and not exists (select 1 from public.contacts o where o.household_id = h.id and not (o.id = any(v_contacts)))
                  and h.address_line1 is not null returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('households', jsonb_build_object('anonymised', n, 'note', 'only a household with nobody else in it'));
    with u as (update public.raw_rows set payload = public.erase_matching_values(payload, v_tokens, v_digits)
                where tenant_id = t and id = any(v_raw) and payload is distinct from public.erase_matching_values(payload, v_tokens, v_digits) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('raw_rows', jsonb_build_object('anonymised', n, 'reason', 'Carrier rows behind the policies: kept for the financial record, the person''s identifiers erased.'));
    with u as (update public.policy_snapshot set extra = public.erase_matching_values(extra, v_tokens, v_digits)
                where tenant_id = t and raw_row_id = any(v_raw) and extra is distinct from public.erase_matching_values(extra, v_tokens, v_digits) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('policy_snapshot', jsonb_build_object('anonymised', n, 'reason', 'Policy history: kept, the person''s identifiers erased.'));
    with u as (update public.policy_current set extra = public.erase_matching_values(extra, v_tokens, v_digits)
                where tenant_id = t and (contact_id = any(v_contacts) or application_id = any(v_apps)) and extra is distinct from public.erase_matching_values(extra, v_tokens, v_digits) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('policy_current', jsonb_build_object('anonymised', n, 'reason', 'Policy and commission records are a financial and tax record: kept, anonymised.'));
    with u as (update public.tenant_commission_statement_lines set raw = public.erase_matching_values(raw, v_tokens, v_digits),
                      insured_name = case when lower(btrim(insured_name)) = any(v_tokens) then '[erased]' else insured_name end
                where tenant_id = t and (raw is distinct from public.erase_matching_values(raw, v_tokens, v_digits) or lower(btrim(insured_name)) = any(v_tokens)) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('tenant_commission_statement_lines', jsonb_build_object('anonymised', n, 'reason', 'Commission statements: kept, anonymised.'));
    with u as (update public.tenant_policies set insured_name = '[erased]' where tenant_id = t and lower(btrim(insured_name)) = any(v_tokens) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('tenant_policies', jsonb_build_object('anonymised', n, 'reason', 'Hand-entered policies: kept, anonymised.'));
    with u as (update public.agent_findings set payload = public.erase_matching_values(payload, v_tokens, v_digits)
                where tenant_id = t and payload is distinct from public.erase_matching_values(payload, v_tokens, v_digits) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('agent_findings', jsonb_build_object('anonymised', n));

  elsif p_group = 'records' then
    with u as (update public.complaint set complainant_name = null, phone_digits = null, contact_id = null, policy_number = null,
                      summary = 'Erased under a deletion request.', response_text = case when response_text is null then null else 'Erased under a deletion request.' end,
                      attachments_json = '[]'::jsonb, response_attachments_json = '[]'::jsonb, notes = null
                where tenant_id = t and (phone_digits = any(v_phones) or contact_id = any(v_contacts)) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('complaint', jsonb_build_object('anonymised', n, 'reason', 'The regulatory record of a complaint and its outcome is kept, without the person.'));
    with u as (update public.compliance_report_log set scope_value = '[erased]'
                where tenant_id = t and scope_value is not null and (scope_value = any(v_phones) or scope_value = any(array(select x::text from unnest(v_leads || v_contacts) x))) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('compliance_report_log', jsonb_build_object('anonymised', n, 'reason', 'Who generated which report is kept; the number is not.'));
    with u as (update public.email_log set to_address = '[erased]' where lower(to_address) = any(v_emails) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('email_log', jsonb_build_object('anonymised', n));
    -- Anything the triggers left: pointers to rows now gone are removed by reconciling.
    perform public.compliance_index_reconcile(t, 'manual');
  else
    raise exception 'data_subject_purge_group: unknown group %', p_group;
  end if;

  update public.deletion_request
     set results_json = results_json || jsonb_build_object(p_group, v_out), groups_done = groups_done || p_group
   where id = p_request_id;
  insert into public.deletion_request_event (request_id, tenant_id, actor_user_id, action, detail)
  values (p_request_id, t, p_actor, 'purged:' || p_group, v_out);
  -- The guards' exception ends with this group: nothing else in the transaction may use it.
  perform set_config('app.data_subject_deletion', '', true);
  return v_out;
end $$;
revoke all on function public.data_subject_purge_group(uuid, text, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.data_subject_purge_group(uuid, text, uuid) to service_role;

-- ─── self-check ─────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v jsonb;
begin
  v := public.erase_matching_values('{"INSUREDNAME":"Jane Q Doe","PHONE1":"(817) 555-0142","BIRTHDATE":"3/7/1951","POLICYNUMBER":"AB123","PREMIUM":"45.10","CITY":"Austin","nested":[{"email":"JANE@EXAMPLE.TEST"}]}'::jsonb,
                                    array['jane q doe', 'jane@example.test', 'doe'], array['8175550142', '371951', '03071951']);
  if v->>'INSUREDNAME' <> '[erased]' or v->>'PHONE1' <> '[erased]' or v->>'BIRTHDATE' <> '[erased]' or v->'nested'->0->>'email' <> '[erased]'
     or v->>'POLICYNUMBER' <> 'AB123' or v->>'PREMIUM' <> '45.10' or v->>'CITY' <> 'Austin' then
    raise exception '20261015140000: erase_matching_values is wrong: %', v;
  end if;
  if has_table_privilege('service_role', 'public.deletion_request_event', 'DELETE') or has_table_privilege('service_role', 'public.deletion_request', 'DELETE') then
    raise exception '20261015140000: the deletion audit trail must not be removable';
  end if;
  -- The do-not-call list is still undeletable after this file.
  if not exists (select 1 from pg_trigger where tgname = 'tenant_do_not_call_permanent' and tgrelid = 'public.tenant_do_not_call'::regclass) then
    raise exception '20261015140000: the permanent do-not-call guard is missing';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261015140000', 'la_6_5_consumer_deletion') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [5/7] 20261015150000_la_6_6_retention.sql ───────────────────────────────────
begin;

-- LA-6.6 (Notion sprint, Module 6 — Compliance) · the retention policy engine and the purge.
--
-- How long each kind of record is kept, by state — and a job that actually deletes things when the
-- time comes, without ever deleting something still needed.
--
--   retention_rule   one row per record type (per state, per tenant); tenant null = platform default,
--                    state null = all states. retain_days, action (purge | anonymise | never_delete),
--                    and the BASIS (statute | carrier_requirement | our_policy | legal_advice) — in a
--                    year someone will ask whether 1,095 days came from a statute or a guess.
--                    Resolution: tenant + state, tenant + all states, platform + state, platform
--                    default. No match means NO purge: the type is reported as unruled.
--   legal_hold       a hold beats the schedule, always. An open complaint (LA-6.4) and a commission
--                    dispute (LA-4.15) place one automatically; releasing is a deliberate, logged act,
--                    and an automatic hold cannot be released while its source is still open.
--   retention_run    every run: dry_run or live, per record type and table the rows matched, held,
--                    purged, and the oldest and newest dates. rows_held separately, so anyone can see
--                    the holds working.
--   retention_execute(tenant, mode, by)   the engine. A live run refuses unless a dry run finished
--                    inside the tenant's window (default 7 days).
--
-- The shipped defaults are a starting point with basis 'our_policy' — not legal advice.
--
-- Three safety rules, all enforced here: (1) a hold beats the schedule; (2) do-not-call entries are
-- never purged — the type is stated as never_delete, a rule cannot change that (a check constraint),
-- and the engine has no branch that touches the list at all; (3) a dry run before every live run.
--
-- Requires 20261015100000–20261015140000. Rollback:
--   select cron.unschedule('la6-retention-daily');
--   drop function if exists public.retention_execute(uuid, text, text), public.retention_scheduled(), public.retention_cutoffs(uuid, text),
--     public.legal_hold_on_complaint(), public.legal_hold_on_dispute(), public.legal_hold_guard(), public.legal_hold_active(uuid, text, uuid, text);
--   drop table if exists public.retention_run, public.legal_hold, public.retention_rule;
--   restore winback_candidate_guard from 20261014500000.

alter table public.compliance_settings
  add column if not exists purge_schedule_enabled boolean not null default false,
  add column if not exists purge_dry_run_window_days integer not null default 7,
  add column if not exists purge_summary_recipients uuid[] not null default '{}';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'compliance_settings_purge_window') then
    alter table public.compliance_settings add constraint compliance_settings_purge_window check (purge_dry_run_window_days between 1 and 30);
  end if;
end $$;

create table if not exists public.retention_rule (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  record_type text not null,
  state text,
  retain_days integer,
  action text not null,
  basis text not null,
  notes text,
  effective_from date not null default current_date,
  set_by uuid references public.users(id) on delete set null,
  set_at timestamptz not null default now(),
  constraint retention_rule_type check (record_type in ('consent_artefacts', 'call_attempt_logs', 'scrub_screening_results', 'transfer_verdicts', 'internal_dnc',
                                                       'lead_data_unconverted', 'nurture_winback_candidates', 'complaint_records', 'policy_commission_records', 'compliance_evidence_reports')),
  constraint retention_rule_state check (state is null or state ~ '^[A-Z]{2}$'),
  constraint retention_rule_action check (action in ('purge', 'anonymise', 'never_delete')),
  constraint retention_rule_basis check (basis in ('statute', 'carrier_requirement', 'our_policy', 'legal_advice')),
  constraint retention_rule_days check ((action = 'never_delete') = (retain_days is null) and (retain_days is null or retain_days between 30 and 7300)),
  -- The do-not-call list is never purged: no rule may say otherwise.
  constraint retention_rule_dnc check (record_type <> 'internal_dnc' or action = 'never_delete')
);
create unique index if not exists retention_rule_scope_idx on public.retention_rule (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), record_type, coalesce(state, '**'));
create index if not exists retention_rule_tenant_idx on public.retention_rule (tenant_id) where tenant_id is not null;
create index if not exists retention_rule_set_by_idx on public.retention_rule (set_by) where set_by is not null;
alter table public.retention_rule enable row level security;
drop policy if exists retention_rule_read on public.retention_rule;
create policy retention_rule_read on public.retention_rule for select to tenant_app using (tenant_id is null or tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.retention_rule from public, anon, authenticated;
revoke insert, update, delete, truncate on public.retention_rule from tenant_app;
revoke truncate on public.retention_rule from service_role;
grant select on public.retention_rule to tenant_app;
grant select, insert, update, delete on public.retention_rule to service_role;

insert into public.retention_rule (tenant_id, record_type, state, retain_days, action, basis, notes) values
  (null, 'consent_artefacts', null, 1461, 'purge', 'our_policy', 'Four years: longer than the usual claim window. This is your defence.'),
  (null, 'call_attempt_logs', null, 1461, 'purge', 'our_policy', 'Four years: proves when and whether you called.'),
  (null, 'scrub_screening_results', null, 1461, 'purge', 'our_policy', 'Four years: proves the number was checked before dialling.'),
  (null, 'transfer_verdicts', null, 1461, 'purge', 'our_policy', 'Four years: why a transfer was accepted.'),
  (null, 'internal_dnc', null, null, 'never_delete', 'our_policy', 'Deleting means calling them again.'),
  (null, 'lead_data_unconverted', null, 548, 'purge', 'our_policy', 'Eighteen months: no reason to hoard it. The number stays while call or consent records still need it.'),
  (null, 'nurture_winback_candidates', null, 548, 'purge', 'our_policy', 'Eighteen months.'),
  (null, 'complaint_records', null, 2557, 'anonymise', 'our_policy', 'Seven years: the regulatory record of the outcome.'),
  (null, 'policy_commission_records', null, 2557, 'anonymise', 'our_policy', 'Seven years after the policy ended: financial and tax obligation.'),
  (null, 'compliance_evidence_reports', null, 365, 'purge', 'our_policy', 'One year: reports are regenerated from the index; no copies are stored.')
on conflict do nothing;

create table if not exists public.legal_hold (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  scope text not null,
  scope_value text,
  reason text not null,
  source_id uuid,
  note text,
  placed_by uuid references public.users(id) on delete set null,
  placed_at timestamptz not null default now(),
  released_by uuid references public.users(id) on delete set null,
  released_at timestamptz,
  release_note text,
  constraint legal_hold_scope check (scope in ('phone_digits', 'contact_id', 'policy_number', 'tenant_wide')),
  constraint legal_hold_value check ((scope = 'tenant_wide') = (scope_value is null)),
  constraint legal_hold_reason check (reason in ('complaint', 'litigation', 'regulator_inquiry', 'commission_dispute', 'manual')),
  constraint legal_hold_released check ((released_at is null) = (released_by is null))
);
create index if not exists legal_hold_active_idx on public.legal_hold (tenant_id, scope, scope_value) where released_at is null;
create index if not exists legal_hold_source_idx on public.legal_hold (source_id) where source_id is not null;
create index if not exists legal_hold_users_idx on public.legal_hold (placed_by, released_by);
alter table public.legal_hold enable row level security;
drop policy if exists legal_hold_read on public.legal_hold;
create policy legal_hold_read on public.legal_hold for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.legal_hold from public, anon, authenticated;
revoke insert, update, delete, truncate on public.legal_hold from tenant_app;
revoke delete, truncate on public.legal_hold from service_role;
grant select on public.legal_hold to tenant_app;
grant select, insert, update on public.legal_hold to service_role;

-- A hold is never removed, only released; an automatic one not while its source is open.
create or replace function public.legal_hold_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if (to_jsonb(new) - 'released_by' - 'released_at' - 'release_note') is distinct from (to_jsonb(old) - 'released_by' - 'released_at' - 'release_note') then
    raise exception 'legal_hold: a hold''s scope and reason never change; place another' using errcode = 'check_violation';
  end if;
  if old.released_at is not null then
    raise exception 'legal_hold: a released hold stays released; place another' using errcode = 'check_violation';
  end if;
  if new.released_at is not null and old.reason = 'complaint' and exists (select 1 from public.complaint c where c.id = old.source_id and c.status <> 'resolved') then
    raise exception 'legal_hold: the complaint is still open; close it to release the hold' using errcode = 'check_violation';
  end if;
  if new.released_at is not null and old.reason = 'commission_dispute' and exists (select 1 from public.commission_dispute d where d.id = old.source_id and d.status in ('draft', 'sent', 'acknowledged')) then
    raise exception 'legal_hold: the commission dispute is still open; close it to release the hold' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function public.legal_hold_guard() from public, anon, authenticated, tenant_app, service_role;
drop trigger if exists legal_hold_guard on public.legal_hold;
create trigger legal_hold_guard before update on public.legal_hold for each row execute function public.legal_hold_guard();

-- An open complaint places a hold on its number and its client, automatically.
create or replace function public.legal_hold_on_complaint()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.phone_digits is not null then
    insert into public.legal_hold (tenant_id, scope, scope_value, reason, source_id, placed_by)
    values (new.tenant_id, 'phone_digits', new.phone_digits, 'complaint', new.id, new.created_by);
  end if;
  if new.contact_id is not null then
    insert into public.legal_hold (tenant_id, scope, scope_value, reason, source_id, placed_by)
    values (new.tenant_id, 'contact_id', new.contact_id::text, 'complaint', new.id, new.created_by);
  end if;
  if new.policy_number is not null then
    insert into public.legal_hold (tenant_id, scope, scope_value, reason, source_id, placed_by)
    values (new.tenant_id, 'policy_number', new.policy_number, 'complaint', new.id, new.created_by);
  end if;
  return null;
end $$;
revoke all on function public.legal_hold_on_complaint() from public, anon, authenticated, tenant_app, service_role;
drop trigger if exists legal_hold_on_complaint on public.complaint;
create trigger legal_hold_on_complaint after insert on public.complaint for each row execute function public.legal_hold_on_complaint();

-- An active commission dispute holds the policies it is about.
create or replace function public.legal_hold_on_dispute()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  insert into public.legal_hold (tenant_id, scope, scope_value, reason, source_id, placed_by)
  select distinct new.tenant_id, 'policy_number', d.policy_number, 'commission_dispute', new.id, new.created_by
    from public.commission_discrepancy d
   where d.tenant_id = new.tenant_id and d.id = any(new.discrepancy_ids) and d.policy_number is not null;
  return null;
end $$;
revoke all on function public.legal_hold_on_dispute() from public, anon, authenticated, tenant_app, service_role;
drop trigger if exists legal_hold_on_dispute on public.commission_dispute;
create trigger legal_hold_on_dispute after insert on public.commission_dispute for each row execute function public.legal_hold_on_dispute();

-- Holds for what is already open today.
insert into public.legal_hold (tenant_id, scope, scope_value, reason, source_id, placed_by)
select distinct d.tenant_id, 'policy_number', cd.policy_number, 'commission_dispute', d.id, d.created_by
  from public.commission_dispute d
  join public.commission_discrepancy cd on cd.tenant_id = d.tenant_id and cd.id = any(d.discrepancy_ids)
 where d.status in ('draft', 'sent', 'acknowledged') and cd.policy_number is not null
   and not exists (select 1 from public.legal_hold h where h.source_id = d.id and h.scope_value = cd.policy_number);
insert into public.legal_hold (tenant_id, scope, scope_value, reason, source_id, placed_by)
select c.tenant_id, 'phone_digits', c.phone_digits, 'complaint', c.id, c.created_by
  from public.complaint c
 where c.status <> 'resolved' and c.phone_digits is not null
   and not exists (select 1 from public.legal_hold h where h.source_id = c.id and h.scope = 'phone_digits');

create table if not exists public.retention_run (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  mode text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  results_json jsonb not null default '[]'::jsonb,
  held_count integer not null default 0,
  unruled text[] not null default '{}',
  triggered_by text not null,
  summary_emailed_at timestamptz,
  constraint retention_run_mode check (mode in ('dry_run', 'live'))
);
create index if not exists retention_run_tenant_idx on public.retention_run (tenant_id, started_at desc);
alter table public.retention_run enable row level security;
drop policy if exists retention_run_read on public.retention_run;
create policy retention_run_read on public.retention_run for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.retention_run from public, anon, authenticated;
revoke insert, update, delete, truncate on public.retention_run from tenant_app;
revoke delete, truncate on public.retention_run from service_role;
grant select on public.retention_run to tenant_app;
grant select, update on public.retention_run to service_role;

-- The win-back record (LA-5.7) is never removed — except by the retention purge.
create or replace function public.winback_candidate_guard()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_sync boolean := coalesce(current_setting('app.winback_sync', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    -- LA-6.6: a retention run past the candidate's retention period may remove it.
    if coalesce(current_setting('app.retention_purge', true), '') = 'on' then
      return old;
    end if;
    raise exception 'A win-back candidate is never removed.' using errcode = 'P0001';
  end if;
  if (new.tenant_id, new.carrier_id, new.source_policy_number, new.lapsed_on, new.created_at)
     is distinct from (old.tenant_id, old.carrier_id, old.source_policy_number, old.lapsed_on, old.created_at) then
    raise exception 'A candidate''s policy and lapse never change.' using errcode = 'P0001';
  end if;
  if old.winback_band = 'never' and new.winback_band <> 'never' then
    raise exception 'A client who must not be called stays that way.' using errcode = 'P0001';
  end if;
  if new.released_to_nurture_at is not null and old.released_to_nurture_at is null then
    if new.winback_band = 'never' then
      raise exception 'A never-call candidate cannot be released.' using errcode = 'P0001';
    end if;
    if new.eligible_from is null or new.eligible_from > current_date then
      raise exception 'Not before the cooling-off ends (%).', new.eligible_from using errcode = 'P0001';
    end if;
  end if;
  if old.released_to_nurture_at is not null and (to_jsonb(new) - 'updated_at' - 'released_lead_id' - 'campaign_id') is distinct from (to_jsonb(old) - 'updated_at' - 'released_lead_id' - 'campaign_id') then
    raise exception 'A released candidate is history.' using errcode = 'P0001';
  end if;
  if (new.lapse_reason_category, new.reason_source, new.reason_inferred, new.winback_band, new.eligible_from)
     is distinct from (old.lapse_reason_category, old.reason_source, old.reason_inferred, old.winback_band, old.eligible_from)
     and not v_sync then
    raise exception 'Only the win-back check classifies a candidate.' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

-- Per record type: the rule each state resolves to (four levels), keyed by state ('**' = all states).
create or replace function public.retention_cutoffs(p_tenant_id uuid, p_record_type text)
returns table(state text, retain_days integer, action text, basis text, rule_id uuid)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with states as (select unnest(array['**', 'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']) as st)
  select s.st, r.retain_days, r.action, r.basis, r.id
    from states s
    cross join lateral (
      select r.* from public.retention_rule r
       where r.record_type = p_record_type and r.effective_from <= current_date
         and (r.tenant_id = p_tenant_id or r.tenant_id is null)
         and (r.state = s.st or r.state is null)
       order by (r.tenant_id is null), (r.state is null), r.effective_from desc
       limit 1
    ) r
$$;
revoke all on function public.retention_cutoffs(uuid, text) from public, anon, authenticated, tenant_app;
grant execute on function public.retention_cutoffs(uuid, text) to service_role;

-- Is something under a hold? (phone, client, policy, or the whole tenant.)
create or replace function public.legal_hold_active(p_tenant_id uuid, p_phone text, p_contact uuid, p_policy text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.legal_hold h
     where h.tenant_id = p_tenant_id and h.released_at is null
       and (h.scope = 'tenant_wide'
            or (h.scope = 'phone_digits' and h.scope_value = p_phone)
            or (h.scope = 'contact_id' and h.scope_value = p_contact::text)
            or (h.scope = 'policy_number' and h.scope_value = p_policy)))
$$;
revoke all on function public.legal_hold_active(uuid, text, uuid, text) from public, anon, authenticated, tenant_app;
grant execute on function public.legal_hold_active(uuid, text, uuid, text) to service_role;

-- ─── the engine ─────────────────────────────────────────────────────────────────────────────────
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
begin
  if p_mode not in ('dry_run', 'live') then
    raise exception 'retention_execute: mode is dry_run or live';
  end if;
  if v_live then
    select coalesce(s.purge_dry_run_window_days, 7) into v_window from public.compliance_settings s where s.tenant_id = p_tenant_id;
    v_window := coalesce(v_window, 7);
    if not exists (select 1 from public.retention_run r where r.tenant_id = p_tenant_id and r.mode = 'dry_run' and r.finished_at >= now() - make_interval(days => v_window)) then
      raise exception 'retention_execute: a live run needs a dry run in the last % days', v_window using errcode = 'check_violation';
    end if;
    perform set_config('app.retention_purge', 'on', true);
  end if;
  insert into public.retention_run (tenant_id, mode, triggered_by) values (p_tenant_id, p_mode, coalesce(p_triggered_by, 'manual')) returning id into v_run;

  foreach v_type in array array['consent_artefacts', 'call_attempt_logs', 'scrub_screening_results', 'transfer_verdicts', 'lead_data_unconverted',
                                'nurture_winback_candidates', 'complaint_records', 'policy_commission_records', 'compliance_evidence_reports'] loop
    select jsonb_object_agg(x.state, jsonb_build_object('days', x.retain_days, 'action', x.action)) into v_rules from public.retention_cutoffs(p_tenant_id, v_type) x;
    if v_rules is null or v_rules = '{}'::jsonb then
      v_unruled := v_unruled || v_type;
      continue;
    end if;

    if v_type = 'consent_artefacts' then
      create temp table if not exists retention_due (id uuid, held boolean, at timestamptz) on commit drop;
      truncate retention_due;
      insert into retention_due
      select c.id, public.legal_hold_active(p_tenant_id, public.compliance_lead_phone(l.values), l.contact_id, null), coalesce(c.consent_timestamp, c.captured_at)
        from public.tenant_consent_artefacts c
        join public.agent_leads l on l.id = c.lead_id and l.tenant_id = c.tenant_id
        cross join lateral (select coalesce(v_rules->upper(l.values->>'state'), v_rules->'**') r) rr
       where c.tenant_id = p_tenant_id and rr.r->>'action' = 'purge'
         and coalesce(c.consent_timestamp, c.captured_at) < now() - make_interval(days => (rr.r->>'days')::int);
      select count(*), count(*) filter (where held), min(at), max(at) into m, h, v_old, v_new from retention_due;
      p := 0;
      if v_live then
        with d as (delete from public.tenant_consent_artefacts t using retention_due x where t.id = x.id and not x.held returning 1) select count(*) into p from d;
      end if;
      v_results := v_results || jsonb_build_array(jsonb_build_object('record_type', v_type, 'table', 'tenant_consent_artefacts', 'rows_matched', m, 'rows_held', h, 'rows_purged', p, 'oldest', v_old, 'newest', v_new));
      v_held := v_held + h;

    elsif v_type = 'call_attempt_logs' then
      create temp table if not exists retention_due (id uuid, held boolean, at timestamptz) on commit drop;
      truncate retention_due;
      insert into retention_due
      select a.id, public.legal_hold_active(p_tenant_id, public.compliance_lead_phone(l.values), l.contact_id, null), a.attempted_at
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
      select l.id, public.legal_hold_active(p_tenant_id, public.compliance_lead_phone(l.values), l.contact_id, null), l.created_at
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

-- The schedule: for a tenant that switched it on, a dry run first (its summary is emailed by the
-- app), and the live run once the window has passed — never a live run without a fresh dry run.
create or replace function public.retention_scheduled()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  s record;
  v_dry timestamptz;
  v_live timestamptz;
  v_out jsonb := '[]'::jsonb;
begin
  for s in select * from public.compliance_settings where purge_schedule_enabled loop
    select max(finished_at) into v_dry from public.retention_run where tenant_id = s.tenant_id and mode = 'dry_run';
    select max(finished_at) into v_live from public.retention_run where tenant_id = s.tenant_id and mode = 'live';
    if v_dry is null or v_dry < now() - make_interval(days => s.purge_dry_run_window_days) or (v_live is not null and v_live > v_dry) then
      perform public.retention_execute(s.tenant_id, 'dry_run', 'schedule');
      v_out := v_out || jsonb_build_array(jsonb_build_object('tenant', s.tenant_id, 'ran', 'dry_run'));
    elsif v_dry <= now() - make_interval(days => greatest(s.purge_dry_run_window_days - 1, 1)) and (v_live is null or v_live < v_dry) then
      perform public.retention_execute(s.tenant_id, 'live', 'schedule');
      v_out := v_out || jsonb_build_array(jsonb_build_object('tenant', s.tenant_id, 'ran', 'live'));
    end if;
  end loop;
  return v_out;
end $$;
revoke all on function public.retention_scheduled() from public, anon, authenticated, tenant_app;
grant execute on function public.retention_scheduled() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('la6-retention-daily', '30 4 * * *', $cron$select public.retention_scheduled()$cron$);
    exception when others then
      raise notice '20261015150000: the retention schedule could not be set (%).', sqlerrm;
    end;
  end if;
end $$;

-- ─── self-check ─────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_run uuid;
begin
  if (select count(*) from public.retention_rule where tenant_id is null and state is null) < 10 then
    raise exception '20261015150000: the platform defaults are missing';
  end if;
  begin
    insert into public.retention_rule (record_type, retain_days, action, basis) values ('internal_dnc', 365, 'purge', 'our_policy');
    raise exception '20261015150000: a rule was allowed to purge the do-not-call list';
  exception when check_violation then null;
  end;
  select id into v_tenant from public.tenants limit 1;
  if v_tenant is not null then
    begin
      begin
        perform public.retention_execute(v_tenant, 'live', 'migration');
        raise exception '20261015150000: a live run ran without a dry run';
      exception when check_violation then null;
      end;
      raise exception using errcode = 'P0099';
    exception when sqlstate 'P0099' then null;
    end;
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261015150000', 'la_6_6_retention') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [6/7] 20261015160000_la_6_7_dashboard_figures.sql ───────────────────────────
begin;

-- LA-6.7 (Notion sprint, Module 6 — Compliance) · the compliance dashboard's standing figures, in one
-- round trip. It collects nothing new: every count reads a table another task already writes (LA-2.3
-- the do-not-call list and campaign scrubs, LA-6.1 the index, LA-6.2 verdicts, LA-6.5 deletion
-- requests, LA-6.6 holds). The gap figures (called after DNC, outside hours, missing consent) come
-- from LA-6.3's compliance_gaps, which the page calls itself.
--
-- Requires 20261015100000–20261015150000. Rollback: drop function if exists public.compliance_dashboard_figures(uuid);

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
    'unruled_types', coalesce((select to_jsonb(r.unruled) from public.retention_run r where r.tenant_id = p_tenant_id order by r.started_at desc limit 1), '[]'::jsonb)
  )
$$;
revoke all on function public.compliance_dashboard_figures(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.compliance_dashboard_figures(uuid) to service_role;

do $$
declare
  v jsonb;
begin
  v := public.compliance_dashboard_figures('00000000-0000-0000-0000-000000000000'::uuid);
  if not (v ? 'called_numbers' and v ? 'dnc_active' and v ? 'holds_active') then
    raise exception '20261015160000: the dashboard figures are incomplete: %', v;
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261015160000', 'la_6_7_dashboard_figures') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [7/7] 20261015170000_la_6_8_compliance_settings.sql ─────────────────────────
begin;

-- LA-6.8 (Notion sprint, Module 6 — Compliance) · compliance settings: one place for everything LA-6
-- reads. Tenant-level; enforced on the server; every change audited.
--
--   compliance_settings          + who may perform a deletion, who may generate evidence reports,
--                                which gap checks run, which dashboard tiles show, and the monthly
--                                email (on by default) and its recipients. Earlier files added the
--                                gate (6.2), complaint thresholds (6.4), deletion hold and methods
--                                (6.5) and the purge job (6.6).
--   compliance_setting_change    who changed what, from what, to what, and when — for every LA-6
--                                setting, retention rule and complaint deadline. Append-only.
--
-- Platform caps cannot be removed here: the deletion hold floor (3 days, a check constraint in 6.5),
-- the litigator and internal-DNC gate checks (no column exists to switch them off, 6.2), and the
-- never-delete rule for the do-not-call list (a check constraint in 6.6).
--
-- Requires 20261015100000–20261015160000. Additive. Rollback:
--   drop table if exists public.compliance_setting_change;
--   alter table public.compliance_settings drop column if exists deletion_performer_roles, drop column if exists report_roles,
--     drop column if exists report_gap_checks, drop column if exists dashboard_hidden_tiles, drop column if exists dashboard_monthly_email,
--     drop column if exists dashboard_email_recipients;

alter table public.compliance_settings
  add column if not exists deletion_performer_roles text[] not null default array['owner'],
  add column if not exists report_roles text[] not null default array['owner', 'producer'],
  add column if not exists report_gap_checks text[] not null default array['called_after_dnc', 'called_after_complaint', 'calls_without_consent', 'consent_expired_before_call',
                                                                            'outside_legal_hours', 'never_scrubbed', 'transfer_without_verdict', 'disclosure_missing'],
  add column if not exists dashboard_hidden_tiles text[] not null default '{}',
  add column if not exists dashboard_monthly_email boolean not null default true,
  add column if not exists dashboard_email_recipients uuid[] not null default '{}';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'compliance_settings_deletion_performers') then
    -- The tenant admin always may; a producer only if the owner says so. Never a setter or an assistant.
    alter table public.compliance_settings add constraint compliance_settings_deletion_performers
      check ('owner' = any(deletion_performer_roles) and deletion_performer_roles <@ array['owner', 'producer']);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'compliance_settings_report_roles') then
    alter table public.compliance_settings add constraint compliance_settings_report_roles
      check ('owner' = any(report_roles) and report_roles <@ array['owner', 'producer']);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'compliance_settings_gap_checks') then
    alter table public.compliance_settings add constraint compliance_settings_gap_checks
      check (report_gap_checks <@ array['called_after_dnc', 'called_after_complaint', 'calls_without_consent', 'consent_expired_before_call',
                                        'outside_legal_hours', 'never_scrubbed', 'transfer_without_verdict', 'disclosure_missing']);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'compliance_settings_tiles') then
    alter table public.compliance_settings add constraint compliance_settings_tiles
      check (dashboard_hidden_tiles <@ array['consent_coverage', 'campaigns_scrubbed', 'outside_hours', 'dnc_size', 'screened_before_transfer', 'deletions_and_holds']);
  end if;
end $$;

create table if not exists public.compliance_setting_change (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  section text not null,
  setting text not null,
  old_value jsonb,
  new_value jsonb,
  changed_by uuid references public.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  constraint compliance_setting_change_section check (section in ('complaint_deadlines', 'retention_rules', 'purge_job', 'legal_holds', 'deletion_requests', 'transfer_gate', 'evidence_report', 'dashboard'))
);
create index if not exists compliance_setting_change_tenant_idx on public.compliance_setting_change (tenant_id, changed_at desc);
create index if not exists compliance_setting_change_user_idx on public.compliance_setting_change (changed_by) where changed_by is not null;
alter table public.compliance_setting_change enable row level security;
drop policy if exists compliance_setting_change_read on public.compliance_setting_change;
create policy compliance_setting_change_read on public.compliance_setting_change for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.compliance_setting_change from public, anon, authenticated;
revoke update, delete, truncate on public.compliance_setting_change from service_role, tenant_app;
revoke insert on public.compliance_setting_change from tenant_app;
grant select on public.compliance_setting_change to tenant_app;
grant select, insert on public.compliance_setting_change to service_role;

do $$
begin
  if has_table_privilege('service_role', 'public.compliance_setting_change', 'UPDATE') or has_table_privilege('service_role', 'public.compliance_setting_change', 'DELETE') then
    raise exception '20261015170000: the settings audit must not be editable';
  end if;
  begin
    insert into public.compliance_settings (tenant_id, deletion_performer_roles) select id, array['producer'] from public.tenants limit 1;
    raise exception '20261015170000: the tenant admin was removed from who may delete';
  exception when check_violation then null;
  end;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261015170000', 'la_6_8_compliance_settings') on conflict do nothing;
  end if;
end $bundle$;
commit;
