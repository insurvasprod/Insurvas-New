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
