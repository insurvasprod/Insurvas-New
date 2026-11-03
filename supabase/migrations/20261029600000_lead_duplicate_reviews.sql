-- Same-phone leads go to Clean (owner 2026-10-29).
--
-- Importing the same file twice and accepting it put nothing in front of anyone. The review's
-- default for "already one of your leads" is attach (LA-2.20: one lead, many sources), and the
-- commit only added the campaign as another source of the old lead. Clean reads
-- contact_duplicate_reviews, which pairs CONTACTS; a lead is not a contact until it is linked, so a
-- same-phone lead never reached it.
--
-- lead_duplicate_reviews is the lead-level question: "this number came in again — is it the same
-- person?". Two shapes:
--   · incoming   a re-imported row that was attached to lead_id (its values kept, so "different
--                person" can still add it as a lead of its own)
--   · other_lead two lead rows that already share a number (other intake paths; backfilled below)
--
-- Additive and idempotent. The service role writes; tenant_app reads its own tenant's rows.

create table if not exists public.lead_duplicate_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  other_lead_id uuid references public.agent_leads(id) on delete cascade,
  incoming jsonb,
  phone text not null check (phone ~ '^[0-9]{10}$'),
  campaign_id uuid references public.tenant_campaigns(id) on delete set null,
  import_batch_id uuid references public.agent_lead_import_batches(id) on delete set null,
  source_key text,
  status text not null default 'pending' check (status in ('pending', 'same_person', 'separate', 'dismissed')),
  created_lead_id uuid references public.agent_leads(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  constraint lead_duplicate_reviews_one_shape check ((other_lead_id is null) <> (incoming is null)),
  constraint lead_duplicate_reviews_two_leads check (other_lead_id is null or other_lead_id <> lead_id),
  constraint lead_duplicate_reviews_resolution check ((status = 'pending') = (resolved_at is null))
);

-- One question per re-imported row, and one per pair of leads whichever way round.
create unique index if not exists lead_duplicate_reviews_row_idx
  on public.lead_duplicate_reviews (tenant_id, import_batch_id, source_key)
  where import_batch_id is not null and source_key is not null;
create unique index if not exists lead_duplicate_reviews_pair_idx
  on public.lead_duplicate_reviews (tenant_id, least(lead_id, other_lead_id), greatest(lead_id, other_lead_id))
  where other_lead_id is not null;
create index if not exists lead_duplicate_reviews_queue_idx
  on public.lead_duplicate_reviews (tenant_id, created_at, id) where status = 'pending';
create index if not exists lead_duplicate_reviews_lead_idx on public.lead_duplicate_reviews (lead_id);
create index if not exists lead_duplicate_reviews_other_idx on public.lead_duplicate_reviews (other_lead_id) where other_lead_id is not null;
create index if not exists lead_duplicate_reviews_created_lead_idx on public.lead_duplicate_reviews (created_lead_id) where created_lead_id is not null;
create index if not exists lead_duplicate_reviews_campaign_idx on public.lead_duplicate_reviews (campaign_id) where campaign_id is not null;
create index if not exists lead_duplicate_reviews_batch_idx on public.lead_duplicate_reviews (import_batch_id) where import_batch_id is not null;
create index if not exists lead_duplicate_reviews_resolved_by_idx on public.lead_duplicate_reviews (resolved_by) where resolved_by is not null;

alter table public.lead_duplicate_reviews enable row level security;
revoke all on public.lead_duplicate_reviews from public, anon, authenticated;
-- No delete or truncate: a decision is a record (supabase grants service_role everything by default).
revoke delete, truncate on public.lead_duplicate_reviews from service_role;
grant select, insert, update on public.lead_duplicate_reviews to service_role;
grant select on public.lead_duplicate_reviews to tenant_app;
drop policy if exists lead_duplicate_reviews_read on public.lead_duplicate_reviews;
create policy lead_duplicate_reviews_read on public.lead_duplicate_reviews
  for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- ── consumer deletion (LA-6.5) ──────────────────────────────────────────────
-- A question holds the number and, for a re-import, the row's values. data_subject_purge_group
-- anonymises the lead (values := {"_erased": request}); the questions about that lead go with it,
-- here, rather than by redefining the purge function. Fires only on that one transition.
create or replace function public.lead_duplicate_reviews_follow_erasure()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
begin
  delete from public.lead_duplicate_reviews
   where tenant_id = new.tenant_id and (lead_id = new.id or other_lead_id = new.id);
  return null;
end;
$function$;
revoke all on function public.lead_duplicate_reviews_follow_erasure() from public, anon, authenticated, tenant_app;

drop trigger if exists agent_leads_erasure_clears_duplicate_reviews on public.agent_leads;
create trigger agent_leads_erasure_clears_duplicate_reviews
  after update of values on public.agent_leads
  for each row
  when (new.values ? '_erased' and not (old.values ? '_erased'))
  execute function public.lead_duplicate_reviews_follow_erasure();

-- ── backfill: leads that already share a number ─────────────────────────────
-- The earliest lead per number is the one the importer attaches to; every later lead with the same
-- number is asked about against it. Walks agent_leads_tenant_phone10_idx.
insert into public.lead_duplicate_reviews (tenant_id, lead_id, other_lead_id, phone, created_at)
select d.tenant_id, d.first_id, d.id, d.phone, now()
  from (
    select l.tenant_id, l.id, k.phone,
           first_value(l.id) over (partition by l.tenant_id, k.phone order by l.created_at, l.id) as first_id
      from public.agent_leads l
      cross join lateral (
        select right(regexp_replace(coalesce(l.values->>'phone', l.values->>'phone_number', ''), '[^0-9]', '', 'g'), 10) as phone
      ) k
     where length(k.phone) = 10
  ) d
 where d.id <> d.first_id
on conflict do nothing;

-- ── proof ───────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.lead_duplicate_reviews') is null then
    raise exception 'lead_duplicate_reviews was not created';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'lead_duplicate_reviews' and policyname = 'lead_duplicate_reviews_read') then
    raise exception 'lead_duplicate_reviews_read policy is missing';
  end if;
  if has_table_privilege('anon', 'public.lead_duplicate_reviews', 'select') then
    raise exception 'lead_duplicate_reviews must not be readable by anon';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'agent_leads_erasure_clears_duplicate_reviews' and not tgisinternal) then
    raise exception 'the erasure trigger on agent_leads is missing';
  end if;
  if has_table_privilege('service_role', 'public.lead_duplicate_reviews', 'delete') then
    raise exception 'lead_duplicate_reviews must not be deletable by service_role';
  end if;
end $$;
