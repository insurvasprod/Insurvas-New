-- The provider call log must outlive the tenant it belonged to.
--
-- Correcting an error in 20260912250000. That migration repointed six tenant_id foreign keys from
-- `organizations` to `tenants` and gave all six ON DELETE CASCADE, with a header claiming "ON DELETE
-- CASCADE is preserved from the originals". For five of them that is right -- payment_providers and
-- the four tenant_template tables are tenant-owned configuration that should die with the tenant,
-- and verify-payment-provider asserts exactly that for payment_providers.
--
-- provider_calls is not configuration. It is the record of money we tried to move, and of every
-- compliance vendor we asked about a phone number. verify-payment-provider says so in the message it
-- would print on failure:
--
--   provider calls must outlive the tenant -- they are the record of money we tried to move
--
-- and its cleanup comments on the intended behaviour directly: "The cascade nulls tenant_id, so rows
-- from this run are found by their tagged key instead." The original was ON DELETE SET NULL. The
-- row survives the tenant's deletion, carrying a null tenant_id, and stays findable by its
-- idempotency key.
--
-- Why the suite did not catch the regression. The assertion is
--
--   (orphanCalls ?? []).every((c) => c.tenant_id === null)
--
-- and `[].every(...)` is true. Under CASCADE the rows are deleted, orphanCalls comes back empty, and
-- the check passes vacuously -- it reports success precisely when the data has been destroyed. The
-- suite is corrected alongside this migration to require at least one surviving row.
--
-- No data was lost. provider_calls held zero rows until 20260912290000 unblocked writing to it, and
-- no tenant has been deleted since. The window between the two migrations happened to be empty.
--
-- tenant_id is nullable, so SET NULL is valid without any further change.

alter table public.provider_calls drop constraint if exists provider_calls_tenant_id_fkey;
alter table public.provider_calls
  add constraint provider_calls_tenant_id_fkey
  foreign key (tenant_id) references public.tenants(id) on delete set null;

comment on constraint provider_calls_tenant_id_fkey on public.provider_calls is
  'SET NULL, not CASCADE: the call log is financial and compliance evidence and outlives the tenant. See 20260912310000.';
