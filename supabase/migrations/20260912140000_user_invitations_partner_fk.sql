-- LA-1.2: give PostgREST the relationship it needs to resolve a partner invitation.
--
-- `app/api/partner/auth/accept-invite/route.ts` reads an invitation with
--
--   .select("id, user_id, partner_id, expires_at, accepted_at, partners!inner(status)")
--   .neq("partners.status", "offboarded")
--
-- so an invitation to an offboarded partner cannot be redeemed. PostgREST resolves an embedded
-- relationship like `partners!inner(...)` from a FOREIGN KEY, and `user_invitations.partner_id` has
-- never had one -- 20260911150000 added the column as a compatibility change and stopped there.
-- `user_invitations` has foreign keys to `tenants` and `users`, and none to `partners`.
--
-- The effect is that findInvitation() always returns null on the partner plane, so the route
-- answers 400 before it looks at the password. Three LA-1.2 criteria fail on it: the existing
-- account sign-in flow, one-time redemption under concurrency, and the audit assertions that
-- depend on an acceptance having happened. Confirmed live on 2026-09-12.
--
-- ON DELETE CASCADE matches the two constraints already on this table, and is right here: an
-- invitation to a partner that no longer exists is not meaningful.

-- Checked before writing this: zero invitations point at a partner that no longer exists, so the
-- constraint validates against the existing rows with nothing to clean up first.

alter table public.user_invitations
  add constraint user_invitations_partner_id_fkey
  foreign key (partner_id) references public.partners(id) on delete cascade;
