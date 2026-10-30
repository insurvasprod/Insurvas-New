-- A carrier can be active for appointments and partner markets before the agency records
-- financial details. Keep writing_number non-null for existing consumers, but allow it blank.
begin;

alter table public.tenant_carriers
  drop constraint if exists tenant_carriers_writing_number_check;

alter table public.tenant_carriers
  add constraint tenant_carriers_writing_number_check
  check (length(trim(writing_number)) between 0 and 120);

commit;
