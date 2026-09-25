-- /app/duplicates: a review queue that outlives the request, and leads that know their contact.
--
-- Until now a medium match existed only in the HTTP response to "Add contact". Close the tab and
-- the pair was gone; a CSV import threw every one of them away, so "Pending review" could never
-- count anything real. This table is the queue: one row per (incoming contact, existing candidate)
-- pair that matching wants a person to look at. Written by createContact and the contact import;
-- resolved by merge_contacts in the same transaction as the merge (20260924326100), or dismissed
-- ("Not the same person"). Undoing a merge reopens its row.
--
-- merge_log gains `source` (manual | auto, so Recent merges can label auto-merges), `review_id`
-- (the pair the merge resolved) and `review_snapshot` (every pending row the merge re-pointed or
-- closed, so undo can put them back exactly).
--
-- agent_leads gains `contact_id`: the contact a lead was confidently matched to when it arrived.
-- Nullable, set going forward only (no backfill). When that contact is later merged away the link
-- is left alone; follow contacts.merged_into_id to the surviving record.
--
-- Additive and idempotent. The FK on agent_leads (~214k rows) is added NOT VALID and validated
-- separately, so the table is never held under an exclusive lock for a full scan.

create table if not exists public.contact_duplicate_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  candidate_id uuid not null references public.contacts(id) on delete cascade,
  score numeric(6,4) not null check (score >= 0 and score <= 2),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  matched_on text[] not null default '{}'::text[],
  status text not null default 'pending' check (status in ('pending', 'merged', 'dismissed')),
  merge_id uuid references public.merge_log(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  constraint contact_duplicate_reviews_two_contacts check (contact_id <> candidate_id),
  constraint contact_duplicate_reviews_resolution check ((status = 'pending') = (resolved_at is null))
);

-- One open question per pair, whichever way round it was asked.
create unique index if not exists contact_duplicate_reviews_pending_pair_idx
  on public.contact_duplicate_reviews (tenant_id, least(contact_id, candidate_id), greatest(contact_id, candidate_id))
  where status = 'pending';
create index if not exists contact_duplicate_reviews_queue_idx
  on public.contact_duplicate_reviews (tenant_id, created_at, id) where status = 'pending';
create index if not exists contact_duplicate_reviews_contact_idx on public.contact_duplicate_reviews (contact_id);
create index if not exists contact_duplicate_reviews_candidate_idx on public.contact_duplicate_reviews (candidate_id);
create index if not exists contact_duplicate_reviews_merge_idx on public.contact_duplicate_reviews (merge_id) where merge_id is not null;
create index if not exists contact_duplicate_reviews_resolved_by_idx on public.contact_duplicate_reviews (resolved_by) where resolved_by is not null;

alter table public.contact_duplicate_reviews enable row level security;
revoke all on public.contact_duplicate_reviews from public, anon, authenticated;
grant select, insert, update, delete on public.contact_duplicate_reviews to service_role;
grant select on public.contact_duplicate_reviews to tenant_app;
drop policy if exists contact_duplicate_reviews_read on public.contact_duplicate_reviews;
create policy contact_duplicate_reviews_read on public.contact_duplicate_reviews
  for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- ── merge_log: who asked for it, which pair it answered, what it moved ─────
alter table public.merge_log add column if not exists source text not null default 'manual';
alter table public.merge_log add column if not exists review_id uuid;
alter table public.merge_log add column if not exists review_snapshot jsonb not null default '[]'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'merge_log_source_check' and conrelid = 'public.merge_log'::regclass) then
    alter table public.merge_log add constraint merge_log_source_check check (source in ('manual', 'auto'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'merge_log_review_id_fkey' and conrelid = 'public.merge_log'::regclass) then
    alter table public.merge_log add constraint merge_log_review_id_fkey
      foreign key (review_id) references public.contact_duplicate_reviews(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'merge_log_review_snapshot_is_array' and conrelid = 'public.merge_log'::regclass) then
    alter table public.merge_log add constraint merge_log_review_snapshot_is_array check (jsonb_typeof(review_snapshot) = 'array');
  end if;
end $$;
create index if not exists merge_log_review_idx on public.merge_log (review_id) where review_id is not null;
-- The undo guard asks "is there a later live merge touching either contact?" on every undo and for
-- every Recent merges row.
create index if not exists merge_log_live_kept_idx on public.merge_log (tenant_id, kept_id, merged_at) where reversed_at is null;
create index if not exists merge_log_live_merged_idx on public.merge_log (tenant_id, merged_id, merged_at) where reversed_at is null;

-- Resolving "everything merged into this contact" (lead counts across a merge chain).
create index if not exists contacts_merged_into_idx on public.contacts (merged_into_id) where merged_into_id is not null;

-- ── agent_leads.contact_id ─────────────────────────────────────────────────
alter table public.agent_leads add column if not exists contact_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agent_leads_contact_id_fkey' and conrelid = 'public.agent_leads'::regclass) then
    alter table public.agent_leads add constraint agent_leads_contact_id_fkey
      foreign key (contact_id) references public.contacts(id) on delete set null not valid;
  end if;
end $$;
alter table public.agent_leads validate constraint agent_leads_contact_id_fkey;
create index if not exists agent_leads_contact_idx on public.agent_leads (tenant_id, contact_id) where contact_id is not null;

-- ── asserted against whatever this database holds ─────────────────────────
do $$
begin
  if to_regclass('public.contact_duplicate_reviews') is null then
    raise exception 'contact_duplicate_reviews is missing';
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'contact_duplicate_reviews' and c.relrowsecurity
  ) then
    raise exception 'contact_duplicate_reviews has row level security switched off';
  end if;
  if has_table_privilege('tenant_app', 'public.contact_duplicate_reviews', 'insert')
     or has_table_privilege('tenant_app', 'public.contact_duplicate_reviews', 'update')
     or has_table_privilege('tenant_app', 'public.contact_duplicate_reviews', 'delete') then
    raise exception 'the tenant plane can write duplicate reviews';
  end if;
  if not has_table_privilege('tenant_app', 'public.contact_duplicate_reviews', 'select') then
    raise exception 'the tenant plane cannot read duplicate reviews';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'contact_duplicate_reviews' and policyname = 'contact_duplicate_reviews_read') then
    raise exception 'contact_duplicate_reviews_read policy is missing';
  end if;
  if to_regclass('public.contact_duplicate_reviews_pending_pair_idx') is null then
    raise exception 'the one-open-review-per-pair index is missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'merge_log' and column_name = 'source')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'merge_log' and column_name = 'review_id')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'merge_log' and column_name = 'review_snapshot') then
    raise exception 'merge_log is missing source, review_id or review_snapshot';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agent_leads' and column_name = 'contact_id' and is_nullable = 'YES') then
    raise exception 'agent_leads.contact_id is missing or not nullable';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agent_leads_contact_id_fkey' and conrelid = 'public.agent_leads'::regclass and convalidated) then
    raise exception 'agent_leads.contact_id is not a validated foreign key to contacts';
  end if;
  if to_regclass('public.agent_leads_contact_idx') is null then
    raise exception 'agent_leads_contact_idx is missing';
  end if;
end $$;
