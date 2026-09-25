-- ---------------------------------------------------------------------------
-- The disposition decides which pipeline the lead lands in.
--
-- Asked for on 2026-09-22: "whatever the disposition outcome is, I want you to put it in the
-- dedicated pipeline which is reserved for specific cases, specific dispositions."
--
-- ── Why this could not happen before ───────────────────────────────────────
--
-- Every piece of the machinery already existed. `stage_dispositions` maps a disposition key to a
-- stage, one-to-one per tenant, editable from Settings → Pipelines, and `complete_disposition`
-- looks the mapping up when a call is dispositioned. What it could not do is leave the pipeline:
--
--   select sd.stage_id into v_stage_id
--     from public.stage_dispositions sd
--     join public.tenant_pipeline_stages ps on ps.id = sd.stage_id
--    where sd.tenant_id = p_tenant_id
--      and sd.disposition_key = p_disposition_key
--      and ps.pipeline_id = v_item.pipeline_id     <—— the lead's CURRENT pipeline
--      and not ps.is_archived
--
-- and the lead's `pipeline_id` was never written by a disposition at all.
--
-- The consequence was worse than a missing feature: mapping a disposition to a stage in a dedicated
-- pipeline **silently did nothing**. The lookup found no row in the current pipeline, fell through
-- to `coalesce(v_stage_id, v_item.stage_id)`, and the lead stayed exactly where it was. The
-- configuration screen accepted the mapping, the audit row recorded it, and the outcome was that
-- nothing moved. A setting that saves and has no effect is the worst of the three possible states.
--
-- ── What changes ───────────────────────────────────────────────────────────
--
--   1. The mapping may point at a stage in ANY pipeline. The same-pipeline filter is dropped.
--   2. When it does, the lead and its work item move to that stage's pipeline as well as its stage.
--
-- `unique (tenant_id, disposition_key)` on `stage_dispositions` already guarantees one destination
-- per disposition, so "the dedicated pipeline reserved for this outcome" is expressible without a
-- new table: point the mapping at the entry stage of that pipeline.
--
-- ── What deliberately does not change ──────────────────────────────────────
--
-- **An unmapped disposition still leaves the lead where it is.** That fallback is what makes this
-- safe to apply to a tenant that has configured nothing: no mapping, no movement, same behaviour as
-- today. Routing is opt-in per disposition.
--
-- **The stage and the pipeline move together, or neither moves.** They are set in one statement from
-- the same resolved stage, so a lead can never end up in pipeline A displaying a stage that belongs
-- to pipeline B — which is the state that makes a board render a lead in no column at all.
--
-- Patched into the deployed function rather than restated, because `complete_disposition` carries
-- the DNC write, the callback subtype, the verification close and the chat card, and none of that is
-- what this change is about.
-- ---------------------------------------------------------------------------

do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_disposition';

  if v_src is null then
    raise exception 'complete_disposition does not exist; apply the LA-1.12 disposition migrations first';
  end if;

  if v_src ~ 'dedicated pipeline' then
    raise notice 'the disposition already routes to its own pipeline';
    return;
  end if;

  -- 1. The mapping is no longer confined to the pipeline the lead is already in.
  v_new := replace(
    v_src,
    E'     and ps.pipeline_id = v_item.pipeline_id\n     and not ps.is_archived',
    E'     -- Any pipeline: the dedicated pipeline reserved for this disposition is the point.\n'
    || E'     and not ps.is_archived'
  );
  if v_new = v_src then
    raise exception 'the stage_dispositions lookup is not in the expected form; fix by hand';
  end if;
  v_src := v_new;

  -- 2. The lead follows the stage into its pipeline. `coalesce(..., pipeline_id)` keeps a lead put
  --    when the disposition is unmapped, which is the fallback above.
  v_new := replace(
    v_src,
    E'  update public.agent_leads\n     set stage_id = v_stage_id,\n         callback_subtype = case',
    E'  update public.agent_leads\n     set stage_id = v_stage_id,\n'
    || E'         pipeline_id = coalesce(\n'
    || E'           (select ps.pipeline_id from public.tenant_pipeline_stages ps where ps.id = v_stage_id),\n'
    || E'           pipeline_id),\n'
    || E'         callback_subtype = case'
  );
  if v_new = v_src then
    raise exception 'the agent_leads update is not in the expected form; fix by hand';
  end if;
  v_src := v_new;

  v_new := replace(
    v_src,
    E'         disposition_by = p_user_id,\n         stage_id = v_stage_id,\n         updated_at = now()',
    E'         disposition_by = p_user_id,\n         stage_id = v_stage_id,\n'
    || E'         pipeline_id = coalesce(\n'
    || E'           (select ps.pipeline_id from public.tenant_pipeline_stages ps where ps.id = v_stage_id),\n'
    || E'           pipeline_id),\n'
    || E'         updated_at = now()'
  );
  if v_new = v_src then
    raise exception 'the lead_queue update is not in the expected form; fix by hand';
  end if;

  execute v_new;
  raise notice 'a disposition now routes the lead to its dedicated pipeline';
end $$;

do $$
declare
  v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_disposition';

  if v_src ~ 'ps\.pipeline_id = v_item\.pipeline_id' then
    raise exception 'the disposition mapping is still confined to the lead''s current pipeline';
  end if;
  -- Both rows must move, or a board shows a lead in a column that is not on it.
  if (select count(*) from regexp_matches(v_src, 'pipeline_id = coalesce\(', 'g')) <> 2 then
    raise exception 'the lead and its work item do not both follow the stage into its pipeline';
  end if;
  -- And the fallback must survive: an unmapped disposition leaves the lead alone.
  if v_src !~ 'coalesce\(v_stage_id, v_item\.stage_id\)' then
    raise exception 'an unmapped disposition no longer leaves the lead where it is';
  end if;
end $$;
