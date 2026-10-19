-- Agency Module 0 · pending on 2026-10-19: ONE file, as one transaction.
-- Everything before it (20261018100000 … 20261018260000) is live and verified.
-- Setters book for their assigned producers; agency pools closed to narrowed sessions in SQL; the
-- "missing) missing" reason reworded. Rehearsed rolled back. Paste the whole file and run it once.

begin;

-- ======================================================================
-- 20261019100000_ag_followups_setters_pool_wording.sql
-- ======================================================================
-- Agency Module 0 · follow-ups after the AG-0.5 live check (2026-10-19). Three changes, one file.
--
-- 1. SETTERS IN AN AGENCY (owner's decision 2026-10-19: "assigned producers"). The AG-0.2 matrix names seven roles
--    and not the LA-2.12 setter, so agency_visible_user_ids gave a setter himself only — and a setter's whole job
--    is booking onto a producer's calendar. A setter now sees himself plus the producers the owner assigned him
--    to, through the same assistant_producer link an assistant uses (its assistant_user_id holds the setter).
--    Money stays shut by the permission matrix (a setter holds no commission or money permission).
--
-- 2. POOL CLAIMS. serve_next_lead, serve_lead_by_id and dialer_queue_preview all ask agent_can_take_pool_lead
--    before handing an agent a POOL lead (a lead already assigned to the agent never asks). In an agency the
--    unassigned pool is the owner's to route (AG-0.10), so the gate now answers false for any narrowed session.
--    The app already kept agency producers out of the pool; this makes the database agree.
--
-- 3. WORDING. A checklist item whose label already counts what is missing ("Writing number per carrier
--    (8 missing)") was stored as "… (8 missing) missing". It now reads "Writing number per carrier missing for
--    8 carriers", and every working producer's reason is recomputed.
--
-- Requires 20261018100000 … 20261018260000 (live 2026-10-19).
--
-- Rollback: re-run the agency_visible_user_ids body from 20261018130000, the agent_can_take_pool_lead body
--   below without its first branch, and the producer_refresh_can_submit body from 20261018240000.

-- ─── 1. the predicate, with the setter branch ─────────────────────────────────────────────────────
create or replace function public.agency_visible_user_ids(p_tenant_id uuid, p_user_id uuid, p_as_of date default current_date)
returns uuid[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_title text;
  v_me uuid;
  v_out uuid[];
begin
  if p_tenant_id is null then return array[]::uuid[]; end if;
  -- The plan comes first: an individual-plan tenant is never filtered, whoever asks — including a session that set
  -- no app.user_id, and the many tenants with no owner row. Only inside an agency does an unknown caller see nothing.
  if coalesce(public.tenant_plan_audience(p_tenant_id), '') <> 'agency' then return null; end if;
  if p_user_id is null then return array[]::uuid[]; end if;

  select tu.role::text, tu.agency_role into v_role, v_title
    from public.tenant_users tu where tu.tenant_id = p_tenant_id and tu.user_id = p_user_id;
  if v_role is null then return array[]::uuid[]; end if; -- not a member: nothing

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
$$;
revoke all on function public.agency_visible_user_ids(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.agency_visible_user_ids(uuid, uuid, date) to service_role, tenant_app;

comment on table public.assistant_producer is
  'Who works for which producer: an assistant (sees what his producer sees, no money) or, in an agency, a setter (books for his producers). assistant_user_id holds either.';

-- ─── 2. the pool gate ─────────────────────────────────────────────────────────────────────────────
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
    else coalesce((select l.max_open_leads is null or l.open_leads < l.max_open_leads
                     from public.agent_open_lead_load(p_tenant_id, p_user_id) l), true)
  end;
$$;

-- ─── 3. the reason's wording ──────────────────────────────────────────────────────────────────────
create or replace function public.producer_refresh_can_submit(p_tenant_id uuid, p_producer_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_missing text;
  v_ok boolean;
begin
  select status into v_status from public.producer where tenant_id = p_tenant_id and id = p_producer_id for update;
  if v_status is null then return false; end if;
  select c.detail into v_missing from public.producer_checklist(p_tenant_id, p_producer_id) c where not c.done order by c.seq limit 1;
  v_ok := v_missing is null and v_status in ('onboarding', 'active');
  update public.producer
     set can_submit = v_ok,
         can_submit_reason = case
           when v_status in ('suspended', 'offboarded') then initcap(v_status)
           -- "Writing number per carrier (8 missing)" → "Writing number per carrier missing for 8 carriers"
           when v_missing ~ ' \(\d+ missing\)$' then regexp_replace(v_missing, ' \((\d+) missing\)$', ' missing for \1 carriers')
           when v_missing is not null then v_missing || ' missing'
           else null end,
         can_submit_checked_at = now(),
         status = case when v_status = 'onboarding' and v_missing is null then 'active' else v_status end,
         updated_at = now()
   where tenant_id = p_tenant_id and id = p_producer_id;
  return v_ok;
end;
$$;

select public.producer_refresh_can_submit_all();

-- ─── self-check ───────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if pg_get_functiondef('public.agency_visible_user_ids(uuid,uuid,date)'::regprocedure) not like '%v_role = ''setter''%' then
    raise exception 'AG follow-up: the setter branch is missing';
  end if;
  if pg_get_functiondef('public.agent_can_take_pool_lead(uuid,uuid)'::regprocedure) not like '%agency_visible_user_ids%' then
    raise exception 'AG follow-up: the pool gate does not ask the agency scope';
  end if;
  if exists (select 1 from public.producer where can_submit_reason like '%missing) missing%') then
    raise exception 'AG follow-up: a reason still reads "missing) missing"';
  end if;
  -- A solo tenant's pool is untouched: the gate falls through to the open-lead ceiling.
  if exists (select 1 from public.tenants t
              where public.tenant_plan_audience(t.id) = 'individual'
                and public.agency_visible_user_ids(t.id, null) is not null
              limit 1) then
    raise exception 'AG follow-up: the predicate filters an individual-plan tenant';
  end if;
end;
$$;

commit;
