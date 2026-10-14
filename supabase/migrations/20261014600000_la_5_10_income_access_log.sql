-- LA-5.10 (Notion sprint, Module 5 — Retention) · income capture: who looked at or changed a client's
-- income, and where.
--
-- contact_income itself arrived with 20261014100000 (the radar reads it for Sign 5). Income is
-- sensitive — it is used for that one signal and nothing else — so every time a person reads or
-- changes it, a row lands here, like LA-3.7's tenant_sensitive_access_log (which is keyed by
-- application and cannot hold a contact-level field).
--
--   contact_income_access_log   append-only: tenant, user, contact, action (view | save | clear),
--                               surface (interview | draft_date_setup | save_queue), when.
--
-- Additive. Requires 20261014100000 (contact_income).
--
-- Rollback:
--   drop table if exists public.contact_income_access_log;

create table if not exists public.contact_income_access_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  action text not null,
  surface text not null,
  at timestamptz not null default now(),
  constraint contact_income_access_log_action check (action in ('view', 'save', 'clear')),
  constraint contact_income_access_log_surface check (surface in ('interview', 'draft_date_setup', 'save_queue'))
);
create index if not exists contact_income_access_log_contact_idx on public.contact_income_access_log (tenant_id, contact_id, at desc);
create index if not exists contact_income_access_log_user_idx on public.contact_income_access_log (user_id) where user_id is not null;
create index if not exists contact_income_access_log_contact_fk_idx on public.contact_income_access_log (contact_id) where contact_id is not null;

alter table public.contact_income_access_log enable row level security;
drop policy if exists contact_income_access_log_read on public.contact_income_access_log;
create policy contact_income_access_log_read on public.contact_income_access_log for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.contact_income_access_log from public, anon, authenticated;
grant select, insert on public.contact_income_access_log to service_role;
-- Append-only, as LA-3.7's log: no role can update, delete or truncate it. (A trigger refusing deletes
-- would also refuse the cascade when a tenant is removed.)
revoke update, delete, truncate on public.contact_income_access_log from service_role, tenant_app;
revoke insert on public.contact_income_access_log from tenant_app;
grant select on public.contact_income_access_log to tenant_app;

do $$
begin
  if has_table_privilege('service_role', 'public.contact_income_access_log', 'UPDATE') or has_table_privilege('service_role', 'public.contact_income_access_log', 'DELETE') then
    raise exception '20261014600000: the income access log must not be editable';
  end if;
  if to_regclass('public.contact_income') is null then
    raise exception '20261014600000: contact_income (20261014100000) is missing';
  end if;
end $$;
