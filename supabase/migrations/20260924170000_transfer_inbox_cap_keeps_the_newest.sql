-- The inbox's 500-row cap stops hiding the transfers that just arrived.
--
-- list_transfer_inbox returned the OLDEST 500 matching rows. Two ways that hid live calls:
--
--   Agent Floor read it with p_status 'all', which includes every completed, closed, dropped and
--   expired transfer the tenant ever had. Those never leave, so once a tenant passed 500 lifetime
--   transfers the oldest history filled every row and a transfer arriving now could not appear in
--   "Waiting transfers" or "On calls" at all.
--
--   The inbox's own views kept the oldest 500 too. Past the cap, the rows dropped were the newest:
--   the caller who is on the line right now, in favour of ones whose callers left hours ago.
--
-- 1. p_status 'open': unclaimed plus the in-progress statuses -- the same five createAgentFloorNudge
--    (lib/agentFloor/service.ts) treats as live. The Floor asks for this instead of 'all'.
-- 2. The cap keeps the NEWEST 500 and still returns them oldest first, so the display order --
--    longest waiting at the top -- does not change. Below the cap nothing changes at all.
-- 3. list_transfer_inbox_bundle says when the cap was reached (`truncated`), so neither screen
--    claims to be showing everything when it is not. The bundle returns jsonb, so a new key is
--    additive; its signature is unchanged.
--
-- Signatures and return types of both functions are identical to 20260924160000 / 20260915120000.
-- lead_queue_inbox_inbound_idx (tenant_id, status, queued_at) where partner_id is not null already
-- serves a newest-first read: it is the same index scanned backward.

create or replace function public.list_transfer_inbox(
  p_tenant_id uuid,
  p_status text default 'unclaimed',
  p_partner_id uuid default null,
  p_product_line text default null,
  p_state text default null,
  p_screening_outcome text default null,
  p_claimed_by uuid default null
)
returns table (
  id uuid, lead_id uuid, partner_id uuid, partner_name text, product_line text, status text,
  owner_user_id uuid, owner_name text, claimed_at timestamptz, queued_at timestamptz,
  wait_seconds integer, customer text, age text, state text, screening_outcome text,
  screening_warning text, duplicate_warning boolean, preflight_status text, preflight_result jsonb
)
language sql security definer set search_path = public, pg_catalog
as $$
  select newest.* from (
    select q.id as id, q.lead_id as lead_id, q.partner_id as partner_id, coalesce(p.name, 'Unassigned partner') as partner_name, q.product_line as product_line,
      q.status as status, coalesce(q.owner_user_id, q.claimed_by) as owner_user_id, u.name as owner_name, q.claimed_at as claimed_at, q.queued_at as queued_at,
      greatest(0, floor(extract(epoch from (now() - q.queued_at)))::integer) as wait_seconds,
      coalesce(nullif(btrim(l.values->>'full_name'), ''), nullif(btrim(l.values->>'name'), ''),
        nullif(btrim(concat_ws(' ', l.values->>'first_name', l.values->>'last_name')), ''), 'Unnamed customer') as customer,
      coalesce(nullif(btrim(l.values->>'age'), ''), '—') as age,
      coalesce(nullif(btrim(l.values->>'state'), ''), nullif(btrim(l.values->>'state_code'), ''), nullif(btrim(l.values->>'primary_state'), ''), nullif(btrim(l.carrier_state), ''), '—') as state,
      coalesce(nullif(btrim(q.screening_outcome), ''), nullif(btrim(l.screening_outcome), ''), 'not_checked') as screening_outcome,
      coalesce(q.screening_warning, l.screening_warning) as screening_warning,
      coalesce((l.values->>'duplicate_warning')::boolean, false) as duplicate_warning, l.preflight_status as preflight_status, l.preflight_result as preflight_result
    from public.lead_queue q
    join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
    left join public.partners p on p.id = q.partner_id and p.tenant_id = q.tenant_id
    left join public.users u on u.id = coalesce(q.owner_user_id, q.claimed_by)
    where q.tenant_id = p_tenant_id
      -- Inbound transfers only: a dialer lead is served by the dialer, not claimed from the inbox.
      and q.partner_id is not null
      and (p_status = 'all'
        -- Everything still being worked: waiting, or with an agent. Terminal history is not.
        or (p_status = 'open' and q.status in ('unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active'))
        or q.status = p_status)
      and (p_partner_id is null or q.partner_id = p_partner_id)
      and (p_product_line is null or q.product_line = p_product_line)
      and (p_claimed_by is null or coalesce(q.owner_user_id, q.claimed_by) = p_claimed_by)
      and (p_state is null or coalesce(nullif(btrim(l.values->>'state'), ''), nullif(btrim(l.values->>'state_code'), ''), nullif(btrim(l.values->>'primary_state'), ''), nullif(btrim(l.carrier_state), '')) = p_state)
      and (p_screening_outcome is null or coalesce(q.screening_outcome, l.screening_outcome, 'not_checked') = p_screening_outcome)
    -- The newest 500, so a transfer that just arrived is never the one cut. The bundle's
    -- `truncated` flag reads this same 500.
    order by q.queued_at desc limit 500
  ) newest
  order by newest.queued_at asc;
