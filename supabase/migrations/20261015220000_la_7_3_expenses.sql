-- LA-7.3 (Notion sprint, Module 7 — Accounting) · platform and tool expenses.
--
-- Everything the agent spends that is not a lead: the dialer, the CRM, our own subscription,
-- skip-trace credits, the E&O premium, the accountant. Small — about 4% of acquisition cost — and
-- worth capturing because without it cost per policy is quietly too low.
--
--   is_acquisition_cost decides whether an expense divides into cost per policy or only reduces net
--   profit. It defaults by category (accounting_settings.acquisition_defaults, editable in LA-7.9)
--   and can be overridden per expense — visibly (acquisition_overridden).
--
--   Recurring: a template generates one instance per period, UNCONFIRMED. An unconfirmed instance
--   writes no cost entry: a subscription cancelled in March must not keep booking cost through
--   December because nobody told the system. Confirming books it (LA-7.1 cost_entry, negative).
--   Changing a template's amount reaches future instances only; past ones are rows of their own.
--
--   No campaign or policy attribution, deliberately: a dialer subscription belongs to the business.
--
-- Additive. Rollback: select cron.unschedule('la7-recurring-expenses'); drop function public.generate_recurring_expenses(uuid, date),
--   public.confirm_expense(uuid, uuid, uuid), public.void_expense(uuid, uuid, text, uuid), public.mark_expense_paid(uuid, uuid, date, text, text),
--   public.expense_entry_type(text), public.expense_next_period(date, text); alter table public.cost_entry drop constraint cost_entry_expense_fk;
--   drop table public.expense; alter table public.accounting_settings drop column acquisition_defaults;

alter table public.accounting_settings
  add column if not exists acquisition_defaults jsonb not null default
    '{"software": true, "telephony": true, "data_services": true, "insurance": false, "professional_fees": false, "licensing": false, "office": false, "other": false}'::jsonb;

create table if not exists public.expense (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agency_id uuid,
  category text not null,
  vendor_name text not null,
  description text,
  amount_cents bigint not null,
  incurred_on date not null,
  paid_on date,
  paid_method text,
  payment_reference text,
  recurrence text not null default 'one_off',
  recurrence_end_on date,
  parent_expense_id uuid references public.expense(id) on delete restrict,
  status text not null,
  is_acquisition_cost boolean not null,
  acquisition_overridden boolean not null default false,
  tax_category text,
  document_path text,
  document_name text,
  created_by uuid,
  created_at timestamptz not null default now(),
  confirmed_by uuid,
  confirmed_at timestamptz,
  voided_by uuid,
  voided_at timestamptz,
  void_reason text,
  updated_at timestamptz not null default now(),
  constraint expense_category check (category in ('software', 'telephony', 'data_services', 'insurance', 'professional_fees', 'licensing', 'office', 'other')),
  constraint expense_recurrence check (recurrence in ('one_off', 'monthly', 'quarterly', 'annual')),
  constraint expense_status check (status in ('template', 'unconfirmed', 'confirmed', 'void')),
  -- A template recurs and is never booked; an instance points at its template and does not recur itself.
  constraint expense_shape check (
    (status = 'template' and recurrence <> 'one_off' and parent_expense_id is null)
    or (status <> 'template' and recurrence = 'one_off')
  ),
  constraint expense_amount check (amount_cents > 0),
  constraint expense_vendor check (char_length(btrim(vendor_name)) between 1 and 120),
  constraint expense_description check (description is null or char_length(description) <= 500),
  constraint expense_method check (paid_method is null or paid_method in ('ach', 'card', 'cheque', 'wire', 'other')),
  constraint expense_paid check (paid_on is null or status in ('confirmed', 'void')),
  constraint expense_void check ((status = 'void') = (voided_at is not null) and ((status = 'void') = (void_reason is not null))),
  constraint expense_end check (recurrence_end_on is null or recurrence_end_on >= incurred_on)
);
create unique index if not exists expense_one_per_period on public.expense (parent_expense_id, incurred_on) where parent_expense_id is not null;
create index if not exists expense_tenant_idx on public.expense (tenant_id, incurred_on desc);
create index if not exists expense_status_idx on public.expense (tenant_id, status);
create index if not exists expense_templates_idx on public.expense (tenant_id) where status = 'template';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cost_entry_expense_fk' and conrelid = 'public.cost_entry'::regclass) then
    alter table public.cost_entry add constraint cost_entry_expense_fk foreign key (expense_id) references public.expense(id) on delete restrict;
  end if;
end;
$$;

-- ─── the ledger type a category books as ───────────────────────────────────────────────────────
create or replace function public.expense_entry_type(p_category text)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case p_category
           when 'insurance' then 'insurance'
           when 'professional_fees' then 'professional_fee'
           when 'licensing' then 'professional_fee'
           else 'tool_subscription'
         end
