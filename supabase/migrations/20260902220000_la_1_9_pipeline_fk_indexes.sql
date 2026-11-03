-- LA-1.9: cover the composite pipeline/stage foreign keys used by tenant-scoped lookups.
CREATE INDEX IF NOT EXISTS agent_leads_pipeline_stage_idx
  ON public.agent_leads (pipeline_id, stage_id);

CREATE INDEX IF NOT EXISTS lead_queue_pipeline_stage_idx
  ON public.lead_queue (pipeline_id, stage_id);

CREATE INDEX IF NOT EXISTS deal_flow_pipeline_stage_idx
  ON public.deal_flow (pipeline_id, stage_id);

CREATE INDEX IF NOT EXISTS stage_dispositions_stage_id_idx
  ON public.stage_dispositions (stage_id);
