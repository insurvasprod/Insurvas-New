-- Partner payouts rework (owner, 2026-11-06; extends LA-1.1 partner terms) · Model A, "the quick win".
--
-- A partner on Model A is paid a flat rate once a transfer is successful AND the client's application is
-- submitted. It is its own payout model, so a term names it and the ledger (20261106110000) prices it.
-- In its own file: a new enum value cannot be used in the transaction that adds it.
--
-- Additive. Rollback: an enum value cannot be dropped; leave it (nothing prices it without the ledger file).

alter type public.partner_payout_model add value if not exists 'per_submitted_application';
