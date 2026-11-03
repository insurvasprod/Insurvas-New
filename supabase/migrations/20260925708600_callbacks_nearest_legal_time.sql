-- ---------------------------------------------------------------------------
-- Callbacks · the nearest legal time (LA-1 §6.3)
--
-- "Marcus Pell's callback could not be booked for 7:30 AM. Oregon opens at 8:00 AM local. The
-- nearest legal time is 8:00 AM his time." A refusal that names the next time the customer MAY be
-- called, so the agent can offer it. User decision: a "Use that" suggestion only — nothing here
-- books anything.
--
--   next_callable_instant(tenant, lead, from, until)  the first instant at or after `from` at which
--       tenant_can_dial_now (20260924230100 — federal, state, holidays, Sundays, agency, campaign;
--       the function serve_next_lead and assert_callback_in_window enforce) allows this lead to be
--       called. Searched on the customer's quarter hours, then refined to five minutes, for at most
--       14 days. Null when the lead has no state, the rules feed is stale (every answer would be
--       "no"), or nothing is legal before `until`.
--
-- Callers pass a `from` a few minutes in the future; the function does not add its own buffer.
-- run_callback_due (20260925708700) also asks it whether the customer's window will open again
-- before their day ends.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regprocedure('public.tenant_can_dial_now(uuid, text, uuid, timestamp with time zone)') is null then
    raise exception 'tenant_can_dial_now does not exist; apply 20260924230100 before this file';
  end if;
end $$;

create or replace function public.next_callable_instant(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_from timestamptz,
  p_until timestamptz default null
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_state text;
  v_campaign uuid;
  v_zone text;
  v_until timestamptz;
  v_local timestamp;
  v_at timestamptz;
  v_fine timestamptz;
  k integer;
begin
  if p_from is null then return null; end if;

  select upper(btrim(l.values->>'state')), l.campaign_id
    into v_state, v_campaign
    from public.agent_leads l
   where l.id = p_lead_id and l.tenant_id = p_tenant_id;
  if v_state is null or v_state !~ '^[A-Z]{2}$' then return null; end if;

  -- A stale feed refuses every instant; searching fourteen days of refusals would say nothing true.
  if to_regprocedure('public.calling_window_rules_stale(timestamp with time zone)') is not null
     and public.calling_window_rules_stale(now()) then
    return null;
  end if;

  select timezone into v_zone from public.state_timezones where state = v_state;
  if v_zone is null then return null; end if;

  v_until := least(coalesce(p_until, p_from + interval '14 days'), p_from + interval '14 days');

  if public.tenant_can_dial_now(p_tenant_id, v_state, v_campaign, p_from) then
    return p_from;
  end if;

  -- The next quarter hour on the customer's clock.
  v_local := p_from at time zone v_zone;
  v_local := date_trunc('hour', v_local)
             + (floor(extract(minute from v_local) / 15)::integer + 1) * interval '15 minutes';

  loop
    v_at := v_local at time zone v_zone;
    exit when v_at > v_until;
    if public.tenant_can_dial_now(p_tenant_id, v_state, v_campaign, v_at) then
      -- A window may open on a minute (Settings › Calling windows keeps minutes): look back ten
      -- and five minutes for an earlier legal instant that is still after `from`.
      for k in reverse 2..1 loop
        v_fine := v_at - make_interval(mins => 5 * k);
        if v_fine > p_from and public.tenant_can_dial_now(p_tenant_id, v_state, v_campaign, v_fine) then
          return v_fine;
        end if;
      end loop;
      return v_at;
    end if;
    v_local := v_local + interval '15 minutes';
  end loop;

  return null;
end;
$function$;

revoke all on function public.next_callable_instant(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.next_callable_instant(uuid, uuid, timestamptz, timestamptz) to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_lead uuid;
  v_zone text;
  v_three_am timestamptz;
  v_next timestamptz;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925708600: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if to_regprocedure('public.next_callable_instant(uuid, uuid, timestamp with time zone, timestamp with time zone)') is null then
    raise exception 'next_callable_instant was not created';
  end if;

  -- 3am tomorrow for a real lead with a state: the answer must be later, legal, and on the same
  -- customer-local day or after.
  select l.tenant_id, l.id, z.timezone into v_tenant, v_lead, v_zone
    from public.agent_leads l
    join public.state_timezones z on z.state = upper(btrim(l.values->>'state'))
   where l.values->>'state' ~ '^[A-Za-z]{2}$'
   limit 1;
  if v_lead is null then
    raise notice '20260925708600: no lead with a state; behaviour check skipped';
    return;
  end if;
  v_three_am := ((now() at time zone v_zone)::date + 1 + time '03:00')::timestamp at time zone v_zone;
  v_next := public.next_callable_instant(v_tenant, v_lead, v_three_am, null);
  if v_next is null then
    raise notice '20260925708600: nothing legal within 14 days for the sample lead (stale rules feed?); check skipped';
  elsif v_next <= v_three_am then
    raise exception 'next_callable_instant returned % for a refused 3am (%), not a later time', v_next, v_three_am;
  elsif not public.tenant_can_dial_now(v_tenant, (select upper(btrim(values->>'state')) from public.agent_leads where id = v_lead), (select campaign_id from public.agent_leads where id = v_lead), v_next) then
    raise exception 'next_callable_instant returned % which tenant_can_dial_now refuses', v_next;
  end if;
  raise notice '20260925708600: the nearest legal time after a refused one is found, never booked';
end $$;
