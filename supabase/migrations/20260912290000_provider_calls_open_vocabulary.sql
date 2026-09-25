-- Let this application's providers be logged at all.
--
-- public.provider_calls carries a live CHECK constraint restricting the provider name to the
-- organizations-era payments vocabulary:
--
--   provider = any (array['dummy_stripe', 'dummy_paypal', 'stripe', 'paypal'])
--
-- This application writes neither set. It writes 'whop' (SA-4.2, lib/payments/whop/client.ts) and
-- 'compliance_vendor:<uuid>' (LA-1.5, lib/compliance/screening.ts). Both are refused:
--
--   23514 new row for relation "provider_calls" violates check constraint
--         "provider_calls_provider_check"
--
-- The table holds zero rows. Not zero for this application -- zero altogether. No provider call has
-- ever been logged by either product.
--
-- It went unnoticed because recordProviderCall() is deliberately non-fatal: losing a log line must
-- not refuse a customer's payment, so the insert error is caught and shouted at the server log
-- instead of raised. That is the right call for a payment and it is exactly why this hid. The
-- failure surfaced only when LA-1.5's "primary vendor failure falls back to secondary and is
-- logged" went looking for a row that was never written.
--
-- The cost is larger than the one criterion. lib/payments/status.ts derives provider health from
-- this table, counting recent rows by provider and status; against an empty table it cannot
-- distinguish "no calls were made" from "every call failed to log". That is the SA-3 defect class
-- restated: a meaningful empty state must not be something a failed write can imitate.
--
-- 0000_baseline.sql declares this table with `provider text not null` and NO vocabulary check --
-- only the status check, which the live table already matches. So this drops the constraint rather
-- than widening it, which is also the only option that works: 'compliance_vendor:<uuid>' is an
-- open set, one value per registered vendor, and cannot be enumerated in a CHECK.
--
-- Safe for both lineages: dropping a CHECK cannot invalidate an existing row, and the CRM may keep
-- writing the four values it always wrote.

alter table public.provider_calls drop constraint if exists provider_calls_provider_check;

comment on column public.provider_calls.provider is
  'Open vocabulary. Payment providers use a bare name (whop); compliance vendors use compliance_vendor:<vendor_id>. See 20260912290000.';
