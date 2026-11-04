-- QA 2026-11-03 · commission paid on a policy we don't have, one row per policy.
--
-- Needs you raises "Paid on a policy we don't have" for a commission line whose policy no policy file has
-- yet, once it has waited ORPHAN_NOTICE_DAYS (lib/needsYou/kinds.ts). commission_orphan_summary counts them
-- per carrier only, so the app read every commission line and every known policy of each such carrier on
-- every Needs-you load. This view gives the per-policy rows the summary is built from, so the app reads only
-- the orphans. security_invoker, as the summary: RLS on commission_entry still applies.
--
-- Rollback: drop view if exists public.commission_orphan_policies;

create or replace view public.commission_orphan_policies
with (security_invoker = true) as
select e.tenant_id, e.carrier_id, e.policy_number,
       min(coalesce(e.transaction_date, e.statement_date, e.created_at::date)) as first_seen,
       count(*)::bigint as lines,
       coalesce(sum(e.amount_cents) filter (where coalesce(e.corrects_type, e.entry_type) <> 'held'), 0)::bigint as amount_cents,
       coalesce(sum(e.amount_cents) filter (where coalesce(e.corrects_type, e.entry_type) = 'held'), 0)::bigint as held_cents,
       array_agg(distinct e.agent_identifier) filter (where e.agent_identifier is not null) as agent_identifiers,
       array_agg(distinct e.file_id) filter (where e.file_id is not null) as file_ids
  from public.commission_entry e
 where e.policy_number is not null
   and not exists (select 1 from public.policy_current pc
                    where pc.tenant_id = e.tenant_id and pc.carrier_id = e.carrier_id and pc.policy_number = e.policy_number)
 group by e.tenant_id, e.carrier_id, e.policy_number;

revoke all on public.commission_orphan_policies from public, anon, authenticated;
grant select on public.commission_orphan_policies to service_role, tenant_app;

do $$
begin
  if to_regclass('public.commission_orphan_policies') is null then
    raise exception '20261103303000: commission_orphan_policies was not created';
  end if;
end;
$$;