$$;

create or replace function public.expense_next_period(p_from date, p_recurrence text)
returns date
language sql
immutable
set search_path = public, pg_catalog
as $$
  select (p_from + case p_recurrence when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months' when 'annual' then interval '1 year' end)::date
$$;

-- ─── what may change ───────────────────────────────────────────────────────────────────────────
create or replace function public.expense_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_writer boolean := coalesce(current_setting('app.expense_writer', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    raise exception 'An expense is never removed: void it, or end a recurring one.' using errcode = 'P0001';
  end if;
  if new.tenant_id is distinct from old.tenant_id or new.parent_expense_id is distinct from old.parent_expense_id then
    raise exception 'An expense stays with its agency and its template.' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'unconfirmed' and new.status = 'void')
         or (v_writer and (old.status, new.status) in (('unconfirmed', 'confirmed'), ('confirmed', 'void')))) then
      raise exception 'An expense cannot go from % to %.', old.status, new.status using errcode = 'P0001';
    end if;
  end if;
  -- Booked or voided: the money, the date and what it was are history. Its classification
  -- (acquisition or overhead, tax bucket) and its receipt may still be set.
  if old.status in ('confirmed', 'void') and (
       new.category is distinct from old.category or new.vendor_name is distinct from old.vendor_name
    or new.description is distinct from old.description or new.amount_cents is distinct from old.amount_cents
    or new.incurred_on is distinct from old.incurred_on or new.recurrence is distinct from old.recurrence
    or new.confirmed_at is distinct from old.confirmed_at or new.confirmed_by is distinct from old.confirmed_by) then
    raise exception 'A confirmed expense is history: void it and enter it again.' using errcode = 'P0001';
  end if;
  if old.status = 'void' and new.status = 'void' and (new.voided_at is distinct from old.voided_at or new.void_reason is distinct from old.void_reason) then
    raise exception 'A voided expense stays as it was voided.' using errcode = 'P0001';
  end if;
  if (new.paid_on is distinct from old.paid_on or new.paid_method is distinct from old.paid_method or new.payment_reference is distinct from old.payment_reference)
     and not v_writer then
    raise exception 'Payment is recorded by marking the expense paid.' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists expense_guard on public.expense;
create trigger expense_guard before update or delete on public.expense
  for each row execute function public.expense_guard();

-- ─── confirm: the cost is booked ───────────────────────────────────────────────────────────────
create or replace function public.confirm_expense(p_tenant_id uuid, p_expense_id uuid, p_by uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  x public.expense;
  v_entry uuid;
begin
  select * into x from public.expense where id = p_expense_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'confirm_expense: expense % is not in this agency', p_expense_id using errcode = 'P0002';
  end if;
  if x.status <> 'unconfirmed' then
    raise exception 'confirm_expense: a % expense cannot be confirmed', x.status using errcode = '22023';
  end if;
  v_entry := public.record_cost_entry(p_tenant_id, jsonb_build_object(
    'agency_id', x.agency_id, 'entry_type', public.expense_entry_type(x.category), 'amount_cents', -x.amount_cents,
    'incurred_on', x.incurred_on, 'paid_on', x.paid_on, 'counterparty_type', 'other', 'counterparty_name', x.vendor_name,
    'expense_id', x.id, 'tax_category', x.tax_category,
    'description', left(x.vendor_name || coalesce(' — ' || nullif(btrim(x.description), ''), ''), 500)), p_by);
  perform set_config('app.expense_writer', 'on', true);
  update public.expense set status = 'confirmed', confirmed_by = p_by, confirmed_at = now() where id = x.id;
  perform set_config('app.expense_writer', '', true);
  return v_entry;
end;
$$;

create or replace function public.void_expense(p_tenant_id uuid, p_expense_id uuid, p_reason text, p_by uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  x public.expense;
  e record;
  v_n integer := 0;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'void_expense: say why' using errcode = '22023';
  end if;
  select * into x from public.expense where id = p_expense_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'void_expense: expense % is not in this agency', p_expense_id using errcode = 'P0002';
  end if;
  if x.status not in ('unconfirmed', 'confirmed') then
    raise exception 'void_expense: a % expense cannot be voided (end a recurring one instead)', x.status using errcode = '22023';
  end if;
  for e in select c.id from public.cost_entry c where c.tenant_id = p_tenant_id and c.expense_id = x.id and c.reverses_entry_id is null
              and not exists (select 1 from public.cost_entry r where r.reverses_entry_id = c.id) loop
    perform public.reverse_cost_entry(p_tenant_id, e.id, 'Expense voided: ' || btrim(p_reason), p_by);
    v_n := v_n + 1;
  end loop;
  perform set_config('app.expense_writer', 'on', true);
  update public.expense set status = 'void', voided_by = p_by, voided_at = now(), void_reason = left(btrim(p_reason), 500) where id = x.id;
  perform set_config('app.expense_writer', '', true);
  return v_n;
end;
$$;

create or replace function public.mark_expense_paid(p_tenant_id uuid, p_expense_id uuid, p_paid_on date, p_method text, p_reference text)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  x public.expense;
  v_ids uuid[];
  v_n integer := 0;
begin
  select * into x from public.expense where id = p_expense_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'mark_expense_paid: expense % is not in this agency', p_expense_id using errcode = 'P0002';
  end if;
  if x.status <> 'confirmed' or x.paid_on is not null then
    raise exception 'mark_expense_paid: only a confirmed, unpaid expense is marked paid' using errcode = '22023';
  end if;
  if p_paid_on is null then
    raise exception 'mark_expense_paid: a payment date is required' using errcode = '22023';
  end if;
  select coalesce(array_agg(c.id), '{}') into v_ids from public.cost_entry c where c.tenant_id = p_tenant_id and c.expense_id = x.id and c.reverses_entry_id is null;
  v_n := public.mark_cost_entries_paid(p_tenant_id, v_ids, p_paid_on);
  perform set_config('app.expense_writer', 'on', true);
  update public.expense set paid_on = p_paid_on, paid_method = nullif(btrim(p_method), ''), payment_reference = nullif(btrim(p_reference), '') where id = x.id;
  perform set_config('app.expense_writer', '', true);
  return v_n;
end;
$$;

-- ─── recurring: one unconfirmed instance per period, up to a date ──────────────────────────────
-- The template's own incurred_on is the first period. An instance copies the template as it is
-- when the instance is made — so changing the template's amount changes the months still to come.
create or replace function public.generate_recurring_expenses(p_tenant_id uuid, p_through date default current_date)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  t public.expense;
  v_on date;
  v_n integer := 0;
  v_guard integer;
begin
  for t in select * from public.expense
            where status = 'template' and (p_tenant_id is null or tenant_id = p_tenant_id)
              and exists (select 1 from public.tenants x where x.id = expense.tenant_id) loop
    v_on := t.incurred_on;
    v_guard := 0;
    while v_on <= p_through and (t.recurrence_end_on is null or v_on <= t.recurrence_end_on) and v_guard < 240 loop
      insert into public.expense (tenant_id, agency_id, category, vendor_name, description, amount_cents, incurred_on, recurrence, parent_expense_id,
                                  status, is_acquisition_cost, acquisition_overridden, tax_category, created_by)
      values (t.tenant_id, t.agency_id, t.category, t.vendor_name, t.description, t.amount_cents, v_on, 'one_off', t.id,
              'unconfirmed', t.is_acquisition_cost, t.acquisition_overridden, t.tax_category, null)
      on conflict (parent_expense_id, incurred_on) where parent_expense_id is not null do nothing;
      if found then
        v_n := v_n + 1;
      end if;
      v_on := public.expense_next_period(v_on, t.recurrence);
      v_guard := v_guard + 1;
    end loop;
  end loop;
  return v_n;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('la7-recurring-expenses', '0 5 * * *', $job$select public.generate_recurring_expenses(null, current_date)$job$);
  end if;
end;
$$;

-- ─── access ────────────────────────────────────────────────────────────────────────────────────
alter table public.expense enable row level security;
drop policy if exists expense_read on public.expense;
create policy expense_read on public.expense for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.expense from public, anon, authenticated;
revoke insert, update, delete, truncate on public.expense from tenant_app;
grant select on public.expense to tenant_app;
revoke delete, truncate on public.expense from service_role;
grant select, insert, update on public.expense to service_role;

revoke all on function public.expense_guard() from public, anon, authenticated;
revoke all on function public.expense_entry_type(text) from public, anon, authenticated;
revoke all on function public.expense_next_period(date, text) from public, anon, authenticated;
revoke all on function public.confirm_expense(uuid, uuid, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.void_expense(uuid, uuid, text, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.mark_expense_paid(uuid, uuid, date, text, text) from public, anon, authenticated, tenant_app;
revoke all on function public.generate_recurring_expenses(uuid, date) from public, anon, authenticated, tenant_app;
grant execute on function public.expense_entry_type(text) to service_role, tenant_app;
grant execute on function public.expense_next_period(date, text) to service_role, tenant_app;
grant execute on function public.confirm_expense(uuid, uuid, uuid) to service_role;
grant execute on function public.void_expense(uuid, uuid, text, uuid) to service_role;
grant execute on function public.mark_expense_paid(uuid, uuid, date, text, text) to service_role;
grant execute on function public.generate_recurring_expenses(uuid, date) to service_role;
