-- AG-0.4 (Notion sprint, Agency Module 0) · row-level producer visibility — one predicate, two places.
--
-- All 137 agent tasks assumed one tenant = one agent's book. Rather than amend them, the producer filter is
-- added centrally:
--
--   visible_producer_ids(session) →
--     owner | admin | bookkeeper | retention  → all producers in the agency      (returned as NULL = no filter)
--     manager                                 → self + direct reports, as of today (AG-0.3, one level)
--     producer | setter                       → [self]
--     assistant                               → the producer(s) he assists (assistant_producer below)
--   For a tenant on an INDIVIDUAL plan the predicate is a no-op: NULL, no filter, one cached lookup.
--
-- "producer id" here is the producer's USER id, in the attribution column each table already carries
-- (decision D1, docs/agency/AGENCY-BUILD-PROMPT.md).
--
-- Place 1 (this file): a RESTRICTIVE select policy for tenant_app on every producer-scoped table, ANDed with
-- the table's existing tenant policy, so no existing policy is rewritten. The session supplies tenant and
-- user (app.tenant_id / app.user_id, set transaction-locally by withTenantScope) — never a request parameter.
-- Place 2 (lib/agency/visibility.ts): the application helper. The app reads through the service role, which
-- bypasses RLS, so the helper is the boundary every app read must route through; AG-0.5 audits that route by
-- route. Both places call THIS function, so they cannot disagree.
--
-- A row with no producer (unattributed) in an agency is visible only to the all-seeing roles.
--
-- Scope, with the column that names the producer on each:
--   lead_queue.owner_user_id · tenant_application_cases.opened_by · tenant_applications (through its case)
--   policy_current.agent_user_id · tenant_issued_policies (through its case) · commission_entry.agent_user_id
--   cost_entry.producer_user_id · producer_ledger_entry / producer_split / producer_payout_run.producer_user_id
--   tenant_call_attempts.agent_id · tenant_callbacks.assigned_to
--   (dialer_calls is the legacy CRM's table: no tenant_app policy and no tenant reader; not in scope)
--   retention_assignment.assigned_to_user_id
-- A table that gains a producer column later must gain its policy in the same migration; the static test in
-- lib/agency/ag04.test.mjs fails on a listed table with no policy.
--
-- Requires 20261018100000 (producer, tenant_plan_audience), 20261018110000 (agency_role),
-- 20261018120000 (producer_direct_reports).
--
-- Rollback: drop the restrictive policies named agency_producer_scope on each table below;
--   drop table if exists public.assistant_producer;
--   drop function if exists public.agency_session_visible_user_ids(); drop function if exists public.agency_visible_user_ids(uuid, uuid, date);

-- ─── who an assistant works for ──────────────────────────────────────────────────────────────────
create table if not exists public.assistant_producer (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  assistant_user_id uuid not null references public.users(id) on delete cascade,
  producer_user_id uuid not null references public.users(id) on delete cascade,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, assistant_user_id, producer_user_id),
  constraint assistant_producer_not_self check (assistant_user_id <> producer_user_id)
);
revoke all on public.assistant_producer from public, anon, authenticated;
revoke update, truncate on public.assistant_producer from service_role, tenant_app;
grant select on public.assistant_producer to tenant_app;
grant select, insert, delete on public.assistant_producer to service_role;
alter table public.assistant_producer enable row level security;
drop policy if exists assistant_producer_tenant_read on public.assistant_producer;
create policy assistant_producer_tenant_read on public.assistant_producer for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- ─── the predicate ────────────────────────────────────────────────────────────────────────────────
-- NULL = no filter (individual plan, or a role that sees the whole agency). An array = exactly those user ids
-- (possibly empty: an assistant nobody assigned sees nothing — absent, not guessed).
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
  if v_title = 'manager' then
    select p.id into v_me from public.producer p where p.tenant_id = p_tenant_id and p.user_id = p_user_id;
    select array[p_user_id] || coalesce(array_agg(r.user_id order by r.user_id), array[]::uuid[]) into v_out
      from public.producer r
     where v_me is not null and r.id in (select public.producer_direct_reports(p_tenant_id, v_me, p_as_of));
    return v_out;
  end if;
  return array[p_user_id]; -- producer, setter, and any role this list does not name: himself only
