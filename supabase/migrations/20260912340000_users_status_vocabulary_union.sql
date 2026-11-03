-- Widen users.status to the union of both products' vocabularies.
--
-- The live CHECK is the organizations-era CRM's list; this repository declares a `user_status` enum
-- with a different one. They overlap but neither contains the other:
--
--   live CHECK     invited, active, suspended, deactivated, deleted
--   repo enum      pending_verification, active, inactive, suspended, deleted
--
-- `pending_verification` is the state a self-serve signup starts in -- created, workspace attached,
-- email not yet confirmed -- so every signup fails on the last write of the transaction:
--
--   23514 new row for relation "users" violates check constraint "users_status_check"
--
-- This is the second half of the signup blocker. 20260912330000 fixed the identity
-- (public.users.id could not be supplied); this fixes the state that identity is created in. Both
-- had to move before an account could exist at all.
--
-- Widening to the union rather than choosing a side, for the same reason as 20260912130000 did for
-- the partner vocabularies: `deactivated` and `invited` belong to rows the CRM has already written
-- and dropping them would invalidate live data, while `pending_verification` and `inactive` are what
-- this application produces. Both stay legal.
--
-- The cost is the same cost, and worth restating rather than burying. Two spellings of one idea now
-- coexist -- `deactivated` here and `inactive` there mean the same thing to a reader and different
-- things to a GROUP BY. Any report that filters on one vocabulary silently misses the other's rows.
-- The destination is one vocabulary, which means deciding whether these two products converge; the
-- bridge is not the destination. Recorded in docs/qa/LA-1-QA-AUDIT.md under the open items.
--
-- Safe: widening a CHECK cannot invalidate an existing row, and every value the CRM writes today
-- stays legal.

alter table public.users drop constraint if exists users_status_check;

alter table public.users add constraint users_status_check
  check (status = any (array[
    -- shared by both lineages
    'active'::text, 'suspended'::text, 'deleted'::text,
    -- organizations-era CRM, kept so existing rows stay valid
    'invited'::text, 'deactivated'::text,
    -- this application's user_status enum
    'pending_verification'::text, 'inactive'::text
  ]));

comment on constraint users_status_check on public.users is
  'Union of both products user-state vocabularies. deactivated and inactive are the same concept spelled two ways; see 20260912340000.';
