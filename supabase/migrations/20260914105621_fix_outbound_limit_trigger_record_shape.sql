-- A trigger record only exposes the columns of its own table. Keep the two
-- table-specific branches separate so tenant_users inserts never evaluate
-- NEW.status (which belongs to tenant_campaigns).
create or replace function public.enforce_outbound_fixed_limits()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_plan uuid;
  v_cap integer;
  v_used integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text, 0));
  v_plan := public.tenant_current_plan(new.tenant_id);

  if tg_table_name = 'tenant_users' then
    if new.role::text = 'setter' then
      select max_setter_seats into v_cap from public.plan_limits where plan_id = v_plan;
      if v_cap is not null then
        select count(*)::integer into v_used
          from public.tenant_users
         where tenant_id = new.tenant_id and role::text = 'setter';
        if v_used > v_cap then
          raise exception 'max_setter_seats:%:%', v_used - 1, v_cap;
        end if;
      end if;
    end if;
  elsif tg_table_name = 'tenant_campaigns' then
    if new.status = 'active' then
      select max_active_campaigns into v_cap from public.plan_limits where plan_id = v_plan;
      if v_cap is not null then
        select count(*)::integer into v_used
          from public.tenant_campaigns
         where tenant_id = new.tenant_id and status = 'active';
        if v_used > v_cap then
          raise exception 'max_active_campaigns:%:%', v_used - 1, v_cap;
        end if;
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_outbound_fixed_limits()
  from public, anon, authenticated, tenant_app;
