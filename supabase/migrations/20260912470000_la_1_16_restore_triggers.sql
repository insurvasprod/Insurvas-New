-- Restore LA-1.16's five triggers. All five functions exist; not one of the triggers does.
--
-- 20260903140000 declares five triggers for partner chat. Every one of their functions is present in
-- this database and every one of the triggers is absent:
--
--   partners_create_chat_channel            after insert on partners
--   partners_archive_chat_channel           after update of status on partners
--   partner_messages_normalize_disposition  before insert on partner_messages
--   partner_messages_broadcast              after insert on partner_messages
--   partner_messages_audit                  after insert on partner_messages
--
-- public.partners carries only partners_enforce_limit; public.partner_messages carries none at all.
-- Same shape as tenants_seed_pipelines, which 20260912270000 had to restore for the same reason.
--
-- The consequence is not subtle. public.partner_channels holds ZERO rows and all seven partners have
-- no channel, so channelFor() throws "Partner channel is not available" on every attempt to post a
-- card. That error has been in the dev server log continuously all week, during LA-1.7, LA-1.10 and
-- LA-1.14 runs, and it is the same one cause each time.
--
-- What it breaks, beyond the obvious:
--
--   every partner system card    new lead, connected, transferred, nobody-claimed -- all fail
--   LA-1.14 criterion 5          "a buffer claim posts the connected card exactly once"
--   channel archival             a paused or offboarded partner keeps a live channel, if one existed
--   partner message broadcast    realtime delivery never fires
--   partner message audit        messages are written with no audit row
--
-- Two of those are silent by design -- LA-1.7 makes card posting best-effort so a chat failure cannot
-- fail an accepted lead, which is right, and is exactly why nobody noticed for a month. The audit and
-- broadcast gaps have no such excuse: they simply never ran.
--
-- The trigger definitions below are 20260903140000's, unchanged. Only the backfill is new.

drop trigger if exists partners_create_chat_channel on public.partners;
create trigger partners_create_chat_channel
after insert on public.partners
for each row execute function public.ensure_partner_channel();

drop trigger if exists partners_archive_chat_channel on public.partners;
create trigger partners_archive_chat_channel
after update of status on public.partners
for each row execute function public.archive_partner_channel();

drop trigger if exists partner_messages_normalize_disposition on public.partner_messages;
create trigger partner_messages_normalize_disposition
before insert on public.partner_messages
for each row execute function public.normalize_partner_disposition_card();

drop trigger if exists partner_messages_broadcast on public.partner_messages;
create trigger partner_messages_broadcast
after insert on public.partner_messages
for each row execute function public.broadcast_partner_message();

drop trigger if exists partner_messages_audit on public.partner_messages;
create trigger partner_messages_audit
after insert on public.partner_messages
for each row execute function public.audit_partner_message();

-- Backfill a channel for every partner that predates the trigger, which is all of them.
-- ensure_partner_channel() is a trigger function and cannot be called directly, so this repeats its
-- single insert verbatim, including the conflict target, rather than approximating it.
insert into public.partner_channels (tenant_id, partner_id, name)
select p.tenant_id, p.id, p.name || ' channel'
from public.partners p
on conflict (tenant_id, partner_id, channel_type) do nothing;

-- Assert both halves: the triggers are attached, and no partner is left without a channel. The
-- insert above is the shape that has silently matched nothing twice this week.
do $$
declare
  missing_triggers text;
  partners_without_channel integer;
begin
  select string_agg(t.name, ', ') into missing_triggers
  from unnest(array[
    'partners_create_chat_channel',
    'partners_archive_chat_channel',
    'partner_messages_normalize_disposition',
    'partner_messages_broadcast',
    'partner_messages_audit'
  ]) as t(name)
  where not exists (select 1 from pg_trigger g where g.tgname = t.name and not g.tgisinternal);

  if missing_triggers is not null then
    raise exception 'triggers still missing: %', missing_triggers;
  end if;

  select count(*) into partners_without_channel
  from public.partners p
  where not exists (
    select 1 from public.partner_channels c
     where c.partner_id = p.id and c.channel_type = 'partner'
  );

  if partners_without_channel > 0 then
    raise exception '% partner(s) still have no chat channel', partners_without_channel;
  end if;
end;
$$;
