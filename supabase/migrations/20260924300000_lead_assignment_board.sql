-- /app/assignments · the Lead assignment board, made true.
--
-- The redesigned board states things the router did not do. This file makes each of them so, or the
-- application says less than the board did. What changes, in the order a reader of the board meets it:
--
--   Licence card     "Evaluated before rule 1" was false: a lead whose first matching rule had no
--                    eligible candidate raised NO_ELIGIBLE_ASSIGNEE even when a later rule, or the
--                    fallback, had someone who could take it. The router now FALLS THROUGH (user
--                    decision 1), so the licence gate really does run ahead of every rule.
--   "Assign next"    tried the first unclaimed lead and failed on it. It now SKIPS AHEAD over up to 25
--                    unclaimed leads in queue order until one routes (user decision 2).
--   Rule rows        need "N routed" and "skipped X N×". lead_assignment_events gains rule_id, and a
--                    new assignment_skip_events log records who was passed over and why.
--   Real-time rule   new match_type 'realtime': "arrived within N seconds", read from posted_at.
--   Language rule    "matches pairing": candidates are narrowed to agents whose recorded languages
--                    include the lead's. agent_capacity gains `languages`.
--   Rest day         agent_capacity gains `weekday_off`; automated assignment skips an agent on it.
--   Household card   "Same household — one agent at a time": a candidate is skipped when a DIFFERENT
--                    user owns an open lead with the same household key. Applied to manual reassign
--                    too. Rest days apply there as well, except to an owner or producer who gives a
--                    reason: that deliberate, recorded move is the override.
--                    "Attempts before rotate" is assignment_settings.attempts_before_rotate, run by a
--                    scheduled job (rotate_unanswered_assignments), never by a dialer trigger.
--   Preview card     assignment_preview: the real assign_lead, per lead, inside a savepoint that is
--                    always rolled back.
--   Publish rules    publish_assignment_rules: the whole draft in one transaction.
--
-- Additive. Every new column is nullable or defaulted, the one widened CHECK keeps every value it
-- accepted, and assign_lead keeps its signature, its return type and its grants. The lead_queue
-- capacity trigger is not touched. assignment_candidate_is_eligible and assignment_ineligibility_reason
-- are CALLED here, never redefined (Settings › States & licences owns them, 20260924110000).
--
-- Requires 20260913490000 (LA-2.24), 20260924110000 (per-agent licensed states) and 20260924100000
-- (agency_profiles.timezone, read for the weekday-off check).

-- ── schema ────────────────────────────────────────────────────────────────

-- 'realtime' joins the match types. Dropped and re-added under its generated name so the check is
-- identical apart from the one new value; every existing row passes it.
alter table public.assignment_rules drop constraint if exists assignment_rules_match_type_check;
alter table public.assignment_rules
  add constraint assignment_rules_match_type_check
  check (match_type in ('campaign', 'state', 'language', 'product', 'fallback', 'realtime'));

-- Per-agent routing facts, kept beside the ceiling they are read with.
--   languages    lower-case names or codes as the lead carries them ('spanish', 'es'); empty = none recorded
--   weekday_off  0 = Sunday … 6 = Saturday, in the agency's timezone; null = works every day
alter table public.agent_capacity add column if not exists languages text[] not null default '{}'::text[];
alter table public.agent_capacity add column if not exists weekday_off smallint;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agent_capacity_weekday_off_valid') then
    alter table public.agent_capacity
      add constraint agent_capacity_weekday_off_valid check (weekday_off is null or weekday_off between 0 and 6);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agent_capacity_languages_bounded') then
    alter table public.agent_capacity
      add constraint agent_capacity_languages_bounded check (coalesce(array_length(languages, 1), 0) <= 12);
  end if;
end $$;

-- Null or 0 = rotation off, which is every tenant until an owner sets it.
alter table public.assignment_settings add column if not exists attempts_before_rotate integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'assignment_settings_attempts_before_rotate_valid') then
    alter table public.assignment_settings
      add constraint assignment_settings_attempts_before_rotate_valid
      check (attempts_before_rotate is null or attempts_before_rotate between 0 and 50);
  end if;
end $$;

-- Which rule routed the lead. Null for a manual reassignment, for the implicit whole-roster fallback,
-- and for every event written before this file.
alter table public.lead_assignment_events
  add column if not exists rule_id uuid references public.assignment_rules(id) on delete set null;
create index if not exists lead_assignment_events_rule_idx
  on public.lead_assignment_events (tenant_id, rule_id, created_at desc) where rule_id is not null;

-- Who the router passed over, and why. Written only by assign_lead, only when the assignment it was
-- part of went through: a call that ends in NO_ELIGIBLE_ASSIGNEE rolls its skips back with it, so the
-- counts describe routing that happened, not attempts that did not.
create table if not exists public.assignment_skip_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  work_item_id uuid not null references public.lead_queue(id) on delete cascade,
  rule_id uuid references public.assignment_rules(id) on delete set null,
  user_id uuid not null references public.users(id) on delete cascade,
  reason text not null check (reason in ('capacity', 'rest', 'household', 'day_off')),
  created_at timestamptz not null default now()
);
create index if not exists assignment_skip_events_tenant_created_idx
  on public.assignment_skip_events (tenant_id, created_at desc);
