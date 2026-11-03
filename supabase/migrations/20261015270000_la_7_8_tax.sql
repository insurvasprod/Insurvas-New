-- LA-7.8 (Notion sprint, Module 7 — Accounting) · 1099s and tax-ready exports.
--
-- We produce FIGURES from records we hold. We do not file anything, do not generate the official
-- form, do not say what is deductible, and do not categorise an ambiguous expense without the agent
-- choosing. The screen and the export say so, and the notice cannot be dismissed or edited.
--
--   payee_tax_profile       legal name (often not the trading name), tax ID encrypted at rest
--                           (the application's per-agency key, bound to this row) and masked —
--                           a sole proprietor's tax ID IS their SSN, so every tax ID gets SSN handling.
--   payee_tax_reveal_log    one row per reveal; append-only.
--   contractor_payments     per payee, per calendar year, on PAID_ON — the one place in LA-7 where
--                           cash is correct: a 1099 follows when money actually moved.
--   tax_category_map        every cost, expense and commission type → a bucket. Shipped defaults
--                           (tenant null) and the agency's overrides; the bucket is shown per line.
--
-- Additive. Rollback: drop function public.tax_category_totals(uuid, date, date, text), public.contractor_payments(uuid, integer);
--   drop table public.tax_category_map, public.payee_tax_reveal_log, public.payee_tax_profile;
--   alter table public.accounting_settings drop column tax_1099_threshold_cents, drop column tax_id_viewer_roles;

-- $2,000: the 1099-NEC / 1099-MISC threshold for payments from 1 January 2026 (raised from $600;
-- indexed for inflation from 2027). Editable — it moves; check the year's IRS instructions.
alter table public.accounting_settings
  add column if not exists tax_1099_threshold_cents bigint not null default 200000,
  add column if not exists tax_id_viewer_roles text[] not null default array['owner']::text[];
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'accounting_settings_tax' and conrelid = 'public.accounting_settings'::regclass) then
    alter table public.accounting_settings add constraint accounting_settings_tax check (
      tax_1099_threshold_cents between 0 and 100000000 and tax_id_viewer_roles <@ array['owner', 'bookkeeper']::text[] and 'owner' = any(tax_id_viewer_roles));
  end if;
end;
$$;

create table if not exists public.payee_tax_profile (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  payee_type text not null,
  payee_id uuid not null,
  legal_name text,
  tax_id_ciphertext text,
  tax_id_key_version integer,
  tax_id_last4 text,
  tax_id_type text not null default 'none',
  entity_type text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text not null default 'US',
  w9_on_file boolean not null default false,
  w9_document_path text,
  exempt_reason text,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint payee_tax_profile_type check (payee_type in ('partner', 'producer', 'vendor')),
  constraint payee_tax_profile_id_type check (tax_id_type in ('ein', 'ssn', 'foreign', 'none')),
  constraint payee_tax_profile_entity check (entity_type is null or entity_type in ('individual', 'sole_prop', 'llc', 'corp', 'foreign')),
  constraint payee_tax_profile_exempt check (exempt_reason is null or exempt_reason in ('corporation', 'foreign', 'employee')),
  constraint payee_tax_profile_last4 check (tax_id_last4 is null or tax_id_last4 ~ '^[0-9A-Za-z]{4}$'),
  constraint payee_tax_profile_cipher check ((tax_id_ciphertext is null) = (tax_id_last4 is null) and (tax_id_ciphertext is null) = (tax_id_key_version is null)),
  constraint payee_tax_profile_name check (legal_name is null or char_length(btrim(legal_name)) between 1 and 200)
);
create unique index if not exists payee_tax_profile_one on public.payee_tax_profile (tenant_id, payee_type, payee_id);

create table if not exists public.payee_tax_reveal_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  profile_id uuid not null references public.payee_tax_profile(id) on delete cascade,
  user_id uuid not null,
  revealed_at timestamptz not null default now(),
  ip text
);
create index if not exists payee_tax_reveal_log_profile_idx on public.payee_tax_reveal_log (profile_id, revealed_at desc);

