-- The Inbound inbox lists inbound transfers, not the dialer's queue.
--
-- list_transfer_inbox read every lead_queue row in the tenant, oldest first, limit 500. Since
-- 20260917146000 gave every imported lead a work item (~200k rows, status 'unclaimed', no partner,
-- queued at import), any inbound transfer queued after an import sorts behind the whole list and
-- never reaches the 500 rows the inbox returns. Agent Floor reads the same function through
-- list_transfer_inbox_bundle, so its "waiting" column would go blind the same way. When this was
-- written the only tenant with unclaimed inbound transfers had no dialer rows, so nobody had hit it.
--
-- 1. The inbox reads only rows with a partner -- the rule 20260924150000 applied to the SLA ladder.
--    Partner intake (lib/agentTemplates/intake.ts) always records one; imports and vendor posts
--    (lib/leadPost/service.ts) never do.
-- 2. A partial index, because lead_queue_tenant_status_queued_idx would otherwise walk every dialer
--    row in queued_at order before reaching the first inbound one.
--
-- The function body is 20260917130000's, unchanged except for the one added predicate. Signature
-- and return type are identical, so create or replace keeps list_transfer_inbox_bundle working.

create index if not exists lead_queue_inbox_inbound_idx
  on public.lead_queue (tenant_id, status, queued_at asc)
  where partner_id is not null;

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
  select q.id, q.lead_id, q.partner_id, coalesce(p.name, 'Unassigned partner'), q.product_line,
    q.status, coalesce(q.owner_user_id, q.claimed_by), u.name, q.claimed_at, q.queued_at,
    greatest(0, floor(extract(epoch from (now() - q.queued_at)))::integer),
    coalesce(nullif(btrim(l.values->>'full_name'), ''), nullif(btrim(l.values->>'name'), ''),
      nullif(btrim(concat_ws(' ', l.values->>'first_name', l.values->>'last_name')), ''), 'Unnamed customer'),
    coalesce(nullif(btrim(l.values->>'age'), ''), '—'),
    coalesce(nullif(btrim(l.values->>'state'), ''), nullif(btrim(l.values->>'state_code'), ''), nullif(btrim(l.values->>'primary_state'), ''), nullif(btrim(l.carrier_state), ''), '—'),
    coalesce(nullif(btrim(q.screening_outcome), ''), nullif(btrim(l.screening_outcome), ''), 'not_checked'),
    coalesce(q.screening_warning, l.screening_warning),
    coalesce((l.values->>'duplicate_warning')::boolean, false), l.preflight_status, l.preflight_result
  from public.lead_queue q
  join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
  left join public.partners p on p.id = q.partner_id and p.tenant_id = q.tenant_id
  left join public.users u on u.id = coalesce(q.owner_user_id, q.claimed_by)
  where q.tenant_id = p_tenant_id
    -- Inbound transfers only: a dialer lead is served by the dialer, not claimed from the inbox.
    and q.partner_id is not null
    and (p_status = 'all' or q.status = p_status)
    and (p_partner_id is null or q.partner_id = p_partner_id)
    and (p_product_line is null or q.product_line = p_product_line)
    and (p_claimed_by is null or coalesce(q.owner_user_id, q.claimed_by) = p_claimed_by)
    and (p_state is null or coalesce(nullif(btrim(l.values->>'state'), ''), nullif(btrim(l.values->>'state_code'), ''), nullif(btrim(l.values->>'primary_state'), ''), nullif(btrim(l.carrier_state), '')) = p_state)
    and (p_screening_outcome is null or coalesce(q.screening_outcome, l.screening_outcome, 'not_checked') = p_screening_outcome)
  order by q.queued_at asc limit 500;
$$;

revoke all on function public.list_transfer_inbox(uuid, text, uuid, text, text, text, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.list_transfer_inbox(uuid, text, uuid, text, text, text, uuid) to service_role;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'list_transfer_inbox' and p.prosrc like '%q.partner_id is not null%'
  ) then
    raise exception 'list_transfer_inbox still lists the dialer queue';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'lead_queue' and indexname = 'lead_queue_inbox_inbound_idx'
  ) then
    raise exception 'lead_queue_inbox_inbound_idx is missing';
  end if;
end;
$$;
