-- The source_organization_id UNIQUE constraint already owns an index. Remove
-- the redundant partial index created by the first bridge draft.
drop index if exists public.tenants_source_organization_key;
