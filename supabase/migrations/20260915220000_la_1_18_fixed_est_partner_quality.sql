-- LA-1.18: Partner-quality reporting is a product-wide fixed EST (UTC-5) calendar.
-- `Etc/GMT+5` is the PostgreSQL IANA identifier for UTC-5. It deliberately does not
-- observe daylight saving time; do not replace it with America/New_York.

create or replace function public.partner_quality_evidence(
  p_tenant_id uuid,
  p_from_date date,
  p_to_date date
)
returns table(
  lead_id uuid, partner_id uuid, lead_date date, full_name text, phone text,
  screening_outcome text, screening_result_outcome text, claimed boolean,
  worked boolean, submitted boolean, duplicate boolean, disposition text
)
language sql stable security definer set search_path = public
as $$
  select l.id, l.partner_id, (l.created_at at time zone 'Etc/GMT+5')::date,
    coalesce(nullif(l.values->>'full_name', ''), nullif(l.values->>'name', ''), 'Unnamed lead'),
    coalesce(l.values->>'phone', l.values->>'phone_number'), l.screening_outcome,
    coalesce(sr.outcome, (select sa.outcome from public.screening_audit sa
      where sa.tenant_id = l.tenant_id and sa.partner_id = l.partner_id
        and sa.phone_digits = right(regexp_replace(coalesce(l.values->>'phone', l.values->>'phone_number', ''), '[^0-9]', '', 'g'), 10)
      order by sa.ts desc limit 1)),
    exists (select 1 from public.lead_queue q where q.tenant_id = l.tenant_id and q.lead_id = l.id and (q.claimed_at is not null or q.status <> 'unclaimed')),
    exists (select 1 from public.deal_flow d where d.tenant_id = l.tenant_id and d.lead_id = l.id),
    exists (select 1 from public.deal_flow d where d.tenant_id = l.tenant_id and d.lead_id = l.id and d.call_result = 'application_submitted'),
    l.duplicate_override_justification is not null,
    coalesce((select d.call_result from public.deal_flow d where d.tenant_id = l.tenant_id and d.lead_id = l.id order by d.updated_at desc, d.created_at desc limit 1),
      (select q.disposition from public.lead_queue q where q.tenant_id = l.tenant_id and q.lead_id = l.id order by q.updated_at desc, q.created_at desc limit 1))
  from public.agent_leads l
  left join public.screening_results sr on sr.id = l.screening_result_id and sr.tenant_id = l.tenant_id
  where l.tenant_id = p_tenant_id and l.partner_id is not null
    -- Timestamp bounds preserve the existing tenant/partner/created_at index.
    and l.created_at >= (p_from_date::timestamp at time zone 'Etc/GMT+5')
    and l.created_at < ((p_to_date + 1)::timestamp at time zone 'Etc/GMT+5');
$$;

create or replace function public.partner_quality_report(
  p_tenant_id uuid,
  p_from_date date default null,
  p_to_date date default null
)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Etc/GMT+5')::date;
  v_from date := coalesce(p_from_date, date_trunc('month', (now() at time zone 'Etc/GMT+5'))::date);
  v_to date := coalesce(p_to_date, v_today);
  v_days integer; v_previous_from date; v_previous_to date;
  v_rows jsonb; v_dispositions jsonb; v_summary jsonb; v_previous_summary jsonb;