create index if not exists assignment_skip_events_work_item_idx
  on public.assignment_skip_events (work_item_id);
create index if not exists assignment_skip_events_user_idx
  on public.assignment_skip_events (user_id);
create index if not exists assignment_skip_events_rule_idx
  on public.assignment_skip_events (rule_id) where rule_id is not null;

alter table public.assignment_skip_events enable row level security;
drop policy if exists assignment_skip_events_tenant_scoped on public.assignment_skip_events;
create policy assignment_skip_events_tenant_scoped on public.assignment_skip_events
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.assignment_skip_events from anon, authenticated, public;
grant select on public.assignment_skip_events to tenant_app;
grant select, insert, update, delete on public.assignment_skip_events to service_role;

-- ── rule matching ─────────────────────────────────────────────────────────
--
-- Unchanged except for the 'realtime' branch. That branch reads now(), so the function is STABLE
-- rather than IMMUTABLE: an immutable function that reads the clock can be constant-folded and
-- answer with the time it was planned.
create or replace function public.assignment_rule_matches(p_rule public.assignment_rules, p_lead public.agent_leads)
returns boolean
language plpgsql
stable
as $function$
declare
  v_value text;
  v_values jsonb;
  v_seconds numeric;
begin
  if p_rule.match_type = 'fallback' then return true; end if;
  if p_rule.match_type = 'campaign' then
    return p_lead.campaign_id is not null and (
      p_rule.match_values->'campaign_ids' ? p_lead.campaign_id::text
      or p_rule.match_values->'values' ? p_lead.campaign_id::text
    );
  end if;
  if p_rule.match_type = 'state' then
    v_value := upper(trim(coalesce(p_lead.values->>'state', p_lead.values->>'state_code', '')));
    v_values := coalesce(p_rule.match_values->'states', p_rule.match_values->'values', '[]'::jsonb);
    if jsonb_typeof(v_values) <> 'array' then return false; end if;
    return v_value <> '' and exists (select 1 from jsonb_array_elements_text(v_values) x(value) where upper(trim(x.value)) = v_value);
  end if;
  if p_rule.match_type = 'language' then
    v_value := lower(trim(coalesce(p_lead.values->>'language', p_lead.values->>'preferred_language', p_lead.values->>'language_code', '')));
    v_values := coalesce(p_rule.match_values->'languages', p_rule.match_values->'values', '[]'::jsonb);
    if jsonb_typeof(v_values) <> 'array' then return false; end if;
    return v_value <> '' and exists (select 1 from jsonb_array_elements_text(v_values) x(value) where lower(trim(x.value)) = v_value);
  end if;
  if p_rule.match_type = 'product' then
    v_value := lower(trim(coalesce(p_lead.product_line, p_lead.values->>'product_code', p_lead.values->>'product', '')));
    v_values := coalesce(p_rule.match_values->'products', p_rule.match_values->'product_codes', p_rule.match_values->'values', '[]'::jsonb);
    if jsonb_typeof(v_values) <> 'array' then return false; end if;
    return v_value <> '' and exists (select 1 from jsonb_array_elements_text(v_values) x(value) where lower(trim(x.value)) = v_value);
  end if;
  -- NEW. "Arrived within N seconds": the lead was posted (LA-2.5) no more than N seconds ago. A
  -- list lead has no posted_at and never matches. This decides WHO gets the lead, not WHEN: posted
  -- leads already enter lead_queue at tier 0 and sort first in assignment order without any rule.
  if p_rule.match_type = 'realtime' then
    v_seconds := case when jsonb_typeof(p_rule.match_values->'seconds') = 'number'
                      then (p_rule.match_values->>'seconds')::numeric end;
    return v_seconds is not null and v_seconds > 0
       and p_lead.posted_at is not null
       and p_lead.posted_at >= now() - make_interval(secs => v_seconds::double precision);
  end if;
  return false;
end;
$function$;

