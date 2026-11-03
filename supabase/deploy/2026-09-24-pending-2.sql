-- ============================================================================
-- Pending migrations — 3 files, each in its own transaction
-- Generated 2026-09-24 by scripts/build-pending-bundle.mjs. Do not hand-edit; regenerate.
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
--    1. 20260924340000_tenant_suppression_reads_any_phone_format.sql
--    2. 20260924342000_lead_list_bulk_assignment.sql
--    3. 20260924343000_import_mapping_date_order.sql
-- ============================================================================

-- ─── [1/3] 20260924340000_tenant_suppression_reads_any_phone_format.sql ──────────
begin;

-- ---------------------------------------------------------------------------
-- The agency's own do-not-call list answers for a number however it is written.
--
-- tenant_do_not_call stores ten digits (every row, measured 2026-09-24). is_tenant_phone_suppressed
-- compared its argument to that exactly, and three callers hand it whatever normalizeDialPhone
-- returns — `+15551234567` or `15551234567` when the lead's number was stored with its country code:
--
--   lib/dialerScripts/service.ts   the dial gate (getDialerEligibility, before markDialClicked)
--   lib/compliance/service.ts      performDncDialPreflight (Check a number)
--   lib/compliance/screening.ts    partner lead screening
--
-- so a number on the list was reported clear whenever it arrived with a leading 1. Serving was never
-- affected: serve_next_lead reads is_phone_suppressed, which already strips the prefix. This makes the
-- two agree, in the database, so every caller is covered at once and none can drift again.
--
-- Same signature and return type, so `create or replace` keeps every grant.
-- ---------------------------------------------------------------------------

