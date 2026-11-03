-- The unclaimed-SLA ladder runs again every time a transfer goes back in the queue (2026-10-16).
--
-- A transfer returned to the queue (return_transfer_to_queue) or reopened after expiry
-- (reopen_expired_lead) starts a new wait: queued_at moves and every sla_*_at stamp is cleared, so
-- run_unclaimed_sla fires its rungs again. But tenant_lead_sla_events was UNIQUE (work_item_id, rung),
-- so each second-cycle insert hit the conflict and did nothing: the rung was stamped on the queue row
-- while no event existed, and nobody was told (no owner alert, no escalation email, no partner notice,
-- no nurture). The side effects' keys (agent_notifications.source_key, partner_messages.event_key)
-- were per work item too, so they would have been swallowed as duplicates as well.
--
--   lead_queue.sla_cycle            0 for a transfer's first wait; +1 each time it goes back in the queue.
--   tenant_lead_sla_events.cycle    the wait an event belongs to. UNIQUE (work_item_id, rung, cycle).
--   keys                            unchanged for cycle 0 (so nothing already sent repeats);
--                                   'unclaimed-sla:<work item>~<cycle>:…' from the second wait on.
--                                   lib/queueSla/keys.ts builds the same keys app-side.
--
-- Function bodies are the live definitions (read 2026-10-16) with only those edits.
-- Rollback: restore the four functions from 20260929*/20260925* and
--   alter table public.tenant_lead_sla_events drop constraint tenant_lead_sla_events_work_item_cycle_rung_key,
--     add constraint tenant_lead_sla_events_work_item_id_rung_key unique (work_item_id, rung);  -- fails once a second cycle exists
--   alter table public.tenant_lead_sla_events drop column cycle; alter table public.lead_queue drop column sla_cycle;

alter table public.lead_queue add column if not exists sla_cycle integer not null default 0;
alter table public.tenant_lead_sla_events add column if not exists cycle integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.tenant_lead_sla_events'::regclass
                  and conname = 'tenant_lead_sla_events_work_item_cycle_rung_key') then
    alter table public.tenant_lead_sla_events
      add constraint tenant_lead_sla_events_work_item_cycle_rung_key unique (work_item_id, rung, cycle);
  end if;
end $$;
alter table public.tenant_lead_sla_events drop constraint if exists tenant_lead_sla_events_work_item_id_rung_key;

