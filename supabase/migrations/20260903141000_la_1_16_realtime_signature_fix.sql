-- LA-1.16 follow-up: realtime.broadcast_changes accepts records. Use realtime.send for the
-- intentionally small public signal because the custom partner session is not a Supabase JWT.
create or replace function public.broadcast_partner_message()
returns trigger
security definer
set search_path = public, pg_catalog
as $$
begin
  perform realtime.send(
    jsonb_build_object('channel_id', new.channel_id, 'message_id', new.id),
    'message',
    'partner-chat:' || new.channel_id::text,
    false
  );
  return new;
end;
$$ language plpgsql;

revoke all on function public.broadcast_partner_message() from public, anon, authenticated, tenant_app;
