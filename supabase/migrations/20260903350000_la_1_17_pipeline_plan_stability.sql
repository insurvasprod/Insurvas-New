-- LA-1.17: use the request values when planning the pipeline RPC. This avoids
-- a generic prepared plan after a bulk lead intake, when table statistics and
-- tenant cardinalities differ materially from the common case.
alter function public.partner_lead_pipeline_page(
  uuid, uuid, date, date, uuid, text, uuid, text, text, integer, integer
) set plan_cache_mode = force_custom_plan;
