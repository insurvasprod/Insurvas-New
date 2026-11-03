-- ---------------------------------------------------------------------------
-- Unclaimed SLA · the side effects run in the database every minute (LA-1.23-1/6/7, W5.3-W5.5)
--
-- Apply 20260925709900 first (it adds the columns this uses and skips the day-old backlog).
--
-- Until now the ladder rungs fired on time (pg_cron, 20260924250100) and nobody was told: the
-- alerts, the partner's notice and the nurture lead were app-side (lib/queueSla/service.ts), and
-- nothing hosts the app job. User decision (2026-09-25): run them from pg_cron every minute, and
-- keep only the email with the app.
--
--   run_unclaimed_sla_side_effects(now, limit, source)  jsonb, what it did
--     1. advances the ladder (run_unclaimed_sla, idempotent) so a rung and what it causes land in
--        the same minute. The ladder's own job keeps running too, and the two skip each other's rows.
--     2. takes each unprocessed tenant_lead_sla_events row (not leased by the app in the last ten
--        minutes), each in its own subtransaction, and marks it processed with what it did:
--          older than 24 hours   skipped, nothing sent (the same rule as 20260925709900)
--          warn                  nothing to send, the floor shows it
--          escalate              still unclaimed: "Unclaimed lead needs attention" to every active
--                                owner (source unclaimed-sla:<item>:escalated), "Still unclaimed"
--                                to producers and assistants (…:offered), and the escalation email
--                                marked owed (email_due_at) for the app job to send
--          partner               still unclaimed: the partner's notice in their channel (Design 1's
--                                shape, card_type null, event_key unclaimed-sla:<item>:partner,
--                                only when the partner has an active channel) plus their bell, and
--                                the agency's "Nobody claimed" alert to every active owner
--                                (…:nobody-claimed). Nobody-claimed never goes to the partner.
--          expire                nurture_expired_transfer (20260924230400): the lead becomes a
--                                nurture lead. It asks for a dialer item where the plan dials, but
--                                lead_queue is UNIQUE(lead_id) live, so that item is refused and
--                                the lead is marked nurture without one (recorded in outcome)
--        An escalation or partner notice for a transfer claimed or expired since is recorded as
--        skipped (no_longer_unclaimed), not sent. A row that fails keeps last_error and is tried
--        again next minute, and after five failures it is given up (gave_up_after_failures).
--     3. refreshes the daily digest (tenant_sla_daily_digests): escalated and expired per partner,
--        per day in the agency's own timezone, today so far and yesterday closed. /app/alerts shows it.
--     4. writes one heartbeat row (unclaimed_sla_job_runs) with the report, ok or not, when pg_cron
--        ran it (source 'database', the default). A run that fails as a whole still writes its row,
--        with the error. /app/alerts and the app's heartbeat read it, so "running" means pg_cron is
--        running. The app job calls this with source 'app' and records its own row instead, so a
--        manual `npm run sla:run` can never make a stopped schedule look alive. Rows older than
--        seven days are trimmed on each run.
--
-- Every insert is keyed (agent_notifications on tenant + recipient + source_key, partner_messages on
-- event_key, partner_notifications on tenant + recipient + source_key) and every event is marked
-- processed in the same transaction, so a run repeated, overlapping or retried sends nothing twice.
--
-- Reviewed against the live catalog on 2026-09-29: none of the objects below existed, so nothing
-- live is replaced. Their dependencies were read live and match: run_unclaimed_sla (20260924250100,
-- quiet expiry), nurture_expired_transfer(uuid, uuid, boolean) (20260924230400), the unique keys on
-- agent_notifications / partner_notifications (tenant_id, recipient_user_id, source_key) and
-- partner_messages (event_key where not null), lead_queue UNIQUE(lead_id), pg_cron 1.6.4.
--
-- To stop it:   select cron.unschedule('unclaimed-sla-side-effects')
-- ---------------------------------------------------------------------------

