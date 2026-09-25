-- Lead assignment · when a personal licence lapses, that agent's open leads in the state go back to
-- the pool (user decision, LA-2.24 concept audit).
--
-- 20260925702000 made a lapsed personal state stop counting: the router will not hand the agent a
-- new lead there and the dialer will not serve one. Leads the agent ALREADY owns in that state were
-- stranded — owned, so nobody else could be given them, and unservable to the owner. This job
-- returns them, with the rotation job's guards (rotate_unanswered_assignments, 20260924300000):
--
--   · only status 'claimed' with no disposition — never a live transfer (buffer_active,
--     handed_pending, la_active);
--   · never while the lead has an open call (active_calls), an attempt with no disposition in the
--     last two hours (a dial may be in progress), or a callback the customer booked (scheduled or
--     due);
--   · never while the dialer holds its lock (locked_until in the future);
--   · and only when the gate itself now refuses the owner for that lead — a renewal recorded since
--     (a new expires_on), or an owner whose states were cleared, keeps the lead.
--
-- Each return writes the usual 'auto_returned' event (reason "Licence in OH lapsed on 4 Oct 2026",
-- assigned_by null), and one audit_log row. The capacity trigger frees the slot. Run by
-- /api/cron/licence-lapse (vercel.json), never from a trigger.
--
-- Additive. Requires 20260925702000 (tenant_user_licensed_states.expires_on).

create or replace function public.return_lapsed_licence_assignments(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_row record;
  v_returned integer := 0;
  v_checked integer := 0;
  v_kept integer := 0;
  v_reason text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tenant_user_licensed_states' and column_name = 'expires_on') then
    return jsonb_build_object('skipped', true, 'reason', 'tenant_user_licensed_states.expires_on is missing (20260925702000)');
  end if;

  for v_row in
    select q.id as work_item_id, q.tenant_id, q.lead_id, q.owner_user_id, s.state, s.expires_on,
           tu.role::text as role,
           lower(btrim(coalesce(l.product_line, l.values->>'product_code', l.values->>'product', ''))) as product,
           public.assignment_contact_key(l.values, l.id) as contact_key
      from public.tenant_user_licensed_states s
      join public.tenant_users tu on tu.tenant_id = s.tenant_id and tu.user_id = s.user_id
      join public.lead_queue q on q.tenant_id = s.tenant_id and q.owner_user_id = s.user_id
      join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
     where s.expires_on is not null and s.expires_on < current_date
       and q.status = 'claimed' and q.disposition is null
       and (q.locked_until is null or q.locked_until < now())
       and upper(btrim(coalesce(l.values->>'state', l.values->>'state_code', ''))) = s.state
       and not exists (select 1 from public.active_calls ac where ac.tenant_id = q.tenant_id and ac.work_item_id = q.id and ac.ended_at is null)
       and not exists (select 1 from public.tenant_call_attempts op
                        where op.tenant_id = q.tenant_id and op.lead_id = q.lead_id
                          and op.disposition is null and op.attempted_at > now() - interval '2 hours')
       and not exists (select 1 from public.tenant_callbacks cb
                        where cb.tenant_id = q.tenant_id and cb.work_item_id = q.id and cb.status in ('scheduled', 'due'))
     order by q.tenant_id, s.expires_on, q.claimed_at nulls first, q.id
     limit greatest(coalesce(p_limit, 200), 1)
  loop
    v_checked := v_checked + 1;
    -- The gate decides, not this query: a renewal or a cleared list keeps the lead with its owner.
    if public.assignment_candidate_is_eligible(v_row.tenant_id, v_row.owner_user_id, v_row.role, v_row.product, v_row.state, false) then
      v_kept := v_kept + 1;
      continue;
    end if;
    perform 1 from public.lead_queue
     where id = v_row.work_item_id and tenant_id = v_row.tenant_id and owner_user_id = v_row.owner_user_id
       and status = 'claimed' and disposition is null
     for update skip locked;
    if not found then
      v_kept := v_kept + 1;
      continue;
    end if;
    v_reason := format('Licence in %s lapsed on %s', v_row.state, to_char(v_row.expires_on, 'FMDD Mon YYYY'));
    update public.lead_queue
       set status = 'unclaimed', claimed_by = null, owner_user_id = null, owner_role = null,
           claimed_at = null, locked_until = null, updated_at = now()
     where id = v_row.work_item_id and tenant_id = v_row.tenant_id;
    insert into public.lead_assignment_events (tenant_id, work_item_id, lead_id, contact_key, from_user_id, event_type, reason, assigned_by)
    values (v_row.tenant_id, v_row.work_item_id, v_row.lead_id, v_row.contact_key, v_row.owner_user_id, 'auto_returned', v_reason, null);
    insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
    values ('system', 'tenant.lead_returned_licence_lapsed', 'lead_queue', v_row.work_item_id::text,
            jsonb_build_object('tenantId', v_row.tenant_id, 'leadId', v_row.lead_id, 'fromUserId', v_row.owner_user_id,
                               'state', v_row.state, 'expiresOn', v_row.expires_on));
    v_returned := v_returned + 1;
  end loop;
  return jsonb_build_object('checked', v_checked, 'returned', v_returned, 'kept', v_kept);
end;
$function$;

revoke all on function public.return_lapsed_licence_assignments(integer) from public, anon, authenticated, tenant_app;
grant execute on function public.return_lapsed_licence_assignments(integer) to service_role;

do $$
declare
  v_def text;
begin
  if not has_schema_privilege('public', 'CREATE')
     or to_regprocedure('public.return_lapsed_licence_assignments(integer)') is null then
    raise notice 'licence lapse return: schema not present; skipping the checks';
    return;
  end if;
  select prosrc into v_def from pg_proc where oid = to_regprocedure('public.return_lapsed_licence_assignments(integer)');
  if v_def not like '%from public.active_calls%' or v_def not like '%op.disposition is null and op.attempted_at > now() - interval ''2 hours''%'
     or v_def not like '%cb.status in (''scheduled'', ''due'')%' or v_def not like '%q.status = ''claimed''%' then
    raise exception 'return_lapsed_licence_assignments lost one of the rotation guards';
  end if;
  if v_def not like '%assignment_candidate_is_eligible%' then
    raise exception 'return_lapsed_licence_assignments returns leads without asking the gate';
  end if;
  if has_function_privilege('tenant_app', 'public.return_lapsed_licence_assignments(integer)', 'execute') then
    raise exception 'the tenant plane can run the licence lapse job';
  end if;
  raise notice 'licence lapse return: in place';
end $$;
