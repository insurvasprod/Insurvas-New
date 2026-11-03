-- Agent Floor redesign: "Idle 2m", "Wrap-up 3m", and "Transfers closed this hour".
--
-- 1. agent_presence.status_changed_at — when the member's status last CHANGED. updated_at cannot
--    say this: the floor heartbeat upserts the same status every 20 seconds, and the touch trigger
--    moves updated_at on every one of them, so updated_at is really "last heartbeat". A trigger sets
--    status_changed_at on insert and only when status is distinct from the old row; the heartbeat
--    carries the column over untouched. Existing rows are backfilled from updated_at, which is the
--    best evidence there is (it is at least no earlier than the change).
--
-- 2. Two partial indexes for the floor's per-tenant reads: inbound transfers dispositioned in the
--    last two hours (the KPI and its "vs last hour"), and each member's latest ended call ("After
--    {customer}"). Both reads are cached per tenant for ~30s in the app, so these keep the refresh
--    cheap rather than making a hot path possible.
--
-- Additive and idempotent. Until this is applied the floor reads presence without the column and
-- shows "Available" / "Wrap-up" with no duration.

alter table public.agent_presence add column if not exists status_changed_at timestamptz;

-- Backfill without moving updated_at (the touch trigger would stamp every row with now(), which the
-- partner "agent ready" event key reads). Small table: one row per floor member.
alter table public.agent_presence disable trigger agent_presence_touch_updated_at;
update public.agent_presence set status_changed_at = updated_at where status_changed_at is null;
alter table public.agent_presence enable trigger agent_presence_touch_updated_at;

alter table public.agent_presence alter column status_changed_at set default now();

create or replace function public.stamp_agent_presence_status_changed_at()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    new.status_changed_at := coalesce(new.status_changed_at, now());
  elsif new.status is distinct from old.status then
    new.status_changed_at := now();
  else
    -- A heartbeat re-sending the same status keeps the original moment.
    new.status_changed_at := old.status_changed_at;
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_agent_presence_status_changed_at() from public;

drop trigger if exists agent_presence_status_changed_at on public.agent_presence;
create trigger agent_presence_status_changed_at
before insert or update on public.agent_presence
for each row execute function public.stamp_agent_presence_status_changed_at();

create index if not exists lead_queue_inbound_disposed_idx
  on public.lead_queue (tenant_id, disposition_at desc)
  where partner_id is not null and disposition_at is not null;

create index if not exists active_calls_ended_idx
  on public.active_calls (tenant_id, ended_at desc)
  where ended_at is not null;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'agent_presence' and column_name = 'status_changed_at'
  ) then
    raise exception 'agent_presence.status_changed_at was not added';
  end if;
  if exists (select 1 from public.agent_presence where status_changed_at is null) then
    raise exception 'agent_presence.status_changed_at was not backfilled';
  end if;
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'agent_presence' and t.tgname = 'agent_presence_status_changed_at' and not t.tgisinternal and t.tgenabled <> 'D'
  ) then
    raise exception 'agent_presence_status_changed_at trigger is missing';
  end if;
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'agent_presence' and t.tgname = 'agent_presence_touch_updated_at' and t.tgenabled <> 'D'
  ) then
    raise exception 'agent_presence_touch_updated_at was left disabled';
  end if;
  if to_regclass('public.lead_queue_inbound_disposed_idx') is null or to_regclass('public.active_calls_ended_idx') is null then
    raise exception 'agent floor indexes are missing';
  end if;
end;
$$;
