-- M2-4 · An add-on detach must be scoped to the subscription in the route URL.

create or replace function public.admin_detach_addon_for_subscription(
  p_subscription_id uuid,
  p_subscription_addon_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.subscription_addons
     set detached_at = now()
   where id = p_subscription_addon_id
     and subscription_id = p_subscription_id
     and detached_at is null;

  return found;
end;
$function$;

revoke all on function public.admin_detach_addon_for_subscription(uuid, uuid)
  from public, anon, authenticated, tenant_app;
grant execute on function public.admin_detach_addon_for_subscription(uuid, uuid) to service_role;