do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then return; end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tenant_lead_sla_events' and column_name = 'skipped_reason') then
    raise exception 'tenant_lead_sla_events.skipped_reason does not exist; apply 20260925709900 before this file';
  end if;
  if to_regprocedure('public.nurture_expired_transfer(uuid, uuid, boolean)') is null then
    raise exception 'nurture_expired_transfer does not exist; apply 20260924230400 before this file';
  end if;
end $$;

-- ── the heartbeat ──────────────────────────────────────────────────────────
create table if not exists public.unclaimed_sla_job_runs (
  id bigint generated always as identity primary key,
  source text not null check (source in ('database', 'app')),
  started_at timestamptz not null,
  finished_at timestamptz,
  ok boolean not null,
  report jsonb not null default '{}'::jsonb,
  error text check (error is null or char_length(error) <= 2000)
);

create index if not exists unclaimed_sla_job_runs_started_idx
  on public.unclaimed_sla_job_runs (started_at desc);

alter table public.unclaimed_sla_job_runs enable row level security;
revoke all on public.unclaimed_sla_job_runs from anon, authenticated, public, tenant_app;
grant select, insert, delete on public.unclaimed_sla_job_runs to service_role;

-- ── the daily digest ───────────────────────────────────────────────────────
create table if not exists public.tenant_sla_daily_digests (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  digest_date date not null,
  timezone text not null,
  escalated integer not null default 0 check (escalated >= 0),
  expired integer not null default 0 check (expired >= 0),
  by_partner jsonb not null default '[]'::jsonb,
  closed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, digest_date)
);

alter table public.tenant_sla_daily_digests enable row level security;
drop policy if exists tenant_sla_daily_digests_scoped on public.tenant_sla_daily_digests;
create policy tenant_sla_daily_digests_scoped on public.tenant_sla_daily_digests
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.tenant_sla_daily_digests from anon, authenticated, public;
grant select on public.tenant_sla_daily_digests to tenant_app;
grant select on public.tenant_sla_daily_digests to service_role;

create or replace function public.refresh_unclaimed_sla_daily_digests(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  t record;
  v_tz text;
  v_day date;
  v_back integer;
  v_start timestamptz;
  v_end timestamptz;
  v_rows jsonb;
  v_escalated integer;
  v_expired integer;
  v_count integer := 0;
begin
  for t in
    select distinct ev.tenant_id
      from public.tenant_lead_sla_events ev
     where ev.rung in ('escalate', 'expire')
       and ev.occurred_at >= p_now - interval '50 hours'
  loop
    select nullif(btrim(ap.timezone), '') into v_tz from public.agency_profiles ap where ap.tenant_id = t.tenant_id;
    begin
      perform p_now at time zone coalesce(v_tz, 'UTC');
    exception when others then
      v_tz := null;
    end;
    v_tz := coalesce(v_tz, 'UTC');

    for v_back in 0..1 loop
      v_day := (p_now at time zone v_tz)::date - v_back;
      -- A closed day does not change.
      if exists (select 1 from public.tenant_sla_daily_digests dd
                  where dd.tenant_id = t.tenant_id and dd.digest_date = v_day and dd.closed) then
        continue;
      end if;
      v_start := v_day::timestamp at time zone v_tz;
      v_end := (v_day + 1)::timestamp at time zone v_tz;
      select coalesce(jsonb_agg(jsonb_build_object('partnerId', x.partner_id, 'partnerName', x.partner_name,
                                                   'escalated', x.escalated, 'expired', x.expired)
                                order by x.escalated + x.expired desc, x.partner_name), '[]'::jsonb),
             coalesce(sum(x.escalated), 0)::integer,
             coalesce(sum(x.expired), 0)::integer
        into v_rows, v_escalated, v_expired
        from (
          select ev.partner_id, coalesce(p.name, 'No partner') as partner_name,
                 count(*) filter (where ev.rung = 'escalate')::integer as escalated,
                 count(*) filter (where ev.rung = 'expire')::integer as expired
            from public.tenant_lead_sla_events ev
            left join public.partners p on p.id = ev.partner_id
           where ev.tenant_id = t.tenant_id
             and ev.rung in ('escalate', 'expire')
             and ev.occurred_at >= v_start and ev.occurred_at < v_end
           group by ev.partner_id, p.name
        ) x;
      if v_escalated + v_expired = 0
         and not exists (select 1 from public.tenant_sla_daily_digests dd where dd.tenant_id = t.tenant_id and dd.digest_date = v_day) then
        continue;
      end if;
      -- A day closes ten minutes after its midnight, so a rung the ladder's own job fired in the
      -- day's last minute (committed after this read) is still counted in it.
      insert into public.tenant_sla_daily_digests
        (tenant_id, digest_date, timezone, escalated, expired, by_partner, closed, updated_at)
      values
        (t.tenant_id, v_day, v_tz, v_escalated, v_expired, v_rows, p_now >= v_end + interval '10 minutes', p_now)
      on conflict (tenant_id, digest_date) do update
        set timezone = excluded.timezone, escalated = excluded.escalated, expired = excluded.expired,
            by_partner = excluded.by_partner, closed = excluded.closed, updated_at = excluded.updated_at;
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end;
$function$;

revoke all on function public.refresh_unclaimed_sla_daily_digests(timestamptz) from public, anon, authenticated, tenant_app;
grant execute on function public.refresh_unclaimed_sla_daily_digests(timestamptz) to service_role;

-- ── the side effects ───────────────────────────────────────────────────────
-- An earlier draft had no source argument. It was never applied live, and dropping it keeps a re-run
-- of this file from leaving two overloads.
drop function if exists public.run_unclaimed_sla_side_effects(timestamptz, integer);

create or replace function public.run_unclaimed_sla_side_effects(
  p_now timestamptz default now(), p_limit integer default 500, p_source text default 'database')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
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
      select ev.id, ev.tenant_id, ev.work_item_id, ev.lead_id, ev.partner_id, ev.rung, ev.occurred_at, ev.attempts
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
                 'unclaimed-sla:' || e.work_item_id::text || ':escalated'
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
                 'unclaimed-sla:' || e.work_item_id::text || ':offered'
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
                 'unclaimed-sla:' || e.work_item_id::text || ':partner', null)
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
                   'unclaimed-sla:' || e.work_item_id::text || ':nobody-claimed'
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

