-- LA-2.2-4 · the calling zone a list import corrected, stored where the dialer can read it.
--
-- Florida's panhandle and middle and west Tennessee keep Central time while the rest of each state
-- is Eastern. The importer has always known that from the first three ZIP digits, but it only
-- applied the correction when the lead template had a timezone field, and even then the answer went
-- into the lead's form values, which the dialer never reads: the calling window takes the zone from
-- the state (FL = New York, TN = Chicago). A Pensacola lead was dialled on Eastern time.
--
-- agent_leads.dial_timezone is the zone the dialer uses INSTEAD of the state's. The importer sets it
-- only when a split-zone ZIP (or, for a Florida or Tennessee row with no ZIP, the file's own label
-- naming one of that state's two zones) decides it, whether or not the template has a timezone
-- field. Null means the state's zone is right, which is every other lead.
--
-- A stored zone goes stale the moment the lead's state, ZIP or timezone is edited, so a trigger
-- clears it then and the lead falls back to its (corrected) state. The serve functions belong to the
-- dialer work: they read coalesce(l.dial_timezone, <the state's zone>).

alter table public.agent_leads add column if not exists dial_timezone text;

alter table public.agent_leads drop constraint if exists agent_leads_dial_timezone_check;
alter table public.agent_leads add constraint agent_leads_dial_timezone_check
  check (dial_timezone is null or dial_timezone ~ '^(America|Pacific)/[A-Za-z_]+(/[A-Za-z_]+)?$');

comment on column public.agent_leads.dial_timezone is
  'IANA zone the dialer uses instead of the state''s: set at import from a split-zone ZIP (FL panhandle, middle/west TN). Null = use the state''s zone. Cleared when state, zip, postal_code or timezone in values changes.';

create or replace function public.agent_leads_clear_stale_dial_timezone()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $function$
begin
  -- Only a zone nobody touched in this same update is stale. An update that sets dial_timezone
  -- itself (the importer, or a later correction) keeps what it set.
  if new.dial_timezone is not null
     and new.dial_timezone is not distinct from old.dial_timezone
     and (
       (new.values->>'state') is distinct from (old.values->>'state')
       or coalesce(new.values->>'zip', new.values->>'postal_code') is distinct from coalesce(old.values->>'zip', old.values->>'postal_code')
       or (new.values->>'timezone') is distinct from (old.values->>'timezone')
     ) then
    new.dial_timezone := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists agent_leads_clear_stale_dial_timezone on public.agent_leads;
create trigger agent_leads_clear_stale_dial_timezone
  before update of values on public.agent_leads
  for each row execute function public.agent_leads_clear_stale_dial_timezone();

-- ── proof ──────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_body text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709600: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if not exists (
    select 1 from pg_attribute
     where attrelid = 'public.agent_leads'::regclass and attname = 'dial_timezone' and not attisdropped
  ) then
    raise exception '20260925709600: agent_leads.dial_timezone was not added';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.agent_leads'::regclass and tgname = 'agent_leads_clear_stale_dial_timezone' and not tgisinternal
  ) then
    raise exception '20260925709600: the stale-zone trigger is missing';
  end if;

  v_body := pg_get_constraintdef((select oid from pg_constraint where conname = 'agent_leads_dial_timezone_check' and conrelid = 'public.agent_leads'::regclass));
  if v_body !~ 'America' then
    raise exception '20260925709600: the zone check is missing';
  end if;
end $$;
