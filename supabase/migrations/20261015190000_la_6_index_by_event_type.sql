-- LA-6.3 / LA-6.7 (Notion sprint, Module 6 — Compliance) · the gap checks read the index by agency and
-- record type ("every call of this agency", "every consent of this agency") several times per scan.
-- With only the (agency, number, time) index, each of those reads walked the agency's whole index:
-- the demo agency's book-wide scan took 4.8 s live, against 1 s on a copy that had this index — and
-- the dashboard (LA-6.7) must load in under a second.
--
-- Additive. Rollback: drop index if exists public.compliance_index_type_idx;

create index if not exists compliance_index_type_idx on public.compliance_index (tenant_id, event_type, phone_digits, event_at);
analyze public.compliance_index;
