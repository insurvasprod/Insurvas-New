-- Agency Module 0 · AG-0.5 performance follow-up (2026-10-19) · the activity log pages a scope in SQL.
--
-- tenant_activity_report and tenant_recycle_performance take ONE agent (p_agent_user_id). For a narrowed agency
-- session with several agents in scope (a manager, an assistant or setter to several producers),
-- lib/activityLog/service.ts read each agent's rows whole (export mode), merged them and paged, totalled and
-- summed the recycle counts in code: at 150 producers, 300 RPCs and every card they were ever served.
--
-- Both functions gain p_agent_user_ids uuid[] (last, default null), ANDed with every agent filter in the body:
--   · null (the default) = every agent — the live body with one extra `p_agent_user_ids is null or …` arm per
--     filter, and the app never sends the argument for a null scope, so solo tenants and the all-seeing roles
--     run exactly today's call;
--   · an array = only cards served to an agent in it (tenant_lead_activity.agent_user_id, decision D1). The
--     total, page, scorecard (one line per agent) and recycle counts are all over those cards.
-- A setter stays pinned to itself in SQL whatever the list says, as before. Scope always comes from
-- scopeFor(session) in the app, never from a request parameter.
--
-- The old signatures are DROPPED, not overloaded (PGRST203 on ambiguous candidates). lib/nurture/report.ts and
-- the activity service call with old argument names only, so they keep working against the new functions.
--
-- Bodies: the live pg_get_functiondef of each (read 2026-10-19), changed only at the [AG scoped] lines and the
-- added `p_agent_user_ids` filter after each `p_agent_user_id` filter. Grants as live: service_role, tenant_app.
--
-- Rollback: drop the two uuid[] signatures and re-run the definitions from 20260925709980 / 20260925705100.

begin;

