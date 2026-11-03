-- ---------------------------------------------------------------------------
-- Audit log figures (p-adm-audit-log): the four tiles above /admin/audit-log.
--
--   Entries today   rows since 00:00 UTC today, and how many distinct staff members wrote them
--   This week       rows in the last 7 days (a rolling window, not a calendar week — user decision)
--   Money actions   rows in the last 7 days whose action is in p_money_actions
--
-- The money list is passed in rather than written here, so there is one list: lib/audit/
-- moneyActions.ts (credit notes, invoice voids, manual payments, credit grants, billing.* and the
-- overage waivers). A function that hard-coded its own copy would drift the first time an action
-- was added.
--
-- p_actor_id carries the page's per-actor rule (user decision): a super admin passes null and
-- counts every row; anyone else passes their own admin id and counts only their own actions. The
-- rule is applied by the caller exactly as the list query applies it, so the tiles can never count
-- rows the table would not show.
--
-- One pass over the last 7 days on audit_log_ts_idx (ts desc). Read-only, security invoker,
-- service_role only — the same shape as admin_tenant_activity (20260924347000). Additive: one new
-- function, nothing existing is redefined.
-- ---------------------------------------------------------------------------

create or replace function public.admin_audit_summary(
  p_actor_id uuid default null,
  p_money_actions text[] default '{}'::text[]
)
returns table (
  day_start timestamptz,
  week_start timestamptz,
  today_count bigint,
  today_admins bigint,
  week_count bigint,
  money_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with bounds as (
    select (date_trunc('day', now() at time zone 'utc') at time zone 'utc') as day_start,
           now() - interval '7 days' as week_start
  ),
  recent as (
    select a.ts, a.actor_type::text as actor_type, a.actor_id, a.action
      from public.audit_log a, bounds b
     where a.ts >= b.week_start
       and (p_actor_id is null or a.actor_id = p_actor_id)
  )
  select b.day_start,
         b.week_start,
         count(r.ts) filter (where r.ts >= b.day_start),
         count(distinct r.actor_id) filter (where r.ts >= b.day_start and r.actor_type = 'admin'),
         count(r.ts),
         count(r.ts) filter (where r.action = any(coalesce(p_money_actions, '{}'::text[])))
    from bounds b
    left join recent r on true
   group by b.day_start, b.week_start;
$$;

comment on function public.admin_audit_summary(uuid, text[]) is
  'Figures above /admin/audit-log: rows today (UTC) and distinct staff today, rows and money actions in the last 7 days. p_actor_id null = every actor (super admin); otherwise only that admin''s rows. See 20260924355000.';

revoke all on function public.admin_audit_summary(uuid, text[]) from public, anon, authenticated, tenant_app;
grant execute on function public.admin_audit_summary(uuid, text[]) to service_role;

-- Assert the effect: the function exists with this signature, only service_role may run it, it
-- always answers exactly one row, and an actor that has never acted counts zero everywhere.
do $$
declare
  v_rows integer;
  v_today bigint;
  v_week bigint;
  v_money bigint;
  v_admins bigint;
begin
  -- The parse-checker runs this with a role that cannot create anything, so nothing above landed
  -- and there is nothing to assert. Same guard as 20260924346000.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260924355000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if to_regprocedure('public.admin_audit_summary(uuid, text[])') is null then
    raise exception 'admin_audit_summary(uuid, text[]) was not created';
  end if;

  if not has_function_privilege('service_role', 'public.admin_audit_summary(uuid, text[])', 'execute') then
    raise exception 'service_role cannot execute admin_audit_summary';
  end if;
  if has_function_privilege('anon', 'public.admin_audit_summary(uuid, text[])', 'execute')
     or has_function_privilege('authenticated', 'public.admin_audit_summary(uuid, text[])', 'execute') then
    raise exception 'admin_audit_summary is executable by anon or authenticated; it must be service_role only';
  end if;

  select count(*) into v_rows from public.admin_audit_summary(null, array['credit_note.approved']);
  if v_rows <> 1 then
    raise exception 'admin_audit_summary returned % rows; it must always return one', v_rows;
  end if;

  select s.today_count, s.week_count, s.money_count, s.today_admins
    into v_today, v_week, v_money, v_admins
    from public.admin_audit_summary(gen_random_uuid(), array['credit_note.approved']) s;
  if v_today <> 0 or v_week <> 0 or v_money <> 0 or v_admins <> 0 then
    raise exception 'admin_audit_summary counted rows for an actor that does not exist';
  end if;

  raise notice '20260924355000: admin_audit_summary in place';
end $$;
