-- Agency Module 0 · AG-0.5 performance follow-up (2026-10-19) · the contact directory pages a scope in SQL.
--
-- A contact has no producer column: it is visible to a narrowed agency session when one of its leads is, and a
-- lead is the producer's who owns its lead_queue row (lead_queue.lead_id is unique), or — with no queue row —
-- its creator's (agent_leads.created_by). That is lib/agentTemplates/service.ts visibleLeadIds, decision D1.
-- contact_directory_page could not be told which contacts to keep, so lib/contacts/service.ts walked every lead
-- of the scope in code (lead_queue pages, then agent_leads and contacts by id in chunks), searched names and the
-- primary phone only — narrower than the function's search — and paged, counted and totalled there.
--
--   1. agency_scope_contact_leads(tenant, scope): the visible leads that point at a contact, the D1 rule in one
--      inlinable SQL function, tenant first on every table.
--   2. contact_directory_page gains p_scope uuid[] (last, default null). Null = the whole directory: the live
--      body with one `p_scope is null or …` arm and a `case when p_scope is null` around the old lead count, and
--      the app never sends the argument for a null scope. An array = the contacts in (1), searched by the
--      function's FULL search, with each lead count over the visible leads only.
--   3. contact_scope_totals(tenant, scope): the workspace's contact + household tiles over the same set.
--   4. contact_scope_ids(tenant, scope): the visible active contact ids, sorted, for the CSV export — one read.
-- Scope always comes from scopeFor(session) in the app, never from a request parameter. A null or empty scope
-- passed to (1), (3) or (4) sees nothing: the unscoped paths are contact_directory_page / contact_duplicate_stats.
--
-- The old contact_directory_page signature is DROPPED, not overloaded (PGRST203 on ambiguous candidates).
-- Body: the live pg_get_functiondef (read 2026-10-19), changed only at the [AG scoped] lines.
-- Grants as live: execute to service_role only.
--
-- Rollback: drop function public.contact_scope_ids(uuid, uuid[]); drop function public.contact_scope_totals(uuid, uuid[]);
--   drop function public.contact_directory_page(uuid, text, text, text, integer, integer, uuid[]);
--   re-run contact_directory_page from 20260924326100; drop function public.agency_scope_contact_leads(uuid, uuid[]);

begin;

-- ─── 1. the visible leads of a scope that point at a contact ──────────────────────────────────────
-- Plain LANGUAGE sql, no SECURITY DEFINER, no SET: the planner inlines it into each caller.
create or replace function public.agency_scope_contact_leads(p_tenant_id uuid, p_scope uuid[])
returns table (lead_id uuid, contact_id uuid)
language sql
stable
as $$
  select l.id, l.contact_id
    from public.agent_leads l
    left join public.lead_queue q on q.lead_id = l.id and q.tenant_id = l.tenant_id
   where l.tenant_id = p_tenant_id
     and l.contact_id is not null
     and (q.owner_user_id = any (p_scope) or (q.id is null and l.created_by = any (p_scope)))
$$;
revoke all on function public.agency_scope_contact_leads(uuid, uuid[]) from public, anon, authenticated, tenant_app;
grant execute on function public.agency_scope_contact_leads(uuid, uuid[]) to service_role;

