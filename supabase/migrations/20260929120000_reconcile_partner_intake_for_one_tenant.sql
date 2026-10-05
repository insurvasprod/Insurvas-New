-- LA-1.7-3: the intake reconciliation check, for one tenant.
--
-- public.reconcile_partner_intake() (20260902170000) walks every partner lead in the database. On
-- the shared project that is ~200k partner leads and it answers in ~9 s, next to the service
-- role's statement timeout, and a backlog of seeded load-test leads (drained 500 per run by the
-- 20260925510200 job) fills PostgREST's 1,000-row response before any newer lead is reached. So
-- neither scripts/reconcile-intake.mjs --tenant nor the LA-1.7 suite could see one tenant's
-- orphan reliably.
--
-- 1. reconcile_partner_intake_for_tenant(p_tenant_id) is the same rule, read through the
--    (tenant_id, partner_id, submission_id) index. The global function is unchanged and the pg_cron
--    job keeps calling it.
-- 2. intake_failures gains an index on lead_id. Both functions probe it once per partner lead and
--    it had none.
--
-- Idempotent. Additive only.

create index if not exists intake_failures_lead_idx on public.intake_failures (lead_id);

create or replace function public.reconcile_partner_intake_for_tenant(p_tenant_id uuid)
returns table (
  lead_id uuid,
  tenant_id uuid,
  submission_id uuid,
  missing_steps text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.id,
    l.tenant_id,
    l.submission_id,
    array['work_item']::text[]
  from public.agent_leads l
  where l.tenant_id = p_tenant_id
    and l.partner_id is not null
    and l.submission_id is not null
    and not exists (select 1 from public.lead_queue q where q.lead_id = l.id)
    and not exists (select 1 from public.intake_failures f where f.lead_id = l.id)
  order by l.created_at;
$$;

revoke all on function public.reconcile_partner_intake_for_tenant(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.reconcile_partner_intake_for_tenant(uuid) to service_role;

-- assertions
do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929120000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if to_regprocedure('public.reconcile_partner_intake_for_tenant(uuid)') is null then
    raise exception '20260929120000: reconcile_partner_intake_for_tenant is missing';
  end if;
  if to_regclass('public.intake_failures_lead_idx') is null then
    raise exception '20260929120000: intake_failures_lead_idx is missing';
  end if;
  -- A tenant that does not exist has nothing to reconcile, and asking must not fail.
  if exists (select 1 from public.reconcile_partner_intake_for_tenant('00000000-0000-0000-0000-000000000000'::uuid)) then
    raise exception '20260929120000: an unknown tenant reported partner leads';
  end if;
  if has_function_privilege('anon', 'public.reconcile_partner_intake_for_tenant(uuid)', 'EXECUTE') then
    raise exception '20260929120000: anon can run the tenant reconciliation';
  end if;
  -- Coverage: M1 LA-1.7-3 (a partner lead with no work item and no logged failure is reported).
end $$;
