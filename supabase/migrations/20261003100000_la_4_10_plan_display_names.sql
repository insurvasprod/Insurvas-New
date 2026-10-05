-- LA-4.10: plan display names — Ledger, Basic, Advanced — and the name in the entitlement blob.
--
-- The decision (docs/roadmap/ROADMAP.md): rename for display only. plans.code stays basic / pro /
-- advance everywhere (entitlements, Whop mapping, tests); plans.name becomes:
--
--     basic   → Ledger      the $99 statement-reconciliation wedge
--     pro     → Basic
--     advance → Advanced
--
-- The agent app never reads public.plans ("it reads this one object and obeys it"), so until now
-- it could only tidy the code — a Ledger customer would have kept seeing "Basic" in their own
-- sidebar. Backlog #75's fix is applied here: refresh_tenant_entitlement puts the plan's name in
-- the blob as `plan_name`, and the app prefers it, falling back to the tidied code.
--
--   1. refresh_tenant_entitlement gains one line, patched IN PLACE from the live definition, so any
--      SQL-editor change made to it since 20260924360000 is kept. The live body may carry CRLF line
--      endings (SQL-editor pastes), so it is normalised before the anchor is matched, and the patch
--      refuses unless the anchor occurs exactly once.
--   2. A rename refreshes the entitlements of the tenants subscribed to that plan, so the blob never
--      shows yesterday's name for long. A refresh that fails is a warning, never a failed rename.
--   3. The three plans are renamed (every version), then every tenant on them is refreshed once.
--
-- No session settings (the pooler is transaction-mode). Requires 20260924360000.
--
-- Down: drop trigger if exists plans_refresh_entitlements_on_rename on public.plans;
--       drop function if exists public.refresh_entitlements_on_plan_rename();
--       (the plan_name line is harmless to leave; re-run 20260924360000's definition to remove it)

-- 1 · the name in the blob ---------------------------------------------------------------------
do $$
declare
  v_anchor constant text := '''plan_code'', v_plan.code,';
  v_def text;
  v_count integer;
begin
  v_def := replace(pg_get_functiondef('public.refresh_tenant_entitlement(uuid)'::regprocedure), E'\r\n', E'\n');
  if position('''plan_name''' in v_def) > 0 then
    return; -- already patched
  end if;
  v_count := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  if v_count <> 1 then
    raise exception 'LA-4.10: expected the plan_code line once in refresh_tenant_entitlement, found %', v_count;
  end if;
  execute replace(v_def, v_anchor, v_anchor || E'\n      ''plan_name'', v_plan.name,');
end;
$$;

-- 2 · a rename refreshes the tenants on that plan -----------------------------------------------
create or replace function public.refresh_entitlements_on_plan_rename()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_tenant uuid;
begin
  if new.name is not distinct from old.name then
    return new;
  end if;
  for v_tenant in select distinct s.tenant_id from public.subscriptions s where s.plan_id = new.id loop
    begin
      perform public.refresh_tenant_entitlement(v_tenant);
    exception when others then
      raise warning 'LA-4.10: could not refresh the entitlement of tenant % after a plan rename: %', v_tenant, sqlerrm;
    end;
  end loop;
  return new;
end;
$$;

revoke all on function public.refresh_entitlements_on_plan_rename() from public, anon, authenticated;

drop trigger if exists plans_refresh_entitlements_on_rename on public.plans;
create trigger plans_refresh_entitlements_on_rename
  after update of name on public.plans
  for each row execute function public.refresh_entitlements_on_plan_rename();

-- 3 · the renames, then one refresh for every tenant on these plans -----------------------------
update public.plans set name = 'Ledger'   where code = 'basic'   and name is distinct from 'Ledger';
update public.plans set name = 'Basic'    where code = 'pro'     and name is distinct from 'Basic';
update public.plans set name = 'Advanced' where code = 'advance' and name is distinct from 'Advanced';

do $$
declare
  v_tenant uuid;
begin
  for v_tenant in
    select distinct s.tenant_id
      from public.subscriptions s
      join public.plans p on p.id = s.plan_id
     where p.code in ('basic', 'pro', 'advance')
  loop
    begin
      perform public.refresh_tenant_entitlement(v_tenant);
    exception when others then
      raise warning 'LA-4.10: could not refresh the entitlement of tenant %: %', v_tenant, sqlerrm;
    end;
  end loop;
end;
$$;

-- Self-check ------------------------------------------------------------------------------------
do $$
begin
  if position('''plan_name'', v_plan.name' in pg_get_functiondef('public.refresh_tenant_entitlement(uuid)'::regprocedure)) = 0 then
    raise exception 'LA-4.10 self-check: refresh_tenant_entitlement does not put plan_name in the blob';
  end if;
  if exists (select 1 from public.plans where (code, name) in (('basic', 'Basic'), ('pro', 'Pro'), ('advance', 'Advance'))) then
    raise exception 'LA-4.10 self-check: a plan still carries its old name';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'plans_refresh_entitlements_on_rename' and tgrelid = 'public.plans'::regclass) then
    raise exception 'LA-4.10 self-check: the rename trigger is missing';
  end if;
end;
$$;
