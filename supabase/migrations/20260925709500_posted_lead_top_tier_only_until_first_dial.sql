-- ---------------------------------------------------------------------------
-- Dialer · a posted lead is top tier only until its first dial
--
-- Found 2026-09-25 (Module 2 readiness, LA-2.5-4): a lead posted by a real-time vendor stays in tier 1
-- for five minutes after it arrives, and tier 1 checks nothing else. The retry timer and the slot
-- rotation live in tier 4 ('retry' with next_dial_after due), so a posted lead dialled with no answer
-- was served straight back: 7 no_answer dials in 37 seconds, all in the same slot, and the lead was
-- exhausted before its first retry was due.
--
-- The fix, and nothing else: the tier-1 branch also requires that the lead has not been dialled yet
-- (coalesce(l.attempts_made, 0) = 0). After its first dial a posted lead is an ordinary lead and
-- follows the cadence like any other. The branch is written identically in five places:
-- serve_next_lead (scored and control paths), serve_lead_by_id, dialer_queue_preview and
-- scoring_queue_preview (latest definitions: 20260925709000). Each function's own source is edited in
-- place, the way 20260922200000 did, so nothing else in these long functions changes, and the
-- previews keep matching the serve they preview. Re-running is a no-op.
-- ---------------------------------------------------------------------------

do $$
declare
  v_old constant text := 'when l.posted_at is not null and l.posted_at >= v_now - interval ''5 minutes'' then 1';
  v_new constant text := 'when l.posted_at is not null and l.posted_at >= v_now - interval ''5 minutes'' and coalesce(l.attempts_made, 0) = 0 then 1';
  v_fn record;
  v_src text;
  v_count integer;
  v_expected integer;
  v_total integer := 0;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709500: skipped, % cannot create in public', current_user;
    return;
  end if;

  for v_fn in
    select p.oid, p.proname
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('serve_next_lead', 'serve_lead_by_id', 'dialer_queue_preview', 'scoring_queue_preview')
  loop
    v_src := pg_get_functiondef(v_fn.oid);
    v_count := (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old);
    if v_count = 0 then
      if strpos(v_src, v_new) > 0 then
        raise notice '%: already limited to undialled posted leads', v_fn.proname;
        continue;
      end if;
      raise exception '%: the tier-1 posted-lead branch is not in the expected form; fix by hand', v_fn.proname;
    end if;
    -- Worked out first: inside an IF, PL/pgSQL would end the condition at the CASE's own THEN.
    v_expected := case v_fn.proname when 'serve_next_lead' then 2 else 1 end;
    if v_count <> v_expected then
      raise exception '%: expected the tier-1 branch % time(s), found %', v_fn.proname, v_expected, v_count;
    end if;
    execute replace(v_src, v_old, v_new);
    v_total := v_total + v_count;
  end loop;
  raise notice 'tier 1 now ends at the first dial (% branches edited)', v_total;
end $$;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_fn record;
  v_src text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709500: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  for v_fn in
    select p.oid, p.proname from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('serve_next_lead', 'serve_lead_by_id', 'dialer_queue_preview', 'scoring_queue_preview')
  loop
    v_src := pg_get_functiondef(v_fn.oid);
    if strpos(v_src, 'interval ''5 minutes'' then 1') > 0 then
      raise exception '%: a posted lead can still be tier 1 after it has been dialled', v_fn.proname;
    end if;
    if strpos(v_src, 'interval ''5 minutes'' and coalesce(l.attempts_made, 0) = 0 then 1') = 0 then
      raise exception '%: the undialled-only tier-1 branch is missing', v_fn.proname;
    end if;
    -- 20260925709000's rules must survive: holder first, and tier 2 through callback_tier_due.
    if strpos(v_src, 'callback_tier_due(p_tenant_id, q.id, v_now) then 2') = 0 then
      raise exception '%: the due-callback tier was lost', v_fn.proname;
    end if;
  end loop;
end $$;
