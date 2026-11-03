-- LA-1 audit · a presence heartbeat no longer reloads every open floor and inbox.
--
-- Every agent's floor sends a heartbeat every 20 seconds (it re-saves the same status to keep the
-- agent on the floor). agent_presence_floor_broadcast (20260903130000) fired on EVERY update, so each
-- heartbeat broadcast floor_changed and every open Agent Floor and transfer inbox in the agency
-- refetched: with 30 agents online, that is a full reload on every screen about every 0.7 seconds.
--
-- The presence trigger now broadcasts when someone joins or leaves the table, or when an agent's
-- STATUS changes. A heartbeat (last_seen_at only) is silent; staleness is read by the next reload.
-- The other floor triggers are unchanged. The client also coalesces bursts (agent-floor.tsx,
-- transfer-inbox.tsx).

drop trigger if exists agent_presence_floor_broadcast on public.agent_presence;
create trigger agent_presence_floor_broadcast
after insert or delete on public.agent_presence
for each row execute function public.broadcast_la_1_15_floor_change();

drop trigger if exists agent_presence_floor_broadcast_status on public.agent_presence;
create trigger agent_presence_floor_broadcast_status
after update on public.agent_presence
for each row
when (old.status is distinct from new.status)
execute function public.broadcast_la_1_15_floor_change();

-- ─── self-check ──────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.agent_presence'::regclass and t.tgname = 'agent_presence_floor_broadcast_status'
       and pg_get_triggerdef(t.oid) like '%old.status IS DISTINCT FROM new.status%'
  ) then
    raise exception '20261015594000: the status-only presence broadcast is missing';
  end if;
  if exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.agent_presence'::regclass and t.tgname = 'agent_presence_floor_broadcast'
       and (t.tgtype & 16) <> 0
  ) then
    raise exception '20261015594000: agent_presence_floor_broadcast still fires on every update (heartbeat)';
  end if;
end
$$;
