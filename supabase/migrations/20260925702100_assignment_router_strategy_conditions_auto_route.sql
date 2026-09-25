-- /app/assignments · the concept board's routing rules, made real (LA-2.24 concept audit).
--
-- One restatement of the router (assign_lead_core, latest definition 20260924300000), plus the
-- functions that read and write the chain around it. What changes:
--
--   Strategy     assignment_rules.strategy: 'round_robin' (the default, and every existing rule) or
--                'least_loaded' ("fewest open first"): candidates who hold the fewest open leads are
--                offered the lead first; the round-robin order breaks ties. Capacity is still the
--                ceiling in both.
--   Conditions   assignment_rules.conditions: up to two more conditions ANDed with the rule's own
--                match ("State is TX AND product is final_expense"). Each is { match_type,
--                match_values } with match_type campaign | state | language | product. A language
--                condition pairs the lead with a speaker exactly as a language rule does; a product
--                condition marked licensed_only keeps setters off it exactly as a product rule does.
--   Licence skip A rule the lead matched whose EVERY candidate was refused by the licence gate is
--                logged once, per rule, as an assignment_skip_events row with reason 'licence' and
--                no user: "the rule would have broken licensing, so the lead fell through". Written
--                on success only, as every skip is.
--   Auto-route   assignment_settings.auto_route_posted (off by default). When an owner turns it on,
--                a lead a vendor POSTS is routed the moment it lands (auto_route_posted_lead, called
--                by the lead-post ingest path), through the tenant's 'realtime' rules only — never
--                the rest of the chain, never the implicit roster fallback. The router runs with a
--                system actor (p_system_route); every gate applies: licence, language, day off, rest
--                days, same household, capacity. If nobody may take it, it stays in the pool. Each
--                attempt writes one audit_log row. The owner the router picked is re-checked against
--                assignment_candidate_is_eligible before the move stands.
--   Fallback     publish_assignment_rules keeps any fallback rule LAST, whatever order it was sent in.
--   Insights     assignment_insights gains where skipped leads landed ("→ rule 4"), the personal
--                licences lapsing within 30 days with the open leads they hold in that state, and
--                how many leads were routed on arrival.
--
-- assign_lead_core gains a seventh argument, p_system_route. The six-argument form keeps its exact
-- signature, return type and grants and passes false, so every existing caller — assign_lead, the
-- routing preview, bulk list assignment (20260924342000) and the rotation job — runs the router
-- below unchanged apart from the three new rule features. The seven-argument form is executable by
-- its owner only: nothing outside these security-definer functions can reach the system path.
--
-- assignment_candidate_is_eligible and assignment_ineligibility_reason are CALLED, never redefined
-- (20260925702000 owns them).
--
-- Additive. New columns are defaulted; the widened skip-reason check keeps every value it accepted.
-- Requires 20260924300000 and 20260925702000.

do $$
begin
  if to_regprocedure('public.assign_lead_core(uuid,uuid,uuid,uuid,text,uuid)') is null then
    if has_schema_privilege('public', 'CREATE') then
      raise exception 'Apply 20260924300000_lead_assignment_board.sql first: this file restates its router.';
    end if;
    raise notice 'assignment router: assign_lead_core is missing (apply 20260924300000 first); continuing only because this connection cannot change the schema';
  end if;
end $$;

-- ── schema ────────────────────────────────────────────────────────────────
alter table public.assignment_rules add column if not exists strategy text not null default 'round_robin';
alter table public.assignment_rules add column if not exists conditions jsonb not null default '[]'::jsonb;
alter table public.assignment_settings add column if not exists auto_route_posted boolean not null default false;

do $$
declare
  r record;
begin
  if not exists (select 1 from pg_constraint where conname = 'assignment_rules_strategy_valid') then
    alter table public.assignment_rules
      add constraint assignment_rules_strategy_valid check (strategy in ('round_robin', 'least_loaded'));
  end if;
  -- Shape only: a table CHECK cannot look inside the elements without a subquery.
  -- publish_assignment_rules validates each one.
  if not exists (select 1 from pg_constraint where conname = 'assignment_rules_conditions_shape') then
    alter table public.assignment_rules
      add constraint assignment_rules_conditions_shape
      check (jsonb_typeof(conditions) = 'array' and jsonb_array_length(conditions) <= 2);
  end if;

  -- 'licence' joins the skip reasons, and a licence skip names a rule rather than a person.
  for r in
    select c.conname from pg_constraint c
     where c.conrelid = 'public.assignment_skip_events'::regclass and c.contype = 'c'
       and c.conname <> 'assignment_skip_events_reason_valid'
       and pg_get_constraintdef(c.oid) ~ '\mreason\M'
  loop
    execute format('alter table public.assignment_skip_events drop constraint %I', r.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'assignment_skip_events_reason_valid') then
    alter table public.assignment_skip_events
      add constraint assignment_skip_events_reason_valid
      check (reason in ('capacity', 'rest', 'household', 'day_off', 'licence'));
  end if;
  alter table public.assignment_skip_events alter column user_id drop not null;
  if not exists (select 1 from pg_constraint where conname = 'assignment_skip_events_user_unless_licence') then
    alter table public.assignment_skip_events
      add constraint assignment_skip_events_user_unless_licence check (user_id is not null or reason = 'licence');
  end if;
end $$;

-- ── rule matching ─────────────────────────────────────────────────────────
--
-- One condition, as the rule's own match always was (20260924300000's branches, unchanged). Stable:
-- the 'realtime' branch reads now().
create or replace function public.assignment_condition_matches(p_type text, p_values jsonb, p_lead public.agent_leads)
returns boolean
language plpgsql
stable
as $function$
declare
  v_value text;
  v_values jsonb;
  v_seconds numeric;
  v_match jsonb := coalesce(p_values, '{}'::jsonb);
begin
  if p_type = 'fallback' then return true; end if;
  if p_type = 'campaign' then
    return p_lead.campaign_id is not null and (
      v_match->'campaign_ids' ? p_lead.campaign_id::text
      or v_match->'values' ? p_lead.campaign_id::text
    );
  end if;
  if p_type = 'state' then
    v_value := upper(trim(coalesce(p_lead.values->>'state', p_lead.values->>'state_code', '')));
    v_values := coalesce(v_match->'states', v_match->'values', '[]'::jsonb);
    if jsonb_typeof(v_values) <> 'array' then return false; end if;
    return v_value <> '' and exists (select 1 from jsonb_array_elements_text(v_values) x(value) where upper(trim(x.value)) = v_value);
  end if;
  if p_type = 'language' then
    v_value := lower(trim(coalesce(p_lead.values->>'language', p_lead.values->>'preferred_language', p_lead.values->>'language_code', '')));
    v_values := coalesce(v_match->'languages', v_match->'values', '[]'::jsonb);
    if jsonb_typeof(v_values) <> 'array' then return false; end if;
    return v_value <> '' and exists (select 1 from jsonb_array_elements_text(v_values) x(value) where lower(trim(x.value)) = v_value);
  end if;
  if p_type = 'product' then
    v_value := lower(trim(coalesce(p_lead.product_line, p_lead.values->>'product_code', p_lead.values->>'product', '')));
    v_values := coalesce(v_match->'products', v_match->'product_codes', v_match->'values', '[]'::jsonb);
    if jsonb_typeof(v_values) <> 'array' then return false; end if;
    return v_value <> '' and exists (select 1 from jsonb_array_elements_text(v_values) x(value) where lower(trim(x.value)) = v_value);
  end if;
  if p_type = 'realtime' then
    v_seconds := case when jsonb_typeof(v_match->'seconds') = 'number' then (v_match->>'seconds')::numeric end;
    return v_seconds is not null and v_seconds > 0
       and p_lead.posted_at is not null
       and p_lead.posted_at >= now() - make_interval(secs => v_seconds::double precision);
  end if;
  return false;
