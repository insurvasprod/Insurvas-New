-- LA-8 audit (Notion sprint, Module 8 — Settings) · fixes found by the module audit, 2026-10-15.
-- Every function restated here was taken from its LIVE definition (pg_get_functiondef, read-only,
-- 2026-10-15; each matched its migration file) and changed only where marked [audit].
--
--   LA-8.6 · deactivating a member hands their open work to someone who can WORK it. Before, any
--     active member was accepted — a bookkeeper or a setter could be handed claimed leads, callbacks,
--     appointments and reinstatement cases they cannot open. Now, per kind of work:
--       claimed leads, callbacks, appointments, reinstatement cases, servicing requests → owner or
--         producer (the roles their screens and routes accept);
--       exception-queue items by the item's own role: writing_agent / retention → owner or producer,
--         operations → owner or bookkeeper, admin → owner (LA-4.9's queue_owner mapping).
--     A taker who cannot work some of it is refused with the kinds named
--     (reassign_target_cannot_work:<kind>,…), and nothing moves.
--   LA-8.6 · servicing requests were counted as open work but never handed over: the requester is
--     fixed for good (LA-5.4's guard) and a failed fix alerted only them — a deactivated person.
--     New servicing_request.assigned_to = who follows the request up now (null: who asked). The
--     handover sets it; open work counts coalesce(assigned_to, requested_by); the verifier's
--     "a fix did not take" alert goes to that person. requested_by is untouched.
--   LA-8.6 · reactivation's setter-seat check: NOT changed. tenant_reactivate_member goes through
--     admin_set_user_status → assert_user_seat_transition, which (live) already refuses a setter
--     past max_setter_seats and an assistant past max_buffer_seats, as well as the seat limit.
--   LA-8.7 · a paused webhook no longer collects events: enqueue_webhook_event queues only for
--     active and failing subscriptions. Events that happen while paused are not sent on resume
--     (a consumer that paused us is not flooded with stale events when it comes back).
--   LA-8.7 · one rotation per key: a unique index on api_key.rotated_from among live keys, so two
--     rotations racing mint one key; the app maps the conflict to "already rotated".
--
-- Requires 20261014200000, 20261015100000, 20261015340000 and 20261015350000 (all live).
-- Rollback: restate tenant_member_open_work and tenant_deactivate_member from 20261015350000,
--   enqueue_webhook_event from 20261015340000 and verify_servicing_requests from 20261015100000; then
--   drop index if exists public.api_key_one_rotation;
--   alter table public.servicing_request drop column if exists assigned_to;

set local lock_timeout = '5s';

-- ─── servicing requests: who follows one up now ──────────────────────────────────────────────────
alter table public.servicing_request add column if not exists assigned_to uuid references public.users(id) on delete set null;
create index if not exists servicing_request_assigned_idx on public.servicing_request (assigned_to) where assigned_to is not null;
comment on column public.servicing_request.assigned_to is
  'LA-8 audit · who follows this request up now, when not the person who asked (requested_by, which never changes). Set when a member is deactivated and their open work handed over.';

-- ─── open work ───────────────────────────────────────────────────────────────────────────────────
create or replace function public.tenant_member_open_work(p_tenant_id uuid, p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'queue_items', (select count(*) from public.queue_item q where q.tenant_id = p_tenant_id and q.assigned_to_user_id = p_user_id and q.status = 'open'),
    'reinstatement_cases', (select count(*) from public.reinstatement_case r where r.tenant_id = p_tenant_id and r.worked_by = p_user_id and r.status in ('identified', 'contacted', 'client_agreed', 'submitted')),
    'callbacks', (select count(*) from public.tenant_callbacks c where c.tenant_id = p_tenant_id and c.assigned_to = p_user_id and c.status in ('scheduled', 'due')),
    'claimed_leads', (select count(*) from public.lead_queue l where l.tenant_id = p_tenant_id and l.claimed_by = p_user_id and l.status = 'claimed' and l.disposition is null),
    'appointments', (select count(*) from public.tenant_appointments a where a.tenant_id = p_tenant_id and a.agent_user_id = p_user_id and a.status in ('booked', 'confirmed') and a.starts_at_utc > now()),
    -- [audit] whoever follows the request up now: the handover's taker, else who asked
    'servicing_requests', (select count(*) from public.servicing_request s where s.tenant_id = p_tenant_id and coalesce(s.assigned_to, s.requested_by) = p_user_id and s.status in ('draft', 'submitted', 'awaiting_carrier', 'confirmed_by_carrier'))
  );
$$;

revoke all on function public.tenant_member_open_work(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_member_open_work(uuid, uuid) to service_role;

-- ─── deactivate, handing open work to someone who can work it ────────────────────────────────────
create or replace function public.tenant_deactivate_member(p_tenant_id uuid, p_user_id uuid, p_actor uuid, p_reassign_to uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_role text;
  v_status text;
  v_open jsonb;
  v_reassignable integer;
  v_moved jsonb := '{}'::jsonb;
  v_n integer;
  v_target_role text;
  v_cannot text[] := '{}';
begin
  select tu.role::text, u.status into v_role, v_status
    from public.tenant_users tu join public.users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id and tu.user_id = p_user_id and tu.accepted_at is not null
   for update of tu;
  if v_role is null then
    raise exception 'member_not_found' using errcode = 'P0001';
  end if;
  if p_user_id = p_actor then
    raise exception 'cannot_deactivate_self' using errcode = 'P0001';
  end if;
  if v_status not in ('active', 'suspended') then
    raise exception 'not_active' using errcode = 'P0001';
  end if;
  if v_role = 'owner' and not exists (
    select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id
     where tu.tenant_id = p_tenant_id and tu.user_id <> p_user_id and tu.role::text = 'owner' and tu.accepted_at is not null and u.status = 'active'
  ) then
    raise exception 'last_owner' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.tenant_users tu where tu.user_id = p_user_id and tu.tenant_id <> p_tenant_id) then
    raise exception 'member_of_other_workspaces' using errcode = 'P0001';
  end if;

  v_open := public.tenant_member_open_work(p_tenant_id, p_user_id);
  -- [audit] servicing requests are handed over too
  v_reassignable := (v_open->>'queue_items')::int + (v_open->>'reinstatement_cases')::int + (v_open->>'callbacks')::int
                  + (v_open->>'claimed_leads')::int + (v_open->>'appointments')::int + (v_open->>'servicing_requests')::int;

  if v_reassignable > 0 then
    if p_reassign_to is null then
      raise exception 'open_work:%', v_open::text using errcode = 'P0001';
    end if;
    -- [audit] the taker's role, read under the same rule as before (accepted, active)
    select tu.role::text into v_target_role
      from public.tenant_users tu join public.users u on u.id = tu.user_id
     where tu.tenant_id = p_tenant_id and tu.user_id = p_reassign_to and tu.accepted_at is not null and u.status = 'active';
    if p_reassign_to = p_user_id or v_target_role is null then
      raise exception 'reassign_target_invalid' using errcode = 'P0001';
    end if;

    -- [audit] the taker must be able to work every kind of work handed over
    if v_target_role not in ('owner', 'producer') then
      if (v_open->>'claimed_leads')::int > 0 then v_cannot := array_append(v_cannot, 'claimed_leads'); end if;
      if (v_open->>'callbacks')::int > 0 then v_cannot := array_append(v_cannot, 'callbacks'); end if;
      if (v_open->>'appointments')::int > 0 then v_cannot := array_append(v_cannot, 'appointments'); end if;
      if (v_open->>'reinstatement_cases')::int > 0 then v_cannot := array_append(v_cannot, 'reinstatement_cases'); end if;
      if (v_open->>'servicing_requests')::int > 0 then v_cannot := array_append(v_cannot, 'servicing_requests'); end if;
    end if;
    if exists (
      select 1 from public.queue_item q
       where q.tenant_id = p_tenant_id and q.assigned_to_user_id = p_user_id and q.status = 'open'
         and not (case q.assigned_role
                    when 'writing_agent' then v_target_role in ('owner', 'producer')
                    when 'retention' then v_target_role in ('owner', 'producer')
                    when 'operations' then v_target_role in ('owner', 'bookkeeper')
                    else v_target_role = 'owner'
                  end)
    ) then
      v_cannot := array_append(v_cannot, 'queue_items');
    end if;
    if cardinality(v_cannot) > 0 then
      raise exception 'reassign_target_cannot_work:%', array_to_string(v_cannot, ',') using errcode = 'P0001';
    end if;

    update public.queue_item set assigned_to_user_id = p_reassign_to, updated_at = now()
     where tenant_id = p_tenant_id and assigned_to_user_id = p_user_id and status = 'open';
    get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('queue_items', v_n);

    update public.reinstatement_case set worked_by = p_reassign_to
     where tenant_id = p_tenant_id and worked_by = p_user_id and status in ('identified', 'contacted', 'client_agreed', 'submitted');
    get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('reinstatement_cases', v_n);

    update public.lead_queue set claimed_by = p_reassign_to, owner_user_id = p_reassign_to, updated_at = now()
     where tenant_id = p_tenant_id and claimed_by = p_user_id and status = 'claimed' and disposition is null;
    get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('claimed_leads', v_n);

    update public.tenant_callbacks set assigned_to = p_reassign_to, updated_at = now()
     where tenant_id = p_tenant_id and assigned_to = p_user_id and status in ('scheduled', 'due');
    get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('callbacks', v_n);

    update public.tenant_appointments set agent_user_id = p_reassign_to
     where tenant_id = p_tenant_id and agent_user_id = p_user_id and status in ('booked', 'confirmed') and starts_at_utc > now();
    get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('appointments', v_n);

    -- [audit] who follows the request up now; who asked (requested_by) stays as it was
    update public.servicing_request set assigned_to = p_reassign_to
     where tenant_id = p_tenant_id and coalesce(assigned_to, requested_by) = p_user_id and status in ('draft', 'submitted', 'awaiting_carrier', 'confirmed_by_carrier');
    get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('servicing_requests', v_n);
  end if;

  -- The account's own lifecycle: status inactive, session_version + 1 (sessions end on their next
  -- request), the seat freed. The row and everything attributed to it stay.
  perform public.admin_set_user_status(p_user_id, 'inactive', null);

  return jsonb_build_object('role', v_role, 'open', v_open, 'moved', v_moved, 'reassigned_to', p_reassign_to);
end;
$$;

revoke all on function public.tenant_deactivate_member(uuid, uuid, uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_deactivate_member(uuid, uuid, uuid, uuid) to service_role;

-- ─── the verifier's "a fix did not take" alert goes to who follows the request up ────────────────
-- Restated from the live definition (= 20261015100000); the only change is the recipient, marked [audit].
CREATE OR REPLACE FUNCTION public.verify_servicing_requests(p_tenant_id uuid DEFAULT NULL::uuid, p_carrier_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r record;
  c jsonb;
  v_snap public.policy_snapshot%rowtype;
  v_grace integer;
  v_deadline date;
  v_field text;
  v_want text;
  v_have text;
  v_all_match boolean;
  v_unprovable jsonb;
  v_mismatch_field text;
  v_mismatch_have text;
  v_proven integer;
  v_reason text;
  v_verified integer := 0;
  v_failed integer := 0;
  v_waiting integer := 0;
  v_unprovable_count integer := 0;
  v_policies jsonb := '[]'::jsonb;
begin
  perform set_config('app.servicing_verifier', 'on', true);
  for r in
    select q.* from public.servicing_request q
     where q.status in ('submitted', 'awaiting_carrier', 'confirmed_by_carrier')
       and (p_tenant_id is null or q.tenant_id = p_tenant_id)
       and (p_carrier_id is null or q.carrier_id = p_carrier_id)
     order by q.tenant_id, q.created_at
     for update
  loop
    -- The newest file for this policy dated on or after the request was sent.
    select s.* into v_snap from public.policy_snapshot s
     where s.tenant_id = r.tenant_id and s.carrier_id = r.carrier_id and s.policy_number = r.policy_number
       and not s.superseded and s.snapshot_date >= (r.submitted_at at time zone 'UTC')::date
     order by s.snapshot_date desc limit 1;
    if not found then
      v_waiting := v_waiting + 1;
      continue;
    end if;

    v_all_match := true;
    v_proven := 0;
    v_unprovable := '[]'::jsonb;
    v_mismatch_field := null;
    v_mismatch_have := null;
    for c in select * from jsonb_array_elements(r.field_changes_json) loop
      v_field := c->>'field';
      v_want := c->>'to';
      v_have := case when v_field = 'payment_method' then v_snap.payment_method else v_snap.extra->'fields'->>v_field end;
      if v_have is null then
        v_unprovable := v_unprovable || to_jsonb(v_field);
      elsif v_want is null then
        v_all_match := false;
      elsif (v_have ~ '^\d+(\.0+)?$' and v_want ~ '^\d+(\.0+)?$' and v_have::numeric = v_want::numeric)
         or lower(regexp_replace(btrim(v_have), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(v_want), '\s+', ' ', 'g'))
         or (v_field = 'insured_address' and public.servicing_norm_address(v_have) = public.servicing_norm_address(v_want))
         or (v_field = 'insured_zip' and left(regexp_replace(v_have, '\D', '', 'g'), 5) = left(regexp_replace(v_want, '\D', '', 'g'), 5)) then
        v_proven := v_proven + 1;
      else
        v_all_match := false;
        if v_mismatch_field is null then
          v_mismatch_field := v_field;
          v_mismatch_have := v_have;
        end if;
      end if;
    end loop;

    if v_all_match and v_proven > 0 then
      update public.servicing_request set status = 'verified_in_file', verified_at = now(), verified_snapshot_date = v_snap.snapshot_date,
             checked_snapshot_date = v_snap.snapshot_date, unprovable_fields = v_unprovable
       where id = r.id;
      v_verified := v_verified + 1;
      v_policies := v_policies || jsonb_build_object('tenant_id', r.tenant_id, 'carrier_id', r.carrier_id, 'policy_number', r.policy_number);
      continue;
    end if;

    select coalesce((select rs.servicing_grace_days from public.retention_settings rs where rs.tenant_id = r.tenant_id), 10) into v_grace;
    v_deadline := coalesce(r.expected_effective_date, (r.submitted_at at time zone 'UTC')::date + 30) + v_grace;

    -- A field the file cannot show is never a failure: it waits, and says why.
    if v_mismatch_field is not null and public.la5_agency_today(r.tenant_id) > v_deadline
       and v_snap.snapshot_date >= coalesce(r.expected_effective_date, (r.submitted_at at time zone 'UTC')::date) then
      v_reason := format('%s was %s on %s and the carrier file of %s still shows %s %s.',
        case r.request_type when 'draft_date_change' then 'The draft date change' when 'payment_method_change' then 'The payment change'
             when 'bill_to_draft_conversion' then 'The switch to bank draft' else 'The address change' end,
        case when r.carrier_confirmed_at is not null then 'confirmed by the carrier' else 'sent' end,
        to_char(coalesce(r.carrier_confirmed_at, r.submitted_at), 'FMDD Mon'),
        to_char(v_snap.snapshot_date, 'FMDD Mon'),
        case v_mismatch_field when 'draft_day' then 'draft day' when 'payment_method' then 'payment method' when 'insured_address' then 'the address'
             when 'insured_zip' then 'ZIP' when 'insured_state' then 'state' else replace(v_mismatch_field, '_', ' ') end,
        case when v_mismatch_field = 'payment_method' then replace(v_mismatch_have, '_', ' ') else v_mismatch_have end);
      update public.servicing_request set status = 'failed', failed_at = now(), failure_reason = left(v_reason, 500),
             checked_snapshot_date = v_snap.snapshot_date, unprovable_fields = v_unprovable
       where id = r.id;
      -- [audit] who follows the request up now (the handover's taker), else who asked
      if coalesce(r.assigned_to, r.requested_by) is not null then
        insert into public.agent_notifications (tenant_id, recipient_user_id, kind, title, body, link, source_key)
        values (r.tenant_id, coalesce(r.assigned_to, r.requested_by), 'servicing_failed', 'A fix did not take: ' || r.policy_number, left(v_reason, 1000), '/app/servicing?status=failed', 'servicing-failed:' || r.id)
        on conflict (tenant_id, recipient_user_id, source_key) do nothing;
      end if;
      v_failed := v_failed + 1;
    else
      update public.servicing_request set checked_snapshot_date = v_snap.snapshot_date, unprovable_fields = v_unprovable
       where id = r.id and (checked_snapshot_date is distinct from v_snap.snapshot_date or unprovable_fields is distinct from v_unprovable);
      if jsonb_array_length(v_unprovable) > 0 then v_unprovable_count := v_unprovable_count + 1; else v_waiting := v_waiting + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('verified', v_verified, 'failed', v_failed, 'waiting', v_waiting, 'unprovable', v_unprovable_count, 'verified_policies', v_policies);
end;
$function$;

revoke all on function public.verify_servicing_requests(uuid, uuid) from public, anon, authenticated;
grant execute on function public.verify_servicing_requests(uuid, uuid) to service_role;

-- ─── webhooks: a paused subscription collects nothing ────────────────────────────────────────────
create or replace function public.enqueue_webhook_event(p_tenant_id uuid, p_event_type text, p_source_key text, p_payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_n integer;
  v_event uuid := gen_random_uuid();
begin
  insert into public.webhook_delivery (tenant_id, subscription_id, event_id, event_type, source_key, payload)
  select s.tenant_id, s.id, v_event, p_event_type, p_source_key,
         jsonb_build_object('id', v_event, 'type', p_event_type, 'created_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'data', p_payload)
    from public.webhook_subscription s
   where s.tenant_id = p_tenant_id
     -- [audit] no longer paused too: events while paused are not queued, so resuming sends nothing stale
     and s.status in ('active', 'failing')
     and p_event_type = any (s.event_types)
  on conflict (subscription_id, source_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.enqueue_webhook_event(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_webhook_event(uuid, text, text, jsonb) to service_role;

-- ─── API keys: one live successor per key ────────────────────────────────────────────────────────
create unique index if not exists api_key_one_rotation on public.api_key (rotated_from) where rotated_from is not null and revoked_at is null;

-- ─── self-check ──────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.servicing_request'::regclass and attname = 'assigned_to' and not attisdropped) then
    raise exception 'servicing_request.assigned_to is missing';
  end if;
  v_def := pg_get_functiondef('public.tenant_deactivate_member(uuid, uuid, uuid, uuid)'::regprocedure);
  if position('reassign_target_cannot_work' in v_def) = 0 or position('update public.servicing_request set assigned_to' in v_def) = 0 then
    raise exception 'tenant_deactivate_member is not the audited version';
  end if;
  if position('coalesce(s.assigned_to, s.requested_by)' in pg_get_functiondef('public.tenant_member_open_work(uuid, uuid)'::regprocedure)) = 0 then
    raise exception 'tenant_member_open_work does not count by who follows the request up';
  end if;
  if position('coalesce(r.assigned_to, r.requested_by)' in pg_get_functiondef('public.verify_servicing_requests(uuid, uuid)'::regprocedure)) = 0 then
    raise exception 'verify_servicing_requests still alerts only the requester';
  end if;
  v_def := pg_get_functiondef('public.enqueue_webhook_event(uuid, text, text, jsonb)'::regprocedure);
  if position('''paused''' in v_def) > 0 then
    raise exception 'enqueue_webhook_event still queues for paused subscriptions';
  end if;
  if to_regclass('public.api_key_one_rotation') is null then
    raise exception 'api_key_one_rotation is missing';
  end if;
end;
$$;
