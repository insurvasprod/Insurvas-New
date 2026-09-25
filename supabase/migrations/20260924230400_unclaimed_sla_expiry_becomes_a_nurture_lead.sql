-- ---------------------------------------------------------------------------
-- Settings · Queue & SLA — "It leaves the active queue and becomes a nurture lead"
--
-- The expire rung (`run_unclaimed_sla`, 20260924150000 — owned by other work and NOT redefined
-- here) sets the inbound transfer's work item to 'expired'. That took it out of the active queue,
-- and there it stopped: the lead was a paid-for lead that nobody would ever call.
--
-- `nurture_expired_transfer` is what the SLA job's expire side effect now calls
-- (lib/queueSla/service.ts), once per expire event:
--
--   1. the lead becomes a nurture lead — `lead_state = 'nurture'`, due now;
--   2. when the agency dials (p_queue), it gets a DIALER work item (no partner, so the inbox and
--      the SLA ladder never see it) that the serving query picks up in its nurture tier, inside the
--      legal window and past suppression like every other lead;
--   3. the expired transfer stays exactly as it was, so the partner's pipeline row and the SLA
--      history still say nobody claimed it.
--
-- The dialer work item records which transfer it came from (`nurtured_from_work_item_id`), and
-- `reopen_expired_lead` closes it before reopening the transfer — otherwise the one-open-work-item
-- index would refuse the reopen. A nurture call already in progress refuses the reopen instead
-- (LEAD_BEING_DIALLED): two agents must not hold the same person.
--
-- Idempotent: a second call for the same transfer finds the nurture work item and does nothing.
-- ---------------------------------------------------------------------------

alter table public.lead_queue
  add column if not exists nurtured_from_work_item_id uuid references public.lead_queue(id) on delete set null;

create index if not exists lead_queue_nurtured_from_idx
  on public.lead_queue (nurtured_from_work_item_id)
  where nurtured_from_work_item_id is not null;

create or replace function public.nurture_expired_transfer(
  p_tenant_id uuid,
  p_work_item_id uuid,
  p_queue boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  q public.lead_queue;
  v_lead record;
  v_existing uuid;
  v_new uuid;
begin
  select * into q from public.lead_queue where id = p_work_item_id and tenant_id = p_tenant_id for update;
  if not found then
    return jsonb_build_object('nurtured', false, 'reason', 'not_found');
  end if;
  if q.status <> 'expired' or q.partner_id is null or q.sla_expired_at is null then
    -- Reopened, claimed or never an inbound transfer: the ladder's expiry no longer applies.
    return jsonb_build_object('nurtured', false, 'reason', 'not_an_expired_transfer');
  end if;

  select id into v_existing from public.lead_queue
   where tenant_id = p_tenant_id and nurtured_from_work_item_id = q.id
   limit 1;
  if v_existing is not null then
    return jsonb_build_object('nurtured', true, 'workItemId', v_existing, 'duplicate', true);
  end if;

  select l.id, l.lead_state into v_lead from public.agent_leads l
   where l.id = q.lead_id and l.tenant_id = p_tenant_id for update;
  if not found then
    return jsonb_build_object('nurtured', false, 'reason', 'lead_missing');
  end if;
  -- A lead that is closed, exhausted or being worked is not the ladder's to move.
  if v_lead.lead_state in ('closed', 'exhausted', 'working') then
    return jsonb_build_object('nurtured', false, 'reason', 'lead_' || v_lead.lead_state);
  end if;

  update public.agent_leads
     set lead_state = 'nurture', next_dial_after = now(), next_preferred_slot = null, updated_at = now()
   where id = q.lead_id and tenant_id = p_tenant_id;

  if coalesce(p_queue, true) and not exists (
    select 1 from public.lead_queue other
     where other.lead_id = q.lead_id and other.status in ('unclaimed', 'claimed')
  ) then
    insert into public.lead_queue
      (tenant_id, lead_id, product_line, pipeline_id, stage_id, stage_key, status, tier, nurtured_from_work_item_id)
    values
      (p_tenant_id, q.lead_id, q.product_line, q.pipeline_id, q.stage_id, q.stage_key, 'unclaimed', 100, q.id)
    returning id into v_new;
  end if;

  insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
  values ('system', 'tenant.lead_sla_nurtured', 'lead_queue', q.id::text,
          jsonb_build_object('leadId', q.lead_id, 'dialerWorkItemId', v_new, 'queued', v_new is not null));

  return jsonb_build_object('nurtured', true, 'workItemId', v_new, 'queued', v_new is not null);
end;
$function$;

revoke all on function public.nurture_expired_transfer(uuid, uuid, boolean) from public, anon, authenticated, tenant_app;
grant execute on function public.nurture_expired_transfer(uuid, uuid, boolean) to service_role;

-- ── reopening an expired transfer takes the lead back out of nurture ───────
--
-- 20260913190000's body, with the nurture work item closed first. Signature unchanged.
create or replace function public.reopen_expired_lead(p_tenant_id uuid, p_work_item_id uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
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
    sla_escalated_at = null, sla_partner_notified_at = null, sla_expired_at = null, updated_at = now()
    where id = q.id returning * into q;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
    values ('tenant', p_actor, 'tenant.lead_sla_reopened', 'lead_queue', q.id::text, jsonb_build_object('leadId', q.lead_id));
  return jsonb_build_object('id', q.id, 'status', q.status, 'queued_at', q.queued_at, 'duplicate', false);
end;
$$;

revoke all on function public.reopen_expired_lead(uuid, uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.reopen_expired_lead(uuid, uuid, uuid) to service_role;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'reopen_expired_lead'
       and pg_get_function_identity_arguments(p.oid) = 'p_tenant_id uuid, p_work_item_id uuid, p_actor uuid'
       and p.prosrc like '%nurtured_from_work_item_id%'
  ) then
    raise exception 'reopen_expired_lead does not close the nurture work item first';
  end if;
  -- The ladder itself is 20260924150000's and is not touched here.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'run_unclaimed_sla' and p.prosrc like '%q.partner_id is not null%'
  ) then
    raise exception 'run_unclaimed_sla lost its inbound-only predicate';
  end if;
end $$;