-- ── assign_lead ───────────────────────────────────────────────────────────
--
-- The body moves to assign_lead_core, which takes one extra, internal argument: the owner a
-- scheduled rotation is moving a lead away from. assign_lead keeps its exact signature, return type
-- and grants (service_role only) and passes null, so every existing caller — the API, the preview —
-- gets the router below with rotation off.
--
-- Every change from the 20260913490000 body is marked "CHANGE n" where it happens:
--
--   1  Rotation (decision 3). With p_rotate_from_user_id set, the actor may be null (the scheduler),
--      the lead must still be claimed by that owner and undispositioned, the sticky refusal is not
--      applied (the job has already checked there is no live call), and that owner is excluded
--      from the candidates. Nothing else differs: same rules, same gates, same audit event.
--   2  Skip-ahead (decision 2). With no work item AND no target, up to 25 unclaimed leads are tried
--      in queue order (tier, queued_at, id; skip locked), one row lock at a time, until one routes.
--      With a work item or a target, exactly one lead is tried, as before.
--   3  Fall-through (decision 1). Automated routing tries every matching rule in order, then the
--      implicit whole-roster fallback when no fallback rule of the tenant's own matched, until one
--      has an eligible candidate. The first matching rule with a candidate is the same rule that
--      routed the lead before, so nothing that routed before routes differently. A licensed-only
--      product rule that matched keeps requiring a licensed agent for the rules tried after it.
--   4  Language pairing. Under a 'language' rule a candidate must have the lead's language among
--      their recorded languages. This is where the previously unused v_language is read.
--   5  Weekday off. An agent is skipped by automated routing on their recorded day off, in the
--      agency's timezone (UTC when none is set or it is not a valid zone name).
--   6  Same household. A candidate is skipped when a DIFFERENT user owns another open lead with the
--      same assignment_contact_key.
--   7  Manual reassignment now honours same household always, and rest days unless an owner or
--      producer gives a reason (the recorded reason is the override). Both apply only when the
--      target is not already the owner; they raise ASSIGNMENT_TARGET_RESTING and
--      ASSIGNMENT_HOUSEHOLD_OWNED, which the API turns into sentences. The weekday-off and language
--      checks do NOT apply to a manager's deliberate choice.
--   8  Logging. The assignment event carries rule_id when a rule routed it automatically; skips for
--      capacity, rest, household and day off go to assignment_skip_events, written once, on success.
--   9  NO_ELIGIBLE_ASSIGNEE keeps its message and gains a DETAIL (JSON counts of why each candidate
--      was passed over) so the preview and the API can say why nobody could take the lead.
--  10  The returned object gains 'leads_skipped' (leads passed over by skip-ahead). Every existing
--      key keeps its meaning.
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
declare
  v_item public.lead_queue%rowtype;
  v_lead public.agent_leads%rowtype;
  v_rule public.assignment_rules%rowtype;
  v_selected_rule public.assignment_rules%rowtype;
  v_capacity public.agent_capacity%rowtype;
  v_candidate record;
  v_owner_role text;
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
  v_last_position integer;
  v_position integer;
  v_rule_found boolean := false;
  v_round_robin_last uuid;
  v_actor_role text;
  -- CHANGE 2–9 state.
  v_settings_last uuid;          -- the tenant-wide round-robin pointer, kept apart from the per-rule one
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
begin
  -- CHANGE 1: a rotation may run with no actor. Everything else must name an active member.
  if p_rotate_from_user_id is not null and (p_work_item_id is null or p_target_user_id is not null) then
    raise exception 'ASSIGNMENT_ROTATION_INVALID';
  end if;
  if p_rotate_from_user_id is not null and p_actor_user_id is null then
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

  -- Read once rather than once per lead: nothing below changes them.
  select coalesce(s.rest_days, 0), s.last_assignee_id into v_rest_days, v_settings_last from public.assignment_settings s where s.tenant_id = p_tenant_id;
  v_rest_days := coalesce(v_rest_days, 0);

  -- CHANGE 5: today's weekday where the agency is. A zone Postgres does not know falls back to UTC
  -- rather than failing every assignment over a typo on Agency profile.
  begin
    select nullif(btrim(ap.timezone), '') into v_zone from public.agency_profiles ap where ap.tenant_id = p_tenant_id;
    v_dow := extract(dow from (now() at time zone coalesce(v_zone, 'UTC')))::integer;
  exception when others then
    v_dow := extract(dow from (now() at time zone 'UTC'))::integer;
  end;

  -- CHANGE 2: skip-ahead only for "assign the next eligible lead" — no work item, no target.
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
      -- The first lead missing is the error it always was. A later one means the queue ran out
      -- while skipping ahead, which is "nobody could take any of them", raised below.
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

    -- Per-lead diagnostics restart with each lead (CHANGE 9).
    v_n_candidates := 0; v_n_licence := 0; v_n_language := 0; v_n_day_off := 0;
    v_n_rest := 0; v_n_household := 0; v_n_capacity := 0;
    v_selected_rule := null;
    v_rule_found := false;
    v_selected_user := null;
    v_selected_role := null;

    -- CHANGE 1: the rotation must still find the lead where the job left it.
    if p_rotate_from_user_id is not null
       and (v_item.owner_user_id is distinct from p_rotate_from_user_id or v_item.status <> 'claimed' or v_item.disposition is not null) then
      raise exception 'ASSIGNMENT_ROTATION_STALE';
    end if;

    -- A claimed, undispositioned row is the live conversation. Automated assignment never takes it
    -- away from its current owner. An explicit target is the deliberate manual reassignment path and
    -- requires a reason below. (CHANGE 1: a rotation is the one automated caller let past, and only
    -- after rotate_unanswered_assignments has established there is no call, open attempt or
    -- promised callback on it.)
    if v_item.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active') and v_item.owner_user_id is not null and v_item.disposition is null and p_target_user_id is null and p_rotate_from_user_id is null then
      return jsonb_build_object('work_item_id', v_item.id, 'lead_id', v_item.lead_id, 'owner_user_id', v_item.owner_user_id, 'owner_role', v_item.owner_role, 'sticky', true, 'reason', 'Active ownership is sticky until disposition');
    end if;
    if v_item.status not in ('unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active') then raise exception 'ASSIGNMENT_WORK_ITEM_CLOSED'; end if;
    if p_target_user_id is not null and p_target_user_id <> coalesce(v_item.owner_user_id, p_actor_user_id)
       and v_actor_role not in ('owner', 'producer') then
      raise exception 'ASSIGNMENT_MANAGER_REQUIRED';
    end if;
    if p_target_user_id is not null and v_item.owner_user_id is not null and p_target_user_id <> v_item.owner_user_id and v_event_reason is null then raise exception 'REASSIGNMENT_REASON_REQUIRED'; end if;

    -- CHANGE 6: everyone else holding this household right now. The row being assigned is left out,
    -- so a reassignment is not blocked by the owner it is being taken from.
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
      -- First match wins. The rule row is locked with the tenant assignment operation, and the tie
      -- breaker on id makes equal priorities deterministic. Unchanged for the manual path: the first
      -- matching rule still decides whether the lead needs a licensed agent, and still has its
      -- round-robin pointer moved by the assignment, exactly as before.
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
      v_requires_licensed := v_product in ('term_life', 'term-life', 'term life')
        or (v_selected_rule.match_type = 'product' and case when jsonb_typeof(v_selected_rule.match_values->'licensed_only') = 'boolean' then (v_selected_rule.match_values->>'licensed_only')::boolean else false end);

      select tu.role::text into v_selected_role
        from public.tenant_users tu join public.users u on u.id = tu.user_id
       where tu.tenant_id = p_tenant_id and tu.user_id = p_target_user_id
         and tu.accepted_at is not null and u.status::text = 'active';
      if not found or not public.assignment_candidate_is_eligible(p_tenant_id, p_target_user_id, v_selected_role, v_product, v_state, v_requires_licensed) then raise exception 'ASSIGNMENT_TARGET_NOT_ELIGIBLE'; end if;
      -- CHANGE 7: the two household rules the automated path always applied (rest) or now applies
      -- (same household). Not asked when the target already owns the lead: that is not a new owner.
      -- Rest days yield to a manager who gives a reason: a deliberate, recorded reassignment (an agent
      -- out sick, a complaint) is the one case the rest window must not block. Anyone else pulling a
      -- household inside its window is refused, as the automated path is. Same household is absolute.
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
      -- CHANGE 3: every matching rule, in order, then the implicit fallback. Collected first so the
      -- rule rows are read once per lead, and so the implicit fallback can be appended only when the
      -- tenant's own fallback did not match (an active fallback rule always matches).
      select coalesce(array_agg(r order by r.priority, r.id), '{}'::public.assignment_rules[]),
             coalesce(bool_or(r.match_type = 'fallback'), false)
        into v_rules, v_has_fallback
        from public.assignment_rules r
       where r.tenant_id = p_tenant_id and r.is_active
         and public.assignment_rule_matches(r, v_lead);
      v_real_rules := coalesce(cardinality(v_rules), 0);
      if not v_has_fallback then
        -- The same stand-in rule the original built when nothing matched: a fresh id, no assignees
        -- (so the whole roster), match type fallback, every other field null.
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
        -- The same test as before for the rule being tried, OR-ed with the rules already tried: a
        -- licensed-only product rule the lead matched is a fact about the lead, so falling through
        -- it to a later rule must not let a setter take what it said needs a licence. For the first
        -- rule tried this is exactly the original expression.
        v_requires_licensed := v_requires_licensed or v_product in ('term_life', 'term-life', 'term life')
          or (v_rule.match_type = 'product' and case when jsonb_typeof(v_rule.match_values->'licensed_only') = 'boolean' then (v_rule.match_values->>'licensed_only')::boolean else false end);

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
             -- CHANGE 1: never back to the owner it is being rotated away from.
             and (p_rotate_from_user_id is null or tu.user_id <> p_rotate_from_user_id)
           order by case
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
          if not public.assignment_candidate_is_eligible(p_tenant_id, v_candidate.user_id, v_candidate.role, v_product, v_state, v_requires_licensed) then
            v_n_licence := v_n_licence + 1;
            continue;
          end if;
          -- CHANGE 4: a language rule pairs the lead with someone who speaks it.
          if v_rule.match_type = 'language' and not exists (
            select 1 from unnest(v_candidate.languages) x(value) where lower(btrim(x.value)) = v_language
          ) then
            v_n_language := v_n_language + 1;
            continue;
          end if;
          -- CHANGE 5: not on their day off.
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
          -- CHANGE 6: one agent at a time per household.
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
          -- CHANGE 8: recorded on its own line so the skip it logs and the skip it makes cannot drift.
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
      end loop;
    end if;

    exit items when v_selected_user is not null;
  end loop;

  if v_selected_user is null then
    -- CHANGE 9: same message, now with the reasons. Counts are for the last lead tried (the only
    -- lead, when a work item was named).
    raise exception 'NO_ELIGIBLE_ASSIGNEE' using detail = jsonb_build_object(
      'leads_tried', v_items_tried, 'work_item_id', v_item.id, 'state', v_state, 'product', v_product,
      'requires_licensed', v_requires_licensed, 'candidates', v_n_candidates, 'licence', v_n_licence,
      'language', v_n_language, 'day_off', v_n_day_off, 'rest', v_n_rest, 'household', v_n_household,
      'capacity', v_n_capacity)::text;
  end if;

  v_from_user := v_item.owner_user_id;
  v_event_type := case when v_from_user is null then case when p_work_item_id is null then 'assigned' else 'pulled' end else 'reassigned' end;
  if v_from_user is not null and v_event_reason is null then v_event_reason := 'Manual reassignment'; end if;
  v_event_reason := coalesce(v_event_reason, 'Rule-based assignment');
  update public.lead_queue
     set status = 'claimed', claimed_by = v_selected_user, owner_user_id = v_selected_user,
         owner_role = v_selected_role, claimed_at = coalesce(claimed_at, now()), locked_until = null, updated_at = now()
   where id = v_item.id and tenant_id = p_tenant_id;
  -- CHANGE 8: rule_id, only when a rule of the tenant's routed it automatically.
  insert into public.lead_assignment_events (tenant_id, work_item_id, lead_id, contact_key, from_user_id, to_user_id, event_type, reason, assigned_by, rule_id)
  values (p_tenant_id, v_item.id, v_item.lead_id, v_contact_key, v_from_user, v_selected_user, v_event_type, v_event_reason, p_actor_user_id,
          case when p_target_user_id is null and v_rule_found then v_selected_rule.id end);
  if cardinality(v_skip_users) > 0 then
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

