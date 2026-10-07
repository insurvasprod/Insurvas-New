-- LA-4.18 (Notion sprint) · scorecards, persistency and the daily summary.
--
-- Everything on these screens is computed live from LA-4.7's policy_current and LA-4.12's ledger, per
-- request (the LA-2.17 decision: no nightly snapshot), so a figure always reconciles with its rows.
-- What is stored here is small:
--
--   book_insight_settings      per agency: the sample size below which a share is shown as a count
--                              ("3 of 5"), never a percentage. Absent row = the spec's default, 10.
--   commission_week_totals     the ledger summed by week and entry type, one agency (optionally one
--                              agent), statements that don't add up held out as in
--                              commission_policy_totals (LA-4.14). One grouped read, not every entry.
--   commission_week_entries    the entries behind one week's figures: the drill-through.
--
-- Two indexes for the lead-source chain (campaign/vendor → policy_current).
--
-- Additive. Requires 20261008160000 (policy_current), 20261008220000 (commission_entry) and
-- 20261008240000 (carrier_account_checks).
--
-- Rollback:
--   drop function if exists public.commission_week_entries(uuid, date, uuid);
--   drop function if exists public.commission_week_totals(uuid, date, date, uuid);
--   drop table if exists public.book_insight_settings;

create table if not exists public.book_insight_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  min_sample integer not null default 10,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint book_insight_settings_sample check (min_sample between 2 and 100)
);
create index if not exists book_insight_settings_updated_by_idx on public.book_insight_settings (updated_by) where updated_by is not null;

create index if not exists policy_current_vendor_idx on public.policy_current (tenant_id, vendor_id) where vendor_id is not null;
create index if not exists policy_current_campaign_idx on public.policy_current (tenant_id, campaign_id) where campaign_id is not null;

-- The day an entry counts on: the statement's date, else the transaction's, else when it was read.
create or replace function public.commission_week_totals(p_tenant_id uuid, p_from date, p_to date, p_agent_user_id uuid default null)
returns table (week_start date, entry_type text, amount_cents bigint, entries bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select date_trunc('week', coalesce(e.statement_date, e.transaction_date, e.created_at::date))::date as week_start,
         case when e.entry_type = 'reversal' then coalesce(e.corrects_type, 'other') else e.entry_type end as entry_type,
         sum(e.amount_cents)::bigint as amount_cents,
         count(*) as entries
    from public.commission_entry e
   where e.tenant_id = p_tenant_id
     and (p_agent_user_id is null or e.agent_user_id = p_agent_user_id)
     and coalesce(e.statement_date, e.transaction_date, e.created_at::date) between p_from and p_to
     and not exists (select 1 from public.carrier_account_checks c where c.tenant_id = e.tenant_id and c.file_id = e.file_id and c.flagged)
   group by 1, 2
   order by 1, 2;
$$;

create or replace function public.commission_week_entries(p_tenant_id uuid, p_week_start date, p_agent_user_id uuid default null)
returns table (id uuid, carrier_id uuid, policy_number text, entry_type text, corrects_type text, counted_on date, amount_cents bigint, file_id uuid, row_number integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id, e.carrier_id, e.policy_number, e.entry_type, e.corrects_type,
         coalesce(e.statement_date, e.transaction_date, e.created_at::date) as counted_on,
         e.amount_cents, e.file_id, e.row_number
    from public.commission_entry e
   where e.tenant_id = p_tenant_id
     and (p_agent_user_id is null or e.agent_user_id = p_agent_user_id)
     and date_trunc('week', coalesce(e.statement_date, e.transaction_date, e.created_at::date))::date = p_week_start
     and not exists (select 1 from public.carrier_account_checks c where c.tenant_id = e.tenant_id and c.file_id = e.file_id and c.flagged)
   order by counted_on, e.carrier_id, e.policy_number, e.id;
$$;

-- ─── access ─────────────────────────────────────────────────────────────────────────────────────
alter table public.book_insight_settings enable row level security;
drop policy if exists book_insight_settings_read on public.book_insight_settings;
create policy book_insight_settings_read on public.book_insight_settings for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.book_insight_settings from public, anon, authenticated;
revoke delete, truncate on public.book_insight_settings from service_role, tenant_app;
grant select, insert, update on public.book_insight_settings to service_role;
grant select on public.book_insight_settings to tenant_app;

revoke all on function public.commission_week_totals(uuid, date, date, uuid) from public, anon, authenticated;
revoke all on function public.commission_week_entries(uuid, date, uuid) from public, anon, authenticated;
grant execute on function public.commission_week_totals(uuid, date, date, uuid) to service_role;
grant execute on function public.commission_week_entries(uuid, date, uuid) to service_role;

do $$
declare
  v_rows integer;
begin
  select count(*) into v_rows from public.commission_week_totals(gen_random_uuid(), current_date - 84, current_date);
  if v_rows <> 0 then
    raise exception '20261008270000: an unknown agency returned % week rows', v_rows;
  end if;
  perform 1 from public.commission_week_entries(gen_random_uuid(), date_trunc('week', current_date)::date);
  if has_function_privilege('anon', 'public.commission_week_totals(uuid, date, date, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.commission_week_entries(uuid, date, uuid)', 'EXECUTE') then
    raise exception '20261008270000: the ledger functions must run as the service only';
  end if;
  if has_table_privilege('service_role', 'public.book_insight_settings', 'DELETE') then
    raise exception '20261008270000: a setting is changed, never deleted';
  end if;
end $$;
