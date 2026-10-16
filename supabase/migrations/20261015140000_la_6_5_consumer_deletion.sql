-- LA-6.5 (Notion sprint, Module 6 — Compliance) · consumer data-subject deletion.
--
-- One person asks to be deleted. Find them everywhere, remove or anonymise what we can, keep what we
-- must, and record exactly which was which — the certificate is built from that record.
--
--   deletion_request         the request, its identity check, the hold, and the per-table results.
--   deletion_request_event   its audit trail: every step, who, when, what it touched. Kept in full.
--   erase_matching_values    replaces, inside a JSON document, every value that is one of the
--                            person's identifiers (names, numbers, emails, addresses, dates of birth).
--   data_subject_discover    finds the person: clients, numbers, emails, leads, applications, cases,
--                            policies and the carrier rows behind them.
--   data_subject_purge_group runs ONE group of the purge (one transaction each), idempotently, and
--                            records per-table counts. The groups, in order:
--                              dnc          keep the number on the internal do-not-call list, reduced
--                                           to the number and a reason (added if it was not there).
--                              activity     calls, notes, callbacks, appointments, dispositions …
--                              checks       consent artefacts (purged); screening, scrub and transfer
--                                           records anonymised (partner quality and vendor credits
--                                           still count them).
--                              applications health answers, medications, verification fields,
--                                           application answers, beneficiaries, payment methods.
--                              leads        lead rows and deal flow anonymised (vendor cost reporting
--                                           still reconciles); partner drafts and chat cards scrubbed.
--                              clients      the client record anonymised; phones, emails, income,
--                                           queue items purged; policy and commission records kept,
--                                           with the person's identifiers erased from the carrier rows.
--                              records      complaints anonymised (kept: the regulatory record), report
--                                           log and email log entries anonymised.
--
-- The do-not-call entry is NEVER deleted — not here, not by LA-6.6, not by anyone (the LA-2.3 guard
-- refuses it). The number is kept precisely so the person is never called again.
--
-- Carrier raw rows and policy snapshots are immutable (LA-4). Their guards now let ONE thing through:
-- a payload / `extra` change made by this purge (app.data_subject_deletion set), with every other
-- column unchanged. The rows stay, so every figure and trace still reconciles.
--
-- Requires 20261015100000–20261015130000. Additive apart from the two guard bodies. Rollback:
--   drop function if exists public.data_subject_purge_group(uuid, text, uuid), public.data_subject_discover(uuid, text, text, uuid),
--     public.erase_matching_values(jsonb, text[], text[]), public.deletion_request_guard();
--   drop table if exists public.deletion_request_event, public.deletion_request;
--   restore raw_rows_immutable / policy_snapshot_guard from 20261008100000 / 20261008150000 (their bodies are quoted in this file).

alter table public.compliance_settings
  add column if not exists deletion_hold_days integer not null default 7,
  add column if not exists deletion_methods text[] not null default array['known_customer', 'phone_match', 'email_match', 'document'];
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'compliance_settings_deletion_hold_floor') then
    -- The platform floor is 3 days: a request made in anger at 11pm is sometimes withdrawn on Monday.
    alter table public.compliance_settings add constraint compliance_settings_deletion_hold_floor check (deletion_hold_days between 3 and 45);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'compliance_settings_deletion_methods') then
    alter table public.compliance_settings add constraint compliance_settings_deletion_methods
      check (deletion_methods <@ array['known_customer', 'phone_match', 'email_match', 'document'] and cardinality(deletion_methods) >= 1);
  end if;
end $$;

