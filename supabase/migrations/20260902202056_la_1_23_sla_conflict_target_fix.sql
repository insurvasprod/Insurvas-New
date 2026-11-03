-- LA-1.23: disambiguate the SLA event idempotency target from the function's
-- RETURNS TABLE output variables. PostgreSQL exposes work_item_id and rung as
-- PL/pgSQL variables inside this function, so a column-list conflict target is
-- ambiguous at runtime. The named unique constraint is the same invariant and
-- remains safe under concurrent scheduler runs.

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
      insert into public.lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at)
      values (item.tenant_id, item.id, item.lead_id, item.partner_id, 'warn', p_now)
      on conflict on constraint lead_sla_events_work_item_id_rung_key do nothing returning id into v_id;
      insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
      values ('system', 'tenant.lead_sla_warned', 'lead_queue', item.id::text, jsonb_build_object('ageSeconds', v_age, 'thresholdSeconds', v_warn));
      if v_id is not null then return query select v_id, item.tenant_id, item.id, item.lead_id, item.partner_id, 'warn'::text, p_now; end if;
    end if;
    if v_age >= v_escalate and item.sla_escalated_at is null then
      update public.lead_queue set sla_escalated_at = p_now where id = item.id and status = 'unclaimed';
      v_id := null;
      insert into public.lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at)
      values (item.tenant_id, item.id, item.lead_id, item.partner_id, 'escalate', p_now)
      on conflict on constraint lead_sla_events_work_item_id_rung_key do nothing returning id into v_id;
      insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
      values ('system', 'tenant.lead_sla_escalated', 'lead_queue', item.id::text, jsonb_build_object('ageSeconds', v_age, 'thresholdSeconds', v_escalate));
      if v_id is not null then return query select v_id, item.tenant_id, item.id, item.lead_id, item.partner_id, 'escalate'::text, p_now; end if;
    end if;
    if v_age >= v_partner and item.sla_partner_notified_at is null then
      update public.lead_queue set sla_partner_notified_at = p_now where id = item.id and status = 'unclaimed';
      v_id := null;
      insert into public.lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at)
      values (item.tenant_id, item.id, item.lead_id, item.partner_id, 'partner', p_now)
      on conflict on constraint lead_sla_events_work_item_id_rung_key do nothing returning id into v_id;
      insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
      values ('system', 'tenant.lead_sla_partner_notified', 'lead_queue', item.id::text, jsonb_build_object('ageSeconds', v_age, 'thresholdSeconds', v_partner));
      if v_id is not null then return query select v_id, item.tenant_id, item.id, item.lead_id, item.partner_id, 'partner'::text, p_now; end if;
    end if;
    if v_age >= v_expire and item.sla_expired_at is null then
      update public.lead_queue set status = 'expired', sla_expired_at = p_now where id = item.id and status = 'unclaimed';
      if found then
        v_id := null;
        insert into public.lead_sla_events (tenant_id, work_item_id, lead_id, partner_id, rung, occurred_at)
        values (item.tenant_id, item.id, item.lead_id, item.partner_id, 'expire', p_now)
        on conflict on constraint lead_sla_events_work_item_id_rung_key do nothing returning id into v_id;
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
