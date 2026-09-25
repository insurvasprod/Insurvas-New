-- Let the tenant plane write partners and partner users.
--
-- `partners.organization_id` and `partner_users.organization_id` are NOT NULL with a foreign key to
-- `organizations`, which belongs to the organizations-era product that shares this database. The
-- tenant plane has no organization: it scopes by `tenant_id`, and none of the four partner RPCs
-- supplies the column --
--
--   partner_invite_user_with_limit · partner_resend_invite
--   partner_set_user_status_with_limit · transition_partner
--
-- so every invitation returns 500 and every lifecycle transition fails. Confirmed live on
-- 2026-09-12 by running scripts/verify-partner-users.mjs: fourteen LA-1.2 acceptance criteria are
-- unreachable, including deactivation, reactivation, offboarding and the audit assertions.
--
-- Relaxing the constraint rather than back-filling a fake organization, because:
--   * existing rows are untouched and keep their organization_id
--   * the other product still populates the column on its own inserts, and its own code path is
--     unchanged
--   * inventing an organization per tenant would put rows into a table this application does not
--     own, which is harder to undo than a dropped NOT NULL
--
-- The foreign key stays. A row that does carry an organization_id must still point at a real one.
--
-- Reversible with:
--   alter table public.partners alter column organization_id set not null;
--   alter table public.partner_users alter column organization_id set not null;
-- which will only succeed once no tenant-plane rows remain, so take that as the signal that the
-- longer-term fix (teaching the RPCs to populate it, or separating the tables) has landed.

alter table public.partners alter column organization_id drop not null;
alter table public.partner_users alter column organization_id drop not null;

comment on column public.partners.organization_id is
  'Organizations-era scope. Null for rows created by the tenant plane, which scopes by tenant_id.';
comment on column public.partner_users.organization_id is
  'Organizations-era scope. Null for rows created by the tenant plane, which scopes by tenant_id.';
