-- LA-1.9 hardening: mapping replacement and disposition moves are one database transaction.

create or replace function public.set_stage_disposition(
  p_tenant_id uuid,
  p_stage_id uuid,
  p_disposition_key text
)
returns public.stage_dispositions
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.stage_dispositions;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  if not exists (
    select 1 from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id
    where s.id = p_stage_id and p.tenant_id = p_tenant_id and not s.is_archived
  ) then raise exception 'stage_not_found'; end if;
  delete from public.stage_dispositions where tenant_id = p_tenant_id and (stage_id = p_stage_id or disposition_key = p_disposition_key);
  insert into public.stage_dispositions (tenant_id, stage_id, disposition_key)
  values (p_tenant_id, p_stage_id, p_disposition_key)
  returning * into result;
  return result;
end;
$$;

create or replace function public.move_lead_to_disposition(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_disposition_key text
)
returns table (lead_id uuid, pipeline_id uuid, stage_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  destination record;
begin
  select s.pipeline_id, s.id as stage_id into destination
  from public.stage_dispositions d
  join public.pipeline_stages s on s.id = d.stage_id
  join public.pipelines p on p.id = s.pipeline_id and p.tenant_id = d.tenant_id
  where d.tenant_id = p_tenant_id and d.disposition_key = p_disposition_key and not s.is_archived;
  if not found then raise exception 'disposition_not_mapped'; end if;
  update public.agent_leads l set pipeline_id = destination.pipeline_id, stage_id = destination.stage_id
    where l.id = p_lead_id and l.tenant_id = p_tenant_id;
  if not found then raise exception 'lead_not_found'; end if;
  update public.lead_queue set pipeline_id = destination.pipeline_id, stage_id = destination.stage_id where lead_queue.lead_id = p_lead_id and lead_queue.tenant_id = p_tenant_id;
  update public.deal_flow set pipeline_id = destination.pipeline_id, stage_id = destination.stage_id where deal_flow.lead_id = p_lead_id and deal_flow.tenant_id = p_tenant_id;
  return query select p_lead_id, destination.pipeline_id, destination.stage_id;
end;
$$;

revoke all on function public.set_stage_disposition(uuid, uuid, text), public.move_lead_to_disposition(uuid, uuid, text) from public;
grant execute on function public.set_stage_disposition(uuid, uuid, text), public.move_lead_to_disposition(uuid, uuid, text) to service_role;
