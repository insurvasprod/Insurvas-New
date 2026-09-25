-- Settings › States & licences: "An agent without an active licence in the lead's state is skipped
-- by lead assignment and refused by the dialer."
--
-- Assignment has honoured it since LA-2.24 (assignment_candidate_is_eligible, widened to the
-- agent's own states in 20260924110000). The dialer did not: serve_next_lead hands any unclaimed
-- lead to whoever presses next, so a producer licensed in Arizona could be served, and dial, a Texas
-- lead. The application now refuses the dial itself (lib/dialerScripts/licence.ts, which works
-- before this file is applied); this file stops the queue offering the lead in the first place.
--
-- The rule, stated once in agent_may_work_state and read by both:
--   · a setter books only and never sells, so a setter may be served any lead;
--   · an owner or producer needs the agency to hold a licence in the lead's state that has not
--     expired, and — when their own licensed states are recorded on Team & access — the state must
--     be one of theirs. None recorded means "judge me on the agency", as assignment does;
--   · a lead with no state cannot be judged, and is not served to anyone who needs a licence.
--
-- serve_next_lead is patched rather than restated (the pattern 20260922190000 uses): it is long,
-- and this changes one predicate in each of its two candidate queries.
--
-- Additive and idempotent. Requires 20260924110000 (tenant_user_licensed_states).

create or replace function public.agent_may_work_state(p_tenant_id uuid, p_user_id uuid, p_state text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  with member as (
    select tu.role::text as role
      from public.tenant_users tu
     where tu.tenant_id = p_tenant_id and tu.user_id = p_user_id
  ), wanted as (
    select upper(btrim(coalesce(p_state, ''))) as state
  )
  select coalesce((
    select case
      when m.role = 'setter' then true
      when m.role not in ('owner', 'producer') then false
      when w.state = '' then false
      else exists (
             select 1 from public.licenses l
              where l.tenant_id = p_tenant_id
                and upper(btrim(l.state)) = w.state
                and (l.expires_at is null or l.expires_at >= current_date)
           )
           and (
             not exists (select 1 from public.tenant_user_licensed_states s where s.tenant_id = p_tenant_id and s.user_id = p_user_id)
             or exists (select 1 from public.tenant_user_licensed_states s where s.tenant_id = p_tenant_id and s.user_id = p_user_id and s.state = w.state)
           )
    end
    from member m cross join wanted w
  ), false);
$function$;

revoke all on function public.agent_may_work_state(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.agent_may_work_state(uuid, uuid, text) to tenant_app, service_role;

do $$
declare
  v_src text;
  v_new text;
  v_marker constant text := 'agent_may_work_state';
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'serve_next_lead';

  if v_src is null then
    raise exception 'serve_next_lead does not exist; apply the LA-2.8 serving migrations first';
  end if;

  if v_src ~ 'agent_may_work_state' then
    raise notice 'serve_next_lead already serves only leads the agent may work';
    return;
  end if;

  -- The stored body keeps the line endings it was created with (the live one has CRLF), so the
  -- line after the filter repeats whatever ending the filter line had.
  v_new := regexp_replace(
    v_src,
    '([ ]+and l\.lead_state <> ''exhausted'')(\r?\n)',
    E'\\1\\2         and agent_may_work_state(p_tenant_id, p_agent_user_id, l.values->>''state'')\\2',
    'g'
  );
  -- Both candidate queries (scored and naive) carry the filter exactly once each.
  if (length(v_new) - length(replace(v_new, v_marker, ''))) / length(v_marker) <> 2 then
    raise exception 'serve_next_lead is not in the expected form (the exhausted filter should appear twice); fix by hand';
  end if;

  execute v_new;
  raise notice 'serve_next_lead now skips leads in states the agent may not work';
end $$;
