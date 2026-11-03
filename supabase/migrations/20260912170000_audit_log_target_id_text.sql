-- Let the application write an audit row for a target that is not a uuid.
--
-- `audit_log.target_id` is uuid here and `text` in this repository's own baseline
-- (0000_baseline.sql line 173). The tenant plane audits targets that are legitimately not uuids:
--
--   app/api/app/products/[code]        targetId: "term_life"        a product code
--   app/api/admin/billing/run          targetId: "2026-09-12"       the billing date
--
-- so every one of those writes fails with
--
--   22P02 invalid input syntax for type uuid: "term_life"
--
-- and because lib/audit/log.ts throws rather than swallowing -- deliberately, per SA-0.3, so an
-- action that cannot be recorded does not appear to have succeeded -- the whole request returns
-- 400 "Could not write audit log". That is what costs LA-1.3 all eight of its write criteria: the
-- product settings themselves save fine, and then the audit kills the response.
--
-- Widening uuid to text is lossless: every uuid has a text representation and the cast is exact.
-- Verified on 2026-09-12 inside a rolled-back transaction, including the insert that was failing.
--
-- What this costs the organizations-era product: a query that compares target_id directly against
-- a uuid COLUMN will no longer type-check, because there is no text = uuid operator. A query that
-- passes a uuid as a parameter is unaffected, since the parameter arrives as text either way. That
-- is the narrow risk, and it is the opposite direction from the alternative -- teaching the tenant
-- plane to stop auditing product codes would mean losing the identifier from the trail.

alter table public.audit_log alter column target_id type text using target_id::text;

comment on column public.audit_log.target_id is
  'Free-form target identifier. Usually a uuid, but also a product code or a date for targets that have no uuid. Text by design; see 20260912170000.';
