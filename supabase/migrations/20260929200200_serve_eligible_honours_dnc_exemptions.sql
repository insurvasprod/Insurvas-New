-- M2 LA-2.3-3 · a number with an owner-recorded DNC exemption re-enters the queue.
--
-- APPLY AFTER 20260925709700 (tenant_dnc_exemptions and dnc_exemption_active_id). That file makes
-- is_phone_suppressed and tenant_phone_suppression_hits skip an exempted federal or state DNC hit,
-- but serve_eligible (live since 20260925711400) reads tenant_suppression_list directly as an
-- index anti-join, so an exempted number stayed out of Serve next, the queue list and the pick.
--
-- An IN-PLACE edit of the live body (the rule for these four functions): one single-line anchor,
-- counted after normalising CRLF, is replaced so the anti-join ignores a federal_dnc / state_dnc row
-- while an active exemption covers the number. The agency's own list, the internal DNC list and
-- litigator rows are untouched, which is the user's decision: an exemption clears registry DNC only.
-- Every other rule 20260925711400 asserts is re-asserted below.

do $$
declare
  v_sig regprocedure := 'public.serve_eligible(uuid,uuid,timestamptz,boolean)'::regprocedure;
  v_body text;
  v_anchor text := 'where s.tenant_id = p_tenant_id and s.phone_digits = d.digits)';
  v_new text := 'where s.tenant_id = p_tenant_id and s.phone_digits = d.digits and not (s.list_type in (''federal_dnc'', ''state_dnc'') and public.dnc_exemption_active_id(p_tenant_id, d.digits, p_now) is not null))';
  v_count integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929200200: skipped, % cannot create in public', current_user;
    return;
  end if;
  if to_regprocedure('public.dnc_exemption_active_id(uuid,text,timestamp with time zone)') is null then
    raise exception '20260929200200: apply 20260925709700 (DNC exemptions) first';
  end if;

  v_body := replace(pg_get_functiondef(v_sig), E'\r\n', E'\n');
  if position(v_new in v_body) > 0 then
    raise notice '20260929200200: serve_eligible already honours DNC exemptions';
    return;
  end if;
  v_count := (length(v_body) - length(replace(v_body, v_anchor, ''))) / length(v_anchor);
  if v_count <> 1 then
    raise exception '20260929200200: expected the suppression anti-join once in serve_eligible, found %', v_count;
  end if;
  execute replace(v_body, v_anchor, v_new);
  -- 20260929203000 generates serve_eligible_ids from serve_eligible's text. If this file is ever
  -- re-run after it, regenerate the copy so the two rulebooks stay identical.
  if to_regprocedure('public.serve_eligible_ids_regenerate()') is not null then
    perform public.serve_eligible_ids_regenerate();
  end if;
end
$$;

do $$
declare
  v_body text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929200200: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  v_body := replace(pg_get_functiondef('public.serve_eligible(uuid,uuid,timestamptz,boolean)'::regprocedure), E'\r\n', E'\n');
  if position('public.dnc_exemption_active_id(p_tenant_id, d.digits, p_now) is not null' in v_body) = 0 then
    raise exception '20260929200200: serve_eligible does not honour DNC exemptions';
  end if;
  -- The internal DNC list is never cleared by an exemption.
  if position('x.phone_digits = d.digits and x.is_active)' in v_body) = 0 then
    raise exception '20260929200200: the internal do-not-call anti-join changed';
  end if;
  -- Every rule 20260925711400 asserts survives.
  if position('p_pool_ok' in v_body) = 0 then raise exception '20260929200200: the capacity gate is gone'; end if;
  if position('callback_work_item_holder(p_tenant_id, q.id), public.lead_queue_assignee(p_tenant_id, q.id)) = p_agent_user_id' in v_body) = 0 then
    raise exception '20260929200200: holder-first reclaims are gone';
  end if;
  if position('public.callback_tier_due(p_tenant_id, t.work_item_id, p_now)' in v_body) = 0 then raise exception '20260929200200: tier 2 is no longer callback_tier_due'; end if;
  if position('u.posted_at >= p_now - interval ''5 minutes'' and u.attempts_made = 0 then 1' in v_body) = 0 then raise exception '20260929200200: tier 1 no longer requires attempts_made = 0'; end if;
  if position('and u.recycled' in v_body) = 0 then raise exception '20260929200200: a recycled retry no longer goes to tier 6'; end if;
  if position('public.campaigns_servable' in v_body) = 0 then raise exception '20260929200200: the scrub gate (campaigns_servable) is gone'; end if;
  if position('holdout_bucket' in v_body) = 0 then raise exception '20260929200200: the holdout cohort is gone'; end if;
  if position('public.agent_may_work_state(p_tenant_id, p_agent_user_id, tz.state)' in v_body) = 0 then raise exception '20260929200200: the licence gate is gone'; end if;
end
$$;
