-- LA-2.21-4 "CSV export without a row cap, under 2 s over 100,000 rows, with pagination."
--
-- Measured in the load-test workspace (100,000 served cards, 135,000 leads), 2026-09-29: the
-- activity page and the CSV export both hit the statement timeout (about 9 s) and answered 400.
--
-- Why, from the plan of tenant_activity_report (20260925705100):
--   · every request, page 1 included, built the WHOLE filtered set first: each served card joined
--     to its lead (135,000 heap reads with the jsonb values), its agent and its campaign, and the
--     wide result was materialised (it is read twice, for the count and the page) and sorted, all
--     to return 50 rows
--   · the export's callback lookup had no usable index (the two tenant_callbacks indexes are
--     partial on status, and the lookup has no status), so it scanned tenant_callbacks once per row
--   · the report returned only values->>'full_name' as the name, so for imported leads (first and
--     last name apart) the app then looked every name up again, 200 leads per request, one request
--     after another: 500 round trips for 100,000 rows
--
-- What changes (same signature, same keys in every row, same totals, same order):
--   · the total is counted from tenant_lead_activity alone, which an index answers
--     (tenant_lead_activity_tenant_served_idx and friends), and the page is taken in index order
--     BEFORE anything is joined, so the lead, agent and campaign are read for the page's rows only
--   · the lead-must-be-this-tenant's rule the old inner join applied is now a guard on the table
--     (tenant_lead_activity_lead_same_tenant), checked against every existing row before it is
--     relied on, so counting without the join can never count a row the page would not show
--   · lead_name follows the app's own precedence (lib/activityLog/service.ts leadName): full
--     name, else first and last name, else name. The app's fallback lookup then finds nothing to do
--   · the scorecard reads the three columns it counts instead of whole rows
--   · index tenant_callbacks (tenant_id, work_item_id, created_at desc) for the callback column
--   · appointments_booked already carries 20260929202100's rule (a rescheduled row is not a new
--     booking), with its marker, so that later in-place patch finds it done and skips
--
-- The two statements (count, page) run in one STABLE function and so see one snapshot, which is
-- what the old single statement guaranteed.

-- ── the data the new count relies on ──────────────────────────────────────────────────────────
do $pre$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709980: pre-check skipped, % cannot create in public', current_user;
    return;
  end if;
  if exists (
    select 1 from public.tenant_lead_activity a
      join public.agent_leads l on l.id = a.lead_id
     where l.tenant_id <> a.tenant_id
  ) then
    raise exception '20260925709980: a served card points at another tenant''s lead, so the count cannot drop the join. Nothing was changed.';
  end if;
end;
$pre$;

create or replace function public.tenant_lead_activity_lead_same_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
begin
  if not exists (select 1 from public.agent_leads l where l.id = new.lead_id and l.tenant_id = new.tenant_id) then
    raise exception 'ACTIVITY_LEAD_OTHER_TENANT' using errcode = '23503',
      detail = 'A served card must belong to the same tenant as its lead.';
  end if;
  return new;
end;
$function$;

revoke all on function public.tenant_lead_activity_lead_same_tenant() from public, anon, authenticated, tenant_app;

drop trigger if exists tenant_lead_activity_lead_same_tenant on public.tenant_lead_activity;
create trigger tenant_lead_activity_lead_same_tenant
before insert or update of tenant_id, lead_id on public.tenant_lead_activity
for each row execute function public.tenant_lead_activity_lead_same_tenant();

create index if not exists tenant_callbacks_work_item_created_idx
  on public.tenant_callbacks (tenant_id, work_item_id, created_at desc);

-- ── the report ───────────────────────────────────────────────────────────────────────────────
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

  -- [709980] The total, from the served cards alone. Without a flag this is an index-only count.
  if v_flag is null then
    select count(*) into v_total
      from tenant_lead_activity a
     where a.tenant_id = p_tenant_id
       and (p_agent_user_id is null or a.agent_user_id = p_agent_user_id)
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

revoke all on function public.tenant_activity_report(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer, boolean, text) from public, anon, authenticated;
grant execute on function public.tenant_activity_report(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer, boolean, text) to tenant_app, service_role;

