-- LA-1.17 partner lead pipeline: make the partner-scoped read path cheap and notify
-- the owning partner about lead state changes without exposing lead data in realtime.

create index if not exists agent_leads_partner_created_idx
  on public.agent_leads (tenant_id, partner_id, created_at desc);

create index if not exists lead_queue_partner_stage_updated_idx
  on public.lead_queue (tenant_id, partner_id, stage_id, updated_at desc);

create index if not exists lead_queue_partner_status_updated_idx
  on public.lead_queue (tenant_id, partner_id, status, updated_at desc);

create index if not exists deal_flow_partner_updated_idx
  on public.deal_flow (tenant_id, partner_id, updated_at desc);

create or replace function public.broadcast_partner_lead_change()
returns trigger
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.partner_id is null then return new; end if;
  begin
    perform realtime.send(
      jsonb_build_object('partner_id', new.partner_id, 'lead_id', new.lead_id, 'work_item_id', new.id),
      'lead_changed',
      'partner-pipeline:' || new.partner_id::text,
      false
    );
  exception when others then
    -- Durable reads remain the source of truth. Realtime is an acceleration only.
    null;
  end;
  return new;
end;
$$ language plpgsql;

drop trigger if exists lead_queue_partner_pipeline_broadcast on public.lead_queue;
create trigger lead_queue_partner_pipeline_broadcast
after insert or update of stage_id, status, disposition, disposition_at, updated_at on public.lead_queue
for each row execute function public.broadcast_partner_lead_change();

revoke all on function public.broadcast_partner_lead_change() from public, anon, authenticated, tenant_app;