create or replace function public.is_tenant_phone_suppressed(p_tenant_id uuid, p_phone_digits text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  with d as (
    select regexp_replace(coalesce(p_phone_digits, ''), '[^0-9]', '', 'g') as digits
  )
  select exists (
    select 1
      from public.tenant_do_not_call t, d
     where t.tenant_id = p_tenant_id
       and t.is_active
       and t.phone_digits = case when length(d.digits) = 11 and left(d.digits, 1) = '1'
                                 then right(d.digits, 10) else d.digits end
  );
$function$;

do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.is_tenant_phone_suppressed(uuid, text)'::regprocedure) into v_def;
  if v_def !~ 'right\(d\.digits, 10\)' then
    raise exception 'is_tenant_phone_suppressed does not strip the country code';
  end if;
  if not has_function_privilege('tenant_app', 'public.is_tenant_phone_suppressed(uuid, text)', 'execute')
     and not has_function_privilege('service_role', 'public.is_tenant_phone_suppressed(uuid, text)', 'execute') then
    raise exception 'is_tenant_phone_suppressed lost its grants';
  end if;
  raise notice 'the agency do-not-call list now matches +1 / 1-prefixed numbers';
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924340000', 'tenant_suppression_reads_any_phone_format') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [2/3] 20260924342000_lead_list_bulk_assignment.sql ──────────────────────────
begin;

-- /app/lead-lists/[campaignId] · "Assign N leads", the whole list in one transaction.
--
-- The list page's "Assign the N" used to open a per-lead picker that posted one assignment per lead:
-- a list half-assigned when the tab closed, with nothing to say which half. This file moves a list's
-- unowned pool rows (lead_queue.status = 'unclaimed', no owner, lead in the campaign) as ONE unit:
--
--   assign_lead_list_preview   the real router over every one of those rows, inside a block that
--                              always rolls back — who would get how many, who was skipped for
--                              capacity, and which leads would land on nobody and why.
--   assign_lead_list           the same routing for real, under a per-list advisory lock. If the
--                              number that would move differs from the number the manager saw
--                              (p_expected) it raises ASSIGNMENT_LIST_CHANGED and writes nothing.
--                              Otherwise every routable row moves, the events are stamped with one
--                              batch_id, and ONE audit_log row records the batch with the rule chain
--                              as published (id, priority, updated_at stand in for a version).
--
-- Three ways to assign ("Assign by"):
--   chain        assign_lead_core with the work item and no target — exactly what "Assign next"
--                does to one lead: every matching rule in order, licence gate, language, day off,
--                rest days, same household, capacity.
--   owner        one named member, the router's manual path (eligibility, household, capacity; a
--                manager's reason is the rest-day override, as on a single reassignment).
--   round_robin  the named members in turn, each lead offered to the next member first; a lead no
--                chosen member can take goes to nobody with the reason.
-- Capacity is respected in every mode (user decision): nobody is pushed past their ceiling.
--
-- assign_lead_core, assignment_candidate_is_eligible and assignment_ineligibility_reason are CALLED,
-- never redefined (20260924300000 owns the router, 20260924310000 the eligibility pair).
--
-- Requires 20260924300000_lead_assignment_board.sql.

-- ── dependency ────────────────────────────────────────────────────────────
-- A parse-check connection (tenant_app, no DDL rights) is let through with a notice so the rest of
-- the file is still checked; a real apply without the router stops here.
do $$
begin
  if to_regprocedure('public.assign_lead_core(uuid,uuid,uuid,uuid,text,uuid)') is null then
    if has_schema_privilege('public', 'CREATE') then
      raise exception 'Apply 20260924300000_lead_assignment_board.sql first: assign_lead_core is missing, and bulk list assignment routes every lead through it.';
    end if;
    raise notice 'lead list bulk assignment: assign_lead_core is missing (apply 20260924300000 first); continuing only because this connection cannot change the schema';
  end if;
end $$;

-- ── schema ────────────────────────────────────────────────────────────────
-- Which bulk assignment an event was part of. Null for every single assignment.
alter table public.lead_assignment_events add column if not exists batch_id uuid;
create index if not exists lead_assignment_events_batch_idx
  on public.lead_assignment_events (tenant_id, batch_id) where batch_id is not null;

-- ── the routing, shared by preview and commit ─────────────────────────────
--
-- Internal: writes for real, so only its owner (the two functions below) may run it. Returns
--   { total, routable, nobody_count, per_owner: [...], nobody: [...], work_item_ids: [...] }
-- work_item_ids is stripped by both callers.
create or replace function public.lead_list_assignment_run(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_campaign_id uuid,
  p_mode text,
  p_user_ids uuid[],
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_limit constant integer := 5000;
  v_mode text := lower(btrim(coalesce(p_mode, '')));
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
  v_actor_role text;
  v_users uuid[] := '{}'::uuid[];
  v_n integer;
  v_total integer;
  v_item record;
  v_result jsonb;
  v_error text;
  v_detail text;
  v_d jsonb;
  v_pointer integer := 0;
  v_index integer;
  v_candidate uuid;
  v_full uuid[] := '{}'::uuid[];
  v_fail_codes text[];
  v_routed uuid[] := '{}'::uuid[];
  v_owners uuid[] := '{}'::uuid[];
  v_owner_states text[] := '{}'::text[];
  v_rule_types text[] := '{}'::text[];
  v_cap_users uuid[] := '{}'::uuid[];
  v_cap_items uuid[] := '{}'::uuid[];
  v_nobody_states text[] := '{}'::text[];
  v_nobody_reasons text[] := '{}'::text[];
  v_nobody_details text[] := '{}'::text[];
  v_short text;
  v_long text;
  v_why text[];
  v_explainer record;
  v_cache jsonb := '{}'::jsonb;
  v_key text;
  v_candidates integer;
  v_licence integer;
  v_capacity integer;
  v_per_owner jsonb;
  v_nobody jsonb;
begin
  -- The same manager check assign_lead_core and assignment_preview make.
  select tu.role::text into v_actor_role
    from public.tenant_users tu join public.users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor_user_id
     and tu.accepted_at is not null and u.status::text = 'active'
   limit 1;
  if not found then raise exception 'ASSIGNMENT_ACTOR_INVALID'; end if;
  if v_actor_role not in ('owner', 'producer') then raise exception 'ASSIGNMENT_MANAGER_REQUIRED'; end if;

  if v_mode not in ('chain', 'owner', 'round_robin') then raise exception 'ASSIGNMENT_LIST_MODE_INVALID'; end if;
  if v_mode <> 'chain' then
    -- Order kept (it is the rotation order), duplicates dropped.
    select coalesce(array_agg(x.user_id order by x.ord), '{}'::uuid[]) into v_users
      from (select distinct on (u.user_id) u.user_id, u.ord
              from unnest(coalesce(p_user_ids, '{}'::uuid[])) with ordinality u(user_id, ord)
             where u.user_id is not null
             order by u.user_id, u.ord) x;
    v_n := coalesce(cardinality(v_users), 0);
    if v_n = 0 or (v_mode = 'owner' and v_n <> 1) or v_n > 50 then raise exception 'ASSIGNMENT_LIST_MEMBERS_REQUIRED'; end if;
    if exists (
      select 1 from unnest(v_users) c(user_id)
       where not exists (
         select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id and u.status::text = 'active'
          where tu.tenant_id = p_tenant_id and tu.user_id = c.user_id and tu.accepted_at is not null)
    ) then raise exception 'ASSIGNMENT_LIST_MEMBER_INVALID'; end if;
    -- Overriding the chain is a deliberate, recorded act: the reason is what the router reads as a
    -- manager's rest-day override.
    if v_reason is null then raise exception 'ASSIGNMENT_LIST_REASON_REQUIRED'; end if;
  end if;

  perform 1 from public.tenant_campaigns c where c.tenant_id = p_tenant_id and c.id = p_campaign_id;
  if not found then raise exception 'ASSIGNMENT_LIST_NOT_FOUND'; end if;

  select count(*)::integer into v_total
    from public.lead_queue q
    join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
   where q.tenant_id = p_tenant_id and l.campaign_id = p_campaign_id
     and q.status = 'unclaimed' and q.owner_user_id is null;
  if v_total > v_limit then
    raise exception 'ASSIGNMENT_LIST_TOO_LARGE' using detail = jsonb_build_object('total', v_total, 'limit', v_limit)::text;
  end if;

  for v_item in
    select q.id,
           upper(btrim(coalesce(l.values->>'state', l.values->>'state_code', ''))) as state,
           lower(btrim(coalesce(l.product_line, l.values->>'product_code', l.values->>'product', ''))) as product
      from public.lead_queue q
      join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
     where q.tenant_id = p_tenant_id and l.campaign_id = p_campaign_id
       and q.status = 'unclaimed' and q.owner_user_id is null
     order by q.tier nulls last, q.queued_at, q.id
  loop
    v_result := null; v_error := null; v_detail := null; v_d := null; v_short := null; v_long := null;

    if v_mode = 'chain' then
      begin
        v_result := public.assign_lead_core(p_tenant_id, p_actor_user_id, v_item.id, null, v_reason, null);
      exception when others then
        get stacked diagnostics v_error = message_text, v_detail = pg_exception_detail;
        v_result := null;
      end;
      if v_result is not null and coalesce((v_result->>'sticky')::boolean, false) then
        v_result := null;
        v_error := 'ASSIGNMENT_STICKY';
      end if;
      if v_result is not null then
        -- Who the router passed over for being full on the way to this lead's owner.
        select v_cap_users || coalesce(array_agg(distinct s.user_id), '{}'::uuid[]),
               v_cap_items || coalesce(array_fill(v_item.id, array[count(distinct s.user_id)::integer]), '{}'::uuid[])
          into v_cap_users, v_cap_items
          from public.assignment_skip_events s
         where s.tenant_id = p_tenant_id and s.work_item_id = v_item.id and s.reason = 'capacity' and s.created_at >= now();
      end if;
    else
      v_fail_codes := '{}'::text[];
      for v_index in 0 .. v_n - 1 loop
        v_candidate := v_users[((v_pointer + v_index) % v_n) + 1];
        -- Open work only rises inside this transaction, so a member found full stays full: skip the
        -- router call and count the skip.
        if v_candidate = any(v_full) then
          v_fail_codes := v_fail_codes || 'ASSIGNMENT_TARGET_AT_CAPACITY'::text;
          v_cap_users := v_cap_users || v_candidate;
          v_cap_items := v_cap_items || v_item.id;
          continue;
        end if;
        v_error := null;
        begin
          v_result := public.assign_lead_core(p_tenant_id, p_actor_user_id, v_item.id, v_candidate, v_reason, null);
        exception when others then
          get stacked diagnostics v_error = message_text;
          v_result := null;
        end;
        if v_result is not null then
          -- The next lead is offered first to the member after this one.
          v_pointer := ((v_pointer + v_index) % v_n) + 1;
          exit;
        end if;
        v_fail_codes := v_fail_codes || coalesce(v_error, 'ASSIGNMENT_FAILED');
        if v_error = 'ASSIGNMENT_TARGET_AT_CAPACITY' then
          v_full := v_full || v_candidate;
          v_cap_users := v_cap_users || v_candidate;
          v_cap_items := v_cap_items || v_item.id;
        end if;
      end loop;
      if v_pointer >= v_n then v_pointer := 0; end if;
    end if;

    if v_result is not null then
      v_routed := v_routed || v_item.id;
      v_owners := v_owners || (v_result->>'owner_user_id')::uuid;
      v_owner_states := v_owner_states || v_item.state;
      v_rule_types := v_rule_types || case
        when v_mode <> 'chain' then 'manual'
        when v_result->>'rule_id' is null then 'roster'
        else coalesce(v_result->>'rule_match_type', 'fallback') end;
      continue;
    end if;

    -- Nobody. A short reason for the table, grouped by state; a sentence for the callout.
    if v_mode = 'chain' then
      if v_error = 'NO_ELIGIBLE_ASSIGNEE' then
        begin v_d := v_detail::jsonb; exception when others then v_d := null; end;
        v_candidates := coalesce((v_d->>'candidates')::integer, 0);
        v_licence := coalesce((v_d->>'licence')::integer, 0);
        v_capacity := coalesce((v_d->>'capacity')::integer, 0);
        if v_item.state = '' then
          v_short := 'No state on the lead';
        elsif v_candidates = 0 then
          v_short := 'Nobody on the rules it matches';
        elsif v_licence >= v_candidates then
          v_short := format('No licensed agent in %s', v_item.state);
        elsif v_capacity > 0 and v_licence + v_capacity >= v_candidates then
          v_short := format('Everyone licensed in %s is at capacity', v_item.state);
        else
          v_why := '{}'::text[];
          if v_capacity > 0 then v_why := v_why || 'at capacity'::text; end if;
          if coalesce((v_d->>'day_off')::integer, 0) > 0 then v_why := v_why || 'off today'::text; end if;
          if coalesce((v_d->>'rest')::integer, 0) > 0 then v_why := v_why || 'resting from the household'::text; end if;
          if coalesce((v_d->>'household')::integer, 0) > 0 then v_why := v_why || 'blocked by a household another agent holds'::text; end if;
          if coalesce((v_d->>'language')::integer, 0) > 0 then v_why := v_why || 'without the lead''s language'::text; end if;
          v_short := case when cardinality(v_why) > 0
                          then format('Everyone licensed in %s is %s', v_item.state, array_to_string(v_why, ' or '))
                          else format('Nobody may take %s leads right now', v_item.state) end;
        end if;
        if v_item.state = '' or v_licence >= v_candidates then
          -- The gate's own sentence, asked of the first licensed-role member (the agency-level
          -- answer unless that agent's own states are recorded), once per state and product.
          v_key := v_item.state || '|' || v_item.product;
          if v_cache ? v_key then
            v_long := v_cache->>v_key;
          else
            select tu.user_id, tu.role::text as role into v_explainer
              from public.tenant_users tu join public.users u on u.id = tu.user_id and u.status::text = 'active'
             where tu.tenant_id = p_tenant_id and tu.accepted_at is not null and tu.role::text in ('owner', 'producer')
             order by tu.user_id
             limit 1;
            if found then
              v_long := public.assignment_ineligibility_reason(p_tenant_id, v_explainer.user_id, v_explainer.role, v_item.product, v_item.state,
                          coalesce((v_d->>'requires_licensed')::boolean, false));
            end if;
            v_cache := v_cache || jsonb_build_object(v_key, v_long);
          end if;
        end if;
      elsif v_error = 'ASSIGNMENT_STICKY' then
        v_short := 'Taken by an agent mid-call';
      elsif v_error = 'ASSIGNMENT_WORK_ITEM_CLOSED' or v_error = 'ASSIGNMENT_WORK_ITEM_NOT_FOUND' then
        v_short := 'Closed while this ran';
      else
        v_short := format('Refused (%s)', coalesce(v_error, 'unknown'));
      end if;
    else
      if v_item.state = '' and 'ASSIGNMENT_TARGET_NOT_ELIGIBLE' = all(v_fail_codes) then
        v_short := 'No state on the lead';
      elsif 'ASSIGNMENT_TARGET_NOT_ELIGIBLE' = all(v_fail_codes) then
        v_short := case when v_mode = 'owner' then format('Not licensed in %s', v_item.state)
                        else format('No chosen member is licensed in %s', v_item.state) end;
      elsif not exists (select 1 from unnest(v_fail_codes) c(code) where c.code not in ('ASSIGNMENT_TARGET_NOT_ELIGIBLE', 'ASSIGNMENT_TARGET_AT_CAPACITY')) then
        v_short := case when v_mode = 'owner' then 'At capacity'
                        when v_item.state = '' then 'Everyone chosen is at capacity'
                        else format('Everyone chosen and licensed in %s is at capacity', v_item.state) end;
      elsif 'ASSIGNMENT_HOUSEHOLD_OWNED' = any(v_fail_codes) then
        v_short := 'Another agent holds this household';
      elsif 'ASSIGNMENT_TARGET_RESTING' = any(v_fail_codes) then
        v_short := 'Household resting with another agent';
      elsif 'ASSIGNMENT_WORK_ITEM_CLOSED' = any(v_fail_codes) or 'ASSIGNMENT_WORK_ITEM_NOT_FOUND' = any(v_fail_codes) then
        v_short := 'Closed while this ran';
      else
        v_short := format('Refused (%s)', coalesce(v_fail_codes[1], 'unknown'));
      end if;
      if 'ASSIGNMENT_TARGET_NOT_ELIGIBLE' = all(v_fail_codes) then
        -- The sentence for the first chosen member: for one owner, exactly why they cannot.
        v_key := v_item.state || '|' || v_item.product;
        if v_cache ? v_key then
          v_long := v_cache->>v_key;
        else
          select tu.user_id, tu.role::text as role into v_explainer
            from public.tenant_users tu where tu.tenant_id = p_tenant_id and tu.user_id = v_users[1];
          if found then
            v_long := public.assignment_ineligibility_reason(p_tenant_id, v_explainer.user_id, v_explainer.role, v_item.product, v_item.state,
                        v_item.product in ('term_life', 'term-life', 'term life'));
          end if;
          v_cache := v_cache || jsonb_build_object(v_key, v_long);
        end if;
      end if;
    end if;
    v_nobody_states := v_nobody_states || v_item.state;
    v_nobody_reasons := v_nobody_reasons || v_short;
    v_nobody_details := v_nobody_details || v_long;
  end loop;

  -- Per owner: what they get, from which states, under which kind of rule, and how many leads
  -- passed them by for capacity. Chosen members appear even at zero.
  with got as (
    select o.user_id, count(*)::integer as n,
           array_agg(distinct nullif(o.state, '')) filter (where nullif(o.state, '') is not null) as states,
           array_agg(distinct o.rule_type) as rule_types
      from unnest(v_owners, v_owner_states, v_rule_types) as o(user_id, state, rule_type)
     group by o.user_id
  ), cap as (
    select c.user_id, count(distinct c.item)::integer as n
      from unnest(v_cap_users, v_cap_items) as c(user_id, item)
     group by c.user_id
  ), ids as (
    select user_id from got union select user_id from cap union select unnest(v_users)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', ids.user_id,
           'name', coalesce(nullif(btrim(u.name), ''), nullif(btrim(u.email), ''), 'Unknown user'),
           'gets', coalesce(got.n, 0),
           'states', to_jsonb(coalesce(got.states, '{}'::text[])),
           'rule_types', to_jsonb(coalesce(got.rule_types, '{}'::text[])),
           'capacity_skips', coalesce(cap.n, 0))
         order by coalesce(got.n, 0) desc, coalesce(cap.n, 0) desc, u.name), '[]'::jsonb)
    into v_per_owner
    from ids
    left join public.users u on u.id = ids.user_id
    left join got on got.user_id = ids.user_id
    left join cap on cap.user_id = ids.user_id;

  select coalesce(jsonb_agg(jsonb_build_object('state', nullif(x.state, ''), 'count', x.n, 'reason', x.reason, 'detail', x.detail)
                            order by x.n desc, x.state), '[]'::jsonb)
    into v_nobody
    from (select b.state, b.reason, min(b.detail) as detail, count(*)::integer as n
            from unnest(v_nobody_states, v_nobody_reasons, v_nobody_details) as b(state, reason, detail)
           group by b.state, b.reason) x;

  return jsonb_build_object(
    'total', v_total,
    'routable', coalesce(cardinality(v_routed), 0),
    'nobody_count', coalesce(cardinality(v_nobody_reasons), 0),
    'per_owner', v_per_owner,
    'nobody', v_nobody,
    'work_item_ids', to_jsonb(v_routed));