-- ── nothing earlier was lost, and it answers the same ─────────────────────────────────────────
do $check$
declare
  v_def text;
  v_tenant uuid;
  v_owner uuid;
  v_report jsonb;
  v_export jsonb;
  v_joined bigint;
  v_t0 timestamptz;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709980: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  v_def := replace(pg_get_functiondef('public.tenant_activity_report(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer, boolean, text)'::regprocedure), E'\r\n', E'\n');
  if v_def not like '%[709980]%' then raise exception '709980 check: the report was not replaced'; end if;
  if v_def not like '%ACTIVITY_FLAG_INVALID%' or v_def not like '%ACTIVITY_FLAG_FORBIDDEN%' then raise exception '709980 check: flag guards lost'; end if;
  if v_def not like '%p_actor_role <> ''setter'' or a.agent_user_id = p_actor_user_id%' then raise exception '709980 check: setter scoping lost'; end if;
  if v_def not like '%dial_attempt_number%' or v_def not like '%on_internal_dnc%' or v_def not like '%vendor_claim_status%' or v_def not like '%deal_face_amount_cents%' then
    raise exception '709980 check: row detail lost'; end if;
  if v_def not like '%callbacks_booked%' or v_def not like '%applications_submitted%' then raise exception '709980 check: scorecard lost'; end if;
  if strpos(v_def, 'ap.booked_by = p.agent_user_id and ap.status <> ''rescheduled'' /* [202100] */') = 0 then
    raise exception '709980 check: appointments_booked lost the 202100 reschedule rule'; end if;
  if to_regprocedure('public.tenant_activity_report(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer, boolean)') is not null then
    raise exception '709980 check: the old signature is back; PostgREST would find two'; end if;
  if not has_function_privilege('service_role', 'public.tenant_activity_report(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer, boolean, text)', 'execute') then
    raise exception '709980 check: service_role cannot execute the report'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'tenant_lead_activity_lead_same_tenant' and not tgisinternal) then
    raise exception '709980 check: the same-tenant guard is not attached'; end if;

  -- The same total the old inner join gave, and a page and an export that agree with it. On the
  -- busiest tenant under 20,000 cards so this check stays quick.
  select a.tenant_id into v_tenant
    from public.tenant_lead_activity a
   group by a.tenant_id
  having count(*) < 20000
   order by count(*) desc
   limit 1;
  if v_tenant is null then
    raise notice '709980 self-test skipped: no tenant has a served card';
    return;
  end if;
  select tu.user_id into v_owner from public.tenant_users tu where tu.tenant_id = v_tenant and tu.role::text = 'owner' limit 1;

  select count(*) into v_joined
    from public.tenant_lead_activity a
    join public.agent_leads l on l.id = a.lead_id and l.tenant_id = a.tenant_id
   where a.tenant_id = v_tenant;

  v_t0 := clock_timestamp();
  v_report := public.tenant_activity_report(v_tenant, v_owner, 'owner');
  raise notice '709980 self-test: page 1 in % ms', round(extract(epoch from clock_timestamp() - v_t0) * 1000);
  if (v_report->>'total')::bigint <> v_joined then
    raise exception '709980 check: total % differs from the joined count %', v_report->>'total', v_joined; end if;
  if jsonb_array_length(v_report->'rows') <> least(v_joined, 50) then
    raise exception '709980 check: page 1 has % rows, expected %', jsonb_array_length(v_report->'rows'), least(v_joined, 50); end if;
  if v_joined > 0 and not ((v_report->'rows'->0) ?& array['agent_name', 'campaign_name', 'lead_name', 'lead_state', 'open_to_log_seconds', 'integrity_flags', 'dial_attempt_number', 'callback_at', 'on_internal_dnc', 'vendor_claim_status', 'served_at', 'lead_id']) then
    raise exception '709980 check: a row lost a key: %', v_report->'rows'->0; end if;
  if (v_report->'rows'->0) ? 'lead_phone' then raise exception '709980 check: the phone leaked into a row'; end if;
  -- Each scorecard row's appointments_booked is the 202100 count: booked by that agent, not rescheduled.
  if exists (
    select 1 from jsonb_array_elements(v_report->'scorecard') sc
     where (sc->>'appointments_booked')::bigint <> (
       select count(*) from public.tenant_appointments ap
        where ap.tenant_id = v_tenant and ap.booked_by = (sc->>'agent_user_id')::uuid and ap.status <> 'rescheduled')
  ) then raise exception '709980 check: appointments_booked differs from the 202100 rule'; end if;

  v_t0 := clock_timestamp();
  v_export := public.tenant_activity_report(v_tenant, v_owner, 'owner', null, null, null, null, null, 1, 50, true);
  raise notice '709980 self-test: export of % rows in % ms', jsonb_array_length(v_export->'rows'), round(extract(epoch from clock_timestamp() - v_t0) * 1000);
  if jsonb_array_length(v_export->'rows') <> v_joined then
    raise exception '709980 check: the export has % rows, expected %', jsonb_array_length(v_export->'rows'), v_joined; end if;

  v_report := public.tenant_activity_report(v_tenant, v_owner, 'owner', null, null, null, null, null, 1, 50, false, 'any');
  if (v_report->>'total')::bigint <> (
    select count(*) from public.tenant_lead_activity a
     where a.tenant_id = v_tenant
       and ((a.disposition is not null and a.clicked_at is null) or a.disposition is null
            or (a.disposition is not null and coalesce(a.card_open_seconds, floor(extract(epoch from (a.dispositioned_at - a.served_at)))::integer) < 5))
  ) then raise exception '709980 check: the flagged total is wrong'; end if;
end;
$check$;