-- Same signature, return type and grants as 20260913490000; the router is assign_lead_core with
-- rotation off.
create or replace function public.assign_lead(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_work_item_id uuid default null,
  p_target_user_id uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
begin
  return public.assign_lead_core(p_tenant_id, p_actor_user_id, p_work_item_id, p_target_user_id, p_reason, null);
end;
$function$;

-- ── routing preview ───────────────────────────────────────────────────────
--
-- The next few unclaimed leads, each run through the REAL assign_lead in queue order, all inside one
-- block that always ends by raising and catching its own sentinel — so every row it touched, every
-- event and skip it wrote and every capacity count it moved is rolled back before it returns. The
-- leads are assigned in sequence inside that block, so the second sees the first's capacity and
-- round-robin effect, as a real run of "Assign next" would. The pattern is 20260924110000's probe.
--
-- Manager-only, and at most ten leads: it takes the same row locks assign_lead does, briefly.
create or replace function public.assignment_preview(p_tenant_id uuid, p_actor_user_id uuid, p_limit integer default 5)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 10);
  v_actor_role text;
  v_rows jsonb := '[]'::jsonb;
  v_item record;
  v_result jsonb;
  v_error text;
  v_detail text;
  v_detail_json jsonb;
  v_full uuid[];
  v_licensed_anyone boolean;
  v_reason text;
  v_explainer record;
