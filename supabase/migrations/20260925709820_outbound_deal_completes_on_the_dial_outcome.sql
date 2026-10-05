-- ---------------------------------------------------------------------------
-- LA-2.14-5 · an outbound application's deal-flow row is completed by the call's outcome
--
-- Found 2026-09-25: after "Interested, start application" and the dialer's application_submitted
-- outcome, the deal-flow row stayed 'partial' with no call result, its stage differed from the
-- lead's (stage_drift true in the deal-flow report) and the verification session stayed open. The
-- inbound disposition wizard (20260917131500) completes all of that on the outcome. The dialer's
-- outcome function, complete_existing_dial_disposition, never touched deal_flow.
--
-- The fix, patched into the LIVE body (20260925711300 edited it in place), before the line that
-- tells the agent where the lead went:
--
--   On every outcome that ends the call (not a retry), for the lead's deal-flow row that is still
--   'partial': status 'completed', call_result = the outcome, disposition_at / disposition_by, and
--   the pipeline and stage the lead now has, so the row carries no stage drift. The verification
--   session the application opened on this work item closes, as inbound's does.
--
--   A retry (no answer, voicemail, busy) means the call did not finish, so the row and the session
--   stay open for the next attempt.
--
--   The application case is not touched. LA-3's status model (docs/la3/STATUS-MODEL.md section 5,
--   approved 2026-09-28) owns the case: it stays open until an attempt decides it (won or lost),
--   and nothing writes the legacy 'submitted' / 'closed' values.
--
-- Single-line anchor, CRLF normalised first (bodies pasted through the SQL editor are stored with
-- CRLF). Re-running is a no-op.
-- ---------------------------------------------------------------------------

do $$
declare
  v_src text;
  v_anchor constant text := '  -- Say where it went. The agent is told the lead closed; without this they are not told it';
  v_marker constant text := '-- [709820] LA-2.14-5';
  v_block constant text := $blk$  -- [709820] LA-2.14-5: the call's outcome completes an outbound deal row as inbound's does.
  if v_new_state <> 'retry' then
    update public.deal_flow
       set status = 'completed',
           call_result = p_disposition,
           disposition_at = v_now,
           disposition_by = p_agent_user_id,
           pipeline_id = coalesce(v_stage_pipeline, v_lead.pipeline_id, pipeline_id),
           stage_id = coalesce(v_stage_id, v_lead.stage_id, stage_id),
           updated_at = v_now
     where tenant_id = p_tenant_id and lead_id = v_lead.id and status = 'partial';
    update public.tenant_verification_sessions
       set status = 'closed',
           ended_at = coalesce(ended_at, v_now),
           completed_at = coalesce(completed_at, v_now),
           updated_at = v_now,
           last_actor_id = p_agent_user_id
     where tenant_id = p_tenant_id and work_item_id = v_item.id and ended_at is null;
  end if;
$blk$;
  v_count integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709820: skipped, % cannot create in public', current_user;
    return;
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_existing_dial_disposition';
  if v_src is null then
    raise exception 'complete_existing_dial_disposition does not exist';
  end if;
  v_src := replace(v_src, E'\r\n', E'\n');

  if strpos(v_src, v_marker) > 0 then
    raise notice 'complete_existing_dial_disposition already completes the deal row';
    return;
  end if;
  v_count := (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor);
  if v_count <> 1 then
    raise exception 'the anchor line is in complete_existing_dial_disposition % times, expected once, fix by hand', v_count;
  end if;

  execute replace(v_src, v_anchor, v_block || v_anchor);
  raise notice 'complete_existing_dial_disposition now completes the outbound deal row';
end $$;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_src text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709820: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_existing_dial_disposition';
  if strpos(v_src, '-- [709820] LA-2.14-5') = 0 or v_src !~ 'update public\.deal_flow' then
    raise exception 'complete_existing_dial_disposition does not complete the deal row';
  end if;
  -- What the function did before must survive: 711300's stage history and the queue write.
  if strpos(v_src, 'tenant_lead_stage_events') = 0 or strpos(v_src, 'update public.lead_queue') = 0
     or strpos(v_src, 'CALL_ATTEMPT_ALREADY_DISPOSITIONED') = 0 then
    raise exception 'the patch lost part of complete_existing_dial_disposition';
  end if;
  -- The deal update comes after the queue write and before the reply, so a failure rolls it all back.
  if strpos(v_src, 'update public.deal_flow') < strpos(v_src, 'update public.lead_queue') then
    raise exception 'the deal row is completed before the queue row is written';
  end if;
end $$;
