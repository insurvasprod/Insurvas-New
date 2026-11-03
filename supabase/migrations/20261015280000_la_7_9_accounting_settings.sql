-- LA-7.9 (Notion sprint, Module 7 — Accounting) · accounting settings.
--
-- Every LA-7 setting is already a column of accounting_settings (added by the task that reads it,
-- 7.2–7.8). This adds the trail: every change, who, what, from, to, when — because "why did cost per
-- policy drop in April" is a question that gets asked, and the answer is sometimes that someone moved
-- a category from acquisition to overhead.
--
-- Changing a setting never rewrites recorded figures: payout runs keep their frozen terms, expenses
-- keep the acquisition flag they were booked with, published statements stay as published.
--
-- Additive. Rollback: drop table public.accounting_setting_change;

create table if not exists public.accounting_setting_change (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  field text not null,
  old_value jsonb,
  new_value jsonb,
  changed_by uuid not null,
  changed_at timestamptz not null default now(),
  constraint accounting_setting_change_field check (char_length(field) between 1 and 80)
);
create index if not exists accounting_setting_change_tenant_idx on public.accounting_setting_change (tenant_id, changed_at desc);

alter table public.accounting_setting_change enable row level security;
drop policy if exists accounting_setting_change_read on public.accounting_setting_change;
create policy accounting_setting_change_read on public.accounting_setting_change for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.accounting_setting_change from public, anon, authenticated;
-- Append-only.
revoke insert, update, delete, truncate on public.accounting_setting_change from tenant_app;
revoke update, delete, truncate on public.accounting_setting_change from service_role;
grant select on public.accounting_setting_change to tenant_app;
grant select, insert on public.accounting_setting_change to service_role;
