-- LA-1.17: keep the bounded pipeline aggregates in memory for the supported
-- 5,000-row export window. Scope this to the RPC instead of changing the
-- project's global memory policy.
alter function public.partner_lead_pipeline_page(
  uuid, uuid, date, date, uuid, text, uuid, text, text, integer, integer
) set work_mem = '16MB';
