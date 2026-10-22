-- ============================================================================
-- Pending migrations — 3 files, each in its own transaction
-- Generated 2026-10-15 by scripts/build-pending-bundle.mjs. Do not hand-edit; regenerate.
--
-- HOW TO RUN: Supabase dashboard → SQL editor → paste this whole file → Run.
-- Each file is begin … commit on its own. The SQL editor STOPS at the first error: that file is
-- rolled back, the files before it stay applied, and nothing after it runs. Fix the named file,
-- regenerate, and run the whole script again — re-running is safe: the files use
-- create-or-replace / if-not-exists, and history rows use on-conflict-do-nothing.
--
-- AFTERWARDS: node --env-file=.env.local scripts/verify-applied-migrations.mjs
--
-- Files, in order:
--    1. 20261015340000_la_8_7_api_keys_webhooks.sql
--    2. 20261015350000_la_8_6_team.sql
--    3. 20261015360000_la_8_8_settings_audit.sql
-- ============================================================================

-- ─── [1/3] 20261015340000_la_8_7_api_keys_webhooks.sql ───────────────────────────
begin;

-- LA-8.7 (Notion sprint, Module 8 — Settings) · Integrations: API keys and signed webhooks.
--
-- An API key is a password that lives in someone else's codebase, so the rules come first:
--
--   api_key                the key itself is NEVER stored — only its SHA-256 hash, a prefix and the
--                          last four characters. Scopes are explicit and narrow (no full-access scope
--                          exists), checked on every request. Revocation and expiry are read from this
--                          row on every request (store-checked, not inferred from the key). Rotation
--                          mints a new key and gives the old one an expiry `overlap` hours out, so both
--                          work during the overlap and both are visible.
--   webhook_subscription   HTTPS targets (private and loopback addresses are refused by the app, at
--                          save and again at delivery after DNS). The signing secret is stored
--                          encrypted by the app (AES-256-GCM, bound to the subscription) and shown once.
--   webhook_delivery       one event for one subscription: the payload (identifiers and non-sensitive
--                          fields only), its attempts and when the next is due.
--   webhook_attempt        the delivery log: status code and a response snippet per attempt.
--
-- Events are queued by the database, so every writer is covered, not only the screens:
--   policy.issued                   policy_change: status_normalized → active from submitted/approved_unpaid
--                                   (the same rule policy_current uses for its issue date)
--   policy.lapsed                   policy_change: status_normalized → lapsed
--   commission.discrepancy_found    commission_discrepancy: a new finding
-- Statement-level triggers with transition tables, and nothing is queued unless the agency has a
-- subscription for the event, so the bulk snapshot loads pay one cheap check.
--
-- Delivery, signing, retries and disabling are the app's (lib/webhooks/deliver.ts, run by
-- /api/cron/webhooks): only the app holds the key that opens a signing secret.
--
-- Rollback: drop trigger webhook_policy_change_events on public.policy_change;
--   drop trigger webhook_discrepancy_events on public.commission_discrepancy;
--   drop function public.webhook_policy_change_events(), public.webhook_discrepancy_events(),
--     public.enqueue_webhook_event(uuid, text, text, jsonb), public.claim_webhook_deliveries(integer, uuid),
--     public.prune_webhook_attempts();
--   drop table public.webhook_attempt, public.webhook_delivery, public.webhook_subscription, public.api_key;
--   drop index public.agent_leads_tenant_created_id_idx;

-- --------------------------------------------------------------------------
-- 1. API keys
-- --------------------------------------------------------------------------

create table if not exists public.api_key (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  label text not null,
  key_hash text not null,
  key_prefix text not null,
  last_four text not null,
  scopes text[] not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  last_used_ip text,
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.users(id) on delete set null,
  -- Set on the new key by a rotation: which key it replaced.
  rotated_from uuid references public.api_key(id) on delete set null,
  constraint api_key_hash_unique unique (key_hash),
  constraint api_key_hash_shape check (key_hash ~ '^[0-9a-f]{64}$'),
  constraint api_key_label check (char_length(btrim(label)) between 1 and 80),
  constraint api_key_prefix check (char_length(key_prefix) between 4 and 16),
  constraint api_key_last_four check (char_length(last_four) = 4),
  -- Explicit and narrow: at least one scope, every one from the list. There is no "*".
  constraint api_key_scopes check (
    cardinality(scopes) between 1 and 5
    and scopes <@ array['leads:write', 'leads:read', 'policies:read', 'commissions:read', 'webhooks:manage']::text[]
  ),
  constraint api_key_ip check (last_used_ip is null or char_length(last_used_ip) <= 64)
);
create index if not exists api_key_tenant_idx on public.api_key (tenant_id, created_at desc);

comment on table public.api_key is
  'LA-8.7 · Integration API keys. Only the SHA-256 hash is stored; the key is shown once at creation. '
  'Revocation and expiry are checked against this row on every request.';

-- --------------------------------------------------------------------------
-- 2. Webhooks
-- --------------------------------------------------------------------------

