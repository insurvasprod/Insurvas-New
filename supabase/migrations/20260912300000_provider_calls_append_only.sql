-- Make the provider call log append-only, as it was always declared to be.
--
-- 0000_baseline.sql grants provider_calls deliberately, and the omission is the mechanism:
--
--   grant delete, insert, maintain, references, select, trigger on public.provider_calls to ...
--
-- insert to write a call, select to read it, delete so retention can purge old rows -- and no
-- UPDATE, because a payment or compliance call log that can be edited after the fact is not
-- evidence. The live database grants service_role UPDATE and TRUNCATE as well, and the application
-- runs as service_role, so today it can silently rewrite its own audit trail.
--
-- verify-payment-provider asserts exactly this pair and names the consequence:
--
--   ok    old calls CAN be purged for retention
--   FAIL  the app CANNOT rewrite a logged call -- the update succeeded
--         -- the provider log is not trustworthy evidence
--
-- That check could never fail before now, because it is preceded by "a call can be written" and no
-- call could be written at all: 20260912290000 removed the CHECK constraint that was refusing every
-- provider name this application uses. Fixing the write path is what made the integrity gap
-- reachable. It is not a regression from that change -- it is the defect it was hiding.
--
-- Deliberately NOT restoring the baseline's grants verbatim. That file also grants insert, delete
-- and select on this table to anon and authenticated; the live database grants them nothing, which
-- is strictly better, and copying the declaration across would hand an anonymous caller the ability
-- to write and delete payment call logs. The declaration's intent is no-UPDATE; its anon and
-- authenticated grants are not worth inheriting. Only service_role is narrowed here.
--
-- TRUNCATE goes with UPDATE: retention purges by DELETE with a predicate, and nothing in this
-- application truncates this table. Leaving it granted would let a caller empty the log in one
-- statement while the DELETE path stays auditable row by row.

revoke update, truncate on public.provider_calls from service_role;

-- Belt and braces: these hold no grants today, and must not acquire any by a later broad grant.
revoke all on public.provider_calls from anon, authenticated, public, tenant_app;

comment on table public.provider_calls is
  'Append-only evidence of outbound provider calls. service_role may insert, select and delete (retention) but not update or truncate; see 20260912300000.';
