-- LA-4.9 follow-up · a provisional contact must say which carrier file it came from.
--
-- 20261008180000 checked `not provisional or jsonb_typeof(provisional_source) = 'object'`. With no
-- source at all, jsonb_typeof(null) is null and a CHECK lets null through — so a contact could be
-- marked provisional with nothing saying where it came from (found by the live verification,
-- 2026-10-07). The source is now required. No provisional contact existed when this was written.
--
-- Rollback: re-add the 20261008180000 form of contacts_provisional_source.

alter table public.contacts drop constraint if exists contacts_provisional_source;
alter table public.contacts add constraint contacts_provisional_source
  check (not provisional or (provisional_source is not null and jsonb_typeof(provisional_source) = 'object'));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contacts_provisional_source' and pg_get_constraintdef(oid) like '%provisional_source IS NOT NULL%') then
    raise exception '20261008180100: the provisional source is still optional';
  end if;
end $$;
