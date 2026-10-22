-- LA-5.5 (Notion sprint, Module 5 — Retention) · paper bill → bank payment, as a standing campaign.
--
-- Every in-force policy paid by mailed bill, worked through biggest premium first, before any of them
-- fails. The list itself is computed (policy_current.payment_method = 'direct_bill'); what is stored
-- is what the agent did:
--
--   conversion_attempt   one row per call: converted (the client agreed; the LA-5.4
--                        bill_to_draft_conversion request it opened is linked) | declined (with a
--                        reason; the policy returns after the cooling-off) | no_answer |
--                        callback_requested | unable_no_bank_account (leaves the campaign for good and
--                        goes to the save queue — never asked again). Never edited or removed.
--
--   A conversion COUNTS only when its LA-5.4 request reaches verified_in_file — not when the client
--   agrees. Nothing here can say otherwise.
--
-- Also on retention_settings (LA-5.11): bill_decline_cooloff_days (default 180) and bill_talk_track
-- (the agency's own words; null = the platform's).
--
-- Additive. Requires 20261014200000 (servicing_request) and 20261014100000 (retention_settings).
--
-- Rollback:
--   drop table if exists public.conversion_attempt;
--   drop function if exists public.conversion_attempt_guard();
--   alter table public.retention_settings drop column if exists bill_decline_cooloff_days, drop column if exists bill_talk_track;

alter table public.retention_settings add column if not exists bill_decline_cooloff_days smallint not null default 180;
alter table public.retention_settings add column if not exists bill_talk_track text;
alter table public.retention_settings drop constraint if exists retention_settings_bill_cooloff;
alter table public.retention_settings add constraint retention_settings_bill_cooloff check (bill_decline_cooloff_days between 30 and 730);
alter table public.retention_settings drop constraint if exists retention_settings_talk_track;
alter table public.retention_settings add constraint retention_settings_talk_track check (bill_talk_track is null or char_length(btrim(bill_talk_track)) between 10 and 4000);

create table if not exists public.conversion_attempt (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  policy_number text not null,
  outcome text not null,
  decline_reason text,
  servicing_request_id uuid references public.servicing_request(id) on delete restrict,
  attempted_by uuid references public.users(id) on delete set null,
  attempted_at timestamptz not null default now(),
  note text,
  constraint conversion_attempt_outcome check (outcome in ('converted', 'declined', 'no_answer', 'callback_requested', 'unable_no_bank_account')),
  constraint conversion_attempt_reason check ((outcome = 'declined') = (decline_reason is not null)),
  constraint conversion_attempt_reason_len check (decline_reason is null or char_length(btrim(decline_reason)) between 3 and 500),
  constraint conversion_attempt_note check (note is null or char_length(note) <= 2000),
  constraint conversion_attempt_request check (servicing_request_id is null or outcome = 'converted')
);
create index if not exists conversion_attempt_policy_idx on public.conversion_attempt (tenant_id, carrier_id, policy_number, attempted_at desc);
create index if not exists conversion_attempt_recent_idx on public.conversion_attempt (tenant_id, attempted_at desc);
create index if not exists conversion_attempt_no_bank_idx on public.conversion_attempt (tenant_id) where outcome = 'unable_no_bank_account';
create index if not exists conversion_attempt_carrier_idx on public.conversion_attempt (carrier_id);
create index if not exists conversion_attempt_request_idx on public.conversion_attempt (servicing_request_id) where servicing_request_id is not null;
create index if not exists conversion_attempt_by_idx on public.conversion_attempt (attempted_by) where attempted_by is not null;

-- A call is a record: never edited, never removed.
create or replace function public.conversion_attempt_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A logged conversion call is never removed.' using errcode = 'P0001';
  end if;
  raise exception 'A logged conversion call never changes; log another.' using errcode = 'P0001';
end;
$$;
drop trigger if exists conversion_attempt_guard on public.conversion_attempt;
create trigger conversion_attempt_guard before update or delete on public.conversion_attempt
  for each row execute function public.conversion_attempt_guard();

alter table public.conversion_attempt enable row level security;
drop policy if exists conversion_attempt_read on public.conversion_attempt;
create policy conversion_attempt_read on public.conversion_attempt for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.conversion_attempt from public, anon, authenticated;
grant select, insert on public.conversion_attempt to service_role;
revoke update, delete, truncate on public.conversion_attempt from service_role, tenant_app;
revoke insert on public.conversion_attempt from tenant_app;
grant select on public.conversion_attempt to tenant_app;

-- ─── self-check ─────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if has_table_privilege('service_role', 'public.conversion_attempt', 'UPDATE') or has_table_privilege('service_role', 'public.conversion_attempt', 'DELETE') then
    raise exception '20261014300000: conversion calls must not be editable (service_role update=%, delete=%)',
      has_table_privilege('service_role', 'public.conversion_attempt', 'UPDATE'), has_table_privilege('service_role', 'public.conversion_attempt', 'DELETE');
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'retention_settings' and column_name = 'bill_decline_cooloff_days') then
    raise exception '20261014300000: retention_settings has no decline cooling-off';
  end if;
end $$;