-- ─── 2. the directory, with p_scope ───────────────────────────────────────────────────────────────
drop function if exists public.contact_directory_page(uuid, text, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.contact_directory_page(p_tenant_id uuid, p_query text DEFAULT NULL::text, p_name_query text DEFAULT NULL::text, p_digits text DEFAULT NULL::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0, p_scope uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(contact_id uuid, first_name text, last_name text, dob date, primary_phone text, state text, custom_fields jsonb, household_id uuid, address_line1 text, city text, household_state text, postal_code text, created_at timestamp with time zone, lead_count bigint, open_review boolean, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
-- [AG scoped] p_scope (scopeFor): the contacts a narrowed session may see, each with how many of its VISIBLE
-- leads point at it. Only read when p_scope is set; null = the whole directory, as before.
with scoped as (
  select v.contact_id, count(*) as lead_count
  from public.agency_scope_contact_leads(p_tenant_id, p_scope) v
  group by v.contact_id
), matched as (
  select c.id, c.first_name, c.last_name, c.dob, c.primary_phone, c.state, c.custom_fields,
         c.household_id, h.address_line1, h.city, h.state as household_state, h.postal_code, c.created_at
  from public.contacts c
  left join public.households h
    on h.id = c.household_id
   and h.tenant_id = p_tenant_id
  where c.tenant_id = p_tenant_id
    and c.merged_into_id is null
    and (p_scope is null or c.id in (select s.contact_id from scoped s))
    and (
      nullif(p_query, '') is null
      or (nullif(p_name_query, '') is not null and c.name_search like '%' || p_name_query || '%')
      or (nullif(p_digits, '') is not null and (
            c.primary_phone like '%' || p_digits || '%'
            or exists (
              select 1 from public.contact_phones cp
              where cp.tenant_id = p_tenant_id and cp.contact_id = c.id and cp.phone like '%' || p_digits || '%'
            )))
      or exists (
        select 1 from public.contact_emails e
        where e.tenant_id = p_tenant_id and e.contact_id = c.id and e.email ilike '%' || p_query || '%'
      )
      or h.city ilike '%' || p_query || '%'
      or h.address_line1 ilike '%' || p_query || '%'
      or h.postal_code ilike p_query || '%'
      or c.state = upper(p_query)
      or c.custom_fields::text ilike '%' || p_query || '%'
    )
), page as (
  select m.*, count(*) over () as total_count
  from matched m
  order by m.created_at desc, m.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0)
)
select
  p.id, p.first_name, p.last_name, p.dob, p.primary_phone, p.state, p.custom_fields,
  p.household_id, p.address_line1, p.city, p.household_state, p.postal_code, p.created_at,
  case when p_scope is null then (
    with recursive absorbed(id) as (
      select p.id
      union all
      select c2.id from public.contacts c2 join absorbed a on c2.merged_into_id = a.id
      where c2.tenant_id = p_tenant_id
    )
    select count(*) from public.agent_leads l
    where l.tenant_id = p_tenant_id and l.contact_id in (select id from absorbed)
  ) else (select s.lead_count from scoped s where s.contact_id = p.id) end as lead_count,
  exists (
    select 1 from public.contact_duplicate_reviews r
    where r.tenant_id = p_tenant_id and r.status = 'pending'
      and (r.contact_id = p.id or r.candidate_id = p.id)
  ) as open_review,
  p.total_count
from page p
order by p.created_at desc, p.id desc;
$function$;

revoke all on function public.contact_directory_page(uuid, text, text, text, integer, integer, uuid[]) from public, anon, authenticated, tenant_app;
grant execute on function public.contact_directory_page(uuid, text, text, text, integer, integer, uuid[]) to service_role;

-- ─── 3. the workspace tiles over a scope ──────────────────────────────────────────────────────────
create or replace function public.contact_scope_totals(p_tenant_id uuid, p_scope uuid[])
returns table (contacts bigint, households bigint)
language sql
stable
set search_path = public
as $$
  select count(*), count(distinct c.household_id)
    from public.contacts c
   where c.tenant_id = p_tenant_id
     and c.merged_into_id is null
     and c.id in (select v.contact_id from public.agency_scope_contact_leads(p_tenant_id, p_scope) v)
$$;
revoke all on function public.contact_scope_totals(uuid, uuid[]) from public, anon, authenticated, tenant_app;
grant execute on function public.contact_scope_totals(uuid, uuid[]) to service_role;

-- ─── 4. the export's id list over a scope ─────────────────────────────────────────────────────────
-- One array (not a set of rows), so PostgREST's row cap cannot cut the export short.
create or replace function public.contact_scope_ids(p_tenant_id uuid, p_scope uuid[])
returns uuid[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(c.id order by c.id), array[]::uuid[])
    from public.contacts c
   where c.tenant_id = p_tenant_id
     and c.merged_into_id is null
     and c.id in (select v.contact_id from public.agency_scope_contact_leads(p_tenant_id, p_scope) v)
$$;
revoke all on function public.contact_scope_ids(uuid, uuid[]) from public, anon, authenticated, tenant_app;
grant execute on function public.contact_scope_ids(uuid, uuid[]) to service_role;

-- ─── self-check ───────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'contact_directory_page') <> 1 then
    raise exception 'AG scoped: contact_directory_page must have exactly one signature (PostgREST cannot choose between overloads)';
  end if;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'contact_directory_page'
                  and 'p_scope' = any (proargnames) and prosrc like '%p_scope is null or c.id in (select s.contact_id from scoped s)%') then
    raise exception 'AG scoped: contact_directory_page does not filter by p_scope';
  end if;
  -- inlinable: no security definer, no SET
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'agency_scope_contact_leads'
              and (prosecdef or proconfig is not null)) then
    raise exception 'AG scoped: agency_scope_contact_leads must stay plain SQL so it inlines';
  end if;
  -- a null / empty scope sees nothing
  if exists (select 1 from public.agency_scope_contact_leads((select id from public.tenants limit 1), null))
     or exists (select 1 from public.agency_scope_contact_leads((select id from public.tenants limit 1), array[]::uuid[])) then
    raise exception 'AG scoped: a null or empty scope must see no lead';
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
