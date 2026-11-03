alter table public.agent_lead_import_batches
  add column if not exists completed_at timestamptz;