begin
  if v_from > v_to then raise exception 'partner_quality_invalid_date_range'; end if;
  v_days := (v_to - v_from) + 1; v_previous_from := v_from - v_days; v_previous_to := v_from - 1;

  with current_evidence as (select * from public.partner_quality_evidence(p_tenant_id, v_from, v_to)),
  previous_evidence as (select * from public.partner_quality_evidence(p_tenant_id, v_previous_from, v_previous_to)),
  current_metrics as (
    select partner_id, count(*)::integer sent, count(*) filter (where claimed)::integer claimed,
      count(*) filter (where worked)::integer worked, count(*) filter (where submitted)::integer submitted,
      count(*) filter (where screening_outcome = 'internal_dq')::integer disqualified,
      count(*) filter (where duplicate)::integer duplicates,
      count(*) filter (where screening_result_outcome = 'tcpa_litigator')::integer tcpa,
      count(*) filter (where screening_result_outcome = 'dnc' or screening_outcome = 'dnc')::integer dnc,
      count(*) filter (where screening_result_outcome = 'invalid_phone')::integer invalid
    from current_evidence group by partner_id
  ), previous_metrics as (
    select partner_id, count(*)::integer sent, count(*) filter (where claimed)::integer claimed,
      count(*) filter (where worked)::integer worked, count(*) filter (where submitted)::integer submitted,
      count(*) filter (where screening_outcome = 'internal_dq')::integer disqualified,
      count(*) filter (where duplicate)::integer duplicates,
      count(*) filter (where screening_result_outcome = 'tcpa_litigator')::integer tcpa,
      count(*) filter (where screening_result_outcome = 'dnc' or screening_outcome = 'dnc')::integer dnc,
      count(*) filter (where screening_result_outcome = 'invalid_phone')::integer invalid
    from previous_evidence group by partner_id
  ), partner_rows as (
    select p.id partner_id, p.name partner_name,
      coalesce(cm.sent, 0) sent, coalesce(cm.claimed, 0) claimed, coalesce(cm.worked, 0) worked, coalesce(cm.submitted, 0) submitted,
      coalesce(cm.disqualified, 0) disqualified, coalesce(cm.duplicates, 0) duplicates, coalesce(cm.tcpa, 0) tcpa, coalesce(cm.dnc, 0) dnc, coalesce(cm.invalid, 0) invalid,
      coalesce(pm.sent, 0) previous_sent, coalesce(pm.claimed, 0) previous_claimed, coalesce(pm.worked, 0) previous_worked, coalesce(pm.submitted, 0) previous_submitted,
      coalesce(pm.disqualified, 0) previous_disqualified, coalesce(pm.duplicates, 0) previous_duplicates, coalesce(pm.tcpa, 0) previous_tcpa, coalesce(pm.dnc, 0) previous_dnc, coalesce(pm.invalid, 0) previous_invalid
    from public.partners p left join current_metrics cm on cm.partner_id = p.id left join previous_metrics pm on pm.partner_id = p.id
    where p.tenant_id = p_tenant_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'partner_id', partner_id, 'partner_name', partner_name, 'sent', sent, 'claimed', claimed, 'worked', worked, 'submitted', submitted,
    'disqualified', disqualified, 'duplicates', duplicates, 'conversion_rate', round((submitted * 100.0 / nullif(sent, 0))::numeric, 1),
    'disqualification_rate', round((disqualified * 100.0 / nullif(sent, 0))::numeric, 1), 'duplicate_rate', round((duplicates * 100.0 / nullif(sent, 0))::numeric, 1),
    'screening', jsonb_build_object('tcpa', tcpa, 'dnc', dnc, 'invalid', invalid),
    'previous', jsonb_build_object('sent', previous_sent, 'claimed', previous_claimed, 'worked', previous_worked, 'submitted', previous_submitted,
      'conversion_rate', round((previous_submitted * 100.0 / nullif(previous_sent, 0))::numeric, 1),
      'disqualification_rate', round((previous_disqualified * 100.0 / nullif(previous_sent, 0))::numeric, 1),
      'duplicate_rate', round((previous_duplicates * 100.0 / nullif(previous_sent, 0))::numeric, 1),
      'screening', jsonb_build_object('tcpa', previous_tcpa, 'dnc', previous_dnc, 'invalid', previous_invalid)
    )) order by partner_name), '[]'::jsonb) into v_rows from partner_rows;

  with current_evidence as (select * from public.partner_quality_evidence(p_tenant_id, v_from, v_to))
  select coalesce(jsonb_agg(jsonb_build_object('partner_id', partner_id, 'dispositions', dispositions) order by partner_id), '[]'::jsonb) into v_dispositions
  from (select partner_id, jsonb_agg(jsonb_build_object('key', disposition, 'count', total) order by disposition) dispositions
    from (select partner_id, disposition, count(*)::integer total from current_evidence where disposition is not null group by partner_id, disposition) grouped group by partner_id) breakdown;

  with current_evidence as (select * from public.partner_quality_evidence(p_tenant_id, v_from, v_to))
  select jsonb_build_object('sent', count(*)::integer, 'claimed', count(*) filter (where claimed)::integer, 'worked', count(*) filter (where worked)::integer,
    'submitted', count(*) filter (where submitted)::integer, 'disqualified', count(*) filter (where screening_outcome = 'internal_dq')::integer,
    'duplicates', count(*) filter (where duplicate)::integer, 'screening', jsonb_build_object('tcpa', count(*) filter (where screening_result_outcome = 'tcpa_litigator')::integer,
    'dnc', count(*) filter (where screening_result_outcome = 'dnc' or screening_outcome = 'dnc')::integer, 'invalid', count(*) filter (where screening_result_outcome = 'invalid_phone')::integer)) into v_summary from current_evidence;

  with previous_evidence as (select * from public.partner_quality_evidence(p_tenant_id, v_previous_from, v_previous_to))
  select jsonb_build_object('sent', count(*)::integer, 'claimed', count(*) filter (where claimed)::integer, 'worked', count(*) filter (where worked)::integer,
    'submitted', count(*) filter (where submitted)::integer, 'disqualified', count(*) filter (where screening_outcome = 'internal_dq')::integer,
    'duplicates', count(*) filter (where duplicate)::integer, 'screening', jsonb_build_object('tcpa', count(*) filter (where screening_result_outcome = 'tcpa_litigator')::integer,
    'dnc', count(*) filter (where screening_result_outcome = 'dnc' or screening_outcome = 'dnc')::integer, 'invalid', count(*) filter (where screening_result_outcome = 'invalid_phone')::integer)) into v_previous_summary from previous_evidence;

  return jsonb_build_object('from', v_from, 'to', v_to, 'previous_from', v_previous_from, 'previous_to', v_previous_to,
    'rows', v_rows, 'dispositions', v_dispositions, 'summary', v_summary, 'previous_summary', v_previous_summary);
end;
$$;

revoke all on function public.partner_quality_evidence(uuid, date, date) from public, anon, authenticated, tenant_app;
revoke all on function public.partner_quality_report(uuid, date, date) from public, anon, authenticated, tenant_app;
grant execute on function public.partner_quality_evidence(uuid, date, date) to service_role;
grant execute on function public.partner_quality_report(uuid, date, date) to service_role;

do $$
declare v_lead_date date; v_default_to date; v_expected date := (now() at time zone 'Etc/GMT+5')::date;
begin
  select lead_date into v_lead_date from public.partner_quality_evidence(null, v_expected, v_expected) limit 1;
  -- An empty database cannot prove a lead conversion; the default period is still deterministic.
  select (public.partner_quality_report(p.tenant_id)->>'to')::date into v_default_to from public.partners p limit 1;
  if v_default_to is not null and v_default_to <> v_expected then raise exception 'partner quality default did not use fixed EST'; end if;
end;
$$;
