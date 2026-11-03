-- ---------------------------------------------------------------------------
-- LA-2.4 · The calling-window engine, and the rules it was never allowed to read
--
-- The first draft of this migration created `calling_window_state_rules` and
-- `calling_window_holidays`. Both already existed — with 52 state rules and 8 holidays already
-- seeded, and a better shape than the one being proposed (`effective_to` for a statute that has
-- been superseded, `allowed_weekdays` rather than a single no_sunday flag).
--
-- `create table if not exists` silently did nothing, and the migration only failed later, on an
-- insert naming a column the real table does not have. That silent no-op is the exact root enabler
-- of all eight table collisions inventoried in backlog 182, and it caught this change too. The
-- rule it exists for — look before you create, and adapt to what is there — is why this file now
-- creates one table instead of three.
--
-- What was actually missing:
--
--   the engine            lib/callingWindow/engine.ts — 26 unit tests, including the two the
--                         criteria name: a DST boundary, and America/Phoenix which ignores it
--   tenant_app's access   the rules are platform data, and the tenant plane could not SELECT them.
--                         An engine in the tenant plane with no access to the statutes would have
--                         fallen back to federal-only and nobody would have seen it happen.
--   tenant tightening     no table could express "Ray wants 9-19"
--   campaign tightening   no columns on tenant_campaigns
--
-- State rules and holidays stay platform-owned and read-only to tenants. A tenant that could write
-- a state rule could widen its own calling window by editing a statute.
-- ---------------------------------------------------------------------------

-- ── the tenant's own tightening ────────────────────────────────────────────
create table if not exists public.tenant_calling_windows (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  start_hour integer not null check (start_hour between 0 and 23),
  end_hour integer not null check (end_hour between 1 and 24),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  -- An inverted window is refused here rather than defended against in the engine. The engine
  -- closes such a window safely, but storing one means a screen somewhere will render "20:00-09:00"
  -- as though it meant something.
  constraint tenant_calling_windows_sane check (start_hour < end_hour)
);

-- A campaign may be narrower still. Both null means no campaign tightening.
alter table public.tenant_campaigns
  add column if not exists calling_window_start_hour integer check (calling_window_start_hour between 0 and 23),
  add column if not exists calling_window_end_hour integer check (calling_window_end_hour between 1 and 24);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_campaigns_calling_window_sane') then
    alter table public.tenant_campaigns
      add constraint tenant_campaigns_calling_window_sane
      check (calling_window_start_hour is null
             or calling_window_end_hour is null
             or calling_window_start_hour < calling_window_end_hour);
  end if;
end $$;

-- ── let the tenant plane read the statutes ─────────────────────────────────
-- Read-only, deliberately. This is the gap that would have made the engine quietly wrong: with no
-- SELECT, every lookup returns nothing, the engine sees no state rule, and every state falls back
-- to the federal 8-21 — including Florida, which stops at 20:00 and forbids Sundays. A compliance
-- engine that fails open is worse than none, because it is trusted.
grant select on public.calling_window_state_rules to tenant_app;
grant select on public.calling_window_holidays to tenant_app;
grant select on public.calling_window_state_rules, public.calling_window_holidays to service_role;

alter table public.tenant_calling_windows enable row level security;
drop policy if exists tenant_calling_windows_tenant_scoped on public.tenant_calling_windows;
create policy tenant_calling_windows_tenant_scoped on public.tenant_calling_windows
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_calling_windows from anon, authenticated, public;
grant select, insert, update on public.tenant_calling_windows to tenant_app;
grant select, insert, update, delete on public.tenant_calling_windows to service_role;