revoke all on function public.run_unclaimed_sla_side_effects(timestamptz, integer, text) from public, anon, authenticated, tenant_app;
grant execute on function public.run_unclaimed_sla_side_effects(timestamptz, integer, text) to service_role;

-- ── the schedule ───────────────────────────────────────────────────────────
-- cron.schedule under an existing job name (same user) replaces that job's schedule and command,
-- so re-running this file leaves exactly one job of each name.
do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709910: not scheduled, % cannot create in public', current_user;
    return;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception '20260925709910: pg_cron is not installed; apply 20260924250100 first';
  end if;
  perform cron.schedule('unclaimed-sla-side-effects', '* * * * *',
    $cron$select public.run_unclaimed_sla_side_effects(now(), 500, 'database')$cron$);
  perform cron.schedule('unclaimed-sla-side-effects-log-cleanup', '29 3 * * *',
    $cron$delete from cron.job_run_details
           where jobid in (select jobid from cron.job where jobname = 'unclaimed-sla-side-effects')
             and end_time < now() - interval '7 days'$cron$);
end $$;

-- ── check: the objects, then one run on the real rows plus built events, all rolled back ─────
do $$
declare
  v_q public.lead_queue;
  v_q2 public.lead_queue;
  v_channel uuid;
  v_esc uuid;
  v_par uuid;
  v_old uuid;
  v_late uuid;
  v_report jsonb;
  v_owners integer;
  v_owner_email boolean;
  v_runs_before bigint;
  v_again jsonb;
  v_counts text;
  v_counts_again text;
  v_err text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709910: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  -- the objects
  if to_regprocedure('public.run_unclaimed_sla_side_effects(timestamptz, integer, text)') is null
     or to_regprocedure('public.refresh_unclaimed_sla_daily_digests(timestamptz)') is null
     or to_regclass('public.unclaimed_sla_job_runs') is null
     or to_regclass('public.tenant_sla_daily_digests') is null then
    raise exception '20260925709910 check failed: a function or table is missing';
  end if;
  if to_regprocedure('public.run_unclaimed_sla_side_effects(timestamptz, integer)') is not null then
    raise exception '20260925709910 check failed: the two-argument draft of run_unclaimed_sla_side_effects is still there';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname in ('run_unclaimed_sla_side_effects', 'refresh_unclaimed_sla_daily_digests')
                and (not p.prosecdef or not coalesce(p.proconfig::text like '%search_path=public, pg_catalog%', false))) then
    raise exception '20260925709910 check failed: a function is not security definer with a pinned search_path';
  end if;
  if has_function_privilege('tenant_app', 'public.run_unclaimed_sla_side_effects(timestamptz, integer, text)', 'EXECUTE')
     or has_function_privilege('tenant_app', 'public.refresh_unclaimed_sla_daily_digests(timestamptz)', 'EXECUTE') then
    raise exception '20260925709910 check failed: tenant_app can execute a side-effect function';
  end if;
  if (select count(*) from cron.job where jobname = 'unclaimed-sla-side-effects' and schedule = '* * * * *' and active
        and command like '%run_unclaimed_sla_side_effects(now(), 500, ''database'')%') <> 1 then
    raise exception '20260925709910 check failed: the unclaimed-SLA side-effect job is not scheduled exactly once';
  end if;

  begin
    -- A transfer whose tenant has an active owner and whose partner has an active channel, on a
    -- ladder long enough that the embedded ladder run cannot expire it first.
    select q.* into v_q
      from public.lead_queue q
      left join public.tenant_queue_sla_settings s on s.tenant_id = q.tenant_id
     where q.partner_id is not null
       and q.status in ('completed', 'dropped', 'expired', 'closed')
       and coalesce(s.expire_after_seconds, 14400) > 900
       and exists (select 1 from public.partner_channels c where c.tenant_id = q.tenant_id and c.partner_id = q.partner_id
                     and c.channel_type = 'partner' and c.status = 'active')
       and exists (select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id
                    where tu.tenant_id = q.tenant_id and tu.role::text = 'owner' and tu.accepted_at is not null and u.status::text = 'active')
       and not exists (select 1 from public.lead_queue o where o.lead_id = q.lead_id and o.id <> q.id
                         and o.status in ('unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active'))
     order by q.queued_at desc
     limit 1;
    if v_q.id is null then raise exception 'SKIP no transfer to build the check on'; end if;
    -- A second transfer that is no longer unclaimed: its late escalation must be recorded, not sent.
    select q.* into v_q2
      from public.lead_queue q
     where q.partner_id is not null and q.id <> v_q.id
       and q.status in ('completed', 'dropped', 'closed')
     order by q.queued_at desc
     limit 1;
    if v_q2.id is null then raise exception 'SKIP no second transfer to build the check on'; end if;

    select count(*), bool_or(nullif(btrim(u.email), '') is not null) into v_owners, v_owner_email
      from public.tenant_users tu join public.users u on u.id = tu.user_id
     where tu.tenant_id = v_q.tenant_id and tu.role::text = 'owner' and tu.accepted_at is not null and u.status::text = 'active';

    delete from public.tenant_lead_sla_events where work_item_id in (v_q.id, v_q2.id);
    delete from public.agent_notifications where tenant_id in (v_q.tenant_id, v_q2.tenant_id)
       and (source_key like 'unclaimed-sla:' || v_q.id::text || ':%' or source_key like 'unclaimed-sla:' || v_q2.id::text || ':%');
    delete from public.partner_messages where event_key = 'unclaimed-sla:' || v_q.id::text || ':partner';
    update public.lead_queue
       set status = 'unclaimed', queued_at = now() - interval '6 minutes', claimed_by = null, claimed_at = null,
           sla_warned_at = now(), sla_escalated_at = now(), sla_partner_notified_at = now(), sla_expired_at = null
     where id = v_q.id;
    insert into public.tenant_lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at)
    values (v_q.tenant_id, v_q.id, v_q.lead_id, v_q.partner_id, 'escalate', now()) returning id into v_esc;
    insert into public.tenant_lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at)
    values (v_q.tenant_id, v_q.id, v_q.lead_id, v_q.partner_id, 'partner', now()) returning id into v_par;
    insert into public.tenant_lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at)
    values (v_q.tenant_id, v_q.id, v_q.lead_id, v_q.partner_id, 'warn', now() - interval '25 hours') returning id into v_old;
    insert into public.tenant_lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at)
    values (v_q2.tenant_id, v_q2.id, v_q2.lead_id, v_q2.partner_id, 'escalate', now()) returning id into v_late;

    -- The app's call: does the work, writes no heartbeat (only pg_cron's run is the heartbeat).
    select count(*) into v_runs_before from public.unclaimed_sla_job_runs where source = 'database';
    v_report := public.run_unclaimed_sla_side_effects(now(), 1000, 'app');
    raise notice '20260925709910: check run report %', v_report;
    if v_report ? 'error' then
      raise exception 'CHECK the run failed as a whole: %', v_report->>'error';
    end if;
    if v_report->'ladder'->>'error' is not null or v_report->'digest'->>'error' is not null then
      raise exception 'CHECK the ladder or the digest failed: % / %', v_report->'ladder'->>'error', v_report->'digest'->>'error';
    end if;
    if exists (select 1 from public.tenant_lead_sla_events where id in (v_esc, v_par, v_old, v_late) and processed_at is null) then
      select last_error into v_err from public.tenant_lead_sla_events
       where id in (v_esc, v_par, v_old, v_late) and last_error is not null limit 1;
      if v_err is not null then raise exception 'CHECK a built event failed: %', v_err; end if;
      raise exception 'SKIP the built events were not reached in one run (more than 1000 pending)';
    end if;
    if coalesce((v_report->>'failed')::integer, 0) > 0 then
      -- A real row failing is reported, not fatal: it keeps last_error and is retried every minute.
      raise notice '20260925709910: % real event(s) failed in the check run, first: %', v_report->>'failed', v_report->'failures'->0;
    end if;
    if (select count(*) from public.unclaimed_sla_job_runs where source = 'database') <> v_runs_before then
      raise exception 'CHECK an app-invoked run wrote the pg_cron heartbeat';
    end if;

    -- escalation: every active owner, the wider offer, the email owed when an owner has an address
    if (select count(*) from public.agent_notifications where tenant_id = v_q.tenant_id
         and source_key = 'unclaimed-sla:' || v_q.id::text || ':escalated') <> v_owners then
      raise exception 'CHECK the escalation alert did not reach every active owner';
    end if;
    if exists (select 1 from public.agent_notifications n
                join public.tenant_users tu on tu.tenant_id = n.tenant_id and tu.user_id = n.recipient_user_id
               where n.tenant_id = v_q.tenant_id and n.source_key = 'unclaimed-sla:' || v_q.id::text || ':escalated'
                 and tu.role::text <> 'owner') then
      raise exception 'CHECK the escalation alert reached someone who is not an owner';
    end if;
    if not exists (select 1 from public.tenant_lead_sla_events where id = v_esc and handled_by = 'database'
                    and skipped_reason is null and (outcome->>'ownerAlerts')::integer = v_owners) then
      raise exception 'CHECK the escalation event was not recorded as handled by the database with its owner alerts';
    end if;
    if (select email_due_at is not null from public.tenant_lead_sla_events where id = v_esc) is distinct from coalesce(v_owner_email, false) then
      raise exception 'CHECK the escalation email was not marked owed exactly when an owner has an address';
    end if;

    -- partner notice: one row, Design 1's shape, in the active partner channel
    select c.id into v_channel from public.partner_channels c where c.tenant_id = v_q.tenant_id and c.partner_id = v_q.partner_id
       and c.channel_type = 'partner' and c.status = 'active' order by c.created_at limit 1;
    if (select count(*) from public.partner_messages m
         where m.event_key = 'unclaimed-sla:' || v_q.id::text || ':partner'
           and m.channel_id = v_channel and m.message_kind = 'system_card' and m.card_type is null
           and m.card_payload->>'notice' = 'unclaimed_partner_notice' and m.created_by is null
           and m.message like '% was not claimed before the response window. Our team has been notified.') <> 1 then
      raise exception 'CHECK the partner notice is missing or not in the agreed shape';
    end if;
    -- nobody claimed: owners only, never the partner's channel
    if (select count(*) from public.agent_notifications where tenant_id = v_q.tenant_id
         and source_key = 'unclaimed-sla:' || v_q.id::text || ':nobody-claimed') <> v_owners then
      raise exception 'CHECK the nobody-claimed alert did not reach every active owner';
    end if;
    if exists (select 1 from public.partner_messages m where m.work_item_id = v_q.id and m.card_type = 'nobody_claimed'
                and m.created_at >= now()) then
      raise exception 'CHECK a nobody_claimed card was posted to the partner';
    end if;

    -- older than a day: recorded, not sent
    if not exists (select 1 from public.tenant_lead_sla_events where id = v_old
                    and handled_by = 'skipped' and skipped_reason = 'older_than_24_hours' and processed_at is not null) then
      raise exception 'CHECK a day-old event was not skipped';
    end if;
    -- no longer unclaimed: recorded, not sent
    if not exists (select 1 from public.tenant_lead_sla_events where id = v_late
                    and handled_by = 'database' and skipped_reason = 'no_longer_unclaimed' and processed_at is not null)
       or exists (select 1 from public.agent_notifications where tenant_id = v_q2.tenant_id
                   and source_key like 'unclaimed-sla:' || v_q2.id::text || ':%') then
      raise exception 'CHECK a late escalation for a transfer no longer unclaimed was sent or not recorded';
    end if;

    -- the digest: an open row (today, in the agency's own day) counts the built escalation
    if not exists (select 1 from public.tenant_sla_daily_digests d
                    where d.tenant_id = v_q.tenant_id and d.escalated >= 1 and not d.closed
                      and d.digest_date between (now() at time zone 'UTC')::date - 1 and (now() at time zone 'UTC')::date + 1) then
      raise exception 'CHECK the daily digest has no open row counting the escalation';
    end if;

    -- pg_cron's call: writes the heartbeat, and sends nothing a second time
    select string_agg(x, ',') into v_counts from (
      select (select count(*) from public.agent_notifications where tenant_id = v_q.tenant_id and source_key like 'unclaimed-sla:' || v_q.id::text || ':%')::text as x
      union all select (select count(*) from public.partner_messages where event_key = 'unclaimed-sla:' || v_q.id::text || ':partner')::text
      union all select (select count(*) from public.partner_notifications where source_key like 'partner-system-card:%' and created_at >= now())::text) c;
    v_again := public.run_unclaimed_sla_side_effects(now(), 1000);
    select string_agg(x, ',') into v_counts_again from (
      select (select count(*) from public.agent_notifications where tenant_id = v_q.tenant_id and source_key like 'unclaimed-sla:' || v_q.id::text || ':%')::text as x
      union all select (select count(*) from public.partner_messages where event_key = 'unclaimed-sla:' || v_q.id::text || ':partner')::text
      union all select (select count(*) from public.partner_notifications where source_key like 'partner-system-card:%' and created_at >= now())::text) c;
    if v_counts <> v_counts_again then
      raise exception 'CHECK a second run sent again (% then %)', v_counts, v_counts_again;
    end if;
    if not exists (select 1 from public.unclaimed_sla_job_runs where source = 'database' and started_at >= now()) then
      raise exception 'CHECK the pg_cron-style run wrote no heartbeat';
    end if;

    raise exception 'ROLLBACK_OK';
  exception when others then
    if sqlerrm = 'ROLLBACK_OK' then
      raise notice '20260925709910: ran on the real rows and built events, then rolled back. Escalation to owners, email owed, partner notice, nobody-claimed to owners, day-old and no-longer-unclaimed recorded not sent, digest, heartbeat only from pg_cron, no repeat.';
    elsif sqlerrm like 'SKIP%' then
      raise notice '20260925709910: behaviour check skipped (%)', sqlerrm;
    else
      raise exception '20260925709910 check failed: %', sqlerrm;
    end if;
  end;
end $$;
