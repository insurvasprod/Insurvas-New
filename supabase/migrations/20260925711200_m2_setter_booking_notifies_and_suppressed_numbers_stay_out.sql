-- Three Module 2 findings from the demo-readiness pass (2026-09-25), fixed by patching the LIVE
-- function bodies in place — the way 20260913380000 added the setter notification — so nothing
-- else those long functions do is retyped here. Each patch:
--   · skips itself when its marker is already present (safe to run twice);
--   · refuses to run if the text it anchors on is missing, instead of silently doing nothing.
--
-- 1. LA-2.12-3 / W2.4 — the agent is never told a setter booked them.
--    20260913380000 made book_appointment insert an agent_notifications row. 20260924120000
--    rewrote book_appointment from scratch and dropped it; every rewrite since kept it dropped.
--    17 setter bookings in the demo tenant produced 0 notifications. Restored as it was: only when
--    somebody other than the agent booked it, idempotent per appointment.
--
-- 2. LA-2.11-3 — an appointment could be booked for a number on a suppression list.
--    A lead added to the internal DNC list after import was booked (201); the dialer then refused
--    the call. book_appointment now refuses first, with APPOINTMENT_NUMBER_SUPPRESSED, right after
--    the customer's calling-window check. (lib/appointments/booking.ts maps the code to a sentence.)
--
-- 3. LA-2.24-3 — the router handed suppressed numbers to agents.
--    assign_lead_core never checked suppression, so a litigator or DNC number was assigned, sat in
--    an agent's queue as "waiting" and used a capacity slot, only to be refused at the dialer.
--    Now: "assign the next eligible lead" skips it like any lead nobody can take; assigning that
--    specific lead refuses with ASSIGNMENT_NUMBER_SUPPRESSED. Every batch caller
--    (lead_list_assignment_run, rotate_unanswered_assignments, auto_route_posted_lead) already
--    catches per-lead errors, so one suppressed number cannot abort a batch; the bulk preview
--    gets a readable reason for it. Suppressed queue items are left open, not closed — whether a
--    suppression should also close the lead is a separate product decision.

do $patch$
declare
  v_src text;
  v_new text;
