-- LA-1.10: cover the existing product foreign key on the queue for filtered inbox reads.
create index if not exists lead_queue_product_line_idx on public.lead_queue (product_line);
