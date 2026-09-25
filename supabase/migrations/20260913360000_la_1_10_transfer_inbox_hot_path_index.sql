-- LA-1.10 performance repair identified by the baseline QA run.
-- The original index migration is not present in the shared project's live index inventory.
create index if not exists lead_queue_tenant_status_queued_idx
  on public.lead_queue (tenant_id, status, queued_at asc);
