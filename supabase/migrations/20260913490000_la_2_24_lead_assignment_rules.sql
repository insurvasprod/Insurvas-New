-- LA-2.24 · deterministic lead assignment, capacity, licensing and ownership recovery.
--
-- Assignment is a database transaction because the facts that must agree are the queue owner,
-- the capacity counter and the audit event. The API only chooses an operation; it never decides
-- whether a licensed agent may write a state or whether an agent is full.

create table if not exists public.assignment_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  priority integer not null check (priority >= 0),
  match_type text not null check (match_type in ('campaign', 'state', 'language', 'product', 'fallback')),
  match_values jsonb not null default '{}'::jsonb check (jsonb_typeof(match_values) = 'object'),
  assignee_ids uuid[] not null default '{}'::uuid[],
  is_active boolean not null default true,
  last_assignee_id uuid references public.users(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (match_type = 'fallback' or match_values <> '{}'::jsonb)
);

create index if not exists assignment_rules_order_idx
  on public.assignment_rules (tenant_id, is_active, priority, id);

create table if not exists public.agent_capacity (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  max_open_leads integer not null default 25 check (max_open_leads between 0 and 100000),
  current_open integer not null default 0 check (current_open >= 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create index if not exists agent_capacity_tenant_idx
  on public.agent_capacity (tenant_id, user_id);

create table if not exists public.assignment_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  rest_days integer not null default 0 check (rest_days between 0 and 3650),
  last_assignee_id uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.lead_assignment_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  work_item_id uuid not null references public.lead_queue(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  contact_key text not null,
  from_user_id uuid references public.users(id) on delete set null,
  to_user_id uuid references public.users(id) on delete set null,
  event_type text not null check (event_type in ('assigned', 'pulled', 'reassigned', 'returned_to_pool', 'auto_returned')),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  assigned_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists lead_assignment_events_contact_idx
  on public.lead_assignment_events (tenant_id, contact_key, created_at desc);
create index if not exists lead_assignment_events_work_item_idx
  on public.lead_assignment_events (tenant_id, work_item_id, created_at desc);

create or replace function public.touch_assignment_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists assignment_rules_touch_updated_at on public.assignment_rules;
create trigger assignment_rules_touch_updated_at
before update on public.assignment_rules
for each row execute function public.touch_assignment_updated_at();

drop trigger if exists assignment_settings_touch_updated_at on public.assignment_settings;
create trigger assignment_settings_touch_updated_at
before update on public.assignment_settings
for each row execute function public.touch_assignment_updated_at();

drop trigger if exists agent_capacity_touch_updated_at on public.agent_capacity;
create trigger agent_capacity_touch_updated_at
before update on public.agent_capacity
for each row execute function public.touch_assignment_updated_at();

alter table public.assignment_rules enable row level security;
alter table public.agent_capacity enable row level security;
alter table public.assignment_settings enable row level security;
alter table public.lead_assignment_events enable row level security;

drop policy if exists assignment_rules_tenant_scoped on public.assignment_rules;
create policy assignment_rules_tenant_scoped on public.assignment_rules
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists agent_capacity_tenant_scoped on public.agent_capacity;
create policy agent_capacity_tenant_scoped on public.agent_capacity
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists assignment_settings_tenant_scoped on public.assignment_settings;
create policy assignment_settings_tenant_scoped on public.assignment_settings
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists lead_assignment_events_tenant_scoped on public.lead_assignment_events;
create policy lead_assignment_events_tenant_scoped on public.lead_assignment_events
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.assignment_rules, public.agent_capacity, public.assignment_settings, public.lead_assignment_events from anon, authenticated, public;
grant select, insert, update, delete on public.assignment_rules, public.agent_capacity, public.assignment_settings to tenant_app;
grant select on public.lead_assignment_events to tenant_app;
grant select, insert, update, delete on public.assignment_rules, public.agent_capacity, public.assignment_settings, public.lead_assignment_events to service_role;

create or replace function public.assignment_contact_key(p_values jsonb, p_lead_id uuid)
returns text
language sql
immutable
as $function$
  select left(coalesce(
    nullif(lower(btrim(p_values->>'household_id')), ''),
    nullif(regexp_replace(coalesce(p_values->>'phone', p_values->>'phone_number', ''), '[^0-9]', '', 'g'), ''),
    p_lead_id::text
  ), 200);
$function$;

create or replace function public.assignment_rule_matches(p_rule public.assignment_rules, p_lead public.agent_leads)
returns boolean
language plpgsql
immutable
as $function$
declare
  v_value text;
  v_values jsonb;
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
  return false;
end;
$function$;

-- Capacity is a cache for the UI, but assignment never trusts it. The row is locked and then
-- recomputed from the queue before a candidate wins, so disposition and manual queue changes cannot
-- create an over-capacity assignment.
create or replace function public.refresh_agent_capacity_for_user(p_tenant_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
begin
  insert into public.agent_capacity (tenant_id, user_id)
  values (p_tenant_id, p_user_id)
  on conflict (tenant_id, user_id) do nothing;
  update public.agent_capacity c
     set current_open = (
       select count(*)::integer from public.lead_queue q
        where q.tenant_id = p_tenant_id
          and q.owner_user_id = p_user_id
          and q.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active')
          and q.disposition is null
     ),
         updated_at = now()
   where c.tenant_id = p_tenant_id and c.user_id = p_user_id;
end;
$function$;

create or replace function public.refresh_assignment_capacity_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
begin
  if tg_op = 'DELETE' and old.owner_user_id is not null then
    perform public.refresh_agent_capacity_for_user(old.tenant_id, old.owner_user_id);
  end if;
  if tg_op <> 'DELETE' and new.owner_user_id is not null then
    perform public.refresh_agent_capacity_for_user(new.tenant_id, new.owner_user_id);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

drop trigger if exists lead_queue_refresh_assignment_capacity on public.lead_queue;
create trigger lead_queue_refresh_assignment_capacity
after insert or update of owner_user_id, status, disposition or delete on public.lead_queue
for each row execute function public.refresh_assignment_capacity_trigger();

-- An inactive account cannot retain work invisibly. This is both the automatic pool return and the
-- audit event; the next assignment call will then use the current rules and capacity.
create or replace function public.return_inactive_assignments()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_item record;
  v_contact_key text;
begin
  if new.status::text = 'active' then return new; end if;
  for v_item in
    select q.id, q.tenant_id, q.lead_id, q.owner_user_id, assignment_contact_key(l.values, l.id) as contact_key
      from public.lead_queue q
      join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
     where q.owner_user_id = new.id
       and q.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active')
       and q.disposition is null
     for update of q
  loop
    update public.lead_queue
       set status = 'unclaimed', claimed_by = null, owner_user_id = null, owner_role = null,
           claimed_at = null, locked_until = null, updated_at = now()
     where id = v_item.id and tenant_id = v_item.tenant_id;
    insert into public.lead_assignment_events (tenant_id, work_item_id, lead_id, contact_key, from_user_id, event_type, reason)
    values (v_item.tenant_id, v_item.id, v_item.lead_id, v_item.contact_key, new.id, 'auto_returned', 'Assignee became inactive');
    update public.active_calls set ended_at = coalesce(ended_at, now()), updated_at = now()
     where tenant_id = v_item.tenant_id and work_item_id = v_item.id and ended_at is null;
  end loop;
  return new;
end;
$function$;

drop trigger if exists users_return_inactive_assignments on public.users;
create trigger users_return_inactive_assignments
after update of status on public.users
for each row when (new.status::text <> 'active')
execute function public.return_inactive_assignments();

create or replace function public.assignment_candidate_is_eligible(
  p_tenant_id uuid,
  p_user_id uuid,
  p_role text,
  p_product text,
  p_state text,
  p_requires_licensed boolean
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
begin
  if p_role not in ('owner', 'producer', 'setter') then return false; end if;
  if p_requires_licensed and p_role = 'setter' then return false; end if;
  if p_role = 'setter' then return true; end if;
  if p_state is null or btrim(p_state) = '' then return false; end if;
  return exists (
    select 1
      from public.tenant_carriers tc
     where tc.tenant_id = p_tenant_id
       and tc.is_active
       and public.can_write(tc.carrier_id, p_state, current_date, p_user_id)
  );
end;
$function$;

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
begin
  select tu.role::text into v_actor_role
    from public.tenant_users tu join public.users u on u.id = tu.user_id
     where tu.tenant_id = p_tenant_id and tu.user_id = p_actor_user_id
       and tu.accepted_at is not null and u.status::text = 'active'
    limit 1;
  if not found then raise exception 'ASSIGNMENT_ACTOR_INVALID'; end if;

  -- Reconcile stale rows even if an external user-status mutation did not fire the trigger.
  update public.lead_queue q
     set status = 'unclaimed', claimed_by = null, owner_user_id = null, owner_role = null,
         claimed_at = null, locked_until = null, updated_at = now()
    from public.users u
   where q.tenant_id = p_tenant_id and q.owner_user_id = u.id
     and u.status::text <> 'active'
     and q.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active')
     and q.disposition is null;

  if p_work_item_id is null then
    select q.* into v_item
      from public.lead_queue q
     where q.tenant_id = p_tenant_id and q.status = 'unclaimed'
     order by q.tier nulls last, q.queued_at, q.id
     limit 1
     for update skip locked;
  else
    select q.* into v_item from public.lead_queue q
     where q.tenant_id = p_tenant_id and q.id = p_work_item_id for update;
  end if;
  if not found then raise exception 'ASSIGNMENT_WORK_ITEM_NOT_FOUND'; end if;
  select l.* into v_lead from public.agent_leads l where l.id = v_item.lead_id and l.tenant_id = p_tenant_id for update;
  if not found then raise exception 'ASSIGNMENT_LEAD_NOT_FOUND'; end if;

  v_state := upper(trim(coalesce(v_lead.values->>'state', v_lead.values->>'state_code', '')));
  v_product := lower(trim(coalesce(v_lead.product_line, v_lead.values->>'product_code', v_lead.values->>'product', '')));
  v_language := lower(trim(coalesce(v_lead.values->>'language', v_lead.values->>'preferred_language', v_lead.values->>'language_code', '')));
  v_contact_key := public.assignment_contact_key(v_lead.values, v_lead.id);
  select coalesce(s.rest_days, 0), s.last_assignee_id into v_rest_days, v_round_robin_last from public.assignment_settings s where s.tenant_id = p_tenant_id;
  v_rest_days := coalesce(v_rest_days, 0);

  -- A claimed, undispositioned row is the live conversation. Automated assignment never takes it
  -- away from its current owner. An explicit target is the deliberate manual reassignment path and
  -- requires a reason below.
  if v_item.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active') and v_item.owner_user_id is not null and v_item.disposition is null and p_target_user_id is null then
    return jsonb_build_object('work_item_id', v_item.id, 'lead_id', v_item.lead_id, 'owner_user_id', v_item.owner_user_id, 'owner_role', v_item.owner_role, 'sticky', true, 'reason', 'Active ownership is sticky until disposition');
  end if;
  if v_item.status not in ('unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active') then raise exception 'ASSIGNMENT_WORK_ITEM_CLOSED'; end if;
  if p_target_user_id is not null and p_target_user_id <> coalesce(v_item.owner_user_id, p_actor_user_id)
     and v_actor_role not in ('owner', 'producer') then
    raise exception 'ASSIGNMENT_MANAGER_REQUIRED';
  end if;
  if p_target_user_id is not null and v_item.owner_user_id is not null and p_target_user_id <> v_item.owner_user_id and v_event_reason is null then raise exception 'REASSIGNMENT_REASON_REQUIRED'; end if;

  -- First match wins. The rule row is locked with the tenant assignment operation, and the tie
  -- breaker on id makes equal priorities deterministic.
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
  v_round_robin_last := coalesce(v_selected_rule.last_assignee_id, v_round_robin_last);
  v_requires_licensed := v_product in ('term_life', 'term-life', 'term life')
    or (v_selected_rule.match_type = 'product' and case when jsonb_typeof(v_selected_rule.match_values->'licensed_only') = 'boolean' then (v_selected_rule.match_values->>'licensed_only')::boolean else false end);

  if p_target_user_id is not null then
    select tu.role::text into v_selected_role
      from public.tenant_users tu join public.users u on u.id = tu.user_id
     where tu.tenant_id = p_tenant_id and tu.user_id = p_target_user_id
       and tu.accepted_at is not null and u.status::text = 'active';
    if not found or not public.assignment_candidate_is_eligible(p_tenant_id, p_target_user_id, v_selected_role, v_product, v_state, v_requires_licensed) then raise exception 'ASSIGNMENT_TARGET_NOT_ELIGIBLE'; end if;
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
    -- Lock each capacity row before recounting it. The row itself is never trusted as the source of
    -- truth, which keeps concurrent assignments from crossing the configured maximum.
    for v_candidate in
      select tu.user_id, tu.role::text as role, c.max_open_leads,
             case when cardinality(v_selected_rule.assignee_ids) > 0 then array_position(v_selected_rule.assignee_ids, tu.user_id) else null end as configured_position
        from public.tenant_users tu
        join public.users u on u.id = tu.user_id and u.status::text = 'active'
        left join public.agent_capacity c on c.tenant_id = p_tenant_id and c.user_id = tu.user_id
       where tu.tenant_id = p_tenant_id and tu.accepted_at is not null
         and (cardinality(v_selected_rule.assignee_ids) = 0 or tu.user_id = any(v_selected_rule.assignee_ids))
       order by case
                  when cardinality(v_selected_rule.assignee_ids) > 0 and v_round_robin_last is not null
                    then case when array_position(v_selected_rule.assignee_ids, tu.user_id) > coalesce(array_position(v_selected_rule.assignee_ids, v_round_robin_last), 0) then 0 else 1 end
                  when cardinality(v_selected_rule.assignee_ids) = 0 and v_round_robin_last is not null
                    then case when tu.user_id > v_round_robin_last then 0 else 1 end
                  else 0
                end,
                case when cardinality(v_selected_rule.assignee_ids) > 0 then array_position(v_selected_rule.assignee_ids, tu.user_id) end nulls last,
                tu.user_id
    loop
      if not public.assignment_candidate_is_eligible(p_tenant_id, v_candidate.user_id, v_candidate.role, v_product, v_state, v_requires_licensed) then continue; end if;
      if v_rest_days > 0 and exists (
        select 1 from public.lead_assignment_events e
         where e.tenant_id = p_tenant_id and e.contact_key = v_contact_key
           and e.to_user_id is not null and e.to_user_id <> v_candidate.user_id
           and e.created_at > now() - make_interval(days => v_rest_days)
      ) then continue; end if;
      insert into public.agent_capacity (tenant_id, user_id) values (p_tenant_id, v_candidate.user_id) on conflict do nothing;
      select c.* into v_capacity from public.agent_capacity c where c.tenant_id = p_tenant_id and c.user_id = v_candidate.user_id for update;
      select count(*)::integer into v_open from public.lead_queue q
       where q.tenant_id = p_tenant_id and q.owner_user_id = v_candidate.user_id
         and q.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active') and q.disposition is null;
      update public.agent_capacity set current_open = v_open, updated_at = now() where tenant_id = p_tenant_id and user_id = v_candidate.user_id;
      if v_open >= v_capacity.max_open_leads then continue; end if;
      v_selected_user := v_candidate.user_id;
      v_selected_role := v_candidate.role;
      exit;
    end loop;
  end if;
  if v_selected_user is null then raise exception 'NO_ELIGIBLE_ASSIGNEE'; end if;

  v_from_user := v_item.owner_user_id;
  v_event_type := case when v_from_user is null then case when p_work_item_id is null then 'assigned' else 'pulled' end else 'reassigned' end;
  if v_from_user is not null and v_event_reason is null then v_event_reason := 'Manual reassignment'; end if;
  v_event_reason := coalesce(v_event_reason, 'Rule-based assignment');
  update public.lead_queue
     set status = 'claimed', claimed_by = v_selected_user, owner_user_id = v_selected_user,
         owner_role = v_selected_role, claimed_at = coalesce(claimed_at, now()), locked_until = null, updated_at = now()
   where id = v_item.id and tenant_id = p_tenant_id;
  insert into public.lead_assignment_events (tenant_id, work_item_id, lead_id, contact_key, from_user_id, to_user_id, event_type, reason, assigned_by)
  values (p_tenant_id, v_item.id, v_item.lead_id, v_contact_key, v_from_user, v_selected_user, v_event_type, v_event_reason, p_actor_user_id);
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
  return jsonb_build_object('work_item_id', v_item.id, 'lead_id', v_item.lead_id, 'owner_user_id', v_selected_user, 'owner_role', v_selected_role, 'rule_id', case when v_rule_found then v_selected_rule.id else null end, 'rule_match_type', v_selected_rule.match_type, 'sticky', false, 'reason', v_event_reason);
end;
$function$;

create or replace function public.return_lead_to_assignment_pool(
  p_tenant_id uuid,
  p_work_item_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare v_item public.lead_queue%rowtype; v_contact_key text; v_values jsonb;
  v_actor_role text;
begin
  if nullif(btrim(p_reason), '') is null then raise exception 'POOL_RETURN_REASON_REQUIRED'; end if;
  select tu.role::text into v_actor_role
    from public.tenant_users tu join public.users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor_user_id
     and tu.accepted_at is not null and u.status::text = 'active'
   limit 1;
  if not found then raise exception 'ASSIGNMENT_ACTOR_INVALID'; end if;
  select q.* into v_item from public.lead_queue q where q.id = p_work_item_id and q.tenant_id = p_tenant_id for update;
  if not found then raise exception 'ASSIGNMENT_WORK_ITEM_NOT_FOUND'; end if;
  select l.values into v_values from public.agent_leads l where l.id = v_item.lead_id and l.tenant_id = p_tenant_id;
  if v_item.status not in ('claimed', 'buffer_active', 'handed_pending', 'la_active') or v_item.owner_user_id is null then raise exception 'ASSIGNMENT_NOT_OWNED'; end if;
  if v_item.owner_user_id <> p_actor_user_id and v_actor_role not in ('owner', 'producer') then raise exception 'ASSIGNMENT_MANAGER_REQUIRED'; end if;
  v_contact_key := public.assignment_contact_key(v_values, v_item.lead_id);
  update public.lead_queue set status = 'unclaimed', claimed_by = null, owner_user_id = null, owner_role = null, claimed_at = null, locked_until = null, updated_at = now() where id = v_item.id and tenant_id = p_tenant_id;
  insert into public.lead_assignment_events (tenant_id, work_item_id, lead_id, contact_key, from_user_id, event_type, reason, assigned_by)
  values (p_tenant_id, v_item.id, v_item.lead_id, v_contact_key, v_item.owner_user_id, 'returned_to_pool', left(btrim(p_reason), 500), p_actor_user_id);
  return jsonb_build_object('work_item_id', v_item.id, 'lead_id', v_item.lead_id, 'returned_to_pool', true);
end;
$function$;

revoke all on function public.assignment_contact_key(jsonb, uuid), public.assignment_rule_matches(public.assignment_rules, public.agent_leads), public.refresh_agent_capacity_for_user(uuid, uuid), public.refresh_assignment_capacity_trigger(), public.return_inactive_assignments(), public.assignment_candidate_is_eligible(uuid, uuid, text, text, text, boolean), public.assign_lead(uuid, uuid, uuid, uuid, text), public.return_lead_to_assignment_pool(uuid, uuid, uuid, text) from public, anon, authenticated, tenant_app;
grant execute on function public.assign_lead(uuid, uuid, uuid, uuid, text), public.return_lead_to_assignment_pool(uuid, uuid, uuid, text) to service_role;

do $$
begin
  perform 1 from public.assignment_rules limit 1;
  perform 1 from public.agent_capacity limit 1;
  perform 1 from public.assignment_settings limit 1;
  perform 1 from public.lead_assignment_events limit 1;
  raise notice 'LA-2.24: assignment rules, capacity, licensing gate, sticky ownership and inactive return are in place';
end $$;
