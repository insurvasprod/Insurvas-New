-- SA-3.4: webhook processing state is internal application state. Keep the
-- webhook table closed to direct UPDATE and expose only the two transitions
-- the receiver needs through service-only, locked functions.

create or replace function public.mark_webhook_processed(p_webhook_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.webhook_events
     set processed_at = now(),
         process_error = null
   where id = p_webhook_id;

  if not found then
    raise exception 'Webhook event does not exist.';
  end if;

  return true;
end;
$function$;

create or replace function public.mark_webhook_failed(
  p_webhook_id uuid,
  p_message text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.webhook_events
     set process_error = left(coalesce(p_message, 'unknown webhook processing failure'), 500),
         attempts = attempts + 1
   where id = p_webhook_id;

  if not found then
    raise exception 'Webhook event does not exist.';
  end if;

  return true;
end;
$function$;

revoke all on function public.mark_webhook_processed(uuid)
  from public, anon, authenticated, tenant_app;
grant execute on function public.mark_webhook_processed(uuid) to service_role;

revoke all on function public.mark_webhook_failed(uuid, text)
  from public, anon, authenticated, tenant_app;
grant execute on function public.mark_webhook_failed(uuid, text) to service_role;
