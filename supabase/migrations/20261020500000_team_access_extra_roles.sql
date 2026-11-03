-- Custom team access (docs/team-access/DESIGN.md, owner-approved 2026-10-20) · phase 1: the foundation.
--
-- A member keeps ONE main role (tenant_users.role, unchanged) and, with the custom_team_access add-on, may hold extra
-- WORKING roles (producer, assistant, bookkeeper, setter, retention). What they may do is the union of their roles;
-- the owner can also hide pages for them (hidden_pages: menu keys; hiding only removes, it never grants).
--
-- Rules this file enforces in the database, whatever the app does:
--   · owner is never an extra role, and the owner/admin main role holds no extras (it already holds everything);
--   · an extra role is never the main role (a trigger keeps them apart when the main role changes);
--   · only tenant_set_member_access writes the two columns: the owner (or an agency admin) of that tenant, never for
--     themselves, never for the billing owner, and adding anything needs the add-on;
--   · without the add-on stored extras are dormant: tenant_member_roles reads them only while the tenant holds
--     custom_team_access, so switching the add-on off returns everyone to one role on the next request.
--
-- The role-checking database functions a combined member would hit read the member's roles through ONE helper,
-- tenant_member_acting_role(tenant, user, allowed): the main role when that is allowed, else the widest allowed extra
-- role, else the main role. Each gate gets a one-line patch and every line after it behaves exactly as for a member
-- who holds that one role. agency_visible_user_ids (AG-0.4) takes the union. Automatic routing pools, queue
-- ownership, seat limits and invitations still go by the MAIN role (the screen says so).
--
-- Rollback: drop function tenant_set_member_access, tenant_member_acting_role, tenant_member_has_role,
--   tenant_member_roles, tenant_custom_team_access, tenant_users_extra_roles_tidy (+ trigger); drop table
--   tenant_access_presets; alter table tenant_users drop column extra_roles, drop column hidden_pages; re-run the
--   previous definitions of the patched functions (pg_get_functiondef before this file); delete the feature and addon.

-- ─── 1. the two columns ──────────────────────────────────────────────────────────────────────────────
alter table public.tenant_users
  add column if not exists extra_roles text[] not null default '{}'::text[],
  add column if not exists hidden_pages text[] not null default '{}'::text[];

alter table public.tenant_users drop constraint if exists tenant_users_extra_roles_valid;
alter table public.tenant_users add constraint tenant_users_extra_roles_valid check (
  extra_roles <@ array['producer', 'assistant', 'bookkeeper', 'setter', 'retention']::text[]
  and not (role::text = any (extra_roles))
  and (role::text <> 'owner' or cardinality(extra_roles) = 0)
);
alter table public.tenant_users drop constraint if exists tenant_users_hidden_pages_valid;
alter table public.tenant_users add constraint tenant_users_hidden_pages_valid check (
  cardinality(hidden_pages) <= 200
  and array_to_string(hidden_pages, ',') ~ '^[a-z0-9_.-]*(,[a-z0-9_.-]+)*$'
);

-- Only tenant_set_member_access writes them: no column grant to service_role or authenticated (the table privilege
-- was already withdrawn by AG-0.2, so a column without a grant cannot be written by either).
revoke insert (extra_roles, hidden_pages), update (extra_roles, hidden_pages) on public.tenant_users from service_role, authenticated, anon;

-- A main-role change never leaves the new main role in the extras, and an owner holds none.
create or replace function public.tenant_users_extra_roles_tidy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role::text = 'owner' then
    new.extra_roles := '{}'::text[];
  elsif new.role::text = any (new.extra_roles) then
    new.extra_roles := array_remove(new.extra_roles, new.role::text);
  end if;
  return new;
end;
$$;
revoke all on function public.tenant_users_extra_roles_tidy() from public, anon, authenticated;
drop trigger if exists tenant_users_extra_roles_tidy on public.tenant_users;
create trigger tenant_users_extra_roles_tidy
  before insert or update of role, extra_roles on public.tenant_users
  for each row execute function public.tenant_users_extra_roles_tidy();

-- ─── 2. presets ──────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.tenant_access_presets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  main_role text not null check (main_role in ('admin', 'manager', 'producer', 'assistant', 'bookkeeper', 'setter', 'retention')),
  extra_roles text[] not null default '{}'::text[] check (extra_roles <@ array['producer', 'assistant', 'bookkeeper', 'setter', 'retention']::text[]),
  hidden_pages text[] not null default '{}'::text[] check (cardinality(hidden_pages) <= 200),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists tenant_access_presets_name_key on public.tenant_access_presets (tenant_id, lower(btrim(name)));
alter table public.tenant_access_presets enable row level security;
revoke all on public.tenant_access_presets from anon, authenticated;

-- ─── 3. the add-on ───────────────────────────────────────────────────────────────────────────────────
insert into public.features (feature_key, label, module, sort_order)
values ('custom_team_access', 'Custom team access', 'agency', 7)
on conflict (feature_key) do update set label = excluded.label, module = excluded.module, is_archived = false;

-- Sold through SA-2's add-on catalogue. The price is the owner's to set; until then it is inactive (not offered).
insert into public.addons (code, name, description, price_cents, billing_cycle, is_active, sort_order)
values ('custom_team_access', 'Custom team access',
        'Give a member more than one role, hide pages per member, and save the combinations as presets.', 0, 'monthly', false, 50)
on conflict (code) do nothing;
insert into public.addon_features (addon_id, feature_key)
select a.id, 'custom_team_access' from public.addons a
 where a.code = 'custom_team_access'
   and not exists (select 1 from public.addon_features af where af.addon_id = a.id and af.feature_key = 'custom_team_access');

-- ─── 4. helpers ──────────────────────────────────────────────────────────────────────────────────────
create or replace function public.tenant_custom_team_access(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (e.entitlement -> 'features') ? 'custom_team_access'
                     from public.tenant_entitlements e where e.tenant_id = p_tenant_id), false);
$$;

