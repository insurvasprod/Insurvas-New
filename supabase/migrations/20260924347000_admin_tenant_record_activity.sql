-- Admin tenant record, Activity tab: one agency's staff and system audit trail, newest first.
--
-- "What has been done to this agency" is spread over several target ids — the tenant itself, its
-- subscriptions, the people in it, its invoices — so the tab cannot ask audit_log one `target_id =`
-- question. Before this migration the app lists those ids itself and sends them as one `in (...)`
-- filter, capped so the request stays a sane size; this function does the same join in the database,
-- uncapped, and returns the page plus the total in one call.
--
-- Additive only: one index, one new function. Nothing existing is redefined.
--   * audit_log_target_ts_idx — audit_log had no index on target_id, so the audit-log screen's
--     `?target=` filter and this tab both scanned every row (45,000+). Plain CREATE INDEX: this runs
--     in the migration's transaction, and at this size the build takes well under a second.
--   * admin_tenant_activity(...) — read-only, service_role only, like the other admin_* reads.
--
-- Tenant-plane rows (actor_type 'tenant': the agency's own agents at work) are excluded; this is the
-- record of what staff and the platform did to the agency. Every admin who can open the tenant sees
-- all of it (user decision); /admin/audit-log keeps its own stricter per-actor rule.

create index if not exists audit_log_target_ts_idx on public.audit_log (target_id, ts desc);

create or replace function public.admin_tenant_activity(
  p_tenant_id uuid,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  ts timestamptz,
  actor_type text,
  actor_id uuid,
  action text,
  target_type text,
  target_id text,
  reason text,
  metadata jsonb,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with targets as (
    select p_tenant_id::text as target_id
    union
    select s.id::text from public.subscriptions s where s.tenant_id = p_tenant_id
    union
    select tu.user_id::text from public.tenant_users tu where tu.tenant_id = p_tenant_id
    union
    select i.id::text from public.platform_invoices i where i.tenant_id = p_tenant_id
  ),
  matched as (
    select a.id, a.ts, a.actor_type::text as actor_type, a.actor_id, a.action, a.target_type, a.target_id,
           a.reason, a.metadata
      from public.audit_log a
      join targets t on t.target_id = a.target_id
     where a.actor_type::text <> 'tenant'
  )
  select m.id, m.ts, m.actor_type, m.actor_id, m.action, m.target_type, m.target_id, m.reason, m.metadata,
         count(*) over () as total_count
    from matched m
   order by m.ts desc, m.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.admin_tenant_activity(uuid, integer, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.admin_tenant_activity(uuid, integer, integer) to service_role;

-- Assert the effect: the index exists on the right columns, the function exists with this exact
-- signature, only service_role may run it, and it answers (on a random uuid: zero rows, no error).
do $$
declare
  v_rows integer;
begin
  -- The parse-checker runs this with a role that cannot create anything, so nothing above landed
  -- and there is nothing to assert. Same guard as 20260924346000.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260924347000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'audit_log' and indexname = 'audit_log_target_ts_idx'
       and indexdef ilike '%(target_id, ts desc)%'
  ) then
    raise exception 'audit_log_target_ts_idx is missing or not on (target_id, ts desc)';
  end if;

  if to_regprocedure('public.admin_tenant_activity(uuid, integer, integer)') is null then
    raise exception 'admin_tenant_activity(uuid, integer, integer) was not created';
  end if;

  if not has_function_privilege('service_role', 'public.admin_tenant_activity(uuid, integer, integer)', 'execute') then
    raise exception 'service_role cannot execute admin_tenant_activity';
  end if;
  if has_function_privilege('anon', 'public.admin_tenant_activity(uuid, integer, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.admin_tenant_activity(uuid, integer, integer)', 'execute') then
    raise exception 'admin_tenant_activity is executable by anon or authenticated; it must be service_role only';
  end if;

  select count(*) into v_rows from public.admin_tenant_activity(gen_random_uuid(), 50, 0);
  if v_rows <> 0 then
    raise exception 'admin_tenant_activity returned % rows for a tenant that does not exist', v_rows;
  end if;

  raise notice 'admin tenant activity: index and function in place';
end $$;
