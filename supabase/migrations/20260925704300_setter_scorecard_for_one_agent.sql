-- ---------------------------------------------------------------------------
-- Appointments (LA-2 §11) · the setter scorecard for ONE agent's calendar
--
-- The board's "Setters · last 30 days" sits on the licensed agent's own page and is about the
-- setters who book into THAT calendar: "61 slots of your calendar spent on nobody". The page read
-- `tenant_setter_scorecard`, which is per setter across the whole agency, scoped by permission:
-- an owner saw every setter's bookings for every agent, and a producer (scorecard.view.own) saw
-- only their own rows — an empty table on the one page that is about them.
--
-- USER DECISION 2026-09-25: the scorecard on this page covers only setters booking into this
-- agent's calendar, it is visible to producers too, and it is ranked by shown.
--
-- `setter_scorecard_for_agent` returns, per person who booked into the agent's calendar (the agent
-- booking for themselves is not a setter and is left out), the same counts and the same rules as
-- `tenant_setter_scorecard` (20260913415000):
--   booked    appointments they booked into this calendar, by booking date, since p_since;
--   showed / no_show / pending   by status — pending is never a no-show;
--   sold      a later application_submitted / sent_to_underwriting on the lead;
--   dials / contacts   the setter's own dialling since p_since, across every calendar (a dial is
--             not booked into anyone's calendar until it becomes an appointment).
-- Ranking is the caller's job; the page sorts by shown.
--
-- Service role only, like the other booking functions: the page reads it server-side after its
-- own owner/producer gate, and the agent id is always the signed-in user.
-- ---------------------------------------------------------------------------

create or replace function public.setter_scorecard_for_agent(
  p_tenant_id uuid,
  p_agent_user_id uuid,
  p_since timestamptz
)
returns table(user_id uuid, booked integer, showed integer, no_show integer, pending integer, sold integer, dials integer, contacts integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with mine as (
    select ap.booked_by, ap.status, ap.lead_id, ap.starts_at_utc, ap.tenant_id
      from tenant_appointments ap
     where ap.tenant_id = p_tenant_id
       and ap.agent_user_id = p_agent_user_id
       and ap.booked_by is not null
       and ap.booked_by <> p_agent_user_id
       and ap.created_at >= p_since
  ),
  booked as (
    select m.booked_by as user_id,
           count(*)::integer as booked,
           count(*) filter (where m.status = 'showed')::integer as showed,
           count(*) filter (where m.status = 'no_show')::integer as no_show,
           count(*) filter (where m.status = 'pending')::integer as pending,
           count(*) filter (
             where exists (
               select 1 from tenant_call_attempts ca2
                where ca2.tenant_id = m.tenant_id
                  and ca2.lead_id = m.lead_id
                  and ca2.attempted_at >= m.starts_at_utc
                  and ca2.disposition in ('application_submitted', 'sent_to_underwriting')
             )
           )::integer as sold
      from mine m
     group by m.booked_by
  )
  select b.user_id, b.booked, b.showed, b.no_show, b.pending, b.sold,
         coalesce(d.dials, 0)::integer, coalesce(d.contacts, 0)::integer
    from booked b
    left join lateral (
      select count(*) as dials,
             count(*) filter (where is_contact_disposition(ca.disposition)) as contacts
        from tenant_call_attempts ca
       where ca.tenant_id = p_tenant_id
         and ca.agent_id = b.user_id
         and ca.attempted_at >= p_since
    ) d on true;
$function$;

revoke all on function public.setter_scorecard_for_agent(uuid, uuid, timestamptz) from public, anon, authenticated, tenant_app;
grant execute on function public.setter_scorecard_for_agent(uuid, uuid, timestamptz) to service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925704300: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'setter_scorecard_for_agent';
  if v_def is null or v_def !~ 'agent_user_id = p_agent_user_id' or v_def !~ 'booked_by <> p_agent_user_id' then
    raise exception 'setter_scorecard_for_agent is not scoped to the one calendar';
  end if;

  -- Runs, and returns nothing for an agent who does not exist.
  perform 1 from public.setter_scorecard_for_agent(gen_random_uuid(), gen_random_uuid(), now() - interval '30 days');

  if has_function_privilege('tenant_app', 'public.setter_scorecard_for_agent(uuid, uuid, timestamptz)', 'execute') then
    raise exception 'the tenant plane can read another agent''s setter scorecard directly';
  end if;
end $$;
