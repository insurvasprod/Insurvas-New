-- LA-4 follow-up · persistency on every plan, from Ledger up (owner decision 2026-10-06, backlog #210).
--
-- `cohort_persistency` was granted to `advance` only. The roadmap calls persistency the core idea for
-- every agent ("one early lapse wipes out roughly 26 good sales"), so it now ships with the Ledger
-- plan. The plans stay nested (lib/features/planSeed.test.mjs: no feature is lost on an upgrade), so
-- it is granted to every plan that holds `statement_ingestion`, which is basic, pro and advance today,
-- and any plan built on them.
--
-- Plan data only: the page, the API and the menu already gate on the feature. Every tenant subscribed
-- to one of those plans gets its entitlement refreshed here, so the menu item appears without waiting
-- for the next subscription event. A refresh that fails is a warning, never a failed grant.
--
-- Rollback:
--   delete from public.plan_features pf using public.plans p
--    where pf.plan_id = p.id and pf.feature_key = 'cohort_persistency' and p.code in ('basic', 'pro');
--   then refresh those tenants' entitlements.

-- Granted to exactly the plans that hold statement_ingestion, whatever those are live.
insert into public.plan_features (plan_id, feature_key)
select pf.plan_id, f.key
  from public.plan_features pf
  cross join (values ('cohort_persistency')) as f(key)
 where pf.feature_key = 'statement_ingestion'
on conflict do nothing;

do $$
declare
  v_tenant uuid;
begin
  for v_tenant in
    select distinct s.tenant_id
      from public.subscriptions s
      join public.plan_features pf on pf.plan_id = s.plan_id and pf.feature_key = 'cohort_persistency'
  loop
    begin
      perform public.refresh_tenant_entitlement(v_tenant);
    exception when others then
      raise warning 'LA-4 persistency grant: could not refresh the entitlement of tenant %: %', v_tenant, sqlerrm;
    end;
  end loop;
end;
$$;

-- ── checks ──────────────────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1 from public.plans p
     where p.code in ('basic', 'pro', 'advance')
       and not exists (select 1 from public.plan_features pf where pf.plan_id = p.id and pf.feature_key = 'cohort_persistency')
  ) then
    raise exception '20261007100000: a reviewed plan (basic, pro, advance) does not grant cohort_persistency';
  end if;
  if exists (
    select 1 from public.plan_features pf
     where pf.feature_key = 'statement_ingestion'
       and not exists (select 1 from public.plan_features q where q.plan_id = pf.plan_id and q.feature_key = 'cohort_persistency')
  ) then
    raise exception '20261007100000: a plan with statement_ingestion lacks cohort_persistency';
  end if;
end;
$$;
