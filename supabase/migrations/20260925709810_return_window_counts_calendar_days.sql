-- ---------------------------------------------------------------------------
-- LA-2.19-2 · a return window's days left are calendar days in the tenant's zone
--
-- Found 2026-09-25: Oakridge's window closes 26 Sep 15:21 UTC, about 23 hours away, and the page
-- said "Closes today". days_remaining and days_left were floor(seconds left / 86400), which is 0 for
-- anything under a day however the calendar falls. A window closing tomorrow afternoon has one day
-- left.
--
-- The fix, and nothing else: the one days-left expression in each of the three functions (the
-- latest definitions, vendor_claimable_leads from 20260925707900 and vendor_return_candidates and
-- vendor_returns_candidates_summary from 20260925707500) is replaced in the live source by
--
--   (closing instant in the tenant's zone)::date - (now in the tenant's zone)::date
--
-- The zone is the agency's own (Settings › Agency profile, as deal_local_date reads it), UTC when
-- none is set. claimable (closing instant > now) is unchanged, so what can be claimed does not move,
-- only how its countdown is read. The app counts the same way (lib/vendorScorecard/returnModel.ts
-- calendarDaysLeft), so the page is right before and after this file.
--
-- The live sources were pasted through the SQL editor and are stored with CRLF, so each anchor is a
-- single line and is matched exactly once. Re-running is a no-op.
-- ---------------------------------------------------------------------------

create or replace function public.tenant_calendar_zone(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select ap.timezone
       from agency_profiles ap
      where ap.tenant_id = p_tenant_id
        and ap.timezone is not null
        and exists (select 1 from pg_timezone_names tz where tz.name = ap.timezone)
      limit 1),
    'UTC');
$function$;

revoke all on function public.tenant_calendar_zone(uuid) from public, anon, authenticated;
grant execute on function public.tenant_calendar_zone(uuid) to tenant_app, service_role;

do $$
declare
  v_edits constant text[][] := array[
    array['vendor_claimable_leads',
          'greatest(0, floor(extract(epoch from (claimable_until - now())) / 86400))::integer as days_remaining,',
          'greatest(0, (claimable_until at time zone (select public.tenant_calendar_zone(p_tenant_id)))::date - (now() at time zone (select public.tenant_calendar_zone(p_tenant_id)))::date)::integer as days_remaining,'],
    array['vendor_return_candidates',
          'greatest(0, floor(extract(epoch from (u.until - now())) / 86400))::integer,',
          'greatest(0, (u.until at time zone (select public.tenant_calendar_zone(p_tenant_id)))::date - (now() at time zone (select public.tenant_calendar_zone(p_tenant_id)))::date)::integer,'],
    array['vendor_returns_candidates_summary',
          'else greatest(0, floor(extract(epoch from (pc.soonest - now())) / 86400))::integer end,',
          'else greatest(0, (pc.soonest at time zone (select public.tenant_calendar_zone(p_tenant_id)))::date - (now() at time zone (select public.tenant_calendar_zone(p_tenant_id)))::date)::integer end,']
  ];
  v_i integer;
  v_name text;
  v_old text;
  v_new text;
  v_src text;
  v_count integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709810: skipped, % cannot create in public', current_user;
    return;
  end if;

  for v_i in 1 .. array_length(v_edits, 1) loop
    v_name := v_edits[v_i][1];
    v_old := v_edits[v_i][2];
    v_new := v_edits[v_i][3];
    select pg_get_functiondef(p.oid) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_name;
    if v_src is null then
      raise exception '% does not exist, apply the vendor returns migrations first', v_name;
    end if;
    if strpos(v_src, v_new) > 0 and strpos(v_src, v_old) = 0 then
      raise notice '% already counts calendar days', v_name;
      continue;
    end if;
    v_count := (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old);
    if v_count <> 1 then
      raise exception '% has the floored days-left expression % times, expected once, fix by hand', v_name, v_count;
    end if;
    execute replace(v_src, v_old, v_new);
    raise notice '% now counts calendar days in the tenant zone', v_name;
  end loop;
end $$;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_name text;
  v_src text;
  v_zone text;
  v_closes timestamptz;
  v_days integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709810: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  foreach v_name in array array['vendor_claimable_leads', 'vendor_return_candidates', 'vendor_returns_candidates_summary'] loop
    select pg_get_functiondef(p.oid) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_name;
    if strpos(v_src, '/ 86400))::integer') > 0 then
      raise exception '% still floors seconds into days', v_name;
    end if;
    if strpos(v_src, '(select public.tenant_calendar_zone(p_tenant_id)))::date') = 0 then
      raise exception '% does not count calendar days in the tenant zone', v_name;
    end if;
  end loop;

  -- The arithmetic itself: 23 hours before a closing that falls on tomorrow's date is one day.
  v_zone := public.tenant_calendar_zone(gen_random_uuid());
  if v_zone <> 'UTC' then raise exception 'an unknown tenant should count in UTC, got %', v_zone; end if;
  v_closes := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' + interval '1 day 23 hours';
  v_days := (v_closes at time zone v_zone)::date - (now() at time zone v_zone)::date;
  if v_days <> 1 then raise exception 'a window closing tomorrow counts % days, expected 1', v_days; end if;
end $$;