end;
$function$;

-- ── preview: the real routing, always rolled back ─────────────────────────
-- The pattern is assignment_preview's (20260924300000): the block ends by raising and catching its
-- own sentinel, so every row, event, skip and capacity count it touched is undone before it returns.
-- The reason is a stand-in so the manual modes are previewed with the override the commit will have.
create or replace function public.assign_lead_list_preview(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_campaign_id uuid,
  p_mode text,
  p_user_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_result jsonb;
begin
  begin
    v_result := public.lead_list_assignment_run(p_tenant_id, p_actor_user_id, p_campaign_id, p_mode, p_user_ids, 'Routing preview');
    raise exception using errcode = 'P0001', message = 'assign_lead_list_preview_rollback';
  exception when others then
    if sqlerrm <> 'assign_lead_list_preview_rollback' then raise; end if;
  end;
  return v_result - 'work_item_ids';
end;
$function$;

-- ── commit: all routable, or nothing ──────────────────────────────────────
create or replace function public.assign_lead_list(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_campaign_id uuid,
  p_mode text,
  p_user_ids uuid[],
  p_reason text,
  p_expected integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_result jsonb;
  v_batch uuid := gen_random_uuid();
  v_items uuid[];
  v_routable integer;
  v_rules jsonb;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
begin
  if p_expected is null or p_expected < 0 then raise exception 'ASSIGNMENT_LIST_EXPECTED_REQUIRED'; end if;
  -- Two managers assigning the same list: the second waits, then sees what the first left.
  perform pg_advisory_xact_lock(hashtextextended('assign_lead_list:' || p_tenant_id::text || ':' || coalesce(p_campaign_id::text, ''), 0));

  v_result := public.lead_list_assignment_run(p_tenant_id, p_actor_user_id, p_campaign_id, p_mode, p_user_ids, v_reason);
  v_routable := coalesce((v_result->>'routable')::integer, 0);
  -- Raising here undoes every assignment the run just made: the manager confirmed a number, and a
  -- different number is not what they confirmed.
  if v_routable <> p_expected then
    raise exception 'ASSIGNMENT_LIST_CHANGED' using detail = jsonb_build_object('expected', p_expected, 'routable', v_routable)::text;
  end if;
  if v_routable = 0 then raise exception 'ASSIGNMENT_LIST_NOTHING_ROUTABLE'; end if;

  select coalesce(array_agg(x.value::uuid), '{}'::uuid[]) into v_items
    from jsonb_array_elements_text(coalesce(v_result->'work_item_ids', '[]'::jsonb)) x(value);
  update public.lead_assignment_events e
     set batch_id = v_batch
   where e.tenant_id = p_tenant_id and e.work_item_id = any(v_items)
     and e.batch_id is null and e.created_at >= now()
     and e.assigned_by is not distinct from p_actor_user_id;

  -- The chain as published at this moment: a rule edited later has a later updated_at.
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'priority', r.priority, 'match_type', r.match_type, 'updated_at', r.updated_at)
                            order by r.priority, r.id), '[]'::jsonb)
    into v_rules
    from public.assignment_rules r
   where r.tenant_id = p_tenant_id and r.is_active;

  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, reason, metadata)
  values ('tenant', p_actor_user_id, 'tenant.lead_list_assigned', 'tenant_campaign', p_campaign_id::text, v_reason,
          jsonb_build_object(
            'tenantId', p_tenant_id,
            'campaign_id', p_campaign_id,
            'batch_id', v_batch,
            'mode', lower(btrim(coalesce(p_mode, ''))),
            'user_ids', to_jsonb(coalesce(p_user_ids, '{}'::uuid[])),
            'reason', v_reason,
            'routable', v_routable,
            'nobody', coalesce((v_result->>'nobody_count')::integer, 0),
            'per_owner', coalesce((select jsonb_agg(jsonb_build_object('user_id', o->'user_id', 'gets', o->'gets'))
                                     from jsonb_array_elements(v_result->'per_owner') o where (o->>'gets')::integer > 0), '[]'::jsonb),
            'rules', v_rules));

  return (v_result - 'work_item_ids') || jsonb_build_object('batch_id', v_batch);
