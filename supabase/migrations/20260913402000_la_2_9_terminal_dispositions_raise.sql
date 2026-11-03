-- ---------------------------------------------------------------------------
-- LA-2.9 · every terminal disposition raises instead of terminating
--
-- Found by re-running the LA-2.9 suite after the cadence rotation was fixed. The suite had been
-- failing earlier in the file, so it had never reached the loop that walks the disposition
-- vocabulary, and this was sitting behind it:
--
--   ERROR: 55000 record "v_sched" is not assigned yet
--   DETAIL: The tuple structure of a not-yet-assigned record is indeterminate.
--   CONTEXT: PL/pgSQL function complete_dial_disposition ... line 114 at RETURN QUERY
--
-- `v_sched` is assigned only in the cadence branch. Every other branch — do_not_call,
-- wrong_number, disconnected, not_interested, did_not_qualify, application_submitted,
-- sent_to_underwriting, no_payment_method, callback_scheduled — leaves it unassigned, and the
-- final statement reads it:
--
--   case when v_new_state = 'retry' then v_sched.due_at else null end
--
-- The guard looks like it protects the read, and it does not. PL/pgSQL hands the whole expression
-- to the SQL engine with `v_sched` as a parameter, so the record has to have a tuple structure
-- before the CASE is evaluated at all. A branch that is never taken still has to be describable.
--
-- The effect is that the dialer can record a no-answer and nothing else. Every disposition that
-- ENDS a call — the agent was told never to call again, the number is wrong, the application went
-- in — throws, and LA-2.9's own criterion is that "every disposition schedules or terminates the
-- lead, none leaves it in limbo". Every one of the terminating ones left it in limbo, because the
-- writes had already happened and the function then failed, rolling them back.
--
-- Two scalars replace the record read. They are null unless the cadence branch sets them, which is
-- what the CASE was trying to express.
-- ---------------------------------------------------------------------------

do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_dial_disposition';
  if v_src is null then raise exception 'complete_dial_disposition does not exist'; end if;
  if v_src ~ 'v_due_at' then
    raise notice 'complete_dial_disposition already avoids the unassigned record';
    return;
  end if;

  -- pg_get_functiondef returns the body with whatever line endings it was created with, and this
  -- one carries CRLF. Every anchor below is written with LF, so normalise first rather than
  -- doubling each pattern. Executing the LF form re-creates the function identically apart from
  -- the line endings.
  v_src := replace(v_src, chr(13), '');

  -- The two scalars, declared next to the record they replace.
  v_new := replace(v_src, E'  v_sched record;', E'  v_sched record;\n  v_due_at timestamptz;\n  v_due_slot text;');
  if v_new = v_src then
    raise exception 'could not find the v_sched declaration';
  end if;

  -- Set them where the cadence branch already knows the answer.
  v_src := v_new;
  v_new := replace(
    v_src,
    E'      update agent_leads\n'
    || E'         set lead_state = ''retry'', next_dial_after = v_sched.due_at, next_preferred_slot = v_sched.slot\n'
    || E'       where id = v_lead;',
    E'      v_due_at := v_sched.due_at;\n'
    || E'      v_due_slot := v_sched.slot;\n'
    || E'      update agent_leads\n'
    || E'         set lead_state = ''retry'', next_dial_after = v_sched.due_at, next_preferred_slot = v_sched.slot\n'
    || E'       where id = v_lead;'
  );
  if v_new = v_src then
    raise exception 'could not find the retry branch';
  end if;

  -- And read the scalars instead of the record.
  v_src := v_new;
  v_new := replace(
    v_src,
    E'                      case when v_new_state = ''retry'' then v_sched.due_at else null end,\n'
    || E'                      case when v_new_state = ''retry'' then v_sched.slot else null end,',
    E'                      v_due_at,\n'
    || E'                      v_due_slot,'
  );
  if v_new = v_src then
    raise exception 'could not find the return statement that reads the record';
  end if;

  execute v_new;
  raise notice 'complete_dial_disposition no longer reads an unassigned record';
end $$;

-- ── assertion: every disposition in the vocabulary completes ───────────────
do $$
declare
  v_tenant uuid; v_agent uuid; v_vendor uuid; v_campaign uuid; v_tpl uuid; v_tplv integer;
  v_state text; v_lead uuid; v_q uuid; r record; d text;
  v_dispositions text[] := array['do_not_call','wrong_number','disconnected','not_interested',
                                 'did_not_qualify','application_submitted','sent_to_underwriting',
                                 'no_payment_method','no_answer','voicemail','something_new'];
begin
  select tenant_id into v_tenant from agent_leads group by tenant_id order by count(*) desc limit 1;
  if v_tenant is null then raise notice 'no leads; skipped'; return; end if;
  select template_id, template_version into v_tpl, v_tplv
    from agent_leads where tenant_id=v_tenant and product_line='term_life' limit 1;
  select tu.user_id into v_agent from tenant_users tu where tu.tenant_id=v_tenant limit 1;
  select st.state into v_state from state_timezones st
   where tenant_can_dial_now(v_tenant, st.state, null, now()) order by st.state limit 1;
  if v_state is null then raise notice 'no dialable state right now; skipped'; return; end if;

  insert into tenant_lead_vendors (tenant_id, name, lead_type)
  values (v_tenant, 'LA-2.9 repair probe', 'list') returning id into v_vendor;
  insert into tenant_campaigns (tenant_id, vendor_id, name, lead_type, status, scrub_status, scrubbed_at)
  values (v_tenant, v_vendor, 'LA-2.9 repair probe', 'list', 'active', 'scrubbed', now())
  returning id into v_campaign;

  foreach d in array v_dispositions loop
    insert into agent_leads (tenant_id, campaign_id, template_id, template_version, product_line, lead_state, values)
    values (v_tenant, v_campaign, v_tpl, v_tplv, 'term_life', 'fresh',
            jsonb_build_object('phone', '60255598' || lpad((array_position(v_dispositions, d))::text, 2, '0'),
                               'state', v_state, 'first_name', 'Disp'))
    returning id into v_lead;
    insert into lead_queue (tenant_id, lead_id, product_line, stage_key, status, tier)
    values (v_tenant, v_lead, 'term_life', 'new', 'claimed', 100) returning id into v_q;

    select * into r from complete_dial_disposition(v_tenant, v_q, v_agent, d, now(), null);
    if r.lead_state is null then
      raise exception 'disposition % returned no lead state', d;
    end if;
    if r.lead_state = 'retry' and r.next_dial_after is null then
      raise exception 'disposition % said retry with no date', d;
    end if;
    if r.lead_state <> 'retry' and r.next_dial_after is not null then
      raise exception 'disposition % is terminal but carried a next dial date', d;
    end if;

    delete from tenant_call_attempts where tenant_id=v_tenant and lead_id=v_lead;
    delete from lead_queue where id=v_q;
    delete from agent_leads where id=v_lead;
  end loop;

  delete from tenant_do_not_call where tenant_id = v_tenant and phone_digits like '60255598%';
  delete from tenant_campaigns where id=v_campaign;
  delete from tenant_lead_vendors where id=v_vendor;
  raise notice 'LA-2.9: all % dispositions complete without raising', array_length(v_dispositions, 1);
end $$;
