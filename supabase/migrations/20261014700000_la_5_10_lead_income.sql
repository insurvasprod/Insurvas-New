-- LA-5.10 (Notion sprint, Module 5 — Retention) · income given before the sale's client exists.
--
-- A lead becomes a client (agent_leads.contact_id) only when a carrier file proves the sale — policy
-- matching's clientForLead — so during the interview and the draft-date setup almost no lead has one.
-- Owner decision 2026-10-14: hold the figure on the lead until then, then move it to the client, so
-- Contacts never fills with people who did not buy.
--
--   lead_income                  one figure per lead, the same shape and rules as contact_income;
--                                deleted with the lead.
--   lead_income_to_contact()     on agent_leads, when contact_id is first set: the figure moves to
--                                contact_income (the newer of the two wins if the client already has
--                                one) and leaves the lead. Covers every path that links a lead.
--   contact_income_access_log    + lead_id: a read or change made while the figure sat on the lead.
--
-- Additive. Requires 20261014100000 (contact_income) and 20261014600000 (the access log).
--
-- Rollback:
--   drop trigger if exists agent_leads_income_to_contact on public.agent_leads;
--   drop function if exists public.lead_income_to_contact();
--   drop table if exists public.lead_income;
--   alter table public.contact_income_access_log drop column if exists lead_id;

create table if not exists public.lead_income (
  lead_id uuid primary key references public.agent_leads(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  monthly_income_cents bigint not null,
  income_type text,
  is_household_total boolean not null default false,
  source text not null,
  confidence text not null,
  captured_by uuid references public.users(id) on delete set null,
  captured_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_income_amount check (monthly_income_cents > 0 and monthly_income_cents < 10000000),
  constraint lead_income_type check (income_type is null or income_type in ('ssa', 'ssi', 'pension', 'payroll', 'va', 'mixed', 'other')),
  constraint lead_income_source check (source in ('interview', 'draft_date_setup', 'retention_call', 'agent_estimate')),
  constraint lead_income_confidence check (confidence in ('stated', 'estimated')),
  constraint lead_income_estimate check (source <> 'agent_estimate' or confidence = 'estimated')
);
create index if not exists lead_income_tenant_idx on public.lead_income (tenant_id);
create index if not exists lead_income_by_idx on public.lead_income (captured_by) where captured_by is not null;

alter table public.contact_income_access_log add column if not exists lead_id uuid references public.agent_leads(id) on delete set null;
create index if not exists contact_income_access_log_lead_idx on public.contact_income_access_log (lead_id) where lead_id is not null;

create or replace function public.lead_income_to_contact()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.contact_income (contact_id, tenant_id, monthly_income_cents, income_type, is_household_total, source, confidence, captured_by, captured_at, updated_at)
  select new.contact_id, li.tenant_id, li.monthly_income_cents, li.income_type, li.is_household_total, li.source, li.confidence, li.captured_by, li.captured_at, li.updated_at
  from public.lead_income li
  where li.lead_id = new.id and li.tenant_id = new.tenant_id
  on conflict (contact_id) do update set
    monthly_income_cents = excluded.monthly_income_cents, income_type = excluded.income_type, is_household_total = excluded.is_household_total,
    source = excluded.source, confidence = excluded.confidence, captured_by = excluded.captured_by, captured_at = excluded.captured_at, updated_at = excluded.updated_at
  -- The client already had a figure: the newer one stands.
  where public.contact_income.updated_at < excluded.updated_at;
  delete from public.lead_income where lead_id = new.id;
  return null;
end;
$$;
revoke all on function public.lead_income_to_contact() from public, anon, authenticated, tenant_app, service_role;
drop trigger if exists agent_leads_income_to_contact on public.agent_leads;
create trigger agent_leads_income_to_contact after update of contact_id on public.agent_leads
  for each row when (old.contact_id is null and new.contact_id is not null)
  execute function public.lead_income_to_contact();

alter table public.lead_income enable row level security;
drop policy if exists lead_income_read on public.lead_income;
create policy lead_income_read on public.lead_income for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.lead_income from public, anon, authenticated;
grant select, insert, update, delete on public.lead_income to service_role;
revoke truncate on public.lead_income from service_role, tenant_app;
revoke insert, update, delete on public.lead_income from tenant_app;
grant select on public.lead_income to tenant_app;

-- Self-check: grants, and the move itself on a throwaway lead and client, undone by the raise.
do $$
declare
  t uuid;
  tpl uuid;
  c uuid;
  l uuid;
  moved bigint;
  left_on_lead int;
begin
  if has_table_privilege('tenant_app', 'public.lead_income', 'INSERT') or has_table_privilege('tenant_app', 'public.lead_income', 'SELECT') is not true then
    raise exception '20261014700000: tenant_app grants on lead_income are wrong';
  end if;
  if has_table_privilege('service_role', 'public.contact_income_access_log', 'UPDATE') then
    raise exception '20261014700000: the income access log must stay append-only';
  end if;
  select tenant_id, template_id into t, tpl from public.agent_leads limit 1;
  if t is null then return; end if;
  begin
    insert into public.contacts (tenant_id, first_name, last_name, name_search) values (t, 'Selfcheck', 'Income', 'selfcheck income') returning id into c;
    insert into public.agent_leads (tenant_id, template_id) values (t, tpl) returning id into l;
    insert into public.lead_income (lead_id, tenant_id, monthly_income_cents, source, confidence) values (l, t, 145000, 'interview', 'stated');
    update public.agent_leads set contact_id = c where id = l;
    select monthly_income_cents into moved from public.contact_income where contact_id = c;
    select count(*) into left_on_lead from public.lead_income where lead_id = l;
    if moved is distinct from 145000 or left_on_lead <> 0 then
      raise exception '20261014700000: the income did not move to the client (moved %, left %)', moved, left_on_lead;
    end if;
    raise exception using errcode = 'P0099', message = 'self-check passed';
  exception when sqlstate 'P0099' then
    null;
  end;
end $$;