create table if not exists public.webhook_subscription (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  label text not null,
  target_url text not null,
  event_types text[] not null,
  signing_secret_ciphertext text not null,
  signing_secret_key_version integer not null default 1,
  status text not null default 'active',
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  consecutive_failures integer not null default 0,
  disabled_at timestamptz,
  disabled_reason text,
  constraint webhook_subscription_label check (char_length(btrim(label)) between 1 and 80),
  -- HTTPS only. The private/loopback check needs DNS, so it is the app's (at save and per delivery).
  constraint webhook_subscription_https check (target_url ~ '^https://[^/?#@\s]+' and char_length(target_url) <= 500),
  constraint webhook_subscription_events check (
    cardinality(event_types) between 1 and 3
    and event_types <@ array['policy.issued', 'policy.lapsed', 'commission.discrepancy_found']::text[]
  ),
  constraint webhook_subscription_status check (status in ('active', 'paused', 'failing', 'disabled')),
  constraint webhook_subscription_disabled check ((status = 'disabled') = (disabled_at is not null)),
  constraint webhook_subscription_failures check (consecutive_failures >= 0),
  constraint webhook_subscription_reason check (disabled_reason is null or char_length(disabled_reason) <= 300)
);
create index if not exists webhook_subscription_tenant_idx on public.webhook_subscription (tenant_id, created_at desc);

create table if not exists public.webhook_delivery (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  subscription_id uuid not null references public.webhook_subscription(id) on delete cascade,
  -- The same for every subscription the event went to, so a receiver can de-duplicate on it.
  event_id uuid not null,
  event_type text not null,
  -- What made the event; one delivery per subscription per source, however often a trigger fires.
  source_key text not null,
  payload jsonb not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  last_status_code integer,
  last_error text,
  constraint webhook_delivery_once unique (subscription_id, source_key),
  constraint webhook_delivery_type check (event_type in ('policy.issued', 'policy.lapsed', 'commission.discrepancy_found', 'webhook.test')),
  constraint webhook_delivery_status check (status in ('pending', 'delivering', 'succeeded', 'failed', 'cancelled')),
  constraint webhook_delivery_finished check ((status in ('succeeded', 'failed', 'cancelled')) = (finished_at is not null)),
  constraint webhook_delivery_attempts check (attempts between 0 and 20),
  constraint webhook_delivery_error check (last_error is null or char_length(last_error) <= 300),
  constraint webhook_delivery_payload check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 16384)
);
create index if not exists webhook_delivery_due_idx on public.webhook_delivery (next_attempt_at) where status in ('pending', 'delivering');
create index if not exists webhook_delivery_subscription_idx on public.webhook_delivery (subscription_id, created_at desc);
create index if not exists webhook_delivery_tenant_idx on public.webhook_delivery (tenant_id);

create table if not exists public.webhook_attempt (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  subscription_id uuid not null references public.webhook_subscription(id) on delete cascade,
  delivery_id uuid not null references public.webhook_delivery(id) on delete cascade,
  attempt integer not null,
  attempted_at timestamptz not null default now(),
  status_code integer,
  ok boolean not null,
  duration_ms integer,
  response_snippet text,
  error text,
  constraint webhook_attempt_number check (attempt between 1 and 20),
  constraint webhook_attempt_code check (status_code is null or status_code between 100 and 599),
  constraint webhook_attempt_snippet check (response_snippet is null or char_length(response_snippet) <= 500),
  constraint webhook_attempt_error check (error is null or char_length(error) <= 300)
);
create index if not exists webhook_attempt_subscription_idx on public.webhook_attempt (subscription_id, attempted_at desc);
create index if not exists webhook_attempt_delivery_idx on public.webhook_attempt (delivery_id);
create index if not exists webhook_attempt_tenant_idx on public.webhook_attempt (tenant_id);

-- Written by the app's service client only. Default privileges hand every new table to service_role
-- and the API roles; take them back from everyone but service_role.
alter table public.api_key enable row level security;
alter table public.webhook_subscription enable row level security;
alter table public.webhook_delivery enable row level security;
alter table public.webhook_attempt enable row level security;
revoke all on public.api_key, public.webhook_subscription, public.webhook_delivery, public.webhook_attempt from public, anon, authenticated;
grant select, insert, update, delete on public.api_key, public.webhook_subscription, public.webhook_delivery, public.webhook_attempt to service_role;

-- --------------------------------------------------------------------------
-- 3. Queueing an event
-- --------------------------------------------------------------------------

