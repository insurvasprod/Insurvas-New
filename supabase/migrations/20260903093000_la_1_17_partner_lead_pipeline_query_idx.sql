-- LA-1.17: support the primary partner-ordered read and its latest-outcome lookup.

create index if not exists lead_queue_partner_queued_idx
  on public.lead_queue (tenant_id, partner_id, queued_at desc);

create index if not exists deal_flow_partner_lead_updated_idx
  on public.deal_flow (tenant_id, partner_id, lead_id, updated_at desc);
