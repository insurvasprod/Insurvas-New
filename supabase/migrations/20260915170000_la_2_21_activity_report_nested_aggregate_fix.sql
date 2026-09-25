-- LA-2.21 · Fix activity scorecard aggregation for PostgreSQL.
-- The original scorecard attempted to aggregate JSON objects containing count()
-- expressions in the same SELECT, which PostgreSQL rejects as nested aggregates.
-- Keep the per-agent counts in an intermediate relation, then build the JSON array.

create or replace function public.tenant_activity_report(
  p_tenant_id uuid, p_actor_user_id uuid, p_actor_role text,
  p_agent_user_id uuid default null, p_campaign_id uuid default null, p_disposition text default null,
  p_from_at timestamptz default null, p_to_at timestamptz default null,
  p_page integer default 1, p_page_size integer default 50, p_export boolean default false
)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare
  v_rows jsonb;
  v_total bigint;
  v_size integer := least(greatest(coalesce(p_page_size, 50), 1), 500);
  v_page integer := greatest(coalesce(p_page, 1), 1);
begin
  if p_actor_role = 'setter' then p_agent_user_id := p_actor_user_id; end if;

  with filtered as (
    select a.*, coalesce(u.name, 'Unknown agent') as agent_name, c.name as campaign_name,
      l.values->>'full_name' as lead_name,
      array_remove(array[
        case when a.disposition is not null and a.clicked_at is null then 'zero_click_disposition' end,
        case when a.disposition is null then 'served_never_dispositioned' end,
        case when a.disposition is not null and a.card_open_seconds is not null and a.card_open_seconds < 5 then 'impossibly_fast_disposition' end
      ], null) as integrity_flags
    from tenant_lead_activity a
    left join users u on u.id = a.agent_user_id
    left join tenant_campaigns c on c.id = a.campaign_id
    join agent_leads l on l.id = a.lead_id and l.tenant_id = a.tenant_id
    where a.tenant_id = p_tenant_id
      and (p_agent_user_id is null or a.agent_user_id = p_agent_user_id)
      and (p_campaign_id is null or a.campaign_id = p_campaign_id)
      and (p_disposition is null or a.disposition = p_disposition)
      and (p_from_at is null or a.served_at >= p_from_at)
      and (p_to_at is null or a.served_at < p_to_at)
      and (p_actor_role <> 'setter' or a.agent_user_id = p_actor_user_id)
  )
  select count(*) into v_total from filtered;

  if p_export then
    with filtered as (
      select a.*, coalesce(u.name, 'Unknown agent') as agent_name, c.name as campaign_name,
        l.values->>'full_name' as lead_name,
        array_remove(array[
          case when a.disposition is not null and a.clicked_at is null then 'zero_click_disposition' end,
          case when a.disposition is null then 'served_never_dispositioned' end,
          case when a.disposition is not null and a.card_open_seconds is not null and a.card_open_seconds < 5 then 'impossibly_fast_disposition' end
        ], null) as integrity_flags
      from tenant_lead_activity a
      left join users u on u.id = a.agent_user_id
      left join tenant_campaigns c on c.id = a.campaign_id
      join agent_leads l on l.id = a.lead_id and l.tenant_id = a.tenant_id
      where a.tenant_id = p_tenant_id
        and (p_agent_user_id is null or a.agent_user_id = p_agent_user_id)
        and (p_campaign_id is null or a.campaign_id = p_campaign_id)
        and (p_disposition is null or a.disposition = p_disposition)
        and (p_from_at is null or a.served_at >= p_from_at)
        and (p_to_at is null or a.served_at < p_to_at)
        and (p_actor_role <> 'setter' or a.agent_user_id = p_actor_user_id)
    )
    select coalesce(jsonb_agg(to_jsonb(filtered) order by served_at desc, id desc), '[]'::jsonb)
      into v_rows from filtered;
  else
    with filtered as (
      select a.*, coalesce(u.name, 'Unknown agent') as agent_name, c.name as campaign_name,
        l.values->>'full_name' as lead_name,
        array_remove(array[
          case when a.disposition is not null and a.clicked_at is null then 'zero_click_disposition' end,
          case when a.disposition is null then 'served_never_dispositioned' end,
          case when a.disposition is not null and a.card_open_seconds is not null and a.card_open_seconds < 5 then 'impossibly_fast_disposition' end
        ], null) as integrity_flags
      from tenant_lead_activity a
      left join users u on u.id = a.agent_user_id
      left join tenant_campaigns c on c.id = a.campaign_id
      join agent_leads l on l.id = a.lead_id and l.tenant_id = a.tenant_id
      where a.tenant_id = p_tenant_id
        and (p_agent_user_id is null or a.agent_user_id = p_agent_user_id)
        and (p_campaign_id is null or a.campaign_id = p_campaign_id)
        and (p_disposition is null or a.disposition = p_disposition)
        and (p_from_at is null or a.served_at >= p_from_at)
        and (p_to_at is null or a.served_at < p_to_at)
        and (p_actor_role <> 'setter' or a.agent_user_id = p_actor_user_id)
    )
    select coalesce(jsonb_agg(to_jsonb(page_rows) order by served_at desc, id desc), '[]'::jsonb)
      into v_rows
      from (select * from filtered order by served_at desc, id desc limit v_size offset (v_page - 1) * v_size) page_rows;
  end if;

  return jsonb_build_object(
    'rows', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_size, 'export', p_export,
    'scorecard', (
      with visible as (
        select a.* from tenant_lead_activity a
        where a.tenant_id = p_tenant_id
          and (p_agent_user_id is null or a.agent_user_id = p_agent_user_id)
          and (p_campaign_id is null or a.campaign_id = p_campaign_id)
          and (p_disposition is null or a.disposition = p_disposition)
          and (p_from_at is null or a.served_at >= p_from_at)
          and (p_to_at is null or a.served_at < p_to_at)
          and (p_actor_role <> 'setter' or a.agent_user_id = p_actor_user_id)
      ),
      per_agent as (
        select v.agent_user_id,
          count(*)::integer as served,
          count(*) filter (where v.clicked_at is not null)::integer as clicked,
          count(*) filter (where v.disposition is not null)::integer as logged,
          count(*) filter (where v.disposition is not null and v.disposition not in ('no_answer','voicemail','busy','call_dropped','wrong_number','disconnected'))::integer as contacts
        from visible v
        group by v.agent_user_id
      )
      select coalesce(jsonb_agg(jsonb_build_object(
        'agent_user_id', p.agent_user_id,
        'agent_name', (select coalesce(u.name, 'Unknown agent') from users u where u.id = p.agent_user_id),
        'served', p.served,
        'clicked', p.clicked,
        'logged', p.logged,
        'contact_rate_percent', case when p.clicked > 0 then round(100.0 * p.contacts / p.clicked, 1) end,
        'disposition_breakdown', (
          select coalesce(jsonb_object_agg(coalesce(d.disposition, 'unlogged'), d.n), '{}'::jsonb)
          from (select v2.disposition, count(*) n from visible v2 where v2.agent_user_id = p.agent_user_id group by v2.disposition) d
        ),
        'callbacks_booked', (select count(*) from tenant_callbacks cb where cb.tenant_id = p_tenant_id and cb.assigned_to = p.agent_user_id and (p_from_at is null or cb.created_at >= p_from_at) and (p_to_at is null or cb.created_at < p_to_at)),
        'callbacks_kept', (select count(*) from tenant_callbacks cb where cb.tenant_id = p_tenant_id and cb.assigned_to = p.agent_user_id and cb.status = 'completed' and (p_from_at is null or cb.created_at >= p_from_at) and (p_to_at is null or cb.created_at < p_to_at)),
        'appointments_booked', (select count(*) from tenant_appointments ap where ap.tenant_id = p_tenant_id and ap.booked_by = p.agent_user_id and (p_from_at is null or ap.created_at >= p_from_at) and (p_to_at is null or ap.created_at < p_to_at)),
        'appointments_showed', (select count(*) from tenant_appointments ap where ap.tenant_id = p_tenant_id and ap.booked_by = p.agent_user_id and ap.status = 'showed' and (p_from_at is null or ap.created_at >= p_from_at) and (p_to_at is null or ap.created_at < p_to_at)),
        'applications_started', (select count(*) from tenant_call_attempts ca where ca.tenant_id = p_tenant_id and ca.agent_id = p.agent_user_id and ca.disposition = 'application_started' and (p_from_at is null or ca.attempted_at >= p_from_at) and (p_to_at is null or ca.attempted_at < p_to_at)),
        'applications_submitted', (select count(*) from tenant_call_attempts ca where ca.tenant_id = p_tenant_id and ca.agent_id = p.agent_user_id and ca.disposition in ('application_submitted','sent_to_underwriting') and (p_from_at is null or ca.attempted_at >= p_from_at) and (p_to_at is null or ca.attempted_at < p_to_at))
      ) order by p.agent_user_id), '[]'::jsonb)
      from per_agent p
    )
  );
end;
$function$;
