-- ============================================================================
-- Pending migrations — 1 files, each in its own transaction
-- Generated 2026-11-06 by scripts/build-pending-bundle.mjs. Do not hand-edit; regenerate.
--
-- HOW TO RUN: Supabase dashboard → SQL editor → paste this whole file → Run.
-- Each file is begin … commit on its own. The SQL editor STOPS at the first error: that file is
-- rolled back, the files before it stay applied, and nothing after it runs. Fix the named file,
-- regenerate, and run the whole script again — re-running is safe: the files use
-- create-or-replace / if-not-exists, and history rows use on-conflict-do-nothing.
--
-- AFTERWARDS: node --env-file=.env.local scripts/verify-applied-migrations.mjs
--
-- Files, in order:
--    1. 20261106120000_expense_buckets.sql
-- ============================================================================

-- ─── [1/1] 20261106120000_expense_buckets.sql ────────────────────────────────────
begin;

-- Expenses tracker (owner, 2026-11-06; extends LA-7.3) · three buckets, OK = paid, a to-do alert.
--
-- The owner's four steps: every expense goes into one of three buckets — buying leads, monthly
-- subscriptions, daily & random — chosen on a short form; a monthly bill comes back each month as a
-- to-do ("The $150 Dialer bill is back. OK it?") and is never paid silently; OK stamps it paid for that
-- month; and an end-of-month scoreboard says where the money went.
--
--   leads                  a new expense category: leads bought without a vendor invoice ("Bought 100
--                          leads from XYZ"). It books as lead_cost, counts as acquisition, and is
--                          advertising for tax — the same as a lead invoice. Invoices stay in Vendor bills.
--   ok_expense             one click: book an unconfirmed bill and stamp it paid, in one transaction.
--   generate_recurring_    as before (one unconfirmed instance per period, never booked by itself), and
--   expenses               each new instance raises one bell alert for the owner and the bookkeepers.
--
-- The buckets themselves are a grouping of categories (lib/accounting/expensesCore.ts); no column.
--
-- Additive. Rollback: restate expense_entry_type and generate_recurring_expenses from 20261015220000;
--   drop function public.ok_expense(uuid, uuid, uuid, date, text, text);
--   alter table public.expense drop constraint expense_category, add constraint expense_category check
--     (category in ('software', 'telephony', 'data_services', 'insurance', 'professional_fees', 'licensing', 'office', 'other'));
--   delete from public.tax_category_map where tenant_id is null and source_type = 'expense_category' and source_value = 'leads';

-- ─── the leads category ────────────────────────────────────────────────────────────────────────
alter table public.expense drop constraint if exists expense_category;
alter table public.expense add constraint expense_category check (category in ('leads', 'software', 'telephony', 'data_services', 'insurance', 'professional_fees', 'licensing', 'office', 'other'));

alter table public.accounting_settings alter column acquisition_defaults set default
  '{"leads": true, "software": true, "telephony": true, "data_services": true, "insurance": false, "professional_fees": false, "licensing": false, "office": false, "other": false}'::jsonb;
-- An agency that saved its own defaults before leads existed gets the shipped one for leads.
update public.accounting_settings set acquisition_defaults = acquisition_defaults || '{"leads": true}'::jsonb
 where not (acquisition_defaults ? 'leads');

insert into public.tax_category_map (tenant_id, source_type, source_value, tax_category, is_default)
values (null, 'expense_category', 'leads', 'advertising', true)
on conflict do nothing;

create or replace function public.expense_entry_type(p_category text)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case p_category
           when 'leads' then 'lead_cost'
           when 'insurance' then 'insurance'
           when 'professional_fees' then 'professional_fee'
           when 'licensing' then 'professional_fee'
           else 'tool_subscription'
         end
$$;

-- ─── OK: booked and paid in one step ───────────────────────────────────────────────────────────
create or replace function public.ok_expense(p_tenant_id uuid, p_expense_id uuid, p_by uuid, p_paid_on date default current_date, p_method text default null, p_reference text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_entry uuid;
begin
  if p_paid_on is null then
    raise exception 'ok_expense: a payment date is required' using errcode = '22023';
  end if;
  v_entry := public.confirm_expense(p_tenant_id, p_expense_id, p_by);
  perform public.mark_expense_paid(p_tenant_id, p_expense_id, p_paid_on, p_method, p_reference);
  return v_entry;
end;
$$;

-- ─── the monthly loop, with its to-do alert ────────────────────────────────────────────────────
-- As 20261015220000: the template's own incurred_on is the first period, an instance copies the
-- template as it is when the instance is made, and nothing is booked until someone OKs it. New here:
-- each new instance tells the owner and the bookkeepers, once (source_key), in the bell.
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
  v_id uuid;
begin
  for t in select * from public.expense
            where status = 'template' and (p_tenant_id is null or tenant_id = p_tenant_id)
              and exists (select 1 from public.tenants x where x.id = expense.tenant_id) loop
    v_on := t.incurred_on;
    v_guard := 0;
    while v_on <= p_through and (t.recurrence_end_on is null or v_on <= t.recurrence_end_on) and v_guard < 240 loop
      v_id := null;
      insert into public.expense (tenant_id, agency_id, category, vendor_name, description, amount_cents, incurred_on, recurrence, parent_expense_id,
                                  status, is_acquisition_cost, acquisition_overridden, tax_category, created_by)
      values (t.tenant_id, t.agency_id, t.category, t.vendor_name, t.description, t.amount_cents, v_on, 'one_off', t.id,
              'unconfirmed', t.is_acquisition_cost, t.acquisition_overridden, t.tax_category, null)
      on conflict (parent_expense_id, incurred_on) where parent_expense_id is not null do nothing
      returning id into v_id;
      if v_id is not null then
        v_n := v_n + 1;
        -- Only the periods still waiting: a backfilled month that is long past raises no alert.
        if v_on >= (date_trunc('month', p_through) - interval '1 month')::date then
          insert into public.agent_notifications (tenant_id, recipient_user_id, kind, title, body, link, source_key)
          select t.tenant_id, tu.user_id, 'recurring_expense_due',
                 left('The ' || to_char(t.amount_cents / 100.0, 'FM$999,999,990.00') || ' ' || t.vendor_name || ' bill is back', 160),
                 left('OK it to book it and mark it paid for ' || to_char(v_on, 'FMMonth YYYY') || '. Nothing is paid until you do.', 1000),
                 '/app/expenses?view=confirm',
                 'recurring-expense:' || v_id
            from public.tenant_users tu
            join public.users u on u.id = tu.user_id and u.status = 'active'
           where tu.tenant_id = t.tenant_id and tu.role::text in ('owner', 'bookkeeper') and tu.accepted_at is not null
          on conflict (tenant_id, recipient_user_id, source_key) do nothing;
        end if;
      end if;
      v_on := public.expense_next_period(v_on, t.recurrence);
      v_guard := v_guard + 1;
    end loop;
  end loop;
  return v_n;
end;
$$;

revoke all on function public.ok_expense(uuid, uuid, uuid, date, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.ok_expense(uuid, uuid, uuid, date, text, text) to service_role;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261106120000', 'expense_buckets') on conflict do nothing;
  end if;
end $bundle$;
commit;
