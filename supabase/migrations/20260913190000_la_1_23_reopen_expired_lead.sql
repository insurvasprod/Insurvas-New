-- LA-1.23: create reopen_expired_lead. This repository declares it; the database does not have it.
--
-- 20260903000000 declares public.reopen_expired_lead(p_tenant_id uuid, p_work_item_id uuid,
-- p_actor uuid). The live database has only
--
--     public.reopen_expired_lead(target_lead_id uuid)
--
-- which is the organizations-era CRM's function -- a different signature, a different contract, and
-- not ours. Every other object in that same migration exists, so the file applied; this one function
-- did not survive whatever reconciliation the schema has been through. It is the same defect shape as
-- the missing triggers in 20260913130000 and 20260912470000: the declaration reads as applied, and
-- nothing reports that it is not there.
--
-- It is worth naming what makes this variant quieter than the table collisions. A missing table
-- raises 42P01 the first time anything touches it. A missing function OVERLOAD does not: the name
-- resolves, to the CRM's one-argument version, and PostgREST answers
--
--     Could not find the function public.reopen_expired_lead(p_actor, p_tenant_id, p_work_item_id)
--                                  in the schema cache
--
-- which reads like a stale cache rather than an absent function. That is a misleading error, and it
-- is the reason this was worth checking in pg_proc rather than retrying the request.
--
-- Creating ours adds an overload; the CRM's one-argument function is untouched and still resolves for
-- its own callers. Nothing outside this repository changes.

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
  -- Ours must exist, by exact signature. Asserting on the name alone would pass on the CRM's.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reopen_expired_lead'
      and pg_get_function_identity_arguments(p.oid) = 'p_tenant_id uuid, p_work_item_id uuid, p_actor uuid'
  ) then
    raise exception 'the three-argument reopen_expired_lead was not created';
  end if;

  -- And the CRM's overload must still be there. This migration adds; it does not replace.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reopen_expired_lead'
      and pg_get_function_identity_arguments(p.oid) = 'target_lead_id uuid'
  ) then
    raise exception 'the CRM one-argument reopen_expired_lead was removed -- out of scope for this repository';
  end if;
end;
$$;
