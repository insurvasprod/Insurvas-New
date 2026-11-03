-- ---------------------------------------------------------------------------
-- Module 2 · the activity report counts a reschedule once (LA-2.12-4, FIX builder A, 2026-09-29)
--
-- tenant_activity_report's appointments_booked counted every appointment row a member booked,
-- including the row a reschedule leaves behind as 'rescheduled' next to its replacement. The
-- setter scorecard stops counting those rows in 20260929202000, and the activity report now agrees
-- with it.
--
-- An in-place edit of the LIVE body (last defined by 20260925705100, pasted through the SQL editor
-- and so stored with CRLF). The body is normalised to LF, the single anchor line must be there
-- exactly once, and the edit is a no-op when its [202100] marker is already present.
-- ---------------------------------------------------------------------------

set local lock_timeout = '5s';

do $patch$
declare
  v_src text;
  v_new text;
  v_anchor constant text :=
    E'''appointments_booked'', (select count(*) from tenant_appointments ap where ap.tenant_id = p_tenant_id and ap.booked_by = p.agent_user_id and (p_from_at is null';
  v_with constant text :=
    E'''appointments_booked'', (select count(*) from tenant_appointments ap where ap.tenant_id = p_tenant_id and ap.booked_by = p.agent_user_id and ap.status <> ''rescheduled'' /* [202100] */ and (p_from_at is null';
begin
  if to_regprocedure('public.tenant_activity_report(uuid, uuid, text, uuid, uuid, text, timestamp with time zone, timestamp with time zone, integer, integer, boolean, text)') is null then
    raise notice '20260929202100: tenant_activity_report is not in this database, nothing to patch';
    return;
  end if;
  v_src := replace(pg_get_functiondef('public.tenant_activity_report(uuid, uuid, text, uuid, uuid, text, timestamp with time zone, timestamp with time zone, integer, integer, boolean, text)'::regprocedure), E'\r\n', E'\n');
  if strpos(v_src, '[202100]') > 0 then
    raise notice '20260929202100: already applied';
    return;
  end if;
  if (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'tenant_activity_report: the appointments_booked anchor is not there exactly once';
  end if;
  v_new := replace(v_src, v_anchor, v_with);
  execute v_new;
end;
$patch$;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_src text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929202100: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if to_regprocedure('public.tenant_activity_report(uuid, uuid, text, uuid, uuid, text, timestamp with time zone, timestamp with time zone, integer, integer, boolean, text)') is null then
    return;
  end if;
  v_src := pg_get_functiondef('public.tenant_activity_report(uuid, uuid, text, uuid, uuid, text, timestamp with time zone, timestamp with time zone, integer, integer, boolean, text)'::regprocedure);
  if strpos(v_src, 'ap.booked_by = p.agent_user_id and ap.status <> ''rescheduled'' /* [202100] */') = 0 then
    raise exception 'tenant_activity_report still counts rescheduled rows in appointments_booked';
  end if;
  -- The showed figure is untouched: a rescheduled row can never be 'showed'.
  if strpos(v_src, '''appointments_showed''') = 0 then
    raise exception 'tenant_activity_report lost appointments_showed';
  end if;
end $$;
