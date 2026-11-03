-- LA-5.4 (Notion sprint, Module 5 — Retention) · servicing requests, verified by the next file.
--
-- A change the agent asks the carrier for — the draft day, the payment method or account, a mailed
-- bill turned into a bank draft, the address — tracked from the moment it is asked for until the next
-- carrier file PROVES it happened:
--
--   draft → submitted → awaiting_carrier → confirmed_by_carrier → verified_in_file
--                                                   (or failed / cancelled)
--
--   confirmed_by_carrier is what a person was told. verified_in_file is what actually happened. Only
--   verify_servicing_requests can set verified_in_file or failed — never the agent, never the app —
--   and it does so from policy_snapshot (LA-4.6): every field change's "to" must be what the latest
--   file shows. A change still not in the file past expected_effective_date + the agency's grace is
--   FAILED, loudly: an alert to whoever asked, and the policy goes back on the save queue with the
--   reason, because a policy believed fixed that isn't is worse than one never tried.
--
--   A field the carrier's file does not carry (most files have no draft day; Aetna/Aflac/AHL send
--   DRAFTDAY) cannot be proven: the request says so (unprovable_fields) and waits, never "verified"
--   on anyone's word and never "failed" for a file that could not have shown it.
--
--   carrier_servicing_guide   per carrier and request type: how it is done (portal, phone, form,
--                             email), where, what the carrier asks for, whether the client must
--                             authorise. Platform content, edited by staff in the admin console.
--
-- Also: retention_settings.servicing_grace_days (LA-5.11, default 10), and save_attempt's link to the
-- request a fix started now references servicing_request.
--
-- Beneficiary, coverage and cancellation requests are out of scope (not save actions).
--
-- Additive. Requires 20261014100000 (save_attempt, retention_settings) and 20261008140000 (policy_snapshot).
--
-- Rollback:
--   select cron.unschedule('la5-servicing-verify-daily');
--   alter table public.save_attempt drop constraint if exists save_attempt_servicing_fk;
--   drop function if exists public.verify_servicing_requests(uuid, uuid);
--   drop table if exists public.servicing_request, public.carrier_servicing_guide;
--   drop function if exists public.servicing_request_guard();
--   alter table public.retention_settings drop column if exists servicing_grace_days;

alter table public.retention_settings add column if not exists servicing_grace_days smallint not null default 10;
alter table public.retention_settings drop constraint if exists retention_settings_servicing_grace;
alter table public.retention_settings add constraint retention_settings_servicing_grace check (servicing_grace_days between 0 and 90);