begin
  -- ── 1 + 2: book_appointment ───────────────────────────────────────────────────────────────
  select pg_get_functiondef('public.book_appointment(uuid,uuid,uuid,uuid,timestamp with time zone,text,integer)'::regprocedure)
    into v_src;
  -- A body pasted through the SQL editor from Windows keeps CRLF line endings, and then no anchor
  -- below matches (the first run of this file stopped exactly there). Match — and re-create — on LF.
  v_src := replace(v_src, E'\r\n', E'\n');

  if v_src like '%[711200]%' then
    raise notice 'book_appointment already patched by 711200';
  else
    v_new := replace(
      v_src,
      E'    raise exception ''APPOINTMENT_OUTSIDE_CUSTOMER_WINDOW'';\n  end if;\n',
      E'    raise exception ''APPOINTMENT_OUTSIDE_CUSTOMER_WINDOW'';\n  end if;\n'
      || E'\n  -- [711200] A suppressed number is not booked: the call it promises would be refused.\n'
      || E'  if coalesce((select sup.suppressed\n'
      || E'                 from agent_leads l\n'
      || E'                 cross join lateral public.is_phone_suppressed(p_tenant_id, l.values->>''phone'') sup\n'
      || E'                where l.id = p_lead_id and l.tenant_id = p_tenant_id\n'
      || E'                limit 1), false) then\n'
      || E'    raise exception ''APPOINTMENT_NUMBER_SUPPRESSED'';\n'
      || E'  end if;\n'
    );
    if v_new = v_src then
      raise exception 'book_appointment: the calling-window check this patch anchors on was not found';
    end if;

    v_src := v_new;
    v_new := replace(
      v_src,
      E'  return query select v_id, p_starts_at_utc, v_minutes,',
      E'  -- [711200] Tell the agent when somebody else (a setter) booked them. Restores 20260913380000.\n'
      || E'  insert into agent_notifications (tenant_id, recipient_user_id, kind, title, body, link, source_key)\n'
      || E'  select p_tenant_id, p_agent_user_id, ''appointment_booked'',\n'
      || E'         ''New appointment booked'',\n'
      || E'         coalesce(nullif(btrim(p_notes), ''''), ''No notes from the setter.''),\n'
      || E'         ''/app/calendar?appointment='' || v_id::text,\n'
      || E'         ''appointment_booked:'' || v_id::text\n'
      || E'  where p_agent_user_id is not null and p_agent_user_id <> coalesce(p_booked_by, p_agent_user_id)\n'
      || E'  on conflict (tenant_id, recipient_user_id, source_key) do nothing;\n'
      || E'\n  return query select v_id, p_starts_at_utc, v_minutes,'
    );
    if v_new = v_src then
      raise exception 'book_appointment: the final return this patch anchors on was not found';
    end if;
    execute v_new;
    raise notice 'book_appointment now refuses suppressed numbers and notifies the agent';
  end if;

  -- ── 3a: assign_lead_core (the 7-argument body; the 6-argument one only forwards to it) ─────
  select pg_get_functiondef('public.assign_lead_core(uuid,uuid,uuid,uuid,text,uuid,boolean)'::regprocedure)
    into v_src;
  v_src := replace(v_src, E'\r\n', E'\n');

  if v_src like '%[711200]%' then
    raise notice 'assign_lead_core already patched by 711200';
  else
    v_new := replace(
      v_src,
      E'    if v_item.status not in (''unclaimed'', ''claimed'', ''buffer_active'', ''handed_pending'', ''la_active'') then raise exception ''ASSIGNMENT_WORK_ITEM_CLOSED''; end if;\n',
      E'    if v_item.status not in (''unclaimed'', ''claimed'', ''buffer_active'', ''handed_pending'', ''la_active'') then raise exception ''ASSIGNMENT_WORK_ITEM_CLOSED''; end if;\n'
      || E'    -- [711200] A suppressed number is never handed to anyone: the dialer would refuse it, and\n'
      || E'    -- meanwhile it held a capacity slot. Skip-ahead passes over it; a named lead is refused.\n'
      || E'    if coalesce((select sup.suppressed from public.is_phone_suppressed(p_tenant_id, v_lead.values->>''phone'') sup limit 1), false) then\n'
      || E'      if v_max_items > 1 then continue items; end if;\n'
      || E'      raise exception ''ASSIGNMENT_NUMBER_SUPPRESSED'';\n'
      || E'    end if;\n'
    );
    if v_new = v_src then
      raise exception 'assign_lead_core: the closed-item check this patch anchors on was not found';
    end if;
    execute v_new;
    raise notice 'assign_lead_core now keeps suppressed numbers out';
  end if;

  -- ── 3b: lead_list_assignment_run — a readable reason instead of "Refused (ASSIGNMENT_…)" ────
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'lead_list_assignment_run';
  v_src := replace(v_src, E'\r\n', E'\n');

  if v_src is null then
    raise notice 'lead_list_assignment_run not found; bulk reason left as the raw code';
  elsif v_src like '%[711200]%' then
    raise notice 'lead_list_assignment_run already patched by 711200';
  else
    v_new := replace(
      v_src,
      E'      elsif v_error = ''ASSIGNMENT_STICKY'' then\n',
      E'      elsif v_error = ''ASSIGNMENT_NUMBER_SUPPRESSED'' then  -- [711200]\n'
      || E'        v_short := ''Number is on a do-not-call list'';\n'
      || E'      elsif v_error = ''ASSIGNMENT_STICKY'' then\n'
    );
    v_new := replace(
      v_new,
      E'      elsif ''ASSIGNMENT_HOUSEHOLD_OWNED'' = any(v_fail_codes) then\n',
      E'      elsif ''ASSIGNMENT_NUMBER_SUPPRESSED'' = any(v_fail_codes) then  -- [711200]\n'
      || E'        v_short := ''Number is on a do-not-call list'';\n'
      || E'      elsif ''ASSIGNMENT_HOUSEHOLD_OWNED'' = any(v_fail_codes) then\n'
    );
    if v_new = v_src or (length(v_new) - length(v_src)) < 200 then
      raise exception 'lead_list_assignment_run: the reason branches this patch anchors on were not both found';
    end if;
    execute v_new;
    raise notice 'lead_list_assignment_run now names suppressed numbers';
  end if;

  -- ── Nothing earlier was lost ────────────────────────────────────────────────────────────────
  -- These patches edit whatever is live — book_appointment as 20260925704000 left it and
  -- assign_lead_core as 20260925702100 left it — so every earlier rule should still be there.
  -- Re-read and prove it; any failure rolls the whole file back.
  select pg_get_functiondef('public.book_appointment(uuid,uuid,uuid,uuid,timestamp with time zone,text,integer)'::regprocedure) into v_src;
  if v_src not like '%APPOINTMENT_AGENT_HAS_NO_HOURS%' then raise exception '711200 check: book_appointment lost the no-working-hours refusal (704000)'; end if;
  if v_src not like '%APPOINTMENT_OUTSIDE_CUSTOMER_WINDOW%' or v_src not like '%APPOINTMENT_SLOT_TAKEN%' or v_src not like '%APPOINTMENT_DAILY_CAP_REACHED%' then
    raise exception '711200 check: book_appointment lost an earlier refusal';
  end if;
  if v_src not like '%APPOINTMENT_NUMBER_SUPPRESSED%' or v_src not like '%agent_notifications%' then raise exception '711200 check: book_appointment patch missing'; end if;

  select pg_get_functiondef('public.assign_lead_core(uuid,uuid,uuid,uuid,text,uuid,boolean)'::regprocedure) into v_src;
  if v_src not like '%p_system_route%' or v_src not like '%least_loaded%' then raise exception '711200 check: assign_lead_core lost system routing or strategy (702100)'; end if;
  if v_src not like '%assignment_skip_events%' or v_src not like '%''licence''::text%' then raise exception '711200 check: assign_lead_core lost the licence-skip logging (702100)'; end if;
  if v_src not like '%ASSIGNMENT_NUMBER_SUPPRESSED%' then raise exception '711200 check: assign_lead_core patch missing'; end if;

  select pg_get_functiondef('public.assign_lead_core(uuid,uuid,uuid,uuid,text,uuid)'::regprocedure) into v_src;
  if v_src not like '%assign_lead_core(p_tenant_id, p_actor_user_id, p_work_item_id, p_target_user_id, p_reason, p_rotate_from_user_id, false)%' then
    raise exception '711200 check: the 6-argument assign_lead_core no longer forwards to the 7-argument one';
  end if;
end;
$patch$;
