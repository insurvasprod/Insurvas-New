-- LA-1.21 follow-up: the installed Realtime API uses realtime.send, and delivery is advisory.
-- Notification rows must remain durable even when Realtime is unavailable.
create or replace function public.broadcast_agent_notification()
returns trigger security definer set search_path = public, pg_catalog
as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('notification_id', new.id),
      'notification',
      'agent-notifications:' || new.tenant_id::text || ':' || new.recipient_user_id::text,
      false
    );
  exception when others then
    null;
  end;
  return new;
end;
$$ language plpgsql;

revoke all on function public.broadcast_agent_notification() from public, anon, authenticated, tenant_app;
