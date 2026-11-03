-- LA-2.21 · served/clicked/logged activity evidence and agent scorecard.
--
-- `card_open_seconds` is deliberately named: it is browser-card visibility, never talk time.

create table if not exists public.tenant_lead_activity (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  work_item_id uuid references public.lead_queue(id) on delete set null,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  campaign_id uuid references public.tenant_campaigns(id) on delete set null,
  agent_user_id uuid references public.users(id) on delete set null,
  served_at timestamptz not null default now(),
  clicked_at timestamptz,
  dispositioned_at timestamptz,
  disposition text,
  card_open_seconds integer check (card_open_seconds is null or card_open_seconds between 0 and 86400),
  notes text check (notes is null or char_length(notes) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tenant_lead_activity_tenant_served_idx
  on public.tenant_lead_activity (tenant_id, served_at desc, id desc);
create index if not exists tenant_lead_activity_agent_served_idx
  on public.tenant_lead_activity (tenant_id, agent_user_id, served_at desc);
create index if not exists tenant_lead_activity_campaign_served_idx
  on public.tenant_lead_activity (tenant_id, campaign_id, served_at desc);
create index if not exists tenant_lead_activity_disposition_idx
  on public.tenant_lead_activity (tenant_id, disposition, served_at desc);

create or replace function public.touch_lead_activity_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $function$
begin new.updated_at := now(); return new; end;
$function$;
drop trigger if exists tenant_lead_activity_touch_updated_at on public.tenant_lead_activity;
create trigger tenant_lead_activity_touch_updated_at before update on public.tenant_lead_activity
for each row execute function public.touch_lead_activity_updated_at();

-- Every queue claim is a served event, including future serving implementations. The trigger keeps
-- the evidence at the state transition, not in a browser callback that can be lost.
create or replace function public.record_lead_served_activity()
returns trigger language plpgsql security definer set search_path = public as $function$
declare v_campaign uuid;
begin
  if new.status = 'claimed' and (old.status is distinct from 'claimed') and new.claimed_by is not null then
    select campaign_id into v_campaign from agent_leads where id = new.lead_id and tenant_id = new.tenant_id;
    insert into tenant_lead_activity (tenant_id, work_item_id, lead_id, campaign_id, agent_user_id, served_at)
    values (new.tenant_id, new.id, new.lead_id, v_campaign, new.claimed_by, coalesce(new.claimed_at, now()));
  end if;
  return new;
end;
$function$;
drop trigger if exists lead_queue_record_served_activity on public.lead_queue;
create trigger lead_queue_record_served_activity after update on public.lead_queue
for each row execute function public.record_lead_served_activity();

-- The existing dial transaction writes the attempt after it knows the slot and disposition. This
-- trigger connects that durable event to the most recent served card without replacing old history.
create or replace function public.record_lead_attempt_activity()
returns trigger language plpgsql security definer set search_path = public as $function$
begin
  update tenant_lead_activity
     set clicked_at = coalesce(clicked_at, new.dial_clicked_at),
         dispositioned_at = coalesce(dispositioned_at, case when new.disposition is not null then new.attempted_at end),
         disposition = coalesce(disposition, new.disposition),
         updated_at = now()
   where id = (select a.id from tenant_lead_activity a
                where a.tenant_id = new.tenant_id and a.lead_id = new.lead_id
                  and (a.agent_user_id = new.agent_id or new.agent_id is null)
                  and a.disposition is null
                  and a.served_at <= new.attempted_at
                order by a.served_at desc limit 1);
  return new;
end;
$function$;
drop trigger if exists tenant_call_attempt_record_activity on public.tenant_call_attempts;
create trigger tenant_call_attempt_record_activity after insert on public.tenant_call_attempts
for each row execute function public.record_lead_attempt_activity();

create or replace function public.mark_lead_activity_click(
  p_tenant_id uuid, p_activity_id uuid, p_actor uuid, p_clicked_at timestamptz default now()
)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare v_row tenant_lead_activity%rowtype;
begin
  update tenant_lead_activity set clicked_at = coalesce(clicked_at, p_clicked_at), updated_at = now()
   where id = p_activity_id and tenant_id = p_tenant_id and agent_user_id = p_actor
  returning * into v_row;
  if not found then raise exception 'ACTIVITY_NOT_FOUND'; end if;
  return to_jsonb(v_row);
end;
$function$;

create or replace function public.mark_lead_activity_disposition(
  p_tenant_id uuid, p_activity_id uuid, p_actor uuid, p_disposition text,
  p_card_open_seconds integer default null, p_notes text default null, p_dispositioned_at timestamptz default now()
)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare v_row tenant_lead_activity%rowtype;
begin
  if p_disposition is null or char_length(btrim(p_disposition)) = 0 or char_length(p_disposition) > 120 then raise exception 'ACTIVITY_DISPOSITION_INVALID'; end if;
  if p_card_open_seconds is not null and (p_card_open_seconds < 0 or p_card_open_seconds > 86400) then raise exception 'CARD_OPEN_SECONDS_INVALID'; end if;
  update tenant_lead_activity set clicked_at = clicked_at, disposition = p_disposition,
    dispositioned_at = coalesce(dispositioned_at, p_dispositioned_at), card_open_seconds = p_card_open_seconds,
    notes = left(nullif(btrim(p_notes), ''), 5000), updated_at = now()
   where id = p_activity_id and tenant_id = p_tenant_id and agent_user_id = p_actor
  returning * into v_row;
  if not found then raise exception 'ACTIVITY_NOT_FOUND'; end if;
  return to_jsonb(v_row);
end;
$function$;

-- Narrow, indexed reads for the activity page. Export mode intentionally omits LIMIT/OFFSET: the
-- browser receives the same tenant/role-filtered rows and can create a complete CSV.
create or replace function public.tenant_activity_report(
  p_tenant_id uuid, p_actor_user_id uuid, p_actor_role text,
  p_agent_user_id uuid default null, p_campaign_id uuid default null, p_disposition text default null,
  p_from_at timestamptz default null, p_to_at timestamptz default null,
  p_page integer default 1, p_page_size integer default 50, p_export boolean default false
)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare v_rows jsonb; v_total bigint; v_size integer := least(greatest(coalesce(p_page_size, 50), 1), 500); v_page integer := greatest(coalesce(p_page, 1), 1);
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
      select a.*, coalesce(u.name, 'Unknown agent') as agent_name, c.name as campaign_name, l.values->>'full_name' as lead_name,
        array_remove(array[case when a.disposition is not null and a.clicked_at is null then 'zero_click_disposition' end,
          case when a.disposition is null then 'served_never_dispositioned' end,
          case when a.disposition is not null and a.card_open_seconds is not null and a.card_open_seconds < 5 then 'impossibly_fast_disposition' end], null) as integrity_flags
      from tenant_lead_activity a left join users u on u.id = a.agent_user_id left join tenant_campaigns c on c.id = a.campaign_id
      join agent_leads l on l.id = a.lead_id and l.tenant_id = a.tenant_id
      where a.tenant_id = p_tenant_id and (p_agent_user_id is null or a.agent_user_id = p_agent_user_id)
        and (p_campaign_id is null or a.campaign_id = p_campaign_id) and (p_disposition is null or a.disposition = p_disposition)
        and (p_from_at is null or a.served_at >= p_from_at) and (p_to_at is null or a.served_at < p_to_at)
        and (p_actor_role <> 'setter' or a.agent_user_id = p_actor_user_id)
    ) select coalesce(jsonb_agg(to_jsonb(filtered) order by served_at desc, id desc), '[]'::jsonb) into v_rows from filtered;
  else
    with filtered as (
      select a.*, coalesce(u.name, 'Unknown agent') as agent_name, c.name as campaign_name, l.values->>'full_name' as lead_name,
        array_remove(array[case when a.disposition is not null and a.clicked_at is null then 'zero_click_disposition' end,
          case when a.disposition is null then 'served_never_dispositioned' end,
          case when a.disposition is not null and a.card_open_seconds is not null and a.card_open_seconds < 5 then 'impossibly_fast_disposition' end], null) as integrity_flags
      from tenant_lead_activity a left join users u on u.id = a.agent_user_id left join tenant_campaigns c on c.id = a.campaign_id
      join agent_leads l on l.id = a.lead_id and l.tenant_id = a.tenant_id
      where a.tenant_id = p_tenant_id and (p_agent_user_id is null or a.agent_user_id = p_agent_user_id)
        and (p_campaign_id is null or a.campaign_id = p_campaign_id) and (p_disposition is null or a.disposition = p_disposition)
        and (p_from_at is null or a.served_at >= p_from_at) and (p_to_at is null or a.served_at < p_to_at)
        and (p_actor_role <> 'setter' or a.agent_user_id = p_actor_user_id)
    ) select coalesce(jsonb_agg(to_jsonb(filtered) order by served_at desc, id desc), '[]'::jsonb) into v_rows
      from (select * from filtered order by served_at desc, id desc limit v_size offset (v_page - 1) * v_size) filtered;
  end if;

  -- Scorecard counts are derived from the same visible population. Appointment and application
  -- evidence is joined by the measured agent, so booked/showed/submitted cannot be self-reported.
  return jsonb_build_object('rows', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_size, 'export', p_export,
    'scorecard', (with visible as (select * from tenant_lead_activity a where a.tenant_id = p_tenant_id
      and (p_agent_user_id is null or a.agent_user_id = p_agent_user_id) and (p_campaign_id is null or a.campaign_id = p_campaign_id)
      and (p_disposition is null or a.disposition = p_disposition) and (p_from_at is null or a.served_at >= p_from_at)
      and (p_to_at is null or a.served_at < p_to_at) and (p_actor_role <> 'setter' or a.agent_user_id = p_actor_user_id))
    select coalesce(jsonb_agg(jsonb_build_object('agent_user_id', v.agent_user_id,
      'agent_name', (select coalesce(u.name, 'Unknown agent') from users u where u.id = v.agent_user_id), 'served', count(*),
      'clicked', count(*) filter (where v.clicked_at is not null), 'logged', count(*) filter (where v.disposition is not null),
      'contact_rate_percent', case when count(*) filter (where v.clicked_at is not null) > 0 then round(100.0 * count(*) filter (where v.disposition is not null and v.disposition not in ('no_answer','voicemail','busy','call_dropped','wrong_number','disconnected')) / (count(*) filter (where v.clicked_at is not null)), 1) end,
      'disposition_breakdown', (select coalesce(jsonb_object_agg(coalesce(d.disposition, 'unlogged'), d.n), '{}'::jsonb) from (select v2.disposition, count(*) n from visible v2 where v2.agent_user_id = v.agent_user_id group by v2.disposition) d),
      'callbacks_booked', (select count(*) from tenant_callbacks cb where cb.tenant_id = p_tenant_id and cb.assigned_to = v.agent_user_id and (p_from_at is null or cb.created_at >= p_from_at) and (p_to_at is null or cb.created_at < p_to_at)),
      'callbacks_kept', (select count(*) from tenant_callbacks cb where cb.tenant_id = p_tenant_id and cb.assigned_to = v.agent_user_id and cb.status = 'completed' and (p_from_at is null or cb.created_at >= p_from_at) and (p_to_at is null or cb.created_at < p_to_at)),
      'appointments_booked', (select count(*) from tenant_appointments ap where ap.tenant_id = p_tenant_id and ap.booked_by = v.agent_user_id and (p_from_at is null or ap.created_at >= p_from_at) and (p_to_at is null or ap.created_at < p_to_at)),
      'appointments_showed', (select count(*) from tenant_appointments ap where ap.tenant_id = p_tenant_id and ap.booked_by = v.agent_user_id and ap.status = 'showed' and (p_from_at is null or ap.created_at >= p_from_at) and (p_to_at is null or ap.created_at < p_to_at)),
      'applications_started', (select count(*) from tenant_call_attempts ca where ca.tenant_id = p_tenant_id and ca.agent_id = v.agent_user_id and ca.disposition = 'application_started' and (p_from_at is null or ca.attempted_at >= p_from_at) and (p_to_at is null or ca.attempted_at < p_to_at)),
      'applications_submitted', (select count(*) from tenant_call_attempts ca where ca.tenant_id = p_tenant_id and ca.agent_id = v.agent_user_id and ca.disposition in ('application_submitted','sent_to_underwriting') and (p_from_at is null or ca.attempted_at >= p_from_at) and (p_to_at is null or ca.attempted_at < p_to_at))
    ) order by v.agent_user_id), '[]'::jsonb) from visible v group by v.agent_user_id));
end;
$function$;

-- Fresh and recycled performance stays separate so nurture can be measured without making
-- reactivated contacts look like new acquisition. The same tenant/role/filter boundary applies.
create or replace function public.tenant_recycle_performance(
  p_tenant_id uuid, p_actor_user_id uuid, p_actor_role text,
  p_agent_user_id uuid default null, p_campaign_id uuid default null,
  p_disposition text default null, p_from_at timestamptz default null, p_to_at timestamptz default null
)
returns jsonb language sql stable security definer set search_path = public as $function$
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

alter table public.tenant_lead_activity enable row level security;
create policy tenant_lead_activity_scoped on public.tenant_lead_activity for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.tenant_lead_activity from anon, authenticated, public;
grant select, insert, update on public.tenant_lead_activity to tenant_app;
grant select, insert, update on public.tenant_lead_activity to service_role;
revoke all on function public.mark_lead_activity_click(uuid, uuid, uuid, timestamptz) from public, anon, authenticated, tenant_app;
grant execute on function public.mark_lead_activity_click(uuid, uuid, uuid, timestamptz) to service_role;
revoke all on function public.mark_lead_activity_disposition(uuid, uuid, uuid, text, integer, text, timestamptz) from public, anon, authenticated, tenant_app;
grant execute on function public.mark_lead_activity_disposition(uuid, uuid, uuid, text, integer, text, timestamptz) to service_role;
revoke all on function public.tenant_activity_report(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.tenant_activity_report(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer, boolean) to tenant_app, service_role;
revoke all on function public.tenant_recycle_performance(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.tenant_recycle_performance(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz) to tenant_app, service_role;
