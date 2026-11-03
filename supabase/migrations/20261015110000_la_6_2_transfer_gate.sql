-- LA-6.2 (Notion sprint, Module 6 — Compliance) · the pre-transfer gate and its recorded verdict.
--
-- Before a partner's transfer is accepted, every check runs once (each in the module that owns it —
-- LA-1.5 screening, LA-2.3 do-not-call, LA-2.6 consent, LA-1.24 existing customer, LA-2.4 calling
-- hours, LA-1.3 partner product approval) and ONE row records the verdict, with every check's answer
-- and a pointer to the record that produced it. That row answers "why did you accept that call?".
--
--   transfer_verdict      one row per evaluation: on number entry (the real gate, before anyone is
--                         connected) and again at submit. Append-only: the only change ever made is
--                         linking the lead once it exists (lead_id, null → value).
--   compliance_settings   one row per tenant: the LA-6 settings (LA-6.8 adds the screen and the
--                         rest). For the gate: which optional checks run, whether a missing consent
--                         artefact warns or blocks (default warn), and the time budget. The litigator
--                         and internal do-not-call checks have no switch: they always run.
--
-- The verdict is indexed by LA-6.1 (event 'transfer_verdict').
--
-- Requires 20261015100000 (LA-6.1). Additive. Rollback:
--   drop trigger if exists compliance_index_sync on public.transfer_verdict;
--   drop table if exists public.transfer_verdict, public.compliance_settings;
--   (the view keeps a branch reading transfer_verdict: rebuild it from 20261015100000 first)

create table if not exists public.compliance_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  gate_consent_missing text not null default 'warn',
  gate_timeout_ms integer not null default 2000,
  gate_check_federal_dnc boolean not null default true,
  gate_check_consent boolean not null default true,
  gate_check_existing_customer boolean not null default true,
  gate_check_calling_hours boolean not null default true,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint compliance_settings_gate_consent check (gate_consent_missing in ('warn', 'block')),
  constraint compliance_settings_gate_timeout check (gate_timeout_ms between 500 and 10000)
);
alter table public.compliance_settings enable row level security;
drop policy if exists compliance_settings_read on public.compliance_settings;
create policy compliance_settings_read on public.compliance_settings for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.compliance_settings from public, anon, authenticated;
revoke delete, truncate on public.compliance_settings from service_role, tenant_app;
revoke insert, update on public.compliance_settings from tenant_app;
grant select on public.compliance_settings to tenant_app;
grant select, insert, update on public.compliance_settings to service_role;

create table if not exists public.transfer_verdict (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  partner_id uuid references public.partners(id) on delete set null,
  partner_user_id uuid references public.users(id) on delete set null,
  submission_id uuid,
  -- Null only when the number was not a valid US number (that is itself the reject).
  phone_digits text,
  lead_id uuid references public.agent_leads(id) on delete set null,
  product_code text not null,
  carrier_state text,
  stage text not null,
  verdict text not null,
  checks_json jsonb not null,
  blocking_reason text,
  warnings_json jsonb not null default '[]'::jsonb,
  evaluated_at timestamptz not null default now(),
  total_duration_ms integer not null,
  screened_before_transfer boolean not null,
  constraint transfer_verdict_phone check (phone_digits is null or phone_digits ~ '^[0-9]{10}$'),
  constraint transfer_verdict_stage check (stage in ('number_entry', 'submit')),
  constraint transfer_verdict_verdict check (verdict in ('accept', 'accept_with_warnings', 'reject')),
  constraint transfer_verdict_reject_reason check ((verdict = 'reject') = (blocking_reason is not null)),
  constraint transfer_verdict_reject_no_lead check (verdict <> 'reject' or lead_id is null),
  constraint transfer_verdict_checks check (jsonb_typeof(checks_json) = 'array' and jsonb_array_length(checks_json) > 0),
  constraint transfer_verdict_state check (carrier_state is null or carrier_state ~ '^[A-Z]{2}$')
);
create index if not exists transfer_verdict_partner_idx on public.transfer_verdict (tenant_id, partner_id, evaluated_at desc);
create index if not exists transfer_verdict_submission_idx on public.transfer_verdict (tenant_id, submission_id, evaluated_at) where submission_id is not null;
create index if not exists transfer_verdict_phone_idx on public.transfer_verdict (tenant_id, phone_digits, evaluated_at) where phone_digits is not null;
create index if not exists transfer_verdict_lead_idx on public.transfer_verdict (lead_id) where lead_id is not null;
create index if not exists transfer_verdict_partner_fk_idx on public.transfer_verdict (partner_id) where partner_id is not null;
create index if not exists transfer_verdict_user_idx on public.transfer_verdict (partner_user_id) where partner_user_id is not null;

