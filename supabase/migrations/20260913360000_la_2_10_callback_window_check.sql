-- ---------------------------------------------------------------------------
-- LA-2.10 · A callback may not be booked outside the legal calling window
--
-- The task names two holes. One is real and one is already closed:
--
--   REAL     Nothing validates the booked time against the calling window. An agent can promise to
--            call back at 03:00 and the system will schedule it, queue it, and hand it to somebody
--            to dial. "A callback at 3am is a call outside the legal window, scheduled by our own
--            system."
--
--   CLOSED   "An agent can book ... for last March." Not on this plane:
--            complete_disposition_with_callback and reschedule_callback both already raise
--            CALLBACK_DATE_PAST on `v_scheduled_at <= now()`. LA-1.22 fixed it; the task page
--            describes the organizations-era version.
--
-- The check goes in the two RPCs rather than in the service, because a compliance rule enforced
-- only in TypeScript stops applying the moment anything else calls the API — and both of these are
-- reachable directly with the service role.
--
-- The window is evaluated AT THE BOOKED INSTANT, not now. "Thursday 2pm" must be legal on Thursday
-- at 2pm in the customer's zone; whether it happens to be legal at the moment of booking is
-- irrelevant and would reject most evening bookings made in the morning.
--
-- ON THE DUPLICATE OVERLOADS, recorded rather than removed. There are two of each of
-- `reschedule_callback`, `cancel_callback` and `claim_callback_reminders`:
--
--   [CRM]    reschedule_callback(target_callback_id uuid, target_scheduled_at timestamptz, target_note text)
--   [tenant] reschedule_callback(p_tenant_id uuid, p_callback_id uuid, p_actor uuid, p_callback_local timestamp)
--
-- The `target_*` ones take no tenant id and write the organizations-era `callbacks`; they are the
-- CRM's and are left alone per the SA-3 rule. The signatures differ in both arity and parameter
-- names, so PostgREST cannot resolve one when the other was meant. Worth knowing about, though,
-- because criterion 6 asks for one callback implementation and there are literally two — they just
-- belong to different products.
-- ---------------------------------------------------------------------------

create or replace function public.assert_callback_in_window(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_scheduled_at timestamptz
)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_state text;
  v_campaign uuid;
begin
  select l.values->>'state', l.campaign_id into v_state, v_campaign
    from agent_leads l where l.id = p_lead_id and l.tenant_id = p_tenant_id;

  -- A lead with no state has no timezone, so there is no window to check it against and no way to
  -- dial it legally either. Refusing the booking is the same answer LA-2.4 gives the dialer.
  if v_state is null or v_state !~ '^[A-Za-z]{2}$' then
    raise exception 'CALLBACK_NO_STATE';
  end if;

  if not tenant_can_dial_now(p_tenant_id, v_state, v_campaign, p_scheduled_at) then
    raise exception 'CALLBACK_OUTSIDE_WINDOW';
  end if;
end;
$function$;

revoke all on function public.assert_callback_in_window(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.assert_callback_in_window(uuid, uuid, timestamptz) to tenant_app, service_role;

-- ── the two booking paths ──────────────────────────────────────────────────
--
-- Each is the live definition with one statement added, immediately after the existing past check
-- so the two refusals sit together and neither can be moved without seeing the other.
do $$
declare
  v_src text;
  v_new text;
  v_fn record;
begin
  for v_fn in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('complete_disposition_with_callback', 'reschedule_callback')
       and pg_get_functiondef(p.oid) ~ 'tenant_callbacks'
  loop
    v_src := v_fn.def;

    if v_src ~ 'assert_callback_in_window' then
      raise notice '% already checks the window', v_fn.proname;
      continue;
    end if;

    -- complete_disposition_with_callback knows the work item; the lead comes from the queue row.
    if v_fn.proname = 'complete_disposition_with_callback' then
      v_new := replace(
        v_src,
        'if v_scheduled_at <= now() then raise exception ''CALLBACK_DATE_PAST''; end if;',
        'if v_scheduled_at <= now() then raise exception ''CALLBACK_DATE_PAST''; end if;'
        || E'\n  perform public.assert_callback_in_window(p_tenant_id, (select q.lead_id from public.lead_queue q where q.id = p_work_item_id and q.tenant_id = p_tenant_id), v_scheduled_at);'
      );
    else
      -- reschedule_callback already holds the callback row in `c`.
      v_new := replace(
        v_src,
        'if v_scheduled_at <= now() then raise exception ''CALLBACK_DATE_PAST''; end if;',
        'if v_scheduled_at <= now() then raise exception ''CALLBACK_DATE_PAST''; end if;'
        || E'\n  perform public.assert_callback_in_window(p_tenant_id, c.lead_id, v_scheduled_at);'
      );
    end if;

    if v_new = v_src then
      raise exception '% does not contain the expected CALLBACK_DATE_PAST guard, so the window check could not be placed', v_fn.proname;
    end if;

    execute v_new;
    raise notice '% now checks the calling window', v_fn.proname;
  end loop;
end $$;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_lead uuid;
  v_state text;
  v_zone text;
  v_three_am timestamptz;
  v_ok boolean;
begin
  select tenant_id into v_tenant from public.agent_leads group by tenant_id order by count(*) desc limit 1;
  if v_tenant is null then raise notice 'no leads exist; skipped'; return; end if;

  -- Both functions now carry the check.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('complete_disposition_with_callback', 'reschedule_callback')
         and pg_get_functiondef(p.oid) ~ 'assert_callback_in_window') <> 2 then
    raise exception 'the window check did not reach both booking paths';
  end if;

  -- 03:00 in the customer's own zone is refused; the same lead at 14:00 is not.
  select l.id, l.values->>'state' into v_lead, v_state
    from public.agent_leads l
   where l.tenant_id = v_tenant and l.values->>'state' ~ '^[A-Za-z]{2}$'
   limit 1;
  if v_lead is null then raise notice 'no lead has a state; skipped'; return; end if;

  select timezone into v_zone from public.state_timezones where state = upper(v_state);
  v_three_am := (current_date + interval '1 day' + interval '3 hours') at time zone v_zone;

  begin
    perform public.assert_callback_in_window(v_tenant, v_lead, v_three_am);
    raise exception 'a callback at 03:00 was accepted';
  exception when others then
    if sqlerrm <> 'CALLBACK_OUTSIDE_WINDOW' then raise; end if;
  end;

  v_ok := public.tenant_can_dial_now(v_tenant, v_state, null,
            (current_date + interval '1 day' + interval '14 hours') at time zone v_zone);
  if not v_ok then
    raise exception '14:00 local was refused, so the assertion above proves nothing about 03:00';
  end if;

  raise notice 'callback window check: 03:00 refused, 14:00 permitted, in % (%)', v_state, v_zone;
end $$;
