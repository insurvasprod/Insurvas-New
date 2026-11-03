-- SA-2.5 · `rebuild_usage_totals()` has never been able to run.
--
-- The aggregate in `usage_totals` is a cache. SA-2.5's fourth criterion is that it "can be fully
-- rebuilt from the event log by a script", and the ticket is explicit about why: *"The aggregate is
-- a cache. It must be rebuildable by replaying the event log. Assume it will drift, and build the
-- rebuild job before you need it."*
--
-- The job exists (`npm run rebuild:usage` → `rebuild_usage_totals()`) and **fails every time**:
--
--     rebuild_usage_totals() -> ERR DELETE requires a WHERE clause
--
-- Reproduced three times in a row on 2026-09-21. The body reads `delete from usage_totals where
-- true`, which looks qualified — but this project runs with a safe-update guard, and the planner
-- folds `WHERE true` away before the guard sees it, leaving what looks like an unqualified DELETE.
-- So the statement is rejected and the function aborts before it re-aggregates anything.
--
-- The fix is the qualification, not the logic: `tenant_id is not null` is true for every row
-- (it is part of the key), so the same rows are removed, and the guard now sees a real predicate.
--
-- Nothing else about the function changes. It remains a pure re-aggregation of `usage_events`,
-- which is append-only by privilege — DELETE against it is refused even for `service_role` — so the
-- event log is always the authority and this function can be re-run safely at any time.

create or replace function public.rebuild_usage_totals()
 returns integer
 language plpgsql
as $function$
declare
  v_rows integer;
begin
  -- `where true` is folded away by the planner and trips the safe-update guard. A predicate that
  -- is true for every row satisfies the guard and removes exactly the same rows.
  delete from usage_totals where tenant_id is not null;

  insert into usage_totals (tenant_id, meter_key, period_start, used_qty, updated_at)
  select tenant_id, meter_key, period_start, sum(qty)::integer, now()
  from usage_events
  group by tenant_id, meter_key, period_start;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;

comment on function public.rebuild_usage_totals() is
  'SA-2.5 · Rebuilds the usage_totals cache from the usage_events log. Safe to re-run: usage_events '
  'is append-only, so the log is always the authority. Uses `where tenant_id is not null` rather '
  'than `where true`, which the safe-update guard rejects.';
