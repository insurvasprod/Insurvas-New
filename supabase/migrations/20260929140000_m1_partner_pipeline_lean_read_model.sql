-- M1 perf · LA-1.17-12, the partner pipeline at 5,000 leads (target under 2 s).
--
-- Measured 2026-09-30 on the load-test workspace (partner with 5,000 queue items): the RPC alone took
-- 441 ms to 7.9 s and the route hit the statement timeout. Its `filtered` CTE carried q.* (35 columns)
-- and l.values, about 650 bytes a row, so the 5,000-row CTE spilled to disk (312 temp blocks written)
-- and was re-read from disk nine times, once per counter and facet. The route then made three more
-- reads beside it (the told flags, submitted since midnight, oldest open), and "submitted since
-- midnight" walked every one of the partner's queue items with a per-row lead lookup (4 to 9 s).
--
-- Restated from the LIVE definition (read 2026-09-30, which is 20260912370000's body). Changes:
--   * filtered carries only the twelve columns the payload and the counters read, not q.* and
--     l.values. The customer name and the closer's name are worked out for the page's rows only.
--   * The four counters read filtered in one pass instead of four.
--   * work_mem 16MB and jit off, which 20260903360000 and 20260906130000 set and 20260912370000's
--     create-or-replace silently dropped, are restated. Parallel workers are off for this read: a
--     5,000-row bounded read gains nothing from them and on 2026-09-30 the worker start-up was the
--     slowest part of the plan.
--   * Three additive fields, so the route can stop making its three extra reads:
--       rows[i][15]        true when the SLA ladder has told the partner (sla_partner_notified_at)
--                          and the item is still unclaimed or expired (lanes.ts nobodyClaimed)
--       oldest_open_at     the oldest queued_at among the board's open lanes
--       submitted_recent   [bucket, count] pairs, a bucket being 15 minutes of lead creation time
--                          (epoch seconds / 900) over the last 26 hours. Every time zone's midnight
--                          falls on a 15-minute boundary, so the route sums the buckets from its
--                          own startOfTodayIn(zone) with no time-zone rules in the database.
--     lib/partnerLeads/service.ts reads them when present and falls back to its own reads when not,
--     so the route works before and after this file.
-- Payload positions 0 to 14 and every other key are unchanged.

create or replace function public.partner_lead_pipeline_page(p_tenant_id uuid, p_partner_id uuid, p_date_from date default null::date, p_date_to date default null::date, p_closer_id uuid default null::uuid, p_product text default null::text, p_stage_id uuid default null::uuid, p_outcome text default null::text, p_timezone text default 'UTC'::text, p_limit integer default 250, p_offset integer default 0)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'pg_catalog'
 set work_mem to '16MB'
 set jit to 'off'
 set max_parallel_workers_per_gather to '0'
as $function$
  with filtered as materialized (
    select q.id, q.lead_id, q.queued_at, q.updated_at, q.product_line, q.stage_id, q.stage_key, q.pipeline_id,
      q.disposition, q.status, q.sla_partner_notified_at,
      l.created_at as submitted_at, l.created_by as submitted_by_id
    from public.lead_queue q join public.agent_leads l on l.id=q.lead_id and l.tenant_id=q.tenant_id
    where q.tenant_id=p_tenant_id and q.partner_id=p_partner_id
      and (p_date_from is null or q.queued_at >= p_date_from::timestamptz)
      and (p_date_to is null or q.queued_at < (p_date_to + 1)::timestamptz)
      and (p_closer_id is null or l.created_by=p_closer_id)
      and (p_product is null or q.product_line=p_product)
      and (p_stage_id is null or q.stage_id=p_stage_id)
      and (p_outcome is null or q.disposition=p_outcome)
  ), page_keys as (
    select * from filtered order by queued_at desc, id desc
    limit least(greatest(coalesce(p_limit,250),1),5000) offset greatest(coalesce(p_offset,0),0)
  ), page as (
    select k.*, coalesce(u.name, 'Partner closer') as submitted_by_name,
      coalesce(nullif(btrim(l.values->>'full_name'), ''), nullif(btrim(concat_ws(' ', l.values->>'first_name', l.values->>'last_name')), ''), nullif(btrim(l.values->>'name'), ''), 'Unnamed lead') as customer
    from page_keys k join public.agent_leads l on l.id=k.lead_id
    left join public.users u on u.id=k.submitted_by_id
  ), stage_rows as (
    select coalesce(stage_id::text, stage_key) as stage_id, coalesce(pipeline_id::text,'default') as pipeline_id,
      coalesce(stage_key,'New') as stage_name, count(*)::integer as lead_count
    from filtered group by coalesce(stage_id::text, stage_key), coalesce(pipeline_id::text,'default'), coalesce(stage_key,'New')
  ), totals as (
    select count(*)::integer as total,
      (count(*) filter (where submitted_at::date = current_date))::integer as submitted_today,
      (count(*) filter (where status in ('claimed','buffer_active','handed_pending','la_active')))::integer as claimed,
      (count(*) filter (where status not in ('completed','dropped')))::integer as still_open,
      min(queued_at) filter (where status in ('unclaimed','claimed','buffer_active','handed_pending','la_active')) as oldest_open_at
    from filtered
  ), page_size as (select count(*)::integer as n from page_keys)
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_array(lead_id, id, customer, submitted_at, updated_at, product_line,
      coalesce(stage_id::text, stage_key), coalesce(stage_key,'New'), 'open', disposition, disposition, null,
      submitted_by_id, submitted_by_name, status,
      (sla_partner_notified_at is not null and status in ('unclaimed','expired'))) order by queued_at desc, id desc) from page), '[]'::jsonb),
    'stages', coalesce((select jsonb_agg(jsonb_build_array(stage_id,pipeline_id,'Default pipeline',stage_name,0,'open','#64748b',false,lead_count)) from stage_rows), '[]'::jsonb),
    'closers', coalesce((select jsonb_agg(jsonb_build_array(c.submitted_by_id, coalesce(u.name, 'Partner closer'))) from (select distinct submitted_by_id from filtered where submitted_by_id is not null) c left join public.users u on u.id=c.submitted_by_id), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(product_line) from (select distinct product_line from filtered) p), '[]'::jsonb),
    'outcomes', coalesce((select jsonb_agg(jsonb_build_array(disposition, disposition)) from (select distinct disposition from filtered where disposition is not null) o), '[]'::jsonb),
    'total', totals.total,
    'next_offset', case when greatest(coalesce(p_offset,0),0)+page_size.n<totals.total then greatest(coalesce(p_offset,0),0)+page_size.n else null end,
    'counters', jsonb_build_object(
      'submittedToday', totals.submitted_today,
      'claimed', totals.claimed,
      'converted', 0,
      'stillOpen', totals.still_open
    ),
    'oldest_open_at', totals.oldest_open_at,
    'submitted_recent', coalesce((select jsonb_agg(jsonb_build_array(b.bucket, b.n) order by b.bucket) from (
      select floor(extract(epoch from submitted_at) / 900)::bigint as bucket, count(*)::integer as n
      from filtered where submitted_at >= now() - interval '26 hours' group by 1) b), '[]'::jsonb)
  ) from totals, page_size;
