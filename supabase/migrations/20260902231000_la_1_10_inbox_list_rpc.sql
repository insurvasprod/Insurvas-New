-- LA-1.10: shape the transfer inbox in one indexed database request. This avoids sending a large
-- UUID list through PostgREST and keeps the 500-row inbox latency predictable.
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
  id uuid,
  lead_id uuid,
  partner_id uuid,
  partner_name text,
  product_line text,
  status text,
  owner_user_id uuid,
  owner_name text,
  claimed_at timestamptz,
  queued_at timestamptz,
  wait_seconds integer,
  customer text,
  age text,
  state text,
  screening_outcome text,
  screening_warning text,
  duplicate_warning boolean
)
language sql
security definer
set search_path = public, pg_catalog
as $$
with shaped as (
  select
    q.id,
    q.lead_id,
    q.partner_id,
    p.name as partner_name,
    q.product_line,
    q.status,
    coalesce(q.owner_user_id, q.claimed_by) as owner_user_id,
    u.name as owner_name,
    q.claimed_at,
    q.queued_at,
    greatest(0, floor(extract(epoch from (now() - q.queued_at)))::integer) as wait_seconds,
    coalesce(nullif(btrim(l.values ->> 'full_name'), ''), nullif(btrim(l.values ->> 'name'), ''), nullif(btrim(concat_ws(' ', l.values ->> 'first_name', l.values ->> 'last_name')), ''), 'Unnamed customer') as customer,
    case
      when nullif(btrim(l.values ->> 'age'), '') is not null then btrim(l.values ->> 'age')
      when (l.values ->> 'date_of_birth') ~ '^\\d{4}-\\d{2}-\\d{2}$' then extract(year from age(current_date, (l.values ->> 'date_of_birth')::date))::integer::text
      when (l.values ->> 'dob') ~ '^\\d{4}-\\d{2}-\\d{2}$' then extract(year from age(current_date, (l.values ->> 'dob')::date))::integer::text
      else '—'
    end as age,
    coalesce(nullif(btrim(l.values ->> 'state'), ''), nullif(btrim(l.values ->> 'state_code'), ''), nullif(btrim(l.values ->> 'primary_state'), ''), '—') as state,
    coalesce(nullif(btrim(l.screening_outcome), ''), 'not_checked') as screening_outcome,
    l.screening_warning,
    (nullif(btrim(l.duplicate_override_justification), '') is not null or coalesce((l.values ->> 'duplicate_warning')::boolean, false)) as duplicate_warning
  from public.lead_queue q
  join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
  left join public.partners p on p.id = q.partner_id and p.tenant_id = q.tenant_id
  left join public.users u on u.id = coalesce(q.owner_user_id, q.claimed_by)
  where q.tenant_id = p_tenant_id
    and (p_status = 'all' or q.status = p_status)
    and (p_partner_id is null or q.partner_id = p_partner_id)
    and (p_product_line is null or q.product_line = p_product_line)
    and (p_claimed_by is null or coalesce(q.owner_user_id, q.claimed_by) = p_claimed_by)
  order by q.queued_at asc
  limit 500
)
select * from shaped
where (p_state is null or shaped.state = p_state)
  and (p_screening_outcome is null or shaped.screening_outcome = p_screening_outcome);
$$;

revoke all on function public.list_transfer_inbox(uuid, text, uuid, text, text, text, uuid) from public;
revoke all on function public.list_transfer_inbox(uuid, text, uuid, text, text, text, uuid) from anon, authenticated, tenant_app;
grant execute on function public.list_transfer_inbox(uuid, text, uuid, text, text, text, uuid) to service_role;
