-- Activity · what each row of the call log can now say, and a filter by integrity flag.
--
-- Restated from the LATEST definition of tenant_activity_report (20260915170000, which replaced
-- 20260913460000). Everything it returned it still returns, in the same shape. Added:
--
--   p_flag       narrows the rows (and `total`) to one integrity flag, or 'any' for every flagged
--                row — the page's Data integrity view and its "Logged without a dial" filter, paged
--                in SQL instead of by reading the whole window into the app. The scorecard is NOT
--                narrowed by it: it describes the population the flag is found in.
--                A setter may not filter by 'zero_click_disposition' (the user's decision: the
--                zero-click review is for owners and producers).
--
--   per row      lead_state · dial_attempt_number (the dialer's attempt_number of the linked call,
--                20260925705000) · open_to_log_seconds (served → outcome) · callback_at +
--                callback_timezone (the callback booked on this card's work item after it was
--                served) · deal_face_amount_cents + deal_product (the deal record written for this
--                lead after it was served) · on_internal_dnc (the number is on the tenant's own
--                do-not-call list) · vendor_claim_status (the lead is an item on a vendor claim).
--                Detail is read for the rows returned only, never for the whole window.
--
--   scorecard    zero_click per agent (outcomes on a card with no Dial press), for the page's
--                "logged with no dial" figure and its per-agent concentration line.
--
-- `impossibly_fast_disposition` now also fires on the served → outcome time when the card's own
-- open time was never recorded (nothing records card_open_seconds today). The flag's meaning —
-- "an outcome under five seconds after the card" — is unchanged; it had simply stopped being able
-- to fire.
--
-- Adding a parameter changes the signature, so the function is dropped and re-created with the
-- same grants. The app calls it with named arguments and only passes p_flag when a flag is asked
-- for, falling back to the old call (and filtering itself) until this is applied.

drop function if exists public.tenant_activity_report(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer, boolean);

create or replace function public.tenant_activity_report(
  p_tenant_id uuid, p_actor_user_id uuid, p_actor_role text,
  p_agent_user_id uuid default null, p_campaign_id uuid default null, p_disposition text default null,
  p_from_at timestamptz default null, p_to_at timestamptz default null,
  p_page integer default 1, p_page_size integer default 50, p_export boolean default false,
  p_flag text default null
)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare
  v_rows jsonb;
  v_total bigint;
  v_size integer := least(greatest(coalesce(p_page_size, 50), 1), 500);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_flag text := nullif(btrim(coalesce(p_flag, '')), '');
begin
  if p_actor_role = 'setter' then p_agent_user_id := p_actor_user_id; end if;
  if v_flag is not null and v_flag not in ('any', 'zero_click_disposition', 'served_never_dispositioned', 'impossibly_fast_disposition') then
    raise exception 'ACTIVITY_FLAG_INVALID';
  end if;
  if v_flag = 'zero_click_disposition' and p_actor_role not in ('owner', 'producer') then
    raise exception 'ACTIVITY_FLAG_FORBIDDEN';
  end if;

  -- One statement: the count is over the filtered set, the detail over the returned page only.
  with flagged as (
    select a.*, coalesce(u.name, 'Unknown agent') as agent_name, c.name as campaign_name,
      l.values->>'full_name' as lead_name,
      left(coalesce(
        nullif(btrim(l.values->>'state'), ''),
        nullif(btrim(l.values->>'state_code'), ''),
        nullif(btrim(l.values->>'primary_state'), '')
      ), 40) as lead_state,
      l.values->>'phone' as lead_phone,
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
  ), filtered as (
    select f.* from flagged f
     where v_flag is null
        or (v_flag = 'any' and cardinality(f.integrity_flags) > 0)
        or v_flag = any(f.integrity_flags)
  ), page_rows as (
    select * from filtered
     order by served_at desc, id desc
     limit case when p_export then null else v_size end
     offset case when p_export then 0 else (v_page - 1) * v_size end
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
  select (select count(*) from filtered),
         (select coalesce(jsonb_agg(to_jsonb(d) - 'lead_phone' order by d.served_at desc, d.id desc), '[]'::jsonb) from detailed d)
    into v_total, v_rows;

  return jsonb_build_object(
    'rows', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_size, 'export', p_export, 'flag', v_flag,
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

revoke all on function public.tenant_activity_report(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer, boolean, text) from public, anon, authenticated;
grant execute on function public.tenant_activity_report(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer, boolean, text) to tenant_app, service_role;

do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925705100: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if to_regprocedure('public.tenant_activity_report(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer, boolean, text)') is null then
    raise exception 'tenant_activity_report with p_flag is missing';
  end if;
  if to_regprocedure('public.tenant_activity_report(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer, boolean)') is not null then
    raise exception 'the old tenant_activity_report signature is still there; PostgREST would find two';
  end if;
  if not has_function_privilege('service_role', 'public.tenant_activity_report(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer, boolean, text)', 'execute') then
    raise exception 'service_role cannot execute tenant_activity_report';
  end if;
end $$;
