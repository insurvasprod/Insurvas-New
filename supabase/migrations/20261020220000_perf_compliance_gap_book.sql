-- Performance pass (2026-10-20, SQL leftovers) · Evidence report (owner): one gap scan, not seven.
--
-- lib/compliance/evidenceReport.ts bookGapScan asked compliance_gap_summary for the per-line totals and then,
-- for an owner, compliance_gap_numbers once per line with numbers (up to six more, in parallel). Each of
-- those re-runs the whole-book compliance_gaps — on the demo tenant ~240 ms of database time warm and
-- 1–3 s on a fresh connection each (its never-scrubbed section alone read 41k buffers) — so the screen paid
-- for the same scan up to seven times at once on a small instance.
--
--   compliance_gap_book(tenant, from, to, claim_hours, limit) → jsonb
--     { "summary": [ {category, status, numbers, calls, reason} ... ],        -- = compliance_gap_summary
--       "numbers": { "<category>": [ {phone_digits, calls, first_at, last_at} ... ] } }
--                                                     -- = compliance_gap_numbers(category, limit) for every
--                                                     --   category with gap rows, same order and cap
--   from ONE compliance_gaps call. compliance_gaps, compliance_gap_summary and compliance_gap_numbers are
--   unchanged. One jsonb value, so PostgREST's 1,000-row cap never truncates it.
-- The app falls back to the summary + numbers calls while this is not applied (PGRST202 / 42883).
--
-- And compliance_gaps gets plan_cache_mode = force_custom_plan. Its RETURN QUERY sections are planned for
-- their parameter values five times, then the backend may switch to a generic plan — which for this
-- function is catastrophic: in the rehearsal nine whole-book calls on one connection took
-- 1268, 441, 395, 411, 423, then 1016, 886, 2580, 8534 ms; with the setting, 0.4 s each from the third on.
-- PostgREST keeps its connections, so production lives in the slow half (the 1.2–8 s the report saw).
-- Plan choice only — the rows are the same. A later CREATE OR REPLACE of compliance_gaps without this SET
-- clause drops it again.
-- execute → service_role only, as the other two.
--
-- Parity (demo tenant, rolled-back rehearsal as tenant_app with app.tenant_id + owner app.user_id): summary
-- rows equal compliance_gap_summary's (as a set — neither orders them) and every category's numbers equal
-- compliance_gap_numbers' rows in order, for the whole book and for a date range, at limits 300 and 5.
--
-- Rollback: drop function public.compliance_gap_book(uuid, timestamptz, timestamptz, jsonb, integer);
--           alter function public.compliance_gaps(uuid, text, timestamptz, timestamptz, jsonb) reset plan_cache_mode;

begin;

alter function public.compliance_gaps(uuid, text, timestamptz, timestamptz, jsonb) set plan_cache_mode = force_custom_plan;

create or replace function public.compliance_gap_book(
  p_tenant_id uuid,
  p_from timestamp with time zone default null,
  p_to timestamp with time zone default null,
  p_claim_hours jsonb default '{}'::jsonb,
  p_limit integer default 300
)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  with g as materialized (
    select * from public.compliance_gaps(p_tenant_id, null, p_from, p_to, p_claim_hours)
  ),
  summary as (
    -- compliance_gap_summary's select, on the same rows
    select g.category, g.status, count(distinct g.phone_digits)::int as numbers, coalesce(sum(g.calls), 0)::int as calls,
           max(g.detail->>'reason') as reason
      from g
     group by g.category, g.status
  ),
  ranked as (
    -- compliance_gap_numbers' filter, order and cap, per category
    select g.category, g.phone_digits, g.calls, g.first_at, g.last_at,
           row_number() over (partition by g.category order by g.calls desc, g.phone_digits) as rn
      from g
     where g.status = 'gap' and g.phone_digits is not null
  ),
  numbers as (
    select r.category,
           jsonb_agg(jsonb_build_object('phone_digits', r.phone_digits, 'calls', r.calls, 'first_at', r.first_at, 'last_at', r.last_at)
                     order by r.rn) as rows
      from ranked r
     where r.rn <= least(greatest(coalesce(p_limit, 300), 1), 1000)
     group by r.category
  )
  select jsonb_build_object(
    'summary', coalesce((select jsonb_agg(jsonb_build_object('category', s.category, 'status', s.status, 'numbers', s.numbers,
                                                             'calls', s.calls, 'reason', s.reason)
                                          order by s.category, s.status) from summary s), '[]'::jsonb),
    'numbers', coalesce((select jsonb_object_agg(n.category, n.rows) from numbers n), '{}'::jsonb)
  );
$$;

revoke all on function public.compliance_gap_book(uuid, timestamptz, timestamptz, jsonb, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.compliance_gap_book(uuid, timestamptz, timestamptz, jsonb, integer) to service_role;

-- ─── self-check ──────────────────────────────────────────────────────────────────────────────────
-- For the tenant with the most indexed calls: the book equals the summary and the per-category numbers.
do $$
declare
  v_tenant uuid;
  v_book jsonb;
  v_ref jsonb;
  v_cat text;
begin
  if not exists (select 1 from pg_proc where oid = 'public.compliance_gaps(uuid, text, timestamptz, timestamptz, jsonb)'::regprocedure
                  and 'plan_cache_mode=force_custom_plan' = any (proconfig)) then
    raise exception 'perf: compliance_gaps is missing plan_cache_mode = force_custom_plan';
  end if;
  select i.tenant_id into v_tenant from public.compliance_index i where i.event_type = 'call_attempt'
   group by i.tenant_id order by count(*) desc limit 1;
  if v_tenant is null then
    return;
  end if;
  v_book := public.compliance_gap_book(v_tenant, null, null, '{}'::jsonb, 300);
  select coalesce(jsonb_agg(jsonb_build_object('category', s.category, 'status', s.status, 'numbers', s.numbers, 'calls', s.calls, 'reason', s.reason)
                            order by s.category, s.status), '[]'::jsonb)
    into v_ref from public.compliance_gap_summary(v_tenant, null, null, '{}'::jsonb) s;
  if v_book->'summary' is distinct from v_ref then
    raise exception 'perf: compliance_gap_book summary differs from compliance_gap_summary';
  end if;
  for v_cat in select distinct s.category from public.compliance_gap_summary(v_tenant, null, null, '{}'::jsonb) s loop
    select jsonb_agg(jsonb_build_object('phone_digits', n.phone_digits, 'calls', n.calls, 'first_at', n.first_at, 'last_at', n.last_at))
      into v_ref from public.compliance_gap_numbers(v_tenant, v_cat, null, null, '{}'::jsonb, 300) n;
    if (v_book->'numbers'->v_cat) is distinct from v_ref then
      raise exception 'perf: compliance_gap_book numbers differ from compliance_gap_numbers for %', v_cat;
    end if;
  end loop;
end;
$$;

commit;

notify pgrst, 'reload schema';
