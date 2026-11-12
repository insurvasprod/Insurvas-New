-- Settings round 8 · Lead posting, option A "Vendor list + vendor sheet" (owner pick 2026-11-12).
--
-- The screen and the post path ship before this file is applied. Every read below is probed by the
-- app (lib/leadPost/boardStore.ts `leadPostR8Ready`) and every write that needs a column here
-- answers "needs a database update" until it exists. What this adds, per key (the vendor's posting
-- settings travel with its key, as the field map already does):
--
--   test_mode                 posts run every check and stop before a lead or a charge is made
--   price_cents               price per accepted lead (refused and test posts are never charged)
--   daily_cap                 accepted posts per agency day; past it a post is refused politely
--   posting_hours             {days:[0-6], start:"HH:MM", end:"HH:MM", timeZone}; null = any time
--   status_callback_url/_events   we call the vendor's address when a lead is accepted or refused
--   status_callback_last_at/_status   the last call and the HTTP status it got
--   grace_until               a rotated-out key keeps working until this moment
--   notes                     the owner's own notes about the vendor
--   instructions_*            who the instructions were sent to, the public link's token hash, and
--                             how often it was opened
--
-- and, on the post log, `is_test` so test posts never count as leads, spend or rejections, plus two
-- reason codes: daily_cap_reached and outside_posting_hours.
--
-- Idempotent: add column if not exists, constraints dropped and re-added.
-- Rollback: drop the columns below and restore the reason-code check from 20260924240000.

-- ── posting keys ───────────────────────────────────────────────────────────
alter table public.tenant_vendor_post_keys
  add column if not exists test_mode boolean not null default false,
  add column if not exists price_cents integer,
  add column if not exists daily_cap integer,
  add column if not exists posting_hours jsonb,
  add column if not exists status_callback_url text,
  add column if not exists status_callback_events text[] not null default '{}'::text[],
  add column if not exists status_callback_last_at timestamptz,
  add column if not exists status_callback_last_status integer,
  add column if not exists grace_until timestamptz,
  add column if not exists notes text,
  add column if not exists instructions_email text,
  add column if not exists instructions_sent_at timestamptz,
  add column if not exists instructions_token_hash text,
  add column if not exists instructions_opened_count integer not null default 0,
  add column if not exists instructions_last_opened_at timestamptz;

alter table public.tenant_vendor_post_keys drop constraint if exists tenant_vendor_post_keys_r8_price_check;
alter table public.tenant_vendor_post_keys
  add constraint tenant_vendor_post_keys_r8_price_check check (price_cents is null or price_cents between 0 and 10000000);

alter table public.tenant_vendor_post_keys drop constraint if exists tenant_vendor_post_keys_r8_cap_check;
alter table public.tenant_vendor_post_keys
  add constraint tenant_vendor_post_keys_r8_cap_check check (daily_cap is null or daily_cap between 1 and 100000);

alter table public.tenant_vendor_post_keys drop constraint if exists tenant_vendor_post_keys_r8_hours_check;
alter table public.tenant_vendor_post_keys
  add constraint tenant_vendor_post_keys_r8_hours_check check (posting_hours is null or jsonb_typeof(posting_hours) = 'object');

alter table public.tenant_vendor_post_keys drop constraint if exists tenant_vendor_post_keys_r8_callback_check;
alter table public.tenant_vendor_post_keys
  add constraint tenant_vendor_post_keys_r8_callback_check check (
    (status_callback_url is null or (status_callback_url ~ '^https://' and char_length(status_callback_url) <= 500))
    and status_callback_events <@ array['accepted', 'refused', 'contacted', 'sold']::text[]
  );

alter table public.tenant_vendor_post_keys drop constraint if exists tenant_vendor_post_keys_r8_text_check;
alter table public.tenant_vendor_post_keys
  add constraint tenant_vendor_post_keys_r8_text_check check (
    (notes is null or char_length(notes) <= 2000)
    and (instructions_email is null or char_length(instructions_email) <= 320)
  );

-- The public instructions page is found by its token's hash, never by the key or the workspace.
create unique index if not exists tenant_vendor_post_keys_instructions_token_idx
  on public.tenant_vendor_post_keys (instructions_token_hash) where instructions_token_hash is not null;

-- A rotated-out key in its grace window is looked up by hash like any other; this keeps the sweep cheap.
create index if not exists tenant_vendor_post_keys_grace_idx
  on public.tenant_vendor_post_keys (grace_until) where grace_until is not null;

-- The tenant role reads this table column by column (never the hashes). The new readable columns
-- join that list; service_role already holds table-wide rights.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'tenant_app') then
    grant select (test_mode, price_cents, daily_cap, posting_hours, status_callback_url, status_callback_events,
                  status_callback_last_at, status_callback_last_status, grace_until, notes, instructions_email,
                  instructions_sent_at, instructions_opened_count, instructions_last_opened_at)
      on public.tenant_vendor_post_keys to tenant_app;
  end if;
end $$;

-- ── the post log ───────────────────────────────────────────────────────────
alter table public.tenant_lead_post_log
  add column if not exists is_test boolean not null default false;

-- The vendor table reads each vendor's last 7 days.
create index if not exists tenant_lead_post_log_vendor_received_idx
  on public.tenant_lead_post_log (tenant_id, vendor_id, received_at desc);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'tenant_app') then
    grant select (is_test) on public.tenant_lead_post_log to tenant_app;
  end if;
end $$;

alter table public.tenant_lead_post_log
  drop constraint if exists tenant_lead_post_log_reason_code_check;

alter table public.tenant_lead_post_log
  add constraint tenant_lead_post_log_reason_code_check check (reason_code in (
    'accepted',
    'duplicate',
    'suppressed_litigator',
    'suppressed_internal',
    'suppressed_dnc',
    'invalid_phone',
    'missing_required_field',
    'unknown_state',
    'campaign_not_accepting',
    'scrub_unavailable',
    'rate_limited',
    'unauthorised',
    'missing_consent_text',
    'missing_consent_ip',
    'invalid_date_of_birth',
    'state_not_licensed',
    'daily_cap_reached',
    'outside_posting_hours'
  ));

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenant_vendor_post_keys' and column_name = 'grace_until') then
    raise exception '20261112100100: tenant_vendor_post_keys.grace_until is missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenant_lead_post_log' and column_name = 'is_test') then
    raise exception '20261112100100: tenant_lead_post_log.is_test is missing';
  end if;
end $$;
