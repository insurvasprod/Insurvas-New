-- Inbound transfers, part 3 of 4: what an inbound disposition writes, and the buffer on the deal.
-- Needs 20260925709850 (the 'inbound' stage-history source and deal_flow.buffer_agent).
--
--   LA-1.12-10  complete_disposition already wrote the work item, the audit event, the call end, the
--               lead's stage, the deal row, the partner outcome card and the DNC list. Two targets
--               were missing, and are added here:
--                 - tenant_lead_stage_events: a disposition that moves the lead records the move,
--                   from where to where, which outcome and who, with source 'inbound'. Every other
--                   stage change already writes this history (board, table, list, lead page, owner
--                   fix, and the dialer from Design 3's 20260925711300).
--                 - tenant_lead_activity: the served row the claim opened gets dispositioned_at and
--                   the disposition. A transfer that reached its agent through a buffer handoff has
--                   no served row (the served trigger fires on 'claimed' only), so one is written.
--                   Deal flow's history column reads exactly this table.
--               It also carries the buffer who worked the call onto the deal row.
--   LA-1.13-2   list_deal_flow_report returns buffer_agent and buffer_agent_name on every row.
--
-- Both functions are edited IN PLACE from their live source, not restated: complete_disposition is
-- shared with the callback path (complete_disposition_with_callback calls it) and other work may
-- restate it in parallel, and list_deal_flow_report is 10 kB. Each anchor is one line, counted
-- against the live source before this file was written (each occurs exactly once), and CRLF is
-- normalised first because functions pasted through the SQL editor are stored with CRLF. A missing
-- anchor raises, so a changed definition fails loudly instead of being half-edited. Re-running is a
-- no-op: each edit checks for its own marker first.

do $migration$
declare
  v_sig regprocedure := 'public.complete_disposition(uuid,uuid,uuid,uuid,text,text)'::regprocedure;
  v_def text;
  v_anchor_declare constant text := E'\n  v_partner_card_error text;\n';
  v_anchor_from constant text := E'\n  v_status := v_disposition.closes_as;\n';
  v_anchor_walk constant text := E'\n  update public.disposition_walks\n';
  v_block text;
begin
  v_def := replace(pg_get_functiondef(v_sig), E'\r\n', E'\n');
  if position('''inbound'', p_user_id' in v_def) > 0 then
    raise notice '20260925709870: complete_disposition already writes inbound history';
    return;
  end if;
  if (length(v_def) - length(replace(v_def, v_anchor_declare, ''))) / length(v_anchor_declare) <> 1
     or (length(v_def) - length(replace(v_def, v_anchor_from, ''))) / length(v_anchor_from) <> 1
     or (length(v_def) - length(replace(v_def, v_anchor_walk, ''))) / length(v_anchor_walk) <> 1 then
    raise exception '20260925709870: complete_disposition no longer has exactly one of each anchor, edit it by hand';
  end if;

  v_def := replace(v_def, v_anchor_declare, v_anchor_declare
    || E'  v_from_pipeline_id uuid;\n'
    || E'  v_from_stage_id uuid;\n');

  v_def := replace(v_def, v_anchor_from, v_anchor_from
    || E'  -- LA-1.12-10: where the lead was before this outcome moves it.\n'
    || E'  select l.pipeline_id, l.stage_id into v_from_pipeline_id, v_from_stage_id\n'
    || E'    from public.agent_leads l\n'
    || E'   where l.id = v_item.lead_id and l.tenant_id = p_tenant_id;\n');

  v_block :=
       E'\n  -- LA-1.12-10: the move, in the stage history every other stage change writes.\n'
    || E'  if v_stage_id is not null and v_stage_id is distinct from coalesce(v_from_stage_id, v_item.stage_id) then\n'
    || E'    insert into public.tenant_lead_stage_events\n'
    || E'      (tenant_id, lead_id, from_pipeline_id, from_stage_id, to_pipeline_id, to_stage_id, disposition_key, source, actor_user_id)\n'
    || E'    select p_tenant_id, v_item.lead_id, coalesce(v_from_pipeline_id, v_item.pipeline_id), coalesce(v_from_stage_id, v_item.stage_id),\n'
    || E'           ps.pipeline_id, v_stage_id, v_disposition.disposition_key, ''inbound'', p_user_id\n'
    || E'      from public.tenant_pipeline_stages ps\n'
    || E'     where ps.id = v_stage_id;\n'
    || E'  end if;\n'
    || E'  -- LA-1.12-10: the outcome on the activity row the claim opened, or a row of its own.\n'
    || E'  update public.tenant_lead_activity a\n'
    || E'     set dispositioned_at = now(), disposition = v_disposition.disposition_key, updated_at = now()\n'
    || E'   where a.id = (\n'
    || E'     select a2.id from public.tenant_lead_activity a2\n'
    || E'      where a2.tenant_id = p_tenant_id and a2.work_item_id = v_item.id and a2.dispositioned_at is null\n'
    || E'      order by a2.served_at desc\n'
    || E'      limit 1);\n'
    || E'  if not found then\n'
    || E'    insert into public.tenant_lead_activity (tenant_id, work_item_id, lead_id, campaign_id, agent_user_id, served_at, dispositioned_at, disposition)\n'
    || E'    select p_tenant_id, v_item.id, v_item.lead_id, l.campaign_id, p_user_id, coalesce(v_item.claimed_at, now()), now(), v_disposition.disposition_key\n'
    || E'      from public.agent_leads l\n'
    || E'     where l.id = v_item.lead_id and l.tenant_id = p_tenant_id;\n'
    || E'  end if;\n'
    || E'  -- LA-1.13-2: the buffer who worked the call, on the deal row.\n'
    || E'  if v_item.buffer_user_id is not null then\n'
    || E'    update public.deal_flow set buffer_agent = coalesce(buffer_agent, v_item.buffer_user_id)\n'
    || E'     where lead_id = v_item.lead_id and tenant_id = p_tenant_id and buffer_agent is null;\n'
    || E'  end if;\n';
  v_def := replace(v_def, v_anchor_walk, v_block || v_anchor_walk);

  execute v_def;
end;
$migration$;

do $migration$
declare
  v_sig regprocedure := 'public.list_deal_flow_report(uuid,date,date,uuid,text,uuid,text,integer,integer,text,text,uuid)'::regprocedure;
  v_def text;
  v_anchor_column constant text := E'\n    d.worked_by, d.manual_entry, d.created_at, d.updated_at,\n';
  v_anchor_name constant text := E'\n      ''worked_by_name'', wu.name,\n';
  v_anchor_join constant text := E'\n  left join public.users wu on wu.id = x.worked_by\n';
begin
  v_def := replace(pg_get_functiondef(v_sig), E'\r\n', E'\n');
  if position('d.buffer_agent' in v_def) > 0 then
    raise notice '20260925709870: list_deal_flow_report already returns the buffer agent';
    return;
  end if;
  if (length(v_def) - length(replace(v_def, v_anchor_column, ''))) / length(v_anchor_column) <> 1
     or (length(v_def) - length(replace(v_def, v_anchor_name, ''))) / length(v_anchor_name) <> 1
     or (length(v_def) - length(replace(v_def, v_anchor_join, ''))) / length(v_anchor_join) <> 1 then
    raise exception '20260925709870: list_deal_flow_report no longer has exactly one of each anchor, edit it by hand';
  end if;
  v_def := replace(v_def, v_anchor_column, E'\n    d.worked_by, d.buffer_agent, d.manual_entry, d.created_at, d.updated_at,\n');
  v_def := replace(v_def, v_anchor_name, v_anchor_name || E'      ''buffer_agent_name'', bu.name,\n');
  v_def := replace(v_def, v_anchor_join, v_anchor_join || E'  left join public.users bu on bu.id = x.buffer_agent\n');
  execute v_def;
end;
$migration$;

-- An in-place CREATE OR REPLACE keeps each function's owner and grants. Restated anyway.
revoke all on function public.complete_disposition(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.complete_disposition(uuid, uuid, uuid, uuid, text, text) to service_role;
revoke all on function public.list_deal_flow_report(uuid, date, date, uuid, text, uuid, text, integer, integer, text, text, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.list_deal_flow_report(uuid, date, date, uuid, text, uuid, text, integer, integer, text, text, uuid) to service_role;

-- ── assertions ──────────────────────────────────────────────────────────────
do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709870: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'complete_disposition'
                  and position('insert into public.tenant_lead_stage_events' in prosrc) > 0
                  and position('update public.tenant_lead_activity a' in prosrc) > 0
                  and position('buffer_agent = coalesce(buffer_agent, v_item.buffer_user_id)' in prosrc) > 0
                  -- the edit went in before the walk is closed, not after the return
                  and position('insert into public.tenant_lead_stage_events' in prosrc) < position('update public.disposition_walks' in prosrc)) then
    raise exception '20260925709870: complete_disposition does not write stage history, activity and the buffer';
  end if;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'list_deal_flow_report'
                  and position('d.buffer_agent' in prosrc) > 0 and position('''buffer_agent_name'', bu.name' in prosrc) > 0) then
    raise exception '20260925709870: list_deal_flow_report does not return the buffer agent';
  end if;
  if has_function_privilege('anon', 'public.complete_disposition(uuid, uuid, uuid, uuid, text, text)', 'execute') then
    raise exception '20260925709870: complete_disposition is callable from the browser';
  end if;
  -- Coverage: LA-1.12-10 (stage history, activity), LA-1.13-2 (buffer on the deal and in the report).
end $$;
