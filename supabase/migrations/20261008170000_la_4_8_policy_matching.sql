-- LA-4.8 (Notion sprint) · policy ↔ CRM matching: link every carrier policy to the right client and
-- the right agent, and record how each link was made so a wrong one can be found and unwound.
--
--   · policy_match — the link record. Append-only: a correction is a new row and the old one points
--     at it (superseded_by_id); a confirmation is stamped once. One current link per policy. Every
--     link carries its method; an AI link must carry its model, prompt version, confidence and
--     reasoning (the CHECK refuses it otherwise), and a non-AI link may carry none of them.
--   · The ladder, cheapest first (lib/ingestion/policyMatchingStore.ts):
--       1. the policy already has a current link → nothing to do;
--       2. its number matches an LA-3.15 submission (submission_record) or our own LA-2.17 issued
--          policy (policy_number_exact) → linked with certainty, no AI;
--       3. otherwise a scored shortlist goes to policy_match_review. The AI reviewer is not
--          configured yet, so a person decides; the queue is what the AI will read later.
--     policy_match_ladder counts, per file, how many policies each step resolved.
--   · carrier_agent_map — the carrier's agent string → our user, EXACT match only, mapped once by a
--     person. No fuzzy names. An identifier with no row stays unresolved and shows in a queue.
--   · refresh_policy_current is re-created to fill contact_id, household_id (from the current link)
--     and agent_user_id (from the map). Everything else in it is unchanged from 20261008160000.
--
-- Additive. Requires 20261008160000 (policy_current).
--
-- Rollback:
--   (re-run 20261008160000's refresh_policy_current definition)
--   drop table if exists public.policy_match_ladder, public.policy_match_review, public.carrier_agent_map, public.policy_match;

create table if not exists public.policy_match (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  policy_number text not null,
  matched_to_type text not null,
  matched_to_id uuid,
  contact_id uuid references public.contacts(id) on delete set null,
  household_id uuid references public.households(id) on delete set null,
  method text not null,
  ladder_step smallint not null,
  confidence smallint,
  reasoning text,
  model_id text,
  prompt_version text,
  confirmed_by uuid references public.users(id) on delete set null,
  confirmed_at timestamptz,
  -- Deferred: a correction points the old link at the new one inside record_policy_match.
  superseded_by_id uuid references public.policy_match(id) on delete restrict deferrable initially deferred,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint policy_match_type check (matched_to_type in ('deal_flow', 'application', 'contact', 'provisional')),
  constraint policy_match_method check (method in ('policy_number_exact', 'submission_record', 'ai_review', 'human', 'import')),
  constraint policy_match_step check (ladder_step in (2, 3)),
  constraint policy_match_target check ((matched_to_type = 'provisional') = (matched_to_id is null)),
  constraint policy_match_confidence check (confidence is null or confidence between 0 and 100),
  constraint policy_match_exact_has_no_confidence check (method not in ('policy_number_exact', 'submission_record') or (confidence is null and ladder_step = 2)),
  constraint policy_match_ai_is_explained check (method <> 'ai_review' or (model_id is not null and prompt_version is not null and confidence is not null and reasoning is not null)),
  constraint policy_match_only_ai_has_a_model check (method = 'ai_review' or (model_id is null and prompt_version is null)),
  constraint policy_match_confirmed check ((confirmed_at is null) = (confirmed_by is null)),
  constraint policy_match_reasoning check (reasoning is null or char_length(reasoning) <= 4000),
  constraint policy_match_not_self check (superseded_by_id is null or superseded_by_id <> id)
);
create unique index if not exists policy_match_current_key on public.policy_match (tenant_id, carrier_id, policy_number) where superseded_by_id is null;
create index if not exists policy_match_policy_idx on public.policy_match (tenant_id, carrier_id, policy_number, created_at desc);
create index if not exists policy_match_method_idx on public.policy_match (tenant_id, method, model_id, prompt_version);
create index if not exists policy_match_contact_idx on public.policy_match (contact_id) where contact_id is not null;
create index if not exists policy_match_household_idx on public.policy_match (household_id) where household_id is not null;
create index if not exists policy_match_carrier_idx on public.policy_match (carrier_id);
create index if not exists policy_match_superseded_idx on public.policy_match (superseded_by_id) where superseded_by_id is not null;
create index if not exists policy_match_confirmed_by_idx on public.policy_match (confirmed_by) where confirmed_by is not null;
create index if not exists policy_match_created_by_idx on public.policy_match (created_by) where created_by is not null;

-- A link is never edited or removed. Two stamps are allowed, each once: superseded, confirmed.
create or replace function public.policy_match_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A policy link is never removed; correct it with a new link.' using errcode = 'P0001';
  end if;
  if (to_jsonb(new) - 'superseded_by_id' - 'confirmed_by' - 'confirmed_at') = (to_jsonb(old) - 'superseded_by_id' - 'confirmed_by' - 'confirmed_at')
     and (old.superseded_by_id is null or new.superseded_by_id is not distinct from old.superseded_by_id)
     and (old.confirmed_at is null or (new.confirmed_at is not distinct from old.confirmed_at and new.confirmed_by is not distinct from old.confirmed_by)) then
    return new;
  end if;
  raise exception 'A policy link is never edited; correct it with a new link.' using errcode = 'P0001';
end;
$$;
drop trigger if exists policy_match_guard on public.policy_match;
create trigger policy_match_guard before update or delete on public.policy_match
  for each row execute function public.policy_match_guard();

create table if not exists public.policy_match_review (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  policy_number text not null,
  file_id uuid references public.file_registry(id) on delete set null,
  status text not null default 'open',
  carrier_row jsonb not null default '{}'::jsonb,
  shortlist jsonb not null default '[]'::jsonb,
  match_id uuid references public.policy_match(id) on delete restrict,
  resolved_by uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint policy_match_review_status check (status in ('open', 'resolved')),
  constraint policy_match_review_shortlist check (jsonb_typeof(shortlist) = 'array' and jsonb_typeof(carrier_row) = 'object'),
  constraint policy_match_review_resolved check ((status = 'resolved') = (match_id is not null and resolved_at is not null))
);
create unique index if not exists policy_match_review_open_key on public.policy_match_review (tenant_id, carrier_id, policy_number) where status = 'open';
create index if not exists policy_match_review_queue_idx on public.policy_match_review (tenant_id, status, created_at);
create index if not exists policy_match_review_carrier_idx on public.policy_match_review (carrier_id);
create index if not exists policy_match_review_file_idx on public.policy_match_review (file_id) where file_id is not null;
create index if not exists policy_match_review_match_idx on public.policy_match_review (match_id) where match_id is not null;
create index if not exists policy_match_review_resolved_by_idx on public.policy_match_review (resolved_by) where resolved_by is not null;

create table if not exists public.carrier_agent_map (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  agent_identifier text not null,
  user_id uuid not null references public.users(id) on delete restrict,
  mapped_by uuid references public.users(id) on delete set null,
  mapped_at timestamptz not null default now(),
  constraint carrier_agent_map_identifier check (char_length(agent_identifier) between 1 and 200),
  constraint carrier_agent_map_key unique (tenant_id, carrier_id, agent_identifier)
);
create index if not exists carrier_agent_map_carrier_idx on public.carrier_agent_map (carrier_id);
create index if not exists carrier_agent_map_user_idx on public.carrier_agent_map (user_id);
create index if not exists carrier_agent_map_mapped_by_idx on public.carrier_agent_map (mapped_by) where mapped_by is not null;

create table if not exists public.policy_match_ladder (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  file_id uuid references public.file_registry(id) on delete set null,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  already_linked integer not null default 0,
  exact_linked integer not null default 0,
  to_review integer not null default 0,
  created_at timestamptz not null default now(),
  constraint policy_match_ladder_counts check (already_linked >= 0 and exact_linked >= 0 and to_review >= 0)
);
create index if not exists policy_match_ladder_tenant_idx on public.policy_match_ladder (tenant_id, created_at desc);
create index if not exists policy_match_ladder_file_idx on public.policy_match_ladder (file_id) where file_id is not null;
create index if not exists policy_match_ladder_carrier_idx on public.policy_match_ladder (carrier_id);

-- What the refresh joins on.
create index if not exists tenant_issued_policies_number_idx on public.tenant_issued_policies (tenant_id, policy_number) where policy_number is not null;

alter table public.policy_match enable row level security;
alter table public.policy_match_review enable row level security;
alter table public.carrier_agent_map enable row level security;
alter table public.policy_match_ladder enable row level security;
drop policy if exists policy_match_read on public.policy_match;
create policy policy_match_read on public.policy_match for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists policy_match_review_read on public.policy_match_review;
create policy policy_match_review_read on public.policy_match_review for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists carrier_agent_map_read on public.carrier_agent_map;
create policy carrier_agent_map_read on public.carrier_agent_map for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists policy_match_ladder_read on public.policy_match_ladder;
create policy policy_match_ladder_read on public.policy_match_ladder for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.policy_match, public.policy_match_review, public.carrier_agent_map, public.policy_match_ladder from public, anon, authenticated;
-- Supabase grants service_role everything on a new table by default: take the writes back, so a
-- link can only be written through record_policy_match.
revoke insert, update, delete, truncate on public.policy_match from service_role, tenant_app;
revoke truncate on public.policy_match_review, public.carrier_agent_map, public.policy_match_ladder from service_role, tenant_app;
grant select on public.policy_match to service_role;
grant select, insert, update on public.policy_match_review, public.policy_match_ladder to service_role;
grant select, insert, update, delete on public.carrier_agent_map to service_role;
grant select on public.policy_match, public.policy_match_review, public.carrier_agent_map, public.policy_match_ladder to tenant_app;


-- The one way a link is written. Supersedes the policy's current link (if any) and inserts the new
-- one in a single statement's transaction, and closes the review it answers. household_id comes
-- from the contact. Returns the new link's id.
create or replace function public.record_policy_match(p_tenant_id uuid, p_carrier_id uuid, p_policy_number text, p_match jsonb, p_review_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
  v_contact uuid := nullif(p_match->>'contact_id', '')::uuid;
  v_confirmed_by uuid := nullif(p_match->>'confirmed_by', '')::uuid;
begin
  perform pg_advisory_xact_lock(hashtext('policy_match:' || p_tenant_id::text || ':' || p_carrier_id::text || ':' || p_policy_number));
  if v_contact is not null and not exists (select 1 from public.contacts where id = v_contact and tenant_id = p_tenant_id) then
    raise exception 'record_policy_match: that client is not in this agency' using errcode = '22023';
  end if;
  update public.policy_match set superseded_by_id = v_id
   where tenant_id = p_tenant_id and carrier_id = p_carrier_id and policy_number = p_policy_number and superseded_by_id is null;
  insert into public.policy_match (id, tenant_id, carrier_id, policy_number, matched_to_type, matched_to_id, contact_id, household_id, method, ladder_step,
                                   confidence, reasoning, model_id, prompt_version, confirmed_by, confirmed_at, created_by)
  values (v_id, p_tenant_id, p_carrier_id, p_policy_number, p_match->>'matched_to_type', nullif(p_match->>'matched_to_id', '')::uuid, v_contact,
          (select household_id from public.contacts where id = v_contact), p_match->>'method', (p_match->>'ladder_step')::smallint,
          nullif(p_match->>'confidence', '')::smallint, p_match->>'reasoning', p_match->>'model_id', p_match->>'prompt_version',
          v_confirmed_by, case when v_confirmed_by is null then null else now() end, nullif(p_match->>'created_by', '')::uuid);
  update public.policy_match_review set status = 'resolved', match_id = v_id, resolved_by = v_confirmed_by, resolved_at = now(), updated_at = now()
   where tenant_id = p_tenant_id and carrier_id = p_carrier_id and policy_number = p_policy_number and status = 'open'
     and (p_review_id is null or id = p_review_id);
  return v_id;
end;
$$;
revoke all on function public.record_policy_match(uuid, uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.record_policy_match(uuid, uuid, text, jsonb, uuid) to service_role;

-- A person confirms a link (an AI link, later). Once.
create or replace function public.confirm_policy_match(p_tenant_id uuid, p_match_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.policy_match set confirmed_by = p_user_id, confirmed_at = now()
   where id = p_match_id and tenant_id = p_tenant_id and confirmed_at is null and superseded_by_id is null;
  return found;
end;
$$;
revoke all on function public.confirm_policy_match(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.confirm_policy_match(uuid, uuid, uuid) to service_role;
-- refresh_policy_current, as in 20261008160000 plus the three LA-4.8 links.
create or replace function public.refresh_policy_current(p_tenant_id uuid default null, p_carrier_id uuid default null, p_policy_numbers text[] default null, p_as_of date default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_policy_numbers is not null and (p_tenant_id is null or p_carrier_id is null) then
    raise exception 'refresh_policy_current: a list of policies needs its agency and carrier' using errcode = '22023';
  end if;

  delete from public.policy_current pc
   where (p_tenant_id is null or pc.tenant_id = p_tenant_id)
     and (p_carrier_id is null or pc.carrier_id = p_carrier_id)
     and (p_policy_numbers is null or pc.policy_number = any (p_policy_numbers));

  insert into public.policy_current (
    tenant_id, agency_id, carrier_id, policy_number, snapshot_id,
    carrier_status_raw, status_reported, status_normalized, paid_to_date, effective_date, issue_date, application_date, termination_date,
    premium_cents, premium_mode, payment_method, face_amount_cents, product_code, product_tier, agent_identifier, extra,
    contact_id, household_id, agent_user_id, application_id, case_id, campaign_id, vendor_id,
    as_of, annualised_premium_cents, days_past_due, retention_rule_id, days_until_carrier_closes, months_paid, in_clawback_window,
    risk_band, first_seen_date, last_snapshot_date, lapsed_on, issued_on
  )
  with live as (
    select s.*
      from public.policy_snapshot s
     where not s.superseded
       and (p_tenant_id is null or s.tenant_id = p_tenant_id)
       and (p_carrier_id is null or s.carrier_id = p_carrier_id)
       and (p_policy_numbers is null or s.policy_number = any (p_policy_numbers))
  ),
  latest as (
    select distinct on (l.tenant_id, l.carrier_id, l.policy_number) l.*,
           min(l.snapshot_date) over (partition by l.tenant_id, l.carrier_id, l.policy_number) as first_seen
      from live l
     order by l.tenant_id, l.carrier_id, l.policy_number, l.snapshot_date desc, l.created_at desc
  ),
  -- Materialized: once per agency. Inlined, the timezone lookup ran for every policy, at every use
  -- of the date (29 s for 50,000 policies in the rehearsal).
  zones as materialized (
    select t.tenant_id,
           coalesce(p_as_of, (now() at time zone coalesce((select z.name from pg_timezone_names z where z.name = ap.timezone limit 1), 'UTC'))::date) as as_of
      from (select distinct tenant_id from latest) t
      left join public.agency_profiles ap on ap.tenant_id = t.tenant_id
  ),
  dated as (
    select l.*, z.as_of,
           case when l.paid_to_date is null then null else greatest(0, z.as_of - l.paid_to_date) end as dpd,
           case when l.paid_to_date is null or (l.effective_date is not null and l.paid_to_date <= l.effective_date) then 'first_payment' else 'ongoing_payment' end as rule_type,
           case when l.effective_date is null or l.paid_to_date is null then null
                when l.paid_to_date <= l.effective_date then 0
                else (extract(year from age(l.paid_to_date, l.effective_date)) * 12 + extract(month from age(l.paid_to_date, l.effective_date)))::integer end as months
      from latest l
      join zones z on z.tenant_id = l.tenant_id
  ),
  ruled as (
    select d.*,
           case when ag.id is not null and not ag.cleared then ag.id else pf.id end as rule_id,
           case when ag.id is not null and not ag.cleared then ag.window_days else pf.window_days end as window_days,
           case when ag.id is not null and not ag.cleared then ag.grace_days else pf.grace_days end as grace_days,
           adv.clawback_months
      from dated d
      left join lateral (
        select r.id, r.window_days, r.grace_days, r.cleared from public.carrier_retention_rule r
         where r.tenant_id = d.tenant_id and r.carrier_id = d.carrier_id and r.rule_type = d.rule_type and r.effective_from <= d.as_of
         order by r.effective_from desc, r.created_at desc limit 1
      ) ag on true
      left join lateral (
        select r.id, r.window_days, r.grace_days from public.carrier_retention_rule r
         where r.tenant_id is null and r.carrier_id = d.carrier_id and r.rule_type = d.rule_type and r.effective_from <= d.as_of
         order by r.effective_from desc, r.created_at desc limit 1
      ) pf on true
      left join lateral (
        select a.clawback_months from public.advance_rules a
         where a.tenant_id = d.tenant_id and a.carrier_id = d.carrier_id and a.product_code = d.product_code and a.effective_from <= d.as_of
         order by a.effective_from desc limit 1
      ) adv on true
  ),
  statused as (
    select r.*,
           case when r.status_normalized = 'active' and r.grace_days is not null and r.dpd is not null and r.dpd > r.grace_days then 'at_risk' else r.status_normalized end as status_eff
      from ruled r
  ),
  computed as (
    select s.*,
           case when s.status_eff in ('active', 'at_risk') and s.window_days is not null and s.dpd is not null then s.window_days - s.dpd end as until_closes,
           case when s.months is null or s.clawback_months is null then null else s.months < s.clawback_months end as in_clawback
      from statused s
  )
  select c.tenant_id, c.agency_id, c.carrier_id, c.policy_number, c.id,
         c.carrier_status_raw, c.status_normalized, c.status_eff, c.paid_to_date, c.effective_date, c.issue_date, c.application_date, c.termination_date,
         c.premium_cents, c.premium_mode, c.payment_method, c.face_amount_cents, c.product_code, c.product_tier, c.agent_identifier, c.extra,
         pm.contact_id, ct.household_id, am.user_id, app.id, app.case_id, cs.campaign_id, cs.vendor_id,
         c.as_of,
         c.premium_cents * case c.premium_mode when 'monthly' then 12 when 'quarterly' then 4 when 'semiannual' then 2 when 'annual' then 1 end,
         c.dpd, c.rule_id, c.until_closes, c.months, c.in_clawback,
         case when c.status_eff = 'at_risk' and (c.in_clawback is true or (c.until_closes is not null and c.until_closes <= 0)) then 'critical'
              when c.status_eff = 'at_risk' then 'at_risk'
              when c.status_eff = 'active' and coalesce(c.dpd, 0) > 0 then 'watch'
              else 'none' end,
         c.first_seen, c.snapshot_date,
         case when c.status_eff = 'lapsed' then (
           select max(pc.to_snapshot_date) from public.policy_change pc
            where pc.tenant_id = c.tenant_id and pc.carrier_id = c.carrier_id and pc.policy_number = c.policy_number
              and pc.field_name = 'status_normalized' and pc.new_value = 'lapsed') end,
         (select min(pc.to_snapshot_date) from public.policy_change pc
           where pc.tenant_id = c.tenant_id and pc.carrier_id = c.carrier_id and pc.policy_number = c.policy_number
             and pc.field_name = 'status_normalized' and pc.new_value = 'active' and pc.old_value in ('submitted', 'approved_unpaid'))
    from computed c
    left join lateral (
      select x.application_id from public.tenant_application_submissions x
       where x.tenant_id = c.tenant_id and x.carrier_id = c.carrier_id and x.policy_number = c.policy_number
       order by x.submitted_at desc, x.id limit 1
    ) sub on true
    -- LA-4.8: the policy's current link gives the client; the carrier's exact agent string gives the agent.
    left join public.policy_match pm on pm.tenant_id = c.tenant_id and pm.carrier_id = c.carrier_id and pm.policy_number = c.policy_number and pm.superseded_by_id is null
    left join public.contacts ct on ct.id = pm.contact_id
    left join public.carrier_agent_map am on am.tenant_id = c.tenant_id and am.carrier_id = c.carrier_id and am.agent_identifier = c.agent_identifier
    left join public.tenant_applications app on app.id = coalesce(sub.application_id, case when pm.matched_to_type = 'application' then pm.matched_to_id end)
    left join public.tenant_application_cases cs on cs.id = app.case_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.refresh_policy_current(uuid, uuid, text[], date) from public, anon, authenticated;
grant execute on function public.refresh_policy_current(uuid, uuid, text[], date) to service_role;

-- Fill the links in now, and check the table still has one row per live policy.
do $$
declare
  v_rows integer;
  v_policies integer;
begin
  v_rows := public.refresh_policy_current_daily();
  select count(*) into v_policies from (select distinct tenant_id, carrier_id, policy_number from public.policy_snapshot where not superseded) p;
  if v_rows <> v_policies then
    raise exception '20261008170000: policy_current has % rows for % policies', v_rows, v_policies;
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'policy_match_guard' and not tgisinternal) then
    raise exception '20261008170000: policy links are not append-only';
  end if;
  if has_table_privilege('service_role', 'public.policy_match', 'DELETE') or has_table_privilege('service_role', 'public.policy_match', 'INSERT') or has_table_privilege('service_role', 'public.policy_match', 'UPDATE') then
    raise exception '20261008170000: policy links must be written only by record_policy_match (service_role still has insert=%, update=%, delete=%)',
      has_table_privilege('service_role', 'public.policy_match', 'INSERT'), has_table_privilege('service_role', 'public.policy_match', 'UPDATE'), has_table_privilege('service_role', 'public.policy_match', 'DELETE');
  end if;
  if position('carrier_agent_map am' in (select prosrc from pg_proc where proname = 'refresh_policy_current' and pronamespace = 'public'::regnamespace)) = 0 then
    raise exception '20261008170000: refresh_policy_current does not read the agent map';
  end if;
end $$;