$$;

revoke all on function public.list_transfer_inbox(uuid, text, uuid, text, text, text, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.list_transfer_inbox(uuid, text, uuid, text, text, text, uuid) to service_role;

create or replace function public.list_transfer_inbox_bundle(
  p_tenant_id uuid,
  p_status text default 'unclaimed',
  p_partner_id uuid default null,
  p_product_line text default null,
  p_state text default null,
  p_screening_outcome text default null,
  p_claimed_by uuid default null,
  p_licensed_agent_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_items jsonb;
  v_handoffs jsonb := '[]'::jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(inbox_row) order by inbox_row.queued_at), '[]'::jsonb)
    into v_items
  from public.list_transfer_inbox(
    p_tenant_id,
    p_status,
    p_partner_id,
    p_product_line,
    p_state,
    p_screening_outcome,
    p_claimed_by
  ) as inbox_row;

  if p_licensed_agent_id is not null
     and exists (
       select 1
       from public.buffer_handoffs
       where tenant_id = p_tenant_id
         and licensed_agent_id = p_licensed_agent_id
         and status = 'pending'
     ) then
    select coalesce(jsonb_agg(to_jsonb(handoff_row) order by handoff_row.offered_at), '[]'::jsonb)
      into v_handoffs
    from public.list_buffer_handoffs(p_tenant_id, p_licensed_agent_id) as handoff_row;
  end if;

  -- 500 is list_transfer_inbox's limit. Reaching it means there may be more, older rows than were
  -- returned; exactly 500 matching rows also reports true, which is why the screens say "newest
  -- 500" rather than a total.
  return jsonb_build_object('items', v_items, 'handoffs', v_handoffs, 'truncated', jsonb_array_length(v_items) >= 500);
end;
$$;

revoke all on function public.list_transfer_inbox_bundle(uuid, text, uuid, text, text, text, uuid, uuid) from public;
revoke all on function public.list_transfer_inbox_bundle(uuid, text, uuid, text, text, text, uuid, uuid) from anon, authenticated, tenant_app;
grant execute on function public.list_transfer_inbox_bundle(uuid, text, uuid, text, text, text, uuid, uuid) to service_role;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'list_transfer_inbox'
       and p.prosrc like '%q.partner_id is not null%'
       and p.prosrc like '%order by q.queued_at desc limit 500%'
       and p.prosrc like '%p_status = ''open''%'
  ) then
    raise exception 'list_transfer_inbox still keeps the oldest 500 rows';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'list_transfer_inbox_bundle' and p.prosrc like '%''truncated''%'
  ) then
    raise exception 'list_transfer_inbox_bundle does not report when the cap is reached';
  end if;
end;
$$;
