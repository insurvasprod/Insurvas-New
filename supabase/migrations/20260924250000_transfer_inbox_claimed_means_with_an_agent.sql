-- The inbox's "Claimed" filter shows every transfer an agent is working, not one status of four.
--
-- The filter sent p_status 'claimed' and list_transfer_inbox matched q.status = 'claimed' exactly,
-- which is only a licensed agent's own claim. LA-1.14's other states were missing: a buffer
-- assistant's claim is 'buffer_active' from the start (claim_transfer_lead) and so never appeared
-- under "Claimed" at all; offering it to a licensed agent makes it 'handed_pending'; accepting makes
-- it 'la_active'. An agent had each of these the whole time, and the inbox row already shows its
-- owner and an "Open lead" link.
--
-- p_status 'claimed' now matches those four -- lib/transferInbox/constants.ts WITH_AGENT_STATUSES.
-- Nothing else sends 'claimed': the inbox route is the only caller that passes a status through,
-- Agent Floor asks for 'open', and no SQL calls list_transfer_inbox except the bundle, which
-- forwards p_status unchanged. The function body is 20260924170000's plus that one clause; the
-- signature and return type are identical, and the bundle is not touched.

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
        -- "Claimed" in the inbox means with an agent, at whichever stage: a buffer assistant, a
        -- handoff in flight, or the licensed agent. Only the first of those is status 'claimed'.
        or (p_status = 'claimed' and q.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active'))
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

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'list_transfer_inbox'
       and p.prosrc like '%p_status = ''claimed'' and q.status in%'
       and p.prosrc like '%order by q.queued_at desc limit 500%'
       and p.prosrc like '%q.partner_id is not null%'
  ) then
    raise exception 'list_transfer_inbox still treats "Claimed" as one status';
  end if;
end;
$$;
