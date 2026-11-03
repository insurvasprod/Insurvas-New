-- ---------------------------------------------------------------------------
-- LA-2.24-2 · setters get anything, licensed agents keep canWrite
-- LA-2.7-8  · rotation (attempts before rotate, rest days between owners) runs without a host
--
-- 1. The spec: "A licensed agent never gets a lead in a state he cannot write (canWrite), setters
--    get anything." assign_lead_core hard-coded term life as licence-only, so a setter claiming a
--    term_life lead was refused ("needs a licensed agent") and the router passed setters over for
--    every term_life lead. The hard-code is removed from the LIVE bodies, patched in place so the
--    rest of those long functions (711200's suppression skip included) is not retyped:
--      assign_lead_core (7 arguments), both the manual and the rule path
--      auto_route_posted_lead, the second gate question it asks of the chosen owner
--      lead_list_assignment_run, the sentence that explains why nobody could take a lead
--    Licensed agents are unchanged: assignment_candidate_is_eligible still asks an owner or
--    producer for a live licence and appointment in the lead's state (canWrite). A tenant's own
--    rule marked "licensed agents only" still means what the tenant saved.
--
-- 2. rotate_unanswered_assignments (20260924300000) moved a lead to the next agent after
--    assignment_settings.attempts_before_rotate unanswered attempts, honouring rest days through
--    assign_lead_core, but only ran when something called /api/cron/assignment-rotation, and
--    nothing did (vercel.json was emptied on 2026-09-25). pg_cron now runs it every five minutes.
--    The check block runs it once and rolls the run back.
-- ---------------------------------------------------------------------------

do $patch$
declare
  v_src text;
  v_new text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929201200: patches skipped, % cannot create in public', current_user;
    return;
  end if;

  -- ── assign_lead_core, 7 arguments ─────────────────────────────────────────
  select pg_get_functiondef('public.assign_lead_core(uuid,uuid,uuid,uuid,text,uuid,boolean)'::regprocedure) into v_src;
  v_src := replace(v_src, E'\r\n', E'\n');
  if v_src like '%[201200]%' then
    raise notice 'assign_lead_core already patched by 201200';
  else
    -- Manual path: the first matching rule alone decides whether a licence is needed.
    v_new := replace(v_src,
      E'      v_requires_licensed := v_product in (''term_life'', ''term-life'', ''term life'')\n',
      E'      v_requires_licensed := false  -- [201200] a setter takes any product, only a licensed-only rule asks for a licence\n');
    if v_new = v_src then raise exception 'assign_lead_core: the manual-path term_life line was not found'; end if;
    v_src := v_new;
    -- Rule path: a licensed-only rule the lead matched still carries through.
    v_new := replace(v_src,
      E'        v_requires_licensed := v_requires_licensed or v_product in (''term_life'', ''term-life'', ''term life'')\n',
      E'        v_requires_licensed := v_requires_licensed  -- [201200] no product is licence-only by itself\n');
    if v_new = v_src then raise exception 'assign_lead_core: the rule-path term_life line was not found'; end if;
    if v_new like '%''term_life''%' then raise exception 'assign_lead_core still names term_life'; end if;
    execute v_new;
    raise notice 'assign_lead_core: setters take any product';
  end if;

  -- ── auto_route_posted_lead ────────────────────────────────────────────────
  select pg_get_functiondef('public.auto_route_posted_lead(uuid,uuid)'::regprocedure) into v_src;
  v_src := replace(v_src, E'\r\n', E'\n');
  if v_src like '%[201200]%' then
    raise notice 'auto_route_posted_lead already patched by 201200';
  else
    v_new := replace(v_src,
      E'v_state, v_product in (''term_life'', ''term-life'', ''term life'')) then\n',
      E'v_state, false) then  -- [201200] the router already applied any licensed-only rule\n');
    if v_new = v_src then raise exception 'auto_route_posted_lead: the gate line was not found'; end if;
    execute v_new;
    raise notice 'auto_route_posted_lead: the second gate asks what the router asked';
  end if;

  -- ── lead_list_assignment_run: the "why nobody" sentence asks what the router asked ──
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'lead_list_assignment_run';
  v_src := replace(v_src, E'\r\n', E'\n');
  if v_src is null then
    raise notice 'lead_list_assignment_run not found, bulk reason left as it is';
  elsif v_src like '%[201200]%' then
    raise notice 'lead_list_assignment_run already patched by 201200';
  else
    v_new := replace(v_src,
      E'                        v_item.product in (''term_life'', ''term-life'', ''term life''));\n',
      E'                        false);  -- [201200] a setter takes any product, as the router does\n');
    if v_new = v_src then raise exception 'lead_list_assignment_run: the explainer term_life line was not found'; end if;
    execute v_new;
    raise notice 'lead_list_assignment_run: the bulk reason no longer calls term life licence-only';
  end if;
end $patch$;

-- ── the rotation schedule ──────────────────────────────────────────────────
-- cron.schedule with an existing job name replaces that job, so re-running is safe.
do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929201200: schedule skipped, % cannot create in public', current_user;
    return;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '20260929201200: pg_cron is not installed, the rotation is not scheduled';
    return;
  end if;
  perform cron.schedule('assignment-rotation', '*/5 * * * *',
    $cron$select public.rotate_unanswered_assignments(200)$cron$);
  perform cron.schedule('assignment-rotation-log-cleanup', '37 3 * * *',
    $cron$delete from cron.job_run_details
           where jobid in (select jobid from cron.job where jobname = 'assignment-rotation')
             and end_time < now() - interval '7 days'$cron$);
end $$;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_src text;
  v_report jsonb;
  v_setter record;
  v_item uuid;
  v_result jsonb;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929201200: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  select pg_get_functiondef('public.assign_lead_core(uuid,uuid,uuid,uuid,text,uuid,boolean)'::regprocedure) into v_src;
  if v_src like '%''term_life''%' or v_src not like '%[201200]%' then
    raise exception 'assign_lead_core still treats term life as licence-only';
  end if;
  -- 711200's suppression skip and the licensed-only rule survive the patch.
  if v_src not like '%[711200]%' or v_src not like '%assignment_rule_requires_licence(v_selected_rule)%'
     or v_src not like '%assignment_rule_requires_licence(v_rule)%' then
    raise exception 'the patch lost the suppression skip or the licensed-only rule';
  end if;
  select pg_get_functiondef('public.auto_route_posted_lead(uuid,uuid)'::regprocedure) into v_src;
  if v_src like '%''term_life''%' then raise exception 'auto_route_posted_lead still treats term life as licence-only'; end if;
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'lead_list_assignment_run';
  if v_src like '%''term_life''%' then raise exception 'lead_list_assignment_run still explains term life as licence-only'; end if;

  -- The eligibility rule itself is untouched: a setter passes unless a licence is asked for, an
  -- owner or producer needs the state.
  if public.assignment_candidate_is_eligible('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'setter', 'term_life', 'NY', false) is not true then
    raise exception 'a setter is refused a term life lead with no licence rule';
  end if;
  if public.assignment_candidate_is_eligible('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'producer', 'term_life', 'NY', false) is not false then
    raise exception 'a producer with no licence was let through (canWrite)';
  end if;

  -- Behaviour, built and rolled back: a setter claims a pooled term_life lead.
  begin
    select tu.tenant_id, tu.user_id into v_setter
      from public.tenant_users tu join public.users u on u.id = tu.user_id
     where tu.role::text = 'setter' and tu.accepted_at is not null and u.status::text = 'active'
     limit 1;
    if v_setter.user_id is null then raise exception 'SKIP no active setter'; end if;
    select q.id into v_item
      from public.lead_queue q join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
     where q.tenant_id = v_setter.tenant_id and q.status = 'unclaimed' and q.owner_user_id is null
       and not coalesce((select s.suppressed from public.is_phone_suppressed(q.tenant_id, l.values->>'phone') s limit 1), false)
     limit 1;
    if v_item is null then raise exception 'SKIP no pooled lead on the setter''s tenant'; end if;
    update public.agent_leads set product_line = 'term_life'
     where id = (select lead_id from public.lead_queue where id = v_item);
    -- No rule may ask for a licence on this lead during the probe.
    update public.assignment_rules set is_active = false where tenant_id = v_setter.tenant_id;
    update public.assignment_settings set rest_days = 0 where tenant_id = v_setter.tenant_id;
    insert into public.agent_capacity (tenant_id, user_id) values (v_setter.tenant_id, v_setter.user_id) on conflict do nothing;
    update public.agent_capacity set max_open_leads = 100000 where tenant_id = v_setter.tenant_id and user_id = v_setter.user_id;
    v_result := public.assign_lead_core(v_setter.tenant_id, v_setter.user_id, v_item, v_setter.user_id, 'probe', null);
    if (v_result->>'owner_user_id')::uuid is distinct from v_setter.user_id then
      raise exception 'a setter could not claim a term life lead: %', v_result;
    end if;
    raise exception using errcode = 'P0099', message = '20260929201200 probe rollback';
  exception
    when sqlstate 'P0099' then null;
    when raise_exception then
      -- One agent per household can make the probe lead untakeable for reasons that are not the
      -- licence. Only a licence refusal (ASSIGNMENT_TARGET_NOT_ELIGIBLE) fails the migration.
      if sqlerrm like 'SKIP%' or sqlerrm = 'ASSIGNMENT_HOUSEHOLD_OWNED' then
        raise notice '20260929201200: setter probe skipped (%)', sqlerrm;
      else
        raise;
      end if;
  end;

  -- Run the rotation once, for real, and roll the run back.
  begin
    v_report := public.rotate_unanswered_assignments(200);
    if v_report is null or not (v_report ? 'checked') then
      raise exception 'rotate_unanswered_assignments returned %', v_report;
    end if;
    raise notice '20260929201200: rotation dry run %', v_report;
    raise exception using errcode = 'P0099', message = '20260929201200 rotation rollback';
  exception
    when sqlstate 'P0099' then null;
  end;

  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and not exists (select 1 from cron.job where jobname = 'assignment-rotation' and command like '%public.rotate_unanswered_assignments(%') then
    raise exception 'the assignment-rotation job is not scheduled';
  end if;
end $$;
