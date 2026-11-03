-- Performance pass (2026-10-20) · the Lead lists screen counts its lists in SQL.
--
-- lib/leadLists/service.ts leadListsReport read EVERY lead that belongs to a list (agent_leads with a
-- campaign, its work item embedded) in 1,000-row pages, only to count them per list: received, assigned,
-- untouched, the lead-state mix, the US-state mix (for "off territory") and the last touch. On the demo
-- tenant that is 16 pages and ~3.7 s before the screen draws; the counts are a few dozen rows.
--
--   lead_list_inventory(tenant): one row per list (campaign) with those counts — the same rules as the
--   code it replaces:
--     received        every lead with that campaign_id
--     assigned        its lead_queue row (unique on lead_id, same tenant) has an owner
--     untouched       no owner AND lead_state = 'fresh'
--     by_lead_state   lead_state, '' or null counted as 'unknown'
--     by_us_state     upper(trim(values->>'state')), empty left out (the app applies the licensed set)
--     last_touched_at max(updated_at)
-- The app keeps its old read as the fallback while this is not applied (PGRST202 / 42883).
-- Tenant comes from the session in the app; execute to service_role only, as the other report functions.
--
-- Rollback: drop function public.lead_list_inventory(uuid);

begin;

create or replace function public.lead_list_inventory(p_tenant_id uuid)
returns table (
  campaign_id uuid,
  received integer,
  assigned integer,
  untouched integer,
  last_touched_at timestamptz,
  by_lead_state jsonb,
  by_us_state jsonb
)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  with l as (
    select a.campaign_id,
           coalesce(nullif(a.lead_state, ''), 'unknown') as lead_state,
           a.updated_at,
           upper(btrim(coalesce(a.values ->> 'state', ''), E' \t\r\n')) as us_state,
           q.owner_user_id
      from public.agent_leads a
      left join public.lead_queue q on q.lead_id = a.id and q.tenant_id = a.tenant_id
     where a.tenant_id = p_tenant_id
       and a.campaign_id is not null
  ),
  per_list as (
    select l.campaign_id,
           count(*)::integer as received,
           count(*) filter (where l.owner_user_id is not null)::integer as assigned,
           count(*) filter (where l.owner_user_id is null and l.lead_state = 'fresh')::integer as untouched,
           max(l.updated_at) as last_touched_at
      from l
     group by l.campaign_id
  ),
  per_state as (
    select s.campaign_id, jsonb_object_agg(s.lead_state, s.n) as by_lead_state
      from (select l.campaign_id, l.lead_state, count(*)::integer as n from l group by l.campaign_id, l.lead_state) s
     group by s.campaign_id
  ),
  per_us as (
    select u.campaign_id, jsonb_object_agg(u.us_state, u.n) as by_us_state
      from (select l.campaign_id, l.us_state, count(*)::integer as n from l where l.us_state <> '' group by l.campaign_id, l.us_state) u
     group by u.campaign_id
  )
  select p.campaign_id, p.received, p.assigned, p.untouched, p.last_touched_at,
         coalesce(s.by_lead_state, '{}'::jsonb) as by_lead_state, coalesce(u.by_us_state, '{}'::jsonb) as by_us_state
    from per_list p
    left join per_state s on s.campaign_id = p.campaign_id
    left join per_us u on u.campaign_id = p.campaign_id;
$$;

revoke all on function public.lead_list_inventory(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.lead_list_inventory(uuid) to service_role;

-- ─── self-check ───────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_fn_received bigint;
  v_rows bigint;
begin
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'lead_list_inventory') <> 1 then
    raise exception 'perf: lead_list_inventory must have exactly one signature';
  end if;
  -- The counts add up to the leads they count, for the tenant holding the most list leads.
  select a.tenant_id into v_tenant from public.agent_leads a where a.campaign_id is not null
   group by a.tenant_id order by count(*) desc limit 1;
  if v_tenant is not null then
    select coalesce(sum(i.received), 0) into v_fn_received from public.lead_list_inventory(v_tenant) i;
    select count(*) into v_rows from public.agent_leads a where a.tenant_id = v_tenant and a.campaign_id is not null;
    if v_fn_received <> v_rows then
      raise exception 'perf: lead_list_inventory counted % leads, the table holds %', v_fn_received, v_rows;
    end if;
    if exists (select 1 from public.lead_list_inventory(v_tenant) i
                where i.assigned + i.untouched > i.received
                   or (select coalesce(sum(value::integer), 0) from jsonb_each_text(i.by_lead_state)) <> i.received) then
      raise exception 'perf: lead_list_inventory counts do not add up';
    end if;
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
