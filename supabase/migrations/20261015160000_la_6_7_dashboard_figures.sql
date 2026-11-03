-- LA-6.7 (Notion sprint, Module 6 — Compliance) · the compliance dashboard's standing figures, in one
-- round trip. It collects nothing new: every count reads a table another task already writes (LA-2.3
-- the do-not-call list and campaign scrubs, LA-6.1 the index, LA-6.2 verdicts, LA-6.5 deletion
-- requests, LA-6.6 holds). The gap figures (called after DNC, outside hours, missing consent) come
-- from LA-6.3's compliance_gaps, which the page calls itself.
--
-- Requires 20261015100000–20261015150000. Rollback: drop function if exists public.compliance_dashboard_figures(uuid);

create or replace function public.compliance_dashboard_figures(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with called as (
    select distinct i.phone_digits from public.compliance_index i where i.tenant_id = p_tenant_id and i.event_type = 'call_attempt'
  ), consented as (
    select distinct k.phone_digits from public.compliance_index k where k.tenant_id = p_tenant_id and k.event_type = 'consent'
  )
  select jsonb_build_object(
    'called_numbers', (select count(*) from called),
    'consented_called_numbers', (select count(*) from called c where exists (select 1 from consented s where s.phone_digits = c.phone_digits)),
    'dnc_active', (select count(*) from public.tenant_do_not_call d where d.tenant_id = p_tenant_id and d.is_active),
    'campaigns_active', (select count(*) from public.tenant_campaigns c where c.tenant_id = p_tenant_id and c.status = 'active'),
    'campaigns_scrubbed_30d', (select count(*) from public.tenant_campaigns c where c.tenant_id = p_tenant_id and c.status = 'active' and c.scrubbed_at >= now() - interval '30 days'),
    'transfers_accepted', (select count(*) from public.transfer_verdict v where v.tenant_id = p_tenant_id and v.stage = 'submit' and v.verdict <> 'reject'),
    'transfers_screened_before', (select count(*) from public.transfer_verdict v where v.tenant_id = p_tenant_id and v.stage = 'submit' and v.verdict <> 'reject' and v.screened_before_transfer),
    'deletions_open', (select count(*) from public.deletion_request r where r.tenant_id = p_tenant_id and r.status in ('received', 'verifying', 'verified', 'scheduled')),
    'holds_active', (select count(*) from public.legal_hold h where h.tenant_id = p_tenant_id and h.released_at is null),
    'last_run_held', (select r.held_count from public.retention_run r where r.tenant_id = p_tenant_id order by r.started_at desc limit 1),
    'purge_scheduled', coalesce((select s.purge_schedule_enabled from public.compliance_settings s where s.tenant_id = p_tenant_id), false),
    'unruled_types', coalesce((select to_jsonb(r.unruled) from public.retention_run r where r.tenant_id = p_tenant_id order by r.started_at desc limit 1), '[]'::jsonb)
  )
$$;
revoke all on function public.compliance_dashboard_figures(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.compliance_dashboard_figures(uuid) to service_role;

do $$
declare
  v jsonb;
begin
  v := public.compliance_dashboard_figures('00000000-0000-0000-0000-000000000000'::uuid);
  if not (v ? 'called_numbers' and v ? 'dnc_active' and v ? 'holds_active') then
    raise exception '20261015160000: the dashboard figures are incomplete: %', v;
  end if;
end $$;
