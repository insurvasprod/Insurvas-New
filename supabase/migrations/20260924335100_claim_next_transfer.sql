-- "Claim next": the oldest waiting inbound transfer that matches the agent's filters, claimed in
-- one transaction.
--
-- The inbox header offers Claim next beside Reset filters. Picking "the top row" in the browser
-- and posting its id would race: two agents looking at the same list click at the same moment and
-- one of them gets ALREADY_CLAIMED for a transfer they never chose. This picks the row in the
-- database instead, with FOR UPDATE SKIP LOCKED, so concurrent callers each get a different
-- transfer (or NO_TRANSFER_WAITING), and then hands it to claim_transfer_lead — the one claim path,
-- which does the role check, the status change, the verification session and the call record.
--
-- The filters are list_transfer_inbox's own (20260924250000), spelled the same way, so "next" means
-- the first waiting row the agent would see at the top of the inbox with the same partner, product,
-- state and screening filters: inbound only (partner_id is not null), status 'unclaimed', oldest
-- queued_at first. Claimed-by is not a filter here: nothing waiting is claimed by anyone.
--
-- Service role only, like claim_transfer_lead.

create or replace function public.claim_next_transfer(
  p_tenant_id uuid,
  p_user_id uuid,
  p_owner_role text,
  p_partner_id uuid default null,
  p_product_line text default null,
  p_state text default null,
  p_screening_outcome text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_work_item_id uuid;
begin
  select q.id into v_work_item_id
    from public.lead_queue q
    join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
   where q.tenant_id = p_tenant_id
     and q.partner_id is not null
     and q.status = 'unclaimed'
     and (p_partner_id is null or q.partner_id = p_partner_id)
     and (p_product_line is null or q.product_line = p_product_line)
     and (p_state is null or coalesce(nullif(btrim(l.values->>'state'), ''), nullif(btrim(l.values->>'state_code'), ''), nullif(btrim(l.values->>'primary_state'), ''), nullif(btrim(l.carrier_state), '')) = p_state)
     and (p_screening_outcome is null or coalesce(q.screening_outcome, l.screening_outcome, 'not_checked') = p_screening_outcome)
   order by q.queued_at asc, q.id asc
   limit 1
   for update of q skip locked;

  if v_work_item_id is null then
    raise exception using errcode = 'P0002', message = 'NO_TRANSFER_WAITING';
  end if;

  -- The row is locked by this transaction, so claim_transfer_lead's own FOR UPDATE re-reads it
  -- without waiting, and its status check still refuses anything that is no longer unclaimed.
  return public.claim_transfer_lead(p_tenant_id, v_work_item_id, p_user_id, p_owner_role);
end;
$$;

revoke all on function public.claim_next_transfer(uuid, uuid, text, uuid, text, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.claim_next_transfer(uuid, uuid, text, uuid, text, text, text) to service_role;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'claim_next_transfer'
       and p.prosrc like '%skip locked%'
       and p.prosrc like '%q.partner_id is not null%'
       and p.prosrc like '%public.claim_transfer_lead(%'
  ) then
    raise exception 'claim_next_transfer is missing or does not claim through claim_transfer_lead';
  end if;
  if has_function_privilege('anon', 'public.claim_next_transfer(uuid, uuid, text, uuid, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.claim_next_transfer(uuid, uuid, text, uuid, text, text, text)', 'execute') then
    raise exception 'claim_next_transfer is callable from the browser';
  end if;
end;
$$;
