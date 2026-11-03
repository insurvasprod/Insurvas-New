-- ---------------------------------------------------------------------------
-- Lead lists · why the pool leads of one list are not being served
--
-- Pool concept audit (LA-2 §6, 2026-09-25). A lead in the pool (lead_queue.status = 'unclaimed',
-- nobody owning it) is not waiting to be "released": Serve next hands it to any agent who passes
-- the gates. What the lead-list page could not say is which gate is holding the rest. The assign
-- drawer's preview answered it for assignment (licence, capacity, no state) — not for serving, and
-- only while the drawer is open.
--
-- lead_list_pool_blockers(tenant, campaign) answers it for serving, with the gates serve_next_lead
-- applies (20260925700000, restated from 20260924323000), in this order — each lead is counted once,
-- under the first gate it fails:
--
--   campaign        the list is not in campaigns_servable (not active, or not scrubbed)
--   exhausted       lead_state = 'exhausted'
--   suppressed      is_phone_suppressed says so (a number suppressed after import)
--   no_state        no two-letter state, or a state with no timezone: no legal calling window
--   no_agent        no active member may work the state (agent_may_work_state)
--   rules_stale     the calling-window rules feed is stale, so tenant_can_dial_now refuses all
--   outside_window  the state's window is shut now; next_at is when it next opens
--   at_capacity     everyone who may work the state is at their open-lead ceiling
--                   (agent_can_take_pool_lead, 20260925700000 — only when that helper exists)
--   waiting         fresh/retry/nurture whose next_dial_after is still in the future
--   unscheduled     retry/nurture with no next_dial_after: no tier ever reaches it
--   lead_state      any other lead_state (detail carries it)
--   ready           none of the above: Serve next can hand it out now
--
-- Grouped by state FIRST: the state-level answers (timezone, who may work it, the window and when
-- it opens) are computed once per distinct state, then every lead is classified against them. The
-- per-lead checks are only the ones that are properties of the lead (state, suppression, cadence).
--
-- The retry tier's slot rule (a retry waits for a part of the day it has not been tried in) is an
-- ordering detail of serve_next_lead and is not modelled: a due retry is counted as ready.
--
-- The next opening is found by asking tenant_can_dial_now itself, in 15-minute steps for up to
-- eight days, then minute by minute back to the edge — so it honours every layer (state rules,
-- holidays, the agency's hours, the campaign's hours) exactly as the dial does, and cannot drift
-- from it. Not asked when the rules feed is stale, because then the answer is "never" by design.
--
-- Read-only (STABLE). Service role only, like the other lead-list reads (lib/leadLists/detail.ts
-- reads through the service client after the page's own guard). Additive: a new function.
-- ---------------------------------------------------------------------------

create or replace function public.lead_list_pool_blockers(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_now timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_campaign record;
  v_servable boolean;
  v_stale boolean;
  v_has_capacity boolean := to_regprocedure('public.agent_can_take_pool_lead(uuid, uuid)') is not null;
  v_row record;
  v_states text[] := '{}'::text[];
  v_zones text[] := '{}'::text[];
  v_kinds text[] := '{}'::text[];
  v_next timestamptz[] := '{}'::timestamptz[];
  v_kind text;
  v_zone text;
  v_at timestamptz;
  v_found boolean;
  v_room boolean;
  v_step integer;
  v_groups jsonb;
  v_total integer;
begin
  if p_tenant_id is null or p_campaign_id is null then
    return null;
  end if;

  select c.id, c.status, c.scrub_status
    into v_campaign
    from public.tenant_campaigns c
   where c.id = p_campaign_id and c.tenant_id = p_tenant_id;
  if not found then
    return null;
  end if;

  v_servable := exists (
    select 1 from public.campaigns_servable cs
     where cs.id = p_campaign_id and cs.tenant_id = p_tenant_id
  );
  v_stale := public.calling_window_rules_stale(now());

  -- ── once per state ──────────────────────────────────────────────────────
  for v_row in
    select distinct upper(btrim(coalesce(l.values->>'state', ''))) as st
      from public.lead_queue q
      join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
     where q.tenant_id = p_tenant_id
       and l.campaign_id = p_campaign_id
       and q.status = 'unclaimed'
       and q.owner_user_id is null
  loop
    v_zone := null;
    v_at := null;

    if v_row.st !~ '^[A-Z]{2}$' then
      v_kind := 'no_state';
    else
      select tz.timezone into v_zone from public.state_timezones tz where tz.state = v_row.st;
      if v_zone is null then
        v_kind := 'no_state';
      elsif not exists (
        select 1
          from public.tenant_users tu
          join public.users u on u.id = tu.user_id and u.status::text = 'active'
         where tu.tenant_id = p_tenant_id
           and public.agent_may_work_state(p_tenant_id, tu.user_id, v_row.st)
      ) then
        v_kind := 'no_agent';
      elsif v_stale then
        v_kind := 'rules_stale';
      elsif not public.tenant_can_dial_now(p_tenant_id, v_row.st, p_campaign_id, v_now) then
        v_kind := 'outside_window';
        -- When it next opens: 15-minute steps for eight days, then back to the minute it opened.
        v_at := date_trunc('minute', v_now);
        v_found := false;
        for v_step in 1..768 loop
          v_at := v_at + interval '15 minutes';
          if public.tenant_can_dial_now(p_tenant_id, v_row.st, p_campaign_id, v_at) then
            v_found := true;
            exit;
          end if;
        end loop;
        if v_found then
          for v_step in 1..14 loop
            exit when not public.tenant_can_dial_now(p_tenant_id, v_row.st, p_campaign_id, v_at - interval '1 minute');
            v_at := v_at - interval '1 minute';
          end loop;
        else
          v_at := null;
        end if;
      else
        -- Open now. Serve next still refuses an agent at the ceiling a POOL lead (20260925700000),
        -- so the state is only open if somebody who may work it has room. Dynamic, because the
        -- helper belongs to another migration that may not be applied yet.
        v_room := true;
        if v_has_capacity then
          execute 'select exists (
                     select 1
                       from public.tenant_users tu
                       join public.users u on u.id = tu.user_id and u.status::text = ''active''
                      where tu.tenant_id = $1
                        and public.agent_may_work_state($1, tu.user_id, $2)
                        and public.agent_can_take_pool_lead($1, tu.user_id))'
             into v_room
            using p_tenant_id, v_row.st;
        end if;
        v_kind := case when coalesce(v_room, true) then 'open' else 'at_capacity' end;
      end if;
    end if;

    v_states := v_states || v_row.st;
    v_zones := v_zones || v_zone;
    v_kinds := v_kinds || v_kind;
    v_next := v_next || v_at;
  end loop;

  -- ── every lead, against its state ───────────────────────────────────────
  with pool as (
    select upper(btrim(coalesce(l.values->>'state', ''))) as st,
           l.values->>'phone' as phone,
           coalesce(l.lead_state, '') as lead_state,
           l.next_dial_after
      from public.lead_queue q
      join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
     where q.tenant_id = p_tenant_id
       and l.campaign_id = p_campaign_id
       and q.status = 'unclaimed'
       and q.owner_user_id is null
  ), facts as (
    select f.st, f.zone, f.kind, f.next_at
      from unnest(v_states, v_zones, v_kinds, v_next) as f(st, zone, kind, next_at)
  ), classified as (
    select p.st, f.zone, f.next_at as opens_at, p.lead_state, p.next_dial_after,
           case
             when not v_servable then 'campaign'
             when p.lead_state = 'exhausted' then 'exhausted'
             when (select s.suppressed from public.is_phone_suppressed(p_tenant_id, p.phone) s) then 'suppressed'
             when f.kind <> 'open' then f.kind
             when p.lead_state in ('retry', 'nurture') and p.next_dial_after is null then 'unscheduled'
             when p.lead_state in ('fresh', 'retry', 'nurture') and p.next_dial_after > v_now then 'waiting'
             when p.lead_state not in ('fresh', 'retry', 'nurture') then 'lead_state'
             else 'ready'
           end as blocker
      from pool p
      join facts f on f.st = p.st
  ), grouped as (
    select c.blocker,
           nullif(c.st, '') as state,
           case when c.blocker = 'lead_state' then nullif(c.lead_state, '') end as detail,
           count(*)::integer as n,
           case
             when c.blocker = 'outside_window' then min(c.opens_at)
             when c.blocker = 'waiting' then min(c.next_dial_after)
           end as next_at,
           min(c.zone) as zone
      from classified c
     group by 1, 2, 3
  )
  select coalesce(jsonb_agg(jsonb_build_object(
             'blocker', g.blocker, 'state', g.state, 'detail', g.detail, 'count', g.n,
             'next_at', g.next_at, 'zone', g.zone)
           order by g.blocker, g.n desc, g.state), '[]'::jsonb),
         coalesce(sum(g.n), 0)::integer
    into v_groups, v_total
    from grouped g;

  return jsonb_build_object(
    'total', v_total,
    'campaign', jsonb_build_object('servable', v_servable, 'status', v_campaign.status, 'scrub_status', v_campaign.scrub_status),
    'rules_stale', v_stale,
    'capacity_checked', v_has_capacity,
    'checked_at', v_now,
    'groups', v_groups
  );
end;
$function$;

revoke all on function public.lead_list_pool_blockers(uuid, uuid, timestamptz) from public, anon, authenticated, tenant_app;
grant execute on function public.lead_list_pool_blockers(uuid, uuid, timestamptz) to service_role;

-- ── proof ──────────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925703000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if to_regprocedure('public.lead_list_pool_blockers(uuid, uuid, timestamptz)') is null then
    raise exception '20260925703000: lead_list_pool_blockers was not created';
  end if;
  if has_function_privilege('anon', 'public.lead_list_pool_blockers(uuid, uuid, timestamptz)', 'execute')
     or has_function_privilege('tenant_app', 'public.lead_list_pool_blockers(uuid, uuid, timestamptz)', 'execute') then
    raise exception '20260925703000: lead_list_pool_blockers must be service-role only';
  end if;

  -- A list that is not this tenant's is not found, not an empty pool.
  if public.lead_list_pool_blockers('00000000-0000-0000-0000-000000000000'::uuid, gen_random_uuid()) is not null then
    raise exception '20260925703000: an unknown list must return null';
  end if;

  -- The gates are the ones serve_next_lead applies.
  select pg_get_functiondef('public.lead_list_pool_blockers(uuid, uuid, timestamptz)'::regprocedure) into v_def;
  if strpos(v_def, 'campaigns_servable') = 0 or strpos(v_def, 'is_phone_suppressed(p_tenant_id') = 0
     or strpos(v_def, 'tenant_can_dial_now(p_tenant_id') = 0 or strpos(v_def, 'agent_may_work_state(p_tenant_id') = 0 then
    raise exception '20260925703000: lead_list_pool_blockers is missing one of serving''s gates';
  end if;
end $$;