create table if not exists public.deletion_request (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone_digits text,
  email text,
  contact_id uuid references public.contacts(id) on delete set null,
  requester_name text,
  received_at timestamptz not null,
  received_via text not null,
  verified_at timestamptz,
  verified_by uuid references public.users(id) on delete set null,
  verification_method text,
  verification_note text,
  scheduled_purge_at timestamptz,
  status text not null default 'received',
  rejection_reason text,
  certificate_url text,
  -- The person as discovered when the purge starts. Cleared to counts on completion.
  subject_json jsonb,
  -- Per group, per table: rows purged / anonymised / kept, and why.
  results_json jsonb not null default '{}'::jsonb,
  groups_done text[] not null default '{}',
  completed_at timestamptz,
  performed_by uuid references public.users(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deletion_request_via check (received_via in ('phone', 'email', 'letter', 'web_form')),
  constraint deletion_request_method check (verification_method is null or verification_method in ('known_customer', 'phone_match', 'email_match', 'document')),
  constraint deletion_request_status check (status in ('received', 'verifying', 'verified', 'scheduled', 'completed', 'rejected', 'cancelled')),
  constraint deletion_request_phone check (phone_digits is null or phone_digits ~ '^[0-9]{10}$'),
  constraint deletion_request_who check (phone_digits is not null or email is not null or contact_id is not null),
  constraint deletion_request_rejected check ((status = 'rejected') = (rejection_reason is not null)),
  constraint deletion_request_verified check (status not in ('verified', 'scheduled', 'completed') or (verified_at is not null and verification_method is not null)),
  constraint deletion_request_completed check ((status = 'completed') = (completed_at is not null))
);
create index if not exists deletion_request_tenant_idx on public.deletion_request (tenant_id, received_at desc);
create index if not exists deletion_request_due_idx on public.deletion_request (scheduled_purge_at) where status = 'scheduled';
create index if not exists deletion_request_contact_idx on public.deletion_request (contact_id) where contact_id is not null;
create index if not exists deletion_request_users_idx on public.deletion_request (verified_by, performed_by, created_by);

create table if not exists public.deletion_request_event (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.deletion_request(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  at timestamptz not null default now(),
  actor_user_id uuid references public.users(id) on delete set null,
  action text not null,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists deletion_request_event_request_idx on public.deletion_request_event (request_id, at);
create index if not exists deletion_request_event_tenant_idx on public.deletion_request_event (tenant_id);
create index if not exists deletion_request_event_actor_idx on public.deletion_request_event (actor_user_id) where actor_user_id is not null;

alter table public.deletion_request enable row level security;
alter table public.deletion_request_event enable row level security;
drop policy if exists deletion_request_read on public.deletion_request;
create policy deletion_request_read on public.deletion_request for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists deletion_request_event_read on public.deletion_request_event;
create policy deletion_request_event_read on public.deletion_request_event for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.deletion_request, public.deletion_request_event from public, anon, authenticated;
revoke insert, update, delete, truncate on public.deletion_request, public.deletion_request_event from tenant_app;
grant select on public.deletion_request, public.deletion_request_event to tenant_app;
-- The request moves through the app; its audit trail is never edited or removed.
revoke delete, truncate on public.deletion_request from service_role;
grant select, insert, update on public.deletion_request to service_role;
revoke update, delete, truncate on public.deletion_request_event from service_role;
grant select, insert on public.deletion_request_event to service_role;

-- A completed, rejected or cancelled request is final; a request's who and when never change.
create or replace function public.deletion_request_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.tenant_id <> old.tenant_id or new.received_at <> old.received_at or new.created_at <> old.created_at
     or new.phone_digits is distinct from old.phone_digits and old.status <> 'received' then
    raise exception 'deletion_request: what was asked, and when, cannot change' using errcode = 'check_violation';
  end if;
  if old.status in ('completed', 'rejected', 'cancelled') and (to_jsonb(new) - 'updated_at' - 'subject_json' - 'certificate_url') is distinct from (to_jsonb(old) - 'updated_at' - 'subject_json' - 'certificate_url') then
    raise exception 'deletion_request: a % request is final', old.status using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.deletion_request_guard() from public, anon, authenticated, tenant_app, service_role;
drop trigger if exists deletion_request_guard on public.deletion_request;
create trigger deletion_request_guard before update on public.deletion_request for each row execute function public.deletion_request_guard();

-- ─── erasing identifiers inside JSON ────────────────────────────────────────────────────────────
-- A string (or number) leaf is erased when it IS one of the person's identifiers (case and spacing
-- ignored), when its digits are one of their numbers or dates, or when it contains one of their
-- longer identifiers (a full name, an email, an address). Keys and everything else are kept.
create or replace function public.erase_matching_values(p_doc jsonb, p_tokens text[], p_digits text[])
returns jsonb
language plpgsql
immutable
set search_path = public, pg_catalog
as $$
declare
  v_kind text := jsonb_typeof(p_doc);
  v_out jsonb;
  v_key text;
  v_val jsonb;
  v_text text;
  v_norm text;
  v_digits text;
  v_token text;
begin
  if p_doc is null then
    return null;
  end if;
  if v_kind = 'object' then
    v_out := '{}'::jsonb;
    for v_key, v_val in select * from jsonb_each(p_doc) loop
      v_out := v_out || jsonb_build_object(v_key, public.erase_matching_values(v_val, p_tokens, p_digits));
    end loop;
    return v_out;
  elsif v_kind = 'array' then
    select coalesce(jsonb_agg(public.erase_matching_values(e, p_tokens, p_digits)), '[]'::jsonb) into v_out from jsonb_array_elements(p_doc) e;
    return v_out;
  elsif v_kind in ('string', 'number') then
    v_text := case when v_kind = 'string' then p_doc #>> '{}' else p_doc::text end;
    v_norm := lower(btrim(regexp_replace(v_text, '\s+', ' ', 'g')));
    v_digits := regexp_replace(v_text, '[^0-9]', '', 'g');
    if v_norm = '' then
      return p_doc;
    end if;
    if v_norm = any(p_tokens) or (length(v_digits) >= 6 and v_digits = any(p_digits)) then
      return to_jsonb('[erased]'::text);
    end if;
    foreach v_token in array coalesce(p_tokens, '{}') loop
      if length(v_token) >= 8 and position(v_token in v_norm) > 0 then
        return to_jsonb('[erased]'::text);
      end if;
    end loop;
    return p_doc;
  end if;
  return p_doc;
end $$;
revoke all on function public.erase_matching_values(jsonb, text[], text[]) from public, anon, authenticated, tenant_app;
grant execute on function public.erase_matching_values(jsonb, text[], text[]) to service_role;

-- ─── the carrier rows: immutable, except for this ───────────────────────────────────────────────
-- Was (20261008100000): raise exception 'Raw rows are never changed or removed; register a corrected file instead.'
create or replace function public.raw_rows_immutable()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- LA-6.5: a consumer deletion may erase the person's identifiers from a row's payload. Nothing
  -- else about the row may change, and a row is still never removed.
  if tg_op = 'UPDATE' and coalesce(current_setting('app.data_subject_deletion', true), '') <> ''
     and (to_jsonb(new) - 'payload') = (to_jsonb(old) - 'payload') then
    return new;
  end if;
  raise exception 'Raw rows are never changed or removed; register a corrected file instead.' using errcode = 'P0001';
end;
$function$;

-- Was: the same body without the LA-6.5 branch.
create or replace function public.policy_snapshot_guard()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- LA-6.5: a consumer deletion may erase the person's identifiers from `extra`; nothing else.
  if coalesce(current_setting('app.data_subject_deletion', true), '') <> ''
     and (to_jsonb(new) - 'extra') = (to_jsonb(old) - 'extra') then
    return new;
  end if;
  if (to_jsonb(new) - 'superseded') is distinct from (to_jsonb(old) - 'superseded') or (old.superseded and not new.superseded) then
    raise exception 'A policy snapshot is never edited; it is rebuilt from its file''s raw rows.' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

-- LA-6.2's verdict guard: the purge may clear the number and the lead link, nothing else.
create or replace function public.transfer_verdict_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if coalesce(current_setting('app.data_subject_deletion', true), '') <> ''
     and (to_jsonb(new) - 'lead_id' - 'phone_digits') = (to_jsonb(old) - 'lead_id' - 'phone_digits')
     and new.phone_digits is null then
    return new;
  end if;
  if (to_jsonb(new) - 'lead_id') is distinct from (to_jsonb(old) - 'lead_id') then
    raise exception 'transfer_verdict is evidence: only the lead link may be set' using errcode = 'check_violation';
  end if;
  if old.lead_id is not null and new.lead_id is not null and new.lead_id <> old.lead_id then
    raise exception 'transfer_verdict: the lead link is set once' using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- ─── finding the person ─────────────────────────────────────────────────────────────────────────
create or replace function public.data_subject_discover(p_tenant_id uuid, p_phone text, p_email text, p_contact_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_phones text[] := array_remove(array[public.us_phone_10_digits(p_phone)], null);
  v_emails text[] := array_remove(array[lower(nullif(btrim(coalesce(p_email, '')), ''))], null);
  v_contacts uuid[] := array_remove(array[p_contact_id], null);
  v_leads uuid[];
  v_apps uuid[];
  v_cases uuid[];
  v_policies jsonb;
  v_raw uuid[];
  v_tokens text[];
  v_digits text[];
begin
  -- Clients: the one named, any whose numbers or emails match, and any merged into them.
  select coalesce(array_agg(distinct c.id), '{}') into v_contacts
    from public.contacts c
   where c.tenant_id = p_tenant_id
     and (c.id = any(v_contacts)
          or public.us_phone_10_digits(c.primary_phone) = any(v_phones)
          or exists (select 1 from public.contact_phones cp where cp.contact_id = c.id and public.us_phone_10_digits(cp.phone) = any(v_phones))
          or exists (select 1 from public.contact_emails ce where ce.contact_id = c.id and lower(ce.email) = any(v_emails)));
  select coalesce(array_agg(distinct c.id), '{}') || v_contacts into v_contacts
    from public.contacts c where c.tenant_id = p_tenant_id and c.merged_into_id = any(v_contacts);

  select v_phones || coalesce(array_agg(distinct x.p) filter (where x.p is not null), '{}') into v_phones from (
    select public.us_phone_10_digits(c.primary_phone) p from public.contacts c where c.id = any(v_contacts)
    union select public.us_phone_10_digits(cp.phone) from public.contact_phones cp where cp.contact_id = any(v_contacts)
  ) x;
  select v_emails || coalesce(array_agg(distinct lower(ce.email)), '{}') into v_emails from public.contact_emails ce where ce.contact_id = any(v_contacts);

  -- Leads: the clients', and any whose number or email matches. (A scan of the tenant's leads: this
  -- runs once per deletion, and the LA-1.24 phone-key index, 20260929140100, is not live everywhere.)
  select coalesce(array_agg(distinct l.id), '{}') into v_leads
    from public.agent_leads l
   where l.tenant_id = p_tenant_id
     and (l.contact_id = any(v_contacts)
          or public.compliance_lead_phone(l.values) = any(v_phones)
          or (cardinality(v_emails) > 0 and lower(l.values->>'email') = any(v_emails)));
  select v_leads || coalesce(array_agg(distinct i.lead_id), '{}') into v_leads
    from public.compliance_index i where i.tenant_id = p_tenant_id and i.phone_digits = any(v_phones) and i.lead_id is not null;
  select coalesce(array_agg(distinct x), '{}') into v_leads from unnest(v_leads) x;

  select (select coalesce(array_agg(distinct p), '{}') from unnest(v_phones || coalesce(array_agg(public.compliance_lead_phone(l.values)), '{}')) p where p is not null),
         (select coalesce(array_agg(distinct e), '{}') from unnest(v_emails || coalesce(array_agg(lower(l.values->>'email')) filter (where l.values ? 'email'), '{}')) e where e is not null)
    into v_phones, v_emails
    from public.agent_leads l where l.id = any(v_leads);

  select coalesce(array_agg(distinct a.id), '{}') into v_apps from public.tenant_applications a where a.tenant_id = p_tenant_id and a.lead_id = any(v_leads);
  select coalesce(array_agg(distinct k.id), '{}') into v_cases from public.tenant_application_cases k where k.tenant_id = p_tenant_id and k.lead_id = any(v_leads);
  select coalesce(jsonb_agg(distinct jsonb_build_object('carrier_id', pc.carrier_id, 'policy_number', pc.policy_number)), '[]'::jsonb) into v_policies
    from public.policy_current pc where pc.tenant_id = p_tenant_id and (pc.contact_id = any(v_contacts) or pc.application_id = any(v_apps));
  select coalesce(array_agg(distinct s.raw_row_id), '{}') into v_raw
    from public.policy_snapshot s
    join jsonb_array_elements(v_policies) p on (p->>'carrier_id')::uuid = s.carrier_id and p->>'policy_number' = s.policy_number
   where s.tenant_id = p_tenant_id and s.raw_row_id is not null;
  select v_raw || coalesce(array_agg(distinct ce.raw_row_id) filter (where ce.raw_row_id is not null), '{}') into v_raw
    from public.commission_entry ce
    join jsonb_array_elements(v_policies) p on (p->>'carrier_id')::uuid = ce.carrier_id and p->>'policy_number' = ce.policy_number
   where ce.tenant_id = p_tenant_id;

  -- What identifies them, for erasing it from documents (names, emails, addresses; numbers and dates as digits).
  select coalesce(array_agg(distinct t) filter (where t is not null and length(t) >= 2), '{}') into v_tokens from (
    select lower(btrim(c.first_name)) t from public.contacts c where c.id = any(v_contacts)
    union select lower(btrim(c.last_name)) from public.contacts c where c.id = any(v_contacts)
    union select lower(btrim(c.first_name || ' ' || c.last_name)) from public.contacts c where c.id = any(v_contacts)
    union select lower(btrim(c.last_name || ', ' || c.first_name)) from public.contacts c where c.id = any(v_contacts)
    union select lower(btrim(c.last_name || ' ' || c.first_name)) from public.contacts c where c.id = any(v_contacts)
    union select lower(btrim(c.address_line1)) from public.contacts c where c.id = any(v_contacts) and length(btrim(c.address_line1)) >= 6
    union select lower(btrim(l.values->>k)) from public.agent_leads l, unnest(array['first_name', 'last_name', 'full_name', 'name', 'address', 'address_line1']) k where l.id = any(v_leads)
    union select lower(btrim(coalesce(l.values->>'first_name', '') || ' ' || coalesce(l.values->>'last_name', ''))) from public.agent_leads l where l.id = any(v_leads)
    union select lower(btrim(coalesce(l.values->>'last_name', '') || ', ' || coalesce(l.values->>'first_name', ''))) from public.agent_leads l where l.id = any(v_leads)
    union select e from unnest(v_emails) e
  ) x;
  select coalesce(array_agg(distinct d) filter (where d is not null and length(d) >= 6), '{}') into v_digits from (
    select p d from unnest(v_phones) p
    union select '1' || p from unnest(v_phones) p
    union select to_char(dob, f) from (
      select c.dob from public.contacts c where c.id = any(v_contacts) and c.dob is not null
      union select (l.values->>k)::date from public.agent_leads l, unnest(array['dob', 'date_of_birth']) k
       where l.id = any(v_leads) and l.values->>k ~ '^\d{4}-\d{2}-\d{2}$'
    ) dobs, unnest(array['YYYYMMDD', 'MMDDYYYY', 'FMMMFMDDYYYY']) f
  ) y;

  return jsonb_build_object(
    'phones', to_jsonb(coalesce(v_phones, '{}')), 'emails', to_jsonb(coalesce(v_emails, '{}')), 'contact_ids', to_jsonb(v_contacts),
    'lead_ids', to_jsonb(v_leads), 'application_ids', to_jsonb(v_apps), 'case_ids', to_jsonb(v_cases), 'policies', v_policies,
    'raw_row_ids', to_jsonb(coalesce(v_raw, '{}')), 'tokens', to_jsonb(coalesce(v_tokens, '{}')), 'digits', to_jsonb(coalesce(v_digits, '{}')));
end $$;
revoke all on function public.data_subject_discover(uuid, text, text, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.data_subject_discover(uuid, text, text, uuid) to service_role;

-- ─── the purge, one group at a time ─────────────────────────────────────────────────────────────
create or replace function public.data_subject_purge_group(p_request_id uuid, p_group text, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r public.deletion_request%rowtype;
  s jsonb;
  t uuid;
  v_phones text[];
  v_emails text[];
  v_contacts uuid[];
  v_leads uuid[];
  v_apps uuid[];
  v_cases uuid[];
  v_raw uuid[];
  v_tokens text[];
  v_digits text[];
  v_out jsonb := '{}'::jsonb;
  v_held boolean;
  n integer;
  p text;
begin
  select * into r from public.deletion_request where id = p_request_id for update;
  if not found then
    raise exception 'data_subject_purge_group: no such request';
  end if;
  if r.status <> 'scheduled' or r.scheduled_purge_at > now() then
    raise exception 'data_subject_purge_group: the request is not due (status %, due %)', r.status, r.scheduled_purge_at using errcode = 'check_violation';
  end if;
  if r.subject_json is null then
    raise exception 'data_subject_purge_group: discover the person first';
  end if;
  if p_group = any(r.groups_done) then
    return coalesce(r.results_json->p_group, '{}'::jsonb);
  end if;
  s := r.subject_json;
  t := r.tenant_id;
  v_phones := array(select jsonb_array_elements_text(s->'phones'));
  v_emails := array(select jsonb_array_elements_text(s->'emails'));
  v_contacts := array(select jsonb_array_elements_text(s->'contact_ids')::uuid);
  v_leads := array(select jsonb_array_elements_text(s->'lead_ids')::uuid);
  v_apps := array(select jsonb_array_elements_text(s->'application_ids')::uuid);
  v_cases := array(select jsonb_array_elements_text(s->'case_ids')::uuid);
  v_raw := array(select jsonb_array_elements_text(s->'raw_row_ids')::uuid);
  v_tokens := array(select jsonb_array_elements_text(s->'tokens'));
  v_digits := array(select jsonb_array_elements_text(s->'digits'));
  -- A legal hold beats a deletion request too (LA-6.6): nothing under a hold is purged by anything.
  if to_regclass('public.legal_hold') is not null then
    execute 'select exists (select 1 from public.legal_hold h where h.tenant_id = $1 and h.released_at is null
               and (h.scope = ''tenant_wide'' or (h.scope = ''phone_digits'' and h.scope_value = any($2))
                    or (h.scope = ''contact_id'' and h.scope_value = any($3))
                    or (h.scope = ''policy_number'' and h.scope_value = any($4))))'
      into v_held using t, v_phones, array(select x::text from unnest(v_contacts) x), array(select pol->>'policy_number' from jsonb_array_elements(s->'policies') pol);
    if v_held then
      raise exception 'data_subject_purge_group: this person''s records are under a legal hold; the deletion waits until it is released' using errcode = 'check_violation';
    end if;
  end if;
  perform set_config('app.data_subject_deletion', p_request_id::text, true);

  if p_group = 'dnc' then
    -- Never deleted. Every number is (or now goes) on the internal list, reduced to number + reason.
    foreach p in array v_phones loop
      perform public.suppress_phone(t, p, 'internal', 'Retained under a deletion request: do not contact', 'manual', p_actor);
    end loop;
    with u as (update public.tenant_do_not_call set reason = 'Retained under a deletion request: do not contact', lead_id = null
                where tenant_id = t and phone_digits = any(v_phones) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('tenant_do_not_call', jsonb_build_object('kept', n, 'reason', 'Kept so the number is never called again; reduced to the number and a reason.'));
    select count(*) into n from public.tenant_suppression_list where tenant_id = t and phone_digits = any(v_phones);
    v_out := v_out || jsonb_build_object('tenant_suppression_list', jsonb_build_object('kept', n, 'reason', 'Federal, state and litigator listings of the number; kept so it is never called.'));

  elsif p_group = 'activity' then
    with d as (delete from public.tenant_appointment_reminder_events e using public.tenant_appointments a
                where e.appointment_id = a.id and a.tenant_id = t and a.lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_appointment_reminder_events', jsonb_build_object('purged', n));
    with d as (delete from public.tenant_appointments where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_appointments', jsonb_build_object('purged', n));
    with d as (delete from public.tenant_callbacks where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_callbacks', jsonb_build_object('purged', n));
    with d as (delete from public.callbacks where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('callbacks', jsonb_build_object('purged', n));
    with d as (delete from public.callback_history where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('callback_history', jsonb_build_object('purged', n));
    with d as (delete from public.tenant_lead_activity where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_lead_activity', jsonb_build_object('purged', n));
    with d as (delete from public.tenant_dial_dnc_checks where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_dial_dnc_checks', jsonb_build_object('purged', n));
    with d as (delete from public.tenant_call_attempts where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_call_attempts', jsonb_build_object('purged', n));
    with d as (delete from public.active_calls where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('active_calls', jsonb_build_object('purged', n));
    with d as (delete from public.disposition_walks where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('disposition_walks', jsonb_build_object('purged', n));
    with d as (delete from public.tenant_lead_notes where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_lead_notes', jsonb_build_object('purged', n));
    with d as (delete from public.lead_notes where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('lead_notes', jsonb_build_object('purged', n));
    with d as (delete from public.lead_note_edits where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('lead_note_edits', jsonb_build_object('purged', n));
    with d as (delete from public.lead_notifications where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('lead_notifications', jsonb_build_object('purged', n));
    with d as (delete from public.tenant_lead_sla_events where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_lead_sla_events', jsonb_build_object('purged', n));
    with d as (delete from public.lead_sla_events where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('lead_sla_events', jsonb_build_object('purged', n));
    with d as (delete from public.tenant_lead_stage_events where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_lead_stage_events', jsonb_build_object('purged', n));
    with d as (delete from public.tenant_nurture_reactivations where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_nurture_reactivations', jsonb_build_object('purged', n));
    with d as (delete from public.tenant_scoring_decisions where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_scoring_decisions', jsonb_build_object('purged', n));
    with d as (delete from public.tenant_lead_signature_readiness where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_lead_signature_readiness', jsonb_build_object('purged', n));
    with d as (delete from public.intake_failures where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('intake_failures', jsonb_build_object('purged', n));
    with d as (delete from public.lead_assignment_events where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('lead_assignment_events', jsonb_build_object('purged', n));

  elsif p_group = 'checks' then
    with d as (delete from public.tenant_consent_artefacts where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_consent_artefacts', jsonb_build_object('purged', n));
    -- LA-2.6's exemptions (20260925709700) are purged when that file is live.
    if to_regclass('public.tenant_dnc_exemption_uses') is not null then
      execute 'with d as (delete from public.tenant_dnc_exemption_uses where tenant_id = $1 and (phone_digits = any($2) or lead_id = any($3)) returning 1) select count(*) from d'
        into n using t, v_phones, v_leads;
      v_out := v_out || jsonb_build_object('tenant_dnc_exemption_uses', jsonb_build_object('purged', n));
    end if;
    if to_regclass('public.tenant_dnc_exemptions') is not null then
      execute 'with d as (delete from public.tenant_dnc_exemptions where tenant_id = $1 and phone_digits = any($2) returning 1) select count(*) from d'
        into n using t, v_phones;
      v_out := v_out || jsonb_build_object('tenant_dnc_exemptions', jsonb_build_object('purged', n));
    end if;
    with d as (delete from public.tenant_lead_post_log where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_lead_post_log', jsonb_build_object('purged', n));
    with d as (delete from public.lead_income where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('lead_income', jsonb_build_object('purged', n));
    with d as (delete from public.screening_results where tenant_id = t and phone_digits = any(v_phones) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('screening_results', jsonb_build_object('purged', n, 'reason', 'A 24-hour cache of vendor answers.'));
    with d as (delete from public.screening_cache_locks where tenant_id = t and phone_digits = any(v_phones) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('screening_cache_locks', jsonb_build_object('purged', n));
    with u as (update public.screening_audit set phone_digits = null, raw_response = '{}'::jsonb, lead_id = null
                where tenant_id = t and (phone_digits = any(v_phones) or lead_id = any(v_leads)) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('screening_audit', jsonb_build_object('anonymised', n, 'reason', 'Kept without the number: partner quality counts each screen.'));
    with u as (update public.tenant_campaign_scrub_rejections set phone_digits = '0000000000', detail = null, source_key = null
                where tenant_id = t and phone_digits = any(v_phones) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('tenant_campaign_scrub_rejections', jsonb_build_object('anonymised', n, 'reason', 'Kept without the number: vendor credits count each rejected row.'));
    with u as (update public.transfer_verdict set phone_digits = null, lead_id = null
                where tenant_id = t and (phone_digits = any(v_phones) or lead_id = any(v_leads)) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('transfer_verdict', jsonb_build_object('anonymised', n, 'reason', 'Kept without the number: partner quality counts each verdict.'));
    with u as (update public.lead_claim_items set evidence = public.erase_matching_values(evidence, v_tokens, v_digits)
                where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('lead_claim_items', jsonb_build_object('anonymised', n, 'reason', 'Vendor credit claims stay so vendor cost reporting reconciles.'));

  elsif p_group = 'applications' then
    with d as (delete from public.tenant_uw_interviews where tenant_id = t and case_id = any(v_cases) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_uw_interviews', jsonb_build_object('purged', n, 'note', 'with their answers, answer history and medications'));
    with d as (delete from public.tenant_verification_sessions where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_verification_sessions', jsonb_build_object('purged', n, 'note', 'with their verified fields and changes'));
    with d as (delete from public.verification_sessions where tenant_id = t and lead_id = any(v_leads) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('verification_sessions', jsonb_build_object('purged', n, 'note', 'with their items and audit'));
    with d as (delete from public.tenant_application_values where tenant_id = t and application_id = any(v_apps) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_application_values', jsonb_build_object('purged', n));
    with d as (delete from public.tenant_application_beneficiaries where tenant_id = t and application_id = any(v_apps) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_application_beneficiaries', jsonb_build_object('purged', n));
    with d as (delete from public.tenant_application_payment_methods where tenant_id = t and application_id = any(v_apps) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('tenant_application_payment_methods', jsonb_build_object('purged', n));
    with u as (update public.tenant_application_counteroffers set client_response_note = null where tenant_id = t and application_id = any(v_apps) and client_response_note is not null returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('tenant_application_counteroffers', jsonb_build_object('anonymised', n));
    with u as (update public.tenant_welcome_packs set recipient_email = null where tenant_id = t and application_id = any(v_apps) and recipient_email is not null returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('tenant_welcome_packs', jsonb_build_object('anonymised', n));
    with u as (update public.tenant_applications set outcome_reason_text = null where tenant_id = t and id = any(v_apps) and outcome_reason_text is not null returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('tenant_applications', jsonb_build_object('anonymised', n, 'reason', 'The application row stays (carrier, product, status, dates): it is part of the policy record.'));
    with u as (update public.tenant_quotes set rating_inputs = '{}'::jsonb where tenant_id = t and lead_id = any(v_leads) and rating_inputs <> '{}'::jsonb returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('tenant_quotes', jsonb_build_object('anonymised', n));

  elsif p_group = 'leads' then
    with u as (update public.agent_leads set values = jsonb_build_object('_erased', p_request_id), contact_id = null
                where tenant_id = t and id = any(v_leads) and values is distinct from jsonb_build_object('_erased', p_request_id) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('agent_leads', jsonb_build_object('anonymised', n, 'reason', 'Kept without the person so vendor cost reporting still reconciles.'));
    with u as (update public.deal_flow set insured_name = null, phone = null, notes = null
                where tenant_id = t and lead_id = any(v_leads) and (insured_name is not null or phone is not null or notes is not null) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('deal_flow', jsonb_build_object('anonymised', n, 'reason', 'Kept without the person: sales and cost figures still reconcile.'));
    with u as (update public.form_drafts set payload = public.erase_matching_values(payload, v_tokens, v_digits)
                where tenant_id = t and payload is distinct from public.erase_matching_values(payload, v_tokens, v_digits) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('form_drafts', jsonb_build_object('anonymised', n));
    with u as (update public.partner_messages set card_payload = public.erase_matching_values(card_payload, v_tokens, v_digits)
                where tenant_id = t and card_payload is not null and card_payload is distinct from public.erase_matching_values(card_payload, v_tokens, v_digits) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('partner_messages', jsonb_build_object('anonymised', n));

  elsif p_group = 'clients' then
    with d as (delete from public.contact_phones where contact_id = any(v_contacts) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('contact_phones', jsonb_build_object('purged', n));
    with d as (delete from public.contact_emails where contact_id = any(v_contacts) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('contact_emails', jsonb_build_object('purged', n));
    with d as (delete from public.contact_income where tenant_id = t and contact_id = any(v_contacts) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('contact_income', jsonb_build_object('purged', n));
    with d as (delete from public.queue_item where tenant_id = t and (contact_id = any(v_contacts) or related_contact_id = any(v_contacts)) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('queue_item', jsonb_build_object('purged', n));
    with d as (delete from public.contact_duplicate_reviews where tenant_id = t and (contact_id = any(v_contacts) or candidate_id = any(v_contacts)) returning 1) select count(*) into n from d;
    v_out := v_out || jsonb_build_object('contact_duplicate_reviews', jsonb_build_object('purged', n));
    with u as (update public.household_claim_followup set note = null where tenant_id = t and contact_id = any(v_contacts) and note is not null returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('household_claim_followup', jsonb_build_object('anonymised', n));
    with u as (update public.contacts set first_name = '[erased]', last_name = '[erased]', dob = null, primary_phone = null, address_line1 = null, city = null,
                      postal_code = null, custom_fields = '{}'::jsonb, name_search = '', provisional_source = null
                where tenant_id = t and id = any(v_contacts) and first_name is distinct from '[erased]' returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('contacts', jsonb_build_object('anonymised', n, 'reason', 'The client row stays (no name, number, birth date or address) so policies and commissions still reconcile.'));
    with u as (update public.households h set address_line1 = null, address_search = '', address_hash = 'erased:' || h.id
                where h.tenant_id = t and h.id in (select c.household_id from public.contacts c where c.id = any(v_contacts) and c.household_id is not null)
                  and not exists (select 1 from public.contacts o where o.household_id = h.id and not (o.id = any(v_contacts)))
                  and h.address_line1 is not null returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('households', jsonb_build_object('anonymised', n, 'note', 'only a household with nobody else in it'));
    with u as (update public.raw_rows set payload = public.erase_matching_values(payload, v_tokens, v_digits)
                where tenant_id = t and id = any(v_raw) and payload is distinct from public.erase_matching_values(payload, v_tokens, v_digits) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('raw_rows', jsonb_build_object('anonymised', n, 'reason', 'Carrier rows behind the policies: kept for the financial record, the person''s identifiers erased.'));
    with u as (update public.policy_snapshot set extra = public.erase_matching_values(extra, v_tokens, v_digits)
                where tenant_id = t and raw_row_id = any(v_raw) and extra is distinct from public.erase_matching_values(extra, v_tokens, v_digits) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('policy_snapshot', jsonb_build_object('anonymised', n, 'reason', 'Policy history: kept, the person''s identifiers erased.'));
    with u as (update public.policy_current set extra = public.erase_matching_values(extra, v_tokens, v_digits)
                where tenant_id = t and (contact_id = any(v_contacts) or application_id = any(v_apps)) and extra is distinct from public.erase_matching_values(extra, v_tokens, v_digits) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('policy_current', jsonb_build_object('anonymised', n, 'reason', 'Policy and commission records are a financial and tax record: kept, anonymised.'));
    with u as (update public.tenant_commission_statement_lines set raw = public.erase_matching_values(raw, v_tokens, v_digits),
                      insured_name = case when lower(btrim(insured_name)) = any(v_tokens) then '[erased]' else insured_name end
                where tenant_id = t and (raw is distinct from public.erase_matching_values(raw, v_tokens, v_digits) or lower(btrim(insured_name)) = any(v_tokens)) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('tenant_commission_statement_lines', jsonb_build_object('anonymised', n, 'reason', 'Commission statements: kept, anonymised.'));
    with u as (update public.tenant_policies set insured_name = '[erased]' where tenant_id = t and lower(btrim(insured_name)) = any(v_tokens) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('tenant_policies', jsonb_build_object('anonymised', n, 'reason', 'Hand-entered policies: kept, anonymised.'));
    with u as (update public.agent_findings set payload = public.erase_matching_values(payload, v_tokens, v_digits)
                where tenant_id = t and payload is distinct from public.erase_matching_values(payload, v_tokens, v_digits) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('agent_findings', jsonb_build_object('anonymised', n));

  elsif p_group = 'records' then
    with u as (update public.complaint set complainant_name = null, phone_digits = null, contact_id = null, policy_number = null,
                      summary = 'Erased under a deletion request.', response_text = case when response_text is null then null else 'Erased under a deletion request.' end,
                      attachments_json = '[]'::jsonb, response_attachments_json = '[]'::jsonb, notes = null
                where tenant_id = t and (phone_digits = any(v_phones) or contact_id = any(v_contacts)) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('complaint', jsonb_build_object('anonymised', n, 'reason', 'The regulatory record of a complaint and its outcome is kept, without the person.'));
    with u as (update public.compliance_report_log set scope_value = '[erased]'
                where tenant_id = t and scope_value is not null and (scope_value = any(v_phones) or scope_value = any(array(select x::text from unnest(v_leads || v_contacts) x))) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('compliance_report_log', jsonb_build_object('anonymised', n, 'reason', 'Who generated which report is kept; the number is not.'));
    with u as (update public.email_log set to_address = '[erased]' where lower(to_address) = any(v_emails) returning 1) select count(*) into n from u;
    v_out := v_out || jsonb_build_object('email_log', jsonb_build_object('anonymised', n));
    -- Anything the triggers left: pointers to rows now gone are removed by reconciling.
    perform public.compliance_index_reconcile(t, 'manual');
  else
    raise exception 'data_subject_purge_group: unknown group %', p_group;
  end if;

  update public.deletion_request
     set results_json = results_json || jsonb_build_object(p_group, v_out), groups_done = groups_done || p_group
   where id = p_request_id;
  insert into public.deletion_request_event (request_id, tenant_id, actor_user_id, action, detail)
  values (p_request_id, t, p_actor, 'purged:' || p_group, v_out);
  -- The guards' exception ends with this group: nothing else in the transaction may use it.
  perform set_config('app.data_subject_deletion', '', true);
  return v_out;
end $$;
revoke all on function public.data_subject_purge_group(uuid, text, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.data_subject_purge_group(uuid, text, uuid) to service_role;

-- ─── self-check ─────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v jsonb;
begin
  v := public.erase_matching_values('{"INSUREDNAME":"Jane Q Doe","PHONE1":"(817) 555-0142","BIRTHDATE":"3/7/1951","POLICYNUMBER":"AB123","PREMIUM":"45.10","CITY":"Austin","nested":[{"email":"JANE@EXAMPLE.TEST"}]}'::jsonb,
                                    array['jane q doe', 'jane@example.test', 'doe'], array['8175550142', '371951', '03071951']);
  if v->>'INSUREDNAME' <> '[erased]' or v->>'PHONE1' <> '[erased]' or v->>'BIRTHDATE' <> '[erased]' or v->'nested'->0->>'email' <> '[erased]'
     or v->>'POLICYNUMBER' <> 'AB123' or v->>'PREMIUM' <> '45.10' or v->>'CITY' <> 'Austin' then
    raise exception '20261015140000: erase_matching_values is wrong: %', v;
  end if;
  if has_table_privilege('service_role', 'public.deletion_request_event', 'DELETE') or has_table_privilege('service_role', 'public.deletion_request', 'DELETE') then
    raise exception '20261015140000: the deletion audit trail must not be removable';
  end if;
  -- The do-not-call list is still undeletable after this file.
  if not exists (select 1 from pg_trigger where tgname = 'tenant_do_not_call_permanent' and tgrelid = 'public.tenant_do_not_call'::regclass) then
    raise exception '20261015140000: the permanent do-not-call guard is missing';
  end if;
end $$;