drop function if exists public.tenant_activity_report(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer, boolean, text);
drop function if exists public.tenant_recycle_performance(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.tenant_activity_report(p_tenant_id uuid, p_actor_user_id uuid, p_actor_role text, p_agent_user_id uuid DEFAULT NULL::uuid, p_campaign_id uuid DEFAULT NULL::uuid, p_disposition text DEFAULT NULL::text, p_from_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50, p_export boolean DEFAULT false, p_flag text DEFAULT NULL::text, p_agent_user_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rows jsonb;
  v_total bigint;
  v_size integer := least(greatest(coalesce(p_page_size, 50), 1), 500);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_flag text := nullif(btrim(coalesce(p_flag, '')), '');
begin
  if p_actor_role = 'setter' then p_agent_user_id := p_actor_user_id; end if;
  -- [AG scoped] p_agent_user_ids: a narrowed session's agents (scopeFor), ANDed with every filter above and below;
  -- null = every agent, as before. A setter stays pinned to itself whatever the list says.
  if v_flag is not null and v_flag not in ('any', 'zero_click_disposition', 'served_never_dispositioned', 'impossibly_fast_disposition') then
    raise exception 'ACTIVITY_FLAG_INVALID';
  end if;
  if v_flag = 'zero_click_disposition' and p_actor_role not in ('owner', 'producer') then
    raise exception 'ACTIVITY_FLAG_FORBIDDEN';
  end if;

  -- [709980] The total, from the served cards alone. Without a flag this is an index-only count.
  if v_flag is null then
    select count(*) into v_total
      from tenant_lead_activity a
     where a.tenant_id = p_tenant_id
       and (p_agent_user_id is null or a.agent_user_id = p_agent_user_id)
       and (p_agent_user_ids is null or a.agent_user_id = any(p_agent_user_ids))
       and (p_campaign_id is null or a.campaign_id = p_campaign_id)
       and (p_disposition is null or a.disposition = p_disposition)
       and (p_from_at is null or a.served_at >= p_from_at)
       and (p_to_at is null or a.served_at < p_to_at)
       and (p_actor_role <> 'setter' or a.agent_user_id = p_actor_user_id);
  else
    select count(*) into v_total
      from (
        select array_remove(array[
                 case when a.disposition is not null and a.clicked_at is null then 'zero_click_disposition' end,
                 case when a.disposition is null then 'served_never_dispositioned' end,
                 case when a.disposition is not null
                       and coalesce(a.card_open_seconds, floor(extract(epoch from (a.dispositioned_at - a.served_at)))::integer) < 5
                      then 'impossibly_fast_disposition' end
               ], null) as integrity_flags
          from tenant_lead_activity a
         where a.tenant_id = p_tenant_id
           and (p_agent_user_id is null or a.agent_user_id = p_agent_user_id)
           and (p_agent_user_ids is null or a.agent_user_id = any(p_agent_user_ids))
           and (p_campaign_id is null or a.campaign_id = p_campaign_id)
           and (p_disposition is null or a.disposition = p_disposition)
           and (p_from_at is null or a.served_at >= p_from_at)
           and (p_to_at is null or a.served_at < p_to_at)
           and (p_actor_role <> 'setter' or a.agent_user_id = p_actor_user_id)
      ) f
     where (v_flag = 'any' and cardinality(f.integrity_flags) > 0)
        or v_flag = any(f.integrity_flags);
  end if;

  -- [709980] The page, in index order, before anything is joined. The export is every row.
  with flagged as (
    select a.*,
      case when a.dispositioned_at is not null
        then greatest(0, floor(extract(epoch from (a.dispositioned_at - a.served_at))))::integer end as open_to_log_seconds,
      array_remove(array[
        case when a.disposition is not null and a.clicked_at is null then 'zero_click_disposition' end,
        case when a.disposition is null then 'served_never_dispositioned' end,
        case when a.disposition is not null
              and coalesce(a.card_open_seconds, floor(extract(epoch from (a.dispositioned_at - a.served_at)))::integer) < 5
             then 'impossibly_fast_disposition' end
      ], null) as integrity_flags
    from tenant_lead_activity a
    where a.tenant_id = p_tenant_id
      and (p_agent_user_id is null or a.agent_user_id = p_agent_user_id)
      and (p_agent_user_ids is null or a.agent_user_id = any(p_agent_user_ids))
      and (p_campaign_id is null or a.campaign_id = p_campaign_id)
      and (p_disposition is null or a.disposition = p_disposition)
      and (p_from_at is null or a.served_at >= p_from_at)
      and (p_to_at is null or a.served_at < p_to_at)
      and (p_actor_role <> 'setter' or a.agent_user_id = p_actor_user_id)
  ), page_cards as (
    select f.* from flagged f
     where v_flag is null
        or (v_flag = 'any' and cardinality(f.integrity_flags) > 0)
        or v_flag = any(f.integrity_flags)
     order by f.served_at desc, f.id desc
     limit case when p_export then null else v_size end
     offset case when p_export then 0 else (v_page - 1) * v_size end
  ), page_rows as (
    select f.*, coalesce(u.name, 'Unknown agent') as agent_name, c.name as campaign_name,
      -- [709980] lib/activityLog/service.ts leadName: full name, else first and last, else name
      coalesce(
        nullif(l.values->>'full_name', ''),
        nullif(concat_ws(' ',
          nullif(case when jsonb_typeof(l.values->'first_name') = 'string' then btrim(l.values->>'first_name', E' \t\r\n') end, ''),
          nullif(case when jsonb_typeof(l.values->'last_name') = 'string' then btrim(l.values->>'last_name', E' \t\r\n') end, '')), ''),
        nullif(case when jsonb_typeof(l.values->'name') = 'string' then btrim(l.values->>'name', E' \t\r\n') end, '')
      ) as lead_name,
      left(coalesce(
        nullif(btrim(l.values->>'state'), ''),
        nullif(btrim(l.values->>'state_code'), ''),
        nullif(btrim(l.values->>'primary_state'), '')
      ), 40) as lead_state,
      l.values->>'phone' as lead_phone
    from page_cards f
    left join users u on u.id = f.agent_user_id
    left join tenant_campaigns c on c.id = f.campaign_id
    join agent_leads l on l.id = f.lead_id and l.tenant_id = f.tenant_id
  ), detailed as (
    select p.*,
      ca.attempt_number as dial_attempt_number,
      cb.scheduled_at_utc as callback_at,
      cb.customer_timezone as callback_timezone,
      df.face_amount_cents as deal_face_amount_cents,
      df.product_type as deal_product,
      (p.disposition is not null and exists (
        select 1 from tenant_do_not_call dnc
         where dnc.tenant_id = p.tenant_id and dnc.is_active
           and dnc.phone_digits = right(regexp_replace(coalesce(p.lead_phone, ''), '[^0-9]', '', 'g'), 10)
           and regexp_replace(coalesce(p.lead_phone, ''), '[^0-9]', '', 'g') ~ '^1?[0-9]{10}$'
      )) as on_internal_dnc,
      vc.status as vendor_claim_status
    from page_rows p
    left join tenant_call_attempts ca on ca.id = p.call_attempt_id and ca.tenant_id = p.tenant_id
    left join lateral (
      select cb0.scheduled_at_utc, cb0.customer_timezone
        from tenant_callbacks cb0
       where p.disposition is not null and p.work_item_id is not null
         and cb0.tenant_id = p.tenant_id and cb0.work_item_id = p.work_item_id and cb0.lead_id = p.lead_id
         and cb0.created_at >= p.served_at
         and cb0.created_at <= coalesce(p.dispositioned_at, p.served_at) + interval '5 minutes'
       order by cb0.created_at desc limit 1
    ) cb on true
    left join lateral (
      select d.face_amount_cents, d.product_type
        from deal_flow d
       where p.disposition is not null
         and d.tenant_id = p.tenant_id and d.lead_id = p.lead_id
         and d.created_at >= p.served_at
         and d.created_at <= coalesce(p.dispositioned_at, p.served_at) + interval '1 hour'
       order by d.created_at desc limit 1
    ) df on true
    left join lateral (
      select lc.status
        from lead_claim_items li join lead_claims lc on lc.id = li.claim_id
       where p.disposition is not null
         and li.tenant_id = p.tenant_id and li.lead_id = p.lead_id
       order by li.created_at desc limit 1
    ) vc on true
  )
  select coalesce(jsonb_agg(to_jsonb(d) - 'lead_phone' order by d.served_at desc, d.id desc), '[]'::jsonb)
    into v_rows
    from detailed d;

  return jsonb_build_object(
    'rows', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_size, 'export', p_export, 'flag', v_flag,
    'scorecard', (
      with visible as (
        -- [709980] the three columns the scorecard counts, not whole rows
        select a.agent_user_id, a.clicked_at, a.disposition from tenant_lead_activity a
        where a.tenant_id = p_tenant_id
          and (p_agent_user_id is null or a.agent_user_id = p_agent_user_id)
          and (p_agent_user_ids is null or a.agent_user_id = any(p_agent_user_ids))
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
          count(*) filter (where v.disposition is not null and v.clicked_at is null)::integer as zero_click,
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
        'zero_click', p.zero_click,
        'contact_rate_percent', case when p.clicked > 0 then round(100.0 * p.contacts / p.clicked, 1) end,
        'disposition_breakdown', (
          select coalesce(jsonb_object_agg(coalesce(d.disposition, 'unlogged'), d.n), '{}'::jsonb)
          from (select v2.disposition, count(*) n from visible v2 where v2.agent_user_id = p.agent_user_id group by v2.disposition) d
        ),
        'callbacks_booked', (select count(*) from tenant_callbacks cb where cb.tenant_id = p_tenant_id and cb.assigned_to = p.agent_user_id and (p_from_at is null or cb.created_at >= p_from_at) and (p_to_at is null or cb.created_at < p_to_at)),
        'callbacks_kept', (select count(*) from tenant_callbacks cb where cb.tenant_id = p_tenant_id and cb.assigned_to = p.agent_user_id and cb.status = 'completed' and (p_from_at is null or cb.created_at >= p_from_at) and (p_to_at is null or cb.created_at < p_to_at)),
        'appointments_booked', (select count(*) from tenant_appointments ap where ap.tenant_id = p_tenant_id and ap.booked_by = p.agent_user_id and ap.status <> 'rescheduled' /* [202100] */ and (p_from_at is null or ap.created_at >= p_from_at) and (p_to_at is null or ap.created_at < p_to_at)),
        'appointments_showed', (select count(*) from tenant_appointments ap where ap.tenant_id = p_tenant_id and ap.booked_by = p.agent_user_id and ap.status = 'showed' and (p_from_at is null or ap.created_at >= p_from_at) and (p_to_at is null or ap.created_at < p_to_at)),
        'applications_started', (select count(*) from tenant_call_attempts ca where ca.tenant_id = p_tenant_id and ca.agent_id = p.agent_user_id and ca.disposition = 'application_started' and (p_from_at is null or ca.attempted_at >= p_from_at) and (p_to_at is null or ca.attempted_at < p_to_at)),
        'applications_submitted', (select count(*) from tenant_call_attempts ca where ca.tenant_id = p_tenant_id and ca.agent_id = p.agent_user_id and ca.disposition in ('application_submitted','sent_to_underwriting') and (p_from_at is null or ca.attempted_at >= p_from_at) and (p_to_at is null or ca.attempted_at < p_to_at))
      ) order by p.agent_user_id), '[]'::jsonb)
      from per_agent p
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.tenant_recycle_performance(p_tenant_id uuid, p_actor_user_id uuid, p_actor_role text, p_agent_user_id uuid DEFAULT NULL::uuid, p_campaign_id uuid DEFAULT NULL::uuid, p_disposition text DEFAULT NULL::text, p_from_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_agent_user_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with labeled as (
  select a.*,
    case when exists (
      select 1 from tenant_nurture_reactivations nr
      where nr.tenant_id = a.tenant_id and nr.lead_id = a.lead_id
        and nr.campaign_id = a.campaign_id and nr.status = 'cleared'
        and nr.completed_at is not null and nr.completed_at <= a.served_at
    ) then 'recycled' else 'fresh' end as source_type
  from tenant_lead_activity a
  where a.tenant_id = p_tenant_id
    and (p_agent_user_id is null or a.agent_user_id = p_agent_user_id)
    and (p_agent_user_ids is null or a.agent_user_id = any(p_agent_user_ids))
    and (p_campaign_id is null or a.campaign_id = p_campaign_id)
    and (p_disposition is null or a.disposition = p_disposition)
    and (p_from_at is null or a.served_at >= p_from_at)
    and (p_to_at is null or a.served_at < p_to_at)
    and (p_actor_role <> 'setter' or a.agent_user_id = p_actor_user_id)
), grouped as (
  select source_type, count(*)::integer as served, count(clicked_at)::integer as clicked,
    count(*) filter (where disposition is not null and disposition not in ('no_answer','voicemail','busy','call_dropped','wrong_number','disconnected'))::integer as contacts
  from labeled group by source_type
)
select coalesce(jsonb_agg(jsonb_build_object('source_type', source_type, 'served', served, 'clicked', clicked,
  'contacts', contacts, 'contact_rate_percent', case when clicked > 0 then round(100.0 * contacts / clicked, 1) end)
  order by source_type), '[]'::jsonb) from grouped;
$function$;

revoke all on function public.tenant_activity_report(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer, boolean, text, uuid[]) from public, anon, authenticated;
grant execute on function public.tenant_activity_report(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer, boolean, text, uuid[]) to service_role, tenant_app;
revoke all on function public.tenant_recycle_performance(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz, uuid[]) from public, anon, authenticated;
grant execute on function public.tenant_recycle_performance(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz, uuid[]) to service_role, tenant_app;

-- ─── self-check ───────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_name text;
  v_want int;
begin
  foreach v_name in array array['tenant_activity_report', 'tenant_recycle_performance'] loop
    v_want := case v_name when 'tenant_activity_report' then 4 else 1 end;
    if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = v_name) <> 1 then
      raise exception 'AG scoped: % must have exactly one signature (PostgREST cannot choose between overloads)', v_name;
    end if;
    if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = v_name
                    and 'p_agent_user_ids' = any (proargnames) and prosecdef) then
      raise exception 'AG scoped: % lacks p_agent_user_ids or is no longer security definer', v_name;
    end if;
    -- every agent filter carries the list filter beside it
    if (select (length(prosrc) - length(replace(prosrc, 'p_agent_user_ids is null or a.agent_user_id = any(p_agent_user_ids)', ''))) / length('p_agent_user_ids is null or a.agent_user_id = any(p_agent_user_ids)')
          from pg_proc where pronamespace = 'public'::regnamespace and proname = v_name) <> v_want
       or (select (length(prosrc) - length(replace(prosrc, 'p_agent_user_id is null or a.agent_user_id = p_agent_user_id', ''))) / length('p_agent_user_id is null or a.agent_user_id = p_agent_user_id')
          from pg_proc where pronamespace = 'public'::regnamespace and proname = v_name) <> v_want then
      raise exception 'AG scoped: % must filter by p_agent_user_ids at each of its % agent filters', v_name, v_want;
    end if;
  end loop;
end;
$$;

commit;

notify pgrst, 'reload schema';
