-- LA-1 / LA-2 pending migrations, in order. Regenerated 2026-09-23 after the first run failed.
--
-- WHAT CHANGED SINCE THE FIRST ATTEMPT
--
--   `create or replace view` can only APPEND columns to an existing view — it cannot rename or
--   reorder them. Two views in this bundle insert new columns in the middle, next to the numbers
--   they belong with, so both are now dropped and rebuilt rather than replaced:
--
--     tenant_vendor_rollup           42P16 on "cost_per_record_cents" -> "records_rejected"
--                                    (this is the error the first run hit)
--     tenant_lead_attribution_chain  would have failed the same way on
--                                    "case_attribution_lost" -> "issued_policy_id", three
--                                    migrations later
--
--   Neither has a dependent, so the drops are plain rather than `cascade`: something new depending
--   on them should fail here loudly, not be deleted quietly. Every drop is followed by the create,
--   the grants and `alter view ... set (security_invoker = on)`, because a drop loses the last two
--   and a view that came back with owner rights would let every tenant read every other tenant's
--   spend.
--
--   The 146000 backfill is now batched. It creates a work item for every lead that has none:
--   measured live, 214,823 leads against 11,543 queue rows, so a little over 203,000 inserts. As
--   one statement that is large enough to hit a statement timeout, and a timeout would roll back
--   every migration in front of it.
--
-- WHAT THIS DOES THAT IS WORTH KNOWING BEFORE YOU RUN IT
--
--   Those ~203,000 leads become dialable. That is the point of 146000 — they were imported and
--   have never been servable — but it is a real change in what the dialer will hand out, not a
--   schema tidy-up.
--
-- Nothing from the first attempt landed; the editor rolled it back. Verified before regenerating.
--
-- Apply with:   supabase db query --linked --file docs/qa/pending-migrations-2026-09-23.sql
-- Or paste into the SQL editor for project iiimdgizjwnihpyrukbu.

-- The backfill is batched, but the whole file is one transaction and several statements rewrite
-- large functions. Raised for this session only.
set statement_timeout = '15min';

-- ===========================================================================
-- 20260917140000_la_2_2_usable_row_cost_allocation.sql
-- ===========================================================================
-- LA-2.2 criterion 5: "Cost per usable lead is correct after scrub rejections."
--
-- What was wrong. `tenant_campaigns` derives both of its cost columns by dividing by
-- `records_purchased`. The task's own worked example divides by something else:
--
--     $1,750 paid · 5,000 rows · 180 rejected at scrub → 4,820 usable → $0.363 per usable lead
--
-- $1,750 / 5,000 is $0.350. The purchased basis understates the true cost of a lead Ray can
-- actually dial by 3.7% here, and by far more on a dirty list. That number is the input to
-- LA-2.17's cost per issued policy, which is the number that decides which vendor gets next
-- month's money — so an understatement here is not a rounding detail, it is buying more of the
-- worse list.
--
-- Rejections are rows, not a counter. Two reasons, and the second is the deciding one:
--
--   A counter can drift from the thing it counts, and this file's own predecessor says so out
--   loud: "Both costs are DERIVED, never stored as a third number that can disagree with the two
--   it comes from."
--
--   LA-2.2 says the gap between purchased and usable *is* the vendor return claim in LA-2.19. A
--   claim needs evidence — which numbers were rejected and why — not a total. A vendor asked for
--   $63 back will ask which 180 numbers, and "180" is not an answer.
--
-- So `records_rejected` is a count over an append-only ledger, and every cost that depends on it
-- is a view. Nothing is stored twice.

-- ── the evidence ledger ────────────────────────────────────────────────────
create table if not exists public.tenant_campaign_scrub_rejections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid not null references public.tenant_campaigns(id) on delete cascade,

  -- Ten digits, the same normalized form the suppression tables use, so a rejection can be
  -- matched back to the list entry that caused it.
  phone_digits text not null check (phone_digits ~ '^[0-9]{10}$'),

  -- Why this row is not usable. Only these outcomes reduce the usable count: each one is a row
  -- Ray paid for and can never dial, which is exactly what a vendor credit covers. A row dropped
  -- for a bad date of birth is a different argument and is not counted here.
  outcome text not null check (outcome in ('dnc', 'tcpa_litigator', 'invalid', 'suppressed')),
  detail text,

  -- Which line of which file, so a rejection can be pointed at in the vendor's own spreadsheet.
  source_key text,

  rejected_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete set null,

  -- Re-importing the same file must not bill the vendor twice for the same number. The import is
  -- idempotent on its batch key; this makes the ledger idempotent on the fact itself.
  unique (tenant_id, campaign_id, phone_digits)
);

create index if not exists tenant_campaign_scrub_rejections_campaign_idx
  on public.tenant_campaign_scrub_rejections (tenant_id, campaign_id, rejected_at desc);

-- ── the derived costs ──────────────────────────────────────────────────────
--
-- A view rather than generated columns, because the rejection count is a count over another
-- table and a generated column may not contain a subquery. Every consumer that needs the honest
-- cost reads this instead of `tenant_campaigns`.
-- `create or replace view` cannot rename or reorder an existing view's columns — it can only
-- append. Verified against the live project on 2026-09-23: this failed with
--
--     42P16: cannot change name of view column "cost_per_record_cents" to "records_rejected"
--
-- because the deployed rollup has `cost_per_record_cents` in position 12 and this definition puts
-- `records_rejected` there. Inserting the two new counts next to the numbers they belong with is
-- worth more than appending them at the end to dodge a drop, so the views are dropped and rebuilt.
--
-- Dropped in dependency order — the rollup reads the costs view — and WITHOUT `cascade`, so a
-- dependent that appears later fails loudly here instead of being deleted silently. The grants and
-- `security_invoker` below are re-applied after every create, which is what makes this safe: a
-- drop loses both, and a view that comes back owner-rights would let every tenant read every other
-- tenant's spend.
drop view if exists public.tenant_vendor_rollup;
drop view if exists public.tenant_campaign_costs;

create or replace view public.tenant_campaign_costs as
select
  c.tenant_id,
  c.id as campaign_id,
  c.vendor_id,
  c.name,
  c.lead_type,
  c.product_code,
  c.status,
  c.scrub_status,
  c.mixing_weight,
  c.total_spend_cents,
  c.records_purchased,
  c.credits_received_cents,
  c.cost_per_record_cents,
  c.effective_cost_per_record_cents,
  coalesce(r.rejected_count, 0)::integer as records_rejected,

  -- greatest(...,0) because a ledger is append-only and `records_purchased` is editable: someone
  -- correcting 5,000 down to 4,000 after 180 rejections must not produce a negative count. The
  -- floor keeps the arithmetic sane; the two numbers disagreeing is a data-entry question, not a
  -- reason for this view to return nonsense.
  greatest(c.records_purchased - coalesce(r.rejected_count, 0), 0)::integer as records_usable,

  -- The honest number. Spend net of credits, over rows that can actually be dialed.
  --
  -- nullif guards the division the same way the purchased-basis columns do: a campaign whose
  -- every row was rejected has no cost per usable lead, and null says that. Zero would read as
  -- "these leads were free", which is the opposite of what happened.
  ((c.total_spend_cents - c.credits_received_cents)::numeric
    / nullif(greatest(c.records_purchased - coalesce(r.rejected_count, 0), 0), 0))
    as cost_per_usable_record_cents,

  -- What the rejected rows cost at the purchased rate. This is the size of the LA-2.19 claim
  -- before anyone argues about it, and it is the reason the ledger exists.
  (coalesce(r.rejected_count, 0)::numeric * c.cost_per_record_cents) as rejected_spend_cents
from public.tenant_campaigns c
left join (
  select tenant_id, campaign_id, count(*)::integer as rejected_count
    from public.tenant_campaign_scrub_rejections
   group by tenant_id, campaign_id
) r on r.tenant_id = c.tenant_id and r.campaign_id = c.id;

-- ── the vendor rollup, now carrying usable rows ────────────────────────────
--
-- Replaced rather than added to, so there is one vendor-level answer. Same rule as before: sum
-- then divide, never an average of averages, so a campaign that bought 10 records does not count
-- as much as one that bought 10,000.
create or replace view public.tenant_vendor_rollup as
select
  v.tenant_id,
  v.id as vendor_id,
  v.name as vendor_name,
  v.lead_type,
  v.status,
  v.return_window_days,
  count(c.campaign_id)::integer as campaign_count,
  count(c.campaign_id) filter (where c.status = 'active')::integer as active_campaign_count,
  coalesce(sum(c.total_spend_cents), 0)::integer as total_spend_cents,
  coalesce(sum(c.records_purchased), 0)::integer as records_purchased,
  coalesce(sum(c.credits_received_cents), 0)::integer as credits_received_cents,
  coalesce(sum(c.records_rejected), 0)::integer as records_rejected,
  coalesce(sum(c.records_usable), 0)::integer as records_usable,
  (coalesce(sum(c.total_spend_cents), 0)::numeric
     / nullif(coalesce(sum(c.records_purchased), 0), 0)) as cost_per_record_cents,
  ((coalesce(sum(c.total_spend_cents), 0) - coalesce(sum(c.credits_received_cents), 0))::numeric
     / nullif(coalesce(sum(c.records_purchased), 0), 0)) as effective_cost_per_record_cents,
  ((coalesce(sum(c.total_spend_cents), 0) - coalesce(sum(c.credits_received_cents), 0))::numeric
     / nullif(coalesce(sum(c.records_usable), 0), 0)) as cost_per_usable_record_cents
from public.tenant_lead_vendors v
left join public.tenant_campaign_costs c
  on c.vendor_id = v.id and c.tenant_id = v.tenant_id
group by v.tenant_id, v.id, v.name, v.lead_type, v.status, v.return_window_days;

