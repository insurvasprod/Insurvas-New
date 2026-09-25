-- LA-1: selected partner market is the canonical routing state.
--
-- Partner intake stores carrier/state separately from the lead form values so a field
-- configuration cannot silently change the licensed market selected for the submission.
-- The inbox and Agent Floor must therefore display and filter that persisted selection when
-- the form does not also contain a state field.

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