begin
  select tu.role::text into v_actor_role
    from public.tenant_users tu join public.users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor_user_id
     and tu.accepted_at is not null and u.status::text = 'active'
   limit 1;
  if not found then raise exception 'ASSIGNMENT_ACTOR_INVALID'; end if;
  if v_actor_role not in ('owner', 'producer') then raise exception 'ASSIGNMENT_MANAGER_REQUIRED'; end if;

  begin
    for v_item in
      select q.id, q.lead_id, l.product_line,
             upper(btrim(coalesce(l.values->>'state', l.values->>'state_code', ''))) as state,
             lower(btrim(coalesce(l.product_line, l.values->>'product_code', l.values->>'product', ''))) as product,
             coalesce(nullif(btrim(l.values->>'full_name'), ''),
                      nullif(btrim(concat_ws(' ', nullif(btrim(l.values->>'first_name'), ''), nullif(btrim(l.values->>'last_name'), ''))), ''),
                      nullif(btrim(l.values->>'name'), ''),
                      'Unnamed lead') as name
        from public.lead_queue q
        join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
       where q.tenant_id = p_tenant_id and q.status = 'unclaimed'
       order by q.tier nulls last, q.queued_at, q.id
       limit v_limit
    loop
      v_result := null; v_error := null; v_detail := null; v_detail_json := null;
      v_full := '{}'::uuid[]; v_reason := null; v_licensed_anyone := null;
      begin
        v_result := public.assign_lead(p_tenant_id, p_actor_user_id, v_item.id, null, 'Routing preview');
      exception when others then
        get stacked diagnostics v_error = message_text, v_detail = pg_exception_detail;
      end;

      if v_result is not null and not coalesce((v_result->>'sticky')::boolean, false) then
        -- Who the router passed over for being full, on the way to this lead's owner.
        select coalesce(array_agg(s.user_id order by s.created_at, s.id), '{}'::uuid[]) into v_full
          from public.assignment_skip_events s
         where s.tenant_id = p_tenant_id and s.work_item_id = v_item.id and s.reason = 'capacity';
        -- A setter took it: was there a licensed agent who could have?
        if v_result->>'owner_role' = 'setter' then
          select exists (
            select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id and u.status::text = 'active'
             where tu.tenant_id = p_tenant_id and tu.accepted_at is not null and tu.role::text in ('owner', 'producer')
               and public.assignment_candidate_is_eligible(p_tenant_id, tu.user_id, tu.role::text, v_item.product, v_item.state, false)
          ) into v_licensed_anyone;
        end if;
      elsif v_error = 'NO_ELIGIBLE_ASSIGNEE' then
        begin v_detail_json := v_detail::jsonb; exception when others then v_detail_json := null; end;
        -- The same sentence the gate would give: asked of the first licensed-role member, which is
        -- the agency-level answer unless that agent's own states are recorded.
        select tu.user_id, tu.role::text as role into v_explainer
          from public.tenant_users tu join public.users u on u.id = tu.user_id and u.status::text = 'active'
         where tu.tenant_id = p_tenant_id and tu.accepted_at is not null and tu.role::text in ('owner', 'producer')
         order by tu.user_id
         limit 1;
        if found then
          v_reason := public.assignment_ineligibility_reason(p_tenant_id, v_explainer.user_id, v_explainer.role, v_item.product, v_item.state,
                        coalesce((v_detail_json->>'requires_licensed')::boolean, false));
        end if;
      end if;

      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'work_item_id', v_item.id,
        'lead_id', v_item.lead_id,
        'name', v_item.name,
        'state', nullif(v_item.state, ''),
        'outcome', case
                     when v_result is not null and coalesce((v_result->>'sticky')::boolean, false) then 'taken'
                     when v_result is not null then 'routed'
                     when v_error = 'NO_ELIGIBLE_ASSIGNEE' then 'nobody'
                     else 'error' end,
        'owner_user_id', v_result->'owner_user_id',
        'owner_role', v_result->'owner_role',
        'rule_id', v_result->'rule_id',
        'full_user_ids', to_jsonb(v_full),
        'setter_without_licensed_agent', case when v_licensed_anyone is null then null else not v_licensed_anyone end,
        'detail', v_detail_json,
        'licence_reason', v_reason,
        'error', case when v_result is null and coalesce(v_error, '') <> 'NO_ELIGIBLE_ASSIGNEE' then v_error end
      ));
    end loop;
    raise exception using errcode = 'P0001', message = 'assignment_preview_rollback';
  exception when others then
    if sqlerrm <> 'assignment_preview_rollback' then raise; end if;
  end;
  return v_rows;
