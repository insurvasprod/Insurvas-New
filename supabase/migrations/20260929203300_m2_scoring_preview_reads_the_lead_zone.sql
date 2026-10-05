-- M2 LA-2.2-4 · the scoring queue preview reads a lead's own dial_timezone, as the serve does.
--
-- APPLY AFTER 20260929203000 (it refuses to run before serve_eligible_ids_regenerate exists).
--
-- scoring_queue_preview works the calling window out once per (state, campaign). A lead with its
-- own dial_timezone (a split-zone ZIP, the FL panhandle or middle and west TN) was judged on its
-- state's clock, so the preview could list as servable a lead the serve refuses, or hold back one it
-- serves. The window key is now (state, campaign, dial_timezone), and a zoned lead is asked about
-- at the instant whose wall clock in the state's zone equals the lead's wall clock, the same rule
-- serve_eligible applies since 20260929203000. The state's rules, Sunday and statutes still apply,
-- only the clock moves. A zone that is no state's zone is refused. The held-back list names the
-- lead's own zone.
--
-- An IN-PLACE edit of the live body: nine single-line anchors, each counted exactly once after
-- normalising CRLF. Every other line is untouched, and the rules it already carried are asserted.

do $patch$
declare
  v_sig regprocedure := 'public.scoring_queue_preview(uuid,uuid,integer)'::regprocedure;
  v_body text;
  v_pair text[];
  v_pairs text[][] := array[
    array['           l.values->>''state'' as raw_state,',
          '           l.values->>''state'' as raw_state,' || E'\n' ||
          '           -- [203300] LA-2.2-4: the lead''s own zone, when it has one, is its window''s clock' || E'\n' ||
          '           l.dial_timezone as dial_tz,'],
    array['    select k.raw_state, k.campaign_id, k.can_dial,',
          '    select k.raw_state, k.campaign_id, k.dial_tz, k.can_dial,'],
    array['           w.reason as window_reason, w.zone, w.start_minute, w.local_minute',
          '           w.reason as window_reason, coalesce(k.dial_tz, w.zone) as zone, w.start_minute, w.local_minute'],
    array['        select d.raw_state, d.campaign_id,',
          '        select d.raw_state, d.campaign_id, d.dial_tz, d.at_lead_clock,'],
    array['               tenant_can_dial_now(p_tenant_id, d.raw_state, d.campaign_id, v_now) as can_dial',
          '               coalesce(tenant_can_dial_now(p_tenant_id, d.raw_state, d.campaign_id, d.at_lead_clock), false) as can_dial'],
    array['          from (select distinct u.raw_state, u.campaign_id from due u) d',
          '          from (select distinct u.raw_state, u.campaign_id, u.dial_tz,' || E'\n' ||
          '                       case when u.dial_tz is null then v_now' || E'\n' ||
          '                            when u.dial_tz in (select tz.timezone from state_timezones tz)' || E'\n' ||
          '                              then ((v_now at time zone u.dial_tz) at time zone (select tz.timezone from state_timezones tz where tz.state = upper(u.raw_state)))' || E'\n' ||
          '                       end as at_lead_clock' || E'\n' ||
          '                  from due u) d'],
    array['          from tenant_dial_window(p_tenant_id, k.raw_state, k.campaign_id, v_now) tw',
          '          from tenant_dial_window(p_tenant_id, k.raw_state, k.campaign_id, k.at_lead_clock) tw'],
    array['     where k.can_dial',
          '     where k.can_dial and k.dial_tz is not distinct from u.dial_tz'],
    array['     where not k.can_dial',
          '     where not k.can_dial and k.dial_tz is not distinct from u.dial_tz']
  ];
  v_count integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929203300: skipped, % cannot create in public', current_user;
    return;
  end if;
  if to_regprocedure('public.serve_eligible_ids_regenerate()') is null then
    raise exception '20260929203300: apply 20260929203000 first. Nothing was changed.';
  end if;
  v_body := replace(pg_get_functiondef(v_sig), E'\r\n', E'\n');
  if position('[203300]' in v_body) > 0 then
    raise notice '20260929203300: scoring_queue_preview already reads the lead''s own zone';
    return;
  end if;
  foreach v_pair slice 1 in array v_pairs loop
    v_count := (length(v_body) - length(replace(v_body, E'\n' || v_pair[1] || E'\n', ''))) / length(E'\n' || v_pair[1] || E'\n');
    if v_count <> 1 then
      raise exception '20260929203300: expected this scoring_queue_preview line once, found %: %', v_count, v_pair[1];
    end if;
    v_body := replace(v_body, E'\n' || v_pair[1] || E'\n', E'\n' || v_pair[2] || E'\n');
  end loop;
  execute v_body;
