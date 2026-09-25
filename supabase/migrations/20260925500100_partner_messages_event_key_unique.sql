-- Partner chat cards post once per event (LA-1.16-5).
--
-- The chat service de-duplicates system cards on partner_messages.event_key and relies on a UNIQUE
-- index to refuse the second insert. 20260903120000 created that index as unique, but
-- 20260903140000 declares a plain index with the SAME name, and on the live database the plain one
-- is what exists — so nothing stops a second card. QA on 2026-09-25 found four event keys already
-- duplicated (one new-lead card posted three times).
--
-- This keeps every row: nothing is deleted. The earliest message for each key keeps it; each later
-- duplicate has its key suffixed with ':dup:<id>', so the unique index can be built. The duplicate
-- cards stay visible in the channel; removing them is a separate decision.

-- 1. Retire the later duplicates' keys (earliest created_at, then lowest id, keeps the key).
with ranked as (
  select id, event_key,
         row_number() over (partition by event_key order by created_at, id) as position
    from public.partner_messages
   where event_key is not null
)
update public.partner_messages message
   set event_key = ranked.event_key || ':dup:' || message.id::text
  from ranked
 where ranked.id = message.id
   and ranked.position > 1;

-- 2. Replace the plain index with the unique one it was always meant to be.
drop index if exists public.partner_messages_event_key_idx;
create unique index partner_messages_event_key_idx
  on public.partner_messages (event_key)
  where event_key is not null;

do $$
begin
  -- A role that cannot create objects cannot have applied anything above either (scripts/
  -- check-migrations.mjs parse-checks with such a role); a real apply always reaches the checks.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925500100: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if not exists (
    select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
     where c.relname = 'partner_messages_event_key_idx' and i.indisunique
  ) then
    raise exception 'partner_messages_event_key_idx is not unique';
  end if;
  if exists (
    select 1 from public.partner_messages where event_key is not null
     group by event_key having count(*) > 1
  ) then
    raise exception 'partner_messages still has duplicate event keys';
  end if;
end $$;
