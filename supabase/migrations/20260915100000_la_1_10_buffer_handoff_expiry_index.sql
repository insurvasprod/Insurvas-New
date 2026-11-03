-- LA-1.10: keep the read-path expiry sweep indexed.
--
-- list_buffer_handoffs calls expire_buffer_handoffs(tenant_id), whose predicate is
-- tenant_id + pending status + expires_at. The existing tenant/agent index serves the
-- subsequent recipient lookup, but cannot use status as its second key for this sweep.
-- This partial index is additive, idempotent, and does not change rows or authorization.
create index if not exists buffer_handoffs_expiry_sweep_idx
  on public.buffer_handoffs (tenant_id, expires_at)
  where status = 'pending';
