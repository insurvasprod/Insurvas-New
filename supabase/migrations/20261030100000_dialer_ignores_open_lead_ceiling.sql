-- Dialer · the open-lead ceiling no longer empties the dialer (owner 2026-10-30: "no matter if it is
-- past the limit of how many leads, always show the leads in the dialer").
--
-- Supersedes the user decision of 2026-09-25 (20260925700000): an agent at agent_capacity.max_open_leads
-- was not served, picked or shown POOL leads, so a busy agent saw "No lead on your screen" and an empty
-- queue. serve_next_lead, serve_lead_by_id, dialer_queue_preview and the Scoring preview all ask
-- agent_can_take_pool_lead before a pool lead; that gate now answers true whatever the count.
--
-- Unchanged:
--   - AG-0.10: inside an agency a narrowed session (producer, manager, assistant, setter) still takes only
--     what is assigned to it; the unassigned pool stays the owner's to route.
--   - The ceiling itself (agent_capacity.max_open_leads, agent_open_lead_load) stays, and the assignment
--     router (assign_lead_core) still counts against it when it routes leads to agents.
--
-- No table changes. Rollback: re-run the agent_can_take_pool_lead body from 20261019100000.

create or replace function public.agent_can_take_pool_lead(p_tenant_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    -- AG-0.10: inside an agency the unassigned pool is the owner's to route; a narrowed session takes only what
    -- is assigned to it (serve functions never ask this for a lead already the agent's).
    when coalesce(public.tenant_plan_audience(p_tenant_id), '') = 'agency'
         and public.agency_visible_user_ids(p_tenant_id, p_user_id) is not null then false
    -- Everyone else is served from the pool whatever their open-lead count (owner 2026-10-30).
    else true
  end;
$$;

-- ─── self-check ───────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if pg_get_functiondef('public.agent_can_take_pool_lead(uuid,uuid)'::regprocedure) not like '%agency_visible_user_ids%' then
    raise exception 'dialer ceiling: the pool gate lost its agency scope';
  end if;
  if pg_get_functiondef('public.agent_can_take_pool_lead(uuid,uuid)'::regprocedure) like '%max_open_leads%' then
    raise exception 'dialer ceiling: the pool gate still reads the open-lead ceiling';
  end if;
end $$;
