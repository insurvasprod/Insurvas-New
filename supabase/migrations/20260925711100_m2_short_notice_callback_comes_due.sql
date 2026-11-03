-- LA-2.10-4 — a callback booked less than 15 minutes ahead never came due.
--
-- callback_tier_due treats "someone already dialled this lead since 15 minutes before the callback"
-- as the callback having been worked. The call that BOOKED the callback counts too when it happened
-- inside those 15 minutes, so a callback set for "in 5 minutes" was marked worked by its own booking
-- call: the lead fell out of tier 2, and as a 'working' lead it has no other tier, so nothing ever
-- served it again. Found by the Module 2 demo-readiness pass (2026-09-25): booked 17 minutes ahead →
-- tier 2 at the due time; booked 4 minutes ahead → pick refused with not_due, forever.
--
-- Only attempts made after the callback existed can have worked it.

create or replace function public.callback_tier_due(p_tenant_id uuid, p_work_item_id uuid, p_now timestamp with time zone default now())
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select exists (
    select 1
      from public.tenant_callbacks cb
     where cb.tenant_id = p_tenant_id
       and cb.work_item_id = p_work_item_id
       and cb.status in ('scheduled', 'due')
       and cb.scheduled_at_utc <= p_now
       and not exists (
         select 1 from public.tenant_call_attempts ca
          where ca.tenant_id = p_tenant_id
            and ca.lead_id = cb.lead_id
            and ca.attempted_at >= greatest(cb.scheduled_at_utc - interval '15 minutes', cb.created_at)
       )
  );
$function$;