-- ── recording a rejection ──────────────────────────────────────────────────
--
-- Service-only, and idempotent. The import calls this inside the same transaction that commits
-- the leads, so a file either lands with its rejection evidence or does not land at all: the
-- usable count can never describe a list that was not imported.
create or replace function public.record_campaign_scrub_rejections(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_created_by uuid,
  p_rejections jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_item jsonb;
  v_recorded integer := 0;
  v_inserted integer := 0;
  v_digits text;
begin
  if p_tenant_id is null or p_campaign_id is null then
    raise exception 'REJECTION_SCOPE_INVALID';
  end if;
  if jsonb_typeof(p_rejections) <> 'array' then
    raise exception 'REJECTION_PAYLOAD_INVALID';
  end if;
  if not exists (
    select 1 from public.tenant_campaigns
     where id = p_campaign_id and tenant_id = p_tenant_id
  ) then
    raise exception 'REJECTION_CAMPAIGN_SCOPE_INVALID';
  end if;

  for v_item in select value from jsonb_array_elements(p_rejections)
  loop
    v_digits := regexp_replace(coalesce(v_item->>'phone_digits', ''), '[^0-9]', '', 'g');
    if length(v_digits) = 11 and left(v_digits, 1) = '1' then
      v_digits := right(v_digits, 10);
    end if;
    -- A rejection with no usable phone cannot be claimed from a vendor and cannot be matched to a
    -- suppression entry, so it is not evidence. Skipped rather than raised: one unparseable cell
    -- must not fail an import that is otherwise correct.
    if length(v_digits) <> 10 then
      continue;
    end if;

    insert into public.tenant_campaign_scrub_rejections
      (tenant_id, campaign_id, phone_digits, outcome, detail, source_key, created_by)
    values (
      p_tenant_id,
      p_campaign_id,
      v_digits,
      coalesce(nullif(v_item->>'outcome', ''), 'suppressed'),
      nullif(v_item->>'detail', ''),
      nullif(v_item->>'source_key', ''),
      p_created_by
    )
    on conflict (tenant_id, campaign_id, phone_digits) do nothing;

    -- ROW_COUNT rather than FOUND. Both would work here, but FOUND is also written by the
    -- enclosing FOR loop, and a reader should not have to know which statement set it last to
    -- know whether this vendor is about to be billed for a number twice.
    get diagnostics v_inserted = row_count;
    v_recorded := v_recorded + v_inserted;
  end loop;

  return v_recorded;
end;
$function$;

-- ── row security and grants ────────────────────────────────────────────────
alter table public.tenant_campaign_scrub_rejections enable row level security;

drop policy if exists tenant_campaign_scrub_rejections_tenant_scoped
  on public.tenant_campaign_scrub_rejections;
create policy tenant_campaign_scrub_rejections_tenant_scoped
  on public.tenant_campaign_scrub_rejections
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_campaign_scrub_rejections from anon, authenticated, public;
revoke all on public.tenant_campaign_costs from anon, authenticated, public;
revoke all on public.tenant_vendor_rollup from anon, authenticated, public;

-- Read-only to the application. The ledger is written by the import transaction through the
-- service role only, so a tenant session cannot invent a rejection and claim a credit for it.
grant select on public.tenant_campaign_scrub_rejections to tenant_app;
grant select on public.tenant_campaign_costs to tenant_app;
grant select on public.tenant_vendor_rollup to tenant_app;
grant select, insert, delete on public.tenant_campaign_scrub_rejections to service_role;
grant select on public.tenant_campaign_costs to service_role;
grant select on public.tenant_vendor_rollup to service_role;

-- Both views run with the querying role's rights, so the RLS on the tables underneath applies.
-- Without this they would run as their owner and every tenant would read every other tenant's
-- spend — which is what `security_invoker` was set for on the rollup originally, and a
-- `create or replace view` does not carry the option forward on its own.
alter view public.tenant_campaign_costs set (security_invoker = on);
alter view public.tenant_vendor_rollup set (security_invoker = on);

revoke all on function public.record_campaign_scrub_rejections(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, tenant_app;
grant execute on function public.record_campaign_scrub_rejections(uuid, uuid, uuid, jsonb)
  to service_role;

-- ── the task's own arithmetic, asserted ────────────────────────────────────
--
-- The example in LA-2.2 is the test. If this block stops passing, the cost basis has regressed to
-- the purchased row count and LA-2.17 has started lying about which vendor is cheapest.
do $$
declare
  v_tenant uuid;
  v_vendor uuid;
  v_campaign uuid;
  v_per_purchased numeric;
  v_per_usable numeric;
  v_usable integer;
  v_recorded integer;
begin
  select id into v_tenant from public.tenants order by created_at limit 1;
  if v_tenant is null then
    raise notice 'LA-2.2 usable-cost check skipped: no tenant in this database';
    return;
  end if;

  insert into public.tenant_lead_vendors (tenant_id, name, lead_type)
    values (v_tenant, 'LA-2.2 usable-cost check ' || gen_random_uuid()::text, 'list')
    returning id into v_vendor;
  insert into public.tenant_campaigns
      (tenant_id, vendor_id, name, lead_type, total_spend_cents, records_purchased)
    values (v_tenant, v_vendor, 'LA-2.2 usable-cost check ' || gen_random_uuid()::text,
            'list', 175000, 5000)
    returning id into v_campaign;

  -- 180 rejections, the example's number.
  select public.record_campaign_scrub_rejections(
    v_tenant, v_campaign, null,
    (select jsonb_agg(jsonb_build_object(
              'phone_digits', lpad((5550000000 + n)::text, 10, '0'),
              'outcome', 'dnc'))
       from generate_series(1, 180) as n)
  ) into v_recorded;
  if v_recorded <> 180 then
    raise exception 'LA-2.2: expected 180 rejections recorded, got %', v_recorded;
  end if;

  select records_usable, cost_per_record_cents, cost_per_usable_record_cents
    into v_usable, v_per_purchased, v_per_usable
    from public.tenant_campaign_costs where campaign_id = v_campaign;

  if v_usable <> 4820 then
    raise exception 'LA-2.2: expected 4820 usable rows, got %', v_usable;
  end if;
  if round(v_per_purchased, 2) <> 35.00 then
    raise exception 'LA-2.2: expected 35.00 cents per purchased row, got %', v_per_purchased;
  end if;
  -- 175000 / 4820 = 36.307... cents. The task writes it as $0.363.
  if round(v_per_usable, 1) <> 36.3 then
    raise exception 'LA-2.2: expected 36.3 cents per usable row, got %', v_per_usable;
  end if;
  if v_per_usable <= v_per_purchased then
    raise exception 'LA-2.2: the usable basis must cost more than the purchased basis';
  end if;

  -- Recording the same numbers again must change nothing. An import retried after a network
  -- failure must not double the claim against the vendor.
  select public.record_campaign_scrub_rejections(
    v_tenant, v_campaign, null,
    (select jsonb_agg(jsonb_build_object(
              'phone_digits', lpad((5550000000 + n)::text, 10, '0'),
              'outcome', 'dnc'))
       from generate_series(1, 180) as n)
  ) into v_recorded;
  if v_recorded <> 0 then
    raise exception 'LA-2.2: re-recording the same rejections must record 0, got %', v_recorded;
  end if;

  delete from public.tenant_campaigns where id = v_campaign;
  delete from public.tenant_lead_vendors where id = v_vendor;
  raise notice 'LA-2.2 usable-cost check passed: 5000 purchased, 180 rejected, 4820 usable, 36.3c';
end $$;


-- ===========================================================================
-- 20260917141000_la_2_2_twenty_thousand_row_batch.sql
-- ===========================================================================
-- LA-2.2 criterion 6: "A 20,000-row file imports without the browser running out of memory."
--
-- The commit function refused any batch over 2,000 rows, so the criterion was unreachable from the
-- database upward however well the browser behaved. `MAX_LEAD_IMPORT_ROWS` in
-- `lib/agentTemplates/csv.ts` is now 20,000 and this guard has to agree with it, or the server
-- accepts a file that the database then rejects after the user has waited for the upload.
--
-- Why one transaction of 20,000 rather than ten of 2,000: criterion 3 is that a failure at any step
-- leaves ZERO rows imported. Chunking would make that false between chunks — a failure at chunk
-- seven leaves six chunks committed and no honest answer to "what is in my pipeline". A single
-- transaction keeps the two criteria from contradicting each other. 20,000 rows of this shape is a
-- few tens of megabytes of WAL; it is a large transaction, not an unreasonable one.
--
-- The cap is kept rather than removed because it bounds how long one transaction may hold its
-- locks, and an unbounded import is how a single upload stalls every other writer on the tenant.

create or replace function public.import_agent_lead_batch(
  p_tenant_id uuid,
  p_created_by uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_item jsonb;
  v_lead_id uuid;
  v_ids jsonb := '[]'::jsonb;
  v_campaign_id uuid;
begin
  if p_tenant_id is null or p_created_by is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'IMPORT_BATCH_INVALID';
  end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 20000 then
    raise exception 'IMPORT_BATCH_SIZE_INVALID';
  end if;
  -- Membership lives in `tenant_users`, NOT on `public.users` — that column does not exist, and an
  -- earlier draft of this migration checked `users.tenant_id`. It would have applied cleanly
  -- (PL/pgSQL resolves column references at run time, not at CREATE) and then raised
  -- `42703 column "tenant_id" does not exist` on every single import, replacing a working actor
  -- check with a broken one. This is the shape the live function already uses; keep them identical.
  if not exists (
    select 1
      from public.tenant_users tu
      join public.users u on u.id = tu.user_id
     where tu.tenant_id = p_tenant_id
       and tu.user_id = p_created_by
       and u.status in ('active', 'invited')
  ) then
    raise exception 'IMPORT_ACTOR_INVALID';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'IMPORT_ITEM_INVALID'; end if;
    v_campaign_id := nullif(v_item->>'campaign_id', '')::uuid;
    v_lead_id := nullif(v_item->>'lead_id', '')::uuid;

    if v_lead_id is not null then
      if not exists (select 1 from public.agent_leads where id = v_lead_id and tenant_id = p_tenant_id) then
        raise exception 'IMPORT_LEAD_SCOPE_INVALID';
      end if;
      perform 1 from public.agent_leads where id = v_lead_id and tenant_id = p_tenant_id for update;
    else
      if jsonb_typeof(v_item->'values') <> 'object'
         or nullif(v_item->>'template_id', '') is null
         or nullif(v_item->>'product_line', '') is null
         or nullif(v_item->>'pipeline_id', '') is null
         or nullif(v_item->>'stage_id', '') is null then
        raise exception 'IMPORT_ITEM_INVALID';
      end if;
      insert into public.agent_leads (
        tenant_id, tenant_template_id, template_id, template_version, definition_version,
        product_line, pipeline_id, stage_id, values, campaign_id,
        screening_result_id, screening_version, screening_outcome, screening_warning,
        screening_checked_at, created_by
      ) values (
        p_tenant_id,
        nullif(v_item->>'tenant_template_id', '')::uuid,
        (v_item->>'template_id')::uuid,
        greatest(1, coalesce(nullif(v_item->>'template_version', '')::integer, 1)),
        greatest(1, coalesce(nullif(v_item->>'definition_version', '')::integer, 1)),
        v_item->>'product_line', (v_item->>'pipeline_id')::uuid, (v_item->>'stage_id')::uuid,
        v_item->'values', v_campaign_id,
        nullif(v_item->>'screening_result_id', '')::uuid,
        nullif(v_item->>'screening_version', '')::integer,
        nullif(v_item->>'screening_outcome', ''),
        nullif(v_item->>'screening_warning', ''),
        nullif(v_item->>'screening_checked_at', '')::timestamptz,
        p_created_by
      ) returning id into v_lead_id;
    end if;

    if v_campaign_id is not null then
      if not exists (select 1 from public.tenant_campaigns where id = v_campaign_id and tenant_id = p_tenant_id) then
        raise exception 'IMPORT_CAMPAIGN_SCOPE_INVALID';
      end if;
      perform public.import_agent_lead_source(
        p_tenant_id, v_lead_id, v_campaign_id, 'import',
        greatest(0, coalesce(nullif(v_item->>'cost_cents', '')::integer, 0)),
        nullif(v_item->>'source_key', '')
      );
    end if;
    v_ids := v_ids || jsonb_build_array(v_lead_id);
  end loop;
  return v_ids;
end;
$function$;

revoke all on function public.import_agent_lead_batch(uuid, uuid, jsonb) from public, anon, authenticated, tenant_app;
grant execute on function public.import_agent_lead_batch(uuid, uuid, jsonb) to service_role;


-- ===========================================================================
-- 20260917142000_la_2_3_internal_dnc_is_permanent.sql
-- ===========================================================================
-- LA-2.3 criterion 3: "'Do not call' adds the number permanently, and a later import of it is
-- rejected at scrub."
--
-- The second half worked. The first half did not, and the reason is that the tenant's own
-- do-not-call list lives in a different table from every other suppression list:
--
--   public.tenant_suppression_list   federal DNC, state DNC, TCPA litigator, invalid
--                                    → `tenant_suppression_list_permanent` refuses DELETE and
--                                      refuses UPDATE of phone_digits/list_type/tenant_id
--
--   public.tenant_do_not_call        the internal list, written by the "do not call" disposition
--                                    → one trigger, and it only touches `updated_at`
--
-- `is_phone_suppressed` reads both, and it filters the second on `is_active`. So a number that Ray
-- promised never to call again becomes dialable the moment that flag is cleared, and nothing in the
-- database stops it: `tenant_app` holds `update` on the table and the tenant-scoped RLS policy is
-- `for all`, so an ordinary session can do it within its own tenant.
--
-- Nothing in the product does this today — every write is an upsert that touches only `lead_id`,
-- `added_by` and `updated_at`, and no code path anywhere sets `is_active = false`. That is what
-- makes this worth closing rather than arguing about: the capability is open by accident, not by
-- design, so no feature is lost by removing it.
--
-- The earlier audit recorded this as an open product question — "the spec says a do-not-call entry
-- is permanent; the column allows deactivation; one of the two is wrong". The task page decides it
-- twice over: the suppression table lists the internal list as "Never dialable / Overridable: No",
-- and the in-scope bullet says the internal list is "permanent". So the column is wrong, and this
-- migration makes the table agree with the criterion.
--
-- `is_active` is kept rather than dropped. It is read by the unique index
-- `tenant_do_not_call_active_phone_idx` and by the existing `on conflict ... where is_active`
-- upserts, and dropping it would rewrite five call sites to fix a flag that can no longer change.

create or replace function public.prevent_internal_dnc_removal()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'suppression_permanent: % cannot be removed from the do-not-call list. A do-not-call request is permanent by design; if this is genuinely wrong, it takes a migration.', old.phone_digits
      using errcode = 'check_violation';
  end if;

  -- Re-suppressing an already suppressed number is fine, and so is correcting the note or the lead
  -- it came from. Only the transition that makes a suppressed number dialable again is refused.
  if old.is_active and not new.is_active then
    raise exception 'suppression_permanent: % cannot be reactivated for dialing. A do-not-call request is permanent by design.', old.phone_digits
      using errcode = 'check_violation';
  end if;

  if new.phone_digits is distinct from old.phone_digits
     or new.tenant_id is distinct from old.tenant_id then
    raise exception 'suppression_permanent: the number or owner of a do-not-call entry cannot be changed (%). Add a new entry instead.', old.phone_digits
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

drop trigger if exists tenant_do_not_call_permanent on public.tenant_do_not_call;
create trigger tenant_do_not_call_permanent
  before delete or update of is_active, phone_digits, tenant_id
  on public.tenant_do_not_call
  for each row execute function public.prevent_internal_dnc_removal();

-- ── the criterion, asserted ────────────────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_digits text := '2065550' || lpad((floor(random() * 1000))::int::text, 3, '0');
  v_blocked boolean;
  v_id uuid;
begin
  select id into v_tenant from public.tenants order by created_at limit 1;
  if v_tenant is null then
    raise notice 'LA-2.3 permanence check skipped: no tenant in this database';
    return;
  end if;

  insert into public.tenant_do_not_call (tenant_id, phone_digits, reason)
    values (v_tenant, v_digits, 'LA-2.3 permanence check')
    returning id into v_id;

  -- Deactivation must be refused.
  v_blocked := false;
  begin
    update public.tenant_do_not_call set is_active = false where id = v_id;
  exception when check_violation then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'LA-2.3: a do-not-call entry could be deactivated, so it is not permanent';
  end if;

  -- Deletion must be refused.
  v_blocked := false;
  begin
    delete from public.tenant_do_not_call where id = v_id;
  exception when check_violation then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'LA-2.3: a do-not-call entry could be deleted, so it is not permanent';
  end if;

  -- The upsert the disposition path uses must still work. A permanence rule that broke
  -- re-suppression would stop the "do not call" disposition recording anything at all, which is a
  -- worse failure than the one being fixed.
  insert into public.tenant_do_not_call (tenant_id, phone_digits, reason)
    values (v_tenant, v_digits, 'LA-2.3 permanence check, again')
    on conflict (tenant_id, phone_digits) where is_active
      do update set updated_at = now();

  if not public.is_tenant_phone_suppressed(v_tenant, v_digits) then
    raise exception 'LA-2.3: the number is no longer suppressed after a re-suppression upsert';
  end if;

  -- Clean up the fixture. The trigger refuses an ordinary delete by design, so it is disabled for
  -- this statement only, inside this transaction.
  alter table public.tenant_do_not_call disable trigger tenant_do_not_call_permanent;
  delete from public.tenant_do_not_call where id = v_id;
  alter table public.tenant_do_not_call enable trigger tenant_do_not_call_permanent;

  raise notice 'LA-2.3 permanence check passed: deactivation and deletion refused, re-suppression still works';
end $$;


-- ===========================================================================
-- 20260917143000_la_2_5_2_6_vendor_speed_and_coverage.sql
-- ===========================================================================
-- LA-2.5 criterion 4: "Speed-to-lead is computed per vendor and visible."
-- LA-2.6 criterion 3: "Coverage per vendor is reported as a percentage."
--
-- Both were scored PASS on the existence of a view. Both views exist, both are correct, and a
-- repository-wide search finds **no reader for either** outside the audit document that scored
-- them. LA-2.5 is explicit about why that is not enough: the number is "shown to Ray as his own
-- number, because it is a number he can improve". A median nobody sees improves nothing.
--
-- This migration adds the one thing the screen actually needs and could not compute for itself,
-- and the next commit renders all three vendor answers together.
--
-- Why a separate vendor-level view rather than aggregating the campaign one:
--
--   `tenant_speed_to_lead` groups by (tenant, vendor, campaign) and returns a median per campaign.
--   A median cannot be averaged. Taking the mean of three campaign medians gives a number that is
--   not the median of anything, and a vendor with one tiny fast campaign would look fast overall.
--   This is the same trap the LA-2.1 vendor rollup calls out for cost — "summed then divided, never
--   an average of averages" — and the honest fix is the same: compute once over the vendor's own
--   leads.

-- Dropped first for the same reason as the cost views: `create or replace` cannot reorder an
-- existing view's columns, so a later change to this shape would fail with 42P16 rather than apply.
-- The grants and `security_invoker` are re-applied below.
drop view if exists public.tenant_vendor_speed_to_lead;

create or replace view public.tenant_vendor_speed_to_lead as
select
  l.tenant_id,
  c.vendor_id,
  count(*)::integer as posted_leads,
  count(l.first_dial_at)::integer as dialled_leads,

  -- The median, over this vendor's leads directly. `filter` excludes leads never dialled rather
  -- than counting them as zero seconds — an undialled lead has no speed-to-lead, and treating it
  -- as instant would make a vendor look better the more of its leads were ignored.
  percentile_cont(0.5) within group (
    order by extract(epoch from l.first_dial_at - l.posted_at)
  ) filter (where l.first_dial_at is not null) as median_seconds,

  count(*) filter (
    where l.first_dial_at is not null and (l.first_dial_at - l.posted_at) <= interval '1 minute'
  )::integer as dialled_within_60s,

  -- The share dialled inside a minute, as a percentage of leads POSTED, not of leads dialled.
  -- Over dialled leads it would report 100% for a vendor whose one answered lead was fast and
  -- whose other nine hundred were never called at all.
  round(
    100.0 * count(*) filter (
      where l.first_dial_at is not null and (l.first_dial_at - l.posted_at) <= interval '1 minute'
    ) / nullif(count(*), 0)
  , 1) as dialled_within_60s_pct
from public.agent_leads l
join public.tenant_campaigns c on c.id = l.campaign_id
-- Only real-time posted leads have a speed-to-lead. A list lead imported at 2am has an arrival
-- time that means nothing, and including it would bury the number this criterion is about.
where l.posted_at is not null
group by l.tenant_id, c.vendor_id;

revoke all on public.tenant_vendor_speed_to_lead from anon, authenticated, public;
grant select on public.tenant_vendor_speed_to_lead to tenant_app, service_role;

-- Runs with the caller's rights, so the RLS on `agent_leads` and `tenant_campaigns` applies. Without
-- this every tenant would read every other tenant's speed-to-lead.
alter view public.tenant_vendor_speed_to_lead set (security_invoker = on);

-- ── the arithmetic, asserted ───────────────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_vendor uuid;
  v_campaign uuid;
  v_median numeric;
  v_pct numeric;
  v_posted integer;
begin
  select id into v_tenant from public.tenants order by created_at limit 1;
  if v_tenant is null then
    raise notice 'LA-2.5 speed check skipped: no tenant in this database';
    return;
  end if;

  -- The view reads `agent_leads`, whose not-null columns come from the template contract, so this
  -- check verifies the arithmetic against a temporary view over a literal fixture instead of
  -- inserting leads. The expression under test is copied, not re-derived.
  create temporary table la_2_5_speed_fixture (posted_at timestamptz, first_dial_at timestamptz)
    on commit drop;
  insert into la_2_5_speed_fixture values
    (now(),                 now() + interval '30 seconds'),   -- inside a minute
    (now(),                 now() + interval '45 seconds'),   -- inside a minute
    (now(),                 now() + interval '10 minutes'),   -- dialled, but late
    (now(),                 null);                            -- never dialled

  select
    count(*)::integer,
    percentile_cont(0.5) within group (
      order by extract(epoch from first_dial_at - posted_at)
    ) filter (where first_dial_at is not null),
    round(100.0 * count(*) filter (
      where first_dial_at is not null and (first_dial_at - posted_at) <= interval '1 minute'
    ) / nullif(count(*), 0), 1)
  into v_posted, v_median, v_pct
  from la_2_5_speed_fixture;

  if v_posted <> 4 then
    raise exception 'LA-2.5: expected 4 posted leads, got %', v_posted;
  end if;

  -- Three dialled at 30s, 45s and 600s. The median of those is 45, NOT the mean of 225 — which is
  -- the entire reason the task asks for a median.
  if round(v_median) <> 45 then
    raise exception 'LA-2.5: expected a median of 45 seconds over dialled leads, got %', v_median;
  end if;

  -- Two of four POSTED leads were dialled inside a minute. Over dialled leads alone it would read
  -- 66.7%, which would flatter a vendor whose leads go uncalled.
  if v_pct <> 50.0 then
    raise exception 'LA-2.5: expected 50%% dialled within 60s over posted leads, got %', v_pct;
  end if;

  raise notice 'LA-2.5 speed check passed: median 45s over dialled, 50%% within 60s over posted';
end $$;


-- ===========================================================================
-- 20260917144000_la_2_7_slot_rotation_cannot_deadlock.sql
-- ===========================================================================
-- LA-2.7, as amended by decision 2 of "Sixteen Open Questions, Answered" (2026-09-11, newer than
-- every task page):
--
--   "If every slot has already been used, take the least recently used slot rather than blocking or
--    waiting. **The engine must never deadlock because it ran out of fresh slots.**"
--
-- It deadlocks today, and the arithmetic makes it reachable rather than theoretical.
--
-- There are six slots — early_morning, late_morning, afternoon, early_evening, late_evening,
-- weekend — and the attempt ceiling is seven. The serving query admits a retry lead to tier 4 only
-- when:
--
--     not exists (select 1 from tenant_call_attempts ca
--                  where ca.lead_id = l.id
--                    and ca.slot = current_slot_for_state(state, now))
--
-- Once a lead has been dialled in all six slots, every value `current_slot_for_state` can return
-- matches a prior attempt, so that condition is false at every hour of every day, forever. The lead
-- sits at `lead_state = 'retry'` with an elapsed timer and is never served again. No other tier
-- takes it: tier 5 requires `fresh`, tier 6 requires `nurture`. So attempt seven never happens, and
-- because exhaustion is recorded by the disposition path, the lead never reaches nurture either —
-- it is stuck, invisibly, in a state that looks active.
--
-- Two things are wrong and both are fixed here.
--
-- **1. The serving condition has no fallback.** `schedule_next_attempt` does have one, so the
-- scheduler happily writes `next_preferred_slot` for attempt seven — and then the serving query
-- refuses to act on it. The fallback existed on the wrong side of the gate.
--
-- The fix reads the slot the scheduler already chose. `next_preferred_slot` is written alongside
-- `next_dial_after` on every retry, and it is only ever set to an already-used slot in the
-- scheduler's own all-slots-used branch. So "the current slot is the one the scheduler asked for"
-- is exactly the fallback, and in the ordinary case the existing unused-slot branch still fires
-- first. One column comparison on the hot path: no extra subquery and no extra function call, which
-- matters because this query is already the module's known performance problem.
--
-- **2. The scheduler's fallback was not least-recently-used, and was not even deterministic.**
-- It took `v_tried[1]` from `array_agg(distinct ca.slot)`, and the order of a `distinct` aggregate
-- is unspecified — so the "fallback slot" was whichever one the planner happened to emit first.
-- Decision 2 asks for the least recently used, which is the only choice that means anything: it is
-- the slot whose evidence is oldest, and therefore the one most worth testing again.

-- ── the scheduler, with a real LRU fallback ────────────────────────────────
create or replace function public.schedule_next_attempt(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_disposition text,
  p_at timestamptz default now()
)
returns table(due_at timestamptz, attempt_number integer, slot text, exhausted boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_made integer;
  v_next integer;
  v_ceiling integer := 7;
  v_campaign uuid;
  v_state text;
  v_delay interval;
  v_preferred text;
  v_slot text;
  v_tried text[];
  v_unused text[];
  v_available text[] := array['early_morning','late_morning','afternoon','early_evening','late_evening','weekend'];
begin
  select coalesce(attempts_made, 0), campaign_id, values->>'state'
    into v_made, v_campaign, v_state
    from agent_leads where id = p_lead_id and tenant_id = p_tenant_id;

  v_next := v_made + 1;

  -- The ceiling terminates rather than schedules. Returning a date far in the future would have
  -- been the easy way to say "stop" and the wrong one: a queue that only checks whether the timer
  -- has elapsed would serve it eventually.
  if v_made >= v_ceiling - 1 then
    return query select null::timestamptz, v_next, null::text, true;
    return;
  end if;

  -- A disposition-specific row beats the catch-all, and a campaign row beats the tenant default.
  -- "No-answer and voicemail should not behave identically."
  select r.delay_interval, r.preferred_slot into v_delay, v_preferred
    from tenant_cadence_rules r
   where r.tenant_id = p_tenant_id
     and r.attempt_number = v_next
     and (r.campaign_id = v_campaign or r.campaign_id is null)
     and (r.disposition_scope = p_disposition or r.disposition_scope is null)
   order by (r.campaign_id is not null) desc, (r.disposition_scope is not null) desc
   limit 1;

  -- The default table from the task, front-loaded, used when the tenant has defined nothing.
  if v_delay is null then
    v_delay := case v_next
      when 1 then interval '2 hours'
      when 2 then interval '1 day'
      when 3 then interval '1 day'
      when 4 then interval '2 days'
      when 5 then interval '3 days'
      else interval '5 days'
    end;
    if v_next = 4 then v_preferred := 'weekend'; end if;
  end if;

  -- Slots this lead has already been DIALLED in. `slot` is NOT NULL on the attempts table, but the
  -- filter is explicit anyway: a single null would make `not (s = any(v_tried))` evaluate to null
  -- for every candidate and silently empty `v_unused`, which would turn slot rotation off across
  -- the whole tenant without any error.
  select coalesce(array_agg(distinct ca.slot), array[]::text[]) into v_tried
    from tenant_call_attempts ca
   where ca.tenant_id = p_tenant_id and ca.lead_id = p_lead_id and ca.slot is not null;

  -- A preference is honoured only while it is unused: a stored preference must not override the
  -- evidence that it already failed.
  if v_preferred is not null and not (v_preferred = any(v_tried)) then
    v_slot := v_preferred;
  else
    select coalesce(array_agg(s order by ord), array[]::text[]) into v_unused
      from unnest(v_available) with ordinality as u(s, ord)
     where not (u.s = any(v_tried));

    if array_length(v_unused, 1) is null then
      -- Every slot has been dialled. Decision 2: take the LEAST RECENTLY USED slot rather than
      -- blocking. The previous version took `v_tried[1]`, and because the order of a `distinct`
      -- aggregate is unspecified that was whichever slot the planner emitted first — not the
      -- oldest, and not even stable between runs.
      --
      -- Least recently used is the only choice that carries information: it is the slot whose
      -- evidence is oldest, so it is the one whose "they do not answer then" is least likely to
      -- still be true. `ca.slot` breaks ties so the answer is deterministic.
      select ca.slot into v_slot
        from tenant_call_attempts ca
       where ca.tenant_id = p_tenant_id and ca.lead_id = p_lead_id and ca.slot is not null
       group by ca.slot
       order by max(ca.attempted_at) asc, ca.slot asc
       limit 1;
      -- Only reachable if the lead has no attempts at all, in which case v_unused would not have
      -- been empty. Kept so the function cannot return a null slot under any path.
      v_slot := coalesce(v_slot, v_available[1]);
    else
      -- ADVANCE BY ATTEMPT NUMBER rather than always taking the first unused slot. Every call in a
      -- single working day happens in the same real-world slot, so `v_tried` barely moves between
      -- attempts, and taking the first unused entry proposed the same hour over and over. The
      -- proposal is a hypothesis about when this person answers; repeating one that has already
      -- been made is not a hypothesis.
      v_slot := v_unused[((v_next - 1) % array_length(v_unused, 1)) + 1];
    end if;
  end if;

  -- The delay is a FLOOR, not an appointment. Decision 2: "retry no sooner than the configured
  -- delay, at the next unused slot inside the legal window." This function returns the earliest
  -- moment the lead becomes eligible; the serving query holds it back until the chosen slot
  -- actually arrives, which is what makes "+2h" and "a different slot" compatible rather than
  -- contradictory.
  return query select p_at + v_delay, v_next, v_slot, false;
end;
$function$;

revoke all on function public.schedule_next_attempt(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.schedule_next_attempt(uuid, uuid, text, timestamptz) to tenant_app, service_role;

-- ── the serving query, which can no longer deadlock ────────────────────────
--
-- Reproduced in full because a function body cannot be patched. The ONLY change from
-- 20260913399000 is the tier-4 slot condition, in both the scored and the naive path: it now also
-- admits the lead when the current slot is the one the scheduler chose. Everything else — the
-- materialized-candidates shape, the holdout arithmetic, the reclaim, the reason text — is
-- unchanged, deliberately, so this migration is reviewable as a one-line behavioural change.
create or replace function public.serve_next_lead(p_tenant_id uuid, p_agent_user_id uuid)
returns table(
  work_item_id uuid,
  lead_id uuid,
  tier integer,
  tier_name text,
  locked_until timestamptz,
  appointment_notes text,
  selection_reason text,
  score numeric,
  cohort text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_lock_minutes integer := 15;
  v_candidate_cap integer := 50;
  v_qid uuid;
  v_lead uuid;
  v_priority integer;
  v_notes text;
  v_enabled boolean := false;
  v_holdout integer := 0;
  v_cohort text := 'control';
  v_serve_control boolean := false;
  v_score numeric;
  v_reason text;
  v_signals jsonb := '{}'::jsonb;
  v_tier_reason text;
  s record;
begin
  select coalesce(ts.enabled, false), coalesce(ts.holdout_pct, 0)
    into v_enabled, v_holdout
    from tenant_scoring_settings ts where ts.tenant_id = p_tenant_id;
  v_enabled := coalesce(v_enabled, false);
  v_holdout := coalesce(v_holdout, 0);

  update lead_queue q
     set status = 'unclaimed', claimed_by = null, owner_user_id = null, locked_until = null
   where q.tenant_id = p_tenant_id
     and q.status = 'claimed'
     and q.locked_until is not null
     and q.locked_until < v_now;

  -- The holdout is decided per serve so the control group is actually dialled; the cohort is a
  -- property of the lead so its outcome stays attributable. Both halves are needed: a holdout that
  -- is never served produces no contact rate, and a lead that changes sides produces a meaningless
  -- one.
  v_serve_control := v_enabled and (random() * 100) < v_holdout;

  if v_enabled and not v_serve_control then
    -- ── scored path ────────────────────────────────────────────────────────
    with eligible as materialized (
      select q.id as qid, q.lead_id as lid,
             case
               when l.posted_at is not null and l.posted_at >= v_now - interval '5 minutes' then 1
               when exists (select 1 from tenant_callbacks cb
                             where cb.tenant_id = p_tenant_id and cb.work_item_id = q.id
                               and cb.status in ('scheduled', 'due') and cb.scheduled_at_utc <= v_now) then 2
               when exists (select 1 from tenant_appointments ap
                             where ap.tenant_id = p_tenant_id and ap.lead_id = q.lead_id
                               and ap.status in ('booked', 'confirmed')
                               and ap.starts_at_utc <= v_now
                               and (ap.agent_user_id = p_agent_user_id or ap.agent_user_id is null)) then 3
               when l.lead_state = 'retry' and l.next_dial_after is not null and l.next_dial_after <= v_now
                    and (
                      -- The scheduler's choice. Only ever an already-used slot when every slot has
                      -- been used, which is the least-recently-used fallback decision 2 requires.
                      current_slot_for_state(l.values->>'state', v_now) = l.next_preferred_slot
                      or not exists (
                        select 1 from tenant_call_attempts ca
                         where ca.tenant_id = p_tenant_id and ca.lead_id = l.id
                           and ca.slot = current_slot_for_state(l.values->>'state', v_now)
                      )
                    ) then 4
               when l.lead_state = 'fresh' and (l.next_dial_after is null or l.next_dial_after <= v_now) then 5
               when l.lead_state = 'nurture' and l.next_dial_after is not null and l.next_dial_after <= v_now then 6
               else null
             end as priority,
             coalesce(c.mixing_weight, 1) as weight,
             l.posted_at as posted_at, q.queued_at as queued_at
        from lead_queue q
        join agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
        left join tenant_campaigns c on c.id = l.campaign_id
       where q.tenant_id = p_tenant_id
         and q.status = 'unclaimed'
         and (q.locked_until is null or q.locked_until < v_now)
         and (abs(hashtextextended(q.lead_id::text, 42)) % 100) >= v_holdout
         and (l.campaign_id is null
              or exists (select 1 from campaigns_servable cs where cs.id = l.campaign_id))
         and not (select sup.suppressed from is_phone_suppressed(p_tenant_id, l.values->>'phone') sup)
         and tenant_can_dial_now(p_tenant_id, l.values->>'state', l.campaign_id, v_now)
         and l.lead_state <> 'exhausted'
    ),
    candidates as (
      -- ONE reference to `eligible`, which is why the tier filter is an ORDER BY rather than a
      -- `priority = (select min(priority) from eligible)`. A CTE named twice is materialised, and
      -- materialising meant evaluating is_phone_suppressed and tenant_can_dial_now over the whole
      -- queue and then walking it a second time for the minimum. Sorting by priority first picks
      -- the best tier without ever asking what the best tier is.
      select e.*
        from eligible e
       where e.priority is not null
       order by e.priority, coalesce(e.posted_at, e.queued_at) desc
       limit v_candidate_cap
    )
    -- `priority` leads the final ordering too. The cap can spill into the next tier when the best
    -- tier holds fewer than fifty leads, and without this a fresh lead with a high score would be
    -- served ahead of a callback the customer is waiting for. Scoring orders WITHIN a tier; it
    -- does not get a vote on which tier comes first.
    select c.qid, c.lid, c.priority
      into v_qid, v_lead, v_priority
      from candidates c
      cross join lateral score_lead(p_tenant_id, c.lid, v_now) sl
     order by c.priority,
              sl.score desc,
              -ln(greatest(random(), 1e-9)) / greatest(c.weight, 1),
              coalesce(c.posted_at, c.queued_at)
     limit 1;
    v_cohort := 'scored';
  end if;

  -- ── naive path ─────────────────────────────────────────────────────────
  --
  -- This is LA-2.8's query, unchanged. It runs when scoring is off, when this serve drew the
  -- holdout, and when the scored pool turned out to be empty. The cohort filter is applied only
  -- while the holdout is being served; the empty-pool fallback drops it, because a queue that goes
  -- idle over a coin flip is worse than a comparison with slightly uneven arms.
  if v_qid is null then
    with eligible as (
      select q.id as qid, q.lead_id as lid,
             case
               when l.posted_at is not null and l.posted_at >= v_now - interval '5 minutes' then 1
               when exists (select 1 from tenant_callbacks cb
                             where cb.tenant_id = p_tenant_id and cb.work_item_id = q.id
                               and cb.status in ('scheduled', 'due') and cb.scheduled_at_utc <= v_now) then 2
               when exists (select 1 from tenant_appointments ap
                             where ap.tenant_id = p_tenant_id and ap.lead_id = q.lead_id
                               and ap.status in ('booked', 'confirmed')
                               and ap.starts_at_utc <= v_now
                               and (ap.agent_user_id = p_agent_user_id or ap.agent_user_id is null)) then 3
               when l.lead_state = 'retry' and l.next_dial_after is not null and l.next_dial_after <= v_now
                    and (
                      current_slot_for_state(l.values->>'state', v_now) = l.next_preferred_slot
                      or not exists (
                        select 1 from tenant_call_attempts ca
                         where ca.tenant_id = p_tenant_id and ca.lead_id = l.id
                           and ca.slot = current_slot_for_state(l.values->>'state', v_now)
                      )
                    ) then 4
               when l.lead_state = 'fresh' and (l.next_dial_after is null or l.next_dial_after <= v_now) then 5
               when l.lead_state = 'nurture' and l.next_dial_after is not null and l.next_dial_after <= v_now then 6
               else null
             end as priority,
             coalesce(c.mixing_weight, 1) as weight,
             l.posted_at as posted_at, q.queued_at as queued_at
        from lead_queue q
        join agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
        left join tenant_campaigns c on c.id = l.campaign_id
       where q.tenant_id = p_tenant_id
         and q.status = 'unclaimed'
         and (q.locked_until is null or q.locked_until < v_now)
         and (not v_serve_control
              or (abs(hashtextextended(q.lead_id::text, 42)) % 100) < v_holdout)
         and (l.campaign_id is null
              or exists (select 1 from campaigns_servable cs where cs.id = l.campaign_id))
         and not (select sup.suppressed from is_phone_suppressed(p_tenant_id, l.values->>'phone') sup)
         and tenant_can_dial_now(p_tenant_id, l.values->>'state', l.campaign_id, v_now)
         and l.lead_state <> 'exhausted'
    )
    select e.qid, e.lid, e.priority
      into v_qid, v_lead, v_priority
      from eligible e
     where e.priority is not null
     order by e.priority,
              -ln(greatest(random(), 1e-9)) / greatest(e.weight, 1),
              coalesce(e.posted_at, e.queued_at)
     limit 1;

    if v_qid is not null then
      -- The lead's own cohort, not the pool this serve drew from: a scored lead reached by the
      -- empty-pool fallback is still a scored lead, and recording it as control would put a lead
      -- the scorer chose on the control side of the comparison.
      v_cohort := case
        when not v_enabled then 'control'
        when (abs(hashtextextended(v_lead::text, 42)) % 100) < v_holdout then 'control'
        else 'scored' end;
    end if;
  end if;

  if v_qid is null then
    return;
  end if;

  update lead_queue q
     set status = 'claimed',
         claimed_by = p_agent_user_id,
         owner_user_id = p_agent_user_id,
         claimed_at = v_now,
         locked_until = v_now + make_interval(mins => v_lock_minutes),
         updated_at = v_now
   where q.id = v_qid and q.status = 'unclaimed';

  if not found then
    return;
  end if;

  update agent_leads l
     set lead_state = 'working',
         first_dial_at = coalesce(l.first_dial_at, v_now),
         updated_at = v_now
   where l.id = v_lead and l.tenant_id = p_tenant_id;

  if v_priority = 3 then
    select ap.notes into v_notes from tenant_appointments ap
     where ap.tenant_id = p_tenant_id and ap.lead_id = v_lead
       and ap.status in ('booked', 'confirmed') and ap.starts_at_utc <= v_now
     order by ap.starts_at_utc limit 1;
  end if;

  -- THE REASON, ALWAYS. Criterion 1 says every served lead carries one, and that includes the
  -- leads served while scoring is off — which is every lead, on the day this ships. The tier is a
  -- reason in itself: "this customer asked you to ring back now" explains the choice more
  -- completely than any score could.
  v_tier_reason := case v_priority
    when 1 then 'Posted less than five minutes ago'
    when 2 then 'A callback you promised is due'
    when 3 then 'An appointment a setter booked is due'
    when 4 then 'Due for a retry, in a slot it has not been tried in'
    when 5 then 'A fresh lead that has never been called'
    when 6 then 'Due for a nurture touch'
  end;

  if v_enabled and v_cohort = 'scored' then
    select sl.score, sl.reasons, sl.signals into s from score_lead(p_tenant_id, v_lead, v_now) sl;
    v_score := s.score;
    v_signals := coalesce(s.signals, '{}'::jsonb);
    v_reason := v_tier_reason || case
      when array_length(s.reasons, 1) > 0 then ' — ' || array_to_string(s.reasons, '; ')
      else '' end;
  else
    v_reason := v_tier_reason || case
      when v_enabled then ' — served in the naive order, as part of the holdout'
      else '' end;
    v_score := null;
  end if;

  insert into tenant_scoring_decisions
    (tenant_id, lead_id, work_item_id, agent_user_id, cohort, score, signal_snapshot,
     selection_reason, served_at)
  values
    (p_tenant_id, v_lead, v_qid, p_agent_user_id, v_cohort, v_score, v_signals, v_reason, v_now);

  return query
    select v_qid, v_lead, v_priority,
           case v_priority
             when 1 then 'realtime' when 2 then 'callback' when 3 then 'appointment'
             when 4 then 'retry' when 5 then 'fresh' when 6 then 'nurture' end,
           v_now + make_interval(mins => v_lock_minutes),
           v_notes,
           v_reason,
           v_score,
           v_cohort;
end;
$function$;

revoke all on function public.serve_next_lead(uuid, uuid) from public, anon, authenticated;
grant execute on function public.serve_next_lead(uuid, uuid) to tenant_app, service_role;

-- ── the deadlock, asserted absent ──────────────────────────────────────────
do $$
declare
  v_reclaim integer;
  v_fallback integer;
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'serve_next_lead';

  -- The reclaim fix from 20260913401000 must survive this rewrite. It is the reason an abandoned
  -- lock returns the lead to the pool (LA-2.8 criterion 3), and re-emitting the function is exactly
  -- how a previous fix gets quietly dropped.
  select count(*) into v_reclaim
    from regexp_matches(v_def, 'set status = ''unclaimed''', 'g');
  if v_reclaim < 1 then
    raise exception 'LA-2.8: the reclaim of abandoned locks did not survive the rewrite';
  end if;

  -- Both paths — scored and naive — must carry the fallback, or a tenant with scoring enabled and
  -- a holdout draw still deadlocks half the time.
  select count(*) into v_fallback
    from regexp_matches(v_def, 'current_slot_for_state\(l\.values->>''state'', v_now\) = l\.next_preferred_slot', 'g');
  if v_fallback <> 2 then
    raise exception 'LA-2.7: expected the slot fallback in both serving paths, found %', v_fallback;
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'schedule_next_attempt';
  if v_def !~ 'order by max\(ca\.attempted_at\) asc' then
    raise exception 'LA-2.7: the all-slots-used fallback is not least-recently-used';
  end if;
  if v_def ~ 'v_slot := v_tried\[1\]' then
    raise exception 'LA-2.7: the non-deterministic v_tried[1] fallback is still present';
  end if;

  raise notice 'LA-2.7: slot rotation falls back to least-recently-used and can no longer deadlock';
end $$;


-- ===========================================================================
-- 20260917145000_la_2_8_inbound_return_call.sql
-- ===========================================================================
-- LA-2.8, as amended by decision 1 of "Sixteen Open Questions, Answered" (2026-09-11):
--
--   "A call that comes out of a search gets its own disposition — **inbound return call** — so it
--    never gets counted as an outbound dial attempt in the cadence maths."
--
-- The disposition does not exist. A repository-wide search finds no `inbound_return_call` anywhere:
-- not in the dialer's vocabulary, not in this function, not in the UI.
--
-- What that costs. A customer Ray rang yesterday rings him back today. He finds them through the
-- lead search — which does exist, and correctly does not serve or claim — and takes the call. To
-- record it he must pick from the outbound vocabulary, so the call lands as `no_answer`,
-- `not_interested` or whatever fits. Every one of those:
--
--   * increments `attempts_made`, spending one of the lead's seven attempts on a call the lead
--     never made;
--   * runs the cadence, rewriting `next_dial_after` and `next_preferred_slot` from a slot the
--     customer chose rather than one we proposed;
--   * completes or requeues the work item, moving the lead's position in the queue.
--
-- Decision 1 forbids all three, in the same sentence that creates the disposition. The cadence is a
-- record of hypotheses WE tested about when this person answers. A call they initiated is evidence
-- about nothing of the sort, and folding it in corrupts the one thing the cadence is for.
--
-- So `inbound_return_call` is handled before anything else is touched: the attempt row is written,
-- because it is real history and belongs in the lead's timeline, and nothing else moves.

create or replace function public.complete_existing_dial_disposition(
  p_tenant_id uuid,
  p_attempt_id uuid,
  p_agent_user_id uuid,
  p_disposition text,
  p_dial_clicked_at timestamptz default null,
  p_provider_call_id text default null
)
returns table(lead_state text, next_dial_after timestamptz, next_slot text, suppressed boolean, reason text)
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_attempt public.tenant_call_attempts;
  v_item public.lead_queue;
  v_lead public.agent_leads;
  v_phone text;
  v_slot text;
  v_now timestamptz := clock_timestamp();
  v_sched record;
  v_new_state text;
  v_suppressed boolean := false;
  v_reason text;
  v_existing_next_dial_after timestamptz;
  v_existing_next_slot text;
begin
  select * into v_attempt
    from public.tenant_call_attempts
   where id = p_attempt_id and tenant_id = p_tenant_id and agent_id = p_agent_user_id
   for update;
  if not found then raise exception 'CALL_ATTEMPT_NOT_FOUND'; end if;

  -- An inbound return call has no work item by design: it did not come from the queue, so nothing
  -- was ever claimed. Every other disposition still requires one, because every other disposition
  -- moves the queue row it belongs to.
  if v_attempt.work_item_id is null and p_disposition <> 'inbound_return_call' then
    raise exception 'CALL_ATTEMPT_WORK_ITEM_MISSING';
  end if;

  if v_attempt.disposition is not null then
    if v_attempt.disposition <> p_disposition then raise exception 'CALL_ATTEMPT_ALREADY_DISPOSITIONED'; end if;
    select l.lead_state, l.next_dial_after, l.next_preferred_slot
      into v_new_state, v_existing_next_dial_after, v_existing_next_slot
      from public.agent_leads l where l.id = v_attempt.lead_id and l.tenant_id = p_tenant_id;
    return query select v_new_state, v_existing_next_dial_after, v_existing_next_slot, false, 'Disposition was already recorded for this attempt.';
    return;
  end if;
  if v_attempt.disclosure_confirmed_at is null then raise exception 'DISCLOSURE_NOT_CONFIRMED'; end if;
  if coalesce(v_attempt.dial_clicked_at, p_dial_clicked_at) is null then raise exception 'DIAL_NOT_RECORDED'; end if;

  select * into v_lead from public.agent_leads
   where id = v_attempt.lead_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'LEAD_NOT_FOUND'; end if;

  -- ── the inbound return call, handled before anything is mutated ──────────
  --
  -- Records the call and returns the lead's cadence EXACTLY as it already stood. No
  -- `attempts_made` increment, no `schedule_next_attempt`, no `lead_queue` write. The lead's place
  -- in the queue, its retry timer and its next slot are all left where the outbound cadence put
  -- them, which is decision 1's whole requirement.
  if p_disposition = 'inbound_return_call' then
    update public.tenant_call_attempts
       set disposition = p_disposition,
           dial_clicked_at = coalesce(dial_clicked_at, p_dial_clicked_at, v_now),
           provider_call_id = coalesce(provider_call_id, p_provider_call_id)
     where id = v_attempt.id;

    insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
    values ('tenant', p_agent_user_id, 'tenant.dial_dispositioned', 'tenant_call_attempts', v_attempt.id::text,
            jsonb_build_object('leadId', v_lead.id, 'disposition', p_disposition,
                               'leadState', v_lead.lead_state, 'countsTowardCadence', false));

    return query select v_lead.lead_state, v_lead.next_dial_after, v_lead.next_preferred_slot, false,
                        'Logged as an inbound return call. The outbound cadence is unchanged and no attempt was used.';
    return;
  end if;

  select * into v_item from public.lead_queue
   where id = v_attempt.work_item_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'WORK_ITEM_NOT_FOUND'; end if;

  v_phone := v_lead.values->>'phone';
  v_slot := coalesce(v_attempt.slot, current_slot_for_state(v_lead.values->>'state', v_now), 'late_morning');
  update public.tenant_call_attempts
     set disposition = p_disposition,
         dial_clicked_at = coalesce(dial_clicked_at, p_dial_clicked_at),
         provider_call_id = coalesce(provider_call_id, p_provider_call_id)
   where id = v_attempt.id;
  update public.agent_leads set attempts_made = coalesce(attempts_made, 0) + 1 where id = v_lead.id;

  if p_disposition = 'do_not_call' then
    if v_phone is not null then
      perform suppress_phone(p_tenant_id, v_phone, 'internal', 'Agent recorded do not call on the dialer', 'disposition', p_agent_user_id);
      v_suppressed := true;
    end if;
    v_new_state := 'closed';
    v_reason := 'Added to the do-not-call list permanently. This lead will never be served again.';
  elsif p_disposition in ('wrong_number', 'disconnected') then
    v_new_state := 'closed';
    v_reason := 'Closed and flagged for a vendor credit claim.';
  elsif p_disposition in ('not_interested', 'did_not_qualify', 'application_submitted', 'sent_to_underwriting', 'no_payment_method') then
    v_new_state := 'closed';
    v_reason := 'Closed. No further attempts.';
  elsif p_disposition = 'callback_scheduled' then
    v_new_state := 'working';
    v_reason := 'A callback is scheduled; the cadence does not apply.';
  else
    select * into v_sched from schedule_next_attempt(p_tenant_id, v_lead.id, p_disposition, v_now);
    if v_sched.exhausted then
      v_new_state := 'exhausted';
      v_reason := format('Attempt %s reached the ceiling. Moved to nurture and no longer served.', coalesce(v_lead.attempts_made, 0) + 1);
      update public.agent_leads set lead_state = 'exhausted', next_dial_after = null, next_preferred_slot = null where id = v_lead.id;
    else
      v_new_state := 'retry';
      v_reason := format('Attempt %s scheduled for %s in the %s slot.', v_sched.attempt_number, to_char(v_sched.due_at, 'Dy DD Mon HH24:MI'), replace(v_sched.slot, '_', ' '));
      update public.agent_leads set lead_state = 'retry', next_dial_after = v_sched.due_at, next_preferred_slot = v_sched.slot where id = v_lead.id;
    end if;
  end if;

  if v_new_state in ('closed', 'working') then
    update public.agent_leads set lead_state = v_new_state, next_dial_after = null, next_preferred_slot = null where id = v_lead.id;
  end if;
  update public.lead_queue
     set status = case when v_new_state = 'retry' then 'unclaimed' else 'completed' end,
         claimed_by = null, owner_user_id = null, locked_until = null,
         disposition = p_disposition, disposition_at = v_now, disposition_by = p_agent_user_id,
         updated_at = v_now
   where id = v_item.id and tenant_id = p_tenant_id;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_agent_user_id, 'tenant.dial_dispositioned', 'tenant_call_attempts', v_attempt.id::text,
          jsonb_build_object('workItemId', v_item.id, 'leadId', v_lead.id, 'disposition', p_disposition, 'leadState', v_new_state));
  return query select v_new_state,
                      case when v_new_state = 'retry' then v_sched.due_at else null end,
                      case when v_new_state = 'retry' then v_sched.slot else null end,
                      v_suppressed, v_reason;
end;
$function$;

revoke all on function public.complete_existing_dial_disposition(uuid, uuid, uuid, text, timestamptz, text) from public, anon, authenticated, tenant_app;
grant execute on function public.complete_existing_dial_disposition(uuid, uuid, uuid, text, timestamptz, text) to service_role;

-- `work_item_id` must be nullable for an inbound return call to be recordable at all. It is checked
-- rather than altered blindly: if a NOT NULL constraint is there, the additive change is the one
-- that has to happen, and doing it silently inside an `alter` nobody reads is how a constraint
-- comes back later.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tenant_call_attempts'
       and column_name = 'work_item_id' and is_nullable = 'NO'
  ) then
    alter table public.tenant_call_attempts alter column work_item_id drop not null;
    raise notice 'LA-2.8: work_item_id relaxed to nullable so an inbound return call can be recorded';
  end if;
end $$;

-- ── the criterion, asserted ────────────────────────────────────────────────
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_existing_dial_disposition';

  if v_def !~ 'inbound_return_call' then
    raise exception 'LA-2.8: the inbound return call disposition is missing';
  end if;

  -- The inbound branch must return before the attempt counter is touched. If the increment ever
  -- moves above it, an inbound call silently spends one of the lead's seven outbound attempts and
  -- nothing fails visibly — the cadence just gets shorter.
  if position('inbound_return_call' in v_def) > position('attempts_made = coalesce(attempts_made, 0) + 1' in v_def) then
    raise exception 'LA-2.8: an inbound return call must be handled before attempts_made is incremented';
  end if;

  raise notice 'LA-2.8: an inbound return call records history without touching the cadence';
end $$;


-- ===========================================================================
-- 20260917146000_la_2_2_imported_leads_reach_the_dialer.sql
-- ===========================================================================
-- LA-2.2 / LA-2.8 · an imported list could never be dialled.
--
-- Found by driving the product in a browser rather than by reading it. A four-row CSV imported
-- cleanly — "2 imported", the right two rows, the DNC row withheld, the repeat collapsed — and then
-- the dialer said "Nothing servable" with both leads sitting in `agent_leads`.
--
-- `serve_next_lead` selects `from lead_queue q join agent_leads l on l.id = q.lead_id`. The queue is
-- the work-item table and it is the ONLY thing the server reads; a lead with no `lead_queue` row is
-- invisible to every tier, to scoring, to slot rotation and to the mixing weights. Confirmed against
-- the live database rather than against the source, because string-replacement migrations have made
-- grep unreliable here twice:
--
--   triggers on agent_leads                          stamp_lead_nurture_entry, touch_updated_at
--   live functions that INSERT into lead_queue       none
--   live import_agent_lead_batch mentions lead_queue  false
--
-- Two application paths enqueue — `lib/leadPost/service.ts` (a vendor POST, at tier 0) and
-- `lib/agentTemplates/intake.ts`. CSV import was never one of them, so the whole
-- VENDOR → CAMPAIGN → LIST → LEADS chain of Module 2 §5 ended one step short of the dialer.
--
-- Worth saying plainly: this was latent before LA-2.8 and the dialer hid it. The old dialer read
-- `/api/app/leads?limit=100` and auto-selected `loaded[0]`, so imported leads appeared — in the
-- wrong order, ignoring cadence and the priority tiers, but they appeared. Moving the dialer onto
-- `serve_next_lead` was right, and it turned a silent ordering bug into a visible empty queue.
--
-- The enqueue goes HERE, inside the function, rather than in TypeScript after the RPC returns,
-- because the review screen promises "Committed as one transaction — all of it or none of it". A
-- second round trip after the commit would make a partial import possible in exactly the way that
-- sentence says it is not: leads written, queue rows missing, and nothing to roll back to.
--
-- `tier` is left at its default of 100. LA-2.9's tier 0 is documented as "ahead of every list lead,
-- regardless of scoring", so a list lead taking the default is the intended ordering rather than an
-- omission. `status` defaults to 'unclaimed' and `stage_key` to 'new'; both are spelled out anyway,
-- because 'queued' is not one of the nine values the status check constraint allows and the next
-- person to read this should not have to go and find that out.

create or replace function public.import_agent_lead_batch(
  p_tenant_id uuid,
  p_created_by uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_item jsonb;
  v_lead_id uuid;
  v_ids jsonb := '[]'::jsonb;
  v_campaign_id uuid;
begin
  if p_tenant_id is null or p_created_by is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'IMPORT_BATCH_INVALID';
  end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 20000 then
    raise exception 'IMPORT_BATCH_SIZE_INVALID';
  end if;
  -- Membership lives in `tenant_users`, NOT on `public.users` — that column does not exist, and an
  -- earlier draft of this migration checked `users.tenant_id`. It would have applied cleanly
  -- (PL/pgSQL resolves column references at run time, not at CREATE) and then raised
  -- `42703 column "tenant_id" does not exist` on every single import, replacing a working actor
  -- check with a broken one. This is the shape the live function already uses; keep them identical.
  if not exists (
    select 1
      from public.tenant_users tu
      join public.users u on u.id = tu.user_id
     where tu.tenant_id = p_tenant_id
       and tu.user_id = p_created_by
       and u.status in ('active', 'invited')
  ) then
    raise exception 'IMPORT_ACTOR_INVALID';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'IMPORT_ITEM_INVALID'; end if;
    v_campaign_id := nullif(v_item->>'campaign_id', '')::uuid;
    v_lead_id := nullif(v_item->>'lead_id', '')::uuid;

    if v_lead_id is not null then
      if not exists (select 1 from public.agent_leads where id = v_lead_id and tenant_id = p_tenant_id) then
        raise exception 'IMPORT_LEAD_SCOPE_INVALID';
      end if;
      perform 1 from public.agent_leads where id = v_lead_id and tenant_id = p_tenant_id for update;
    else
      if jsonb_typeof(v_item->'values') <> 'object'
         or nullif(v_item->>'template_id', '') is null
         or nullif(v_item->>'product_line', '') is null
         or nullif(v_item->>'pipeline_id', '') is null
         or nullif(v_item->>'stage_id', '') is null then
        raise exception 'IMPORT_ITEM_INVALID';
      end if;
      insert into public.agent_leads (
        tenant_id, tenant_template_id, template_id, template_version, definition_version,
        product_line, pipeline_id, stage_id, values, campaign_id,
        screening_result_id, screening_version, screening_outcome, screening_warning,
        screening_checked_at, created_by
      ) values (
        p_tenant_id,
        nullif(v_item->>'tenant_template_id', '')::uuid,
        (v_item->>'template_id')::uuid,
        greatest(1, coalesce(nullif(v_item->>'template_version', '')::integer, 1)),
        greatest(1, coalesce(nullif(v_item->>'definition_version', '')::integer, 1)),
        v_item->>'product_line', (v_item->>'pipeline_id')::uuid, (v_item->>'stage_id')::uuid,
        v_item->'values', v_campaign_id,
        nullif(v_item->>'screening_result_id', '')::uuid,
        nullif(v_item->>'screening_version', '')::integer,
        nullif(v_item->>'screening_outcome', ''),
        nullif(v_item->>'screening_warning', ''),
        nullif(v_item->>'screening_checked_at', '')::timestamptz,
        p_created_by
      ) returning id into v_lead_id;
    end if;

    -- The step that was missing. Guarded by "has no live work item" rather than by which branch we
    -- came through, so that re-importing a number that already exists as a lead does not create a
    -- second open work item, and so that a lead imported before this migration gets one the next
    -- time it appears in a file.
    --
    -- The four settled statuses are excluded deliberately: a lead that was worked and closed should
    -- become dialable again through the recycling path (LA-2.20), which is a decision with its own
    -- rules, not a side effect of appearing in another CSV.
    if not exists (
      select 1 from public.lead_queue
       where tenant_id = p_tenant_id
         and lead_id = v_lead_id
         and status not in ('completed', 'closed', 'dropped', 'expired')
    ) then
      insert into public.lead_queue (
        tenant_id, lead_id, product_line, pipeline_id, stage_id, stage_key, status, tier
      )
      select p_tenant_id, l.id, l.product_line, l.pipeline_id, l.stage_id, 'new', 'unclaimed', 100
        from public.agent_leads l
       where l.id = v_lead_id and l.tenant_id = p_tenant_id;
    end if;

    if v_campaign_id is not null then
      if not exists (select 1 from public.tenant_campaigns where id = v_campaign_id and tenant_id = p_tenant_id) then
        raise exception 'IMPORT_CAMPAIGN_SCOPE_INVALID';
      end if;
      perform public.import_agent_lead_source(
        p_tenant_id, v_lead_id, v_campaign_id, 'import',
        greatest(0, coalesce(nullif(v_item->>'cost_cents', '')::integer, 0)),
        nullif(v_item->>'source_key', '')
      );
    end if;
    v_ids := v_ids || jsonb_build_array(v_lead_id);
  end loop;
  return v_ids;
end;
$function$;

revoke all on function public.import_agent_lead_batch(uuid, uuid, jsonb) from public, anon, authenticated, tenant_app;
grant execute on function public.import_agent_lead_batch(uuid, uuid, jsonb) to service_role;

-- Backfill: every lead that has no live work item and was never worked. Without this, the two leads
-- imported during the verification pass — and any list a tenant has already imported — stay
-- permanently undialable, which is the same defect wearing a different hat.
--
-- Scoped to leads that have NO row at all rather than to a date, because "was imported before the
-- fix" is not recorded anywhere and a settled work item must not be reopened.
-- Written as a loop rather than one statement because of how many rows this actually is. Measured
-- on the live project, 2026-09-23: 214,823 leads against 11,543 queue rows, so the backfill inserts
-- a little over 203,000. That is one statement large enough to exceed a statement timeout — and a
-- timeout here does not fail politely, it rolls back every migration in front of it too.
--
-- Batching does not weaken anything. The whole file still runs in one transaction, so the
-- all-or-nothing property is unchanged; each statement simply gets its own timeout budget. The
-- `not exists` guard makes each pass idempotent, which is also what terminates the loop.
do $$
declare
  v_batch integer;
  v_total bigint := 0;
begin
  loop
    insert into public.lead_queue (
      tenant_id, lead_id, product_line, pipeline_id, stage_id, stage_key, status, tier
    )
    select l.tenant_id, l.id, l.product_line, l.pipeline_id, l.stage_id, 'new', 'unclaimed', 100
      from public.agent_leads l
     where not exists (select 1 from public.lead_queue q where q.tenant_id = l.tenant_id and q.lead_id = l.id)
     limit 25000;

    get diagnostics v_batch = row_count;
    exit when v_batch = 0;
    v_total := v_total + v_batch;
    raise notice 'LA-2.2 backfill: % work items created so far', v_total;
  end loop;
  raise notice 'LA-2.2 backfill complete: % lead(s) can now be served', v_total;
end $$;

-- Proof the function now does what the comment claims, asserted rather than asserted-in-prose.
do $$
declare
  v_missing integer;
begin
  select count(*) into v_missing
    from public.agent_leads l
   where not exists (select 1 from public.lead_queue q where q.tenant_id = l.tenant_id and q.lead_id = l.id);
  if v_missing > 0 then
    raise exception 'LA-2.2 backfill left % lead(s) with no work item', v_missing;
  end if;

  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'import_agent_lead_batch'
         and pg_get_functiondef(p.oid) ~* 'insert\s+into\s+public\.lead_queue') <> 1 then
    raise exception 'import_agent_lead_batch does not enqueue';
  end if;
end $$;


-- ===========================================================================
-- 20260922190000_la_2_14_deal_date_and_policy_attribution.sql
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- LA-2.14, two criteria that were not met · audited 2026-09-22
--
-- ── 1. Criterion 5: "an outbound sale appears CORRECTLY in the daily deal flow"
--
-- `start_application_from_lead` inserts into `deal_flow` without `local_date`, so the column
-- default applies:
--
--   local_date date not null default current_date      (20260911100000, line 114)
--
-- `current_date` is the SESSION's date, which for every connection this product makes is UTC.
--
-- That is the exact bug LA-1.7 criterion 5 names — *"the deal-flow date is correct for an agent
-- working late in their own timezone"* — and that `lib/dealFlow/localDate.ts` exists to prevent.
-- The inbound and manual paths both compute it with `intakeLocalDate(timeZone)`; this one, added
-- later and in SQL, could not reach that helper and silently took the UTC default instead.
--
-- The window is not an edge case for THIS feature. For a tenant on US Pacific time, UTC has already
-- rolled over from 17:00 local onwards — the entire evening calling block, which is when outbound
-- dialling actually happens. An agent closes a sale at 19:00, opens Daily deal flow (which defaults
-- to today), and it is filed against tomorrow.
--
-- Whose day is it? LA-1.7 says the agent's. So: the agent's own timezone when it is known — which
-- is now a real source, because LA-2.11's availability editor exists — then the customer's state
-- timezone, then UTC. The fallback chain is written out rather than assumed, because each step is a
-- different person's midnight.
--
-- ── 2. Criterion 2: "campaign_id and vendor_id survive onto the application AND THE POLICY RECORD"
--
-- The application half is done: `tenant_application_cases` carries both, and `deal_flow` gained them
-- in 20260913410000. The policy half is done too, in `tenant_issued_policies` (LA-2.17) — which the
-- first draft of this migration did not know, having looked at `tenant_policies` and found no
-- attribution there. `tenant_policies` is the serviced book of business and correctly carries none;
-- see the long note above section 2 for why adding it there would have been a second chain.
--
-- What was genuinely missing at this hop is the LINEAGE VIEW. `tenant_lead_attribution_chain` —
-- the view that exists to trace exactly this — stopped at `deal_flow`, so a lead whose policy lost
-- its campaign was invisible. Section 2 extends it to the issued policy.
-- ---------------------------------------------------------------------------

-- ── 1 ──────────────────────────────────────────────────────────────────────

create or replace function public.deal_local_date(
  p_tenant_id uuid,
  p_agent_user_id uuid,
  p_lead_values jsonb,
  p_at timestamptz default now()
)
returns date
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_zone text;
begin
  -- The agent's own working timezone, from LA-2.11's availability. `min` rather than `limit 1`
  -- without an order by, so two rows for one agent cannot make this answer differ between calls.
  select min(av.timezone) into v_zone
    from tenant_agent_availability av
   where av.tenant_id = p_tenant_id and av.user_id = p_agent_user_id;

  -- Then the customer's. Not the same midnight as the agent's, but far closer than UTC's, and
  -- always available for a lead that was legal to dial at all.
  if v_zone is null then
    select st.timezone into v_zone
      from state_timezones st
     where st.state = upper(nullif(btrim(coalesce(p_lead_values->>'state', '')), ''));
  end if;

  return (p_at at time zone coalesce(v_zone, 'UTC'))::date;
end;
$function$;

revoke all on function public.deal_local_date(uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.deal_local_date(uuid, uuid, jsonb, timestamptz) to tenant_app, service_role;

-- Patch the insert inside `start_application_from_lead` rather than restating the function, for the
-- same reason the LA-2.12 notify was patched in: this migration must not become a second copy of
-- the handoff's rules, which are long and are not what is being changed.
do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'start_application_from_lead';

  if v_src is null then
    raise exception 'start_application_from_lead does not exist; apply the LA-2.14 handoff migration first';
  end if;

  if v_src ~ 'deal_local_date' then
    raise notice 'the outbound deal already files against a local date';
    return;
  end if;

  v_new := replace(
    v_src,
    E'      (tenant_id, lead_id, partner_id, product_line, pipeline_id, stage_id,\n'
    || E'       insured_name, phone, source, worked_by)',
    E'      (tenant_id, lead_id, partner_id, product_line, pipeline_id, stage_id,\n'
    || E'       insured_name, phone, source, worked_by, local_date)'
  );
  if v_new = v_src then
    raise exception 'the deal_flow column list is not in the expected form; fix by hand';
  end if;
  v_src := v_new;

  v_new := replace(
    v_src,
    E'       v_name, v_phone, v_source, p_agent_user_id)',
    E'       v_name, v_phone, v_source, p_agent_user_id,\n'
    || E'       deal_local_date(p_tenant_id, p_agent_user_id, v_lead.values))'
  );
  if v_new = v_src then
    raise exception 'the deal_flow values list is not in the expected form; fix by hand';
  end if;

  execute v_new;
  raise notice 'the outbound deal now files against the agent local date';
end $$;


-- ── 2 ──────────────────────────────────────────────────────────────────────
--
-- CORRECTED 2026-09-22, during the LA-2.17 audit, before this migration was applied.
--
-- The first draft of this section added `campaign_id`, `vendor_id`, `lead_id` and an application
-- link to `public.tenant_policies`, on the finding that nothing joined a policy to the campaign that
-- produced it. The finding was right about `tenant_policies` and **wrong about the conclusion**:
-- LA-2.17 had already solved this, with a different table and for a stated reason.
--
--   `tenant_issued_policies`   tenant_id, lead_id, application_case_id, deal_id,
--                              campaign_id, vendor_id, carrier, policy_number, status, issued_at
--                              + enforce_issued_policy_attribution() as a before-trigger
--
-- and the LA-2.17 migration says why it did not extend the table this one was about to:
--
--   "The old `policies`-looking tables belong to the organization-era CRM or to the E&O vault and
--    cannot answer this question. A fabricated policy count would make vendor selection worse than
--    an honest empty report."
--
-- That reasoning holds. `tenant_policies` is the serviced book of business — rows an agent maintains
-- by hand, including policies written long before this product existed. Attribution on it would be a
-- SECOND chain answering the same question as the first, and two chains that can disagree about
-- which campaign produced a policy is worse than one chain that sometimes says "unknown".
--
-- So the columns are not added. What remains is the part that was genuinely missing: the lineage
-- view still stopped at `deal_flow`, so nothing could show a lead whose policy lost its attribution.
-- It now ends at `tenant_issued_policies`, which is where an outbound policy actually lands.
--
-- WHAT IS STILL OPEN, and it is not a schema problem: **no application code writes
-- `tenant_issued_policies`.** Measured live on 2026-09-22 — 0 rows, and no `from("tenant_issued_
-- policies")` anywhere under lib/ or app/. Recording an issued policy belongs to the Sell module,
-- so the report's Issued column and True CPA are correct, computable, and permanently null until
-- LA-3 writes that row. The view below makes that visible rather than leaving it to be discovered.

-- The same 42P16 that stopped the cost views, and it would have stopped this one three
-- migrations later. The deployed chain has `case_attribution_lost` in position 12; this
-- definition puts `issued_policy_id` there, because the policy columns belong beside the deal
-- columns they follow rather than tacked on after the loss flags.
--
-- No `cascade`: nothing reads this view today, and if something starts to, that should fail here
-- rather than disappear. The grant and `security_invoker` are re-applied immediately below.
drop view if exists public.tenant_lead_attribution_chain;

create or replace view public.tenant_lead_attribution_chain as
select l.tenant_id,
       l.id                as lead_id,
       l.campaign_id       as lead_campaign_id,
       c.vendor_id         as lead_vendor_id,
       ac.id               as application_case_id,
       ac.campaign_id      as case_campaign_id,
       ac.vendor_id        as case_vendor_id,
       d.id                as deal_id,
       d.campaign_id       as deal_campaign_id,
       d.vendor_id         as deal_vendor_id,
       d.source            as deal_source,
       p.id                as issued_policy_id,
       p.campaign_id       as policy_campaign_id,
       p.vendor_id         as policy_vendor_id,
       (ac.id is not null and l.campaign_id is not null and ac.campaign_id is null) as case_attribution_lost,
       (d.id  is not null and l.campaign_id is not null and d.campaign_id  is null) as deal_attribution_lost,
       (p.id  is not null and l.campaign_id is not null and p.campaign_id  is null) as policy_attribution_lost
  from agent_leads l
  left join tenant_campaigns c on c.id = l.campaign_id
  left join tenant_application_cases ac on ac.lead_id = l.id and ac.tenant_id = l.tenant_id
  left join deal_flow d on d.lead_id = l.id and d.tenant_id = l.tenant_id
  -- Only a live policy counts as the end of the chain. A lapsed or cancelled one did exist, and its
  -- attribution is still worth reading, so the status is not filtered here — the scorecard filters
  -- on `status = 'issued'` where that is the question being asked.
  left join tenant_issued_policies p on p.lead_id = l.id and p.tenant_id = l.tenant_id;

alter view public.tenant_lead_attribution_chain set (security_invoker = on);
revoke all on public.tenant_lead_attribution_chain from anon, authenticated, public;
grant select on public.tenant_lead_attribution_chain to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'start_application_from_lead'
         and pg_get_functiondef(p.oid) ~ 'deal_local_date') <> 1 then
    raise exception 'the outbound deal still files against the UTC date';
  end if;

  -- The chain must end at the table LA-2.17 built for this, not at the serviced book of business.
  if not exists (select 1 from information_schema.view_column_usage
                  where table_schema = 'public' and view_name = 'tenant_lead_attribution_chain'
                    and table_name = 'tenant_issued_policies') then
    raise exception 'the attribution chain does not reach tenant_issued_policies';
  end if;
  if exists (select 1 from information_schema.view_column_usage
              where table_schema = 'public' and view_name = 'tenant_lead_attribution_chain'
                and table_name = 'tenant_policies') then
    raise exception 'the attribution chain reads the serviced book of business; it must read tenant_issued_policies';
  end if;

  perform 1 from public.tenant_lead_attribution_chain limit 1;
end $$;


-- ===========================================================================
-- 20260922200000_la_2_18_size_warning_means_something.sql
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- LA-2.18 criterion 1 · "Comparing campaigns of VERY DIFFERENT SIZES produces an explicit warning,
-- not a verdict."
--
-- The warning fires on any inequality:
--
--   'size_warning', case when m.leads_a <> m.leads_b then '…' else null end
--
-- Two campaigns essentially never have identical lead counts, so the warning is on for every
-- comparison anybody will ever run — 4,000 against 3,999 gets the same red text as 4,000 against
-- 30. A warning that is always on carries no information, and the reader learns to scroll past the
-- one case where it mattered.
--
-- The criterion says "very different", so the threshold is a ratio rather than an inequality. Two
-- to one, because that is roughly where the smaller arm stops being able to move the comparison:
-- below it the arms are comparable, above it the reader should be told which one is carrying the
-- result. The number is in the message so nobody has to guess what "very different" meant.
--
-- The rest of the comparison is untouched. Only the `size_warning` expression changes.
-- ---------------------------------------------------------------------------

do $$
declare
  v_src text;
  v_new text;
  v_old constant text :=
    E'case when m.leads_a <> m.leads_b then ''Campaign sizes differ; use the rates and costs as the comparison, not raw volume.'' else null end';
  v_replacement constant text :=
    E'case when greatest(m.leads_a, m.leads_b) >= 2 * greatest(least(m.leads_a, m.leads_b), 1)\n'
    || E'             then format(''Campaign sizes are very different — %s leads against %s. Compare the rates and costs, not raw volume, and treat the smaller arm as the limit on what this can show.'', m.leads_a, m.leads_b)\n'
    || E'             else null end';
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'tenant_campaign_comparison';

  if v_src is null then
    raise exception 'tenant_campaign_comparison does not exist; apply the LA-2.18 migration first';
  end if;

  if v_src ~ 'sizes are very different' then
    raise notice 'the size warning already uses a threshold';
    return;
  end if;

  v_new := replace(v_src, v_old, v_replacement);
  if v_new = v_src then
    raise exception 'the size_warning expression is not in the expected form; fix by hand';
  end if;

  execute v_new;
  raise notice 'the size warning now fires on a 2:1 ratio rather than on any difference';
end $$;

do $$
declare
  v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'tenant_campaign_comparison';

  if v_src ~ 'm\.leads_a <> m\.leads_b' then
    raise exception 'the size warning still fires on any difference in size';
  end if;
  -- The refusals that make the comparison honest must survive this edit untouched.
  if v_src !~ 'campaign_comparison_periods_must_match'
     or v_src !~ 'campaign_comparison_weekdays_must_align' then
    raise exception 'the matched-period refusals were lost';
  end if;
end $$;


-- ===========================================================================
-- 20260922210000_la_1_inbound_telephony_seam.sql
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- LA-1 · §16, precaution 2 · the inbound telephony seam
--
-- Module 1 decides that telephony is out of scope, and then asks for three cheap precautions so it
-- can be added later without a rewrite:
--
--   1. "Keep an `active_call` record even without a provider." — built. `public.active_calls`,
--      opened at claim, closed at disposition, and it is what the Agent Floor reads to answer
--      "is anyone talking".
--   2. "Leave a `provider_call_id` column on it, nullable. One column now saves a migration later."
--      — NOT built. This migration is that column.
--   3. "Never let call state be inferred from work-item state." — built. The floor derives
--      `on_call` from an open `active_calls` row, never from `lead_queue.status`.
--
-- The OUTBOUND plane took the identical precaution and said so at the time, under a header reading
-- "THE SEAM": `tenant_call_attempts.provider_call_id` is nullable from the start, because
-- "leaving the column out until one arrives would mean migrating a table that by then has history
-- in it." That argument is not weaker on the inbound side — `active_calls` accrues a row per claim,
-- so it fills up faster than the outbound attempts table does.
--
-- Nothing reads this column yet, and that is the point of it. It is a seam, not a feature: when a
-- provider arrives, the row that already exists gets an id instead of a new table getting a
-- backfill. The guard in lib/transferInbox/telephonySeam.test.mjs keeps both planes' seams open so
-- a later tidy-up cannot remove an "unused" column that is unused on purpose.
-- ---------------------------------------------------------------------------

alter table public.active_calls
  add column if not exists provider_call_id text;

-- Partial, because the overwhelming majority of rows will carry no provider id for as long as
-- telephony stays out of scope, and an index over a column that is null everywhere is pure cost.
-- When a provider does arrive, looking a call up by the id it gave us is the first thing anything
-- will need to do.
create index if not exists active_calls_provider_call_idx
  on public.active_calls (tenant_id, provider_call_id)
  where provider_call_id is not null;

comment on column public.active_calls.provider_call_id is
  'Telephony provider''s own call id. Null while Module 1 has no telephony; the seam LA-1 §16 asks for.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'active_calls' and column_name = 'provider_call_id'
  ) then
    raise exception 'active_calls.provider_call_id did not land';
  end if;

  -- Precaution 3, asserted rather than assumed: the column must be nullable. A NOT NULL provider id
  -- on a table written at claim time would make every claim depend on a provider that does not
  -- exist, which is the opposite of a seam.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'active_calls'
       and column_name = 'provider_call_id' and is_nullable = 'NO'
  ) then
    raise exception 'active_calls.provider_call_id must stay nullable while telephony is out of scope';
  end if;
end $$;


-- ===========================================================================
-- 20260922220000_la_2_disposition_routes_to_its_own_pipeline.sql
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- The disposition decides which pipeline the lead lands in.
--
-- Asked for on 2026-09-22: "whatever the disposition outcome is, I want you to put it in the
-- dedicated pipeline which is reserved for specific cases, specific dispositions."
--
-- ── Why this could not happen before ───────────────────────────────────────
--
-- Every piece of the machinery already existed. `stage_dispositions` maps a disposition key to a
-- stage, one-to-one per tenant, editable from Settings → Pipelines, and `complete_disposition`
-- looks the mapping up when a call is dispositioned. What it could not do is leave the pipeline:
--
--   select sd.stage_id into v_stage_id
--     from public.stage_dispositions sd
--     join public.tenant_pipeline_stages ps on ps.id = sd.stage_id
--    where sd.tenant_id = p_tenant_id
--      and sd.disposition_key = p_disposition_key
--      and ps.pipeline_id = v_item.pipeline_id     <—— the lead's CURRENT pipeline
--      and not ps.is_archived
--
-- and the lead's `pipeline_id` was never written by a disposition at all.
--
-- The consequence was worse than a missing feature: mapping a disposition to a stage in a dedicated
-- pipeline **silently did nothing**. The lookup found no row in the current pipeline, fell through
-- to `coalesce(v_stage_id, v_item.stage_id)`, and the lead stayed exactly where it was. The
-- configuration screen accepted the mapping, the audit row recorded it, and the outcome was that
-- nothing moved. A setting that saves and has no effect is the worst of the three possible states.
--
-- ── What changes ───────────────────────────────────────────────────────────
--
--   1. The mapping may point at a stage in ANY pipeline. The same-pipeline filter is dropped.
--   2. When it does, the lead and its work item move to that stage's pipeline as well as its stage.
--
-- `unique (tenant_id, disposition_key)` on `stage_dispositions` already guarantees one destination
-- per disposition, so "the dedicated pipeline reserved for this outcome" is expressible without a
-- new table: point the mapping at the entry stage of that pipeline.
--
-- ── What deliberately does not change ──────────────────────────────────────
--
-- **An unmapped disposition still leaves the lead where it is.** That fallback is what makes this
-- safe to apply to a tenant that has configured nothing: no mapping, no movement, same behaviour as
-- today. Routing is opt-in per disposition.
--
-- **The stage and the pipeline move together, or neither moves.** They are set in one statement from
-- the same resolved stage, so a lead can never end up in pipeline A displaying a stage that belongs
-- to pipeline B — which is the state that makes a board render a lead in no column at all.
--
-- Patched into the deployed function rather than restated, because `complete_disposition` carries
-- the DNC write, the callback subtype, the verification close and the chat card, and none of that is
-- what this change is about.
-- ---------------------------------------------------------------------------

do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_disposition';

  if v_src is null then
    raise exception 'complete_disposition does not exist; apply the LA-1.12 disposition migrations first';
  end if;

  if v_src ~ 'dedicated pipeline' then
    raise notice 'the disposition already routes to its own pipeline';
    return;
  end if;

  -- 1. The mapping is no longer confined to the pipeline the lead is already in.
  v_new := replace(
    v_src,
    E'     and ps.pipeline_id = v_item.pipeline_id\n     and not ps.is_archived',
    E'     -- Any pipeline: the dedicated pipeline reserved for this disposition is the point.\n'
    || E'     and not ps.is_archived'
  );
  if v_new = v_src then
    raise exception 'the stage_dispositions lookup is not in the expected form; fix by hand';
  end if;
  v_src := v_new;

  -- 2. The lead follows the stage into its pipeline. `coalesce(..., pipeline_id)` keeps a lead put
  --    when the disposition is unmapped, which is the fallback above.
  v_new := replace(
    v_src,
    E'  update public.agent_leads\n     set stage_id = v_stage_id,\n         callback_subtype = case',
    E'  update public.agent_leads\n     set stage_id = v_stage_id,\n'
    || E'         pipeline_id = coalesce(\n'
    || E'           (select ps.pipeline_id from public.tenant_pipeline_stages ps where ps.id = v_stage_id),\n'
    || E'           pipeline_id),\n'
    || E'         callback_subtype = case'
  );
  if v_new = v_src then
    raise exception 'the agent_leads update is not in the expected form; fix by hand';
  end if;
  v_src := v_new;

  v_new := replace(
    v_src,
    E'         disposition_by = p_user_id,\n         stage_id = v_stage_id,\n         updated_at = now()',
    E'         disposition_by = p_user_id,\n         stage_id = v_stage_id,\n'
    || E'         pipeline_id = coalesce(\n'
    || E'           (select ps.pipeline_id from public.tenant_pipeline_stages ps where ps.id = v_stage_id),\n'
    || E'           pipeline_id),\n'
    || E'         updated_at = now()'
  );
  if v_new = v_src then
    raise exception 'the lead_queue update is not in the expected form; fix by hand';
  end if;

  execute v_new;
  raise notice 'a disposition now routes the lead to its dedicated pipeline';
end $$;

do $$
declare
  v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_disposition';

  if v_src ~ 'ps\.pipeline_id = v_item\.pipeline_id' then
    raise exception 'the disposition mapping is still confined to the lead''s current pipeline';
  end if;
  -- Both rows must move, or a board shows a lead in a column that is not on it.
  if (select count(*) from regexp_matches(v_src, 'pipeline_id = coalesce\(', 'g')) <> 2 then
    raise exception 'the lead and its work item do not both follow the stage into its pipeline';
  end if;
  -- And the fallback must survive: an unmapped disposition leaves the lead alone.
  if v_src !~ 'coalesce\(v_stage_id, v_item\.stage_id\)' then
    raise exception 'an unmapped disposition no longer leaves the lead where it is';
  end if;
end $$;


-- ===========================================================================
-- 20260923100000_la_2_7_cadence_uniqueness_means_unique.sql
-- ===========================================================================
-- LA-2.7 · the cadence unique key does not do what it says.
--
-- `tenant_cadence_rules` declares:
--
--     unique (tenant_id, campaign_id, attempt_number, disposition_scope)
--
-- which reads as "one rule per attempt per scope". It is not, because Postgres treats NULLs in a
-- unique index as distinct from each other. A tenant-default rule carries NULL in `campaign_id`
-- and a catch-all rule carries NULL in `disposition_scope`, so the most common row in the table —
-- "attempt 1, every campaign, every outcome" — can be inserted any number of times and the
-- constraint is satisfied every time.
--
-- Verified against the live project on 2026-09-23: inserting the identical row twice was accepted.
--
-- The damage is quiet rather than loud. `schedule_next_attempt` resolves the rule with
--
--     order by (r.campaign_id is not null) desc, (r.disposition_scope is not null) desc
--     limit 1
--
-- and duplicates tie on both keys, so the delay for that attempt becomes whichever row the planner
-- happens to return. The cadence is not wrong; it is undecided, and it can decide differently on
-- two identical leads.
--
-- `nulls not distinct` (Postgres 15+) makes the declared key mean what it reads as. The API route
-- at app/api/app/cadence/route.ts refuses duplicates before they are sent, and keeps doing so —
-- it can name the attempt in a message, which a constraint violation cannot — but until this runs
-- it is the only thing standing between the scheduler and an ambiguous cadence, and anything that
-- writes this table without going through it can still produce one.

alter table public.tenant_cadence_rules
  drop constraint if exists tenant_cadence_rules_tenant_id_campaign_id_attempt_number_dis_key;

-- Any duplicates already stored have to go before the stricter key can be created. The newest row
-- for each (tenant, campaign, attempt, disposition) is kept: a duplicate is almost always someone
-- re-adding a rule they could not see, so the later one is the one they meant.
delete from public.tenant_cadence_rules a
 using public.tenant_cadence_rules b
 where a.tenant_id = b.tenant_id
   and a.campaign_id is not distinct from b.campaign_id
   and a.attempt_number = b.attempt_number
   and a.disposition_scope is not distinct from b.disposition_scope
   and (a.created_at, a.id) < (b.created_at, b.id);

alter table public.tenant_cadence_rules
  add constraint tenant_cadence_rules_one_rule_per_attempt
  unique nulls not distinct (tenant_id, campaign_id, attempt_number, disposition_scope);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tenant_cadence_rules'::regclass
       and conname = 'tenant_cadence_rules_one_rule_per_attempt'
  ) then
    raise exception 'the cadence uniqueness constraint was not created';
  end if;
end;
$$;

