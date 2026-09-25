-- Let the tenant plane write to the rest of the tables it shares.
--
-- Third time for the same defect, so this time it is done by survey rather than one table at a
-- time. 20260912100000 made partners and partner_users nullable; partner_products then failed the
-- same way an hour later, costing LA-1.3 five approval criteria.
--
-- `organization_id` belongs to the organizations-era product. The tenant plane scopes by tenant_id
-- and never populates it, so a shared table where the column is NOT NULL rejects every write this
-- application makes:
--
--   23502 null value in column "organization_id" violates not-null constraint
--
-- scripts/check-orphan-org-columns.mjs surveys this: 146 live tables require the column, and 12 of
-- them are tables this repo writes to. Nine are handled here.
--
-- THREE ARE DELIBERATELY EXCLUDED:
--   invoices, invoice_lines  -- the organizations-era invoice tables. SA-3 moved the SaaS side to
--                               platform_invoices, so this plane should not be writing here at all;
--                               making them nullable would hide that rather than fix it.
--   organization_members     -- squarely the other product's membership table.
--
-- The foreign keys stay. A row that carries an organization_id must still point at a real one.
-- Existing rows are untouched, and the other product keeps populating the column on its own writes.
--
-- Reversible per table with `set not null`, which will only succeed once no tenant-plane rows
-- remain -- take that as the signal that the tables have been properly separated.

alter table public.contacts          alter column organization_id drop not null;
alter table public.contact_phones    alter column organization_id drop not null;
alter table public.contact_emails    alter column organization_id drop not null;
alter table public.households        alter column organization_id drop not null;
alter table public.callbacks         alter column organization_id drop not null;
alter table public.lead_sla_events   alter column organization_id drop not null;
alter table public.partner_products  alter column organization_id drop not null;
alter table public.screening_results alter column organization_id drop not null;
alter table public.screening_audit   alter column organization_id drop not null;
