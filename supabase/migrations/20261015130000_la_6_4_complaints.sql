-- LA-6.4 (Notion sprint, Module 6 — Compliance) · complaint handling.
--
-- Every complaint gets a record, an owner, a deadline and a countdown — and a complaint about
-- unwanted calls stops the calls before anyone drafts a reply.
--
--   complaint                        one row per complaint: who, about what, which channel, the
--                                    statutory deadline (DOI and FTC only), what was said back, how it
--                                    ended. Never deleted (the retention job of LA-6.6 anonymises it).
--   compliance_complaint_deadline    response days per regulator (a state's DOI, or the FTC), per
--                                    tenant. Configuration, not code (LA-6.8 edits it). A regulator
--                                    with no row gives NO deadline and a prompt — never a guessed
--                                    default: "30 days" when the statute says 15 is the worst error
--                                    this screen could make.
--   compliance_complaint_checklist   what a response typically needs, per category. Platform content.
--   open_complaint(...)              creates the complaint and, for unwanted calls, adds the number to
--                                    the internal do-not-call list (LA-2.3's suppress_phone) in the
--                                    same transaction, logged on the complaint as caused by it.
--   compliance_settings              + the escalation thresholds (amber 10 days, red 5).
--
-- Complaints are findable by number (LA-6.1, event 'complaint'), which also switches on the evidence
-- report's "called after a complaint" check.
--
-- Requires 20261015100000 (LA-6.1) and 20261015110000 (compliance_settings). Additive. Rollback:
--   drop trigger if exists compliance_index_sync on public.complaint;
--   drop function if exists public.open_complaint(uuid, uuid, jsonb), public.complaint_guard(), public.tenant_owner_user(uuid);
--   drop table if exists public.complaint, public.compliance_complaint_deadline, public.compliance_complaint_checklist;
--   alter table public.compliance_settings drop column if exists complaint_amber_days, drop column if exists complaint_red_days;
--   (the 'compliance-files' bucket holds complaint letters: empty it deliberately before deleting it)
--   (the index view keeps a branch reading complaint: rebuild it from the earlier files first)

-- The letter, the carrier notice, what was sent back: private, served through 60-second signed links.
-- Path: <tenant_id>/complaints/<complaint_id>/<file>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('compliance-files', 'compliance-files', false, 10485760,
        array['application/pdf', 'image/png', 'image/jpeg', 'text/plain', 'message/rfc822',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document']::text[])
on conflict (id) do nothing;

alter table public.compliance_settings
  add column if not exists complaint_amber_days integer not null default 10,
  add column if not exists complaint_red_days integer not null default 5;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'compliance_settings_complaint_thresholds') then
    alter table public.compliance_settings add constraint compliance_settings_complaint_thresholds
      check (complaint_red_days between 1 and 60 and complaint_amber_days between complaint_red_days and 90);
  end if;
end $$;

create table if not exists public.compliance_complaint_deadline (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- A state's insurance department ('TX') or the FTC ('FTC').
  regulator text not null,
  response_days integer not null,
  notes text,
  set_by uuid references public.users(id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (tenant_id, regulator),
  constraint compliance_complaint_deadline_regulator check (regulator ~ '^([A-Z]{2}|FTC)$'),
  constraint compliance_complaint_deadline_days check (response_days between 1 and 180)
);
alter table public.compliance_complaint_deadline enable row level security;
drop policy if exists compliance_complaint_deadline_read on public.compliance_complaint_deadline;
create policy compliance_complaint_deadline_read on public.compliance_complaint_deadline for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.compliance_complaint_deadline from public, anon, authenticated;
revoke insert, update, delete, truncate on public.compliance_complaint_deadline from tenant_app;
revoke truncate on public.compliance_complaint_deadline from service_role;
grant select on public.compliance_complaint_deadline to tenant_app;
grant select, insert, update, delete on public.compliance_complaint_deadline to service_role;

create table if not exists public.compliance_complaint_checklist (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  position integer not null,
  item text not null,
  unique (category, position)
);
revoke all on public.compliance_complaint_checklist from public, anon, authenticated;
grant select on public.compliance_complaint_checklist to service_role, tenant_app;
insert into public.compliance_complaint_checklist (category, position, item) values
  ('any', 1, 'Acknowledge receipt and name the person handling it.'),
  ('any', 2, 'State the facts in date order, from the record — not from memory.'),
  ('any', 3, 'Attach the evidence report for the number.'),
  ('any', 4, 'Say what was done about it, and what changes now.'),
  ('any', 5, 'Sign it yourself: it is a document in your name.'),
  ('unwanted_calls', 1, 'Show the consent artefact: who captured it, when, on which page.'),
  ('unwanted_calls', 2, 'Show each scrub result before the calls.'),
  ('unwanted_calls', 3, 'List every call with its time and that it was inside legal hours.'),
  ('unwanted_calls', 4, 'Confirm the number is now on your do-not-call list, and since when.'),
  ('misrepresentation', 1, 'Quote the disclosures shown or read, with the dates.'),
  ('misrepresentation', 2, 'Attach the application and any replacement notice.'),
  ('billing', 1, 'Show the draft date the client chose and any change to it.'),
  ('agent_conduct', 1, 'Name the agent and include their own account of the contact.')
on conflict (category, position) do nothing;

create table if not exists public.complaint (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel text not null,
  regulator_state text,
  received_at timestamptz not null,
  received_via text not null,
  complainant_name text,
  phone_digits text,
  contact_id uuid references public.contacts(id) on delete set null,
  policy_number text,
  about_agent_user_id uuid references public.users(id) on delete set null,
  partner_id uuid references public.partners(id) on delete set null,
  category text not null,
  summary text not null,
  attachments_json jsonb not null default '[]'::jsonb,
  response_due_at timestamptz,
  responded_at timestamptz,
  response_text text,
  response_attachments_json jsonb not null default '[]'::jsonb,
  checklist_json jsonb not null default '{}'::jsonb,
  status text not null default 'open',
  outcome text,
  owner_user_id uuid not null references public.users(id),
  -- The internal do-not-call entry this complaint caused (unwanted calls), and when.
  dnc_entry_id uuid,
  dnc_added_at timestamptz,
  resolved_at timestamptz,
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint complaint_channel check (channel in ('agent', 'carrier', 'doi', 'ftc', 'other')),
  constraint complaint_received_via check (received_via in ('phone', 'email', 'letter', 'portal', 'carrier_notice')),
  constraint complaint_category check (category in ('unwanted_calls', 'misrepresentation', 'billing', 'service', 'claim_handling', 'agent_conduct', 'other')),
  constraint complaint_status check (status in ('open', 'investigating', 'responded', 'awaiting_regulator', 'resolved', 'escalated')),
  constraint complaint_outcome check (outcome is null or outcome in ('no_action', 'agent_corrected', 'restitution', 'fine', 'licence_action')),
  constraint complaint_phone check (phone_digits is null or phone_digits ~ '^[0-9]{10}$'),
  constraint complaint_calls_need_number check (category <> 'unwanted_calls' or phone_digits is not null),
  constraint complaint_doi_state check (channel <> 'doi' or (regulator_state is not null and regulator_state ~ '^[A-Z]{2}$')),
  constraint complaint_state_shape check (regulator_state is null or regulator_state ~ '^[A-Z]{2}$'),
  constraint complaint_summary check (length(btrim(summary)) between 1 and 4000),
  constraint complaint_resolved check ((status = 'resolved') = (resolved_at is not null))
);
create index if not exists complaint_tenant_due_idx on public.complaint (tenant_id, response_due_at) where status not in ('resolved');
create index if not exists complaint_tenant_received_idx on public.complaint (tenant_id, received_at desc);
create index if not exists complaint_phone_idx on public.complaint (tenant_id, phone_digits) where phone_digits is not null;
create index if not exists complaint_partner_idx on public.complaint (partner_id) where partner_id is not null;
create index if not exists complaint_contact_idx on public.complaint (contact_id) where contact_id is not null;
create index if not exists complaint_owner_idx on public.complaint (owner_user_id);
create index if not exists complaint_agent_idx on public.complaint (about_agent_user_id) where about_agent_user_id is not null;
create index if not exists complaint_created_by_idx on public.complaint (created_by) where created_by is not null;
create index if not exists complaint_search_idx on public.complaint using gin (to_tsvector('english', summary || ' ' || coalesce(response_text, '')));

alter table public.complaint enable row level security;
drop policy if exists complaint_read on public.complaint;
create policy complaint_read on public.complaint for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.complaint from public, anon, authenticated;
revoke insert, update, delete, truncate on public.complaint from tenant_app;
-- Never deleted by the app; LA-6.6's retention job anonymises instead.
revoke delete, truncate on public.complaint from service_role;
grant select on public.complaint to tenant_app;
grant select, insert, update on public.complaint to service_role;

-- What was received, and when, is the record: it does not change after the fact. The workflow
-- (status, owner, response, outcome, notes, checklist, attachments) moves; a deadline may be set
-- once it was missing.
create or replace function public.complaint_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.tenant_id <> old.tenant_id or new.channel <> old.channel or new.received_at <> old.received_at
     or new.created_at <> old.created_at or new.created_by is distinct from old.created_by
     or new.dnc_entry_id is distinct from old.dnc_entry_id and old.dnc_entry_id is not null then
    raise exception 'complaint: what was received, and when, cannot change' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.complaint_guard() from public, anon, authenticated, tenant_app, service_role;
drop trigger if exists complaint_guard on public.complaint;
create trigger complaint_guard before update on public.complaint for each row execute function public.complaint_guard();

-- The tenant admin: the earliest accepted owner.
create or replace function public.tenant_owner_user(p_tenant_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select tu.user_id from public.tenant_users tu
   where tu.tenant_id = p_tenant_id and tu.role = 'owner'
   order by (tu.accepted_at is null), tu.accepted_at, tu.invited_at
   limit 1
$$;
revoke all on function public.tenant_owner_user(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_owner_user(uuid) to service_role;

-- Open a complaint. For unwanted calls the number goes on the internal do-not-call list in the same
-- transaction — before anyone drafts a reply.
create or replace function public.open_complaint(p_tenant_id uuid, p_actor uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_id uuid;
  v_channel text := p->>'channel';
  v_state text := upper(nullif(btrim(coalesce(p->>'regulator_state', '')), ''));
  v_received timestamptz := coalesce((p->>'received_at')::timestamptz, now());
  v_phone text := public.us_phone_10_digits(p->>'phone');
  v_owner uuid;
  v_days integer;
  v_due timestamptz;
  v_dnc uuid;
begin
  if p_tenant_id is null then
    raise exception 'open_complaint: a tenant is required';
  end if;
  if nullif(btrim(coalesce(p->>'phone', '')), '') is not null and v_phone is null then
    raise exception 'open_complaint: % is not a US phone number', p->>'phone' using errcode = 'check_violation';
  end if;
  -- The owner is never null: the named person if they belong to this tenant, else the tenant admin.
  select tu.user_id into v_owner from public.tenant_users tu
   where tu.tenant_id = p_tenant_id and tu.user_id = nullif(p->>'owner_user_id', '')::uuid;
  v_owner := coalesce(v_owner, public.tenant_owner_user(p_tenant_id));
  if v_owner is null then
    raise exception 'open_complaint: this tenant has no owner to hold the complaint';
  end if;
  -- A deadline only where one is configured; otherwise null, and the screen asks for it.
  if v_channel in ('doi', 'ftc') then
    select d.response_days into v_days from public.compliance_complaint_deadline d
     where d.tenant_id = p_tenant_id and d.regulator = case when v_channel = 'ftc' then 'FTC' else v_state end;
    if v_days is not null then
      v_due := v_received + make_interval(days => v_days);
    end if;
  end if;

  insert into public.complaint (tenant_id, channel, regulator_state, received_at, received_via, complainant_name, phone_digits,
                                contact_id, policy_number, about_agent_user_id, partner_id, category, summary, attachments_json,
                                response_due_at, owner_user_id, notes, created_by)
  values (p_tenant_id, v_channel, v_state, v_received, p->>'received_via', nullif(btrim(coalesce(p->>'complainant_name', '')), ''), v_phone,
          nullif(p->>'contact_id', '')::uuid, nullif(btrim(coalesce(p->>'policy_number', '')), ''), nullif(p->>'about_agent_user_id', '')::uuid,
          nullif(p->>'partner_id', '')::uuid, p->>'category', p->>'summary', coalesce(p->'attachments', '[]'::jsonb),
          v_due, v_owner, nullif(btrim(coalesce(p->>'notes', '')), ''), p_actor)
  returning id into v_id;

  if p->>'category' = 'unwanted_calls' then
    v_dnc := public.suppress_phone(p_tenant_id, v_phone, 'internal', 'Complaint ' || v_id || ': asked not to be called', 'complaint', p_actor);
    update public.complaint set dnc_entry_id = v_dnc, dnc_added_at = now() where id = v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.open_complaint(uuid, uuid, jsonb) from public, anon, authenticated, tenant_app;
grant execute on function public.open_complaint(uuid, uuid, jsonb) to service_role;

-- ─── LA-6.1: complaints are findable by number ──────────────────────────────────────────────────
select public.compliance_index_add_source('complaint', $branch$
  select c.tenant_id, c.phone_digits, c.contact_id, null::uuid, 'complaint'::text, c.received_at,
         'complaint'::text, c.id, '00000000-0000-0000-0000-000000000000'::uuid,
         ('Complaint (' || c.channel || coalesce(' ' || c.regulator_state, '') || '): ' || replace(c.category, '_', ' ')
           || case when c.dnc_entry_id is not null then ' · number added to do-not-call' else '' end)::text,
         'LA-6.4'::text
    from public.complaint c
   where c.phone_digits is not null
$branch$);
drop trigger if exists compliance_index_sync on public.complaint;
create trigger compliance_index_sync after insert or delete or update of phone_digits, contact_id, channel, regulator_state, category, dnc_entry_id on public.complaint
  for each row execute function public.compliance_index_sync();

-- ─── self-check ─────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_id uuid;
  v_row record;
begin
  if has_table_privilege('service_role', 'public.complaint', 'DELETE') then
    raise exception '20261015130000: complaints are never deleted';
  end if;
  -- Exercise the function on a real tenant, then roll it back.
  select t.id into v_tenant from public.tenants t where public.tenant_owner_user(t.id) is not null limit 1;
  if v_tenant is null then
    return;
  end if;
  begin
    v_id := public.open_complaint(v_tenant, null, jsonb_build_object('channel', 'doi', 'regulator_state', 'ZZ', 'received_via', 'letter',
              'phone', '(817) 555-0199', 'category', 'unwanted_calls', 'summary', 'self-check'));
    select * into v_row from public.complaint where id = v_id;
    if v_row.response_due_at is not null then
      raise exception '20261015130000: a deadline was invented for a regulator with none configured';
    end if;
    if v_row.dnc_entry_id is null or not public.is_tenant_phone_suppressed(v_tenant, '8175550199') then
      raise exception '20261015130000: an unwanted-calls complaint did not reach the do-not-call list';
    end if;
    if v_row.owner_user_id is null then
      raise exception '20261015130000: the complaint has no owner';
    end if;
    if not exists (select 1 from public.compliance_index where tenant_id = v_tenant and source_table = 'complaint' and source_id = v_id) then
      raise exception '20261015130000: the complaint is not findable by number';
    end if;
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
end $$;
