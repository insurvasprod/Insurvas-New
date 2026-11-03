-- LA-1.18: put back the two raw counts the partner rows lost.
--
-- 20260902202504_la_1_18_partner_quality_count_fields.sql added 'disqualified' and 'duplicates' to
-- each partner row, for a stated reason: "Rates alone are not sufficient evidence for the leads
-- behind each cell." A rate cannot be drilled -- you cannot open "33.3%", you open the nine leads
-- that produced it.
--
-- 20260903150000_la_1_18_partner_quality.sql then replayed the pre-fix definition of the same
-- function. It sorts later, so it wins, and the two keys have been absent ever since. This is the
-- same shape as the LA-1.12 correctives and the lead_queue_status_check replay: a later migration
-- treating the first declaration of an object as the whole declaration.
--
-- What it costs, confirmed against the live function rather than inferred:
--
--   {"sent":3,"claimed":1,"worked":1,"submitted":1,"duplicate_rate":33.3,"disqualification_rate":33.3}
--
-- No 'disqualified', no 'duplicates'. lib/partnerQuality/types.ts declares both as required and
-- non-optional on PartnerQualityRow, and partner-quality-workspace.tsx renders them directly as the
-- DQ and Duplicate column values -- so both columns have been rendering undefined. TypeScript could
-- not catch it: the value arrives through rpc() as Json and is asserted into the type, never checked
-- against it. verify-partner-quality has been failing on exactly this and was never wired into
-- verify:all, so nothing reported it.
--
-- Only the per-partner rows are affected. 'summary' and 'previous_summary' already carry both
-- counts, and 'previous' never declared them -- PartnerQualityPeriod does not include them, so the
-- shape below matches the declared type rather than widening it.
--
-- The body is 20260903150000's, unchanged apart from the two restored keys.

