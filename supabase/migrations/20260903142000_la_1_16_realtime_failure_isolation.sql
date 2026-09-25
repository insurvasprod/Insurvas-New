-- LA-1.16: realtime delivery is advisory and must never abort a business transition.
-- The durable partner_messages row remains the source of truth; the public
-- broadcast only tells an already-authorised client to refresh its API view.
create or replace function public.broadcast_partner_message()
returns trigger
security definer
set search_path = public, pg_catalog
as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('channel_id', new.channel_id, 'message_id', new.id),
      'message',
      'partner-chat:' || new.channel_id::text,
      false
    );
  exception when others then
    -- Chat delivery is intentionally best effort. Never roll back a claim,
    -- handoff, disposition, or other state transition because Realtime is down.
    null;
  end;
  return new;
end;
$$ language plpgsql;

revoke all on function public.broadcast_partner_message() from public, anon, authenticated, tenant_app;