end;
$function$;

-- The rule's own match AND each extra condition. An extra condition may only be one of the four
-- list types; anything else stored there matches nothing rather than everything.
create or replace function public.assignment_rule_matches(p_rule public.assignment_rules, p_lead public.agent_leads)
returns boolean
language plpgsql
stable
as $function$
declare
  v_condition jsonb;
begin
  if not public.assignment_condition_matches(p_rule.match_type, p_rule.match_values, p_lead) then return false; end if;
  if p_rule.conditions is null or jsonb_typeof(p_rule.conditions) <> 'array' then return true; end if;
  for v_condition in select value from jsonb_array_elements(p_rule.conditions) loop
    if coalesce(v_condition->>'match_type', '') not in ('campaign', 'state', 'language', 'product') then return false; end if;
    if not public.assignment_condition_matches(v_condition->>'match_type', v_condition->'match_values', p_lead) then return false; end if;
  end loop;
  return true;
end;
$function$;

-- A language rule, or a rule with a language condition, pairs the lead with a speaker.
create or replace function public.assignment_rule_pairs_language(p_rule public.assignment_rules)
returns boolean
language sql
immutable
as $function$
  select coalesce((p_rule).match_type = 'language', false)
      or exists (select 1 from jsonb_array_elements(case when jsonb_typeof((p_rule).conditions) = 'array' then (p_rule).conditions else '[]'::jsonb end) c(value)
                  where c.value->>'match_type' = 'language');
$function$;

-- A product rule, or a rule with a product condition, marked licensed_only needs a licensed agent.
create or replace function public.assignment_rule_requires_licence(p_rule public.assignment_rules)
returns boolean
language sql
immutable
as $function$
  select (coalesce((p_rule).match_type = 'product', false)
          and jsonb_typeof((p_rule).match_values->'licensed_only') = 'boolean'
          and ((p_rule).match_values->>'licensed_only')::boolean)
      or exists (select 1 from jsonb_array_elements(case when jsonb_typeof((p_rule).conditions) = 'array' then (p_rule).conditions else '[]'::jsonb end) c(value)
                  where c.value->>'match_type' = 'product'
                    and jsonb_typeof(c.value->'match_values'->'licensed_only') = 'boolean'
                    and (c.value->'match_values'->>'licensed_only')::boolean);
$function$;