CREATE OR REPLACE FUNCTION public.run_unclaimed_sla(p_now timestamp with time zone DEFAULT now(), p_limit integer DEFAULT 500)
 RETURNS TABLE(event_id uuid, tenant_id uuid, work_item_id uuid, lead_id uuid, partner_id uuid, rung text, occurred_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
        insert into public.tenant_lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at, cycle)
        values (item.tenant_id, item.id, item.lead_id, item.partner_id, 'warn', p_now, item.sla_cycle)
        on conflict on constraint tenant_lead_sla_events_work_item_cycle_rung_key do nothing returning id into v_id;
        insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
        values ('system', 'tenant.lead_sla_warned', 'lead_queue', item.id::text, jsonb_build_object('ageSeconds', v_age, 'thresholdSeconds', v_warn));
        if v_id is not null then return query select v_id, item.tenant_id, item.id, item.lead_id, item.partner_id, 'warn'::text, p_now; end if;
      end if;
      if v_age >= v_escalate and item.sla_escalated_at is null then
        update public.lead_queue set sla_escalated_at = p_now where id = item.id and status = 'unclaimed';
        v_id := null;
        insert into public.tenant_lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at, cycle)
        values (item.tenant_id, item.id, item.lead_id, item.partner_id, 'escalate', p_now, item.sla_cycle)
        on conflict on constraint tenant_lead_sla_events_work_item_cycle_rung_key do nothing returning id into v_id;
        insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
        values ('system', 'tenant.lead_sla_escalated', 'lead_queue', item.id::text, jsonb_build_object('ageSeconds', v_age, 'thresholdSeconds', v_escalate));
        if v_id is not null then return query select v_id, item.tenant_id, item.id, item.lead_id, item.partner_id, 'escalate'::text, p_now; end if;
      end if;
      if v_age >= v_partner and item.sla_partner_notified_at is null then
        update public.lead_queue set sla_partner_notified_at = p_now where id = item.id and status = 'unclaimed';
        v_id := null;
        insert into public.tenant_lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at, cycle)
        values (item.tenant_id, item.id, item.lead_id, item.partner_id, 'partner', p_now, item.sla_cycle)
        on conflict on constraint tenant_lead_sla_events_work_item_cycle_rung_key do nothing returning id into v_id;
        insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
        values ('system', 'tenant.lead_sla_partner_notified', 'lead_queue', item.id::text, jsonb_build_object('ageSeconds', v_age, 'thresholdSeconds', v_partner));
        if v_id is not null then return query select v_id, item.tenant_id, item.id, item.lead_id, item.partner_id, 'partner'::text, p_now; end if;
      end if;
    end if;
    if v_age >= v_expire and item.sla_expired_at is null then
      update public.lead_queue set status = 'expired', sla_expired_at = p_now where id = item.id and status = 'unclaimed';
      if found then
        v_id := null;
        insert into public.tenant_lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at, cycle)
        values (item.tenant_id, item.id, item.lead_id, item.partner_id, 'expire', p_now, item.sla_cycle)
        on conflict on constraint tenant_lead_sla_events_work_item_cycle_rung_key do nothing returning id into v_id;
        insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
        values ('system', 'tenant.lead_sla_expired', 'lead_queue', item.id::text, jsonb_build_object('ageSeconds', v_age, 'thresholdSeconds', v_expire, 'quiet', v_quiet));
        if v_id is not null then return query select v_id, item.tenant_id, item.id, item.lead_id, item.partner_id, 'expire'::text, p_now; end if;
      end if;
    end if;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.run_unclaimed_sla_side_effects(p_now timestamp with time zone DEFAULT now(), p_limit integer DEFAULT 500, p_source text DEFAULT 'database'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_started timestamptz := clock_timestamp();
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 1000));
  -- Only pg_cron's run is the heartbeat. The app records its own run (lib/queueSla/monitor.ts).
  v_heartbeat boolean := coalesce(p_source, 'database') = 'database';
  v_fired integer := 0;
  v_ladder_error text;
  v_digest_error text;
  v_digests integer := 0;
  e record;
  v_status text;
  v_values jsonb;
  v_name text;
  v_state text;
  v_partner_name text;
  v_channel uuid;
  v_message uuid;
  v_n integer;
  v_outcome jsonb;
  v_email_due timestamptz;
  v_queue boolean;
  v_nurture jsonb;
  v_err text;
  v_ids uuid[] := '{}';
  v_events integer := 0;
  v_owner_alerts integer := 0;
  v_offered integer := 0;
  v_partner_cards integer := 0;
  v_partner_alerts integer := 0;
  v_nobody_claimed integer := 0;
  v_nurtured integer := 0;
  v_emails_owed integer := 0;
  v_warns integer := 0;
  v_skip_stale integer := 0;
  v_skip_resolved integer := 0;
  v_gave_up integer := 0;
  v_failed integer := 0;
  v_failures jsonb := '[]'::jsonb;
  v_by_tenant jsonb := '{}'::jsonb;
  v_report jsonb;
  v_ok boolean;
