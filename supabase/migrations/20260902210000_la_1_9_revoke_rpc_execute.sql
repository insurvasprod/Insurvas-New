-- LA-1.9: PostgreSQL grants EXECUTE on newly-created functions to PUBLIC by default.
-- These functions are called only by the server-side service-role pipeline service.
REVOKE EXECUTE ON FUNCTION public.seed_default_pipelines(uuid) FROM PUBLIC, anon, authenticated, tenant_app;
REVOKE EXECUTE ON FUNCTION public.seed_pipelines_after_tenant_insert() FROM PUBLIC, anon, authenticated, tenant_app;
REVOKE EXECUTE ON FUNCTION public.reorder_pipeline_stages(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated, tenant_app;
REVOKE EXECUTE ON FUNCTION public.archive_pipeline_stage(uuid, uuid) FROM PUBLIC, anon, authenticated, tenant_app;
REVOKE EXECUTE ON FUNCTION public.set_stage_disposition(uuid, uuid, text) FROM PUBLIC, anon, authenticated, tenant_app;
REVOKE EXECUTE ON FUNCTION public.move_lead_to_disposition(uuid, uuid, text) FROM PUBLIC, anon, authenticated, tenant_app;

GRANT EXECUTE ON FUNCTION public.seed_default_pipelines(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.seed_pipelines_after_tenant_insert() TO service_role;
GRANT EXECUTE ON FUNCTION public.reorder_pipeline_stages(uuid, uuid, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.archive_pipeline_stage(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_stage_disposition(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.move_lead_to_disposition(uuid, uuid, text) TO service_role;