create table if not exists public.tax_category_map (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  source_type text not null,
  source_value text not null,
  tax_category text not null,
  is_default boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint tax_category_map_source check (source_type in ('cost_entry_type', 'expense_category', 'commission_entry_type')),
  constraint tax_category_map_category check (tax_category in ('gross_receipts', 'returns_allowances', 'advertising', 'contract_labor', 'commissions_paid', 'software', 'insurance', 'professional_fees', 'licenses', 'office', 'bank_charges', 'other')),
  constraint tax_category_map_default check (is_default = (tenant_id is null))
);
create unique index if not exists tax_category_map_one on public.tax_category_map (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), source_type, source_value);

-- The shipped defaults: a suggestion, not a determination. Every one is overridable per agency.
insert into public.tax_category_map (tenant_id, source_type, source_value, tax_category, is_default) values
  (null, 'commission_entry_type', 'advance', 'gross_receipts', true),
  (null, 'commission_entry_type', 'earned', 'gross_receipts', true),
  (null, 'commission_entry_type', 'override', 'gross_receipts', true),
  (null, 'commission_entry_type', 'held', 'gross_receipts', true),
  (null, 'commission_entry_type', 'chargeback', 'returns_allowances', true),
  (null, 'commission_entry_type', 'reversal', 'returns_allowances', true),
  (null, 'commission_entry_type', 'fee', 'bank_charges', true),
  (null, 'commission_entry_type', 'advance_interest', 'bank_charges', true),
  (null, 'cost_entry_type', 'lead_cost', 'advertising', true),
  (null, 'cost_entry_type', 'partner_payout', 'contract_labor', true),
  (null, 'cost_entry_type', 'producer_split', 'commissions_paid', true),
  (null, 'cost_entry_type', 'platform_fee', 'software', true),
  (null, 'cost_entry_type', 'tool_subscription', 'software', true),
  (null, 'cost_entry_type', 'insurance', 'insurance', true),
  (null, 'cost_entry_type', 'professional_fee', 'professional_fees', true),
  (null, 'cost_entry_type', 'refund', 'advertising', true),
  (null, 'cost_entry_type', 'adjustment', 'other', true),
  (null, 'expense_category', 'software', 'software', true),
  (null, 'expense_category', 'telephony', 'software', true),
  (null, 'expense_category', 'data_services', 'advertising', true),
  (null, 'expense_category', 'insurance', 'insurance', true),
  (null, 'expense_category', 'professional_fees', 'professional_fees', true),
  (null, 'expense_category', 'licensing', 'licenses', true),
  (null, 'expense_category', 'office', 'office', true),
  (null, 'expense_category', 'other', 'other', true)
on conflict do nothing;

-- ─── what was paid to each payee in a calendar year — on paid_on ───────────────────────────────
create or replace function public.contractor_payments(p_tenant_id uuid, p_year integer)
returns table (payee_type text, payee_id uuid, paid_cents bigint, entries bigint)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select x.payee_type, x.payee_id, (-sum(x.amount_cents))::bigint, count(*)::bigint
    from (
      select case when c.partner_id is not null then 'partner' when c.producer_user_id is not null then 'producer' else 'vendor' end as payee_type,
             coalesce(c.partner_id, c.producer_user_id, c.vendor_id) as payee_id, c.amount_cents
        from public.cost_entry c
       where c.tenant_id = p_tenant_id and c.paid_on >= make_date(p_year, 1, 1) and c.paid_on < make_date(p_year + 1, 1, 1)
         and coalesce(c.partner_id, c.producer_user_id, c.vendor_id) is not null
         and c.entry_type in ('lead_cost', 'partner_payout', 'producer_split', 'refund', 'adjustment')
    ) x
   group by x.payee_type, x.payee_id
$$;

-- The year by bucket: every money row mapped through the agency's override, else the default.
-- Expense rows map by their category; other cost rows by type; commission rows by type.
create or replace function public.tax_category_totals(p_tenant_id uuid, p_from date, p_to date, p_basis text default 'accrual')
returns table (tax_category text, source_type text, source_value text, amount_cents bigint, entries bigint)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_comm text;
  v_cost text;