alter table public.transfer_verdict enable row level security;
drop policy if exists transfer_verdict_read on public.transfer_verdict;
create policy transfer_verdict_read on public.transfer_verdict for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.transfer_verdict from public, anon, authenticated;
revoke insert, update, delete, truncate on public.transfer_verdict from tenant_app;
revoke delete, truncate on public.transfer_verdict from service_role;
grant select on public.transfer_verdict to tenant_app;
grant select, insert, update on public.transfer_verdict to service_role;

-- Evidence does not change: the only update allowed links the lead once (null → value), and only on
-- an accepted verdict (the check constraint refuses it on a reject). A lead deleted later sets it
-- back to null through the foreign key, which is the one other change let through.
create or replace function public.transfer_verdict_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if (to_jsonb(new) - 'lead_id') is distinct from (to_jsonb(old) - 'lead_id') then
    raise exception 'transfer_verdict is evidence: only the lead link may be set' using errcode = 'check_violation';
  end if;
  if old.lead_id is not null and new.lead_id is not null and new.lead_id <> old.lead_id then
    raise exception 'transfer_verdict: the lead link is set once' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function public.transfer_verdict_guard() from public, anon, authenticated, tenant_app, service_role;
drop trigger if exists transfer_verdict_guard on public.transfer_verdict;
create trigger transfer_verdict_guard before update on public.transfer_verdict for each row execute function public.transfer_verdict_guard();

-- ─── LA-6.1: verdicts are findable by number ────────────────────────────────────────────────────
select public.compliance_index_add_source('transfer_verdict', $branch$
  select v.tenant_id, v.phone_digits, l.contact_id, v.lead_id, 'transfer_verdict'::text, v.evaluated_at,
         'transfer_verdict'::text, v.id, '00000000-0000-0000-0000-000000000000'::uuid,
         ('Transfer ' || replace(v.verdict, '_', ' ') || coalesce(': ' || replace(v.blocking_reason, '_', ' '), '')
           || case v.stage when 'number_entry' then ' (on number entry)' else ' (at submit)' end)::text,
         'LA-6.2'::text
    from public.transfer_verdict v
    left join public.agent_leads l on l.id = v.lead_id and l.tenant_id = v.tenant_id
   where v.phone_digits is not null
$branch$);

drop trigger if exists compliance_index_sync on public.transfer_verdict;
create trigger compliance_index_sync after insert or update or delete on public.transfer_verdict for each row execute function public.compliance_index_sync();

-- ─── self-check ─────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if position('''transfer_verdict''' in pg_get_viewdef('public.compliance_index_source'::regclass, true)) = 0 then
    raise exception '20261015110000: the index does not read transfer verdicts';
  end if;
  if has_table_privilege('service_role', 'public.transfer_verdict', 'DELETE') or has_table_privilege('tenant_app', 'public.transfer_verdict', 'INSERT') then
    raise exception '20261015110000: verdicts are written by the server only and never deleted';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'transfer_verdict_guard' and tgrelid = 'public.transfer_verdict'::regclass) then
    raise exception '20261015110000: the verdict guard is missing';
  end if;
end $$;
