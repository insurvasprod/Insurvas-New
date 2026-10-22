-- LA-8.5 follow-up · put LA-4.10's plan_name back into refresh_tenant_entitlement.
--
-- 20261015330000 restated the engine from 20260924360000's text. LA-4.10 (20261003100000) had added
-- one line to the live function IN PLACE ('plan_name', v_plan.name), so that line was not in the
-- text the restatement started from, and applying 20261015330000 removed it: entitlements rebuilt
-- since then carry no plan_name, and the sidebar falls back to the tidied plan code.
-- (20261015330000 has since been corrected to keep the line; this repairs a database it already ran on.)
--
-- Same in-place patch as LA-4.10, idempotent: a function that already has the line is left alone.
-- Then every cached entitlement without a plan_name is rebuilt, and the result is checked.

do $$
declare
  v_anchor constant text := '''plan_code'', v_plan.code,';
  v_def text;
  v_count integer;
begin
  -- SQL-editor pastes store CRLF; normalise before matching the anchor.
  v_def := replace(pg_get_functiondef('public.refresh_tenant_entitlement(uuid)'::regprocedure), E'\r\n', E'\n');
  if position('''plan_name''' in v_def) > 0 then
    return; -- already there
  end if;
  v_count := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  if v_count <> 1 then
    raise exception 'LA-8.5: expected the plan_code line once in refresh_tenant_entitlement, found %', v_count;
  end if;
  execute replace(v_def, v_anchor, v_anchor || E'\n      ''plan_name'', v_plan.name,');
end;
$$;

-- Rebuild the entitlements computed without it (a tenant with a subscription; the LA-0 default
-- entitlement has no plan row and never carried one).
do $$
declare
  v_tenant uuid;
begin
  for v_tenant in
    select e.tenant_id from public.tenant_entitlements e
     where not (e.entitlement ? 'plan_name')
       and exists (select 1 from public.subscriptions s where s.tenant_id = e.tenant_id)
  loop
    perform public.refresh_tenant_entitlement(v_tenant);
  end loop;
end;
$$;

-- Self-check ------------------------------------------------------------------------------------
do $$
begin
  if position('''plan_name'', v_plan.name' in replace(pg_get_functiondef('public.refresh_tenant_entitlement(uuid)'::regprocedure), E'\r\n', E'\n')) = 0 then
    raise exception 'LA-8.5 self-check: refresh_tenant_entitlement does not put plan_name in the blob';
  end if;
  if position('''retention_until'', v_retention_until' in pg_get_functiondef('public.refresh_tenant_entitlement(uuid)'::regprocedure)) = 0 then
    raise exception 'LA-8.5 self-check: the patch lost retention_until';
  end if;
  if exists (
    select 1 from public.tenant_entitlements e
     where not (e.entitlement ? 'plan_name')
       and exists (select 1 from public.subscriptions s where s.tenant_id = e.tenant_id)
  ) then
    raise exception 'LA-8.5 self-check: an entitlement with a subscription still has no plan_name';
  end if;
end;
$$;
