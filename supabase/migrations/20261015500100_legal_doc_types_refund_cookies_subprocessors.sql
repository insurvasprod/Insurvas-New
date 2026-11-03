-- Legal · three more document types: refund policy, cookie notice, subprocessor list.
--
-- lib/legal/constants.ts lists them so /admin/legal can draft and publish them and /legal/[type]
-- can render them. Until this runs, the database refuses a draft or publish of these types
-- (invalid enum value) and /legal/refund, /legal/cookies and /legal/subprocessors answer 404.
--
-- Nothing is published here. Drafts live in content/legal/*.md for counsel review; an admin
-- publishes from /admin/legal. None of these is required at signup (SIGNUP_REQUIRED_DOCS is
-- unchanged). Publishing one with "requires re-acceptance" ticked WOULD put it in front of every
-- user via outstanding_legal_documents, so leave that unticked for informational notices.
--
-- Additive and idempotent. ADD VALUE cannot be used in the same transaction that adds it; nothing
-- below uses it. Rollback: enum values cannot be dropped in place — leave them; unused values are
-- harmless.

alter type public.legal_doc_type add value if not exists 'refund';
alter type public.legal_doc_type add value if not exists 'cookies';
alter type public.legal_doc_type add value if not exists 'subprocessors';