end;
$function$;

-- ── grants ────────────────────────────────────────────────────────────────
-- The run writes for real and is internal to the two below, like assign_lead_core.
revoke all on function
  public.lead_list_assignment_run(uuid, uuid, uuid, text, uuid[], text),
  public.assign_lead_list_preview(uuid, uuid, uuid, text, uuid[]),
  public.assign_lead_list(uuid, uuid, uuid, text, uuid[], text, integer)
  from public, anon, authenticated, tenant_app;
revoke all on function public.lead_list_assignment_run(uuid, uuid, uuid, text, uuid[], text) from service_role;
grant execute on function
  public.assign_lead_list_preview(uuid, uuid, uuid, text, uuid[]),
  public.assign_lead_list(uuid, uuid, uuid, text, uuid[], text, integer)
  to service_role;

-- ── asserted against whatever this database holds ─────────────────────────
do $$
declare
  v_run text;
  v_commit text;
  v_tenant uuid;
  v_actor uuid;
  v_campaign uuid;
  v_before bigint;
  v_after bigint;
  v_audit_before bigint;
  v_audit_after bigint;
  v_owned_before bigint;
  v_owned_after bigint;
  v_preview jsonb;
begin
  -- A parse-check run (tenant_app) cannot add the column or create the functions.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'lead_assignment_events' and column_name = 'batch_id')
     or to_regprocedure('public.assign_lead_list(uuid,uuid,uuid,text,uuid[],text,integer)') is null
     or to_regprocedure('public.assign_lead_core(uuid,uuid,uuid,uuid,text,uuid)') is null then
    raise notice 'lead list bulk assignment: schema not present; skipping the behaviour checks';
    return;
  end if;

  select prosrc into v_run from pg_proc where oid = to_regprocedure('public.lead_list_assignment_run(uuid,uuid,uuid,text,uuid[],text)');
  select prosrc into v_commit from pg_proc where oid = to_regprocedure('public.assign_lead_list(uuid,uuid,uuid,text,uuid[],text,integer)');
  if v_run not like '%public.assign_lead_core(%' then raise exception 'bulk list assignment does not route through assign_lead_core'; end if;
  if v_run not like '%ASSIGNMENT_LIST_TOO_LARGE%' then raise exception 'bulk list assignment lost its size bound'; end if;
  if v_run not like '%ASSIGNMENT_MANAGER_REQUIRED%' then raise exception 'bulk list assignment lost its manager check'; end if;
  if v_commit not like '%pg_advisory_xact_lock%' or v_commit not like '%ASSIGNMENT_LIST_CHANGED%' then
    raise exception 'assign_lead_list lost its lock or its stale-preview refusal';
  end if;
  if v_commit not like '%insert into public.audit_log%' then raise exception 'assign_lead_list writes no audit row'; end if;
  if has_function_privilege('anon', 'public.assign_lead_list(uuid,uuid,uuid,text,uuid[],text,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.assign_lead_list_preview(uuid,uuid,uuid,text,uuid[])', 'execute')
     or has_function_privilege('service_role', 'public.lead_list_assignment_run(uuid,uuid,uuid,text,uuid[],text)', 'execute') then
    raise exception 'bulk list assignment is executable by a role that must not run it';
  end if;

  -- The preview leaves nothing behind: no events, no audit rows, no owners.
  select tu.tenant_id, tu.user_id, l.campaign_id into v_tenant, v_actor, v_campaign
    from public.tenant_users tu
    join public.users u on u.id = tu.user_id and u.status::text = 'active'
    join public.lead_queue q on q.tenant_id = tu.tenant_id and q.status = 'unclaimed' and q.owner_user_id is null
    join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id and l.campaign_id is not null
   where tu.accepted_at is not null and tu.role::text in ('owner', 'producer')
   order by tu.tenant_id
   limit 1;
  if v_tenant is null then
    raise notice 'lead list bulk assignment: no tenant with a manager and an unassigned list lead; preview probe skipped';
    return;
  end if;
  if (select count(*) from public.lead_queue q join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
       where q.tenant_id = v_tenant and l.campaign_id = v_campaign and q.status = 'unclaimed' and q.owner_user_id is null) > 200 then
    raise notice 'lead list bulk assignment: the first list found holds over 200 pool leads; preview probe skipped to keep the migration short';
    return;
  end if;
  select count(*) into v_before from public.lead_assignment_events where tenant_id = v_tenant;
  select count(*) into v_audit_before from public.audit_log where action = 'tenant.lead_list_assigned';
  select count(*) into v_owned_before from public.lead_queue where tenant_id = v_tenant and owner_user_id is not null;
  v_preview := public.assign_lead_list_preview(v_tenant, v_actor, v_campaign, 'chain', null);
  select count(*) into v_after from public.lead_assignment_events where tenant_id = v_tenant;
  select count(*) into v_audit_after from public.audit_log where action = 'tenant.lead_list_assigned';
  select count(*) into v_owned_after from public.lead_queue where tenant_id = v_tenant and owner_user_id is not null;
  if jsonb_typeof(v_preview) <> 'object' or v_preview ? 'work_item_ids' then raise exception 'assign_lead_list_preview returned the wrong shape'; end if;
  if (v_preview->>'routable')::integer + (v_preview->>'nobody_count')::integer <> (v_preview->>'total')::integer then
    raise exception 'assign_lead_list_preview: routable + nobody <> total';
  end if;
  if v_after <> v_before or v_audit_after <> v_audit_before or v_owned_after <> v_owned_before then
    raise exception 'assign_lead_list_preview left % event(s), % audit row(s) and % owner change(s) behind',
      v_after - v_before, v_audit_after - v_audit_before, v_owned_after - v_owned_before;
  end if;
  raise notice 'lead list bulk assignment: in place; a preview of % lead(s) (% routable) rolled back cleanly',
    v_preview->>'total', v_preview->>'routable';
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924342000', 'lead_list_bulk_assignment') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [3/3] 20260924343000_import_mapping_date_order.sql ──────────────────────────
begin;

