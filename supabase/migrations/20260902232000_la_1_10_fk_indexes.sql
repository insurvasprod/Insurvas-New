-- LA-1.10: cover every new foreign key so claim cleanup and tenant deletion do not scan tables.
create index if not exists lead_queue_claimed_by_idx on public.lead_queue (claimed_by) where claimed_by is not null;
create index if not exists lead_queue_owner_user_idx on public.lead_queue (owner_user_id) where owner_user_id is not null;
create index if not exists lead_queue_disposition_by_idx on public.lead_queue (disposition_by) where disposition_by is not null;
create index if not exists lead_queue_product_line_idx on public.lead_queue (product_line);
create index if not exists active_calls_lead_idx on public.active_calls (lead_id);
create index if not exists active_calls_user_idx on public.active_calls (user_id);
create index if not exists verification_sessions_lead_idx on public.verification_sessions (lead_id);
create index if not exists verification_sessions_user_idx on public.verification_sessions (user_id);
create index if not exists partner_messages_partner_idx on public.partner_messages (partner_id, created_at desc);
create index if not exists partner_messages_work_item_idx on public.partner_messages (work_item_id);
create index if not exists partner_messages_created_by_idx on public.partner_messages (created_by) where created_by is not null;
