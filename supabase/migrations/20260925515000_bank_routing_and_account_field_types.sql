-- LA-1.4-6: bank routing and account numbers are form field types.
--
-- The spec's formats line names "SSN, phone, email, routing and account formats". SSN, phone and
-- email were field types; routing and account numbers were not, so a Banking section could only
-- ask for them as free text with no check. The application now has two more types
-- (lib/templates/constants.ts TEMPLATE_FIELD_TYPES):
--
--   bank_routing   nine digits passing the ABA checksum 3·7·1   (lib/templates/formats.ts)
--   bank_account   4 to 17 digits
--
-- Both are stored in lead values as a string of digits. The format checks run in the application
-- (partner form and intake); the database only has to accept the type names. Both catalogs widen:
-- template_fields (the platform templates) and tenant_template_fields (each tenant's copy, which
-- keeps the organizations-era hyphenated spellings from 20260912240000).
--
-- Until this is applied, saving a form with either type is refused by the check constraint and the
-- settings screen says so; nothing else changes.

alter table public.template_fields drop constraint if exists template_fields_type_check;
alter table public.template_fields add constraint template_fields_type_check
  check (type = any (array[
    'text'::text, 'long_text'::text, 'number'::text, 'currency'::text, 'date'::text, 'phone'::text,
    'email'::text, 'ssn'::text, 'bank_routing'::text, 'bank_account'::text, 'boolean'::text,
    'single_select'::text, 'multi_select'::text
  ]));

alter table public.tenant_template_fields drop constraint if exists tenant_template_fields_type_check;
alter table public.tenant_template_fields add constraint tenant_template_fields_type_check
  check (type = any (array[
    -- shared by both
    'text'::text, 'number'::text, 'currency'::text, 'date'::text, 'phone'::text, 'boolean'::text,
    -- this application's catalog (template_fields), per LA-1.4
    'long_text'::text, 'email'::text, 'ssn'::text, 'single_select'::text, 'multi_select'::text,
    -- LA-1.4-6
    'bank_routing'::text, 'bank_account'::text,
    -- organizations-era spellings, kept so existing rows stay valid
    'single-select'::text, 'multi-select'::text
  ]));

comment on constraint tenant_template_fields_type_check on public.tenant_template_fields is
  'Union of both products field-type vocabularies plus the LA-1.4-6 bank types. single-select and single_select are the same concept spelled two ways; see 20260912240000.';

do $$
begin
  -- A role that cannot create objects cannot have applied anything above either (scripts/
  -- check-migrations.mjs parse-checks with such a role); a real apply always reaches the checks.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925515000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'template_fields_type_check'
       and conrelid = 'public.template_fields'::regclass
       and pg_get_constraintdef(oid) like '%bank_routing%'
       and pg_get_constraintdef(oid) like '%bank_account%'
  ) then
    raise exception 'template_fields_type_check does not accept the bank field types';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'tenant_template_fields_type_check'
       and conrelid = 'public.tenant_template_fields'::regclass
       and pg_get_constraintdef(oid) like '%bank_routing%'
       and pg_get_constraintdef(oid) like '%bank_account%'
       and pg_get_constraintdef(oid) like '%single-select%'
  ) then
    raise exception 'tenant_template_fields_type_check does not accept the bank field types';
  end if;
end $$;