-- ── the rules in force, in the shape the engine reads ──────────────────────
--
-- The stored shape is richer than the engine's input: times rather than hours, a weekday array
-- rather than a Sunday flag, and effective dates. Translating once here means the engine keeps its
-- simple, testable input and there is exactly one place that knows how the table is shaped.
--
-- A rule is "in force" when effective_from has passed and effective_to has not. A superseded
-- statute staying in the table is the point of having those columns.
create or replace function public.calling_window_rules_in_force(p_on date default current_date)
returns table(state text, start_hour integer, end_hour integer, no_sunday boolean, no_holidays boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select r.state_code,
         extract(hour from r.start_local)::integer,
         -- A statute ending at 20:00 permits calls until 19:59. The engine's window is half-open,
         -- so 20:00 as the exclusive end is the same rule expressed without an off-by-one.
         extract(hour from r.end_local)::integer,
         -- 0 = Sunday. A rule that lists allowed weekdays and omits 0 forbids Sunday calls.
         (r.allowed_weekdays is not null and not (0 = any(r.allowed_weekdays))),
         coalesce(r.block_holidays, false)
    from calling_window_state_rules r
   where r.effective_from <= p_on
     and (r.effective_to is null or r.effective_to > p_on);
$function$;

revoke all on function public.calling_window_rules_in_force(date) from public, anon, authenticated;
grant execute on function public.calling_window_rules_in_force(date) to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_count integer;
  v_rule record;
  v_tenant_id uuid;
begin
  -- The pre-existing seed is intact and was not duplicated by this migration.
  select count(*) into v_count from public.calling_window_state_rules;
  if v_count <> 52 then
    raise exception 'calling_window_state_rules holds % rows; this migration must not add or remove any', v_count;
  end if;

  -- The tenant plane can now read them. This is the whole point of the grant.
  if not has_table_privilege('tenant_app', 'public.calling_window_state_rules', 'select') then
    raise exception 'tenant_app still cannot read the state rules';
  end if;
  if not has_table_privilege('tenant_app', 'public.calling_window_holidays', 'select') then
    raise exception 'tenant_app still cannot read the holiday calendar';
  end if;
  -- And still cannot write them.
  if has_table_privilege('tenant_app', 'public.calling_window_state_rules', 'update') then
    raise exception 'tenant_app can WRITE a state rule, which would let it widen its own window';
  end if;

  -- The projection produces hours the engine can use, for every row in force.
  select count(*) into v_count from public.calling_window_rules_in_force();
  if v_count = 0 then
    raise exception 'no state rule is in force today, so the engine would see none';
  end if;

  for v_rule in select * from public.calling_window_rules_in_force() loop
    if v_rule.start_hour is null or v_rule.end_hour is null then
      raise exception 'state % projected a null hour', v_rule.state;
    end if;
    if v_rule.start_hour >= v_rule.end_hour then
      raise exception 'state % projected an inverted window %-%', v_rule.state, v_rule.start_hour, v_rule.end_hour;
    end if;
    -- Nothing in force may be wider than federal. The engine would ignore it, but a compliance
    -- table containing "calls until 23:00" is a misleading thing to hold even when nothing reads
    -- it that way.
    if v_rule.start_hour < 8 or v_rule.end_hour > 21 then
      raise exception 'state % is stored wider than the federal window: %-%',
        v_rule.state, v_rule.start_hour, v_rule.end_hour;
    end if;
  end loop;

  -- An inverted tenant window is refused rather than stored.
  -- The migration owner can see tenant rows during deployment, but the read-only migration
  -- checker may run as tenant_app with RLS hiding every tenant row. In that checker context an
  -- INSERT ... SELECT would affect zero rows and the assertion would falsely report that the
  -- constraint accepted the value. Only run this data-dependent probe when a visible tenant is
  -- available; the constraint definition itself is still present in the migration above.
  select id into v_tenant_id
    from public.tenants
   order by created_at
   limit 1;
  if v_tenant_id is not null then
  begin
    insert into public.tenant_calling_windows (tenant_id, start_hour, end_hour)
    values (v_tenant_id, 20, 9);
    raise exception 'an inverted tenant calling window was accepted';
  exception when check_violation then
    null;
  end;
  end if;

  -- And an inverted campaign window likewise.
  begin
    update public.tenant_campaigns
       set calling_window_start_hour = 19, calling_window_end_hour = 10
     where id = (select id from public.tenant_campaigns limit 1);
    if found then
      raise exception 'an inverted campaign calling window was accepted';
    end if;
  exception when check_violation then
    null;
  end;
end $$;
