-- The inbox's KPI tiles get their own numbers: list_transfer_inbox_bundle returns a `summary`.
--
-- The four tiles on /app/inbound (Waiting / longest, Claimed / with no open call record, Needs
-- review, Average wait) were computed in the browser from the rows the table had loaded, so they
-- changed with every filter: choose one partner and "Waiting" became that partner's count, and the
-- 500-row cap could cut the oldest transfer out of "longest". The tiles describe the queue, not the
-- current view.
--
-- The bundle returns jsonb, so a new key is additive, exactly as 'truncated' was in 20260924170000.
-- Its signature, return type, grants and every existing line are 20260924170000's verbatim (the
-- contract test lib/transferInbox/bundleSummaryContract.test.mjs compares them); the only changes
-- are one declared variable, the summary select before the return, and 'summary' in the result.
-- list_transfer_inbox itself (20260924250000, another change's) is not touched.
--
-- Callers that ignore the key are unaffected: Agent Floor reads items/handoffs/truncated only.

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
  v_summary jsonb;
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

  -- The KPI tiles read the tenant's whole open inbound set, whatever the filters above say, so
  -- narrowing the table never changes the queue's headline numbers. The same predicates as
  -- list_transfer_inbox's 'open' (inbound only; waiting or with an agent) and the same screening
  -- fallback, and not capped at 500. A with-agent transfer with no open active_calls row is one
  -- nobody is on a call for.
  select jsonb_build_object(
    'waiting', count(*) filter (where q.status = 'unclaimed'),
    'longest_wait_seconds', coalesce(max(greatest(0, floor(extract(epoch from (now() - q.queued_at))))::integer) filter (where q.status = 'unclaimed'), 0),
    'average_wait_seconds', coalesce(round(avg(greatest(0, extract(epoch from (now() - q.queued_at)))) filter (where q.status = 'unclaimed'))::integer, 0),
    'claimed', count(*) filter (where q.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active')),
    'claimed_without_call', count(*) filter (
      where q.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active')
        and not exists (select 1 from public.active_calls c where c.work_item_id = q.id and c.tenant_id = q.tenant_id and c.ended_at is null)),
    'needs_review', count(*) filter (where coalesce(nullif(btrim(q.screening_outcome), ''), nullif(btrim(l.screening_outcome), ''), 'not_checked') = 'dnc')
  ) into v_summary
  from public.lead_queue q
  join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
  where q.tenant_id = p_tenant_id
    and q.partner_id is not null
    and q.status in ('unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active');

  -- 500 is list_transfer_inbox's limit. Reaching it means there may be more, older rows than were
  -- returned; exactly 500 matching rows also reports true, which is why the screens say "newest
  -- 500" rather than a total.
  return jsonb_build_object('items', v_items, 'handoffs', v_handoffs, 'truncated', jsonb_array_length(v_items) >= 500, 'summary', v_summary);
end;
$$;

revoke all on function public.list_transfer_inbox_bundle(uuid, text, uuid, text, text, text, uuid, uuid) from public;
revoke all on function public.list_transfer_inbox_bundle(uuid, text, uuid, text, text, text, uuid, uuid) from anon, authenticated, tenant_app;
grant execute on function public.list_transfer_inbox_bundle(uuid, text, uuid, text, text, text, uuid, uuid) to service_role;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'list_transfer_inbox_bundle'
       and p.prosrc like '%''summary'', v_summary%'
       and p.prosrc like '%''truncated''%'
       and p.prosrc like '%claimed_without_call%'
  ) then
    raise exception 'list_transfer_inbox_bundle does not return the inbox summary';
  end if;
  if has_function_privilege('anon', 'public.list_transfer_inbox_bundle(uuid, text, uuid, text, text, text, uuid, uuid)', 'execute') then
    raise exception 'list_transfer_inbox_bundle is callable from the browser';
  end if;
end;
$$;
