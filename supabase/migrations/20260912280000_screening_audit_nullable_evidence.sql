-- Let a failed screening be audited at all.
--
-- LA-1.5 acceptance: "Every check appears in the audit record with its raw response." The checks
-- that most need an audit row are the ones where there is no vendor and no usable number:
--
--   outcome 'unavailable'     every enabled vendor failed, so no vendor answered
--   outcome 'invalid_phone'   the number could not be reduced to ten digits
--
-- 20260902160000 declares screening_audit.vendor and .phone_digits nullable for exactly that
-- reason -- `vendor text`, and `phone_digits text check (phone_digits is null or ...)` -- and
-- lib/compliance/screening.ts types both as `string | null` in writeAudit(). The live table has
-- both NOT NULL, from the organizations-era lineage, so those two paths fail with
--
--   23502 null value in column "vendor" of relation "screening_audit"
--
-- and the failure is worse than a missing row: writeAudit throws, so the request answers 400 with a
-- database message instead of the intended fail-closed screening response. Three LA-1.5 criteria
-- land here -- the TCPA/invalid block, the vendor fallback, and the audit record itself.
--
-- Relaxing NOT NULL cannot invalidate an existing row, so this is safe for both lineages: every row
-- the CRM has written already carries both values, and it may keep writing them.
--
-- Deliberately NOT tightening anything else on this table. The repo also declares an outcome
-- vocabulary check and a phone_digits regex that the live table does not have; adding either would
-- constrain the other product's writes, which is the line this reconciliation does not cross.
-- screening_results keeps both columns NOT NULL in both lineages, correctly -- a cache entry always
-- has a vendor and a number. Only the audit trail needs to record an absence.

alter table public.screening_audit alter column vendor drop not null;
alter table public.screening_audit alter column phone_digits drop not null;

comment on column public.screening_audit.vendor is
  'Null when no vendor answered (outcome unavailable). See 20260912280000.';
comment on column public.screening_audit.phone_digits is
  'Null when the number could not be reduced to ten digits (outcome invalid_phone). See 20260912280000.';