begin
  if p_basis not in ('accrual', 'cash') then
    raise exception 'tax_category_totals: basis is accrual or cash' using errcode = '22023';
  end if;
  v_comm := case when p_basis = 'cash' then 'e.statement_date' else 'coalesce(e.transaction_date, e.statement_date)' end;
  v_cost := case when p_basis = 'cash' then 'c.paid_on' else 'c.incurred_on' end;
  return query execute format($q$
    with rows as (
      select 'commission_entry_type'::text as st, e.entry_type as sv, e.amount_cents from public.commission_entry e where e.tenant_id = $1 and %1$s >= $2 and %1$s < $3
      union all
      select 'commission_entry_type', e.entry_type, e.amount_cents from public.commission_account_entry e where e.tenant_id = $1 and %1$s >= $2 and %1$s < $3
      union all
      select case when x.id is not null then 'expense_category' else 'cost_entry_type' end, coalesce(x.category, c.entry_type), c.amount_cents
        from public.cost_entry c left join public.expense x on x.id = c.expense_id
       where c.tenant_id = $1 and %2$s >= $2 and %2$s < $3
    )
    select coalesce(t.tax_category, d.tax_category, 'other'), r.st, r.sv, sum(r.amount_cents)::bigint, count(*)::bigint
      from rows r
      left join public.tax_category_map t on t.tenant_id = $1 and t.source_type = r.st and t.source_value = r.sv
      left join public.tax_category_map d on d.tenant_id is null and d.source_type = r.st and d.source_value = r.sv
     group by 1, 2, 3
  $q$, v_comm, v_cost) using p_tenant_id, p_from, p_to;
end;
$$;

-- ─── access ────────────────────────────────────────────────────────────────────────────────────
alter table public.payee_tax_profile enable row level security;
alter table public.payee_tax_reveal_log enable row level security;
alter table public.tax_category_map enable row level security;
drop policy if exists payee_tax_profile_read on public.payee_tax_profile;
create policy payee_tax_profile_read on public.payee_tax_profile for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists payee_tax_reveal_log_read on public.payee_tax_reveal_log;
create policy payee_tax_reveal_log_read on public.payee_tax_reveal_log for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists tax_category_map_read on public.tax_category_map;
create policy tax_category_map_read on public.tax_category_map for select to tenant_app using (tenant_id is null or tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.payee_tax_profile, public.payee_tax_reveal_log, public.tax_category_map from public, anon, authenticated;
revoke insert, update, delete, truncate on public.payee_tax_profile, public.payee_tax_reveal_log, public.tax_category_map from tenant_app;
-- The ciphertext is the server's alone: tenant_app reads the profile without it.
revoke select on public.payee_tax_profile from tenant_app;
grant select (id, tenant_id, payee_type, payee_id, legal_name, tax_id_last4, tax_id_type, entity_type, address_line1, address_line2, city, state, postal_code, country, w9_on_file, w9_document_path, exempt_reason, updated_by, updated_at) on public.payee_tax_profile to tenant_app;
grant select on public.payee_tax_reveal_log, public.tax_category_map to tenant_app;
revoke delete, truncate on public.payee_tax_profile, public.payee_tax_reveal_log from service_role;
revoke update on public.payee_tax_reveal_log from service_role;
grant select, insert, update on public.payee_tax_profile to service_role;
grant select, insert on public.payee_tax_reveal_log to service_role;
grant select, insert, update, delete on public.tax_category_map to service_role;
revoke truncate on public.tax_category_map from service_role;

revoke all on function public.contractor_payments(uuid, integer) from public, anon, authenticated, tenant_app;
revoke all on function public.tax_category_totals(uuid, date, date, text) from public, anon, authenticated, tenant_app;
grant execute on function public.contractor_payments(uuid, integer) to service_role;
grant execute on function public.tax_category_totals(uuid, date, date, text) to service_role;
