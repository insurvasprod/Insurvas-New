-- LA-6.3 follow-up (Notion sprint, Module 6 — Compliance) · the book-wide gap scan, summarised in the
-- database.
--
-- compliance_gaps returns one row per (category, number). For a whole book that is thousands of rows,
-- and the API returns at most 1,000 per request — so the scan, and the LA-6.7 dashboard built on it,
-- saw only the first category (found 2026-10-15 on the demo agency: no out-of-hours or called-after-DNC
-- figure reached the screen). These two read compliance_gaps itself, so the checks stay in one place:
--
--   compliance_gap_summary(...)   one row per (category, status): numbers, calls, an undetermined reason.
--   compliance_gap_numbers(...)   the numbers behind one category, worst first, capped.
--
-- Requires 20261015120000. Additive. Rollback:
--   drop function if exists public.compliance_gap_summary(uuid, timestamptz, timestamptz, jsonb), public.compliance_gap_numbers(uuid, text, timestamptz, timestamptz, jsonb, integer);

create or replace function public.compliance_gap_summary(p_tenant_id uuid, p_from timestamptz default null, p_to timestamptz default null, p_claim_hours jsonb default '{}'::jsonb)
returns table(category text, status text, numbers integer, calls integer, reason text)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select g.category, g.status, count(distinct g.phone_digits)::int, coalesce(sum(g.calls), 0)::int, max(g.detail->>'reason')
    from public.compliance_gaps(p_tenant_id, null, p_from, p_to, p_claim_hours) g
   group by g.category, g.status
$$;
revoke all on function public.compliance_gap_summary(uuid, timestamptz, timestamptz, jsonb) from public, anon, authenticated, tenant_app;
grant execute on function public.compliance_gap_summary(uuid, timestamptz, timestamptz, jsonb) to service_role;

create or replace function public.compliance_gap_numbers(p_tenant_id uuid, p_category text, p_from timestamptz default null, p_to timestamptz default null,
                                                         p_claim_hours jsonb default '{}'::jsonb, p_limit integer default 300)
returns table(phone_digits text, calls integer, first_at timestamptz, last_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select g.phone_digits, g.calls, g.first_at, g.last_at
    from public.compliance_gaps(p_tenant_id, null, p_from, p_to, p_claim_hours) g
   where g.category = p_category and g.status = 'gap' and g.phone_digits is not null
   order by g.calls desc, g.phone_digits
   limit least(greatest(coalesce(p_limit, 300), 1), 1000)
$$;
revoke all on function public.compliance_gap_numbers(uuid, text, timestamptz, timestamptz, jsonb, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.compliance_gap_numbers(uuid, text, timestamptz, timestamptz, jsonb, integer) to service_role;

do $$
begin
  perform * from public.compliance_gap_summary('00000000-0000-0000-0000-000000000000'::uuid, null, null, '{"trustedform": 72}'::jsonb);
  perform * from public.compliance_gap_numbers('00000000-0000-0000-0000-000000000000'::uuid, 'called_after_dnc', null, null, '{}'::jsonb, 5);
end $$;