begin
  if coalesce(p_source, 'database') not in ('database', 'app') then
    raise exception using errcode = '22023', message = 'INVALID_SOURCE';
  end if;
  begin
    -- 1 · the ladder, so a rung fired this minute is acted on this minute
    begin
      select count(*)::integer into v_fired from public.run_unclaimed_sla(p_now, 500);
    exception when others then
      get stacked diagnostics v_ladder_error = message_text;
    end;

    -- 2 · each pending event
    for e in
      select ev.id, ev.tenant_id, ev.work_item_id, ev.lead_id, ev.partner_id, ev.rung, ev.occurred_at, ev.attempts, ev.cycle
        from public.tenant_lead_sla_events ev
       where ev.processed_at is null
         and (ev.claimed_at is null or ev.claimed_at < p_now - interval '10 minutes')
       order by ev.created_at asc
       limit v_limit
       for update skip locked
    loop
      v_events := v_events + 1;
      v_ids := v_ids || e.id;
      begin
        if e.occurred_at < p_now - interval '24 hours' then
          update public.tenant_lead_sla_events
             set processed_at = p_now, handled_by = 'skipped', skipped_reason = 'older_than_24_hours',
                 outcome = jsonb_build_object('sent', false), last_error = null
           where id = e.id;
          v_skip_stale := v_skip_stale + 1;
          continue;
        end if;

        select lq.status into v_status from public.lead_queue lq
         where lq.id = e.work_item_id and lq.tenant_id = e.tenant_id;
        if e.rung in ('escalate', 'partner') and v_status is distinct from 'unclaimed' then
          -- Claimed or expired since the rung fired: "needs attention" is no longer news.
          update public.tenant_lead_sla_events
             set processed_at = p_now, handled_by = 'database', skipped_reason = 'no_longer_unclaimed',
                 outcome = jsonb_build_object('sent', false, 'transferStatus', v_status), last_error = null
           where id = e.id;
          v_skip_resolved := v_skip_resolved + 1;
          continue;
        end if;

        select l.values into v_values from public.agent_leads l where l.id = e.lead_id and l.tenant_id = e.tenant_id;
        v_values := case when jsonb_typeof(v_values) = 'object' then v_values else '{}'::jsonb end;
        v_name := left(coalesce(
          nullif(btrim(v_values->>'full_name'), ''),
          nullif(btrim(concat_ws(' ', nullif(btrim(v_values->>'first_name'), ''), nullif(btrim(v_values->>'last_name'), ''))), ''),
          nullif(btrim(v_values->>'name'), ''),
          'Customer'), 160);
        v_outcome := jsonb_build_object('sent', true);
        v_email_due := null;

        if e.rung = 'warn' then
          v_outcome := jsonb_build_object('sent', false, 'note', 'the floor shows the warning');
          v_warns := v_warns + 1;

        elsif e.rung = 'escalate' then
          insert into public.agent_notifications (tenant_id, recipient_user_id, kind, title, body, link, source_key)
          select e.tenant_id, tu.user_id, 'unclaimed_sla_escalation',
                 left('Unclaimed lead needs attention: ' || v_name, 160),
                 left(v_name || ' has been waiting unclaimed. Open the lead to claim it or coordinate coverage.', 1000),
                 '/app/leads/' || e.lead_id::text,
                 'unclaimed-sla:' || e.work_item_id::text || case when e.cycle > 0 then '~' || e.cycle::text else '' end || ':escalated'
            from public.tenant_users tu
            join public.users u on u.id = tu.user_id
           where tu.tenant_id = e.tenant_id and tu.role::text = 'owner'
             and tu.accepted_at is not null and u.status::text = 'active'
          on conflict (tenant_id, recipient_user_id, source_key) do nothing;
          get diagnostics v_n = row_count;
          v_owner_alerts := v_owner_alerts + v_n;
          v_outcome := v_outcome || jsonb_build_object('ownerAlerts', v_n);

          -- "and the lead is offered more widely": everyone else who can claim a transfer.
          insert into public.agent_notifications (tenant_id, recipient_user_id, kind, title, body, link, source_key)
          select distinct e.tenant_id, tu.user_id, 'unclaimed_sla_escalation',
                 left('Still unclaimed: ' || v_name, 160),
                 left(v_name || ' has waited past the escalation time. Anyone free can claim it now.', 1000),
                 '/app/leads/' || e.lead_id::text,
                 'unclaimed-sla:' || e.work_item_id::text || case when e.cycle > 0 then '~' || e.cycle::text else '' end || ':offered'
            from public.tenant_users tu
            join public.users u on u.id = tu.user_id
           where tu.tenant_id = e.tenant_id and tu.role::text in ('producer', 'assistant')
             and tu.accepted_at is not null and u.status::text = 'active'
             and not exists (select 1 from public.tenant_users o
                              where o.tenant_id = e.tenant_id and o.user_id = tu.user_id and o.role::text = 'owner')
          on conflict (tenant_id, recipient_user_id, source_key) do nothing;
          get diagnostics v_n = row_count;
          v_offered := v_offered + v_n;
          v_outcome := v_outcome || jsonb_build_object('offered', v_n);

          -- The email is the app's to send (lib/queueSla). It is owed when an owner has an address.
          if exists (select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id
                      where tu.tenant_id = e.tenant_id and tu.role::text = 'owner' and tu.accepted_at is not null
                        and u.status::text = 'active' and nullif(btrim(u.email), '') is not null) then
            v_email_due := p_now;
            v_emails_owed := v_emails_owed + 1;
          end if;
          v_outcome := v_outcome || jsonb_build_object('emailOwed', v_email_due is not null);

        elsif e.rung = 'partner' then
          if e.partner_id is null then
            v_outcome := jsonb_build_object('sent', false, 'note', 'the transfer has no partner');
          else
            v_state := left(coalesce(nullif(btrim(v_values->>'state'), ''), nullif(btrim(v_values->>'state_code'), ''),
                                     nullif(btrim(v_values->>'address_state'), '')), 40);
            -- The partner's notice. An archived channel is an offboarded partner: nothing is posted.
            v_channel := null;
            select c.id into v_channel from public.partner_channels c
             where c.tenant_id = e.tenant_id and c.partner_id = e.partner_id
               and c.channel_type = 'partner' and c.status = 'active'
             order by c.created_at asc
             limit 1;
            v_message := null;
            if v_channel is not null then
              insert into public.partner_messages
                (tenant_id, partner_id, channel_id, work_item_id, message, message_kind, card_type, card_payload, event_key, created_by)
              values
                (e.tenant_id, e.partner_id, v_channel, e.work_item_id,
                 left(v_name || ' was not claimed before the response window. Our team has been notified.', 2000),
                 'system_card', null,
                 jsonb_build_object('customer', v_name, 'notice', 'unclaimed_partner_notice')
                   || case when v_state is not null then jsonb_build_object('state', v_state) else '{}'::jsonb end,
                 'unclaimed-sla:' || e.work_item_id::text || case when e.cycle > 0 then '~' || e.cycle::text else '' end || ':partner', null)
              on conflict (event_key) where event_key is not null do nothing
              returning id into v_message;
              if v_message is not null then
                v_partner_cards := v_partner_cards + 1;
                insert into public.partner_notifications (tenant_id, partner_id, recipient_user_id, kind, title, body, link, source_key)
                select e.tenant_id, e.partner_id, pu.user_id, 'lead_status_changed', 'Lead status updated',
                       'A lead in your pipeline has a new operational update.', '/partner/pipeline',
                       'partner-system-card:' || v_message::text
                  from public.partner_users pu
                 where pu.tenant_id = e.tenant_id and pu.partner_id = e.partner_id and pu.status = 'active'
                on conflict (tenant_id, recipient_user_id, source_key) do nothing;
                get diagnostics v_n = row_count;
                v_partner_alerts := v_partner_alerts + v_n;
                v_outcome := v_outcome || jsonb_build_object('partnerMessageId', v_message, 'partnerAlerts', v_n);
              else
                v_outcome := v_outcome || jsonb_build_object('partnerMessage', 'already posted');
              end if;
            else
              v_outcome := v_outcome || jsonb_build_object('partnerMessage', 'no active partner channel');
            end if;

            -- The agency side of it, owners only. Never a row in the partner's channel.
            select p.name into v_partner_name from public.partners p where p.id = e.partner_id and p.tenant_id = e.tenant_id;
            insert into public.agent_notifications (tenant_id, recipient_user_id, kind, title, body, link, source_key)
            select e.tenant_id, tu.user_id, 'unclaimed_sla_escalation',
                   left('Nobody claimed: ' || v_name, 160),
                   left(v_name || ' from ' || coalesce(nullif(btrim(v_partner_name), ''), 'the partner')
                        || ' was not claimed before the response window.', 1000),
                   '/app/leads/' || e.lead_id::text,
                   'unclaimed-sla:' || e.work_item_id::text || case when e.cycle > 0 then '~' || e.cycle::text else '' end || ':nobody-claimed'
              from public.tenant_users tu
              join public.users u on u.id = tu.user_id
             where tu.tenant_id = e.tenant_id and tu.role::text = 'owner'
               and tu.accepted_at is not null and u.status::text = 'active'
            on conflict (tenant_id, recipient_user_id, source_key) do nothing;
            get diagnostics v_n = row_count;
            v_nobody_claimed := v_nobody_claimed + v_n;
            v_outcome := v_outcome || jsonb_build_object('nobodyClaimedOwnerAlerts', v_n);
          end if;

        elsif e.rung = 'expire' then
          -- "It leaves the active queue and becomes a nurture lead", queued where the plan dials.
          v_queue := coalesce((select (te.entitlement->'features') ? 'outbound_dialing'
                                 from public.tenant_entitlements te where te.tenant_id = e.tenant_id), false);
          begin
            v_nurture := public.nurture_expired_transfer(e.tenant_id, e.work_item_id, v_queue);
          exception when unique_violation then
            -- lead_queue is UNIQUE(lead_id) live (lead_queue_lead_id_key, see 20260925709300), and the
            -- expired transfer is the lead's one row, so a second dialer item cannot be inserted.
            -- The lead still becomes a nurture lead, it is just not queued.
            v_nurture := public.nurture_expired_transfer(e.tenant_id, e.work_item_id, false)
                         || jsonb_build_object('dialerItem', 'refused, the lead already has its one queue row');
          end;
          if coalesce((v_nurture->>'nurtured')::boolean, false) and not coalesce((v_nurture->>'duplicate')::boolean, false) then
            v_nurtured := v_nurtured + 1;
          end if;
          v_outcome := jsonb_build_object('sent', false, 'nurture', v_nurture);
        end if;

        update public.tenant_lead_sla_events
           set processed_at = p_now, handled_by = 'database', skipped_reason = null, outcome = v_outcome,
               last_error = null, email_due_at = coalesce(email_due_at, v_email_due)
         where id = e.id;
      exception when others then
        -- The subtransaction's writes are gone. Record the failure on the event and carry on.
        get stacked diagnostics v_err = message_text;
        update public.tenant_lead_sla_events
           set attempts = attempts + 1,
               last_error = left(v_err, 1000),
               processed_at = case when attempts + 1 >= 5 then p_now end,
               handled_by = case when attempts + 1 >= 5 then 'database' end,
               skipped_reason = case when attempts + 1 >= 5 then 'gave_up_after_failures' end,
               outcome = case when attempts + 1 >= 5 then jsonb_build_object('sent', false, 'error', left(v_err, 300)) else outcome end
         where id = e.id;
        if e.attempts + 1 >= 5 then v_gave_up := v_gave_up + 1; end if;
        v_failed := v_failed + 1;
        if jsonb_array_length(v_failures) < 10 then
          v_failures := v_failures || jsonb_build_array(jsonb_build_object(
            'eventId', e.id, 'tenantId', e.tenant_id, 'rung', e.rung, 'error', left(v_err, 300)));
        end if;
      end;
    end loop;

    -- 3 · the daily digest
    begin
      v_digests := public.refresh_unclaimed_sla_daily_digests(p_now);
    exception when others then
      get stacked diagnostics v_digest_error = message_text;
    end;

    select coalesce(jsonb_object_agg(x.tenant_id::text, jsonb_build_object('events', x.n, 'sent', x.sent, 'skipped', x.skipped, 'failed', x.failed)), '{}'::jsonb)
      into v_by_tenant
      from (
        select ev.tenant_id, count(*)::integer as n,
               count(*) filter (where ev.processed_at = p_now and ev.handled_by = 'database' and ev.skipped_reason is null and coalesce((ev.outcome->>'sent')::boolean, false))::integer as sent,
               count(*) filter (where ev.skipped_reason is not null)::integer as skipped,
               count(*) filter (where ev.processed_at is null)::integer as failed
          from public.tenant_lead_sla_events ev
         where ev.id = any(v_ids)
         group by ev.tenant_id
      ) x;

    v_ok := v_failed = 0 and v_ladder_error is null and v_digest_error is null;
    v_report := jsonb_build_object(
      'ok', v_ok,
      'source', coalesce(p_source, 'database'),
      'ladder', jsonb_build_object('fired', v_fired, 'error', v_ladder_error),
      'events', v_events,
      'sent', jsonb_build_object('ownerAlerts', v_owner_alerts, 'offered', v_offered, 'partnerNotices', v_partner_cards,
                                 'partnerAlerts', v_partner_alerts, 'nobodyClaimed', v_nobody_claimed,
                                 'nurtured', v_nurtured, 'emailsOwed', v_emails_owed),
      'warnsRecorded', v_warns,
      'skipped', jsonb_build_object('olderThan24Hours', v_skip_stale, 'noLongerUnclaimed', v_skip_resolved, 'gaveUp', v_gave_up),
      'failed', v_failed,
      'failures', v_failures,
      'digest', jsonb_build_object('rows', v_digests, 'error', v_digest_error),
      'byTenant', v_by_tenant);

    -- 4 · the heartbeat
    if v_heartbeat then
      insert into public.unclaimed_sla_job_runs (source, started_at, finished_at, ok, report, error)
      values ('database', v_started, clock_timestamp(), v_ok, v_report,
              left(coalesce(v_ladder_error, v_digest_error, v_failures->0->>'error'), 2000));
      delete from public.unclaimed_sla_job_runs where started_at < p_now - interval '7 days';
    end if;
    return v_report;
  exception when others then
    get stacked diagnostics v_err = message_text;
    v_report := jsonb_build_object('ok', false, 'source', coalesce(p_source, 'database'), 'error', left(v_err, 1000));
    if v_heartbeat then
      insert into public.unclaimed_sla_job_runs (source, started_at, finished_at, ok, report, error)
      values ('database', v_started, clock_timestamp(), false, v_report, left(v_err, 2000));
    end if;
    return v_report;
  end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.return_transfer_to_queue(p_tenant_id uuid, p_work_item_id uuid, p_actor uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  q public.lead_queue%rowtype;
  v_role text;
  v_flow public.tenant_disposition_flows%rowtype;
  v_session uuid;
begin
  if p_reason is null or p_reason not in ('unassign', 'requeue') then raise exception using errcode = '22023', message = 'INVALID_RELEASE_REASON'; end if;
  select tu.role::text into v_role from public.tenant_users tu join public.users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and u.status = 'active';
  if v_role is null or v_role not in ('owner', 'producer', 'assistant') then raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED'; end if;
  select * into q from public.lead_queue where id = p_work_item_id and tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'WORK_ITEM_NOT_FOUND'; end if;
  if q.partner_id is null then raise exception using errcode = 'P0001', message = 'NOT_A_TRANSFER'; end if;
  if q.status = 'unclaimed' then
    return jsonb_build_object('work_item_id', q.id, 'lead_id', q.lead_id, 'status', q.status, 'duplicate', true);
  end if;
  if p_reason = 'unassign' then
    if q.status = 'handed_pending' then raise exception using errcode = 'P0001', message = 'HANDOFF_PENDING'; end if;
    if q.status not in ('claimed', 'buffer_active', 'la_active') then raise exception using errcode = 'P0001', message = 'NOT_BEING_WORKED'; end if;
    if v_role <> 'owner' and q.owner_user_id is distinct from p_actor then raise exception using errcode = '42501', message = 'RELEASE_OWNER_REQUIRED'; end if;
  else
    if q.status <> 'dropped' then raise exception using errcode = 'P0001', message = 'NOT_DROPPED'; end if;
    if v_role <> 'owner' and q.owner_user_id is distinct from p_actor and q.disposition_by is distinct from p_actor then
      raise exception using errcode = '42501', message = 'RELEASE_OWNER_REQUIRED';
    end if;
  end if;

  update public.active_calls set ended_at = now(), updated_at = now()
   where work_item_id = q.id and tenant_id = p_tenant_id and ended_at is null;
  update public.tenant_verification_sessions
     set status = 'closed', ended_at = now(), updated_at = now(), last_actor_id = p_actor
   where work_item_id = q.id and tenant_id = p_tenant_id and ended_at is null
  returning id into v_session;

  if p_reason = 'requeue' then
    -- The drop was recorded. The next call gets its own outcome, walked from the stage it is in now.
    delete from public.disposition_walk_steps s using public.disposition_walks w
     where s.walk_id = w.id and w.tenant_id = p_tenant_id and w.work_item_id = q.id;
    select f.* into v_flow from public.tenant_disposition_flows f where f.tenant_id = p_tenant_id and f.stage_id = q.stage_id and f.is_active;
    if found then
      update public.disposition_walks
         set flow_id = v_flow.id, current_node_id = v_flow.root_node_id, status = 'open', completed_at = null,
             final_disposition_key = null, composed_note = null, updated_at = now()
       where tenant_id = p_tenant_id and work_item_id = q.id;
    else
      delete from public.disposition_walks where tenant_id = p_tenant_id and work_item_id = q.id;
    end if;
    -- The deal is being worked again, its call_result keeps the drop until the next outcome.
    update public.deal_flow set status = 'partial', updated_at = now()
     where tenant_id = p_tenant_id and lead_id = q.lead_id and status = 'dropped';
  end if;

  update public.lead_queue
     set status = 'unclaimed', owner_user_id = null, claimed_by = null, owner_role = null,
         buffer_user_id = null, buffer_ended_at = null, claimed_at = null, queued_at = now(),
         sla_warned_at = null, sla_escalated_at = null, sla_partner_notified_at = null, sla_expired_at = null,
         requeued_at = now(), requeue_count = coalesce(requeue_count, 0) + 1, sla_cycle = sla_cycle + 1, updated_at = now()
   where id = q.id and tenant_id = p_tenant_id;

  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_actor, case when p_reason = 'requeue' then 'tenant.transfer_requeued' else 'tenant.transfer_unassigned' end, 'lead_queue', q.id::text,
    jsonb_build_object('leadId', q.lead_id, 'previousStatus', q.status, 'previousOwnerId', q.owner_user_id, 'bufferUserId', q.buffer_user_id,
      'verificationSessionId', v_session, 'requeueCount', coalesce(q.requeue_count, 0) + 1));

  return jsonb_build_object('work_item_id', q.id, 'lead_id', q.lead_id, 'status', 'unclaimed', 'previous_status', q.status,
    'verification_session_id', v_session, 'requeue_count', coalesce(q.requeue_count, 0) + 1, 'duplicate', false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_expired_lead(p_tenant_id uuid, p_work_item_id uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare q public.lead_queue;
begin
  if not exists (select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id
    where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and tu.accepted_at is not null and u.status = 'active'
      and tu.role in ('owner', 'producer', 'assistant')) then raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED'; end if;
  select * into q from public.lead_queue where id = p_work_item_id and tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'WORK_ITEM_NOT_FOUND'; end if;
  if q.status = 'unclaimed' then return jsonb_build_object('id', q.id, 'status', q.status, 'duplicate', true); end if;
  if q.status <> 'expired' then raise exception using errcode = 'P0001', message = 'LEAD_NOT_EXPIRED'; end if;

  -- The nurture call that expiry queued (20260924230400). Being dialled now: refuse, so two agents
  -- never hold the same person. Still waiting: close it, and the lead is a transfer again.
  if exists (select 1 from public.lead_queue n
              where n.tenant_id = p_tenant_id and n.nurtured_from_work_item_id = q.id
                and n.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active')) then
    raise exception using errcode = 'P0001', message = 'LEAD_BEING_DIALLED';
  end if;
  update public.lead_queue n set status = 'closed', updated_at = now()
   where n.tenant_id = p_tenant_id and n.nurtured_from_work_item_id = q.id and n.status = 'unclaimed';
  update public.agent_leads l set lead_state = 'fresh', next_dial_after = null, next_preferred_slot = null, updated_at = now()
   where l.id = q.lead_id and l.tenant_id = p_tenant_id and l.lead_state = 'nurture';

  update public.lead_queue set status = 'unclaimed', queued_at = now(), sla_warned_at = null,
    sla_escalated_at = null, sla_partner_notified_at = null, sla_expired_at = null, sla_cycle = sla_cycle + 1, updated_at = now()
    where id = q.id returning * into q;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
    values ('tenant', p_actor, 'tenant.lead_sla_reopened', 'lead_queue', q.id::text, jsonb_build_object('leadId', q.lead_id));
  return jsonb_build_object('id', q.id, 'status', q.status, 'queued_at', q.queued_at, 'duplicate', false);
end;
$function$;

do $$
declare v_src text;
begin
  if (select count(*) from pg_constraint where conrelid = 'public.tenant_lead_sla_events'::regclass
       and conname = 'tenant_lead_sla_events_work_item_id_rung_key') <> 0 then
    raise exception 'the old per-work-item SLA key is still there';
  end if;
  select prosrc into v_src from pg_proc where oid = 'public.run_unclaimed_sla(timestamptz,integer)'::regprocedure;
  if v_src not like '%p_now, item.sla_cycle)%' or v_src like '%work_item_id_rung_key%' then
    raise exception 'run_unclaimed_sla does not write the cycle';
  end if;
  select prosrc into v_src from pg_proc where oid = 'public.run_unclaimed_sla_side_effects(timestamptz,integer,text)'::regprocedure;
  if v_src not like '%ev.attempts, ev.cycle%' or v_src like '%e.work_item_id::text || '':%' then
    raise exception 'run_unclaimed_sla_side_effects keys are not per cycle';
  end if;
  select prosrc into v_src from pg_proc where oid = 'public.return_transfer_to_queue(uuid,uuid,uuid,text)'::regprocedure;
  if v_src not like '%sla_cycle = sla_cycle + 1%' then raise exception 'return_transfer_to_queue does not start a new cycle'; end if;
  select prosrc into v_src from pg_proc where oid = 'public.reopen_expired_lead(uuid,uuid,uuid)'::regprocedure;
  if v_src not like '%sla_cycle = sla_cycle + 1%' then raise exception 'reopen_expired_lead does not start a new cycle'; end if;
end $$;
