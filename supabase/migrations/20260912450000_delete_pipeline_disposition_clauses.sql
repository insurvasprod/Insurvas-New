-- Restore the two disposition clauses in delete_tenant_pipeline.
--
-- 20260912390000 ported this function for LA-1.9 and deliberately dropped two clauses, with a note
-- in its own header saying they "must come back when LA-1.12 lands and brings disposition_walks with
-- it". LA-1.12 landed in 20260912430000. The clauses did not come back, and deleting a pipeline now
-- fails:
--
--   23503 update or delete on table "tenant_pipeline_stages" violates foreign key constraint
--         "tenant_disposition_flows_stage_id_fkey" on table "tenant_disposition_flows"
--
-- Deleting the pipeline cascades to its stages; each stage has a disposition flow hanging off it by
-- a restricting foreign key, so the cascade is refused. Every stage now has one, because
-- 20260912430000 backfilled 682 of them.
--
-- The omission was correct when it was made and wrong the moment LA-1.12 landed. Writing the
-- carried-forward note was not enough on its own -- I wrote it, then did not read it back when the
-- dependency it was waiting on arrived. A note about a future migration is only useful if something
-- checks it at the point the future arrives; `verify-pipelines` did, one task later.
--
-- Both clauses return, pointing at this application's tables rather than the CRM's:
--
--   the in-use guard   refuses deletion while a disposition walk references one of the stages,
--                      now that disposition_walks exists and can hold rows
--   the cleanup        clears tenant_disposition_flows for the stages about to disappear
--
-- public.disposition_flows, the CRM's bigint table, is still not touched by this function. That part
-- of the original omission stands.

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
  from public.tenant_pipelines p
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
    -- Restored: a pipeline whose stages have been walked is in use, whatever the lead tables say.
    select 1
    from public.disposition_walks w
    join public.tenant_disposition_flows f on f.id = w.flow_id
    join public.tenant_pipeline_stages s on s.id = f.stage_id
    where w.tenant_id = p_tenant_id and s.pipeline_id = p_pipeline_id
  ) then
    raise exception 'pipeline_in_use';
  end if;

  delete from public.stage_dispositions d
  using public.tenant_pipeline_stages s
  where d.tenant_id = p_tenant_id
    and d.stage_id = s.id
    and s.pipeline_id = p_pipeline_id;

  -- Restored: the flows are configuration belonging to the stages, and the stages are about to be
  -- cascaded away. Without this the foreign key refuses the delete.
  delete from public.tenant_disposition_flows f
  using public.tenant_pipeline_stages s
  where f.tenant_id = p_tenant_id
    and f.stage_id = s.id
    and s.pipeline_id = p_pipeline_id;

  delete from public.tenant_pipelines p
  where p.id = p_pipeline_id and p.tenant_id = p_tenant_id;
end;
$$;

revoke all on function public.delete_tenant_pipeline(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.delete_tenant_pipeline(uuid, uuid) to service_role;
