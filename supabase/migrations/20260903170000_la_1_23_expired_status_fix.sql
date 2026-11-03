-- LA-1.23: later LA-1 migrations rebuild lead_queue_status_check, so preserve the new terminal
-- state after the complete LA-1 migration sequence as well as when the SLA migration is replayed.
alter table public.lead_queue drop constraint if exists lead_queue_status_check;
alter table public.lead_queue add constraint lead_queue_status_check
  check (status in ('unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active', 'completed', 'closed', 'dropped', 'expired'));
