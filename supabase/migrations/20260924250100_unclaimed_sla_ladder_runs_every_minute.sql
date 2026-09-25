-- The unclaimed-SLA ladder runs every minute inside the database, and a backlog expires quietly.
--
-- The job had no scheduler. Its only trigger is the Vercel cron in vercel.json, and there is no
-- deployment (backlog #168; vercel.json is not on main). Every run so far was someone typing
-- `npm run sla:run` or a verifier, the last on 2026-09-22 -- so inbound transfers sat unclaimed with
-- no warning, no escalation, no partner notice and no expiry, and piled up past the inbox's cap.
--
-- 1. pg_cron advances the ladder every minute: run_unclaimed_sla records each rung as a durable
--    tenant_lead_sla_events row, as it always has. The side effects -- the owner's escalation email,
--    agents' alerts, the partner's chat card, the nurture lead on expiry -- stay in the app
--    (lib/queueSla/service.ts), which delivers every pending event the next time it runs (the cron
--    route once deployed, `npm run sla:run` until then). It now checks each escalation and partner
--    card against the transfer first and says nothing about one that was claimed or expired since.
--    The app's heartbeat is written only by the app, so it still reports "stale" until the app runs:
--    delivery is what it measures, and that is still waiting on a host.
--
-- 2. The first minute would otherwise fire every rung for every transfer in the backlog at once --
--    for one tenant 500+, each an email and a partner card about a caller who left hours ago. A
--    transfer already past expiry when no rung has fired skips warn, escalate and partner and just
--    expires; its audit row says so ('quiet'). Transfers still inside the window get the full ladder.
--    A quietly expired transfer's partner was never told, so the partner pipeline shows it as expired
--    rather than "Nobody claimed it" (lib/partnerLeads/lanes.ts keys that label on the partner rung).
--
-- 3. A daily job trims pg_cron's run log for this job to 7 days; at one row a minute it would
--    otherwise grow by 10,000 rows a week.
--
-- The function body is 20260924150000's, the three earlier rungs wrapped in `if not v_quiet`, and
-- 'quiet' added to the expiry's audit metadata. Signature and grants unchanged. Scheduling under an
-- existing job name replaces that job, so this file can be run again safely.
--
-- To stop it:   select cron.unschedule('unclaimed-sla-ladder');
-- To see runs:  select * from cron.job_run_details where jobid = (select jobid from cron.job
--                where jobname = 'unclaimed-sla-ladder') order by start_time desc limit 20;

create or replace function public.run_unclaimed_sla(p_now timestamptz default now(), p_limit integer default 500)
returns table (event_id uuid, tenant_id uuid, work_item_id uuid, lead_id uuid, partner_id uuid, rung text, occurred_at timestamptz)
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  item record; v_age integer; v_id uuid;
  v_warn integer; v_escalate integer; v_partner integer; v_expire integer;
  v_quiet boolean;
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
    -- Already past expiry and no rung has fired: the job was not running while this transfer
    -- waited, and the caller is long gone. Warning, escalating and telling the partner now would
    -- be news about nobody, so it just expires (and becomes a nurture lead, app-side).
    v_quiet := v_age >= v_expire and item.sla_warned_at is null and item.sla_escalated_at is null
      and item.sla_partner_notified_at is null;

    if not v_quiet then

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
    end if;
    if v_age >= v_expire and item.sla_expired_at is null then
      update public.lead_queue set status = 'expired', sla_expired_at = p_now where id = item.id and status = 'unclaimed';
      if found then
        v_id := null;
        insert into public.tenant_lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at)
        values (item.tenant_id, item.id, item.lead_id, item.partner_id, 'expire', p_now)
        on conflict on constraint tenant_lead_sla_events_work_item_id_rung_key do nothing returning id into v_id;
        insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
        values ('system', 'tenant.lead_sla_expired', 'lead_queue', item.id::text, jsonb_build_object('ageSeconds', v_age, 'thresholdSeconds', v_expire, 'quiet', v_quiet));
        if v_id is not null then return query select v_id, item.tenant_id, item.id, item.lead_id, item.partner_id, 'expire'::text, p_now; end if;
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function public.run_unclaimed_sla(timestamptz, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.run_unclaimed_sla(timestamptz, integer) to service_role;

-- Supabase Cron (docs: guides/cron/install).
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

select cron.schedule(
  'unclaimed-sla-ladder',
  '* * * * *',
  $cron$select count(*) from public.run_unclaimed_sla(now(), 500)$cron$
);

select cron.schedule(
  'unclaimed-sla-ladder-log-cleanup',
  '17 3 * * *',
  $cron$delete from cron.job_run_details
         where jobid in (select jobid from cron.job where jobname = 'unclaimed-sla-ladder')
           and end_time < now() - interval '7 days'$cron$
);

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'run_unclaimed_sla'
       and p.prosrc like '%if not v_quiet then%'
       and p.prosrc like '%q.partner_id is not null%'
  ) then
    raise exception 'run_unclaimed_sla still fires every rung for a transfer that is already past expiry';
  end if;
  if not exists (select 1 from cron.job where jobname = 'unclaimed-sla-ladder' and schedule = '* * * * *' and active) then
    raise exception 'the unclaimed-SLA ladder is not scheduled';
  end if;
end;
$$;
