-- ---------------------------------------------------------------------------
-- An inbound call can be dispositioned after a buffer handoff, and its deal row lands in the
-- pipeline its stage belongs to.
--
-- ── 1. la_active could never be dispositioned ──────────────────────────────
--
-- accept_buffer_handoff (20260912400000) moves the work item to status 'la_active' and makes the
-- licensed agent its owner. All four LA-1 disposition functions accept only
-- ('claimed', 'completed', 'dropped'):
--
--   start_disposition_walk              20260912440000   v_item.status not in (...)
--   record_disposition_answer           20260912440000   q.status in (...)
--   complete_disposition                20260917131500   q.status in (...)   (patched by 20260922220000)
--   complete_disposition_with_callback  20260913160000   q.status in (...)   (patched by 20260913360000)
--
-- so the licensed agent who accepted the handoff opened the outcome wizard and got "Claim this
-- transfer before recording an outcome" for a transfer they owned. The whole buffer flow ended in
-- a call nobody could close.
--
-- Each guard gains 'la_active'. Nothing else about ownership changes: every guard still requires
-- q.owner_user_id = p_user_id, and accept_buffer_handoff sets the owner to the licensed agent, so
-- the buffer assistant who handed it off still cannot disposition it (the route refuses the
-- assistant role anyway). 'buffer_active' and 'handed_pending' stay out on purpose: the first is
-- the assistant's, the second is in flight between two people.
--
-- ── 2. The deal row kept the old pipeline ──────────────────────────────────
--
-- 20260922220000 made the stage mapping reach any pipeline and moved agent_leads and lead_queue
-- into the stage's pipeline. The deal_flow update in the same function was left writing
--
--     pipeline_id = v_item.pipeline_id,      -- the work item's pipeline BEFORE the move
--     stage_id = v_stage_id,                 -- a stage that may belong to another pipeline
--
-- which is exactly the state 20260922220000 set out to make impossible ("a lead can never end up in
-- pipeline A displaying a stage that belongs to pipeline B"), on the one row Daily deal flow reads.
-- It now takes the resolved stage's pipeline, and keeps the old one only when the stage cannot be
-- found (an unmapped disposition keeps the lead's current stage, whose pipeline is the old one).
--
-- Written as a CASE rather than `coalesce(...)` on purpose: 20260922220000's own assertion counts
-- `pipeline_id = coalesce(` and requires exactly two (the lead and the work item). A third spelled
-- the same way would make that migration's check fail if it were ever re-run.
--
-- Both are patched into the deployed functions (pg_get_functiondef + replace), like 20260922220000
-- and 20260913360000, rather than restated: each function carries the DNC write, the callback
-- window check, the verification close and the partner card, none of which this is about.
-- Signatures, return types and grants are untouched.
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn record;
  v_new text;
  v_patched integer := 0;
begin
  for v_fn in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('start_disposition_walk', 'record_disposition_answer', 'complete_disposition', 'complete_disposition_with_callback')
  loop
    if v_fn.def ~ '''claimed'',\s*''la_active''' then
      raise notice '% already accepts la_active', v_fn.proname;
      v_patched := v_patched + 1;
      continue;
    end if;

    v_new := regexp_replace(
      v_fn.def,
      'status (not )?in \(''claimed'',\s*''completed'',\s*''dropped''\)',
      'status \1in (''claimed'', ''la_active'', ''completed'', ''dropped'')',
      'g'
    );
    if v_new = v_fn.def then
      raise exception '% does not carry the expected claimed/completed/dropped guard; fix by hand', v_fn.proname;
    end if;

    execute v_new;
    v_patched := v_patched + 1;
    raise notice '% now accepts a work item after a buffer handoff', v_fn.proname;
  end loop;

  if v_patched < 4 then
    raise exception 'only % of the four LA-1 disposition functions exist; apply the LA-1.12 migrations first', v_patched;
  end if;
end $$;

do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_disposition';

  if v_src ~ 'deal row follows the resolved stage' then
    raise notice 'the deal row already follows the stage into its pipeline';
    return;
  end if;

  v_new := replace(
    v_src,
    E'         pipeline_id = v_item.pipeline_id,\n         stage_id = v_stage_id,',
    E'         -- The deal row follows the resolved stage into its pipeline, like the lead and work item.\n'
    || E'         pipeline_id = case\n'
    || E'           when exists (select 1 from public.tenant_pipeline_stages ps where ps.id = v_stage_id)\n'
    || E'             then (select ps.pipeline_id from public.tenant_pipeline_stages ps where ps.id = v_stage_id)\n'
    || E'           else v_item.pipeline_id\n'
    || E'         end,\n'
    || E'         stage_id = v_stage_id,'
  );
  if v_new = v_src then
    raise exception 'the deal_flow update is not in the expected form; fix by hand';
  end if;

  execute v_new;
  raise notice 'the deal row now lands in the pipeline of the stage it shows';
end $$;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_fn record;
  v_src text;
begin
  for v_fn in
    select p.proname, pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('start_disposition_walk', 'record_disposition_answer', 'complete_disposition', 'complete_disposition_with_callback')
  loop
    if v_fn.def !~ '''claimed'', ''la_active'', ''completed'', ''dropped''' then
      raise exception '% still refuses a work item after a buffer handoff', v_fn.proname;
    end if;
    if v_fn.def ~ 'status (not )?in \(''claimed'',\s*''completed'',\s*''dropped''\)' then
      raise exception '% still has an unpatched status guard', v_fn.proname;
    end if;
    -- Ownership is still required everywhere: accepting la_active must not widen who may act.
    if v_fn.def !~ 'owner_user_id' then
      raise exception '% no longer checks the owner', v_fn.proname;
    end if;
  end loop;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_disposition';

  -- 20260922220000's routing clauses, restated so this patch cannot have undone them.
  if v_src ~ 'ps\.pipeline_id = v_item\.pipeline_id' then
    raise exception 'the disposition mapping is confined to the lead''s current pipeline again';
  end if;
  if (select count(*) from regexp_matches(v_src, 'pipeline_id = coalesce\(', 'g')) <> 2 then
    raise exception 'the lead and its work item do not both follow the stage into its pipeline';
  end if;
  if v_src !~ 'coalesce\(v_stage_id, v_item\.stage_id\)' then
    raise exception 'an unmapped disposition no longer leaves the lead where it is';
  end if;

  -- And this migration's own fix: the deal row no longer writes the pre-move pipeline.
  if v_src ~ 'pipeline_id = v_item\.pipeline_id,\s*stage_id = v_stage_id' then
    raise exception 'deal_flow still keeps the old pipeline while its stage moves';
  end if;
  if v_src !~ 'deal row follows the resolved stage' then
    raise exception 'deal_flow does not follow the resolved stage into its pipeline';
  end if;

  -- The callback path still checks the calling window (20260913360000).
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'complete_disposition_with_callback'
       and pg_get_functiondef(p.oid) ~ 'assert_callback_in_window'
  ) then
    raise exception 'complete_disposition_with_callback lost its calling-window check';
  end if;
end $$;
