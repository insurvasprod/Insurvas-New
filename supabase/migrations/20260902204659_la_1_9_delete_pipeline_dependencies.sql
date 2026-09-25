-- LA-1.9 / LA-1.12 integration fix: a newly-created stage receives a default
-- disposition flow. Remove that configuration transactionally before deleting
-- an unused custom pipeline, while preserving any pipeline that has lead or
-- disposition history.

create or replace function public.delete_tenant_pipeline(
  p_tenant_id uuid,
  p_pipeline_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_is_default boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_pipeline_id::text, 0));

  select p.is_default into v_is_default
  from public.pipelines p
  where p.id = p_pipeline_id and p.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'pipeline_not_found';
  end if;
  if v_is_default then
    raise exception 'default_pipeline';
  end if;
  if exists (
    select 1 from public.agent_leads l
    where l.tenant_id = p_tenant_id and l.pipeline_id = p_pipeline_id
  ) or exists (
    select 1 from public.lead_queue q
    where q.tenant_id = p_tenant_id and q.pipeline_id = p_pipeline_id
  ) or exists (
    select 1 from public.deal_flow d
    where d.tenant_id = p_tenant_id and d.pipeline_id = p_pipeline_id
  ) or exists (
    select 1
    from public.disposition_walks w
    join public.disposition_flows f on f.id = w.flow_id
    join public.pipeline_stages s on s.id = f.stage_id
    where w.tenant_id = p_tenant_id and s.pipeline_id = p_pipeline_id
  ) then
    raise exception 'pipeline_in_use';
  end if;

  delete from public.stage_dispositions d
  using public.pipeline_stages s
  where d.tenant_id = p_tenant_id
    and d.stage_id = s.id
    and s.pipeline_id = p_pipeline_id;

  delete from public.disposition_flows f
  using public.pipeline_stages s
  where f.tenant_id = p_tenant_id
    and f.stage_id = s.id
    and s.pipeline_id = p_pipeline_id;

  delete from public.pipelines p
  where p.id = p_pipeline_id and p.tenant_id = p_tenant_id;
end;
$$;

revoke all on function public.delete_tenant_pipeline(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.delete_tenant_pipeline(uuid, uuid) to service_role;
