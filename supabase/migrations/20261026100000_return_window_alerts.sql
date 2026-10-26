-- LA-2.19 · "the return window counts down, and warns before it closes".
--
-- The page has always shown the days left on a claim; nothing told anybody who was not looking at
-- it. This sends a bell notification (kind `return_window_closing`, registered in
-- lib/notifications/events.ts) when a vendor's return window closes within three days and money
-- is still claimable — once at three days and once on the last day, per campaign and per window.
--
-- Read from vendor_returns_candidates_summary (20260925707500), the same figures the Returns tab
-- shows, so the alert and the page cannot disagree. Sent to the owner and the bookkeeper: the two
-- roles Vendor bills › Returns opens for in every workspace (a producer inside an agency is refused
-- it, and a notification must not lead to a locked page). Only workspaces whose plan has True CPA,
-- the feature Returns is part of. Daily, by pg_cron.
--
-- Rollback: select cron.unschedule('la2-return-window-alerts');
--           drop function public.emit_return_window_alerts(date);

create or replace function public.emit_return_window_alerts(p_today date default current_date)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_total integer := 0;
  v_n integer;
  r record;
begin
  for r in
    select te.tenant_id
      from public.tenant_entitlements te
      join public.tenants t on t.id = te.tenant_id and t.status::text <> 'suspended'
     where coalesce(te.entitlement -> 'features', '[]'::jsonb) ? 'true_cpa'
       and exists (select 1 from public.tenant_campaigns c where c.tenant_id = te.tenant_id)
  loop
    with due as (
      select s.campaign_id, s.campaign_name, s.vendor_name, s.claimable_rows, s.claimable_cents, s.days_left,
             s.soonest_closes_at,
             case when s.days_left <= 1 then '1' else '3' end as step
        from public.vendor_returns_candidates_summary(r.tenant_id) s
       where s.claimable_rows > 0
         and s.days_left between 0 and 3
    ), sent as (
      insert into public.agent_notifications (tenant_id, recipient_user_id, kind, title, body, link, source_key)
      select r.tenant_id, tu.user_id, 'return_window_closing',
             left(d.vendor_name || '’s return window closes ' ||
                  case when d.days_left = 0 then 'today' when d.days_left = 1 then 'tomorrow' else 'in ' || d.days_left || ' days' end, 160),
             left(to_char(d.claimable_cents / 100.0, 'FM$999,999,990.00') || ' for ' || d.claimable_rows || ' bad lead' ||
                  case when d.claimable_rows = 1 then '' else 's' end || ' on ' || d.campaign_name ||
                  ' is still unclaimed. Claim it before the window closes.', 1000),
             '/app/vendor-bills?tab=returns',
             -- One per step per window: a later import opens a new window, and with it new alerts.
             'return-window:' || d.campaign_id || ':' || coalesce(to_char(d.soonest_closes_at, 'YYYY-MM-DD'), 'open') || ':' || d.step
        from due d
        join public.tenant_users tu on tu.tenant_id = r.tenant_id and tu.role::text in ('owner', 'bookkeeper') and tu.accepted_at is not null
        join public.users u on u.id = tu.user_id and u.status = 'active'
      on conflict (tenant_id, recipient_user_id, source_key) do nothing
      returning 1
    )
    select count(*) into v_n from sent;
    v_total := v_total + v_n;
  end loop;
  return v_total;
end;
$$;

revoke all on function public.emit_return_window_alerts(date) from public, anon, authenticated, tenant_app;
grant execute on function public.emit_return_window_alerts(date) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('la2-return-window-alerts', '0 14 * * *', $job$select public.emit_return_window_alerts()$job$);
  end if;
end;
$$;

-- ── proof ──────────────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.emit_return_window_alerts(date)') is null then
    raise exception '20261026100000: emit_return_window_alerts did not land';
  end if;
  -- (Meaningless when tenant_app itself owns the function, as in a rolled-back rehearsal's copy.)
  if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = 'public.emit_return_window_alerts(date)'::regprocedure) <> 'tenant_app'
     and (has_function_privilege('tenant_app', 'public.emit_return_window_alerts(date)', 'execute')
          or has_function_privilege('anon', 'public.emit_return_window_alerts(date)', 'execute')) then
    raise exception '20261026100000: emit_return_window_alerts must be service-role only';
  end if;
  -- It must run: a scheduled job that errors fails silently every day. Run once here and undone
  -- (the inner block's own exception rolls back what it wrote), so applying this file sends nothing;
  -- the first real alerts go out at the next scheduled run.
  begin
    perform public.emit_return_window_alerts(current_date);
    raise exception using errcode = 'Z9999', message = 'proof run undone';
  exception when sqlstate 'Z9999' then
    null;
  end;
end;
$$;