-- ── the router ────────────────────────────────────────────────────────────
--
-- Restated from 20260924300000. Every change is marked "CONCEPT n":
--
--   1  System route (auto-route on arrival). p_system_route = true: no actor, a named work item that
--      is still in the pool, no target, no rotation. Only 'realtime' rules are tried, and no implicit
--      fallback is appended. The event is 'assigned', assigned_by null.
--   2  Conditions: assignment_rule_matches ANDs them. Language pairing and licensed-only are read
--      through assignment_rule_pairs_language / assignment_rule_requires_licence, so a condition
--      has the same effect as the rule type it names.
--   3  Strategy: 'least_loaded' orders candidates by open leads (agent_capacity.current_open, which
--      the lead_queue trigger keeps current) before the round-robin order. The recount under the
--      row lock is unchanged, so the ceiling is exactly as strict as before.
--   4  Licence skip: a real rule whose every candidate the licence gate refused writes one 'licence'
--      skip for that rule (no user) when the lead falls through it.
create or replace function public.assign_lead_core(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_work_item_id uuid,
  p_target_user_id uuid,
  p_reason text,
  p_rotate_from_user_id uuid,
  p_system_route boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_item public.lead_queue%rowtype;
  v_lead public.agent_leads%rowtype;
  v_rule public.assignment_rules%rowtype;
  v_selected_rule public.assignment_rules%rowtype;
  v_capacity public.agent_capacity%rowtype;
  v_candidate record;
  v_state text;
  v_product text;
  v_language text;
  v_contact_key text;
  v_rest_days integer := 0;
  v_requires_licensed boolean := false;
  v_selected_user uuid;
  v_selected_role text;
  v_from_user uuid;
  v_event_type text;
  v_event_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
  v_open integer;
  v_rule_found boolean := false;
  v_round_robin_last uuid;
  v_actor_role text;
  v_settings_last uuid;
  v_max_items integer := 1;
  v_items_tried integer := 0;
  v_tried uuid[] := '{}'::uuid[];
  v_rules public.assignment_rules[];
  v_real_rules integer := 0;
  v_has_fallback boolean := false;
  v_household_owners uuid[] := '{}'::uuid[];
  v_zone text;
  v_dow integer;
  v_skip_items uuid[] := '{}'::uuid[];
  v_skip_rules uuid[] := '{}'::uuid[];
  v_skip_users uuid[] := '{}'::uuid[];
  v_skip_reasons text[] := '{}'::text[];
  v_n_candidates integer := 0;
  v_n_licence integer := 0;
  v_n_language integer := 0;
  v_n_day_off integer := 0;
  v_n_rest integer := 0;
  v_n_household integer := 0;
  v_n_capacity integer := 0;
  -- CONCEPT 2–4 state.
  v_system boolean := coalesce(p_system_route, false);
  v_pairs_language boolean;
  v_least_loaded boolean;
  v_rule_candidates integer;
  v_rule_licence integer;
begin
  -- CONCEPT 1: the system route names one pooled work item and nobody else.
  if v_system and (p_work_item_id is null or p_target_user_id is not null or p_rotate_from_user_id is not null or p_actor_user_id is not null) then
    raise exception 'ASSIGNMENT_AUTO_ROUTE_INVALID';
  end if;
  -- A rotation may run with no actor; so may the system route. Everything else must name an active member.
  if p_rotate_from_user_id is not null and (p_work_item_id is null or p_target_user_id is not null) then
    raise exception 'ASSIGNMENT_ROTATION_INVALID';
  end if;
  if (p_rotate_from_user_id is not null or v_system) and p_actor_user_id is null then
    v_actor_role := null;
  else
    select tu.role::text into v_actor_role
      from public.tenant_users tu join public.users u on u.id = tu.user_id
       where tu.tenant_id = p_tenant_id and tu.user_id = p_actor_user_id
         and tu.accepted_at is not null and u.status::text = 'active'
      limit 1;
    if not found then raise exception 'ASSIGNMENT_ACTOR_INVALID'; end if;
  end if;

  -- Reconcile stale rows even if an external user-status mutation did not fire the trigger.
  update public.lead_queue q
     set status = 'unclaimed', claimed_by = null, owner_user_id = null, owner_role = null,
         claimed_at = null, locked_until = null, updated_at = now()
    from public.users u
   where q.tenant_id = p_tenant_id and q.owner_user_id = u.id
     and u.status::text <> 'active'
     and q.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active')
     and q.disposition is null;

  select coalesce(s.rest_days, 0), s.last_assignee_id into v_rest_days, v_settings_last from public.assignment_settings s where s.tenant_id = p_tenant_id;
  v_rest_days := coalesce(v_rest_days, 0);

  begin
    select nullif(btrim(ap.timezone), '') into v_zone from public.agency_profiles ap where ap.tenant_id = p_tenant_id;
    v_dow := extract(dow from (now() at time zone coalesce(v_zone, 'UTC')))::integer;
  exception when others then
    v_dow := extract(dow from (now() at time zone 'UTC'))::integer;
  end;

  -- Skip-ahead only for "assign the next eligible lead" — no work item, no target.
  if p_work_item_id is null and p_target_user_id is null then v_max_items := 25; end if;

  <<items>>
  loop
    exit items when v_items_tried >= v_max_items;
    v_items_tried := v_items_tried + 1;

    if p_work_item_id is null then
      select q.* into v_item
        from public.lead_queue q
       where q.tenant_id = p_tenant_id and q.status = 'unclaimed'
         and q.id <> all(v_tried)
       order by q.tier nulls last, q.queued_at, q.id
       limit 1
       for update skip locked;
    else
      select q.* into v_item from public.lead_queue q
       where q.tenant_id = p_tenant_id and q.id = p_work_item_id for update;
    end if;
    if not found then
      if v_items_tried = 1 then raise exception 'ASSIGNMENT_WORK_ITEM_NOT_FOUND'; end if;
      exit items;
    end if;
    v_tried := array_append(v_tried, v_item.id);
    select l.* into v_lead from public.agent_leads l where l.id = v_item.lead_id and l.tenant_id = p_tenant_id for update;
    if not found then raise exception 'ASSIGNMENT_LEAD_NOT_FOUND'; end if;

    v_state := upper(trim(coalesce(v_lead.values->>'state', v_lead.values->>'state_code', '')));
    v_product := lower(trim(coalesce(v_lead.product_line, v_lead.values->>'product_code', v_lead.values->>'product', '')));
    v_language := lower(trim(coalesce(v_lead.values->>'language', v_lead.values->>'preferred_language', v_lead.values->>'language_code', '')));
    v_contact_key := public.assignment_contact_key(v_lead.values, v_lead.id);

    v_n_candidates := 0; v_n_licence := 0; v_n_language := 0; v_n_day_off := 0;
    v_n_rest := 0; v_n_household := 0; v_n_capacity := 0;
    v_selected_rule := null;
    v_rule_found := false;
    v_selected_user := null;
    v_selected_role := null;

    if p_rotate_from_user_id is not null
       and (v_item.owner_user_id is distinct from p_rotate_from_user_id or v_item.status <> 'claimed' or v_item.disposition is not null) then
      raise exception 'ASSIGNMENT_ROTATION_STALE';
    end if;
    -- CONCEPT 1: only a lead still waiting in the pool is routed on arrival.
    if v_system and (v_item.status <> 'unclaimed' or v_item.owner_user_id is not null) then
      raise exception 'ASSIGNMENT_AUTO_ROUTE_NOT_POOLED';
    end if;

    -- A claimed, undispositioned row is the live conversation. Automated assignment never takes it
    -- away from its current owner. An explicit target is the deliberate manual reassignment path and
    -- requires a reason below. (A rotation is the one automated caller let past, and only after
    -- rotate_unanswered_assignments has established there is no call, open attempt or promised
    -- callback on it.)
    if v_item.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active') and v_item.owner_user_id is not null and v_item.disposition is null and p_target_user_id is null and p_rotate_from_user_id is null then
      return jsonb_build_object('work_item_id', v_item.id, 'lead_id', v_item.lead_id, 'owner_user_id', v_item.owner_user_id, 'owner_role', v_item.owner_role, 'sticky', true, 'reason', 'Active ownership is sticky until disposition');
    end if;
    if v_item.status not in ('unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active') then raise exception 'ASSIGNMENT_WORK_ITEM_CLOSED'; end if;
    if p_target_user_id is not null and p_target_user_id <> coalesce(v_item.owner_user_id, p_actor_user_id)
       and v_actor_role not in ('owner', 'producer') then
      raise exception 'ASSIGNMENT_MANAGER_REQUIRED';
    end if;
    if p_target_user_id is not null and v_item.owner_user_id is not null and p_target_user_id <> v_item.owner_user_id and v_event_reason is null then raise exception 'REASSIGNMENT_REASON_REQUIRED'; end if;

    -- Everyone else holding this household right now.
    select coalesce(array_agg(distinct q2.owner_user_id), '{}'::uuid[]) into v_household_owners
      from public.lead_queue q2
      join public.agent_leads l2 on l2.id = q2.lead_id and l2.tenant_id = q2.tenant_id
     where q2.tenant_id = p_tenant_id
       and q2.id <> v_item.id
       and q2.owner_user_id is not null
       and q2.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active')
       and q2.disposition is null
       and public.assignment_contact_key(l2.values, l2.id) = v_contact_key;

    if p_target_user_id is not null then
      -- First match wins for the manual path: the first matching rule decides whether the lead needs
      -- a licensed agent, and has its round-robin pointer moved by the assignment, as before.
      for v_rule in
        select r.* from public.assignment_rules r
         where r.tenant_id = p_tenant_id and r.is_active
           and public.assignment_rule_matches(r, v_lead)
         order by r.priority, r.id
      loop
        v_selected_rule := v_rule;
        v_rule_found := true;
        exit;
      end loop;
      if v_selected_rule.id is null then
        v_selected_rule.id := gen_random_uuid();
        v_selected_rule.assignee_ids := '{}'::uuid[];
        v_selected_rule.match_type := 'fallback';
      end if;
      v_round_robin_last := coalesce(v_selected_rule.last_assignee_id, v_settings_last);
      -- CONCEPT 2: licensed-only read from the rule and its conditions.
      v_requires_licensed := v_product in ('term_life', 'term-life', 'term life')
        or public.assignment_rule_requires_licence(v_selected_rule);

      select tu.role::text into v_selected_role
        from public.tenant_users tu join public.users u on u.id = tu.user_id
       where tu.tenant_id = p_tenant_id and tu.user_id = p_target_user_id
         and tu.accepted_at is not null and u.status::text = 'active';
      if not found or not public.assignment_candidate_is_eligible(p_tenant_id, p_target_user_id, v_selected_role, v_product, v_state, v_requires_licensed) then raise exception 'ASSIGNMENT_TARGET_NOT_ELIGIBLE'; end if;
      if p_target_user_id <> coalesce(v_item.owner_user_id, '00000000-0000-0000-0000-000000000000')::uuid then
        if v_rest_days > 0
           and not (v_actor_role in ('owner', 'producer') and v_event_reason is not null)
           and exists (
          select 1 from public.lead_assignment_events e
           where e.tenant_id = p_tenant_id and e.contact_key = v_contact_key
             and e.to_user_id is not null and e.to_user_id <> p_target_user_id
             and e.created_at > now() - make_interval(days => v_rest_days)
        ) then raise exception 'ASSIGNMENT_TARGET_RESTING'; end if;
        if exists (select 1 from unnest(v_household_owners) o(user_id) where o.user_id <> p_target_user_id) then
          raise exception 'ASSIGNMENT_HOUSEHOLD_OWNED';
        end if;
      end if;
      insert into public.agent_capacity (tenant_id, user_id) values (p_tenant_id, p_target_user_id) on conflict do nothing;
      select c.* into v_capacity from public.agent_capacity c where c.tenant_id = p_tenant_id and c.user_id = p_target_user_id for update;
      select count(*)::integer into v_open from public.lead_queue q
       where q.tenant_id = p_tenant_id and q.owner_user_id = p_target_user_id
         and q.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active') and q.disposition is null
         and q.id <> v_item.id;
      update public.agent_capacity set current_open = v_open, updated_at = now() where tenant_id = p_tenant_id and user_id = p_target_user_id;
      if p_target_user_id <> coalesce(v_item.owner_user_id, '00000000-0000-0000-0000-000000000000')::uuid and v_open >= v_capacity.max_open_leads then raise exception 'ASSIGNMENT_TARGET_AT_CAPACITY'; end if;
      v_selected_user := p_target_user_id;
    else
      -- Every matching rule, in order, then the implicit fallback. CONCEPT 1: the system route tries
      -- the real-time rules only, with no implicit fallback behind them.
      select coalesce(array_agg(r order by r.priority, r.id), '{}'::public.assignment_rules[]),
             coalesce(bool_or(r.match_type = 'fallback'), false)
        into v_rules, v_has_fallback
        from public.assignment_rules r
       where r.tenant_id = p_tenant_id and r.is_active
         and (not v_system or r.match_type = 'realtime')
         and public.assignment_rule_matches(r, v_lead);
      v_real_rules := coalesce(cardinality(v_rules), 0);
      if not v_has_fallback and not v_system then
        v_rule := null;
        v_rule.id := gen_random_uuid();
        v_rule.assignee_ids := '{}'::uuid[];
        v_rule.match_type := 'fallback';
        v_rules := array_append(v_rules, v_rule);
      end if;

      v_requires_licensed := false;
      <<rules>>
      for v_rule_index in 1 .. cardinality(v_rules) loop
        v_rule := v_rules[v_rule_index];
        v_round_robin_last := coalesce(v_rule.last_assignee_id, v_settings_last);
        -- A licensed-only rule the lead matched is a fact about the lead: falling through it must not
        -- let a setter take what it said needs a licence. CONCEPT 2: conditions count too.
        v_requires_licensed := v_requires_licensed or v_product in ('term_life', 'term-life', 'term life')
          or public.assignment_rule_requires_licence(v_rule);
        v_pairs_language := public.assignment_rule_pairs_language(v_rule);
        v_least_loaded := coalesce(v_rule.strategy, 'round_robin') = 'least_loaded';
        v_rule_candidates := 0;
        v_rule_licence := 0;

        -- Lock each capacity row before recounting it. The row itself is never trusted as the source of
        -- truth, which keeps concurrent assignments from crossing the configured maximum.
        for v_candidate in
          select tu.user_id, tu.role::text as role, c.max_open_leads,
                 coalesce(c.languages, '{}'::text[]) as languages, c.weekday_off,
                 case when cardinality(v_rule.assignee_ids) > 0 then array_position(v_rule.assignee_ids, tu.user_id) else null end as configured_position
            from public.tenant_users tu
            join public.users u on u.id = tu.user_id and u.status::text = 'active'
            left join public.agent_capacity c on c.tenant_id = p_tenant_id and c.user_id = tu.user_id
           where tu.tenant_id = p_tenant_id and tu.accepted_at is not null
             and (cardinality(v_rule.assignee_ids) = 0 or tu.user_id = any(v_rule.assignee_ids))
             -- Never back to the owner it is being rotated away from.
             and (p_rotate_from_user_id is null or tu.user_id <> p_rotate_from_user_id)
           order by
                    -- CONCEPT 3: fewest open first, when the rule asks for it.
                    case when v_least_loaded then coalesce(c.current_open, 0) else 0 end,
                    case
                      when cardinality(v_rule.assignee_ids) > 0 and v_round_robin_last is not null
                        then case when array_position(v_rule.assignee_ids, tu.user_id) > coalesce(array_position(v_rule.assignee_ids, v_round_robin_last), 0) then 0 else 1 end
                      when cardinality(v_rule.assignee_ids) = 0 and v_round_robin_last is not null
                        then case when tu.user_id > v_round_robin_last then 0 else 1 end
                      else 0
                    end,
                    case when cardinality(v_rule.assignee_ids) > 0 then array_position(v_rule.assignee_ids, tu.user_id) end nulls last,
                    tu.user_id
        loop
          v_n_candidates := v_n_candidates + 1;
          v_rule_candidates := v_rule_candidates + 1;
          if not public.assignment_candidate_is_eligible(p_tenant_id, v_candidate.user_id, v_candidate.role, v_product, v_state, v_requires_licensed) then
            v_n_licence := v_n_licence + 1;
            v_rule_licence := v_rule_licence + 1;
            continue;
          end if;
          -- Language pairing: a language rule, or a rule with a language condition (CONCEPT 2).
          if v_pairs_language and not exists (
            select 1 from unnest(v_candidate.languages) x(value) where lower(btrim(x.value)) = v_language
          ) then
            v_n_language := v_n_language + 1;
            continue;
          end if;
          if v_candidate.weekday_off is not null and v_candidate.weekday_off = v_dow then
            v_n_day_off := v_n_day_off + 1;
            v_skip_items := array_append(v_skip_items, v_item.id);
            v_skip_rules := array_append(v_skip_rules, case when v_rule_index <= v_real_rules then v_rule.id end);
            v_skip_users := array_append(v_skip_users, v_candidate.user_id);
            v_skip_reasons := array_append(v_skip_reasons, 'day_off'::text);
            continue;
          end if;
          if v_rest_days > 0 and exists (
            select 1 from public.lead_assignment_events e
             where e.tenant_id = p_tenant_id and e.contact_key = v_contact_key
               and e.to_user_id is not null and e.to_user_id <> v_candidate.user_id
               and e.created_at > now() - make_interval(days => v_rest_days)
          ) then
            v_n_rest := v_n_rest + 1;
            v_skip_items := array_append(v_skip_items, v_item.id);
            v_skip_rules := array_append(v_skip_rules, case when v_rule_index <= v_real_rules then v_rule.id end);
            v_skip_users := array_append(v_skip_users, v_candidate.user_id);
            v_skip_reasons := array_append(v_skip_reasons, 'rest'::text);
            continue;
          end if;
          if exists (select 1 from unnest(v_household_owners) o(user_id) where o.user_id <> v_candidate.user_id) then
            v_n_household := v_n_household + 1;
            v_skip_items := array_append(v_skip_items, v_item.id);
            v_skip_rules := array_append(v_skip_rules, case when v_rule_index <= v_real_rules then v_rule.id end);
            v_skip_users := array_append(v_skip_users, v_candidate.user_id);
            v_skip_reasons := array_append(v_skip_reasons, 'household'::text);
            continue;
          end if;
          insert into public.agent_capacity (tenant_id, user_id) values (p_tenant_id, v_candidate.user_id) on conflict do nothing;
          select c.* into v_capacity from public.agent_capacity c where c.tenant_id = p_tenant_id and c.user_id = v_candidate.user_id for update;
          select count(*)::integer into v_open from public.lead_queue q
           where q.tenant_id = p_tenant_id and q.owner_user_id = v_candidate.user_id
             and q.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active') and q.disposition is null;
          update public.agent_capacity set current_open = v_open, updated_at = now() where tenant_id = p_tenant_id and user_id = v_candidate.user_id;
          if v_open >= v_capacity.max_open_leads then
            v_n_capacity := v_n_capacity + 1;
            v_skip_items := array_append(v_skip_items, v_item.id);
            v_skip_rules := array_append(v_skip_rules, case when v_rule_index <= v_real_rules then v_rule.id end);
            v_skip_users := array_append(v_skip_users, v_candidate.user_id);
            v_skip_reasons := array_append(v_skip_reasons, 'capacity'::text);
          end if;
          if v_open >= v_capacity.max_open_leads then continue; end if;
          v_selected_user := v_candidate.user_id;
          v_selected_role := v_candidate.role;
          exit;
        end loop;

        if v_selected_user is not null then
          v_selected_rule := v_rule;
          v_rule_found := v_rule_index <= v_real_rules;
          exit;
        end if;
        -- CONCEPT 4: the rule would have broken licensing for every one of its candidates, so the
        -- lead falls through it. One row for the rule, no person.
        if v_rule_index <= v_real_rules and v_rule_candidates > 0 and v_rule_licence = v_rule_candidates then
          v_skip_items := array_append(v_skip_items, v_item.id);
          v_skip_rules := array_append(v_skip_rules, v_rule.id);
          v_skip_users := array_append(v_skip_users, null::uuid);
          v_skip_reasons := array_append(v_skip_reasons, 'licence'::text);
        end if;
      end loop;
    end if;

    exit items when v_selected_user is not null;
  end loop;

  if v_selected_user is null then
    raise exception 'NO_ELIGIBLE_ASSIGNEE' using detail = jsonb_build_object(
      'leads_tried', v_items_tried, 'work_item_id', v_item.id, 'state', v_state, 'product', v_product,
      'requires_licensed', v_requires_licensed, 'candidates', v_n_candidates, 'licence', v_n_licence,
      'language', v_n_language, 'day_off', v_n_day_off, 'rest', v_n_rest, 'household', v_n_household,
      'capacity', v_n_capacity, 'system_route', v_system)::text;
  end if;

  v_from_user := v_item.owner_user_id;
  v_event_type := case when v_from_user is null then case when p_work_item_id is null or v_system then 'assigned' else 'pulled' end else 'reassigned' end;
  if v_from_user is not null and v_event_reason is null then v_event_reason := 'Manual reassignment'; end if;
  v_event_reason := coalesce(v_event_reason, 'Rule-based assignment');
  update public.lead_queue
     set status = 'claimed', claimed_by = v_selected_user, owner_user_id = v_selected_user,
         owner_role = v_selected_role, claimed_at = coalesce(claimed_at, now()), locked_until = null, updated_at = now()
   where id = v_item.id and tenant_id = p_tenant_id;
  insert into public.lead_assignment_events (tenant_id, work_item_id, lead_id, contact_key, from_user_id, to_user_id, event_type, reason, assigned_by, rule_id)
  values (p_tenant_id, v_item.id, v_item.lead_id, v_contact_key, v_from_user, v_selected_user, v_event_type, v_event_reason, p_actor_user_id,
          case when p_target_user_id is null and v_rule_found then v_selected_rule.id end);
  if cardinality(v_skip_reasons) > 0 then
    insert into public.assignment_skip_events (tenant_id, work_item_id, rule_id, user_id, reason)
    select p_tenant_id, s.work_item_id, s.rule_id, s.user_id, s.reason
      from unnest(v_skip_items, v_skip_rules, v_skip_users, v_skip_reasons) as s(work_item_id, rule_id, user_id, reason);
  end if;
  if v_selected_rule.id is not null and v_selected_rule.match_type <> 'fallback' then
    update public.assignment_rules set last_assignee_id = v_selected_user where id = v_selected_rule.id and tenant_id = p_tenant_id;
  end if;
  if v_selected_rule.match_type = 'fallback' then
    if v_rule_found then
      update public.assignment_rules set last_assignee_id = v_selected_user where id = v_selected_rule.id and tenant_id = p_tenant_id;
    else
      insert into public.assignment_settings (tenant_id, last_assignee_id) values (p_tenant_id, v_selected_user)
      on conflict (tenant_id) do update set last_assignee_id = excluded.last_assignee_id, updated_at = now();
    end if;
  end if;
  perform public.refresh_agent_capacity_for_user(p_tenant_id, v_selected_user);
  if v_from_user is not null and v_from_user <> v_selected_user then perform public.refresh_agent_capacity_for_user(p_tenant_id, v_from_user); end if;
  return jsonb_build_object('work_item_id', v_item.id, 'lead_id', v_item.lead_id, 'owner_user_id', v_selected_user, 'owner_role', v_selected_role, 'rule_id', case when v_rule_found then v_selected_rule.id else null end, 'rule_match_type', v_selected_rule.match_type, 'sticky', false, 'reason', v_event_reason, 'leads_skipped', greatest(v_items_tried - 1, 0));
end;
$function$;

-- The six-argument router every existing caller uses: same signature, return type and grants as
-- 20260924300000; the system route is off.
create or replace function public.assign_lead_core(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_work_item_id uuid,
  p_target_user_id uuid,
  p_reason text,
  p_rotate_from_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
begin
  return public.assign_lead_core(p_tenant_id, p_actor_user_id, p_work_item_id, p_target_user_id, p_reason, p_rotate_from_user_id, false);
end;
$function$;

-- ── auto-route on arrival ─────────────────────────────────────────────────
--
-- Called by the lead-post ingest path (lib/leadPost/service.ts) once a posted lead is queued. Does
-- nothing unless the tenant switched it on. Never raises for an ordinary refusal: the lead simply
-- stays in the pool, and the vendor's post has already been accepted.
create or replace function public.auto_route_posted_lead(p_tenant_id uuid, p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_on boolean;
  v_posted timestamptz;
  v_state text;
  v_product text;
  v_item uuid;
  v_result jsonb;
  v_error text;
  v_detail text;
  v_owner uuid;
  v_role text;
  v_out jsonb;
begin
  select s.auto_route_posted into v_on from public.assignment_settings s where s.tenant_id = p_tenant_id;
  if not coalesce(v_on, false) then return jsonb_build_object('routed', false, 'reason', 'off'); end if;

  select l.posted_at,
         upper(btrim(coalesce(l.values->>'state', l.values->>'state_code', ''))),
         lower(btrim(coalesce(l.product_line, l.values->>'product_code', l.values->>'product', '')))
    into v_posted, v_state, v_product
    from public.agent_leads l where l.id = p_lead_id and l.tenant_id = p_tenant_id;
  if not found or v_posted is null then return jsonb_build_object('routed', false, 'reason', 'not_posted'); end if;

  select q.id into v_item from public.lead_queue q
   where q.tenant_id = p_tenant_id and q.lead_id = p_lead_id and q.status = 'unclaimed' and q.owner_user_id is null
   order by q.queued_at desc, q.id
   limit 1;
  if v_item is null then return jsonb_build_object('routed', false, 'reason', 'not_in_pool'); end if;

  begin
    v_result := public.assign_lead_core(p_tenant_id, null, v_item, null, 'Routed on arrival by a real-time rule', null, true);
    -- The router already asked the gate. Asked again here, of the owner it chose, so that no future
    -- change to the router can route a posted lead to someone the gate refuses: the refusal undoes
    -- the move with everything else in this block.
    v_owner := (v_result->>'owner_user_id')::uuid;
    select tu.role::text into v_role from public.tenant_users tu where tu.tenant_id = p_tenant_id and tu.user_id = v_owner;
    if v_owner is null or not public.assignment_candidate_is_eligible(p_tenant_id, v_owner, v_role, v_product, v_state, v_product in ('term_life', 'term-life', 'term life')) then
      raise exception 'ASSIGNMENT_AUTO_ROUTE_GATE_REFUSED';
    end if;
  exception when others then
    get stacked diagnostics v_error = message_text, v_detail = pg_exception_detail;
    v_result := null;
  end;

  if v_result is not null then
    v_out := jsonb_build_object('routed', true, 'work_item_id', v_item, 'owner_user_id', v_result->'owner_user_id', 'rule_id', v_result->'rule_id');
    insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
    values ('system', 'tenant.lead_auto_routed', 'lead_queue', v_item::text,
            jsonb_build_object('tenantId', p_tenant_id, 'leadId', p_lead_id, 'toUserId', v_result->'owner_user_id', 'ruleId', v_result->'rule_id'));
  else
    v_out := jsonb_build_object('routed', false, 'reason', coalesce(v_error, 'unknown'), 'work_item_id', v_item);
    insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
    values ('system', 'tenant.lead_auto_route_skipped', 'lead_queue', v_item::text,
            jsonb_build_object('tenantId', p_tenant_id, 'leadId', p_lead_id, 'reason', coalesce(v_error, 'unknown'),
                               'detail', case when v_detail is not null and v_detail ~ '^\{' then v_detail::jsonb end));
  end if;
  return v_out;
end;
$function$;

-- ── board figures ─────────────────────────────────────────────────────────
--
-- Restated from 20260924300000. Every key it returned keeps its meaning. New:
--   landed             per rule: where the leads it skipped someone on were finally routed
--                      [{ rule_id, landed_rule_id (null = whole roster), leads }]. A skip and the
--                      assignment it was part of are written in one transaction, so they share
--                      created_at (now()) and work item.
--   licence_expiring   personal licences lapsing within 30 days, or lapsed and still holding open
--                      leads in that state: [{ user_id, state, expires_on, open_leads }]
--   auto_routed        leads routed on arrival since p_since
create or replace function public.assignment_insights(p_tenant_id uuid, p_since timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_routed jsonb;
  v_skips jsonb;
  v_skipped_leads jsonb;
  v_landed jsonb;
  v_expiring jsonb := '[]'::jsonb;
  v_auto integer := 0;
  v_states jsonb := '{}'::jsonb;
  v_union text[] := '{}'::text[];
  v_member record;
  v_member_states text[];
  v_unlicensed integer;
begin
  select coalesce(jsonb_object_agg(x.rule_id::text, x.n), '{}'::jsonb) into v_routed
    from (select e.rule_id, count(*)::integer as n
            from public.lead_assignment_events e
           where e.tenant_id = p_tenant_id and e.rule_id is not null and e.created_at >= p_since
           group by e.rule_id) x;

  select coalesce(jsonb_agg(jsonb_build_object('rule_id', y.rule_id, 'user_id', y.user_id, 'reason', y.reason, 'count', y.n)), '[]'::jsonb) into v_skips
    from (select s.rule_id, s.user_id, s.reason, count(*)::integer as n
            from public.assignment_skip_events s
           where s.tenant_id = p_tenant_id and s.created_at >= p_since
           group by s.rule_id, s.user_id, s.reason) y;

  select coalesce(jsonb_agg(jsonb_build_object('user_id', z.user_id, 'reason', z.reason, 'leads', z.n)), '[]'::jsonb) into v_skipped_leads
    from (select s.user_id, s.reason, count(distinct s.work_item_id)::integer as n
            from public.assignment_skip_events s
           where s.tenant_id = p_tenant_id and s.created_at >= p_since and s.user_id is not null
           group by s.user_id, s.reason) z;

  select coalesce(jsonb_agg(jsonb_build_object('rule_id', w.rule_id, 'landed_rule_id', w.landed_rule_id, 'leads', w.n)), '[]'::jsonb) into v_landed
    from (select s.rule_id, e.rule_id as landed_rule_id, count(distinct s.work_item_id)::integer as n
            from public.assignment_skip_events s
            join public.lead_assignment_events e
              on e.tenant_id = s.tenant_id and e.work_item_id = s.work_item_id and e.created_at = s.created_at
             and e.to_user_id is not null
           where s.tenant_id = p_tenant_id and s.created_at >= p_since and s.rule_id is not null
           group by s.rule_id, e.rule_id) w;

  -- Personal licence expiry arrives with 20260925702000; before it there is nothing to warn about.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'tenant_user_licensed_states' and column_name = 'expires_on') then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'state', x.state, 'expires_on', x.expires_on, 'open_leads', x.open_leads)
                                order by x.expires_on, x.state), '[]'::jsonb)
        from (select s.user_id, s.state, s.expires_on,
                     (select count(*)::integer from public.lead_queue q
                        join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
                       where q.tenant_id = s.tenant_id and q.owner_user_id = s.user_id
                         and q.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active') and q.disposition is null
                         and upper(btrim(coalesce(l.values->>'state', l.values->>'state_code', ''))) = s.state) as open_leads
                from public.tenant_user_licensed_states s
                join public.tenant_users tu on tu.tenant_id = s.tenant_id and tu.user_id = s.user_id and tu.role::text in ('owner', 'producer')
               where s.tenant_id = $1 and s.expires_on is not null and s.expires_on <= current_date + 30) x
       where x.expires_on >= current_date or x.open_leads > 0
    $q$ into v_expiring using p_tenant_id;
  end if;

  select count(*)::integer into v_auto
    from public.lead_assignment_events e
   where e.tenant_id = p_tenant_id and e.created_at >= p_since and e.assigned_by is null
     and e.reason = 'Routed on arrival by a real-time rule';

  for v_member in
    select tu.user_id, tu.role::text as role
      from public.tenant_users tu join public.users u on u.id = tu.user_id and u.status::text = 'active'
     where tu.tenant_id = p_tenant_id and tu.accepted_at is not null and tu.role::text in ('owner', 'producer')
  loop
    select coalesce(array_agg(st.state order by st.state), '{}'::text[]) into v_member_states
      from (select distinct upper(btrim(l.state)) as state from public.licenses l where l.tenant_id = p_tenant_id and btrim(coalesce(l.state, '')) <> '') st
     where public.assignment_candidate_is_eligible(p_tenant_id, v_member.user_id, v_member.role, null, st.state, false);
    v_states := v_states || jsonb_build_object(v_member.user_id::text, to_jsonb(v_member_states));
    v_union := v_union || v_member_states;
  end loop;

  select count(*)::integer into v_unlicensed
    from public.lead_queue q
    join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
   where q.tenant_id = p_tenant_id and q.status = 'unclaimed'
     and not (upper(btrim(coalesce(l.values->>'state', l.values->>'state_code', ''))) = any(v_union));

  return jsonb_build_object('since', p_since, 'routed', v_routed, 'skips', v_skips, 'skipped_leads', v_skipped_leads,
                            'landed', v_landed, 'licence_expiring', v_expiring, 'auto_routed', v_auto,
                            'eligible_states', v_states, 'unlicensed_leads', v_unlicensed);
