-- LA-1.13: return a complete filtered report in one server-side call.
-- The tenant id is supplied only by the server after session resolution. Public roles cannot call
-- this helper; the API service client is the only caller.

create or replace function public.list_deal_flow_report(
  p_tenant_id uuid,
  p_from_date date default null,
  p_to_date date default null,
  p_partner_id uuid default null,
  p_product_line text default null,
  p_agent_id uuid default null,
  p_status text default null,
  p_page integer default 1,
  p_page_size integer default 100
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with filtered as (
  select
    d.id, d.lead_id, d.partner_id, d.submission_id, d.product_line, d.insured_name, d.phone,
    d.initial_quote, d.tracking_id, d.local_date, d.status, d.call_result, d.notes,
    d.carrier, d.product_type, d.monthly_premium_cents, d.face_amount_cents, d.draft_date,
    d.worked_by, d.manual_entry, d.created_at, d.updated_at
  from public.deal_flow d
  where d.tenant_id = p_tenant_id
    and (p_from_date is null or d.local_date >= p_from_date)
    and (p_to_date is null or d.local_date <= p_to_date)
    and (p_partner_id is null or d.partner_id = p_partner_id)
    and (p_product_line is null or d.product_line = p_product_line)
    and (p_agent_id is null or d.worked_by = p_agent_id)
    and (p_status is null or d.status = p_status)
),
page_rows as (
  select *
  from filtered
  order by local_date desc, created_at desc
  offset ((greatest(1, p_page) - 1) * least(10000, greatest(1, p_page_size)))
  limit least(10000, greatest(1, p_page_size))
),
partner_totals as (
  select partner_id, status, count(*)::integer as total
  from filtered
  group by partner_id, status
)
select jsonb_build_object(
  'total', (select count(*)::integer from filtered),
  'rows', coalesce((select jsonb_agg(to_jsonb(page_rows) order by page_rows.local_date desc, page_rows.created_at desc) from page_rows), '[]'::jsonb),
  'summary', coalesce((select jsonb_agg(jsonb_build_object('partner_id', partner_totals.partner_id, 'status', partner_totals.status, 'total', partner_totals.total) order by partner_totals.total desc) from partner_totals), '[]'::jsonb)
);
$$;

revoke all on function public.list_deal_flow_report(uuid, date, date, uuid, text, uuid, text, integer, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.list_deal_flow_report(uuid, date, date, uuid, text, uuid, text, integer, integer) to service_role;
