-- Role homes, roles r1 (owner 2026-11-18, board docs/design/roles-r1/dashboards-and-partners.html, "Build 1, 2 and 3"):
-- the goals and targets the compact Home draws as a ring, set from its "Set goal" / "Set target" sheet.
--
--   premium    monthly issued premium, in cents: a producer's own (user_id = the producer) or the agency's
--              (user_id null, set by the owner or an admin)
--   policies   monthly policies issued, a count: a manager's team (user_id = the manager) or the agency's (null)
--   booked     weekly appointments booked, a count: a setter's own
--   saves      monthly retention saves, a count: a retention rep's own
--
-- One standing goal per (tenant, person or agency, kind): it applies to every month (or week) until changed.
-- Until this file is applied the rings fall back to last month's figure, as before, and the sheet says the goals
-- need a database update.
--
-- Written only by /api/app/goals through the service role (role check + tenant audit row), always filtered by the
-- session's tenant. tenant_app reads its own tenant's rows under RLS, like the neighbouring tenant tables
-- (20261105200000 retention_case).
--
-- Rollback: drop table public.tenant_dashboard_goal;

create table if not exists public.tenant_dashboard_goal (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- null: the agency's own goal.
  user_id uuid references public.users (id) on delete cascade,
  kind text not null,
  period text not null,
  target bigint not null,
  set_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_dashboard_goal_kind_valid check (kind in ('premium', 'policies', 'booked', 'saves')),
  constraint tenant_dashboard_goal_period_valid check (
    (kind = 'booked' and period = 'week') or (kind <> 'booked' and period = 'month')
  ),
  -- $100,000,000 a month or 1,000,000 policies is past any agency; a goal is never zero or negative.
  constraint tenant_dashboard_goal_target_valid check (target > 0 and target <= 10000000000)
);

-- One goal per person (or the agency) per kind.
create unique index if not exists tenant_dashboard_goal_one
  on public.tenant_dashboard_goal (tenant_id, kind, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.tenant_dashboard_goal enable row level security;
drop policy if exists tenant_dashboard_goal_read on public.tenant_dashboard_goal;
create policy tenant_dashboard_goal_read on public.tenant_dashboard_goal for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_dashboard_goal from public, anon, authenticated;
-- Supabase grants service_role everything by default; the route needs read, insert, update and delete (Clear goal).
revoke all on public.tenant_dashboard_goal from service_role;
grant select, insert, update, delete on public.tenant_dashboard_goal to service_role;
revoke insert, update, delete, truncate on public.tenant_dashboard_goal from tenant_app;
grant select on public.tenant_dashboard_goal to tenant_app;

create or replace function public.touch_tenant_dashboard_goal_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $function$
begin new.updated_at := now(); return new; end;
$function$;
revoke all on function public.touch_tenant_dashboard_goal_updated_at() from public, anon, authenticated;

drop trigger if exists tenant_dashboard_goal_touch_updated_at on public.tenant_dashboard_goal;
create trigger tenant_dashboard_goal_touch_updated_at before update on public.tenant_dashboard_goal
for each row execute function public.touch_tenant_dashboard_goal_updated_at();

do $check$
begin
  if not exists (select 1 from pg_class where oid = 'public.tenant_dashboard_goal'::regclass and relrowsecurity) then
    raise exception 'tenant_dashboard_goal: RLS is not on';
  end if;
  if has_table_privilege('authenticated', 'public.tenant_dashboard_goal', 'select') then
    raise exception 'tenant_dashboard_goal: authenticated can still read it';
  end if;
  if has_table_privilege('service_role', 'public.tenant_dashboard_goal', 'truncate') then
    raise exception 'tenant_dashboard_goal: service_role can still truncate';
  end if;
end;
$check$;
