-- Let a template copy carry the field types the source template allows.
--
-- `template_fields` is the SA-4.6 catalog. `tenant_template_fields` is the per-tenant copy of it,
-- written by admin_apply_tenant_template. The two disagree about what a field type is:
--
--   template_fields         text, long_text, number, currency, date, phone, email, ssn, boolean,
--                           single_select, multi_select
--   tenant_template_fields  text, number, currency, date, phone, boolean,
--                           single-select, multi-select
--
-- Three types exist only in the source (long_text, email, ssn), and the two select types are spelled
-- with a hyphen in one and an underscore in the other. So copying a template that uses any of them
-- fails:
--
--   23514 new row for relation "tenant_template_fields" violates check constraint
--         "tenant_template_fields_type_check"
--
-- which is where LA-1.4 stops: no tenant-owned form copy, and every later check needs the copy id.
-- LA-1.4's own scope names email and SSN explicitly among the field types, so the source list is
-- the intended one.
--
-- Widening to the union rather than rewriting either side. The hyphenated spellings belong to the
-- organizations-era rows and dropping them would invalidate data already written; the underscored
-- ones are what this application produces. Both stay legal.
--
-- Worth naming the cost, because it is the same cost as 20260912130000: two spellings of the same
-- concept now coexist, and anything that groups by type will treat single-select and single_select
-- as different. The fix for that is one vocabulary, which means deciding whether these two products
-- converge -- the same open question sitting behind the partner status vocabularies.

alter table public.tenant_template_fields drop constraint if exists tenant_template_fields_type_check;

alter table public.tenant_template_fields add constraint tenant_template_fields_type_check
  check (type = any (array[
    -- shared by both
    'text'::text, 'number'::text, 'currency'::text, 'date'::text, 'phone'::text, 'boolean'::text,
    -- this application's catalog (template_fields), per LA-1.4
    'long_text'::text, 'email'::text, 'ssn'::text, 'single_select'::text, 'multi_select'::text,
    -- organizations-era spellings, kept so existing rows stay valid
    'single-select'::text, 'multi-select'::text
  ]));

comment on constraint tenant_template_fields_type_check on public.tenant_template_fields is
  'Union of both products field-type vocabularies. single-select and single_select are the same concept spelled two ways; see 20260912240000.';
