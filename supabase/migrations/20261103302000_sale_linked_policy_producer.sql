-- QA 2026-11-03 · a policy linked to a sale names the sale's producer, so a different writing number is asked about.
--
-- agency_entry_candidates gives a commission row two candidates: the writing number's producer and the
-- application's (whoever opened the case). A policy a person linked to a SALE (policy_match deal_flow, no
-- application) had no second candidate, so "Carrier pays Devin Okafor · sold by Demo Agent" never became a
-- "Who gets the credit" item. The application's candidate now falls back to the producer who worked the sale
-- (deal_flow.worked_by) of the policy's current link. Same signature: create or replace.
--
-- Rollback: re-run agency_entry_candidates from 20261018200000_ag_1_4_statement_attribution.sql.

create or replace function public.agency_entry_candidates(p_tenant_id uuid, p_entry_id uuid)
returns table(writing_number_user_id uuid, application_user_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    -- 1. the writing number, mapped now (a number mapped after the row was written still counts)
    coalesce(e.agent_user_id,
             (select m.user_id from public.carrier_agent_map m
               where m.tenant_id = e.tenant_id and m.carrier_id = e.carrier_id and m.agent_identifier = e.agent_identifier)),
    -- 2. the application record: whoever opened the case the policy came from
    coalesce(
      (select c.opened_by from public.policy_current pc join public.tenant_application_cases c on c.id = pc.case_id
        where pc.tenant_id = e.tenant_id and pc.carrier_id = e.carrier_id and pc.policy_number = e.policy_number),
      (select c.opened_by from public.policy_current pc join public.tenant_applications a on a.id = pc.application_id
         join public.tenant_application_cases c on c.id = a.case_id
        where pc.tenant_id = e.tenant_id and pc.carrier_id = e.carrier_id and pc.policy_number = e.policy_number),
      -- 2b (20261103302000). no application: the producer who worked the sale the policy is linked to
      (select d.worked_by from public.policy_match pm join public.deal_flow d on d.id = pm.matched_to_id and d.tenant_id = pm.tenant_id
        where pm.tenant_id = e.tenant_id and pm.carrier_id = e.carrier_id and pm.policy_number = e.policy_number
          and pm.superseded_by_id is null and pm.matched_to_type = 'deal_flow'))
    from public.commission_entry e
   where e.tenant_id = p_tenant_id and e.id = p_entry_id;
$$;

revoke all on function public.agency_entry_candidates(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agency_entry_candidates(uuid, uuid) to service_role;

do $$
begin
  if position('deal_flow' in pg_get_functiondef('public.agency_entry_candidates(uuid, uuid)'::regprocedure)) = 0 then
    raise exception '20261103302000: agency_entry_candidates does not read the sale';
  end if;
end;
$$;
