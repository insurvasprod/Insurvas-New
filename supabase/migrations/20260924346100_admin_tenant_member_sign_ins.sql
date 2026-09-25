-- ---------------------------------------------------------------------------
-- Admin tenant record › Users & seats: "Sign-ins (30d)"
--
-- Successful sign-ins per member of one tenant over the last N days, from login_events. One grouped
-- read instead of a count per person; login_events_user_ts_idx (user_id, ts desc) serves it.
--
-- login_events belong to a person, not to a tenant: someone in two agencies has one sign-in history,
-- and it is that history the column shows.
--
-- Read-only, service_role only (the admin plane reads through the service client).
-- ---------------------------------------------------------------------------

create or replace function public.admin_tenant_member_sign_ins(p_tenant_id uuid, p_days integer default 30)
returns table(user_id uuid, sign_ins integer)
language sql
stable
security invoker
set search_path = public
as $$
  select tu.user_id, count(le.id)::integer as sign_ins
    from public.tenant_users tu
    left join public.login_events le
      on le.user_id = tu.user_id
     and le.success
     and le.ts > now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 366)))
   where tu.tenant_id = p_tenant_id
   group by tu.user_id;
$$;

comment on function public.admin_tenant_member_sign_ins(uuid, integer) is
  'Successful sign-ins per member of a tenant over the last p_days (1-366, default 30). Admin tenant record, Users & seats. 20260924346100.';

revoke all on function public.admin_tenant_member_sign_ins(uuid, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.admin_tenant_member_sign_ins(uuid, integer) to service_role;

do $$
begin
  -- Same guard as 20260924346000: a role without CREATE could not have applied the function.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260924346100: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if to_regprocedure('public.admin_tenant_member_sign_ins(uuid,integer)') is null then
    raise exception 'admin_tenant_member_sign_ins was not created';
  end if;
  if has_function_privilege('anon', 'public.admin_tenant_member_sign_ins(uuid,integer)', 'execute') then
    raise exception 'admin_tenant_member_sign_ins must not be executable by anon';
  end if;
  raise notice '20260924346100: admin_tenant_member_sign_ins ready';
end;
$$;
