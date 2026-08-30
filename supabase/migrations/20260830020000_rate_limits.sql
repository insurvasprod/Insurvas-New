-- Rate limiting for unauthenticated endpoints (added after the SA-5.1 review).
--
-- Database-backed rather than in-memory: the app runs on serverless instances that do not share
-- memory, so an in-process counter would reset on every cold start and let an attacker clear the
-- limit simply by spreading requests around.

create table if not exists public.rate_limits (
  bucket_key    text        not null,
  window_start  timestamptz not null,
  hits          integer     not null default 0,
  primary key (bucket_key, window_start)
);

comment on table public.rate_limits is
  'Fixed-window counters for public endpoints. Rows older than their window are disposable.';

create index if not exists rate_limits_window_idx on public.rate_limits (window_start);

alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from tenant_app, anon, authenticated;

/**
 * Claims one request against a fixed window. Returns true when the caller is allowed through.
 *
 * The check and the increment are ONE statement: reading a count and then incrementing it lets two
 * concurrent requests both see the last remaining slot, which is precisely the burst a rate limit
 * exists to stop. Verified with ten concurrent claims against a cap of three.
 */
create or replace function public.claim_rate_limit(
  p_key             text,
  p_max             integer,
  p_window_seconds  integer
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_hits   integer;
begin
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limits (bucket_key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (bucket_key, window_start)
    do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;

  return v_hits <= p_max;
end;
$$;

revoke execute on function public.claim_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_rate_limit(text, integer, integer) to service_role;

/** Housekeeping: windows older than a day can never be consulted again. */
create or replace function public.prune_rate_limits()
returns integer language plpgsql as $$
declare v_count integer;
begin
  with removed as (
    delete from public.rate_limits where window_start < now() - interval '1 day' returning 1
  )
  select count(*) into v_count from removed;
  return v_count;
end;
$$;
