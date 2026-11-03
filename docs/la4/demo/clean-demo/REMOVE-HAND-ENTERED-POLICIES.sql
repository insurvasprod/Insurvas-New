-- Remove the 120 hand-entered QA test policies (LA-0.7, numbers QA-D1-…) from the demo agency
-- "Advance Team (QA demo)" (tenant "LA-1.25 Alert Demo"), so the Policies page shows only what the
-- carrier files bring in. Their 6 lapse signals go with them. Nothing else is touched.
-- No table here refuses a delete. Any mismatch raises and the WHOLE script rolls back.
begin;

do $$
declare
  v_t constant uuid := 'd6f3950f-0d88-4e66-869f-0de2ea6b396b';
  n bigint;
begin
  if (select name from public.tenants where id = v_t) is distinct from 'LA-1.25 Alert Demo' then
    raise exception 'remove: % is not the demo agency; nothing changed', v_t;
  end if;
  if exists (select 1 from public.tenant_policies where tenant_id = v_t and policy_number not like 'QA-D1-%') then
    raise exception 'remove: the agency has hand-entered policies that are not QA test data; nothing changed';
  end if;
  delete from public.tenant_policy_lapse_signals where tenant_id = v_t;
  delete from public.tenant_policies where tenant_id = v_t and policy_number like 'QA-D1-%';
  get diagnostics n = row_count;
  if (select count(*) from public.tenant_policies where tenant_id = v_t) <> 0 then
    raise exception 'remove: hand-entered policies left behind; rolled back';
  end if;
  raise notice 'removed % hand-entered policies', n;
end $$;

-- Should read: 0 hand policies, 0 carrier-file policies.
select
  (select count(*) from public.tenant_policies where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as hand_policies,
  (select count(*) from public.policy_current where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as carrier_file_policies;

commit;