end;
$function$;

-- ── board figures ─────────────────────────────────────────────────────────
--
-- One round trip for the numbers the board prints: routed per rule and skips since p_since, the
-- states each owner or producer may be handed (asked of assignment_candidate_is_eligible, state by
-- state, over the states the agency holds any licence in — eligibility needs one), and how many
-- unclaimed leads sit in a state none of them can work.
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

  -- The same person can be passed over under two rules for one lead (full under rule 1, still full
  -- under the fallback). Per rule that is two skips; per person it is one lead they could not take.
  select coalesce(jsonb_agg(jsonb_build_object('user_id', z.user_id, 'reason', z.reason, 'leads', z.n)), '[]'::jsonb) into v_skipped_leads
    from (select s.user_id, s.reason, count(distinct s.work_item_id)::integer as n
            from public.assignment_skip_events s
           where s.tenant_id = p_tenant_id and s.created_at >= p_since
           group by s.user_id, s.reason) z;

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
                            'eligible_states', v_states, 'unlicensed_leads', v_unlicensed);
end;
$function$;

-- ── publishing a draft of the rules ───────────────────────────────────────
--
-- The board edits the chain as a draft and publishes it whole. p_rules is the chain in order:
--   [{ "id"?: uuid, "match_type": text, "match_values": object, "assignee_ids": [uuid], "is_active"?: bool }]
-- Priority becomes the position (10, 20, 30 …). A rule of the tenant's that is not in the list is
-- deactivated, never deleted: its routed history keeps pointing at it. Assignees who are not
-- members of the tenant are dropped rather than stored. One transaction, so the router never reads
-- half a chain.
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
begin
  select tu.role::text into v_actor_role
    from public.tenant_users tu join public.users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor_user_id
     and tu.accepted_at is not null and u.status::text = 'active'
   limit 1;
  if not found then raise exception 'ASSIGNMENT_ACTOR_INVALID'; end if;
  if v_actor_role not in ('owner', 'producer') then raise exception 'ASSIGNMENT_MANAGER_REQUIRED'; end if;
  if jsonb_typeof(p_rules) <> 'array' then raise exception 'ASSIGNMENT_RULES_INVALID'; end if;

  -- Two managers publishing at once: the second waits for the first, then replaces it whole.
  perform 1 from public.assignment_rules r where r.tenant_id = p_tenant_id for update;

  for v_rule in select value from jsonb_array_elements(p_rules)
  loop
    v_index := v_index + 1;
    -- Order is kept: a rule's round-robin runs in the order its assignees were listed.
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
             is_active = coalesce((v_rule->>'is_active')::boolean, true)
       where id = v_id and tenant_id = p_tenant_id;
      if not found then raise exception 'ASSIGNMENT_RULE_NOT_FOUND'; end if;
    else
      insert into public.assignment_rules (tenant_id, priority, match_type, match_values, assignee_ids, is_active, created_by)
      values (p_tenant_id, v_index * 10, v_rule->>'match_type', coalesce(v_rule->'match_values', '{}'::jsonb), v_assignees,
              coalesce((v_rule->>'is_active')::boolean, true), p_actor_user_id)
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