create or replace function public.partner_quality_report(
  p_tenant_id uuid,
  p_from_date date default null,
  p_to_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from date := coalesce(p_from_date, date_trunc('month', current_date)::date);
  v_to date := coalesce(p_to_date, current_date);
  v_days integer;
  v_previous_from date;
  v_previous_to date;
  v_rows jsonb;
  v_dispositions jsonb;
  v_summary jsonb;
  v_previous_summary jsonb;
begin
  if v_from > v_to then raise exception 'partner_quality_invalid_date_range'; end if;
  v_days := (v_to - v_from) + 1;
  v_previous_from := v_from - v_days;
  v_previous_to := v_from - 1;

  with current_evidence as (
    select * from public.partner_quality_evidence(p_tenant_id, v_from, v_to)
  ), previous_evidence as (
    select * from public.partner_quality_evidence(p_tenant_id, v_previous_from, v_previous_to)
  ), current_metrics as (
    select partner_id,
      count(*)::integer as sent,
      count(*) filter (where claimed)::integer as claimed,
      count(*) filter (where worked)::integer as worked,
      count(*) filter (where submitted)::integer as submitted,
      count(*) filter (where screening_outcome = 'internal_dq')::integer as disqualified,
      count(*) filter (where duplicate)::integer as duplicates,
      count(*) filter (where screening_result_outcome = 'tcpa_litigator')::integer as tcpa,
      count(*) filter (where screening_result_outcome = 'dnc' or screening_outcome = 'dnc')::integer as dnc,
      count(*) filter (where screening_result_outcome = 'invalid_phone')::integer as invalid
    from current_evidence group by partner_id
  ), previous_metrics as (
    select partner_id,
      count(*)::integer as sent,
      count(*) filter (where claimed)::integer as claimed,
      count(*) filter (where worked)::integer as worked,
      count(*) filter (where submitted)::integer as submitted,
      count(*) filter (where screening_outcome = 'internal_dq')::integer as disqualified,
      count(*) filter (where duplicate)::integer as duplicates,
      count(*) filter (where screening_result_outcome = 'tcpa_litigator')::integer as tcpa,
      count(*) filter (where screening_result_outcome = 'dnc' or screening_outcome = 'dnc')::integer as dnc,
      count(*) filter (where screening_result_outcome = 'invalid_phone')::integer as invalid
    from previous_evidence group by partner_id
  ), partner_rows as (
    select p.id as partner_id, p.name as partner_name,
      coalesce(cm.sent, 0) as sent, coalesce(cm.claimed, 0) as claimed,
      coalesce(cm.worked, 0) as worked, coalesce(cm.submitted, 0) as submitted,
      coalesce(cm.disqualified, 0) as disqualified, coalesce(cm.duplicates, 0) as duplicates,
      coalesce(cm.tcpa, 0) as tcpa, coalesce(cm.dnc, 0) as dnc, coalesce(cm.invalid, 0) as invalid,
      coalesce(pm.sent, 0) as previous_sent, coalesce(pm.claimed, 0) as previous_claimed,
      coalesce(pm.worked, 0) as previous_worked, coalesce(pm.submitted, 0) as previous_submitted,
      coalesce(pm.disqualified, 0) as previous_disqualified, coalesce(pm.duplicates, 0) as previous_duplicates,
      coalesce(pm.tcpa, 0) as previous_tcpa, coalesce(pm.dnc, 0) as previous_dnc, coalesce(pm.invalid, 0) as previous_invalid
    from public.partners p
    left join current_metrics cm on cm.partner_id = p.id
    left join previous_metrics pm on pm.partner_id = p.id
    where p.tenant_id = p_tenant_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'partner_id', partner_id,
    'partner_name', partner_name,
    'sent', sent,
    'claimed', claimed,
    'worked', worked,
    'submitted', submitted,
    'disqualified', disqualified,
    'duplicates', duplicates,
    'conversion_rate', round((submitted * 100.0 / nullif(sent, 0))::numeric, 1),
    'disqualification_rate', round((disqualified * 100.0 / nullif(sent, 0))::numeric, 1),
    'duplicate_rate', round((duplicates * 100.0 / nullif(sent, 0))::numeric, 1),
    'screening', jsonb_build_object('tcpa', tcpa, 'dnc', dnc, 'invalid', invalid),
    'previous', jsonb_build_object(
      'sent', previous_sent, 'claimed', previous_claimed, 'worked', previous_worked,
      'submitted', previous_submitted,
      'conversion_rate', round((previous_submitted * 100.0 / nullif(previous_sent, 0))::numeric, 1),
      'disqualification_rate', round((previous_disqualified * 100.0 / nullif(previous_sent, 0))::numeric, 1),
      'duplicate_rate', round((previous_duplicates * 100.0 / nullif(previous_sent, 0))::numeric, 1),
      'screening', jsonb_build_object('tcpa', previous_tcpa, 'dnc', previous_dnc, 'invalid', previous_invalid)
    )
  ) order by partner_name), '[]'::jsonb) into v_rows
  from partner_rows;

  with current_evidence as (select * from public.partner_quality_evidence(p_tenant_id, v_from, v_to))
  select coalesce(jsonb_agg(jsonb_build_object('partner_id', partner_id, 'dispositions', dispositions) order by partner_id), '[]'::jsonb)
  into v_dispositions
  from (
    select partner_id, jsonb_agg(jsonb_build_object('key', disposition, 'count', total) order by disposition) as dispositions
    from (select partner_id, disposition, count(*)::integer as total from current_evidence where disposition is not null group by partner_id, disposition) grouped
    group by partner_id
  ) breakdown;

  with current_evidence as (select * from public.partner_quality_evidence(p_tenant_id, v_from, v_to))
  select jsonb_build_object(
    'sent', count(*)::integer, 'claimed', count(*) filter (where claimed)::integer,
    'worked', count(*) filter (where worked)::integer, 'submitted', count(*) filter (where submitted)::integer,
    'disqualified', count(*) filter (where screening_outcome = 'internal_dq')::integer,
    'duplicates', count(*) filter (where duplicate)::integer,
    'screening', jsonb_build_object(
      'tcpa', count(*) filter (where screening_result_outcome = 'tcpa_litigator')::integer,
      'dnc', count(*) filter (where screening_result_outcome = 'dnc' or screening_outcome = 'dnc')::integer,
      'invalid', count(*) filter (where screening_result_outcome = 'invalid_phone')::integer
    )
  ) into v_summary from current_evidence;

  with previous_evidence as (select * from public.partner_quality_evidence(p_tenant_id, v_previous_from, v_previous_to))
  select jsonb_build_object(
    'sent', count(*)::integer, 'claimed', count(*) filter (where claimed)::integer,
    'worked', count(*) filter (where worked)::integer, 'submitted', count(*) filter (where submitted)::integer,
    'disqualified', count(*) filter (where screening_outcome = 'internal_dq')::integer,
    'duplicates', count(*) filter (where duplicate)::integer,
    'screening', jsonb_build_object(
      'tcpa', count(*) filter (where screening_result_outcome = 'tcpa_litigator')::integer,
      'dnc', count(*) filter (where screening_result_outcome = 'dnc' or screening_outcome = 'dnc')::integer,
      'invalid', count(*) filter (where screening_result_outcome = 'invalid_phone')::integer
    )
  ) into v_previous_summary from previous_evidence;

  return jsonb_build_object(
    'from', v_from, 'to', v_to, 'previous_from', v_previous_from, 'previous_to', v_previous_to,
    'rows', v_rows, 'dispositions', v_dispositions, 'summary', v_summary, 'previous_summary', v_previous_summary
  );
end;
$$;

revoke all on function public.partner_quality_report(uuid, date, date) from public, anon, authenticated, tenant_app;
grant execute on function public.partner_quality_report(uuid, date, date) to service_role;

-- Assert the shape rather than trusting the replace: this function has now been defined three times
-- and silently lost keys once.
do $$
declare
  probe jsonb;
  sample jsonb;
begin
  -- Probe a tenant that actually has a partner. Probing any tenant would let the check pass
  -- vacuously on an empty rows array, which is the assertion shape this project keeps getting
  -- caught by.
  select public.partner_quality_report(p.tenant_id, current_date, current_date) into probe
  from public.partners p limit 1;
  if probe is null then
    raise notice 'no partner in any tenant to probe; shape unverified';
    return;
  end if;
  if not (probe ? 'rows') then
    raise exception 'partner_quality_report no longer returns rows';
  end if;
  sample := probe->'rows'->0;
  if sample is null then
    raise notice 'no partner rows to probe; shape unverified';
    return;
  end if;
  if not (sample ? 'disqualified' and sample ? 'duplicates') then
    raise exception 'partner rows still missing the raw counts: %', sample;
  end if;
  if not (sample ? 'disqualification_rate' and sample ? 'duplicate_rate' and sample ? 'sent' and sample ? 'screening') then
    raise exception 'restoring the counts dropped something else: %', sample;
  end if;
end;
$$;
