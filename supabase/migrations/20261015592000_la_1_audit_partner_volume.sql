-- LA-1 audit · the partner list's monthly figures, counted in SQL.
--
-- lib/partners/service.ts read every lead, transfer and disposition of the month as rows and counted
-- them in the app. The hosted API returns at most 1,000 rows per read, so a busy agency's partner
-- volume silently stopped at 1,000 (the .limit(50000) on two of the reads never applied). This
-- returns one row per partner with the counts, read once.
--
-- Same definitions as the app used: leads created since p_since; transfers queued since p_since;
-- dispositions recorded since p_since, completed/dropped by the tenant's disposition flags.

create or replace function public.partner_month_figures(p_tenant_id uuid, p_since timestamptz)
returns table(
  partner_id uuid,
  lead_volume integer,
  last_submission timestamptz,
  transfers integer,
  completed integer,
  dropped integer
)
language sql
stable
security definer
set search_path = public
as $$
  with partner_ids as (
    select p.id from public.partners p where p.tenant_id = p_tenant_id
  ),
  leads as (
    select l.partner_id, count(*)::integer as lead_volume, max(l.created_at) as last_submission
      from public.agent_leads l
     where l.tenant_id = p_tenant_id and l.created_at >= p_since and l.partner_id in (select id from partner_ids)
     group by l.partner_id
  ),
  sent as (
    select q.partner_id, count(*)::integer as transfers
      from public.lead_queue q
     where q.tenant_id = p_tenant_id and q.created_at >= p_since and q.partner_id in (select id from partner_ids)
     group by q.partner_id
  ),
  closed as (
    select q.partner_id,
           count(*) filter (where d.counts_as_work_completed)::integer as completed,
           count(*) filter (where d.closes_as = 'dropped')::integer as dropped
      from public.lead_queue q
      join public.dispositions d on d.tenant_id = q.tenant_id and d.disposition_key = q.disposition
     where q.tenant_id = p_tenant_id and q.disposition is not null and q.disposition_at >= p_since
       and q.partner_id in (select id from partner_ids)
     group by q.partner_id
  )
  select pi.id,
         coalesce(leads.lead_volume, 0),
         leads.last_submission,
         coalesce(sent.transfers, 0),
         coalesce(closed.completed, 0),
         coalesce(closed.dropped, 0)
    from partner_ids pi
    left join leads on leads.partner_id = pi.id
    left join sent on sent.partner_id = pi.id
    left join closed on closed.partner_id = pi.id;
$$;

revoke all on function public.partner_month_figures(uuid, timestamptz) from public, anon, authenticated, tenant_app;
grant execute on function public.partner_month_figures(uuid, timestamptz) to service_role;

-- ─── self-check ──────────────────────────────────────────────────────────────────────────────────
do $$
begin
  perform * from public.partner_month_figures('00000000-0000-0000-0000-000000000000'::uuid, now() - interval '1 month');
end;
$$;