-- ── attempts before rotate (decision 3) ───────────────────────────────────
--
-- Run by /api/cron/assignment-rotation, never from the dialer's path: no trigger reads
-- tenant_call_attempts. For each tenant with attempts_before_rotate > 0 it looks at leads that are
-- OWNED — claimed, an owner, no disposition, no live dialer lock — and counts the owner's unanswered
-- attempts on that lead since anyone last reached it.
--
-- "Unanswered" is tenant_call_attempts.disposition in no_answer, voicemail, busy, call_dropped: the
-- codes every contact-rate query here treats as "no contact". agent_leads.attempts_made is NOT used:
-- it counts every attempt by anyone, answered or not, so it cannot say what this owner has tried.
--
-- Sticky ownership exists so nobody loses a live conversation. A lead is therefore never rotated
-- while it has an open call (active_calls), an attempt with no disposition in the last two hours
-- (a dial may be in progress), or a callback the customer booked (scheduled or due); and only
-- status 'claimed' qualifies, never a live transfer (buffer_active, handed_pending, la_active).
--
-- The move itself is assign_lead_core with that owner excluded: the rules, the licence gate, the
-- language, capacity, day-off, rest-day and same-household checks all apply, so with rest days set
-- a lead cannot rotate until the rest period since its last assignment has passed. When nobody else
-- may take it, it stays with its owner. Each rotation writes the usual 'reassigned' event (reason
-- "Rotated after N unanswered attempts …", assigned_by null) and an audit_log row.
create or replace function public.rotate_unanswered_assignments(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_unanswered constant text[] := array['no_answer', 'voicemail', 'busy', 'call_dropped'];
  v_row record;
  v_result jsonb;
  v_checked integer := 0;
  v_rotated integer := 0;
  v_kept integer := 0;
  v_error text;
  v_kept_reasons jsonb := '{}'::jsonb;
begin
  for v_row in
    select q.id as work_item_id, q.tenant_id, q.lead_id, q.owner_user_id, s.attempts_before_rotate as threshold, a.unanswered
      from public.assignment_settings s
      join public.lead_queue q on q.tenant_id = s.tenant_id
      cross join lateral (
        select count(*)::integer as unanswered
          from public.tenant_call_attempts ca
         where ca.tenant_id = q.tenant_id and ca.lead_id = q.lead_id and ca.agent_id = q.owner_user_id
           and ca.disposition = any(v_unanswered)
           and ca.attempted_at > coalesce((
             select max(cb.attempted_at) from public.tenant_call_attempts cb
              where cb.tenant_id = q.tenant_id and cb.lead_id = q.lead_id
                and cb.disposition is not null and not (cb.disposition = any(v_unanswered))
           ), '-infinity'::timestamptz)
      ) a
     where coalesce(s.attempts_before_rotate, 0) > 0
       and q.status = 'claimed' and q.owner_user_id is not null and q.disposition is null
       and (q.locked_until is null or q.locked_until < now())
       and a.unanswered >= s.attempts_before_rotate
       and not exists (select 1 from public.active_calls ac where ac.tenant_id = q.tenant_id and ac.work_item_id = q.id and ac.ended_at is null)
       and not exists (select 1 from public.tenant_call_attempts op
                        where op.tenant_id = q.tenant_id and op.lead_id = q.lead_id
                          and op.disposition is null and op.attempted_at > now() - interval '2 hours')
       and not exists (select 1 from public.tenant_callbacks cb
                        where cb.tenant_id = q.tenant_id and cb.work_item_id = q.id and cb.status in ('scheduled', 'due'))
     order by q.tenant_id, q.claimed_at nulls first, q.id
     limit greatest(coalesce(p_limit, 200), 1)
  loop
    v_checked := v_checked + 1;
    begin
      perform 1 from public.lead_queue
       where id = v_row.work_item_id and tenant_id = v_row.tenant_id and owner_user_id = v_row.owner_user_id
         and status = 'claimed' and disposition is null
       for update skip locked;
      if not found then
        v_kept := v_kept + 1;
        v_kept_reasons := v_kept_reasons || jsonb_build_object('busy', coalesce((v_kept_reasons->>'busy')::integer, 0) + 1);
        continue;
      end if;
      v_result := public.assign_lead_core(v_row.tenant_id, null, v_row.work_item_id, null,
                    format('Rotated after %s unanswered attempts by the previous owner', v_row.unanswered),
                    v_row.owner_user_id);
      insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
      values ('system', 'tenant.lead_rotated', 'lead_queue', v_row.work_item_id::text,
              jsonb_build_object('tenantId', v_row.tenant_id, 'leadId', v_row.lead_id,
                                 'fromUserId', v_row.owner_user_id, 'toUserId', v_result->'owner_user_id',
                                 'ruleId', v_result->'rule_id', 'unansweredAttempts', v_row.unanswered,
                                 'threshold', v_row.threshold));
      v_rotated := v_rotated + 1;
    exception when others then
      -- NO_ELIGIBLE_ASSIGNEE (nobody else may take it) is the ordinary case: the lead stays put.
      v_error := sqlerrm;
      v_kept := v_kept + 1;
      v_kept_reasons := v_kept_reasons || jsonb_build_object(v_error, coalesce((v_kept_reasons->>v_error)::integer, 0) + 1);
    end;
  end loop;
  return jsonb_build_object('checked', v_checked, 'rotated', v_rotated, 'kept', v_kept, 'kept_reasons', v_kept_reasons);
end;
$function$;

-- ── grants ────────────────────────────────────────────────────────────────
-- assign_lead and assignment_rule_matches were replaced in place and keep their grants.
-- assign_lead_core is internal: only its owner (through assign_lead and the rotation) runs it.
revoke all on function
  public.assign_lead_core(uuid, uuid, uuid, uuid, text, uuid),
  public.assignment_preview(uuid, uuid, integer),
  public.assignment_insights(uuid, timestamptz),
  public.publish_assignment_rules(uuid, uuid, jsonb),
  public.rotate_unanswered_assignments(integer)
  from public, anon, authenticated, tenant_app;
grant execute on function
  public.assignment_preview(uuid, uuid, integer),
  public.assignment_insights(uuid, timestamptz),
  public.publish_assignment_rules(uuid, uuid, jsonb),
  public.rotate_unanswered_assignments(integer)
  to service_role;

-- ── asserted against whatever this database holds ─────────────────────────
do $$
declare
  v_core text;
  v_wrapper text;
  v_rule public.assignment_rules;
  v_lead public.agent_leads;
  v_tenant uuid;
  v_actor uuid;
  v_before bigint;
  v_after bigint;
  v_skips_before bigint;
  v_skips_after bigint;
  v_preview jsonb;
begin
  -- A parse-check run (tenant_app) cannot add the column or replace the functions.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'lead_assignment_events' and column_name = 'rule_id')
     or to_regprocedure('public.assign_lead_core(uuid,uuid,uuid,uuid,text,uuid)') is null then
    raise notice 'lead assignment board: schema not present; skipping the behaviour checks';
    return;
  end if;

  select prosrc into v_core from pg_proc where oid = to_regprocedure('public.assign_lead_core(uuid,uuid,uuid,uuid,text,uuid)');
  select prosrc into v_wrapper from pg_proc where oid = to_regprocedure('public.assign_lead(uuid,uuid,uuid,uuid,text)');
  if v_wrapper not like '%assign_lead_core%' then raise exception 'assign_lead does not route through assign_lead_core'; end if;
  if v_core not like '%v_max_items := 25%' then raise exception 'assign_lead: skip-ahead is missing'; end if;
  if v_core not like '%for v_rule_index in 1 .. cardinality(v_rules)%' then raise exception 'assign_lead: rule fall-through is missing'; end if;
  if v_core not like '%assignment_skip_events%' then raise exception 'assign_lead: the skip log is not written'; end if;
  if v_core not like '%rule_id)%' then raise exception 'assign_lead: rule_id is not recorded on the event'; end if;
  if v_core not like '%ASSIGNMENT_TARGET_RESTING%' or v_core not like '%ASSIGNMENT_HOUSEHOLD_OWNED%' then raise exception 'assign_lead: manual reassignment skips the household checks'; end if;
  if v_core not like '%v_rule.match_type = ''language''%' then raise exception 'assign_lead: language pairing is missing'; end if;
  if v_core not like '%p_rotate_from_user_id is null or tu.user_id <> p_rotate_from_user_id%' then raise exception 'assign_lead: a rotation can hand the lead back to its owner'; end if;
  -- The refusals that must survive.
  if v_core not like '%ASSIGNMENT_TARGET_NOT_ELIGIBLE%' or v_core not like '%ASSIGNMENT_TARGET_AT_CAPACITY%'
     or v_core not like '%REASSIGNMENT_REASON_REQUIRED%' or v_core not like '%ASSIGNMENT_MANAGER_REQUIRED%'
     or v_core not like '%Active ownership is sticky until disposition%' then
    raise exception 'assign_lead lost one of its refusals';
  end if;

  if (select provolatile from pg_proc where oid = to_regprocedure('public.assignment_rule_matches(public.assignment_rules,public.agent_leads)')) <> 's' then
    raise exception 'assignment_rule_matches reads now() and must be stable';
  end if;

  -- Real-time matching, built in memory: nothing is written.
  v_rule.match_type := 'realtime';
  v_rule.match_values := '{"seconds": 60}'::jsonb;
  v_lead.posted_at := now() - interval '10 seconds';
  if not public.assignment_rule_matches(v_rule, v_lead) then raise exception 'a lead posted 10 seconds ago missed a 60-second rule'; end if;
  v_lead.posted_at := now() - interval '5 minutes';
  if public.assignment_rule_matches(v_rule, v_lead) then raise exception 'a lead posted 5 minutes ago matched a 60-second rule'; end if;
  v_lead.posted_at := null;
  if public.assignment_rule_matches(v_rule, v_lead) then raise exception 'a list lead with no posted_at matched a real-time rule'; end if;

  -- The preview leaves nothing behind.
  select tu.tenant_id, tu.user_id into v_tenant, v_actor
    from public.tenant_users tu join public.users u on u.id = tu.user_id and u.status::text = 'active'
   where tu.accepted_at is not null and tu.role::text in ('owner', 'producer')
     and exists (select 1 from public.lead_queue q where q.tenant_id = tu.tenant_id and q.status = 'unclaimed')
   order by tu.tenant_id
   limit 1;
  if v_tenant is null then
    raise notice 'lead assignment board: no tenant with a manager and an unclaimed lead; preview probe skipped';
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
  raise notice 'lead assignment board: fall-through, skip-ahead, pairing, household and rotation are in place; preview of % lead(s) rolled back cleanly', jsonb_array_length(v_preview);
end $$;