-- One delivery per subscription of the agency that listens for the event. A paused subscription
-- still collects its events (they wait); a disabled one does not.
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
     and s.status in ('active', 'paused', 'failing')
     and p_event_type = any (s.event_types)
  on conflict (subscription_id, source_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.enqueue_webhook_event(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_webhook_event(uuid, text, text, jsonb) to service_role;

-- policy.issued / policy.lapsed. The payload is the policy number, carrier, premium and status —
-- never a name, an SSN, bank details or the contact record. Premium is policy_current's when known.
create or replace function public.webhook_policy_change_events()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r record;
begin
  for r in
    select i.id, i.tenant_id, i.carrier_id, i.policy_number, i.old_value, i.new_value, i.to_snapshot_date,
           c.name as carrier_name, pc.premium_cents, pc.premium_mode, pc.product_code
      from inserted i
      join public.carriers c on c.id = i.carrier_id
      left join public.policy_current pc on pc.tenant_id = i.tenant_id and pc.carrier_id = i.carrier_id and pc.policy_number = i.policy_number
     where i.field_name = 'status_normalized'
       and (i.new_value = 'lapsed' or (i.new_value = 'active' and i.old_value in ('submitted', 'approved_unpaid')))
       -- The cheap check first: no subscription, nothing to build.
       and exists (select 1 from public.webhook_subscription s where s.tenant_id = i.tenant_id and s.status <> 'disabled')
  loop
    perform public.enqueue_webhook_event(
      r.tenant_id,
      case when r.new_value = 'lapsed' then 'policy.lapsed' else 'policy.issued' end,
      'policy_change:' || r.id,
      jsonb_build_object(
        'policy_number', r.policy_number,
        'carrier', jsonb_build_object('id', r.carrier_id, 'name', r.carrier_name),
        'status', r.new_value,
        'previous_status', r.old_value,
        'effective_on', r.to_snapshot_date,
        'premium_cents', r.premium_cents,
        'premium_mode', r.premium_mode,
        'product_code', r.product_code
      )
    );
  end loop;
  return null;
end;
$$;

revoke all on function public.webhook_policy_change_events() from public, anon, authenticated;

drop trigger if exists webhook_policy_change_events on public.policy_change;
create trigger webhook_policy_change_events
  after insert on public.policy_change
  referencing new table as inserted
  for each statement execute function public.webhook_policy_change_events();

-- commission.discrepancy_found. The finding's figures and type, not its explanation text or evidence.
create or replace function public.webhook_discrepancy_events()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r record;
begin
  for r in
    select i.id, i.tenant_id, i.carrier_id, i.policy_number, i.policy_year, i.discrepancy_type, i.severity,
           i.expected_amount_cents, i.reported_amount_cents, i.difference_cents, i.detected_at, c.name as carrier_name
      from inserted i
      join public.carriers c on c.id = i.carrier_id
     where exists (select 1 from public.webhook_subscription s where s.tenant_id = i.tenant_id and s.status <> 'disabled')
  loop
    perform public.enqueue_webhook_event(
      r.tenant_id,
      'commission.discrepancy_found',
      'commission_discrepancy:' || r.id,
      jsonb_build_object(
        'discrepancy_id', r.id,
        'type', r.discrepancy_type,
        'severity', r.severity,
        'policy_number', r.policy_number,
        'policy_year', r.policy_year,
        'carrier', jsonb_build_object('id', r.carrier_id, 'name', r.carrier_name),
        'expected_cents', r.expected_amount_cents,
        'reported_cents', r.reported_amount_cents,
        'difference_cents', r.difference_cents,
        'detected_at', r.detected_at
      )
    );
  end loop;
  return null;
end;
$$;

revoke all on function public.webhook_discrepancy_events() from public, anon, authenticated;

drop trigger if exists webhook_discrepancy_events on public.commission_discrepancy;
create trigger webhook_discrepancy_events
  after insert on public.commission_discrepancy
  referencing new table as inserted
  for each statement execute function public.webhook_discrepancy_events();

-- --------------------------------------------------------------------------
-- 4. The delivery job's claim, and its housekeeping
-- --------------------------------------------------------------------------

-- Due deliveries of subscriptions that may send (active or failing), leased for two minutes so two
-- job runs never send the same one. A lease that ran out (a job that died) is claimable again.
create or replace function public.claim_webhook_deliveries(p_limit integer default 50, p_tenant_id uuid default null)
returns setof public.webhook_delivery
language sql
security definer
set search_path = public, pg_catalog
as $$
  update public.webhook_delivery d
     set status = 'delivering', lease_until = now() + interval '2 minutes'
   where d.id in (
     select x.id
       from public.webhook_delivery x
       join public.webhook_subscription s on s.id = x.subscription_id
      where (x.status = 'pending' or (x.status = 'delivering' and x.lease_until < now()))
        and x.next_attempt_at <= now()
        and s.status in ('active', 'failing')
        and (p_tenant_id is null or x.tenant_id = p_tenant_id)
      order by x.next_attempt_at
      limit least(greatest(p_limit, 1), 200)
      for update of x skip locked)
  returning d.*;
$$;

revoke all on function public.claim_webhook_deliveries(integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_webhook_deliveries(integer, uuid) to service_role;

-- Finished deliveries (and their attempts) are kept 30 days; the log keeps at most 100 attempts per subscription.
create or replace function public.prune_webhook_attempts()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_attempts integer;
  v_deliveries integer;
begin
  -- Finished more than 30 days ago: gone, with their attempts (cascade). Nothing outlives that.
  delete from public.webhook_delivery d
   where d.finished_at < now() - interval '30 days';
  get diagnostics v_deliveries = row_count;
  delete from public.webhook_attempt a
   using (select id, row_number() over (partition by subscription_id order by attempted_at desc) as n from public.webhook_attempt) ranked
   where ranked.id = a.id and ranked.n > 100;
  get diagnostics v_attempts = row_count;
  return v_attempts + v_deliveries;
end;
$$;

revoke all on function public.prune_webhook_attempts() from public, anon, authenticated;
grant execute on function public.prune_webhook_attempts() to service_role;

-- --------------------------------------------------------------------------
-- 5. The public API's lead read: newest first, along a tenant-leading index
-- --------------------------------------------------------------------------

create index if not exists agent_leads_tenant_created_id_idx on public.agent_leads (tenant_id, created_at desc, id desc);

-- --------------------------------------------------------------------------
-- 6. Self-check
-- --------------------------------------------------------------------------

do $$
declare
  v_missing text;
begin
  select string_agg(t, ', ') into v_missing
    from unnest(array['api_key', 'webhook_subscription', 'webhook_delivery', 'webhook_attempt']) t
   where has_table_privilege('authenticated', 'public.' || t, 'select')
      or has_table_privilege('anon', 'public.' || t, 'select');
  if v_missing is not null then
    raise exception 'LA-8.7: API roles can still read %', v_missing;
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'webhook_policy_change_events' and tgrelid = 'public.policy_change'::regclass) then
    raise exception 'LA-8.7: the policy event trigger is missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'webhook_discrepancy_events' and tgrelid = 'public.commission_discrepancy'::regclass) then
    raise exception 'LA-8.7: the discrepancy event trigger is missing';
  end if;
  -- There is no full-access scope: the table refuses one (rolled back by the exception either way).
  if exists (select 1 from public.tenants) then
    begin
      insert into public.api_key (tenant_id, label, key_hash, key_prefix, last_four, scopes)
      values ((select id from public.tenants limit 1), 'check', repeat('a', 64), 'isk_test', 'abcd', array['*']);
      raise exception 'LA-8.7: a full-access scope was accepted';
    exception when check_violation then null;
    end;
  end if;
end;
$$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261015340000', 'la_8_7_api_keys_webhooks') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [2/3] 20261015350000_la_8_6_team.sql ────────────────────────────────────────
begin;

-- LA-8.6 (Notion sprint, Module 8 — Settings) · Team & seat management: the parts that were missing.
--
-- Invitations (72-hour signed links, resend, revoke), roles and the seat count already exist and are
-- reused unchanged: the invite flow is tenant_invite_user_with_auth, roles are LA-0.2's, and the one
-- seat rule (20260924346000) already counts a pending invitation as a held seat. This file adds:
--
--   tenant_users.timezone   the member's own zone (offshore staff). The roster (LA-2.12) reads it
--                           when the member has no working hours. NOTHING HERE TOUCHES CALLING
--                           WINDOWS: those come from the customer's state (LA-2.4), never the caller.
--   tenant_member_open_work(tenant, user)
--                           what is still waiting on a person: exception-queue items (LA-4.9), open
--                           reinstatement cases (LA-5.6), callbacks, claimed leads, upcoming
--                           appointments, and open servicing requests (LA-5.4).
--   tenant_deactivate_member(tenant, user, actor, reassign_to)
--                           in ONE transaction: refuses while work is open and nobody is named to take
--                           it; hands the open work to that person; then deactivates the account
--                           through admin_set_user_status, which bumps session_version — every session
--                           ends on its next request — and frees the seat. Nothing is deleted: what
--                           the person wrote, worked, booked and attempted stays attributed to them.
--                           A servicing request keeps its requester (LA-5.4 fixes "who asked" for
--                           good); it stays on the team's servicing list.
--   tenant_reactivate_member(tenant, user)
--                           back to active, through the same function and its seat check.
--
-- Deactivation is the person's account (users.status), as everywhere else in the product. Someone who
-- also belongs to another agency is not deactivated from here: that would lock them out of the other
-- agency too. The function refuses, and says so.
--
-- Rollback: drop function public.tenant_deactivate_member(uuid, uuid, uuid, uuid),
--   public.tenant_reactivate_member(uuid, uuid), public.tenant_member_open_work(uuid, uuid),
--   public.tenant_set_member_timezone(uuid, uuid, text);
--   alter table public.tenant_users drop column timezone; and restore tenant_member_roster from 20260929202000.

set local lock_timeout = '5s';

alter table public.tenant_users add column if not exists timezone text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_users_timezone_shape' and conrelid = 'public.tenant_users'::regclass) then
    alter table public.tenant_users add constraint tenant_users_timezone_shape check (timezone is null or char_length(timezone) between 1 and 64);
  end if;
end;
$$;

comment on column public.tenant_users.timezone is
  'LA-8.6 · The member''s own time zone (IANA), for the roster and scorecards. Never used for calling windows, which follow the customer''s state (LA-2.4).';

-- A real zone or nothing: checked against the server's zone list, which a check constraint cannot read.
create or replace function public.tenant_set_member_timezone(p_tenant_id uuid, p_user_id uuid, p_timezone text)
returns text
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_zone text := nullif(btrim(coalesce(p_timezone, '')), '');
begin
  if v_zone is not null and not exists (select 1 from pg_timezone_names where name = v_zone) then
    raise exception 'unknown_timezone' using errcode = 'P0001';
  end if;
  update public.tenant_users set timezone = v_zone where tenant_id = p_tenant_id and user_id = p_user_id;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0001';
  end if;
  return v_zone;
end;
$$;

revoke all on function public.tenant_set_member_timezone(uuid, uuid, text) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_set_member_timezone(uuid, uuid, text) to service_role;

-- --------------------------------------------------------------------------
-- The roster reads the member's zone (restated from 20260929202000; [8.6] marks the changes)
-- --------------------------------------------------------------------------

create or replace view public.tenant_member_roster as
select tu.tenant_id,
       tu.user_id,
       tu.role::text as role,
       z.zone as timezone,
       (now() at time zone z.zone) as local_time,
       to_char(now() at time zone z.zone, 'Dy HH24:MI') as local_label,
       av.start_time,
       av.end_time,
       case when av.user_id is null then null
            else (
              extract(dow from (now() at time zone av.timezone))::smallint = av.weekday
              and (now() at time zone av.timezone)::time >= av.start_time
              and (now() at time zone av.timezone)::time < av.end_time
            ) end as on_shift_now
  from tenant_users tu
  left join tenant_agent_availability av
    on av.tenant_id = tu.tenant_id and av.user_id = tu.user_id
  left join agency_profiles ag
    on ag.tenant_id = tu.tenant_id
  cross join lateral (
    select coalesce(
             nullif(btrim(av.timezone), ''),
             -- [8.6] the member's own zone, before the agency's
             (select tz.name from pg_timezone_names tz where tz.name = nullif(btrim(tu.timezone), '') limit 1),
             (select tz.name from pg_timezone_names tz where tz.name = nullif(btrim(ag.timezone), '') limit 1),
             'UTC') as zone
  ) z
 where tu.accepted_at is not null
   and (av.user_id is not null or tu.role::text in ('owner', 'producer', 'setter'))
   -- [8.6] a deactivated member is not on the phones
   and exists (select 1 from users u where u.id = tu.user_id and u.status = 'active');

alter view public.tenant_member_roster set (security_invoker = on);
revoke all on public.tenant_member_roster from anon, authenticated, public;
grant select on public.tenant_member_roster to tenant_app, service_role;

-- --------------------------------------------------------------------------
-- Open work
-- --------------------------------------------------------------------------

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
    'servicing_requests', (select count(*) from public.servicing_request s where s.tenant_id = p_tenant_id and s.requested_by = p_user_id and s.status in ('draft', 'submitted', 'awaiting_carrier', 'confirmed_by_carrier'))
  );
$$;

revoke all on function public.tenant_member_open_work(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_member_open_work(uuid, uuid) to service_role;

-- --------------------------------------------------------------------------
-- Deactivate, handing open work over first
-- --------------------------------------------------------------------------

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
  v_reassignable := (v_open->>'queue_items')::int + (v_open->>'reinstatement_cases')::int + (v_open->>'callbacks')::int
                  + (v_open->>'claimed_leads')::int + (v_open->>'appointments')::int;

  if v_reassignable > 0 then
    if p_reassign_to is null then
      raise exception 'open_work:%', v_open::text using errcode = 'P0001';
    end if;
    if p_reassign_to = p_user_id or not exists (
      select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id
       where tu.tenant_id = p_tenant_id and tu.user_id = p_reassign_to and tu.accepted_at is not null and u.status = 'active'
    ) then
      raise exception 'reassign_target_invalid' using errcode = 'P0001';
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
  end if;

  -- The account's own lifecycle: status inactive, session_version + 1 (sessions end on their next
  -- request), the seat freed. The row and everything attributed to it stay.
  perform public.admin_set_user_status(p_user_id, 'inactive', null);

  return jsonb_build_object('role', v_role, 'open', v_open, 'moved', v_moved, 'reassigned_to', p_reassign_to);
end;
$$;

revoke all on function public.tenant_deactivate_member(uuid, uuid, uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_deactivate_member(uuid, uuid, uuid, uuid) to service_role;

create or replace function public.tenant_reactivate_member(p_tenant_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_status text;
begin
  select u.status into v_status
    from public.tenant_users tu join public.users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id and tu.user_id = p_user_id and tu.accepted_at is not null;
  if v_status is null then
    raise exception 'member_not_found' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.tenant_users tu where tu.user_id = p_user_id and tu.tenant_id <> p_tenant_id) then
    raise exception 'member_of_other_workspaces' using errcode = 'P0001';
  end if;
  if v_status not in ('inactive', 'deactivated') then
    raise exception 'not_deactivated' using errcode = 'P0001';
  end if;
  -- The seat check is admin_set_user_status's (assert_user_seat_transition): at the limit, refused.
  perform public.admin_set_user_status(p_user_id, 'active', null);
  return 'active';
end;
$$;

revoke all on function public.tenant_reactivate_member(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_reactivate_member(uuid, uuid) to service_role;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261015350000', 'la_8_6_team') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [3/3] 20261015360000_la_8_8_settings_audit.sql ──────────────────────────────
begin;

-- LA-8.8 (Notion sprint, Module 8 — Settings) · one settings audit log, and nothing can change it.
--
-- Five hubs promised "every change writes an audit row: who, what, from, to, when" and nothing could
-- read those rows. Three wrote their own tables (accounting_setting_change LA-7.9,
-- compliance_setting_change LA-6.8, retention_setting_change LA-5.11); sales (LA-3.17) and carrier
-- rules (LA-4.17) wrote none. This file adds the shared shape and makes every hub write it — from the
-- database, so no screen can forget:
--
--   settings_audit              one row per changed setting. setting_label is SNAPSHOTTED (a renamed
--                               or removed setting still reads sensibly); actor_role is the role held
--                               AT THE TIME, read from tenant_users when the row is written.
--   record_settings_audit(...)  the one writer, for triggers and for any future settings screen.
--   triggers                    the three hubs' change tables copy each new row across; sales
--                               settings, carrier settings, carrier operating settings and carrier
--                               retention rules are diffed field by field as they are saved.
--   backfill                    the three change tables' existing rows, source 'migration' (the role
--                               held then is not known, so actor_role is left empty rather than guessed).
--
-- READ-ONLY AND NEVER PURGED. No role can update, delete or truncate it — the grants are revoked from
-- every role, service_role included, and a trigger refuses UPDATE and DELETE for anyone at all
-- (raw_rows' and commission_entry's rule). LA-6.6's retention purge has no rule that can reach it.
--
-- Rollback: drop the eight capture triggers and their functions, then drop table public.settings_audit
--   (an owner can; nothing else can).

set local lock_timeout = '5s';

create table if not exists public.settings_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  section_key text not null,
  setting_key text not null,
  setting_label text not null,
  old_value text,
  new_value text,
  change_type text not null,
  actor_user_id uuid references public.users(id) on delete set null,
  actor_role text,
  occurred_at timestamptz not null default now(),
  source text not null default 'ui',
  reason text,
  constraint settings_audit_section check (section_key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  constraint settings_audit_key check (char_length(setting_key) between 1 and 200),
  constraint settings_audit_label check (char_length(setting_label) between 1 and 300),
  constraint settings_audit_values check ((old_value is null or char_length(old_value) <= 4000) and (new_value is null or char_length(new_value) <= 4000)),
  constraint settings_audit_change check (change_type in ('create', 'update', 'delete', 'reset_to_default')),
  constraint settings_audit_source check (source in ('ui', 'api', 'system', 'migration')),
  constraint settings_audit_reason check (reason is null or char_length(reason) <= 2000)
);
create index if not exists settings_audit_tenant_time_idx on public.settings_audit (tenant_id, occurred_at desc, id desc);
create index if not exists settings_audit_tenant_section_idx on public.settings_audit (tenant_id, section_key, occurred_at desc);
create index if not exists settings_audit_actor_idx on public.settings_audit (tenant_id, actor_user_id, occurred_at desc);

comment on table public.settings_audit is
  'LA-8.8 · Every settings change, append-only. Labels are snapshotted and actor_role is the role at the time. No role may update or delete a row; LA-6.6 never purges it.';

alter table public.settings_audit enable row level security;
revoke all on public.settings_audit from public, anon, authenticated;
-- Insert and read only, even for the service role. (Default privileges hand new tables everything.)
revoke update, delete, truncate on public.settings_audit from service_role;
grant select, insert on public.settings_audit to service_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'tenant_app') then
    execute 'revoke all on public.settings_audit from tenant_app';
  end if;
end;
$$;

create or replace function public.settings_audit_is_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'The settings audit log is read-only: rows are never changed or removed.' using errcode = 'P0001';
end;
$$;

drop trigger if exists settings_audit_append_only on public.settings_audit;
create trigger settings_audit_append_only before update or delete on public.settings_audit
  for each row execute function public.settings_audit_is_append_only();
drop trigger if exists settings_audit_no_truncate on public.settings_audit;
create trigger settings_audit_no_truncate before truncate on public.settings_audit
  for each statement execute function public.settings_audit_is_append_only();

-- --------------------------------------------------------------------------
-- The one writer
-- --------------------------------------------------------------------------

-- Values as text, so any type is expressible: a JSON string unwrapped, anything else as JSON.
create or replace function public.settings_audit_text(p_value jsonb)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case when p_value is null or p_value = 'null'::jsonb then null
              when jsonb_typeof(p_value) = 'string' then left(p_value #>> '{}', 4000)
              else left(p_value::text, 4000) end;
$$;

-- "first_payment_window_days" → "First payment window days".
create or replace function public.settings_audit_label(p_key text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select left(upper(left(replace(replace(p_key, '_', ' '), '.', ' › '), 1)) || substr(replace(replace(p_key, '_', ' '), '.', ' › '), 2), 300);
$$;

create or replace function public.record_settings_audit(
  p_tenant_id uuid, p_section_key text, p_setting_key text, p_setting_label text,
  p_old jsonb, p_new jsonb, p_actor uuid, p_source text default 'ui', p_reason text default null, p_change_type text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_role text;
  v_actor uuid := p_actor;
begin
  -- JSON null and no value are the same thing here: an empty column on a new row is not a change.
  if nullif(p_old, 'null'::jsonb) is not distinct from nullif(p_new, 'null'::jsonb) then
    return;
  end if;
  -- accounting_setting_change.changed_by has no foreign key; an id that is no user is not an actor,
  -- and must not make the hub's own save fail.
  if v_actor is not null and not exists (select 1 from public.users u where u.id = v_actor) then
    v_actor := null;
  end if;
  -- The role held now, at the moment of the change — kept, never re-read.
  select tu.role::text into v_role from public.tenant_users tu where tu.tenant_id = p_tenant_id and tu.user_id = v_actor;
  insert into public.settings_audit (tenant_id, section_key, setting_key, setting_label, old_value, new_value, change_type, actor_user_id, actor_role, source, reason)
  values (
    p_tenant_id, p_section_key, left(p_setting_key, 200), left(coalesce(nullif(btrim(p_setting_label), ''), public.settings_audit_label(p_setting_key)), 300),
    public.settings_audit_text(p_old), public.settings_audit_text(p_new),
    coalesce(p_change_type, case when p_old is null or p_old = 'null'::jsonb then 'create' when p_new is null or p_new = 'null'::jsonb then 'delete' else 'update' end),
    v_actor, v_role, coalesce(p_source, 'ui'), left(p_reason, 2000)
  );
end;
$$;

revoke all on function public.record_settings_audit(uuid, text, text, text, jsonb, jsonb, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_settings_audit(uuid, text, text, text, jsonb, jsonb, uuid, text, text, text) to service_role;

-- --------------------------------------------------------------------------
-- The three hubs with their own change tables: copy each row across
-- --------------------------------------------------------------------------

create or replace function public.settings_audit_from_change_table()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_section text := tg_argv[0];
  v_row jsonb := to_jsonb(new);
  v_key text;
  v_actor uuid;
begin
  -- accounting: field · compliance: section.setting · retention: setting
  v_key := case tg_table_name
             when 'accounting_setting_change' then v_row->>'field'
             when 'compliance_setting_change' then (v_row->>'section') || '.' || (v_row->>'setting')
             else v_row->>'setting' end;
  v_actor := nullif(v_row->>'changed_by', '')::uuid;
  perform public.record_settings_audit(new.tenant_id, v_section, v_key, public.settings_audit_label(v_key), v_row->'old_value', v_row->'new_value', v_actor, 'ui', null);
  return null;
end;
$$;

drop trigger if exists settings_audit_capture on public.accounting_setting_change;
create trigger settings_audit_capture after insert on public.accounting_setting_change
  for each row execute function public.settings_audit_from_change_table('accounting');
drop trigger if exists settings_audit_capture on public.compliance_setting_change;
create trigger settings_audit_capture after insert on public.compliance_setting_change
  for each row execute function public.settings_audit_from_change_table('compliance');
drop trigger if exists settings_audit_capture on public.retention_setting_change;
create trigger settings_audit_capture after insert on public.retention_setting_change
  for each row execute function public.settings_audit_from_change_table('retention');

-- --------------------------------------------------------------------------
-- Sales (LA-3.17) and carrier rules (LA-4.17): diff the saved row, field by field
-- --------------------------------------------------------------------------

-- tenant_sales_settings keeps every setting in one JSON object; each top-level key is a setting.
create or replace function public.settings_audit_sales_settings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_old jsonb := case when tg_op = 'UPDATE' then old.settings else '{}'::jsonb end;
  k text;
begin
  for k in select key from jsonb_object_keys(v_old || new.settings) as key loop
    if (v_old->k) is distinct from (new.settings->k) then
      perform public.record_settings_audit(new.tenant_id, 'sales-preferences', k, public.settings_audit_label(k), v_old->k, new.settings->k, new.updated_by, 'ui', null);
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists settings_audit_capture on public.tenant_sales_settings;
create trigger settings_audit_capture after insert or update on public.tenant_sales_settings
  for each row execute function public.settings_audit_sales_settings();

-- A row of named columns per carrier: tenant_carrier_settings (LA-3.17) and carrier_operating_settings
-- (LA-4.17). tg_argv: section key, then the columns that are settings.
create or replace function public.settings_audit_carrier_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_new jsonb := to_jsonb(new);
  v_carrier text;
  v_tenant uuid := nullif(v_new->>'tenant_id', '')::uuid;
  i integer;
  k text;
begin
  if v_tenant is null then
    return null;  -- a platform default, set by staff: not an agency's setting
  end if;
  select c.name into v_carrier from public.carriers c where c.id = (v_new->>'carrier_id')::uuid;
  for i in 1 .. tg_nargs - 1 loop
    k := tg_argv[i];
    if (v_old->k) is distinct from (v_new->k) then
      perform public.record_settings_audit(v_tenant, tg_argv[0], (v_new->>'carrier_id') || '.' || k,
        coalesce(v_carrier, 'Carrier') || ' › ' || public.settings_audit_label(k), v_old->k, v_new->k, nullif(v_new->>'updated_by', '')::uuid, 'ui', null);
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists settings_audit_capture on public.tenant_carrier_settings;
create trigger settings_audit_capture after insert or update on public.tenant_carrier_settings
  for each row execute function public.settings_audit_carrier_columns('sales-carriers', 'portal_origin', 'reference_pattern', 'billing_descriptor');
drop trigger if exists settings_audit_capture on public.carrier_operating_settings;
create trigger settings_audit_capture after insert or update on public.carrier_operating_settings
  for each row execute function public.settings_audit_carrier_columns('carrier-rules', 'commission_trigger', 'expected_lag_days', 'minimum_payout_cents', 'tolerance_cents', 'expected_cadence', 'statement_format');

-- carrier_retention_rule is versioned: a change is a new row from a date. Compared with the agency's
-- previous version of the same rule (or nothing); the source and note are the reason.
create or replace function public.settings_audit_carrier_rule()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_prev public.carrier_retention_rule%rowtype;
  v_carrier text;
  v_fields text[] := array['window_days', 'grace_days', 'redraft_attempts', 'redraft_interval_days', 'cleared'];
  k text;
  v_old jsonb;
  v_new jsonb := to_jsonb(new);
begin
  if new.tenant_id is null then
    return null;
  end if;
  select * into v_prev from public.carrier_retention_rule r
   where r.tenant_id = new.tenant_id and r.carrier_id = new.carrier_id and r.rule_type = new.rule_type and r.id <> new.id
   order by r.effective_from desc, r.created_at desc limit 1;
  v_old := case when v_prev.id is null then '{}'::jsonb else to_jsonb(v_prev) end;
  select c.name into v_carrier from public.carriers c where c.id = new.carrier_id;
  foreach k in array v_fields loop
    if (v_old->k) is distinct from (v_new->k) and not (k = 'cleared' and v_prev.id is null and not new.cleared) then
      perform public.record_settings_audit(new.tenant_id, 'carrier-rules', new.carrier_id || '.' || new.rule_type || '.' || k,
        coalesce(v_carrier, 'Carrier') || ' › ' || public.settings_audit_label(new.rule_type) || ' › ' || public.settings_audit_label(k),
        v_old->k, v_new->k, new.created_by, 'ui',
        nullif(concat_ws(' · ', 'from ' || new.effective_from, 'source: ' || replace(new.source, '_', ' '), new.notes), ''),
        case when k = 'cleared' and new.cleared then 'reset_to_default' end);
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists settings_audit_capture on public.carrier_retention_rule;
create trigger settings_audit_capture after insert on public.carrier_retention_rule
  for each row execute function public.settings_audit_carrier_rule();

revoke all on function public.settings_audit_from_change_table(), public.settings_audit_sales_settings(), public.settings_audit_carrier_columns(), public.settings_audit_carrier_rule(), public.settings_audit_is_append_only() from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- Backfill: what the three change tables already hold
-- --------------------------------------------------------------------------

insert into public.settings_audit (tenant_id, section_key, setting_key, setting_label, old_value, new_value, change_type, actor_user_id, actor_role, occurred_at, source)
select c.tenant_id, 'accounting', c.field, public.settings_audit_label(c.field), public.settings_audit_text(c.old_value), public.settings_audit_text(c.new_value),
       case when c.old_value is null then 'create' when c.new_value is null then 'delete' else 'update' end, u.id, null, c.changed_at, 'migration'
  from public.accounting_setting_change c left join public.users u on u.id = c.changed_by
 where not exists (select 1 from public.settings_audit a where a.tenant_id = c.tenant_id and a.section_key = 'accounting' and a.setting_key = c.field and a.occurred_at = c.changed_at);

insert into public.settings_audit (tenant_id, section_key, setting_key, setting_label, old_value, new_value, change_type, actor_user_id, actor_role, occurred_at, source)
select c.tenant_id, 'compliance', c.section || '.' || c.setting, public.settings_audit_label(c.section || '.' || c.setting), public.settings_audit_text(c.old_value), public.settings_audit_text(c.new_value),
       case when c.old_value is null then 'create' when c.new_value is null then 'delete' else 'update' end, c.changed_by, null, c.changed_at, 'migration'
  from public.compliance_setting_change c
 where not exists (select 1 from public.settings_audit a where a.tenant_id = c.tenant_id and a.section_key = 'compliance' and a.setting_key = c.section || '.' || c.setting and a.occurred_at = c.changed_at);

insert into public.settings_audit (tenant_id, section_key, setting_key, setting_label, old_value, new_value, change_type, actor_user_id, actor_role, occurred_at, source)
select c.tenant_id, 'retention', c.setting, public.settings_audit_label(c.setting), public.settings_audit_text(c.old_value), public.settings_audit_text(c.new_value),
       case when c.old_value is null then 'create' when c.new_value is null then 'delete' else 'update' end, c.changed_by, null, c.changed_at, 'migration'
  from public.retention_setting_change c
 where not exists (select 1 from public.settings_audit a where a.tenant_id = c.tenant_id and a.section_key = 'retention' and a.setting_key = c.setting and a.occurred_at = c.changed_at);

-- --------------------------------------------------------------------------
-- Self-check: the log refuses change, even from the service role
-- --------------------------------------------------------------------------

do $$
declare
  v_left text;
begin
  select string_agg(p, ', ') into v_left
    from unnest(array['UPDATE', 'DELETE', 'TRUNCATE']) p
   where has_table_privilege('service_role', 'public.settings_audit', p)
      or has_table_privilege('authenticated', 'public.settings_audit', p);
  if v_left is not null then
    raise exception 'LA-8.8: settings_audit still allows %', v_left;
  end if;
  if (select count(*) from pg_trigger where tgname = 'settings_audit_capture' and not tgisinternal) < 7 then
    raise exception 'LA-8.8: a hub is not writing to settings_audit';
  end if;
end;
$$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261015360000', 'la_8_8_settings_audit') on conflict do nothing;
  end if;
end $bundle$;
commit;
