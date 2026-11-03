-- The unclaimed-lead ladder applies to inbound transfers, not to the dialer's queue.
--
-- run_unclaimed_sla walked every lead_queue row with status 'unclaimed'. Since 20260917146000 gave
-- every imported lead a work item (~200k rows, status 'unclaimed', no partner), the ladder would
-- warn, escalate and then EXPIRE each of them four hours after import -- and an expired work item is
-- never served by the dialer again. The job last ran on 2026-09-22, before that backfill landed, so
-- when this was written only four dialer leads had been expired that way.
--
-- 1. The ladder reads only rows with a partner. Partner intake (lib/agentTemplates/intake.ts)
--    always records one; imports and vendor posts (lib/leadPost/service.ts) never do.
-- 2. Dialer leads the ladder already expired go back to 'unclaimed', keeping their place in line.
-- 3. A partial index, so the job does not scan the dialer's 200k rows to find the inbound few.
--
-- The function body is 20260913170000's, unchanged except for the one added predicate.

create index if not exists lead_queue_sla_inbound_unclaimed_idx
  on public.lead_queue (queued_at asc)
  where status = 'unclaimed' and partner_id is not null;

create or replace function public.run_unclaimed_sla(p_now timestamptz default now(), p_limit integer default 500)
returns table (event_id uuid, tenant_id uuid, work_item_id uuid, lead_id uuid, partner_id uuid, rung text, occurred_at timestamptz)
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  item record; v_age integer; v_id uuid;
  v_warn integer; v_escalate integer; v_partner integer; v_expire integer;
begin
  for item in
    select q.*,
      coalesce(s.warn_after_seconds, 45) as warn_after,
      coalesce(s.escalate_after_seconds, 120) as escalate_after,
      coalesce(s.partner_notify_after_seconds, 300) as partner_after,
      coalesce(s.expire_after_seconds, 14400) as expire_after
    from public.lead_queue q
    left join public.tenant_queue_sla_settings s on s.tenant_id = q.tenant_id
    where q.status = 'unclaimed'
      -- Inbound transfers only: nobody claims a dialer lead, the dialer serves it.
      and q.partner_id is not null
    order by q.queued_at asc
    limit greatest(1, least(coalesce(p_limit, 500), 1000))
    for update of q skip locked
  loop
    v_age := greatest(0, floor(extract(epoch from (p_now - item.queued_at)))::integer);
    v_warn := item.warn_after; v_escalate := item.escalate_after;
    v_partner := item.partner_after; v_expire := item.expire_after;

    if v_age >= v_warn and item.sla_warned_at is null then
      update public.lead_queue set sla_warned_at = p_now where id = item.id and status = 'unclaimed';
      v_id := null;
      insert into public.tenant_lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at)
      values (item.tenant_id, item.id, item.lead_id, item.partner_id, 'warn', p_now)
      on conflict on constraint tenant_lead_sla_events_work_item_id_rung_key do nothing returning id into v_id;
      insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
      values ('system', 'tenant.lead_sla_warned', 'lead_queue', item.id::text, jsonb_build_object('ageSeconds', v_age, 'thresholdSeconds', v_warn));
      if v_id is not null then return query select v_id, item.tenant_id, item.id, item.lead_id, item.partner_id, 'warn'::text, p_now; end if;
    end if;
    if v_age >= v_escalate and item.sla_escalated_at is null then
      update public.lead_queue set sla_escalated_at = p_now where id = item.id and status = 'unclaimed';
      v_id := null;
      insert into public.tenant_lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at)
      values (item.tenant_id, item.id, item.lead_id, item.partner_id, 'escalate', p_now)
      on conflict on constraint tenant_lead_sla_events_work_item_id_rung_key do nothing returning id into v_id;
      insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
      values ('system', 'tenant.lead_sla_escalated', 'lead_queue', item.id::text, jsonb_build_object('ageSeconds', v_age, 'thresholdSeconds', v_escalate));
      if v_id is not null then return query select v_id, item.tenant_id, item.id, item.lead_id, item.partner_id, 'escalate'::text, p_now; end if;
    end if;
    if v_age >= v_partner and item.sla_partner_notified_at is null then
      update public.lead_queue set sla_partner_notified_at = p_now where id = item.id and status = 'unclaimed';
      v_id := null;
      insert into public.tenant_lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at)
      values (item.tenant_id, item.id, item.lead_id, item.partner_id, 'partner', p_now)
      on conflict on constraint tenant_lead_sla_events_work_item_id_rung_key do nothing returning id into v_id;
      insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
      values ('system', 'tenant.lead_sla_partner_notified', 'lead_queue', item.id::text, jsonb_build_object('ageSeconds', v_age, 'thresholdSeconds', v_partner));
      if v_id is not null then return query select v_id, item.tenant_id, item.id, item.lead_id, item.partner_id, 'partner'::text, p_now; end if;
    end if;
    if v_age >= v_expire and item.sla_expired_at is null then
      update public.lead_queue set status = 'expired', sla_expired_at = p_now where id = item.id and status = 'unclaimed';
      if found then
        v_id := null;
        insert into public.tenant_lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at)
        values (item.tenant_id, item.id, item.lead_id, item.partner_id, 'expire', p_now)
        on conflict on constraint tenant_lead_sla_events_work_item_id_rung_key do nothing returning id into v_id;
        insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
        values ('system', 'tenant.lead_sla_expired', 'lead_queue', item.id::text, jsonb_build_object('ageSeconds', v_age, 'thresholdSeconds', v_expire));
        if v_id is not null then return query select v_id, item.tenant_id, item.id, item.lead_id, item.partner_id, 'expire'::text, p_now; end if;
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function public.run_unclaimed_sla(timestamptz, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.run_unclaimed_sla(timestamptz, integer) to service_role;

-- Put back what the ladder took from the dialer: only rows the SLA job itself expired
-- (sla_expired_at set), and only where the lead has no other open work item -- the unique index on
-- (lead_id) where status in ('unclaimed', 'claimed') would refuse a second one.
with restored as (
  update public.lead_queue q
     set status = 'unclaimed',
         sla_warned_at = null, sla_escalated_at = null, sla_partner_notified_at = null, sla_expired_at = null,
         updated_at = now()
   where q.status = 'expired'
     and q.partner_id is null
     and q.sla_expired_at is not null
     and not exists (
       select 1 from public.lead_queue other
        where other.lead_id = q.lead_id and other.id <> q.id and other.status in ('unclaimed', 'claimed')
     )
  returning q.id, q.lead_id
)
insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
select 'system', 'tenant.lead_sla_reopened', 'lead_queue', r.id::text,
       jsonb_build_object('leadId', r.lead_id, 'reason', 'dialer lead expired by the inbound SLA ladder; restored by 20260924150000')
  from restored r;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'run_unclaimed_sla' and p.prosrc like '%q.partner_id is not null%'
  ) then
    raise exception 'run_unclaimed_sla still walks the dialer queue';
  end if;
end;
$$;
