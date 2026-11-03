-- Restore list_buffer_handoffs. It is currently a stub that returns nothing.
--
-- 20260903120000 declares the real function for LA-1.14. 20260911100000_live_runtime_compatibility
-- then replaces it with
--
--   select null::uuid, null::uuid, ... where false;
--
-- an unconditional empty set. That file's header explains why it was written: the connected project
-- "contains the tenant shell and the older organization-era partner tables, but not the later LA
-- runtime tables", so a function joining buffer_handoffs could not be created and a stub kept the
-- application from failing outright. Reasonable at the time. It was never replaced when the tables
-- arrived, and it is the only stub of its kind in that migration.
--
-- The effect is that buffer handoffs are written and never listed. POST /api/app/inbound/handoff
-- answers 200, buffer_handoffs holds rows, and the receiving agent's inbox shows nothing — so an
-- offer cannot be accepted, progress cannot be seen before accepting, and an unaccepted handoff has
-- nothing to return from. Five of the six failures in verify-buffer-handoff are this one stub.
--
-- It is the same shape as everything else found this week: a silent no-op that is indistinguishable
-- from "there is no data". A function that returns an empty set cannot fail, so nothing reported it
-- for a month.
--
-- Two changes from the 20260903120000 original, both necessary rather than cosmetic:
--
--   verification_sessions -> tenant_verification_sessions
--     The session table moved in 20260912400000; public.verification_sessions is the CRM's.
--
--   the customer name coalesce
--     The original reads full_name then name. A template that declares first_name and last_name --
--     which the seeded Term Life template does -- matches neither, so every handoff would show
--     "Unnamed customer" to the agent being offered the call. The fuller chain below is the one
--     partner_lead_pipeline_page already uses, so the two surfaces name a customer the same way.

create or replace function public.list_buffer_handoffs(p_tenant_id uuid, p_licensed_agent_id uuid)
returns table (
  id uuid,
  work_item_id uuid,
  buffer_user_id uuid,
  buffer_name text,
  product_line text,
  customer text,
  progress_percentage integer,
  verification_session_id uuid,
  offered_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  perform public.expire_buffer_handoffs(p_tenant_id);
  return query
  select h.id, h.work_item_id, h.buffer_user_id, u.name, q.product_line,
    coalesce(
      nullif(btrim(l.values ->> 'full_name'), ''),
      nullif(btrim(concat_ws(' ', l.values ->> 'first_name', l.values ->> 'last_name')), ''),
      nullif(btrim(l.values ->> 'name'), ''),
      'Unnamed customer'
    ),
    s.progress_percentage, s.id, h.offered_at, h.expires_at
  from public.buffer_handoffs h
  join public.lead_queue q on q.id = h.work_item_id and q.tenant_id = h.tenant_id
  join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
  join public.users u on u.id = h.buffer_user_id
  join public.tenant_verification_sessions s
    on s.work_item_id = h.work_item_id and s.tenant_id = h.tenant_id and s.ended_at is null
  where h.tenant_id = p_tenant_id and h.licensed_agent_id = p_licensed_agent_id and h.status = 'pending'
  order by h.offered_at asc;
end;
$$;

revoke all on function public.list_buffer_handoffs(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.list_buffer_handoffs(uuid, uuid) to service_role;

-- Assert the stub is gone. A function whose body is "where false" parses, runs, and returns nothing
-- forever; only its text distinguishes it from a working one.
do $$
begin
  if exists (
    select 1 from pg_proc
     where proname = 'list_buffer_handoffs'
       and pronamespace = 'public'::regnamespace
       and prosrc like '%where false%'
  ) then
    raise exception 'list_buffer_handoffs is still the empty-set stub';
  end if;

  if not exists (
    select 1 from pg_proc
     where proname = 'list_buffer_handoffs'
       and pronamespace = 'public'::regnamespace
       and prosrc like '%buffer_handoffs h%'
  ) then
    raise exception 'list_buffer_handoffs does not read buffer_handoffs';
  end if;
end;
$$;
