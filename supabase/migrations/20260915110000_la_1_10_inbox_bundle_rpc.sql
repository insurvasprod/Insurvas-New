-- LA-1.10: return the transfer inbox and pending handoffs in one service-only call.
--
-- The two underlying reads already enforce the same tenant scope and ordering. Keeping their
-- implementations as the source of truth avoids duplicating business logic while removing a
-- second PostgREST round trip from the inbox hot path.
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

  if p_licensed_agent_id is not null then
    select coalesce(jsonb_agg(to_jsonb(handoff_row) order by handoff_row.offered_at), '[]'::jsonb)
      into v_handoffs
    from public.list_buffer_handoffs(p_tenant_id, p_licensed_agent_id) as handoff_row;
  end if;

  return jsonb_build_object('items', v_items, 'handoffs', v_handoffs);
end;
$$;

revoke all on function public.list_transfer_inbox_bundle(uuid, text, uuid, text, text, text, uuid, uuid) from public;
revoke all on function public.list_transfer_inbox_bundle(uuid, text, uuid, text, text, text, uuid, uuid) from anon, authenticated, tenant_app;
grant execute on function public.list_transfer_inbox_bundle(uuid, text, uuid, text, text, text, uuid, uuid) to service_role;
