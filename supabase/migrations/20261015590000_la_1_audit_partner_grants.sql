-- LA-1 audit · every plan that sells inbound transfers can also have the partners who send them.
--
-- `pro` grants inbound_transfers and daily_deal_flow but not publisher_records, and every partner,
-- partner-user, product and affiliate-link API is gated on publisher_records
-- (lib/entitlements/agentApiPolicy.ts). A Pro agency could buy the inbound module and never create
-- the partner an inbound lead comes from. publisher_records and partner_quality are now granted to
-- exactly the plans that hold inbound_transfers, whatever those are live.
--
-- partner_portal: sold as "External publisher logins", granted only to a QA plan, enforced nowhere,
-- and its menu node had no page. Partner logins are part of publisher_records (the feature that lets
-- an agency have partners at all; requirePartner and the affiliate route now check it), so the key
-- is ARCHIVED: archived features stay readable for existing plans and leave the plan picker. Nothing
-- is deleted.
--
-- Every tenant subscribed to an affected plan gets its entitlement rebuilt here (plan grants never
-- reach tenant_entitlements on their own). A refresh that fails is a warning, never a failed grant.
--
-- Rollback:
--   delete from public.plan_features pf using public.plans p
--    where pf.plan_id = p.id and p.code = 'pro' and pf.feature_key in ('publisher_records', 'partner_quality');
--   update public.features set is_archived = false where feature_key = 'partner_portal';
--   then refresh those tenants' entitlements.

insert into public.plan_features (plan_id, feature_key)
select pf.plan_id, f.key
  from public.plan_features pf
  cross join (values ('publisher_records'), ('partner_quality')) as f(key)
 where pf.feature_key = 'inbound_transfers'
on conflict do nothing;

update public.features
   set is_archived = true,
       description = 'Deprecated (LA-1 audit, 2026-10-15): partner logins are part of publisher_records. Kept so plans that referenced it still read.'
 where feature_key = 'partner_portal'
   and not is_archived;

do $$
declare
  v_tenant uuid;
begin
  for v_tenant in
    select distinct s.tenant_id
      from public.subscriptions s
      join public.plan_features pf on pf.plan_id = s.plan_id and pf.feature_key = 'inbound_transfers'
  loop
    begin
      perform public.refresh_tenant_entitlement(v_tenant);
    exception when others then
      raise warning 'LA-1 partner grant: could not refresh the entitlement of tenant %: %', v_tenant, sqlerrm;
    end;
  end loop;
end;
$$;

-- ── checks ──────────────────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1 from public.plan_features pf
     where pf.feature_key = 'inbound_transfers'
       and (not exists (select 1 from public.plan_features q where q.plan_id = pf.plan_id and q.feature_key = 'publisher_records')
         or not exists (select 1 from public.plan_features q where q.plan_id = pf.plan_id and q.feature_key = 'partner_quality'))
  ) then
    raise exception '20261015590000: a plan with inbound_transfers lacks publisher_records or partner_quality';
  end if;
  if exists (select 1 from public.features where feature_key = 'partner_portal' and not is_archived) then
    raise exception '20261015590000: partner_portal is still offered in the plan picker';
  end if;
end;
$$;