end;
$$;
revoke all on function public.agency_visible_user_ids(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.agency_visible_user_ids(uuid, uuid, date) to service_role, tenant_app;

-- The session form, for policies: no row-dependent arguments, so `(select …)` evaluates it once per query.
create or replace function public.agency_session_visible_user_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.agency_visible_user_ids(
    nullif(current_setting('app.tenant_id', true), '')::uuid,
    nullif(current_setting('app.user_id', true), '')::uuid,
    current_date
  );
$$;
revoke all on function public.agency_session_visible_user_ids() from public, anon, authenticated;
grant execute on function public.agency_session_visible_user_ids() to tenant_app;

-- ─── place 1: a restrictive policy on every producer-scoped table ─────────────────────────────────
do $$
declare
  v_spec text[];
  v_table text;
  v_using text;
begin
  foreach v_spec slice 1 in array array[
    array['lead_queue', 'owner_user_id = any (v)'],
    array['tenant_application_cases', 'opened_by = any (v)'],
    array['tenant_applications', 'exists (select 1 from public.tenant_application_cases c where c.id = case_id and c.opened_by = any (v))'],
    array['policy_current', 'agent_user_id = any (v)'],
    array['tenant_issued_policies', 'exists (select 1 from public.tenant_application_cases c where c.id = application_case_id and c.opened_by = any (v))'],
    array['commission_entry', 'agent_user_id = any (v)'],
    array['cost_entry', 'producer_user_id = any (v)'],
    array['producer_ledger_entry', 'producer_user_id = any (v)'],
    array['producer_split', 'producer_user_id = any (v)'],
    array['producer_payout_run', 'producer_user_id = any (v)'],
    array['tenant_call_attempts', 'agent_id = any (v)'],
    array['tenant_callbacks', 'assigned_to = any (v)'],
    array['retention_assignment', 'assigned_to_user_id = any (v)']
  ] loop
    v_table := v_spec[1];
    if to_regclass('public.' || v_table) is null then continue; end if;
    -- NULL from the predicate = no filter; otherwise the row's producer must be in the list. The array is wrapped
    -- in coalesce: `x = any ((select f()))` reads the subquery as a SET of uuid[] rows (uuid = uuid[] fails);
    -- as an expression it stays one array, and the scalar subquery is still evaluated once per statement.
    v_using := format(
      '(select public.agency_session_visible_user_ids()) is null or (%s)',
      replace(v_spec[2], '(v)', '(coalesce((select public.agency_session_visible_user_ids()), ''{}''::uuid[]))')
    );
    -- A restrictive policy only ever NARROWS a permissive one; on a table with RLS off, or with no permissive
    -- tenant_app policy, it would either do nothing or shut tenant_app out entirely. Every listed table has
    -- both today (checked 2026-10-18); refuse loudly if that ever stops being true rather than guess.
    if not (select c.relrowsecurity from pg_class c where c.oid = ('public.' || v_table)::regclass)
       or not exists (select 1 from pg_policy p join pg_roles r on r.oid = any (p.polroles)
                       where p.polrelid = ('public.' || v_table)::regclass and p.polpermissive and r.rolname = 'tenant_app') then
      raise exception 'AG-0.4: % has no permissive tenant_app policy to narrow', v_table;
    end if;
    execute format('drop policy if exists agency_producer_scope on public.%I', v_table);
    execute format('create policy agency_producer_scope on public.%I as restrictive for select to tenant_app using (%s)', v_table, v_using);
  end loop;
end;
$$;

-- ─── self-check ───────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_missing text;
begin
  select string_agg(t, ', ') into v_missing
    from unnest(array['lead_queue', 'tenant_application_cases', 'tenant_applications', 'policy_current', 'tenant_issued_policies',
                      'commission_entry', 'cost_entry', 'producer_ledger_entry', 'producer_split', 'producer_payout_run',
                      'tenant_call_attempts', 'tenant_callbacks', 'retention_assignment']) t
   where to_regclass('public.' || t) is not null
     and not exists (select 1 from pg_policy p where p.polrelid = ('public.' || t)::regclass and p.polname = 'agency_producer_scope' and not p.polpermissive);
  if v_missing is not null then
    raise exception 'AG-0.4: producer-scoped tables without the restrictive policy: %', v_missing;
  end if;
  -- An individual-plan tenant pays nothing: the predicate answers NULL (no filter) for it.
  if exists (select 1 from public.tenants t where public.tenant_plan_audience(t.id) = 'individual'
              and public.agency_visible_user_ids(t.id, public.tenant_owner_user(t.id)) is not null limit 1) then
    raise exception 'AG-0.4: the predicate filters an individual-plan tenant';
  end if;
end;
$$;
