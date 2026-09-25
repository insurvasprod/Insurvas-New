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