$function$;

revoke all on function public.partner_lead_pipeline_page(uuid, uuid, date, date, uuid, text, uuid, text, text, integer, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.partner_lead_pipeline_page(uuid, uuid, date, date, uuid, text, uuid, text, text, integer, integer) to service_role;

do $$
declare
  v_sig regprocedure := 'public.partner_lead_pipeline_page(uuid,uuid,date,date,uuid,text,uuid,text,text,integer,integer)'::regprocedure;
  v_body text;
  v_config text[];
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929140000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  v_body := replace(pg_get_functiondef(v_sig), E'\r\n', E'\n');
  select proconfig into v_config from pg_proc where oid = v_sig;
  if position('select q.*' in v_body) > 0 or position('q.*, l.values' in v_body) > 0 then
    raise exception '20260929140000: filtered still carries q.* or l.values';
  end if;
  if position('filtered as materialized' in v_body) = 0 or position('page_keys' in v_body) = 0 then
    raise exception '20260929140000: the lean filtered / page_keys shape is not live';
  end if;
  if position('submitted_recent' in v_body) = 0 or position('oldest_open_at' in v_body) = 0 then
    raise exception '20260929140000: the additive route fields are missing';
  end if;
  if not (v_config @> array['work_mem=16MB', 'jit=off', 'max_parallel_workers_per_gather=0']) then
    raise exception '20260929140000: function settings not applied: %', v_config;
  end if;
  if has_function_privilege('anon', v_sig, 'execute') or has_function_privilege('authenticated', v_sig, 'execute') then
    raise exception '20260929140000: the pipeline read model is callable by a public role';
  end if;
end
$$;