-- Column mapping dialog: a vendor's saved map remembers how that vendor writes slash dates.
--
-- 05/06/1961 is 6 May in a US file and 5 June in most others, and a file can hold hundreds of
-- values where both readings are valid. The person importing picks the order once per file; a
-- vendor whose saved map carries one is not asked again.
--
-- Additive and idempotent. Null means "never chosen", which is every existing row. RLS and grants
-- on tenant_import_mappings are unchanged: a new column inherits them.

alter table public.tenant_import_mappings
  add column if not exists date_order text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tenant_import_mappings'::regclass
       and conname = 'tenant_import_mappings_date_order_check'
  ) then
    alter table public.tenant_import_mappings
      add constraint tenant_import_mappings_date_order_check
      check (date_order is null or date_order in ('mdy', 'dmy'));
  end if;
end $$;

comment on column public.tenant_import_mappings.date_order is
  'How this vendor writes slash dates: mdy (US, month first) or dmy (day first). Null when never chosen.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tenant_import_mappings' and column_name = 'date_order'
       and data_type = 'text' and is_nullable = 'YES'
  ) then
    raise exception 'tenant_import_mappings.date_order was not added as a nullable text column';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tenant_import_mappings'::regclass
       and conname = 'tenant_import_mappings_date_order_check'
       and contype = 'c'
  ) then
    raise exception 'tenant_import_mappings_date_order_check was not created';
  end if;

  if not has_table_privilege('tenant_app', 'public.tenant_import_mappings', 'update') then
    raise exception 'tenant_app lost update on tenant_import_mappings';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924343000', 'import_mapping_date_order') on conflict do nothing;
  end if;
end $bundle$;
commit;
