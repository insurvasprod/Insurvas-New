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