-- The member's roles, main role first. Extras count only while the tenant holds the add-on. Null: not a member.
create or replace function public.tenant_member_roles(p_tenant_id uuid, p_user_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select array[tu.role::text]
         || case when cardinality(tu.extra_roles) = 0 then array[]::text[]
                 when public.tenant_custom_team_access(tu.tenant_id) then tu.extra_roles
                 else array[]::text[] end
    from public.tenant_users tu
   where tu.tenant_id = p_tenant_id and tu.user_id = p_user_id;
$$;

create or replace function public.tenant_member_has_role(p_tenant_id uuid, p_user_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.tenant_member_roles(p_tenant_id, p_user_id) && p_roles, false);
$$;

-- The role a gate should treat this member as: the main role when the gate allows it; otherwise the widest extra
-- role the gate allows (producer, bookkeeper, retention, assistant, setter — in that order); otherwise the main role,
-- which the gate then refuses as before. Null: not a member. lib/tenantAuth/teamAccess.ts actingRole is the same rule.
create or replace function public.tenant_member_acting_role(p_tenant_id uuid, p_user_id uuid, p_allowed text[])
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when r.roles is null then null
           when r.roles[1] = any (p_allowed) then r.roles[1]
           else coalesce((select x from unnest(r.roles[2:]) x
                           where x = any (p_allowed)
                           order by array_position(array['producer', 'bookkeeper', 'retention', 'assistant', 'setter'], x)
                           limit 1), r.roles[1])
         end
    from (select public.tenant_member_roles(p_tenant_id, p_user_id) as roles) r;
$$;

revoke all on function public.tenant_custom_team_access(uuid) from public, anon, authenticated;
revoke all on function public.tenant_member_roles(uuid, uuid) from public, anon, authenticated;
revoke all on function public.tenant_member_has_role(uuid, uuid, text[]) from public, anon, authenticated;
revoke all on function public.tenant_member_acting_role(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.tenant_custom_team_access(uuid) to service_role;
grant execute on function public.tenant_member_roles(uuid, uuid) to service_role;
grant execute on function public.tenant_member_has_role(uuid, uuid, text[]) to service_role;
grant execute on function public.tenant_member_acting_role(uuid, uuid, text[]) to service_role;

-- ─── 5. the one writer ───────────────────────────────────────────────────────────────────────────────
create or replace function public.tenant_set_member_access(
  p_tenant_id uuid, p_actor uuid, p_user_id uuid, p_extra_roles text[], p_hidden_pages text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role text;
  v_role text;
  v_title text;
  v_before_extra text[];
  v_before_hidden text[];
  v_extra text[];
  v_hidden text[];
begin
  select tu.role::text into v_actor_role
    from public.tenant_users tu
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and tu.accepted_at is not null and tu.access_blocked_at is null;
  if v_actor_role is distinct from 'owner' then
    raise exception using errcode = '42501', message = 'TEAM_ACCESS_OWNER_ONLY';
  end if;
  if p_actor = p_user_id then
    raise exception using errcode = '42501', message = 'TEAM_ACCESS_NOT_SELF';
  end if;

  select tu.role::text, tu.agency_role, tu.extra_roles, tu.hidden_pages
    into v_role, v_title, v_before_extra, v_before_hidden
    from public.tenant_users tu
   where tu.tenant_id = p_tenant_id and tu.user_id = p_user_id
   for update;
  if v_role is null then
    raise exception using errcode = 'P0002', message = 'TEAM_ACCESS_NOT_A_MEMBER';
  end if;
  -- The billing owner's access is the plan's. Nobody sets it here (AG-0.2: billing stays the billing owner's).
  if v_role = 'owner' and v_title is null then
    raise exception using errcode = '42501', message = 'TEAM_ACCESS_BILLING_OWNER';
  end if;

  v_extra := array(select distinct btrim(x) from unnest(coalesce(p_extra_roles, '{}'::text[])) x where nullif(btrim(x), '') is not null order by 1);
  v_hidden := array(select distinct btrim(x) from unnest(coalesce(p_hidden_pages, '{}'::text[])) x where nullif(btrim(x), '') is not null order by 1);

  if (cardinality(v_extra) > 0 or cardinality(v_hidden) > 0) and not public.tenant_custom_team_access(p_tenant_id) then
    raise exception using errcode = '42501', message = 'TEAM_ACCESS_ADDON_REQUIRED';
  end if;
  if not (v_extra <@ array['producer', 'assistant', 'bookkeeper', 'setter', 'retention']::text[]) then
    raise exception using errcode = '22023', message = 'TEAM_ACCESS_ROLE_INVALID';
  end if;
  if v_role = 'owner' and cardinality(v_extra) > 0 then
    raise exception using errcode = '22023', message = 'TEAM_ACCESS_OWNER_HOLDS_EVERY_ROLE';
  end if;
  if v_role = any (v_extra) then
    raise exception using errcode = '22023', message = 'TEAM_ACCESS_ROLE_IS_MAIN';
  end if;
  if cardinality(v_hidden) > 200 or exists (select 1 from unnest(v_hidden) x where x !~ '^[a-z0-9_.-]+$') then
    raise exception using errcode = '22023', message = 'TEAM_ACCESS_PAGE_INVALID';
  end if;

  update public.tenant_users
     set extra_roles = v_extra, hidden_pages = v_hidden
   where tenant_id = p_tenant_id and user_id = p_user_id;

  return jsonb_build_object(
    'before', jsonb_build_object('extra_roles', to_jsonb(v_before_extra), 'hidden_pages', to_jsonb(v_before_hidden)),
    'after', jsonb_build_object('extra_roles', to_jsonb(v_extra), 'hidden_pages', to_jsonb(v_hidden))
  );
end;
$$;
revoke all on function public.tenant_set_member_access(uuid, uuid, uuid, text[], text[]) from public, anon, authenticated;
grant execute on function public.tenant_set_member_access(uuid, uuid, uuid, text[], text[]) to service_role;

-- ─── 6. the gates a combined member hits (generated from the live definitions; one patch line each) ────
-- accept_buffer_handoff(uuid,uuid,uuid,text,text)
CREATE OR REPLACE FUNCTION public.accept_buffer_handoff(p_tenant_id uuid, p_handoff_id uuid, p_licensed_agent_id uuid, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  handoff_row public.buffer_handoffs%rowtype;
  queue_row public.lead_queue%rowtype;
  session_row public.tenant_verification_sessions%rowtype;
  target_role text;
  call_count integer;
  v_language text;
begin
  perform public.expire_buffer_handoffs(p_tenant_id);
  select tu.role::text into target_role from public.tenant_users tu
  join public.users u on u.id = tu.user_id
  where tu.tenant_id = p_tenant_id and tu.user_id = p_licensed_agent_id
    and u.status = 'active';
  if target_role is not null then target_role := public.tenant_member_acting_role(p_tenant_id, p_licensed_agent_id, array['owner', 'producer']); end if;
  if target_role not in ('owner', 'producer') then raise exception using errcode = '42501', message = 'LICENSED_AGENT_REQUIRED'; end if;
  select * into handoff_row from public.buffer_handoffs where id = p_handoff_id and tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'HANDOFF_NOT_FOUND'; end if;
  if handoff_row.status <> 'pending' or handoff_row.licensed_agent_id <> p_licensed_agent_id then
    raise exception using errcode = '42501', message = 'HANDOFF_NOT_AVAILABLE';
  end if;
  if handoff_row.expires_at <= now() then raise exception using errcode = 'P0001', message = 'HANDOFF_EXPIRED'; end if;
  select * into queue_row from public.lead_queue where id = handoff_row.work_item_id and tenant_id = p_tenant_id for update;
  if queue_row.status <> 'handed_pending' or queue_row.owner_user_id <> handoff_row.buffer_user_id then
    raise exception using errcode = '42501', message = 'HANDOFF_NOT_AVAILABLE';
  end if;
  -- LA-1.14-10: as on the offer, the buffer who stays on the call covers the caller's language.
  select public.lead_language_key(l.values) into v_language from public.agent_leads l where l.id = queue_row.lead_id and l.tenant_id = p_tenant_id;
  if not public.agent_speaks_language(p_tenant_id, p_licensed_agent_id, v_language) and not public.agent_speaks_language(p_tenant_id, handoff_row.buffer_user_id, v_language) then
    raise exception using errcode = 'P0001', message = 'LANGUAGE_NOT_SPOKEN', detail = v_language;
  end if;
  select * into session_row from public.tenant_verification_sessions where work_item_id = queue_row.id and tenant_id = p_tenant_id and user_id = handoff_row.buffer_user_id and ended_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'VERIFICATION_SESSION_NOT_FOUND'; end if;
  update public.active_calls set user_id = p_licensed_agent_id, agent_role = target_role, updated_at = now()
  where work_item_id = queue_row.id and tenant_id = p_tenant_id and user_id = handoff_row.buffer_user_id and ended_at is null;
  get diagnostics call_count = row_count;
  if call_count <> 1 then raise exception using errcode = 'P0002', message = 'ACTIVE_CALL_NOT_FOUND'; end if;
  update public.tenant_verification_sessions set user_id = p_licensed_agent_id, agent_role = target_role, last_actor_id = p_licensed_agent_id, updated_at = now() where id = session_row.id;
  -- The buffer stays involved (buffer_user_id kept, buffer_ended_at clear) until they end it.
  update public.lead_queue set status = 'la_active', owner_user_id = p_licensed_agent_id, claimed_by = p_licensed_agent_id, owner_role = target_role, buffer_ended_at = null, updated_at = now() where id = queue_row.id;
  update public.buffer_handoffs set status = 'accepted', accepted_at = now(), updated_at = now() where id = handoff_row.id;
  update public.deal_flow set buffer_agent = handoff_row.buffer_user_id, updated_at = now() where tenant_id = p_tenant_id and lead_id = queue_row.lead_id and buffer_agent is null;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, ip, user_agent, metadata)
  values ('tenant', p_licensed_agent_id, 'tenant.buffer_handoff_accepted', 'buffer_handoff', handoff_row.id::text, p_ip, p_user_agent,
    jsonb_build_object('workItemId', queue_row.id, 'bufferUserId', handoff_row.buffer_user_id, 'progressPercentage', session_row.progress_percentage, 'language', v_language));
  return jsonb_build_object('handoff_id', handoff_row.id, 'work_item_id', queue_row.id, 'status', 'accepted', 'verification_session_id', session_row.id, 'progress_percentage', session_row.progress_percentage);
end;
$function$;

-- offer_buffer_handoff(uuid,uuid,uuid,uuid,integer,text,text)
CREATE OR REPLACE FUNCTION public.offer_buffer_handoff(p_tenant_id uuid, p_work_item_id uuid, p_buffer_user_id uuid, p_target_user_id uuid, p_timeout_seconds integer DEFAULT 30, p_ip text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare queue_row public.lead_queue%rowtype; existing_handoff public.buffer_handoffs%rowtype; new_handoff public.buffer_handoffs%rowtype; buffer_role text; target_role text; session_exists boolean; call_exists boolean; v_language text;
begin
  if p_timeout_seconds < 5 or p_timeout_seconds > 300 then raise exception using errcode = '22023', message = 'INVALID_HANDOFF_TIMEOUT'; end if;
  select tu.role::text into buffer_role from public.tenant_users tu join public.users u on u.id = tu.user_id where tu.tenant_id = p_tenant_id and tu.user_id = p_buffer_user_id and u.status = 'active';
  if buffer_role is not null then buffer_role := public.tenant_member_acting_role(p_tenant_id, p_buffer_user_id, array['assistant']); end if;
  if buffer_role <> 'assistant' then raise exception using errcode = '42501', message = 'BUFFER_ROLE_REQUIRED'; end if;
  select tu.role::text into target_role from public.tenant_users tu join public.users u on u.id = tu.user_id where tu.tenant_id = p_tenant_id and tu.user_id = p_target_user_id and u.status = 'active';
  if target_role is not null then target_role := public.tenant_member_acting_role(p_tenant_id, p_target_user_id, array['owner', 'producer']); end if;
  if target_role not in ('owner', 'producer') then raise exception using errcode = '42501', message = 'LICENSED_AGENT_REQUIRED'; end if;
  select * into queue_row from public.lead_queue where id = p_work_item_id and tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'WORK_ITEM_NOT_FOUND'; end if;
  if queue_row.status not in ('buffer_active', 'handed_pending') or queue_row.owner_user_id <> p_buffer_user_id then raise exception using errcode = '42501', message = 'BUFFER_OWNER_REQUIRED'; end if;
  select * into existing_handoff from public.buffer_handoffs where work_item_id = p_work_item_id and status = 'pending' for update;
  if found then
    if existing_handoff.licensed_agent_id <> p_target_user_id then raise exception using errcode = 'P0001', message = 'HANDOFF_PENDING'; end if;
    return jsonb_build_object('handoff_id', existing_handoff.id, 'status', existing_handoff.status, 'expires_at', existing_handoff.expires_at, 'idempotent', true);
  end if;
  if queue_row.status <> 'buffer_active' then raise exception using errcode = 'P0001', message = 'HANDOFF_PENDING'; end if;
  -- LA-1.14-10: the licensed agent speaks the caller's language, or the buffer on the call does.
  select public.lead_language_key(l.values) into v_language from public.agent_leads l where l.id = queue_row.lead_id and l.tenant_id = p_tenant_id;
  if not public.agent_speaks_language(p_tenant_id, p_target_user_id, v_language) and not public.agent_speaks_language(p_tenant_id, p_buffer_user_id, v_language) then
    raise exception using errcode = 'P0001', message = 'LANGUAGE_NOT_SPOKEN', detail = v_language;
  end if;
  select exists(select 1 from public.tenant_verification_sessions where work_item_id = p_work_item_id and tenant_id = p_tenant_id and user_id = p_buffer_user_id and ended_at is null) into session_exists;
  if not session_exists then raise exception using errcode = 'P0002', message = 'VERIFICATION_SESSION_NOT_FOUND'; end if;
  select exists(select 1 from public.active_calls where work_item_id = p_work_item_id and tenant_id = p_tenant_id and user_id = p_buffer_user_id and ended_at is null) into call_exists;
  if not call_exists then raise exception using errcode = 'P0002', message = 'ACTIVE_CALL_NOT_FOUND'; end if;
  insert into public.buffer_handoffs(tenant_id, work_item_id, buffer_user_id, licensed_agent_id, expires_at) values (p_tenant_id, p_work_item_id, p_buffer_user_id, p_target_user_id, now() + make_interval(secs => p_timeout_seconds)) returning * into new_handoff;
  update public.lead_queue set status = 'handed_pending', updated_at = now() where id = p_work_item_id;
  insert into public.audit_log(actor_type, actor_id, action, target_type, target_id, ip, user_agent, metadata) values ('tenant', p_buffer_user_id, 'tenant.buffer_handoff_offered', 'buffer_handoff', new_handoff.id::text, p_ip, p_user_agent, jsonb_build_object('workItemId', p_work_item_id, 'licensedAgentId', p_target_user_id, 'expiresAt', new_handoff.expires_at, 'language', v_language));
  return jsonb_build_object('handoff_id', new_handoff.id, 'status', new_handoff.status, 'expires_at', new_handoff.expires_at, 'idempotent', false);
end;
$function$;

-- agent_may_work_state(uuid,uuid,text)
CREATE OR REPLACE FUNCTION public.agent_may_work_state(p_tenant_id uuid, p_user_id uuid, p_state text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with member as (
    select tu.role::text as role, public.tenant_member_roles(tu.tenant_id, tu.user_id) as roles
      from public.tenant_users tu
     where tu.tenant_id = p_tenant_id and tu.user_id = p_user_id
  ), wanted as (
    select upper(btrim(coalesce(p_state, ''))) as state
  )
  select coalesce((
    select case
      when 'setter' = any (m.roles) then true
      when not (m.roles && array['owner', 'producer']) then false
      when w.state = '' then false
      else exists (
             select 1 from public.licenses l
              where l.tenant_id = p_tenant_id
                and upper(btrim(l.state)) = w.state
                and (l.expires_at is null or l.expires_at >= current_date)
           )
           and (
             not exists (select 1 from public.tenant_user_licensed_states s where s.tenant_id = p_tenant_id and s.user_id = p_user_id)
             or exists (select 1 from public.tenant_user_licensed_states s
                         where s.tenant_id = p_tenant_id and s.user_id = p_user_id and s.state = w.state
                           and (s.expires_on is null or s.expires_on >= current_date))
           )
    end
    from member m cross join wanted w
  ), false);
$function$;

-- assign_lead_core(uuid,uuid,uuid,uuid,text,uuid,boolean)
CREATE OR REPLACE FUNCTION public.assign_lead_core(p_tenant_id uuid, p_actor_user_id uuid, p_work_item_id uuid, p_target_user_id uuid, p_reason text, p_rotate_from_user_id uuid, p_system_route boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
    v_actor_role := public.tenant_member_acting_role(p_tenant_id, p_actor_user_id, array['owner', 'producer']);
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
    -- [711200] A suppressed number is never handed to anyone: the dialer would refuse it, and
    -- meanwhile it held a capacity slot. Skip-ahead passes over it; a named lead is refused.
    if coalesce((select sup.suppressed from public.is_phone_suppressed(p_tenant_id, v_lead.values->>'phone') sup limit 1), false) then
      if v_max_items > 1 then continue items; end if;
      raise exception 'ASSIGNMENT_NUMBER_SUPPRESSED';
    end if;
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
      v_requires_licensed := false  -- [201200] a setter takes any product, only a licensed-only rule asks for a licence
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
        v_requires_licensed := v_requires_licensed  -- [201200] no product is licence-only by itself
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
                    case when coalesce(v_rule.strategy, 'round_robin') = 'best_placement' then -public.producer_recent_placement_bps(p_tenant_id, tu.user_id) else 0 end, /* AG-0.10 */ case when v_least_loaded then coalesce(c.current_open, 0) else 0 end,
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

-- assignment_preview(uuid,uuid,integer)
CREATE OR REPLACE FUNCTION public.assignment_preview(p_tenant_id uuid, p_actor_user_id uuid, p_limit integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
  v_actor_role := public.tenant_member_acting_role(p_tenant_id, p_actor_user_id, array['owner', 'producer']);
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

-- lead_list_assignment_run(uuid,uuid,uuid,text,uuid[],text)
CREATE OR REPLACE FUNCTION public.lead_list_assignment_run(p_tenant_id uuid, p_actor_user_id uuid, p_campaign_id uuid, p_mode text, p_user_ids uuid[], p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
  v_actor_role := public.tenant_member_acting_role(p_tenant_id, p_actor_user_id, array['owner', 'producer']);
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
      elsif v_error = 'ASSIGNMENT_NUMBER_SUPPRESSED' then  -- [711200]
        v_short := 'Number is on a do-not-call list';
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
      elsif 'ASSIGNMENT_NUMBER_SUPPRESSED' = any(v_fail_codes) then  -- [711200]
        v_short := 'Number is on a do-not-call list';
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
                        false);  -- [201200] a setter takes any product, as the router does
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

-- publish_assignment_rules(uuid,uuid,jsonb)
CREATE OR REPLACE FUNCTION public.publish_assignment_rules(p_tenant_id uuid, p_actor_user_id uuid, p_rules jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
  v_actor_role := public.tenant_member_acting_role(p_tenant_id, p_actor_user_id, array['owner', 'producer']);
  if v_actor_role not in ('owner', 'producer') then raise exception 'ASSIGNMENT_MANAGER_REQUIRED'; end if;
  if jsonb_typeof(p_rules) <> 'array' then raise exception 'ASSIGNMENT_RULES_INVALID'; end if;

  perform 1 from public.assignment_rules r where r.tenant_id = p_tenant_id for update;

  for v_rule in
    select x.value from jsonb_array_elements(p_rules) with ordinality x(value, ord)
     order by (x.value->>'match_type' = 'fallback'), x.ord
  loop
    v_index := v_index + 1;
    v_strategy := coalesce(nullif(v_rule->>'strategy', ''), 'round_robin');
    if v_strategy not in ('round_robin', 'least_loaded', 'best_placement') then raise exception 'ASSIGNMENT_RULES_INVALID'; end if;
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

-- return_lead_to_assignment_pool(uuid,uuid,uuid,text)
CREATE OR REPLACE FUNCTION public.return_lead_to_assignment_pool(p_tenant_id uuid, p_work_item_id uuid, p_actor_user_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
  v_actor_role := public.tenant_member_acting_role(p_tenant_id, p_actor_user_id, array['owner', 'producer']);
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

-- callback_actor_may_manage(uuid,uuid,uuid)
CREATE OR REPLACE FUNCTION public.callback_actor_may_manage(p_tenant_id uuid, p_callback_id uuid, p_actor uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select exists (
    select 1
      from public.tenant_callbacks c
      join public.tenant_users tu on tu.tenant_id = c.tenant_id and tu.user_id = p_actor and tu.accepted_at is not null
     where c.id = p_callback_id and c.tenant_id = p_tenant_id
       and (public.tenant_member_has_role(tu.tenant_id, tu.user_id, array['owner', 'assistant']) or c.assigned_to = p_actor or c.created_by = p_actor)
  );
$function$;

-- enforce_callback_assignee_role()
CREATE OR REPLACE FUNCTION public.enforce_callback_assignee_role()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  if not exists (
    select 1
    from public.tenant_users tu
    join public.users u on u.id = tu.user_id
    where tu.tenant_id = new.tenant_id
      and tu.user_id = new.assigned_to
      and public.tenant_member_has_role(tu.tenant_id, tu.user_id, array['owner', 'producer', 'assistant'])
      and tu.accepted_at is not null
      and u.status = 'active'
  ) then
    raise exception 'CALLBACK_ASSIGNEE_ROLE_INVALID';
  end if;
  return new;
end;
$function$;

-- claim_transfer_lead(uuid,uuid,uuid,text)
CREATE OR REPLACE FUNCTION public.claim_transfer_lead(p_tenant_id uuid, p_work_item_id uuid, p_user_id uuid, p_owner_role text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  item public.lead_queue%rowtype;
  session_id uuid;
  call_id uuid;
  resolved_submission_id uuid;
  resolved_role text;
  claim_status text;
  violation_constraint text;
  v_language text;
  v_resumed boolean := false;
begin
  select tu.role::text into resolved_role from public.tenant_users tu join public.users u on u.id = tu.user_id where tu.tenant_id = p_tenant_id and tu.user_id = p_user_id and u.status = 'active';
  if resolved_role is not null then resolved_role := public.tenant_member_acting_role(p_tenant_id, p_user_id, array[p_owner_role]); end if;
  if resolved_role is null or resolved_role <> p_owner_role or resolved_role not in ('owner', 'producer', 'assistant') then raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED'; end if;
  select q.* into item from public.lead_queue q where q.id = p_work_item_id and q.tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'WORK_ITEM_NOT_FOUND'; end if;
  if item.status <> 'unclaimed' then raise exception using errcode = 'P0001', message = 'ALREADY_CLAIMED', detail = coalesce(item.owner_user_id::text, item.claimed_by::text, 'unknown'); end if;
  select l.submission_id, public.lead_language_key(l.values) into resolved_submission_id, v_language from public.agent_leads l where l.id = item.lead_id and l.tenant_id = p_tenant_id;
  -- LA-1.14-10: the caller asked for a language this member does not list.
  if not public.agent_speaks_language(p_tenant_id, p_user_id, v_language) then
    raise exception using errcode = 'P0001', message = 'LANGUAGE_NOT_SPOKEN', detail = v_language;
  end if;
  claim_status := case when resolved_role = 'assistant' then 'buffer_active' else 'claimed' end;
  update public.lead_queue
     set status = claim_status, owner_user_id = p_user_id, claimed_by = p_user_id, owner_role = resolved_role,
         buffer_user_id = case when resolved_role = 'assistant' then p_user_id else null end,
         buffer_ended_at = null, claimed_at = now()
   where id = item.id and tenant_id = p_tenant_id and status = 'unclaimed';
  -- Nobody is on an unclaimed transfer, so every call record still open on it is stale.
  update public.active_calls set ended_at = now(), updated_at = now()
   where work_item_id = item.id and tenant_id = p_tenant_id and ended_at is null;
  -- LA-1.11-6: a transfer that was given back resumes its last verification session.
  if item.requeued_at is not null then
    update public.tenant_verification_sessions s
       set status = 'open', ended_at = null, completed_at = null, user_id = p_user_id, agent_role = resolved_role,
           last_actor_id = p_user_id, updated_at = now()
     where s.id = (
             select s2.id from public.tenant_verification_sessions s2
              where s2.tenant_id = p_tenant_id and s2.work_item_id = item.id and s2.ended_at is not null
              order by s2.started_at desc, s2.created_at desc
              limit 1)
       and not exists (select 1 from public.tenant_verification_sessions s3 where s3.work_item_id = item.id and s3.ended_at is null)
    returning s.id into session_id;
    v_resumed := session_id is not null;
  end if;
  if session_id is null then
    insert into public.tenant_verification_sessions(tenant_id, work_item_id, lead_id, user_id, agent_role) values (p_tenant_id, item.id, item.lead_id, p_user_id, resolved_role)
      on conflict (work_item_id) where ended_at is null do update set user_id = excluded.user_id, agent_role = excluded.agent_role, status = 'open', ended_at = null, updated_at = now() returning id into session_id;
  end if;
  begin
    insert into public.active_calls(tenant_id, work_item_id, lead_id, submission_id, user_id, agent_role) values (p_tenant_id, item.id, item.lead_id, resolved_submission_id, p_user_id, resolved_role) returning id into call_id;
  exception when unique_violation then
    get stacked diagnostics violation_constraint = constraint_name;
    if violation_constraint <> 'active_calls_open_item_user_idx' then raise; end if;
    select id into call_id from public.active_calls where work_item_id = item.id and user_id = p_user_id and ended_at is null;
    if call_id is null then raise; end if;
  end;
  -- LA-1.13-2: the deal row names the buffer who took the call.
  if resolved_role = 'assistant' then
    update public.deal_flow set buffer_agent = p_user_id, updated_at = now() where tenant_id = p_tenant_id and lead_id = item.lead_id;
  end if;
  return jsonb_build_object('work_item_id', item.id, 'lead_id', item.lead_id, 'submission_id', resolved_submission_id, 'verification_session_id', session_id, 'active_call_id', call_id,
    'owner_user_id', p_user_id, 'owner_role', resolved_role, 'status', claim_status, 'claimed_at', (select claimed_at from public.lead_queue where id = item.id),
    'resumed_verification', v_resumed, 'requeue_count', coalesce(item.requeue_count, 0), 'language', v_language);
end;
$function$;

-- end_buffer_involvement(uuid,uuid,uuid,boolean)
CREATE OR REPLACE FUNCTION public.end_buffer_involvement(p_tenant_id uuid, p_work_item_id uuid, p_actor uuid, p_acknowledge_language boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  q public.lead_queue%rowtype;
  v_role text;
  v_language text;
  v_cover_ends boolean := false;
begin
  select tu.role::text into v_role from public.tenant_users tu join public.users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and u.status = 'active';
  if v_role is not null then v_role := public.tenant_member_acting_role(p_tenant_id, p_actor, array['owner', 'producer', 'assistant']); end if;
  if v_role is null or v_role not in ('owner', 'producer', 'assistant') then raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED'; end if;
  select * into q from public.lead_queue where id = p_work_item_id and tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'WORK_ITEM_NOT_FOUND'; end if;
  if q.buffer_user_id is null then raise exception using errcode = 'P0001', message = 'NO_BUFFER_INVOLVED'; end if;
  if q.buffer_ended_at is not null then
    return jsonb_build_object('work_item_id', q.id, 'buffer_user_id', q.buffer_user_id, 'buffer_ended_at', q.buffer_ended_at, 'duplicate', true);
  end if;
  if q.status in ('buffer_active', 'handed_pending') then raise exception using errcode = 'P0001', message = 'BUFFER_OWNS_CALL'; end if;
  if q.status not in ('claimed', 'la_active') then raise exception using errcode = 'P0001', message = 'CALL_ENDED'; end if;
  if v_role <> 'owner' and p_actor is distinct from q.buffer_user_id and p_actor is distinct from q.owner_user_id then
    raise exception using errcode = '42501', message = 'RELEASE_OWNER_REQUIRED';
  end if;
  if q.owner_user_id is not null then
    select public.lead_language_key(l.values) into v_language from public.agent_leads l where l.id = q.lead_id and l.tenant_id = p_tenant_id;
    v_cover_ends := not public.agent_speaks_language(p_tenant_id, q.owner_user_id, v_language);
    if v_cover_ends and not coalesce(p_acknowledge_language, false) then
      raise exception using errcode = 'P0001', message = 'LANGUAGE_COVER_REQUIRED', detail = v_language;
    end if;
  end if;
  update public.lead_queue set buffer_ended_at = now(), updated_at = now() where id = q.id and tenant_id = p_tenant_id;
  -- A call record the buffer still holds on this transfer ends with their involvement.
  update public.active_calls set ended_at = now(), updated_at = now()
   where work_item_id = q.id and tenant_id = p_tenant_id and user_id = q.buffer_user_id and ended_at is null;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_actor, 'tenant.buffer_involvement_ended', 'lead_queue', q.id::text,
    jsonb_build_object('leadId', q.lead_id, 'bufferUserId', q.buffer_user_id, 'licensedAgentId', q.owner_user_id, 'status', q.status,
      'language', v_language, 'languageCoverEnded', v_cover_ends));
  return jsonb_build_object('work_item_id', q.id, 'buffer_user_id', q.buffer_user_id, 'owner_user_id', q.owner_user_id, 'status', q.status,
    'buffer_ended_at', now(), 'language_cover_ended', v_cover_ends, 'duplicate', false);
end;
$function$;

-- return_transfer_to_queue(uuid,uuid,uuid,text)
CREATE OR REPLACE FUNCTION public.return_transfer_to_queue(p_tenant_id uuid, p_work_item_id uuid, p_actor uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  q public.lead_queue%rowtype;
  v_role text;
  v_flow public.tenant_disposition_flows%rowtype;
  v_session uuid;
begin
  if p_reason is null or p_reason not in ('unassign', 'requeue') then raise exception using errcode = '22023', message = 'INVALID_RELEASE_REASON'; end if;
  select tu.role::text into v_role from public.tenant_users tu join public.users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and u.status = 'active';
  if v_role is not null then v_role := public.tenant_member_acting_role(p_tenant_id, p_actor, array['owner', 'producer', 'assistant']); end if;
  if v_role is null or v_role not in ('owner', 'producer', 'assistant') then raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED'; end if;
  select * into q from public.lead_queue where id = p_work_item_id and tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'WORK_ITEM_NOT_FOUND'; end if;
  if q.partner_id is null then raise exception using errcode = 'P0001', message = 'NOT_A_TRANSFER'; end if;
  if q.status = 'unclaimed' then
    return jsonb_build_object('work_item_id', q.id, 'lead_id', q.lead_id, 'status', q.status, 'duplicate', true);
  end if;
  if p_reason = 'unassign' then
    if q.status = 'handed_pending' then raise exception using errcode = 'P0001', message = 'HANDOFF_PENDING'; end if;
    if q.status not in ('claimed', 'buffer_active', 'la_active') then raise exception using errcode = 'P0001', message = 'NOT_BEING_WORKED'; end if;
    if v_role <> 'owner' and q.owner_user_id is distinct from p_actor then raise exception using errcode = '42501', message = 'RELEASE_OWNER_REQUIRED'; end if;
  else
    if q.status <> 'dropped' then raise exception using errcode = 'P0001', message = 'NOT_DROPPED'; end if;
    if v_role <> 'owner' and q.owner_user_id is distinct from p_actor and q.disposition_by is distinct from p_actor then
      raise exception using errcode = '42501', message = 'RELEASE_OWNER_REQUIRED';
    end if;
  end if;

  update public.active_calls set ended_at = now(), updated_at = now()
   where work_item_id = q.id and tenant_id = p_tenant_id and ended_at is null;
  update public.tenant_verification_sessions
     set status = 'closed', ended_at = now(), updated_at = now(), last_actor_id = p_actor
   where work_item_id = q.id and tenant_id = p_tenant_id and ended_at is null
  returning id into v_session;

  if p_reason = 'requeue' then
    -- The drop was recorded. The next call gets its own outcome, walked from the stage it is in now.
    delete from public.disposition_walk_steps s using public.disposition_walks w
     where s.walk_id = w.id and w.tenant_id = p_tenant_id and w.work_item_id = q.id;
    select f.* into v_flow from public.tenant_disposition_flows f where f.tenant_id = p_tenant_id and f.stage_id = q.stage_id and f.is_active;
    if found then
      update public.disposition_walks
         set flow_id = v_flow.id, current_node_id = v_flow.root_node_id, status = 'open', completed_at = null,
             final_disposition_key = null, composed_note = null, updated_at = now()
       where tenant_id = p_tenant_id and work_item_id = q.id;
    else
      delete from public.disposition_walks where tenant_id = p_tenant_id and work_item_id = q.id;
    end if;
    -- The deal is being worked again, its call_result keeps the drop until the next outcome.
    update public.deal_flow set status = 'partial', updated_at = now()
     where tenant_id = p_tenant_id and lead_id = q.lead_id and status = 'dropped';
  end if;

  update public.lead_queue
     set status = 'unclaimed', owner_user_id = null, claimed_by = null, owner_role = null,
         buffer_user_id = null, buffer_ended_at = null, claimed_at = null, queued_at = now(),
         sla_warned_at = null, sla_escalated_at = null, sla_partner_notified_at = null, sla_expired_at = null,
         requeued_at = now(), requeue_count = coalesce(requeue_count, 0) + 1, sla_cycle = sla_cycle + 1, updated_at = now()
   where id = q.id and tenant_id = p_tenant_id;

  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_actor, case when p_reason = 'requeue' then 'tenant.transfer_requeued' else 'tenant.transfer_unassigned' end, 'lead_queue', q.id::text,
    jsonb_build_object('leadId', q.lead_id, 'previousStatus', q.status, 'previousOwnerId', q.owner_user_id, 'bufferUserId', q.buffer_user_id,
      'verificationSessionId', v_session, 'requeueCount', coalesce(q.requeue_count, 0) + 1));

  return jsonb_build_object('work_item_id', q.id, 'lead_id', q.lead_id, 'status', 'unclaimed', 'previous_status', q.status,
    'verification_session_id', v_session, 'requeue_count', coalesce(q.requeue_count, 0) + 1, 'duplicate', false);
end;
$function$;

-- reopen_expired_lead(uuid,uuid,uuid)
CREATE OR REPLACE FUNCTION public.reopen_expired_lead(p_tenant_id uuid, p_work_item_id uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare q public.lead_queue;
begin
  if not exists (select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id
    where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and tu.accepted_at is not null and u.status = 'active'
      and public.tenant_member_has_role(tu.tenant_id, tu.user_id, array['owner', 'producer', 'assistant'])) then raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED'; end if;
  select * into q from public.lead_queue where id = p_work_item_id and tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'WORK_ITEM_NOT_FOUND'; end if;
  if q.status = 'unclaimed' then return jsonb_build_object('id', q.id, 'status', q.status, 'duplicate', true); end if;
  if q.status <> 'expired' then raise exception using errcode = 'P0001', message = 'LEAD_NOT_EXPIRED'; end if;

  -- The nurture call that expiry queued (20260924230400). Being dialled now: refuse, so two agents
  -- never hold the same person. Still waiting: close it, and the lead is a transfer again.
  if exists (select 1 from public.lead_queue n
              where n.tenant_id = p_tenant_id and n.nurtured_from_work_item_id = q.id
                and n.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active')) then
    raise exception using errcode = 'P0001', message = 'LEAD_BEING_DIALLED';
  end if;
  update public.lead_queue n set status = 'closed', updated_at = now()
   where n.tenant_id = p_tenant_id and n.nurtured_from_work_item_id = q.id and n.status = 'unclaimed';
  update public.agent_leads l set lead_state = 'fresh', next_dial_after = null, next_preferred_slot = null, updated_at = now()
   where l.id = q.lead_id and l.tenant_id = p_tenant_id and l.lead_state = 'nurture';

  update public.lead_queue set status = 'unclaimed', queued_at = now(), sla_warned_at = null,
    sla_escalated_at = null, sla_partner_notified_at = null, sla_expired_at = null, sla_cycle = sla_cycle + 1, updated_at = now()
    where id = q.id returning * into q;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
    values ('tenant', p_actor, 'tenant.lead_sla_reopened', 'lead_queue', q.id::text, jsonb_build_object('leadId', q.lead_id));
  return jsonb_build_object('id', q.id, 'status', q.status, 'queued_at', q.queued_at, 'duplicate', false);
end;
$function$;

-- mark_appointment_outcome(uuid,uuid,uuid,text)
CREATE OR REPLACE FUNCTION public.mark_appointment_outcome(p_tenant_id uuid, p_appointment_id uuid, p_actor uuid, p_outcome text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
  a record;
begin
  -- [202000] 'confirmed' joins the walk, 'rescheduled' leaves it (reschedule_appointment books the
  -- new slot in the same statement).
  if p_outcome is null or p_outcome not in ('confirmed', 'showed', 'no_show', 'cancelled') then
    raise exception 'APPOINTMENT_OUTCOME_UNKNOWN';
  end if;

  select tu.role::text into v_role
    from tenant_users tu
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor;

  if v_role is null then
    raise exception 'ACTOR_NOT_A_MEMBER';
  end if;
  -- Custom team access: a setter who also holds another role records outcomes as that role.
  v_role := public.tenant_member_acting_role(p_tenant_id, p_actor, array['owner', 'producer', 'assistant', 'bookkeeper', 'retention']);

  select * into a from tenant_appointments t
   where t.id = p_appointment_id and t.tenant_id = p_tenant_id
   for update;
  if not found then
    raise exception 'APPOINTMENT_NOT_ACTIVE';
  end if;

  if p_outcome = 'confirmed' then
    -- [202000] Confirming is not a measurement, so a setter may confirm a booking of their own.
    if v_role = 'setter' and a.booked_by is distinct from p_actor then
      raise exception 'SETTER_MAY_NOT_RECORD_OUTCOMES';
    end if;
    if a.status = 'confirmed' then
      return;
    end if;
    if a.status <> 'booked' then
      raise exception 'APPOINTMENT_NOT_ACTIVE';
    end if;
    if a.starts_at_utc <= now() then
      raise exception 'APPOINTMENT_ALREADY_STARTED';
    end if;
  else
    -- Unchanged, and it is the reason the number means anything: the person being measured does
    -- not write the measurement.
    if v_role = 'setter' then
      raise exception 'SETTER_MAY_NOT_RECORD_OUTCOMES';
    end if;
    if a.status not in ('booked', 'confirmed', 'pending') then
      raise exception 'APPOINTMENT_NOT_ACTIVE';
    end if;
    -- [202000] Nobody has shown up, or failed to, for a call that has not happened yet.
    if p_outcome in ('showed', 'no_show') and a.starts_at_utc > now() then
      raise exception 'APPOINTMENT_NOT_YET_HELD';
    end if;
  end if;

  update tenant_appointments
     set status = p_outcome, updated_at = now()
   where id = a.id;
end;
$function$;

-- rebook_appointment(uuid,uuid,uuid,timestamp with time zone,uuid)
CREATE OR REPLACE FUNCTION public.rebook_appointment(p_tenant_id uuid, p_appointment_id uuid, p_actor uuid, p_starts_at_utc timestamp with time zone, p_agent_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(appointment_id uuid, starts_at_utc timestamp with time zone, duration_minutes integer, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a record;
  v_result record;
  v_role text;
begin
  select * into a from tenant_appointments t
   where t.id = p_appointment_id and t.tenant_id = p_tenant_id
   for update;
  if not found then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
  if a.status <> 'no_show' then raise exception 'APPOINTMENT_NOT_A_NO_SHOW'; end if;

  -- [202000] A setter rebooks their own no-shows, never a colleague's.
  select tu.role::text into v_role from tenant_users tu
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor;
  if v_role is not null then v_role := public.tenant_member_acting_role(p_tenant_id, p_actor, array['owner', 'producer', 'assistant', 'bookkeeper', 'retention']); end if;
  if v_role = 'setter' and a.booked_by is distinct from p_actor then
    raise exception 'APPOINTMENT_NOT_YOURS';
  end if;

  -- One live rebooking per no-show. A rebooking that was itself cancelled frees it again; one that
  -- was rescheduled is followed by its replacement, which carries the same `rebooked_from`.
  if exists (
    select 1 from tenant_appointments r
     where r.tenant_id = p_tenant_id and r.rebooked_from = a.id
       and r.status in ('booked', 'confirmed', 'pending', 'showed')
  ) then
    raise exception 'APPOINTMENT_ALREADY_REBOOKED';
  end if;

  -- Every booking rule, unchanged: the customer's window, hours, blocks, caps and the slot race.
  -- The actor is `booked_by`, and the duration is the agent's current policy, not the old slot's.
  select * into v_result from book_appointment(
    p_tenant_id, a.lead_id, coalesce(p_agent_user_id, a.agent_user_id), p_actor, p_starts_at_utc, a.notes, null);

  update tenant_appointments t set rebooked_from = a.id, updated_at = now()
   where t.id = v_result.appointment_id;

  return query select v_result.appointment_id, v_result.starts_at_utc, v_result.duration_minutes,
    ('Rebooked. ' || v_result.reason || ' The no-show stays on the record.')::text;
end;
$function$;

-- reschedule_appointment(uuid,uuid,uuid,timestamp with time zone)
CREATE OR REPLACE FUNCTION public.reschedule_appointment(p_tenant_id uuid, p_appointment_id uuid, p_actor uuid, p_starts_at_utc timestamp with time zone)
 RETURNS TABLE(appointment_id uuid, starts_at_utc timestamp with time zone, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a record;
  v_new uuid;
  v_result record;
  v_role text;
begin
  select * into a from tenant_appointments
   where id = p_appointment_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
  if a.status not in ('booked', 'confirmed') then raise exception 'APPOINTMENT_NOT_ACTIVE'; end if;

  -- [202000] A setter moves their own bookings, never a colleague's.
  select tu.role::text into v_role from tenant_users tu
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor;
  if v_role is not null then v_role := public.tenant_member_acting_role(p_tenant_id, p_actor, array['owner', 'producer', 'assistant', 'bookkeeper', 'retention']); end if;
  if v_role = 'setter' and a.booked_by is distinct from p_actor then
    raise exception 'APPOINTMENT_NOT_YOURS';
  end if;

  -- The old row leaves the constraint's scope FIRST, in the same transaction, so the new time may
  -- legitimately be the old one and a reschedule can never collide with itself. If the booking
  -- below fails, this rolls back with it and the original slot is still held.
  update tenant_appointments set status = 'rescheduled', updated_at = now() where id = a.id;

  select * into v_result from book_appointment(
    p_tenant_id, a.lead_id, a.agent_user_id, p_actor, p_starts_at_utc, a.notes, a.duration_minutes);
  v_new := v_result.appointment_id;

  -- [202000] The same booking, moved: credited to whoever booked it first, on the day they did,
  -- and linked to the row it replaces. [704200] A rebooking keeps its rebooked_from.
  update tenant_appointments
     set booked_by = coalesce(a.booked_by, booked_by),
         rescheduled_from = a.id,
         first_booked_at = coalesce(a.first_booked_at, a.created_at),
         rebooked_from = coalesce(a.rebooked_from, rebooked_from)
   where id = v_new;

  return query select v_new, p_starts_at_utc, 'Rescheduled; the previous slot is free.'::text;
end;
$function$;

-- start_application_from_lead(uuid,uuid,uuid,text)
CREATE OR REPLACE FUNCTION public.start_application_from_lead(p_tenant_id uuid, p_work_item_id uuid, p_agent_user_id uuid, p_product_line text DEFAULT NULL::text)
 RETURNS TABLE(verification_session_id uuid, application_case_id uuid, deal_id uuid, lead_id uuid, source text, resumed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_queue record;
  v_lead record;
  v_role text;
  v_session uuid;
  v_case uuid;
  v_deal uuid;
  v_source text;
  v_product text;
  v_resumed boolean := false;
  v_name text;
  v_phone text;
begin
  select q.* into v_queue
    from lead_queue q
   where q.id = p_work_item_id and q.tenant_id = p_tenant_id
   for update;
  if not found then
    raise exception 'WORK_ITEM_NOT_FOUND';
  end if;

  -- The agent must be holding this lead. An application started on somebody else's work item is
  -- the same defect as LA-2.12's cross-setter leak, arriving by a different door.
  if v_queue.owner_user_id is distinct from p_agent_user_id then
    raise exception 'APPLICATION_OWNER_REQUIRED';
  end if;
  if v_queue.status not in ('claimed', 'buffer_active', 'la_active') then
    raise exception 'APPLICATION_WORK_ITEM_NOT_CLAIMED';
  end if;

  select l.* into v_lead from agent_leads l
   where l.id = v_queue.lead_id and l.tenant_id = p_tenant_id;
  if not found then
    raise exception 'LEAD_NOT_FOUND';
  end if;

  -- A lead that arrived from a partner is an inbound one however it is being worked now. The
  -- source describes where the lead came from, not which screen opened it.
  v_source := case when v_queue.partner_id is not null then 'inbound' else 'outbound' end;

  -- "Product chosen at this point, and the field set follows it." The caller may name it; the
  -- lead's own product line is the default, and the field set follows from the lead either way.
  v_product := coalesce(nullif(btrim(coalesce(p_product_line, '')), ''), v_lead.product_line);
  if v_product is distinct from v_lead.product_line then
    update agent_leads set product_line = v_product, updated_at = now()
     where id = v_lead.id and tenant_id = p_tenant_id;
  end if;

  select tu.role::text into v_role
    from tenant_users tu where tu.tenant_id = p_tenant_id and tu.user_id = p_agent_user_id;
  if v_role is not null then v_role := public.tenant_member_acting_role(p_tenant_id, p_agent_user_id, array['owner', 'producer', 'assistant', 'bookkeeper', 'retention']); end if;
  v_role := coalesce(v_role, 'producer');

  -- An unlicensed setter may not take an application. LA-2.12's role table, enforced in the RPC
  -- rather than only at the route, for the same reason the calling-window check is.
  if v_role = 'setter' then
    raise exception 'SETTER_MAY_NOT_TAKE_APPLICATIONS';
  end if;

  v_resumed := exists (
    select 1 from tenant_verification_sessions s
     where s.tenant_id = p_tenant_id and s.work_item_id = p_work_item_id and s.ended_at is null
  );

  insert into tenant_verification_sessions (tenant_id, work_item_id, lead_id, user_id, agent_role)
  values (p_tenant_id, p_work_item_id, v_lead.id, p_agent_user_id, v_role)
  on conflict (work_item_id) where ended_at is null do update
    set user_id = excluded.user_id,
        agent_role = excluded.agent_role,
        status = 'open',
        ended_at = null,
        updated_at = now()
  returning id into v_session;

  -- The open case, reused if one is already open. The partial unique index is what makes the
  -- reuse correct under a race rather than merely likely.
  select c.id into v_case from tenant_application_cases c
   where c.tenant_id = p_tenant_id and c.lead_id = v_lead.id and c.status = 'open';
  if v_case is null then
    insert into tenant_application_cases
      (tenant_id, lead_id, work_item_id, product_line, source, opened_by)
    values (p_tenant_id, v_lead.id, p_work_item_id, v_product, v_source, p_agent_user_id)
    returning id into v_case;
  end if;

  -- The deal-flow row. Inbound already has one by now, written at submission time; outbound has
  -- never had one, because there was no submission. Upserting on lead_id means the inbound row is
  -- found rather than duplicated, and the outbound row is created here.
  v_name := coalesce(
    nullif(btrim(coalesce(v_lead.values->>'full_name', '')), ''),
    nullif(btrim(concat_ws(' ', v_lead.values->>'first_name', v_lead.values->>'last_name')), ''));
  v_phone := coalesce(v_lead.values->>'phone', v_lead.values->>'phone_number');

  select d.id into v_deal from deal_flow d
   where d.tenant_id = p_tenant_id and d.lead_id = v_lead.id;
  if v_deal is null then
    insert into deal_flow
      (tenant_id, lead_id, partner_id, product_line, pipeline_id, stage_id,
       insured_name, phone, source, worked_by, local_date)
    values
      (p_tenant_id, v_lead.id, v_queue.partner_id, v_product, v_queue.pipeline_id, v_queue.stage_id,
       v_name, v_phone, v_source, p_agent_user_id,
       deal_local_date(p_tenant_id, p_agent_user_id, v_lead.values))
    returning id into v_deal;
  else
    update deal_flow set worked_by = coalesce(worked_by, p_agent_user_id), updated_at = now()
     where id = v_deal;
  end if;

  return query select v_session, v_case, v_deal, v_lead.id, v_source, v_resumed;
end;
$function$;

-- reactivate_nurture(uuid,uuid,uuid,text,text,integer)
CREATE OR REPLACE FUNCTION public.reactivate_nurture(p_tenant_id uuid, p_campaign_id uuid, p_actor uuid, p_angle text, p_script text, p_attempt_ceiling integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_role text;
  v_wait integer;
  v_allowed text[];
  v_max integer;
  v_batch uuid;
  v_queued integer := 0;
  v_recent integer := 0;
  v_said_no integer := 0;
begin
  select tu.role into v_role
    from tenant_users tu join users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor
     and tu.accepted_at is not null and u.status = 'active'
   limit 1;
  if v_role is not null then v_role := public.tenant_member_acting_role(p_tenant_id, p_actor, array['owner', 'producer']); end if;
  if coalesce(v_role, '') not in ('owner', 'producer') then
    raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED';
  end if;
  if not exists (select 1 from tenant_campaigns where id = p_campaign_id and tenant_id = p_tenant_id) then
    raise exception using errcode = 'P0002', message = 'CAMPAIGN_NOT_FOUND';
  end if;
  if p_angle is null or char_length(btrim(p_angle)) < 3 or char_length(btrim(p_angle)) > 500 then
    raise exception using errcode = '22023', message = 'RECYCLE_ANGLE_REQUIRED';
  end if;
  if p_script is not null and char_length(p_script) > 5000 then
    raise exception using errcode = '22023', message = 'RECYCLE_SCRIPT_TOO_LONG';
  end if;
  if p_attempt_ceiling is null or p_attempt_ceiling < 1 or p_attempt_ceiling > 7 then
    raise exception using errcode = '22023', message = 'RECYCLE_CEILING_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('recycle_batch:' || p_campaign_id::text, 0));
  if exists (select 1 from tenant_recycle_batches b
              where b.tenant_id = p_tenant_id and b.campaign_id = p_campaign_id and b.status = 'screening') then
    raise exception using errcode = 'P0001', message = 'RECYCLE_BATCH_OPEN';
  end if;

  select r.wait_days, r.allowed_dispositions, r.max_recycles into v_wait, v_allowed, v_max
    from tenant_campaign_recycle_rules r
   where r.tenant_id = p_tenant_id and r.campaign_id = p_campaign_id;
  v_wait := coalesce(v_wait, 180);
  v_allowed := coalesce(v_allowed, array['no_answer', 'voicemail']::text[]);
  v_max := coalesce(v_max, 3);
  if v_max = 0 then
    raise exception using errcode = 'P0001', message = 'RECYCLE_CAP_ZERO';
  end if;

  insert into tenant_recycle_batches
    (tenant_id, campaign_id, angle, script, attempt_ceiling, wait_days, allowed_dispositions, max_recycles, cost_cents, created_by)
  values
    (p_tenant_id, p_campaign_id, btrim(p_angle), nullif(btrim(coalesce(p_script, '')), ''), p_attempt_ceiling, v_wait, v_allowed, v_max, 0, p_actor)
  returning id into v_batch;

  -- One pending reactivation per lead; no lead changes until its own screening clears. The
  -- recycle number is the lead's next, counting every earlier try (a failed screening included),
  -- so (lead_id, recycle_number) stays unique when a held lead is tried again.
  with pick as materialized (
    select c.lead_id, c.verdict, c.last_disposition
      from recycle_lead_candidates(p_tenant_id, p_campaign_id, p_actor) c
     where c.verdict in ('eligible', 'too_recent')
  ), ins as (
    insert into tenant_nurture_reactivations (tenant_id, lead_id, campaign_id, recycle_number, reason, batch_id)
    select p_tenant_id, pk.lead_id, p_campaign_id,
           coalesce((select max(nr.recycle_number) from tenant_nurture_reactivations nr where nr.lead_id = pk.lead_id), 0) + 1,
           'Waiting for a fresh suppression screening',
           v_batch
      from pick pk
     where pk.verdict = 'eligible'
    returning 1
  )
  select (select count(*) from ins),
         (select count(*) from pick where verdict = 'too_recent'),
         (select count(*) from pick where verdict = 'eligible' and last_disposition = 'not_interested')
    into v_queued, v_recent, v_said_no;

  if v_queued = 0 then
    -- Rolls the batch row back with it.
    raise exception using errcode = 'P0001', message = 'RECYCLE_NOTHING_ELIGIBLE';
  end if;

  update tenant_recycle_batches
     set queued = v_queued, excluded_too_recent = v_recent, said_no = v_said_no, last_progress_at = now()
   where id = v_batch;

  insert into audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_actor, 'tenant.recycle_batch_started', 'recycle_batch', v_batch::text,
          jsonb_build_object('tenantId', p_tenant_id, 'campaignId', p_campaign_id, 'queued', v_queued,
                             'excludedTooRecent', v_recent, 'saidNo', v_said_no,
                             'attemptCeiling', p_attempt_ceiling, 'angle', btrim(p_angle)));

  return jsonb_build_object('batch_id', v_batch, 'campaign_id', p_campaign_id, 'queued', v_queued,
                            'excluded_too_recent', v_recent, 'said_no', v_said_no,
                            'attempt_ceiling', p_attempt_ceiling);
end;
$function$;

-- recycle_batch_claim_chunk(uuid,uuid,uuid,integer)
CREATE OR REPLACE FUNCTION public.recycle_batch_claim_chunk(p_tenant_id uuid, p_batch_id uuid, p_actor uuid, p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_batch tenant_recycle_batches%rowtype;
  v_role text;
  v_stalled boolean;
  v_items jsonb;
  v_pending integer;
begin
  select * into v_batch from tenant_recycle_batches where id = p_batch_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'RECYCLE_BATCH_NOT_FOUND';
  end if;
  if v_batch.status <> 'screening' then
    return jsonb_build_object('done', true, 'items', '[]'::jsonb, 'pending', 0);
  end if;

  select tu.role into v_role
    from tenant_users tu join users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor
     and tu.accepted_at is not null and u.status = 'active'
   limit 1;
  if v_role is not null then v_role := public.tenant_member_acting_role(p_tenant_id, p_actor, array['owner', 'producer']); end if;
  if coalesce(v_role, '') not in ('owner', 'producer') then
    raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED';
  end if;
  -- The person who started a batch drives it. Anyone else may pick it up only when it has made no
  -- progress for 15 minutes, and only an owner.
  v_stalled := v_batch.last_progress_at < now() - interval '15 minutes';
  if p_actor is distinct from v_batch.created_by then
    if v_role <> 'owner' then
      raise exception using errcode = '42501', message = 'RECYCLE_BATCH_NOT_YOURS';
    end if;
    if not v_stalled then
      raise exception using errcode = 'P0001', message = 'RECYCLE_BATCH_RUNNING';
    end if;
  end if;

  with picked as (
    select nr.id
      from tenant_nurture_reactivations nr
     where nr.tenant_id = p_tenant_id and nr.batch_id = p_batch_id and nr.status = 'pending'
       and (nr.leased_until is null or nr.leased_until < now())
     order by nr.reactivated_at, nr.id
     limit greatest(1, least(coalesce(p_limit, 25), 100))
     for update skip locked
  ), leased as (
    update tenant_nurture_reactivations nr
       set leased_until = now() + interval '5 minutes'
      from picked
     where nr.id = picked.id
    returning nr.id, nr.lead_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'reactivation_id', le.id,
           'lead_id', le.lead_id,
           'phone', coalesce(l.values->>'phone', l.values->>'phone_number'))), '[]'::jsonb)
    into v_items
    from leased le
    join agent_leads l on l.id = le.lead_id and l.tenant_id = p_tenant_id;

  select count(*) into v_pending
    from tenant_nurture_reactivations nr
   where nr.tenant_id = p_tenant_id and nr.batch_id = p_batch_id and nr.status = 'pending';

  return jsonb_build_object('done', false, 'items', v_items, 'pending', v_pending, 'stalled', v_stalled);
end;
$function$;

-- agency_visible_user_ids(uuid,uuid,date)
CREATE OR REPLACE FUNCTION public.agency_visible_user_ids(p_tenant_id uuid, p_user_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_role text;
  v_title text;
  v_me uuid;
  v_out uuid[];
  v_roles text[];
begin
  if p_tenant_id is null then return array[]::uuid[]; end if;
  -- The plan comes first: an individual-plan tenant is never filtered, whoever asks — including a session that set
  -- no app.user_id, and the many tenants with no owner row. Only inside an agency does an unknown caller see nothing.
  if coalesce(public.tenant_plan_audience(p_tenant_id), '') <> 'agency' then return null; end if;
  if p_user_id is null then return array[]::uuid[]; end if;

  select tu.role::text, tu.agency_role into v_role, v_title
    from public.tenant_users tu where tu.tenant_id = p_tenant_id and tu.user_id = p_user_id;
  if v_role is null then return array[]::uuid[]; end if; -- not a member: nothing

  -- Custom team access: a member holding several roles sees the UNION of what each role sees — everything when any
  -- of them sees everything. One role (every member without the add-on) takes the unchanged path below.
  v_roles := public.tenant_member_roles(p_tenant_id, p_user_id);
  if cardinality(v_roles) > 1 then
    if v_roles && array['owner', 'bookkeeper', 'retention'] then return null; end if;
    v_out := array[]::uuid[];
    if exists (select 1 from unnest(v_roles) r where r <> 'assistant') then v_out := array[p_user_id]; end if;
    if v_roles && array['assistant', 'setter'] then
      v_out := v_out || coalesce((select array_agg(ap.producer_user_id) from public.assistant_producer ap
                                   where ap.tenant_id = p_tenant_id and ap.assistant_user_id = p_user_id), array[]::uuid[]);
    end if;
    if v_title = 'manager' then
      select p.id into v_me from public.producer p where p.tenant_id = p_tenant_id and p.user_id = p_user_id;
      v_out := v_out || coalesce((select array_agg(r.user_id) from public.producer r
                                   where v_me is not null and r.id in (select public.producer_direct_reports(p_tenant_id, v_me, p_as_of))), array[]::uuid[]);
    end if;
    return array(select distinct x from unnest(v_out) x order by x);
  end if;

  if v_role in ('owner', 'bookkeeper', 'retention') then return null; end if; -- owner covers admin
  if v_role = 'assistant' then
    select coalesce(array_agg(ap.producer_user_id order by ap.producer_user_id), array[]::uuid[]) into v_out
      from public.assistant_producer ap where ap.tenant_id = p_tenant_id and ap.assistant_user_id = p_user_id;
    return v_out;
  end if;
  if v_role = 'setter' then
    -- Himself (his own dials and bookings) and the producers he books for.
    select array[p_user_id] || coalesce(array_agg(ap.producer_user_id order by ap.producer_user_id), array[]::uuid[]) into v_out
      from public.assistant_producer ap where ap.tenant_id = p_tenant_id and ap.assistant_user_id = p_user_id;
    return v_out;
  end if;
  if v_title = 'manager' then
    select p.id into v_me from public.producer p where p.tenant_id = p_tenant_id and p.user_id = p_user_id;
    select array[p_user_id] || coalesce(array_agg(r.user_id order by r.user_id), array[]::uuid[]) into v_out
      from public.producer r
     where v_me is not null and r.id in (select public.producer_direct_reports(p_tenant_id, v_me, p_as_of));
    return v_out;
  end if;
  return array[p_user_id]; -- producer, and any role this list does not name: himself only
end;
$function$;

-- ─── 7. self-check ───────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_fn text;
begin
  if exists (select 1 from public.tenant_users where cardinality(extra_roles) > 0 or cardinality(hidden_pages) > 0) then
    raise exception 'team access: a member holds extra roles or hidden pages before any was granted';
  end if;
  foreach v_fn in array array[
    'accept_buffer_handoff', 'offer_buffer_handoff', 'assign_lead_core', 'assignment_preview', 'lead_list_assignment_run',
    'publish_assignment_rules', 'return_lead_to_assignment_pool', 'claim_transfer_lead', 'end_buffer_involvement',
    'return_transfer_to_queue', 'rebook_appointment', 'reschedule_appointment', 'mark_appointment_outcome',
    'start_application_from_lead', 'reactivate_nurture', 'recycle_batch_claim_chunk'] loop
    if not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_fn
                    and p.prosrc like '%tenant_member_acting_role%') then
      raise exception 'team access: % was not patched', v_fn;
    end if;
  end loop;
  foreach v_fn in array array['agent_may_work_state', 'agency_visible_user_ids'] loop
    if not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_fn
                    and p.prosrc like '%tenant_member_roles%') then
      raise exception 'team access: % was not patched', v_fn;
    end if;
  end loop;
  foreach v_fn in array array['callback_actor_may_manage', 'enforce_callback_assignee_role', 'reopen_expired_lead'] loop
    if not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_fn
                    and p.prosrc like '%tenant_member_has_role%') then
      raise exception 'team access: % was not patched', v_fn;
    end if;
  end loop;
  -- One role, unchanged: with no extras the acting role is the main role whatever the gate allows.
  if exists (
    select 1 from public.tenant_users tu
     where public.tenant_member_acting_role(tu.tenant_id, tu.user_id, array['producer']) is distinct from tu.role::text
     limit 1
  ) then
    raise exception 'team access: a single-role member does not act as their own role';
  end if;
  if has_column_privilege('service_role', 'public.tenant_users', 'extra_roles', 'UPDATE')
     or has_column_privilege('authenticated', 'public.tenant_users', 'hidden_pages', 'UPDATE') then
    raise exception 'team access: the access columns are writable outside tenant_set_member_access';
  end if;
end;
$$;
