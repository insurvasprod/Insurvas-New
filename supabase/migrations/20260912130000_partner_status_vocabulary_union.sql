-- LA-1.1 / LA-1.2: let both products write their own partner lifecycle states.
--
-- `partners` and `partner_users` are shared with the organizations-era product, and their CHECK
-- constraints encode only that product's vocabulary. The tenant plane's states are rejected:
--
--   partners.status        allowed: onboarding, active, paused, suspended, archived
--                          LA-1.1 needs: draft, active, paused, offboarded
--
--   partner_users.status   allowed: invited, active, suspended, removed
--                          LA-1.2 needs: active, revoked
--
-- So offboarding a partner fails with partners_status_check, and deactivating a partner user fails
-- the same way. Confirmed live on 2026-09-12 by scripts/verify-partner-users.mjs.
--
-- Widening to the union of both vocabularies. Purely additive: every value either product already
-- writes stays valid, so nothing existing breaks and no row needs rewriting.
--
-- What this deliberately accepts, and it is not free. One column now carries two lifecycle models.
-- `archived` and `offboarded` mean the same thing to a human and are different values to a query,
-- as do `removed` and `revoked`. A report in either product that filters on its own vocabulary will
-- silently miss rows written by the other. That is a reporting defect waiting to happen, and the
-- reason to treat this as a bridge rather than a destination.
--
-- The destination is separate tables, the way SA-3 separated the SaaS invoice tables into
-- platform_invoices. Until the convergence question is answered, this keeps both products working
-- and unblocks the LA-1 acceptance review.

alter table public.partners drop constraint if exists partners_status_check;
alter table public.partners add constraint partners_status_check
  check (status = any (array[
    -- organizations-era
    'onboarding'::text, 'suspended'::text, 'archived'::text,
    -- tenant plane (LA-1.1)
    'draft'::text, 'offboarded'::text,
    -- shared by both
    'active'::text, 'paused'::text
  ]));

alter table public.partner_users drop constraint if exists partner_users_status_check;
alter table public.partner_users add constraint partner_users_status_check
  check (status = any (array[
    -- organizations-era
    'invited'::text, 'suspended'::text, 'removed'::text,
    -- tenant plane (LA-1.2)
    'revoked'::text,
    -- shared by both
    'active'::text
  ]));

comment on constraint partners_status_check on public.partners is
  'Union of two products vocabularies. archived and offboarded are synonyms written by different planes; see 20260912130000.';
comment on constraint partner_users_status_check on public.partner_users is
  'Union of two products vocabularies. removed and revoked are synonyms written by different planes; see 20260912130000.';
