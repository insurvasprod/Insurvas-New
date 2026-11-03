-- LA-1 audit · two state fixes.
--
-- 1. Default publisher disposition mappings are seeded ONCE per pipeline.
--    ensureDefaultPublisherDispositionMappings (lib/pipelines/service.ts) ran on every outcome and
--    re-inserted any default mapping the agency had removed, so a deleted mapping came back on the
--    next call. tenant_pipelines.default_mappings_seeded_at records the first seeding; the seeder
--    does nothing once it is set. Every publisher pipeline that already has a mapping is marked
--    seeded here, so nothing an agency removed before today is resurrected either.
--
-- 2. Buffer handoffs expire on a clock, not only when someone reads them.
--    expire_buffer_handoffs(tenant) ran lazily (on the licensed agent's reads and on a new offer),
--    so a buffer agent whose target never opened the floor stayed on handed_pending past the
--    deadline. pg_cron now runs it every minute for every tenant with an overdue pending handoff.
--    To stop it:  select cron.unschedule('la1-buffer-handoff-expiry');

alter table public.tenant_pipelines
  add column if not exists default_mappings_seeded_at timestamptz;

comment on column public.tenant_pipelines.default_mappings_seeded_at is
  'LA-1 audit: when the default publisher disposition mappings were seeded. Once set they are never re-seeded, so a mapping the agency removed stays removed.';

update public.tenant_pipelines p
   set default_mappings_seeded_at = now()
 where p.default_mappings_seeded_at is null
   and p.partner_type = 'publisher'
   and exists (
     select 1 from public.stage_dispositions sd
       join public.tenant_pipeline_stages s on s.id = sd.stage_id
      where sd.tenant_id = p.tenant_id and s.pipeline_id = p.id
   );

create or replace function public.expire_all_buffer_handoffs()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_tenant uuid;
  v_total integer := 0;
begin
  for v_tenant in
    select distinct h.tenant_id from public.buffer_handoffs h
     where h.status = 'pending' and h.expires_at <= now()
  loop
    v_total := v_total + public.expire_buffer_handoffs(v_tenant);
  end loop;
  return v_total;
end;
$$;

revoke all on function public.expire_all_buffer_handoffs() from public, anon, authenticated, tenant_app;
grant execute on function public.expire_all_buffer_handoffs() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'la1-buffer-handoff-expiry';
    perform cron.schedule('la1-buffer-handoff-expiry', '* * * * *', $job$select public.expire_all_buffer_handoffs()$job$);
  else
    raise notice '20261015595000: pg_cron is not installed; buffer handoffs still expire on read only';
  end if;
end
$$;

-- ─── self-check ──────────────────────────────────────────────────────────────────────────────────
-- The job's own statement is run here, so a job that would fail every minute fails the apply instead.
do $$
begin
  perform public.expire_all_buffer_handoffs();
  if exists (select 1 from public.buffer_handoffs where status = 'pending' and expires_at <= now()) then
    raise exception '20261015595000: overdue pending handoffs remain after expire_all_buffer_handoffs()';
  end if;
  if exists (
    select 1 from public.tenant_pipelines p
     where p.partner_type = 'publisher' and p.default_mappings_seeded_at is null
       and exists (select 1 from public.stage_dispositions sd join public.tenant_pipeline_stages s on s.id = sd.stage_id where sd.tenant_id = p.tenant_id and s.pipeline_id = p.id)
  ) then
    raise exception '20261015595000: a publisher pipeline with mappings is not marked seeded';
  end if;
end
$$;
