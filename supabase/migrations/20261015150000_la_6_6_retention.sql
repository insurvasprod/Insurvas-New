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
