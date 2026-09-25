-- Partner portal › Messages › Details: the agency's "Support" email and "Phone".
--
-- The board shows partners who to contact at the agency. Nothing stored that: tenants has a name
-- only, business_profiles is the signup questionnaire, and agency_profiles (20260924100000) is the
-- legal identity — with a NOT NULL legal name an owner would have to fill before they could give a
-- phone number, and not applied yet either. Two nullable columns on tenants are the smallest honest
-- home: one row per agency, which is exactly what the partner portal reads.
--
-- Written by the owner through /api/app/partner-support-contact (service role, owner checked in the
-- API — the same arrangement as the agency profile). Read by /api/partner/chat, scoped to the
-- signed-in partner's own tenant. Until this is applied the API reports schemaReady=false and the
-- partner panel hides the two rows; saving returns 503.
--
-- Additive and idempotent. Grants are unchanged: tenants already grants select to tenant_app under
-- tenant_self_read, and every write goes through service_role.

alter table public.tenants add column if not exists support_email text;
alter table public.tenants add column if not exists support_phone text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenants_support_email_format' and conrelid = 'public.tenants'::regclass) then
    alter table public.tenants add constraint tenants_support_email_format
      check (support_email is null or (length(support_email) <= 254 and support_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenants_support_phone_format' and conrelid = 'public.tenants'::regclass) then
    alter table public.tenants add constraint tenants_support_phone_format
      check (support_phone is null or (length(support_phone) <= 32 and length(regexp_replace(support_phone, '[^0-9]', '', 'g')) between 7 and 15));
  end if;
end;
$$;

comment on column public.tenants.support_email is
  'Shown to this agency''s partners as "Support" in partner portal Messages. Set by an owner.';
comment on column public.tenants.support_phone is
  'Shown to this agency''s partners as "Phone" in partner portal Messages. Stored as typed; formatted for display.';

-- PostgREST caches the schema; without this the new columns 404 (PGRST204) until the next reload.
notify pgrst, 'reload schema';
