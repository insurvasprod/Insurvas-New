-- LA-1.18: partner lead quality reporting.
-- The report is deliberately based on one filtered agent_leads population. Claim, work,
-- submission, screening and duplicate evidence are correlated to that lead, so every displayed
-- number can be drilled back to the exact leads behind it. Cost is intentionally absent; that
-- belongs to the later accounting work.

insert into public.features (id, feature_key, label, module, description, sort_order, is_archived)
values ('a18e0000-0000-4000-8000-000000000001', 'partner_quality', 'Partner lead quality', 'insight', 'Lead quality and conversion by partner', 3, false)
on conflict (feature_key) do update set
  id = excluded.id,
  label = excluded.label,
  module = excluded.module,
  description = excluded.description,
  sort_order = excluded.sort_order,
  is_archived = excluded.is_archived;

create index if not exists agent_leads_tenant_partner_created_idx
  on public.agent_leads (tenant_id, partner_id, created_at desc)
  where partner_id is not null;
create index if not exists agent_leads_tenant_partner_duplicate_idx
  on public.agent_leads (tenant_id, partner_id, created_at desc)
  where partner_id is not null and duplicate_override_justification is not null;
create index if not exists lead_queue_tenant_lead_claimed_idx
  on public.lead_queue (tenant_id, lead_id, claimed_at)
  where claimed_at is not null;
create index if not exists deal_flow_tenant_lead_result_idx
  on public.deal_flow (tenant_id, lead_id, call_result, local_date);
create index if not exists screening_results_tenant_id_outcome_idx
  on public.screening_results (tenant_id, id, outcome);

create or replace function public.partner_quality_evidence(
  p_tenant_id uuid,
  p_from_date date,
  p_to_date date
)
returns table(
  lead_id uuid,
  partner_id uuid,
  lead_date date,
  full_name text,
  phone text,
  screening_outcome text,
  screening_result_outcome text,
  claimed boolean,
  worked boolean,
  submitted boolean,
  duplicate boolean,
  disposition text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.id,
    l.partner_id,
    l.created_at::date,
    coalesce(nullif(l.values->>'full_name', ''), nullif(l.values->>'name', ''), 'Unnamed lead'),
    coalesce(l.values->>'phone', l.values->>'phone_number'),
    l.screening_outcome,
    coalesce(sr.outcome, (select sa.outcome from public.screening_audit sa
      where sa.tenant_id = l.tenant_id and sa.partner_id = l.partner_id
        and sa.phone_digits = right(regexp_replace(coalesce(l.values->>'phone', l.values->>'phone_number', ''), '[^0-9]', '', 'g'), 10)
      order by sa.ts desc limit 1)),
    exists (
      select 1 from public.lead_queue q
      where q.tenant_id = l.tenant_id and q.lead_id = l.id
        and (q.claimed_at is not null or q.status <> 'unclaimed')
    ),
    exists (
      select 1 from public.deal_flow d
      where d.tenant_id = l.tenant_id and d.lead_id = l.id
    ),
    exists (
      select 1 from public.deal_flow d
      where d.tenant_id = l.tenant_id and d.lead_id = l.id
        and d.call_result = 'application_submitted'
    ),
    l.duplicate_override_justification is not null,
    coalesce(
      (select d.call_result from public.deal_flow d
       where d.tenant_id = l.tenant_id and d.lead_id = l.id
       order by d.updated_at desc, d.created_at desc limit 1),
      (select q.disposition from public.lead_queue q
       where q.tenant_id = l.tenant_id and q.lead_id = l.id
       order by q.updated_at desc, q.created_at desc limit 1)
    )
  from public.agent_leads l
  left join public.screening_results sr on sr.id = l.screening_result_id and sr.tenant_id = l.tenant_id
  where l.tenant_id = p_tenant_id
    and l.partner_id is not null
    and l.created_at::date between p_from_date and p_to_date;
$$;

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

create or replace function public.partner_quality_leads(
  p_tenant_id uuid,
  p_from_date date,
  p_to_date date,
  p_partner_id uuid,
  p_metric text,
  p_disposition text default null,
  p_page integer default 1,
  p_page_size integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_rows jsonb;
  v_metric text := lower(btrim(coalesce(p_metric, '')));
begin
  if p_from_date > p_to_date then raise exception 'partner_quality_invalid_date_range'; end if;
  if v_metric not in ('sent', 'claimed', 'worked', 'submitted', 'disqualified', 'tcpa', 'dnc', 'invalid', 'duplicate', 'disposition') then
    raise exception 'partner_quality_invalid_metric';
  end if;
  if v_metric = 'disposition' and (p_disposition is null or btrim(p_disposition) = '') then
    raise exception 'partner_quality_disposition_required';
  end if;

  with evidence as (select * from public.partner_quality_evidence(p_tenant_id, p_from_date, p_to_date)), filtered as (
    select * from evidence e where e.partner_id = p_partner_id and case v_metric
      when 'sent' then true
      when 'claimed' then e.claimed
      when 'worked' then e.worked
      when 'submitted' then e.submitted
      when 'disqualified' then e.screening_outcome = 'internal_dq'
      when 'tcpa' then e.screening_result_outcome = 'tcpa_litigator'
      when 'dnc' then e.screening_result_outcome = 'dnc' or e.screening_outcome = 'dnc'
      when 'invalid' then e.screening_result_outcome = 'invalid_phone'
      when 'duplicate' then e.duplicate
      when 'disposition' then e.disposition = p_disposition
      else false
    end
  )
  select count(*)::integer into v_total from filtered;

  with evidence as (select * from public.partner_quality_evidence(p_tenant_id, p_from_date, p_to_date)), filtered as (
    select * from evidence e where e.partner_id = p_partner_id and case v_metric
      when 'sent' then true when 'claimed' then e.claimed when 'worked' then e.worked when 'submitted' then e.submitted
      when 'disqualified' then e.screening_outcome = 'internal_dq' when 'tcpa' then e.screening_result_outcome = 'tcpa_litigator'
      when 'dnc' then e.screening_result_outcome = 'dnc' or e.screening_outcome = 'dnc'
      when 'invalid' then e.screening_result_outcome = 'invalid_phone' when 'duplicate' then e.duplicate
      when 'disposition' then e.disposition = p_disposition else false end
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'lead_id', lead_id, 'date', lead_date, 'full_name', full_name, 'phone', phone,
    'screening_outcome', coalesce(screening_result_outcome, screening_outcome), 'disposition', disposition,
    'claimed', claimed, 'worked', worked, 'submitted', submitted, 'duplicate', duplicate
  ) order by lead_date desc, lead_id), '[]'::jsonb) into v_rows
  from (select * from filtered offset ((greatest(1, p_page) - 1) * least(1000, greatest(1, p_page_size))) limit least(1000, greatest(1, p_page_size))) page_rows;

  return jsonb_build_object('metric', v_metric, 'partner_id', p_partner_id, 'total', v_total, 'rows', v_rows);
end;
$$;

revoke all on function public.partner_quality_evidence(uuid, date, date) from public, anon, authenticated, tenant_app;
revoke all on function public.partner_quality_report(uuid, date, date) from public, anon, authenticated, tenant_app;
revoke all on function public.partner_quality_leads(uuid, date, date, uuid, text, text, integer, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.partner_quality_evidence(uuid, date, date), public.partner_quality_report(uuid, date, date), public.partner_quality_leads(uuid, date, date, uuid, text, text, integer, integer) to service_role;
