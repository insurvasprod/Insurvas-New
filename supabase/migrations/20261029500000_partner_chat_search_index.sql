-- Partner chat search (owner, 2026-10-29): GET /api/app/partner-chat?search= runs
--   partner_messages            ... where tenant_id = $1 and channel_id in (...) and message ilike '%words%'
--   partner_message_attachments ... where tenant_id = $1 and file_name ilike '%words%'
-- The search works without this file: each tenant's rows are read through the existing
-- (tenant_id, channel_id, created_at) index and filtered. These trigram indexes let ILIKE with a
-- leading % use an index once a tenant's chat history is large. pg_trgm is already installed
-- (users_name_trgm_idx, contacts_name_search_trgm_idx).
--
-- Not applied. Safe to re-run.

create index if not exists partner_messages_message_trgm_idx
  on public.partner_messages using gin (message gin_trgm_ops);

create index if not exists partner_message_attachments_file_name_trgm_idx
  on public.partner_message_attachments using gin (file_name gin_trgm_ops);