end;
$function$;

-- ── publishing a draft of the rules ───────────────────────────────────────
--
-- Restated from 20260924300000. p_rules is the chain in order:
--   [{ "id"?: uuid, "match_type": text, "match_values": object, "assignee_ids": [uuid], "is_active"?: bool,
--      "strategy"?: 'round_robin' | 'least_loaded', "conditions"?: [{ "match_type", "match_values" }] }]
-- New: strategy and conditions are validated and stored, and every fallback rule is placed after
-- every other rule (in the order sent), because a fallback matches everything and anything after it
-- would only ever be reached by the leads it could not place.
create or replace function public.publish_assignment_rules(p_tenant_id uuid, p_actor_user_id uuid, p_rules jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_actor_role text;
  v_rule jsonb;
  v_index integer := 0;
  v_id uuid;
  v_kept uuid[] := '{}'::uuid[];
  v_assignees uuid[];
  v_strategy text;
  v_conditions jsonb;
  v_condition jsonb;
  v_clean jsonb;
begin
  select tu.role::text into v_actor_role
    from public.tenant_users tu join public.users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor_user_id
     and tu.accepted_at is not null and u.status::text = 'active'
   limit 1;
  if not found then raise exception 'ASSIGNMENT_ACTOR_INVALID'; end if;
  if v_actor_role not in ('owner', 'producer') then raise exception 'ASSIGNMENT_MANAGER_REQUIRED'; end if;
  if jsonb_typeof(p_rules) <> 'array' then raise exception 'ASSIGNMENT_RULES_INVALID'; end if;

  perform 1 from public.assignment_rules r where r.tenant_id = p_tenant_id for update;

  for v_rule in
    select x.value from jsonb_array_elements(p_rules) with ordinality x(value, ord)
     order by (x.value->>'match_type' = 'fallback'), x.ord
  loop
    v_index := v_index + 1;
    v_strategy := coalesce(nullif(v_rule->>'strategy', ''), 'round_robin');
    if v_strategy not in ('round_robin', 'least_loaded') then raise exception 'ASSIGNMENT_RULES_INVALID'; end if;
    v_conditions := coalesce(v_rule->'conditions', '[]'::jsonb);
    if jsonb_typeof(v_conditions) <> 'array' or jsonb_array_length(v_conditions) > 2
       or (v_rule->>'match_type' = 'fallback' and jsonb_array_length(v_conditions) > 0) then
      raise exception 'ASSIGNMENT_RULES_INVALID';
    end if;
    v_clean := '[]'::jsonb;
    for v_condition in select value from jsonb_array_elements(v_conditions) loop
      if coalesce(v_condition->>'match_type', '') not in ('campaign', 'state', 'language', 'product')
         or jsonb_typeof(v_condition->'match_values') <> 'object'
         or v_condition->'match_values' = '{}'::jsonb then
        raise exception 'ASSIGNMENT_RULES_INVALID';
      end if;
      v_clean := v_clean || jsonb_build_array(jsonb_build_object('match_type', v_condition->>'match_type', 'match_values', v_condition->'match_values'));
    end loop;

    select coalesce(array_agg(d.user_id order by d.ord), '{}'::uuid[]) into v_assignees
      from (
        select distinct on (tu.user_id) tu.user_id, x.ord
          from jsonb_array_elements_text(coalesce(v_rule->'assignee_ids', '[]'::jsonb)) with ordinality x(value, ord)
          join public.tenant_users tu on tu.tenant_id = p_tenant_id and tu.user_id::text = lower(btrim(x.value))
         order by tu.user_id, x.ord
      ) d;
    v_id := nullif(v_rule->>'id', '')::uuid;
    if v_id is not null then
      update public.assignment_rules
         set priority = v_index * 10,
             match_type = v_rule->>'match_type',
             match_values = coalesce(v_rule->'match_values', '{}'::jsonb),
             assignee_ids = v_assignees,
             is_active = coalesce((v_rule->>'is_active')::boolean, true),
             strategy = v_strategy,
             conditions = v_clean
       where id = v_id and tenant_id = p_tenant_id;
      if not found then raise exception 'ASSIGNMENT_RULE_NOT_FOUND'; end if;
    else
      insert into public.assignment_rules (tenant_id, priority, match_type, match_values, assignee_ids, is_active, created_by, strategy, conditions)
      values (p_tenant_id, v_index * 10, v_rule->>'match_type', coalesce(v_rule->'match_values', '{}'::jsonb), v_assignees,
              coalesce((v_rule->>'is_active')::boolean, true), p_actor_user_id, v_strategy, v_clean)
      returning id into v_id;
    end if;
    v_kept := v_kept || v_id;
  end loop;

  update public.assignment_rules set is_active = false
   where tenant_id = p_tenant_id and is_active and not (id = any(v_kept));

  return coalesce((
    select jsonb_agg(to_jsonb(r) order by r.priority, r.id)
      from public.assignment_rules r where r.tenant_id = p_tenant_id
  ), '[]'::jsonb);
end;
$function$;

-- ── grants ────────────────────────────────────────────────────────────────
-- The seven-argument router and the auto-route are internal to this plane: the owner runs them
-- through the security-definer functions above. The helpers are called by the router only.
revoke all on function public.assign_lead_core(uuid, uuid, uuid, uuid, text, uuid, boolean)
  from public, anon, authenticated, tenant_app, service_role;
revoke all on function
  public.assign_lead_core(uuid, uuid, uuid, uuid, text, uuid),
  public.assignment_condition_matches(text, jsonb, public.agent_leads),
  public.assignment_rule_pairs_language(public.assignment_rules),
  public.assignment_rule_requires_licence(public.assignment_rules),
  public.assignment_insights(uuid, timestamptz),
  public.publish_assignment_rules(uuid, uuid, jsonb),
  public.auto_route_posted_lead(uuid, uuid)
  from public, anon, authenticated, tenant_app;
grant execute on function
  public.assignment_insights(uuid, timestamptz),
  public.publish_assignment_rules(uuid, uuid, jsonb),
  public.auto_route_posted_lead(uuid, uuid)
  to service_role;

-- ── asserted against whatever this database holds ─────────────────────────
do $$
declare
  v_core text;
  v_six text;
  v_rule public.assignment_rules;
  v_lead public.agent_leads;
  v_tenant uuid;
  v_actor uuid;
  v_before bigint;
  v_after bigint;
  v_skips_before bigint;
  v_skips_after bigint;
  v_preview jsonb;
  v_off jsonb;
  v_lead_id uuid;
begin
  if not has_schema_privilege('public', 'CREATE')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'assignment_rules' and column_name = 'conditions')
     or to_regprocedure('public.assign_lead_core(uuid,uuid,uuid,uuid,text,uuid,boolean)') is null then
    raise notice 'assignment router: schema not present; skipping the behaviour checks';
    return;
  end if;
  select prosrc into v_core from pg_proc where oid = to_regprocedure('public.assign_lead_core(uuid,uuid,uuid,uuid,text,uuid,boolean)');
  select prosrc into v_six from pg_proc where oid = to_regprocedure('public.assign_lead_core(uuid,uuid,uuid,uuid,text,uuid)');
  if v_six not like '%p_rotate_from_user_id, false)%' then raise exception 'the six-argument router does not turn the system route off'; end if;

  -- Everything 20260924300000 asserted of the router, asserted of its restatement.
  if v_core not like '%v_max_items := 25%' then raise exception 'assign_lead: skip-ahead is missing'; end if;
  if v_core not like '%for v_rule_index in 1 .. cardinality(v_rules)%' then raise exception 'assign_lead: rule fall-through is missing'; end if;
  if v_core not like '%assignment_skip_events%' then raise exception 'assign_lead: the skip log is not written'; end if;
  if v_core not like '%rule_id)%' then raise exception 'assign_lead: rule_id is not recorded on the event'; end if;
  if v_core not like '%ASSIGNMENT_TARGET_RESTING%' or v_core not like '%ASSIGNMENT_HOUSEHOLD_OWNED%' then raise exception 'assign_lead: manual reassignment skips the household checks'; end if;
  if v_core not like '%assignment_rule_pairs_language(v_rule)%' then raise exception 'assign_lead: language pairing is missing'; end if;
  if v_core not like '%p_rotate_from_user_id is null or tu.user_id <> p_rotate_from_user_id%' then raise exception 'assign_lead: a rotation can hand the lead back to its owner'; end if;
  if v_core not like '%ASSIGNMENT_TARGET_NOT_ELIGIBLE%' or v_core not like '%ASSIGNMENT_TARGET_AT_CAPACITY%'
     or v_core not like '%REASSIGNMENT_REASON_REQUIRED%' or v_core not like '%ASSIGNMENT_MANAGER_REQUIRED%'
     or v_core not like '%Active ownership is sticky until disposition%' then
    raise exception 'assign_lead lost one of its refusals';
  end if;
  if v_core not like '%if v_open >= v_capacity.max_open_leads then continue;%' then raise exception 'assign_lead: a full agent is no longer skipped'; end if;
  if v_core not like '%assignment_candidate_is_eligible(p_tenant_id, v_candidate.user_id%' then raise exception 'assign_lead: the licence gate is not asked of every candidate'; end if;
  -- And the new behaviour.
  if v_core not like '%(not v_system or r.match_type = ''realtime'')%' or v_core not like '%if not v_has_fallback and not v_system then%' then
    raise exception 'assign_lead: the system route can reach rules other than real-time ones';
  end if;
  if v_core not like '%''licence''::text%' then raise exception 'assign_lead: licence fall-through is not logged'; end if;
  if v_core not like '%case when v_least_loaded then coalesce(c.current_open, 0) else 0 end%' then raise exception 'assign_lead: fewest-open-first is missing'; end if;
  if has_function_privilege('service_role', 'public.assign_lead_core(uuid,uuid,uuid,uuid,text,uuid,boolean)', 'execute')
     or has_function_privilege('tenant_app', 'public.auto_route_posted_lead(uuid,uuid)', 'execute') then
    raise exception 'the system route is executable by a role that must not run it';
  end if;
  if (select pg_get_functiondef(oid) from pg_proc where oid = to_regprocedure('public.auto_route_posted_lead(uuid,uuid)')) not like '%assignment_candidate_is_eligible%' then
    raise exception 'auto_route_posted_lead does not re-check the gate';
  end if;

  -- Conditions are ANDed, built in memory: nothing is written.
  v_rule.match_type := 'realtime';
  v_rule.match_values := '{"seconds": 60}'::jsonb;
  v_rule.conditions := '[{"match_type": "state", "match_values": {"states": ["TX"]}}]'::jsonb;
  v_lead.posted_at := now() - interval '10 seconds';
  v_lead.values := '{"state": "TX"}'::jsonb;
  if not public.assignment_rule_matches(v_rule, v_lead) then raise exception 'a TX lead posted 10 seconds ago missed "real-time AND TX"'; end if;
  v_lead.values := '{"state": "OH"}'::jsonb;
  if public.assignment_rule_matches(v_rule, v_lead) then raise exception 'an OH lead matched "real-time AND TX"'; end if;
  v_rule.conditions := '[{"match_type": "fallback", "match_values": {}}]'::jsonb;
  if public.assignment_rule_matches(v_rule, v_lead) then raise exception 'a fallback stored as a condition matched everything'; end if;
  v_rule.conditions := '[{"match_type": "language", "match_values": {"languages": ["es"]}}]'::jsonb;
  if not public.assignment_rule_pairs_language(v_rule) then raise exception 'a language condition does not pair'; end if;

  -- The switch starts off: a tenant that has not turned it on is never routed on arrival.
  select l.tenant_id, l.id into v_tenant, v_lead_id
    from public.agent_leads l
    left join public.assignment_settings s on s.tenant_id = l.tenant_id
   where not coalesce(s.auto_route_posted, false)
   limit 1;
  if v_lead_id is not null then
    v_off := public.auto_route_posted_lead(v_tenant, v_lead_id);
    if coalesce((v_off->>'routed')::boolean, true) or v_off->>'reason' <> 'off' then
      raise exception 'auto_route_posted_lead routed a lead for a tenant with the switch off: %', v_off;
    end if;
  end if;

  -- The preview still leaves nothing behind.
  v_tenant := null;
  select tu.tenant_id, tu.user_id into v_tenant, v_actor
    from public.tenant_users tu join public.users u on u.id = tu.user_id and u.status::text = 'active'
   where tu.accepted_at is not null and tu.role::text in ('owner', 'producer')
     and exists (select 1 from public.lead_queue q where q.tenant_id = tu.tenant_id and q.status = 'unclaimed')
   order by tu.tenant_id
   limit 1;
  if v_tenant is null then
    raise notice 'assignment router: no tenant with a manager and an unclaimed lead; preview probe skipped';
    return;
  end if;
  select count(*) into v_before from public.lead_assignment_events where tenant_id = v_tenant;
  select count(*) into v_skips_before from public.assignment_skip_events where tenant_id = v_tenant;
  v_preview := public.assignment_preview(v_tenant, v_actor, 3);
  select count(*) into v_after from public.lead_assignment_events where tenant_id = v_tenant;
  select count(*) into v_skips_after from public.assignment_skip_events where tenant_id = v_tenant;
  if jsonb_typeof(v_preview) <> 'array' then raise exception 'assignment_preview did not return rows'; end if;
  if v_after <> v_before or v_skips_after <> v_skips_before then
    raise exception 'assignment_preview left % event(s) and % skip(s) behind', v_after - v_before, v_skips_after - v_skips_before;
  end if;
  raise notice 'assignment router: strategy, conditions, licence fall-through and the system route are in place; preview of % lead(s) rolled back cleanly', jsonb_array_length(v_preview);
end $$;
