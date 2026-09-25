-- ---------------------------------------------------------------------------
-- Settings → Pipelines: a pipeline need not belong to a partner type.
--
-- The board lists "Outbound final expense" and "Inbound transfers" with no partner type ("—") beside
-- "Partner submissions · Affiliate". The model made partner_type mandatory, so those pipelines could
-- not exist: every pipeline had to be a publisher, marketing or affiliate pipeline.
--
-- Partner routing is unchanged by this file. Every reader that routes a partner's lead looks the
-- pipeline up BY partner type (`partner_type = <the partner's type> and is_default`), and a NULL
-- never equals anything, so a pipeline with no partner type is simply never a partner default.
-- It is reached the other ways a pipeline is reached: a disposition mapped to one of its stages, a
-- lead moved into it, and — when it is the default with no partner type — leads that arrive with no
-- partner at all (list imports and vendor posts; lib/pipelines/service.ts resolveUnpartneredEntry).
--
-- What NULL needs, because the existing uniques do not cover it (NULLs are distinct in a unique):
--   · a name is unique among a tenant's pipelines with no partner type, as it is within a type;
--   · at most one of them is the default.
--
-- Also: one grouped count of leads per pipeline and stage for the settings screen, which was
-- counting with one request per stage (tenant_pipeline_lead_counts).
--
-- Additive and idempotent. The application degrades before this is applied: a pipeline with no
-- partner type answers 503 with "needs a database update", and the counts fall back to per-stage
-- counting.
-- ---------------------------------------------------------------------------

alter table public.tenant_pipelines alter column partner_type drop not null;

create unique index if not exists tenant_pipelines_unpartnered_name_idx
  on public.tenant_pipelines (tenant_id, name)
  where partner_type is null;

create unique index if not exists tenant_pipelines_one_unpartnered_default_idx
  on public.tenant_pipelines (tenant_id)
  where is_default and partner_type is null;

comment on column public.tenant_pipelines.partner_type is
  'The partner type whose leads default into this pipeline. NULL: no partner type — reached by disposition routing, by moving a lead, or (as the unpartnered default) by imports and vendor posts.';

-- ── leads per pipeline and stage, in one statement ─────────────────────────
create or replace function public.tenant_pipeline_lead_counts(p_tenant_id uuid)
returns table(pipeline_id uuid, stage_id uuid, leads bigint)
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  -- Served by agent_leads (tenant_id, pipeline_id, stage_id, created_at desc).
  select l.pipeline_id, l.stage_id, count(*)::bigint
    from public.agent_leads l
   where l.tenant_id = p_tenant_id
   group by l.pipeline_id, l.stage_id
$function$;

revoke all on function public.tenant_pipeline_lead_counts(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_pipeline_lead_counts(uuid) to service_role;
