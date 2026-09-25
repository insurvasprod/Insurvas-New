-- ---------------------------------------------------------------------------
-- LA-1 · §16, precaution 2 · the inbound telephony seam
--
-- Module 1 decides that telephony is out of scope, and then asks for three cheap precautions so it
-- can be added later without a rewrite:
--
--   1. "Keep an `active_call` record even without a provider." — built. `public.active_calls`,
--      opened at claim, closed at disposition, and it is what the Agent Floor reads to answer
--      "is anyone talking".
--   2. "Leave a `provider_call_id` column on it, nullable. One column now saves a migration later."
--      — NOT built. This migration is that column.
--   3. "Never let call state be inferred from work-item state." — built. The floor derives
--      `on_call` from an open `active_calls` row, never from `lead_queue.status`.
--
-- The OUTBOUND plane took the identical precaution and said so at the time, under a header reading
-- "THE SEAM": `tenant_call_attempts.provider_call_id` is nullable from the start, because
-- "leaving the column out until one arrives would mean migrating a table that by then has history
-- in it." That argument is not weaker on the inbound side — `active_calls` accrues a row per claim,
-- so it fills up faster than the outbound attempts table does.
--
-- Nothing reads this column yet, and that is the point of it. It is a seam, not a feature: when a
-- provider arrives, the row that already exists gets an id instead of a new table getting a
-- backfill. The guard in lib/transferInbox/telephonySeam.test.mjs keeps both planes' seams open so
-- a later tidy-up cannot remove an "unused" column that is unused on purpose.
-- ---------------------------------------------------------------------------

alter table public.active_calls
  add column if not exists provider_call_id text;

-- Partial, because the overwhelming majority of rows will carry no provider id for as long as
-- telephony stays out of scope, and an index over a column that is null everywhere is pure cost.
-- When a provider does arrive, looking a call up by the id it gave us is the first thing anything
-- will need to do.
create index if not exists active_calls_provider_call_idx
  on public.active_calls (tenant_id, provider_call_id)
  where provider_call_id is not null;

comment on column public.active_calls.provider_call_id is
  'Telephony provider''s own call id. Null while Module 1 has no telephony; the seam LA-1 §16 asks for.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'active_calls' and column_name = 'provider_call_id'
  ) then
    raise exception 'active_calls.provider_call_id did not land';
  end if;

  -- Precaution 3, asserted rather than assumed: the column must be nullable. A NOT NULL provider id
  -- on a table written at claim time would make every claim depend on a provider that does not
  -- exist, which is the opposite of a seam.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'active_calls'
       and column_name = 'provider_call_id' and is_nullable = 'NO'
  ) then
    raise exception 'active_calls.provider_call_id must stay nullable while telephony is out of scope';
  end if;
end $$;