create table if not exists public.servicing_request (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agency_id uuid,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  policy_number text not null,
  contact_id uuid references public.contacts(id) on delete set null,
  request_type text not null,
  origin text not null,
  save_attempt_id uuid references public.save_attempt(id) on delete restrict,

  -- what is changing: [{field, from, to}]
  field_changes_json jsonb not null,
  target_draft_day smallint,
  target_draft_reason text,

  -- how it is being done
  carrier_method text,
  carrier_form_ref text,
  carrier_reference text,

  status text not null default 'draft',
  submitted_at timestamptz,
  carrier_confirmed_at timestamptz,
  expected_effective_date date,
  verified_at timestamptz,
  verified_snapshot_date date,
  failed_at timestamptz,
  failure_reason text,
  cancelled_at timestamptz,
  -- the file last compared, and the fields it could not show
  checked_snapshot_date date,
  unprovable_fields jsonb not null default '[]'::jsonb,

  requested_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  note text,

  constraint servicing_request_type check (request_type in ('draft_date_change', 'payment_method_change', 'bill_to_draft_conversion', 'address_change')),
  constraint servicing_request_origin check (origin in ('save_queue', 'retention_board', 'client_request', 'campaign')),
  constraint servicing_request_status check (status in ('draft', 'submitted', 'awaiting_carrier', 'confirmed_by_carrier', 'verified_in_file', 'failed', 'cancelled')),
  constraint servicing_request_method check (carrier_method is null or carrier_method in ('portal', 'phone', 'form', 'email')),
  constraint servicing_request_changes check (jsonb_typeof(field_changes_json) = 'array' and jsonb_array_length(field_changes_json) between 1 and 6),
  constraint servicing_request_unprovable check (jsonb_typeof(unprovable_fields) = 'array'),
  -- Never above the 28th (LA-3.9's rule: carriers reject 29–31 and February breaks them).
  constraint servicing_request_draft_day check (target_draft_day is null or target_draft_day between 1 and 28),
  constraint servicing_request_draft_needs_day check (request_type <> 'draft_date_change' or target_draft_day is not null),
  constraint servicing_request_sent check (status in ('draft', 'cancelled') or submitted_at is not null),
  constraint servicing_request_confirmed check (status <> 'confirmed_by_carrier' or carrier_confirmed_at is not null),
  constraint servicing_request_verified check ((status = 'verified_in_file') = (verified_at is not null and verified_snapshot_date is not null)),
  constraint servicing_request_failed check ((status = 'failed') = (failed_at is not null and failure_reason is not null)),
  constraint servicing_request_cancelled check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint servicing_request_lengths check (
    (note is null or char_length(note) <= 2000) and (carrier_reference is null or char_length(carrier_reference) <= 120)
    and (carrier_form_ref is null or char_length(carrier_form_ref) <= 200) and (failure_reason is null or char_length(failure_reason) <= 500)
    and (target_draft_reason is null or char_length(target_draft_reason) <= 500)
  )
);
-- One open request per policy and kind of change.
create unique index if not exists servicing_request_one_open_idx on public.servicing_request (tenant_id, carrier_id, policy_number, request_type)
  where status in ('draft', 'submitted', 'awaiting_carrier', 'confirmed_by_carrier');
create index if not exists servicing_request_open_idx on public.servicing_request (tenant_id, status) where status in ('submitted', 'awaiting_carrier', 'confirmed_by_carrier');
create index if not exists servicing_request_policy_idx on public.servicing_request (tenant_id, carrier_id, policy_number, created_at desc);
create index if not exists servicing_request_recent_idx on public.servicing_request (tenant_id, created_at desc);
create index if not exists servicing_request_carrier_idx on public.servicing_request (carrier_id);
create index if not exists servicing_request_contact_idx on public.servicing_request (contact_id) where contact_id is not null;
create index if not exists servicing_request_attempt_idx on public.servicing_request (save_attempt_id) where save_attempt_id is not null;
create index if not exists servicing_request_by_idx on public.servicing_request (requested_by) where requested_by is not null;

-- The ladder, enforced. What a person was told moves forward by hand; what the file proves only by
-- verify_servicing_requests (which sets app.servicing_verifier for its own transaction).
create or replace function public.servicing_request_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_verifier boolean := coalesce(current_setting('app.servicing_verifier', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    raise exception 'A servicing request is never removed; cancel it.' using errcode = 'P0001';
  end if;
  if (new.tenant_id, new.carrier_id, new.policy_number, new.request_type, new.origin, new.save_attempt_id, new.requested_by, new.created_at)
     is distinct from (old.tenant_id, old.carrier_id, old.policy_number, old.request_type, old.origin, old.save_attempt_id, old.requested_by, old.created_at) then
    raise exception 'What a servicing request is for never changes; open another.' using errcode = 'P0001';
  end if;
  if old.status <> 'draft' and (new.field_changes_json, new.target_draft_day) is distinct from (old.field_changes_json, old.target_draft_day) then
    raise exception 'The change asked for is fixed once it is sent; cancel and open another.' using errcode = 'P0001';
  end if;
  if (new.verified_at, new.verified_snapshot_date, new.failed_at, new.failure_reason, new.unprovable_fields, new.checked_snapshot_date)
     is distinct from (old.verified_at, old.verified_snapshot_date, old.failed_at, old.failure_reason, old.unprovable_fields, old.checked_snapshot_date)
     and not v_verifier then
    raise exception 'Only the carrier file decides whether a change happened.' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status then
    if new.status in ('verified_in_file', 'failed') then
      if not v_verifier or old.status not in ('submitted', 'awaiting_carrier', 'confirmed_by_carrier') then
        raise exception 'Only the carrier file decides whether a change happened.' using errcode = 'P0001';
      end if;
    elsif not (
      (old.status = 'draft' and new.status in ('submitted', 'cancelled'))
      or (old.status = 'submitted' and new.status in ('awaiting_carrier', 'confirmed_by_carrier', 'cancelled'))
      or (old.status = 'awaiting_carrier' and new.status in ('confirmed_by_carrier', 'cancelled'))
      or (old.status = 'confirmed_by_carrier' and new.status = 'cancelled')
    ) then
      raise exception 'A servicing request cannot go from % to %.', old.status, new.status using errcode = 'P0001';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists servicing_request_guard on public.servicing_request;
create trigger servicing_request_guard before update or delete on public.servicing_request
  for each row execute function public.servicing_request_guard();

-- save_attempt's link to the request its fix started (set once, by 20261014100000's guard).
alter table public.save_attempt drop constraint if exists save_attempt_servicing_fk;
alter table public.save_attempt add constraint save_attempt_servicing_fk foreign key (servicing_request_id) references public.servicing_request(id) on delete restrict;
create index if not exists save_attempt_servicing_idx on public.save_attempt (servicing_request_id) where servicing_request_id is not null;

-- ─── per-carrier instructions (platform content) ────────────────────────────────────────────────
create table if not exists public.carrier_servicing_guide (
  carrier_id uuid not null references public.carriers(id) on delete cascade,
  request_type text not null,
  method text,
  where_to_do_it text,
  what_they_need text,
  client_must_authorise boolean,
  form_ref text,
  notes text,
  updated_by_admin uuid references public.admin_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (carrier_id, request_type),
  constraint carrier_servicing_guide_type check (request_type in ('draft_date_change', 'payment_method_change', 'bill_to_draft_conversion', 'address_change')),
  constraint carrier_servicing_guide_method check (method is null or method in ('portal', 'phone', 'form', 'email')),
  constraint carrier_servicing_guide_lengths check (
    (where_to_do_it is null or char_length(where_to_do_it) <= 1000) and (what_they_need is null or char_length(what_they_need) <= 1000)
    and (form_ref is null or char_length(form_ref) <= 200) and (notes is null or char_length(notes) <= 2000)
  ),
  constraint carrier_servicing_guide_has_content check (method is not null or coalesce(where_to_do_it, what_they_need, form_ref, notes) is not null or client_must_authorise is not null)
);
create index if not exists carrier_servicing_guide_updated_by_idx on public.carrier_servicing_guide (updated_by_admin) where updated_by_admin is not null;

-- ─── the proof ──────────────────────────────────────────────────────────────────────────────────
create or replace function public.verify_servicing_requests(p_tenant_id uuid default null, p_carrier_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  c jsonb;
  v_snap public.policy_snapshot%rowtype;
  v_grace integer;
  v_deadline date;
  v_field text;
  v_want text;
  v_have text;
  v_all_match boolean;
  v_unprovable jsonb;
  v_mismatch_field text;
  v_mismatch_have text;
  v_reason text;
  v_verified integer := 0;
  v_failed integer := 0;
  v_waiting integer := 0;
  v_unprovable_count integer := 0;
  v_policies jsonb := '[]'::jsonb;
begin
  perform set_config('app.servicing_verifier', 'on', true);
  for r in
    select q.* from public.servicing_request q
     where q.status in ('submitted', 'awaiting_carrier', 'confirmed_by_carrier')
       and (p_tenant_id is null or q.tenant_id = p_tenant_id)
       and (p_carrier_id is null or q.carrier_id = p_carrier_id)
     order by q.tenant_id, q.created_at
     for update
  loop
    -- The newest file for this policy dated on or after the request was sent.
    select s.* into v_snap from public.policy_snapshot s
     where s.tenant_id = r.tenant_id and s.carrier_id = r.carrier_id and s.policy_number = r.policy_number
       and not s.superseded and s.snapshot_date >= (r.submitted_at at time zone 'UTC')::date
     order by s.snapshot_date desc limit 1;
    if not found then
      v_waiting := v_waiting + 1;
      continue;
    end if;

    v_all_match := true;
    v_unprovable := '[]'::jsonb;
    v_mismatch_field := null;
    v_mismatch_have := null;
    for c in select * from jsonb_array_elements(r.field_changes_json) loop
      v_field := c->>'field';
      v_want := c->>'to';
      v_have := case when v_field = 'payment_method' then v_snap.payment_method else v_snap.extra->'fields'->>v_field end;
      if v_have is null then
        v_all_match := false;
        v_unprovable := v_unprovable || to_jsonb(v_field);
      elsif v_want is null then
        v_all_match := false;
      elsif (v_have ~ '^\d+(\.0+)?$' and v_want ~ '^\d+(\.0+)?$' and v_have::numeric = v_want::numeric)
         or lower(regexp_replace(btrim(v_have), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(v_want), '\s+', ' ', 'g')) then
        null;
      else
        v_all_match := false;
        if v_mismatch_field is null then
          v_mismatch_field := v_field;
          v_mismatch_have := v_have;
        end if;
      end if;
    end loop;

    if v_all_match then
      update public.servicing_request set status = 'verified_in_file', verified_at = now(), verified_snapshot_date = v_snap.snapshot_date,
             checked_snapshot_date = v_snap.snapshot_date, unprovable_fields = '[]'::jsonb
       where id = r.id;
      v_verified := v_verified + 1;
      v_policies := v_policies || jsonb_build_object('tenant_id', r.tenant_id, 'carrier_id', r.carrier_id, 'policy_number', r.policy_number);
      continue;
    end if;

    select coalesce((select rs.servicing_grace_days from public.retention_settings rs where rs.tenant_id = r.tenant_id), 10) into v_grace;
    v_deadline := coalesce(r.expected_effective_date, (r.submitted_at at time zone 'UTC')::date + 30) + v_grace;

    -- A field the file cannot show is never a failure: it waits, and says why.
    if v_mismatch_field is not null and current_date > v_deadline then
      v_reason := format('%s was %s on %s and the carrier file of %s still shows %s %s.',
        case r.request_type when 'draft_date_change' then 'The draft date change' when 'payment_method_change' then 'The payment change'
             when 'bill_to_draft_conversion' then 'The switch to bank draft' else 'The address change' end,
        case when r.carrier_confirmed_at is not null then 'confirmed by the carrier' else 'sent' end,
        to_char(coalesce(r.carrier_confirmed_at, r.submitted_at), 'FMDD Mon'),
        to_char(v_snap.snapshot_date, 'FMDD Mon'),
        case v_mismatch_field when 'draft_day' then 'draft day' when 'payment_method' then 'payment method' when 'insured_address' then 'the address'
             when 'insured_zip' then 'ZIP' when 'insured_state' then 'state' else replace(v_mismatch_field, '_', ' ') end,
        case when v_mismatch_field = 'payment_method' then replace(v_mismatch_have, '_', ' ') else v_mismatch_have end);
      update public.servicing_request set status = 'failed', failed_at = now(), failure_reason = left(v_reason, 500),
             checked_snapshot_date = v_snap.snapshot_date, unprovable_fields = v_unprovable
       where id = r.id;
      if r.requested_by is not null then
        insert into public.agent_notifications (tenant_id, recipient_user_id, kind, title, body, link, source_key)
        values (r.tenant_id, r.requested_by, 'servicing_failed', 'A fix did not take: ' || r.policy_number, left(v_reason, 1000), '/app/servicing?status=failed', 'servicing-failed:' || r.id)
        on conflict (tenant_id, recipient_user_id, source_key) do nothing;
      end if;
      v_failed := v_failed + 1;
    else
      update public.servicing_request set checked_snapshot_date = v_snap.snapshot_date, unprovable_fields = v_unprovable
       where id = r.id and (checked_snapshot_date is distinct from v_snap.snapshot_date or unprovable_fields is distinct from v_unprovable);
      if jsonb_array_length(v_unprovable) > 0 then v_unprovable_count := v_unprovable_count + 1; else v_waiting := v_waiting + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('verified', v_verified, 'failed', v_failed, 'waiting', v_waiting, 'unprovable', v_unprovable_count, 'verified_policies', v_policies);
end;
$$;

-- ─── access ─────────────────────────────────────────────────────────────────────────────────────
alter table public.servicing_request enable row level security;
drop policy if exists servicing_request_read on public.servicing_request;
create policy servicing_request_read on public.servicing_request for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.servicing_request from public, anon, authenticated;
grant select, insert, update on public.servicing_request to service_role;
revoke delete, truncate on public.servicing_request from service_role, tenant_app;
revoke insert, update on public.servicing_request from tenant_app;
grant select on public.servicing_request to tenant_app;

alter table public.carrier_servicing_guide enable row level security;
drop policy if exists carrier_servicing_guide_read on public.carrier_servicing_guide;
create policy carrier_servicing_guide_read on public.carrier_servicing_guide for select to tenant_app using (true);
revoke all on public.carrier_servicing_guide from public, anon, authenticated;
revoke truncate on public.carrier_servicing_guide from service_role, tenant_app;
grant select, insert, update, delete on public.carrier_servicing_guide to service_role;
grant select on public.carrier_servicing_guide to tenant_app;

revoke all on function public.verify_servicing_requests(uuid, uuid) from public, anon, authenticated;
grant execute on function public.verify_servicing_requests(uuid, uuid) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('la5-servicing-verify-daily', '30 7 * * *', $cron$select public.verify_servicing_requests()$cron$);
    exception when others then
      raise notice '20261014200000: the daily servicing check could not be scheduled (%).', sqlerrm;
    end;
  end if;
end $$;

-- ─── self-check ─────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v jsonb;
begin
  -- Run the job once, as cron will, and roll it back.
  begin
    v := public.verify_servicing_requests();
    if v ? 'verified' is not true then
      raise exception '20261014200000: the servicing check did not report';
    end if;
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  if has_table_privilege('service_role', 'public.servicing_request', 'DELETE') or has_table_privilege('tenant_app', 'public.servicing_request', 'UPDATE') then
    raise exception '20261014200000: servicing requests must not be removable (service_role delete=%, tenant_app update=%)',
      has_table_privilege('service_role', 'public.servicing_request', 'DELETE'), has_table_privilege('tenant_app', 'public.servicing_request', 'UPDATE');
  end if;
  if not exists (select 1 from information_schema.table_constraints where constraint_name = 'save_attempt_servicing_fk') then
    raise exception '20261014200000: save_attempt is not linked to servicing_request';
  end if;
end $$;