end;
$patch$;

revoke all on function public.scoring_queue_preview(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.scoring_queue_preview(uuid, uuid, integer) to tenant_app, service_role;

-- ── the zone rule, and every rule the preview already carried ─────────────────────────────────
do $check$
declare
  v_body text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929203300: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  v_body := replace(pg_get_functiondef('public.scoring_queue_preview(uuid,uuid,integer)'::regprocedure), E'\r\n', E'\n');
  if position('[203300]' in v_body) = 0 or position('l.dial_timezone as dial_tz' in v_body) = 0 then raise exception '203300 check: the preview does not read dial_timezone'; end if;
  if position('coalesce(tenant_can_dial_now(p_tenant_id, d.raw_state, d.campaign_id, d.at_lead_clock), false) as can_dial' in v_body) = 0 then raise exception '203300 check: the window is not asked on the lead''s clock'; end if;
  if position('when u.dial_tz in (select tz.timezone from state_timezones tz)' in v_body) = 0 then raise exception '203300 check: a zone that is no state''s is not refused'; end if;
  if position('where k.can_dial and k.dial_tz is not distinct from u.dial_tz' in v_body) = 0
     or position('where not k.can_dial and k.dial_tz is not distinct from u.dial_tz' in v_body) = 0 then
    raise exception '203300 check: servable and held back are not keyed on the zone'; end if;
  -- what it already carried
  if position('campaigns_servable' in v_body) = 0 then raise exception '203300 check: the scrub gate is gone'; end if;
  if position('is_phone_suppressed(p_tenant_id' in v_body) = 0 then raise exception '203300 check: suppression is gone'; end if;
  if position('agent_may_work_state(p_tenant_id, p_agent_user_id' in v_body) = 0 then raise exception '203300 check: the licence gate is gone'; end if;
  if position('l.lead_state <> ''exhausted''' in v_body) = 0 then raise exception '203300 check: exhausted leads are listed'; end if;
  if position('public.callback_tier_due(p_tenant_id, q.id, v_now) then 2' in v_body) = 0 then raise exception '203300 check: tier 2 is no longer callback_tier_due'; end if;
  if position('coalesce(l.attempts_made, 0) = 0 then 1' in v_body) = 0 then raise exception '203300 check: tier 1 no longer requires no dial yet'; end if;
  if position('[711400]' in v_body) = 0 then raise exception '203300 check: the recycled-retry tier rule is gone'; end if;
  if position('agent_can_take_pool_lead' in v_body) = 0 or position('v_pool_open' in v_body) = 0 then raise exception '203300 check: the capacity gate is gone'; end if;
  if position('callback_work_item_holder(p_tenant_id, q.id), lead_queue_assignee(p_tenant_id, q.id)) = p_agent_user_id' in v_body) = 0 then raise exception '203300 check: holder-first own leads are gone'; end if;
  if position('in_holdout' in v_body) = 0 then raise exception '203300 check: the holdout cohort is gone'; end if;
  if position('tenant_dial_window(p_tenant_id, k.raw_state, k.campaign_id, k.at_lead_clock)' in v_body) = 0 then raise exception '203300 check: the held-back reason is not on the lead''s clock'; end if;
end;
$check$;

-- ── a FL panhandle lead (32501, Central) is not servable at 8:30 Eastern (rolled back) ───────
--
-- The clock at 8:30 Eastern is proven directly. The preview reads now(), so the live half runs
-- whatever the time is: it finds a state this owner may work that is open now on its own clock and
-- a state zone that is closed now (at 8:30 Eastern that is FL and America/Chicago), puts one lead in
-- that state with that zone, and checks the preview holds it back, then serves it once the zone is
-- cleared.
do $zone$
declare
  v_tenant constant uuid := 'd6f3950f-0d88-4e66-869f-0de2ea6b396b';
  v_owner uuid;
  v_base record;
  v_lead uuid := gen_random_uuid();
  v_qid uuid := gen_random_uuid();
  v_day date := current_date + 1;
  v_at timestamptz;
  v_state text;
  v_zone text;
  v_before jsonb;
  v_after jsonb;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929203300: zone check skipped, % cannot create in public', current_user;
    return;
  end if;
  if not exists (select 1 from public.tenants where id = v_tenant) then
    raise notice '20260929203300: zone check skipped, the demo tenant is not in this database';
    return;
  end if;
  if public.calling_window_rules_stale(now()) then
    raise notice '20260929203300: zone check skipped, the calling-rules feed is stale so every window is closed';
    return;
  end if;

  -- 1. the clock: 8:30 Eastern on the next unblocked Tuesday, on a Central clock, is 7:30 and closed
  while extract(dow from v_day) <> 2 or exists (select 1 from public.calling_window_holidays h where h.holiday_date = v_day and h.blocked) loop
    v_day := v_day + 1;
  end loop;
  v_at := (v_day + time '08:30') at time zone 'America/New_York';
  if not public.tenant_can_dial_now(v_tenant, 'FL', null, v_at)
     or public.tenant_can_dial_now(v_tenant, 'FL', null, ((v_at at time zone 'America/Chicago') at time zone 'America/New_York')) then
    raise exception '203300 check: FL at 8:30 Eastern must be open and on a Central clock (7:30) closed';
  end if;

  -- 2. the preview, now
  select tu.user_id into v_owner from public.tenant_users tu where tu.tenant_id = v_tenant and tu.role::text = 'owner' limit 1;
  if not public.agent_can_take_pool_lead(v_tenant, v_owner) then
    raise notice '20260929203300: preview check skipped, the demo owner is at their open-lead ceiling';
    return;
  end if;
  select s.state, z.timezone into v_state, v_zone
    from unnest(public.serve_open_states(v_tenant, v_owner, now())) s(state)
    join public.state_timezones home on home.state = s.state
    cross join (select distinct tz.timezone from public.state_timezones tz) z
   where z.timezone <> home.timezone
     and not coalesce(public.tenant_can_dial_now(v_tenant, s.state, null, ((now() at time zone z.timezone) at time zone home.timezone)), false)
   order by (s.state = 'FL' and z.timezone = 'America/Chicago') desc, s.state, z.timezone
   limit 1;
  if v_state is null then
    raise notice '20260929203300: preview check skipped, no open state has a closed zone at this hour';
    return;
  end if;

  select l.template_id, l.template_version, l.tenant_template_id, l.definition_version, l.product_line, l.pipeline_id, l.stage_id, l.created_by
    into v_base from public.agent_leads l where l.tenant_id = v_tenant and l.campaign_id is null limit 1;
  v_before := public.scoring_queue_preview(v_tenant, v_owner);
  begin
    insert into public.agent_leads (id, tenant_id, template_id, template_version, tenant_template_id, definition_version,
                                    product_line, pipeline_id, stage_id, values, created_by, lead_state, dial_timezone)
    values (v_lead, v_tenant, v_base.template_id, v_base.template_version, v_base.tenant_template_id, v_base.definition_version,
            v_base.product_line, v_base.pipeline_id, v_base.stage_id,
            jsonb_build_object('first_name', 'Zone', 'last_name', 'Preview', 'phone', '8505550143', 'state', v_state,
                               'zip', case when v_state = 'FL' then '32501' else null end),
            v_base.created_by, 'fresh', v_zone);
    insert into public.lead_queue (id, tenant_id, lead_id, product_line, pipeline_id, stage_id, status, queued_at)
    values (v_qid, v_tenant, v_lead, v_base.product_line, v_base.pipeline_id, v_base.stage_id, 'unclaimed', now() - interval '1 hour');

    v_after := public.scoring_queue_preview(v_tenant, v_owner);
    if (v_after->>'servable_count')::integer <> (v_before->>'servable_count')::integer
       or (v_after->>'held_back_count')::integer <> (v_before->>'held_back_count')::integer + 1 then
      raise exception '203300 check: a % lead on % (closed there now) was not held back: servable % -> %, held % -> %',
        v_state, v_zone, v_before->>'servable_count', v_after->>'servable_count', v_before->>'held_back_count', v_after->>'held_back_count';
    end if;
    if exists (select 1 from jsonb_array_elements(v_after->'rows') r where (r->>'work_item_id')::uuid = v_qid) then
      raise exception '203300 check: the zoned lead is listed as servable';
    end if;

    -- The same lead on its state's clock (open now) is servable.
    update public.agent_leads set dial_timezone = null where id = v_lead;
    v_after := public.scoring_queue_preview(v_tenant, v_owner);
    if (v_after->>'servable_count')::integer <> (v_before->>'servable_count')::integer + 1 then
      raise exception '203300 check: the same % lead on its state''s clock was not servable', v_state;
    end if;

    raise exception 'M2_203300_ZONE_ROLLBACK';
  exception when raise_exception then
    if sqlerrm <> 'M2_203300_ZONE_ROLLBACK' then raise; end if;
  end;
  raise notice '203300: a % lead on % is held back while that clock is closed, and served on its state''s clock (rolled back)', v_state, v_zone;
end;
$zone$;
