-- List import · what a batch was, what it cost, and a dedupe that sees every lead.
--
-- Three additive changes, all for the review step at /app/import/review/[batchId].
--
-- 1. `agent_lead_import_batches` grows the facts the review screen shows and the lead lists can
--    report on: the file's name and row count, the vendor and campaign it was attributed to, what
--    the file cost, and how many rows were bought. Until now the batch row held only an idempotency
--    key and a jsonb blob, so "what did this file cost" was not recorded anywhere at all.
--
-- 2. `agent_leads.import_batch_id` — which staged batch created a lead. Stamped by the new
--    `import_agent_lead_batch` overload (20260924330100) on the leads it inserts; people who were
--    already leads keep the batch that first brought them in. Null for every lead created before
--    this, and for leads that did not come from a reviewed import.
--
-- 3. `import_existing_lead_phones` — the dedupe lookup, by phone, for just the numbers in a file.
--    The importer used to read `select id, values from agent_leads where tenant_id = …` and build
--    the phone set in TypeScript. PostgREST caps a response at its max-rows setting (1,000 on a
--    hosted project unless changed), so on a tenant with ~214k leads that read silently returned the
--    first thousand and the "already one of your leads" check missed everybody else. This returns
--    one jsonb object — not a set, so the row cap does not apply — mapping each matched number to
--    the lead it belongs to.
--
--    The phone expression is the one `has_existing_lead_phone` (20260902160000) already uses, and
--    the index below is built on exactly that expression, so the per-number screening check stops
--    being a sequential scan of every lead as a side effect.
--
-- Additive and idempotent: `add column if not exists`, `create index if not exists`,
-- `create or replace` of a function that did not exist before.

-- ── 1 · the batch row ──────────────────────────────────────────────────────────────────────────
alter table public.agent_lead_import_batches
  add column if not exists file_name text,
  add column if not exists row_count integer,
  add column if not exists cost_cents integer,
  add column if not exists records_purchased integer,
  add column if not exists vendor_id uuid references public.tenant_lead_vendors(id) on delete set null,
  add column if not exists campaign_id uuid references public.tenant_campaigns(id) on delete set null;

-- Bounds match lib/agentTemplates/importReviewModel.ts (MAX_BATCH_COST_CENTS = $1,000,000,
-- MAX_RECORDS_PURCHASED = 10,000,000) and the parser's 20,000-row cap. Money is integer cents.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agent_lead_import_batches_cost_cents_check') then
    alter table public.agent_lead_import_batches
      add constraint agent_lead_import_batches_cost_cents_check
      check (cost_cents is null or cost_cents between 0 and 100000000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agent_lead_import_batches_records_purchased_check') then
    alter table public.agent_lead_import_batches
      add constraint agent_lead_import_batches_records_purchased_check
      check (records_purchased is null or records_purchased between 0 and 10000000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agent_lead_import_batches_row_count_check') then
    alter table public.agent_lead_import_batches
      add constraint agent_lead_import_batches_row_count_check
      check (row_count is null or row_count between 0 and 20000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agent_lead_import_batches_file_name_check') then
    alter table public.agent_lead_import_batches
      add constraint agent_lead_import_batches_file_name_check
      check (file_name is null or char_length(file_name) between 1 and 255);
  end if;
end $$;

create index if not exists agent_lead_import_batches_campaign_idx
  on public.agent_lead_import_batches (tenant_id, campaign_id, created_at desc)
  where campaign_id is not null;

create index if not exists agent_lead_import_batches_vendor_idx
  on public.agent_lead_import_batches (vendor_id)
  where vendor_id is not null;

-- ── 2 · which batch created a lead ─────────────────────────────────────────────────────────────
-- Nullable with no default, so adding it to ~214k rows rewrites nothing; the foreign key validates
-- against an all-null column. No backfill: which batch created an older lead was never recorded.
alter table public.agent_leads
  add column if not exists import_batch_id uuid references public.agent_lead_import_batches(id) on delete set null;

create index if not exists agent_leads_import_batch_idx
  on public.agent_leads (tenant_id, import_batch_id)
  where import_batch_id is not null;

-- ── 3 · the dedupe lookup ──────────────────────────────────────────────────────────────────────
-- The same expression as has_existing_lead_phone, character for character, so both use it.
create index if not exists agent_leads_tenant_phone10_idx
  on public.agent_leads (
    tenant_id,
    (right(regexp_replace(coalesce(values->>'phone', values->>'phone_number', ''), '[^0-9]', '', 'g'), 10))
  );

create or replace function public.import_existing_lead_phones(p_tenant_id uuid, p_phones text[])
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  -- The earliest lead per number, which is the one the importer has always attached to: the old
  -- TypeScript kept the first lead it saw for each phone.
  select coalesce(jsonb_object_agg(m.phone, m.lead_id), '{}'::jsonb)
    from (
      select distinct on (k.phone) k.phone, l.id as lead_id
        from public.agent_leads l
        cross join lateral (
          select right(regexp_replace(coalesce(l.values->>'phone', l.values->>'phone_number', ''), '[^0-9]', '', 'g'), 10) as phone
        ) k
       where l.tenant_id = p_tenant_id
         and right(regexp_replace(coalesce(l.values->>'phone', l.values->>'phone_number', ''), '[^0-9]', '', 'g'), 10) = any (p_phones)
       order by k.phone, l.created_at, l.id
    ) m;
$function$;

revoke all on function public.import_existing_lead_phones(uuid, text[]) from public, anon, authenticated, tenant_app;
grant execute on function public.import_existing_lead_phones(uuid, text[]) to service_role;

-- ── proof ──────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_missing text;
begin
  select string_agg(c, ', ') into v_missing
    from unnest(array['file_name', 'row_count', 'cost_cents', 'records_purchased', 'vendor_id', 'campaign_id']) as c
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'agent_lead_import_batches' and column_name = c
   );
  if v_missing is not null then
    raise exception 'agent_lead_import_batches is missing: %', v_missing;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'agent_leads' and column_name = 'import_batch_id'
  ) then
    raise exception 'agent_leads.import_batch_id was not added';
  end if;

  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'agent_leads_tenant_phone10_idx') then
    raise exception 'agent_leads_tenant_phone10_idx was not created';
  end if;

  if to_regprocedure('public.import_existing_lead_phones(uuid, text[])') is null then
    raise exception 'import_existing_lead_phones was not created';
  end if;
  if has_function_privilege('anon', 'public.import_existing_lead_phones(uuid, text[])', 'execute') then
    raise exception 'import_existing_lead_phones must not be callable by anon';
  end if;

  -- A tenant with no leads matches nothing, and says so with an empty object rather than null.
  if public.import_existing_lead_phones('00000000-0000-0000-0000-000000000000'::uuid, array['3125550148']) <> '{}'::jsonb then
    raise exception 'import_existing_lead_phones returned a match for a tenant that does not exist';
  end if;
end $$;
