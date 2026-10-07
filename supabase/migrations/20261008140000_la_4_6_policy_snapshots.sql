-- LA-4.6 (Notion sprint) · Layer 2: policy snapshots and the change log.
--
-- Every policy file a carrier sends becomes one snapshot per policy — that policy's state as the file
-- stated it, on the file's date. No carrier ever says "policy 4471982 lapsed today"; the lapse is the
-- difference between two files. So each policy's snapshots are compared in date order, whatever the
-- gap (a day or a month — the code never assumes "yesterday"), and every field that moved is one
-- policy_change row. A policy seen for the first time is a first-seen event, with no changes.
--
--   · policy_snapshot: immutable. A file's snapshots are rebuilt only from that file's raw rows (a
--     reprocess) through replace_file_snapshots; nothing edits one. A reissued file's snapshots become
--     the current ones for that day and the replaced file's are kept, marked superseded — and the
--     correction is a change like any other. Every snapshot carries its file and its raw row.
--   · policy_change and policy_event: derived. They can be thrown away and rebuilt from the snapshots
--     at any time (replace_policy_changes), per policy, which is how a back-dated file recomputes the
--     changes around it without touching any other policy.
--   · snapshot_date and both change dates are FILE dates, never the time the file was processed.
--
-- One snapshot per policy per agency, carrier and day (the spec's key, per agency: two agencies may
-- each receive a carrier file listing the same policy).
--
-- Additive. Requires 20261008100000–20261008130000.
--
-- Rollback:
--   drop function if exists public.replace_policy_changes(uuid, uuid, text[], jsonb, jsonb);
--   drop function if exists public.replace_file_snapshots(uuid, uuid, jsonb);
--   drop table if exists public.policy_event, public.policy_change, public.policy_snapshot;
--   alter table public.file_registry drop column if exists derived_at;

create table if not exists public.policy_snapshot (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agency_id uuid,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  policy_number text not null,
  snapshot_date date not null,
  file_id uuid not null references public.file_registry(id),
  raw_row_id uuid not null,
  carrier_status_raw text,
  status_normalized text,
  paid_to_date date,
  effective_date date,
  issue_date date,
  application_date date,
  termination_date date,
  premium_cents bigint,
  premium_mode text,
  payment_method text,
  face_amount_cents bigint,
  product_code text,
  product_tier text,
  agent_identifier text,
  extra jsonb not null default '{}'::jsonb,
  superseded boolean not null default false,
  content_hash text not null,
  created_at timestamptz not null default now(),
  constraint policy_snapshot_raw_row_fkey foreign key (file_id, raw_row_id) references public.raw_rows(file_id, id),
  constraint policy_snapshot_one_per_file unique (file_id, policy_number),
  constraint policy_snapshot_policy check (char_length(policy_number) between 1 and 120),
  constraint policy_snapshot_status check (status_normalized is null or status_normalized in ('submitted', 'declined', 'withdrawn', 'approved_unpaid', 'not_taken', 'active', 'at_risk', 'lapsed', 'paid_up')),
  constraint policy_snapshot_mode check (premium_mode is null or premium_mode in ('monthly', 'quarterly', 'semiannual', 'annual')),
  constraint policy_snapshot_payment check (payment_method is null or payment_method in ('bank_draft', 'direct_express', 'card', 'direct_bill')),
  constraint policy_snapshot_extra check (jsonb_typeof(extra) = 'object'),
  constraint policy_snapshot_hash check (content_hash ~ '^[0-9a-f]{64}$')
);
-- The spec's guarantee: one current snapshot per policy per file date (per agency and carrier).
create unique index if not exists policy_snapshot_one_per_day
  on public.policy_snapshot (tenant_id, carrier_id, policy_number, snapshot_date)
  where not superseded;
create index if not exists policy_snapshot_policy_idx on public.policy_snapshot (tenant_id, carrier_id, policy_number, snapshot_date);
create index if not exists policy_snapshot_carrier_idx on public.policy_snapshot (carrier_id);

-- Nothing edits a snapshot. The one move allowed is being marked superseded by a reissued file.
create or replace function public.policy_snapshot_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (to_jsonb(new) - 'superseded') is distinct from (to_jsonb(old) - 'superseded') or (old.superseded and not new.superseded) then
    raise exception 'A policy snapshot is never edited; it is rebuilt from its file''s raw rows.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists policy_snapshot_guard on public.policy_snapshot;
create trigger policy_snapshot_guard before update on public.policy_snapshot
  for each row execute function public.policy_snapshot_guard();

create table if not exists public.policy_change (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  policy_number text not null,
  field_name text not null,
  old_value text,
  new_value text,
  from_snapshot_date date not null,
  to_snapshot_date date not null,
  from_file_id uuid not null references public.file_registry(id),
  to_file_id uuid not null references public.file_registry(id),
  detected_at timestamptz not null default now(),
  constraint policy_change_field check (field_name in ('status_normalized', 'carrier_status_raw', 'paid_to_date', 'premium_cents', 'premium_mode', 'payment_method', 'face_amount_cents', 'product_code', 'product_tier', 'termination_date', 'agent_identifier')),
  constraint policy_change_dates check (from_snapshot_date <= to_snapshot_date),
  constraint policy_change_moved check (old_value is distinct from new_value)
);
create index if not exists policy_change_policy_idx on public.policy_change (tenant_id, carrier_id, policy_number, to_snapshot_date);
create index if not exists policy_change_recent_idx on public.policy_change (tenant_id, to_snapshot_date desc);
create index if not exists policy_change_from_file_idx on public.policy_change (from_file_id);
create index if not exists policy_change_to_file_idx on public.policy_change (to_file_id);
create index if not exists policy_change_carrier_idx on public.policy_change (carrier_id);

create table if not exists public.policy_event (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  policy_number text not null,
  event_type text not null,
  snapshot_date date not null,
  file_id uuid not null references public.file_registry(id),
  detected_at timestamptz not null default now(),
  constraint policy_event_type check (event_type in ('first_seen')),
  constraint policy_event_once unique (tenant_id, carrier_id, policy_number, event_type)
);
create index if not exists policy_event_file_idx on public.policy_event (file_id);
create index if not exists policy_event_carrier_idx on public.policy_event (carrier_id);

-- When a parsed file's derived layers were last written. A policy file parsed but not yet derived
-- (a stage failed half way) is picked up again by the sweep.
alter table public.file_registry add column if not exists derived_at timestamptz;

-- ─── writing Layer 2: only through these two functions ─────────────────────────────────────────

-- Replaces one file's snapshots with the ones built from its raw rows. Returns how many snapshots
-- changed (by content) and every policy whose history the caller must recompute.
create or replace function public.replace_file_snapshots(p_tenant_id uuid, p_file_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_file public.file_registry%rowtype;
  v_superseded boolean;
  v_changed integer;
  v_policies text[];
begin
  select * into v_file from public.file_registry where id = p_file_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'That file is not in this workspace.' using errcode = 'P0002'; end if;
  if v_file.file_type <> 'policies' or v_file.raw_extracted_at is null or v_file.carrier_id is null or v_file.file_date is null then
    raise exception 'Snapshots come from a policy file whose raw rows are sealed.' using errcode = 'P0001';
  end if;
  v_superseded := v_file.superseded_by_file_id is not null;

  -- A reissue: the replaced file's snapshots for that day stop being the current ones.
  update public.policy_snapshot s set superseded = true
   where s.tenant_id = p_tenant_id and s.carrier_id = v_file.carrier_id and s.snapshot_date = v_file.file_date and not s.superseded
     and s.file_id in (select f.id from public.file_registry f where f.tenant_id = p_tenant_id and f.carrier_id = v_file.carrier_id
                        and f.file_type = 'policies' and f.file_date = v_file.file_date and f.superseded_by_file_id is not null);

  create temp table if not exists pg_temp.la46_old (policy_number text, content_hash text) on commit drop;
  truncate pg_temp.la46_old;
  insert into pg_temp.la46_old select policy_number, content_hash from public.policy_snapshot where file_id = p_file_id;
  delete from public.policy_snapshot where file_id = p_file_id;

  insert into public.policy_snapshot (tenant_id, agency_id, carrier_id, policy_number, snapshot_date, file_id, raw_row_id,
    carrier_status_raw, status_normalized, paid_to_date, effective_date, issue_date, application_date, termination_date,
    premium_cents, premium_mode, payment_method, face_amount_cents, product_code, product_tier, agent_identifier, extra, superseded, content_hash)
  select p_tenant_id, v_file.agency_id, v_file.carrier_id, r.policy_number, v_file.file_date, p_file_id, r.raw_row_id,
    r.carrier_status_raw, r.status_normalized, r.paid_to_date, r.effective_date, r.issue_date, r.application_date, r.termination_date,
    r.premium_cents, r.premium_mode, r.payment_method, r.face_amount_cents, r.product_code, r.product_tier, r.agent_identifier,
    coalesce(r.extra, '{}'::jsonb), v_superseded, r.content_hash
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
    policy_number text, raw_row_id uuid, carrier_status_raw text, status_normalized text, paid_to_date date, effective_date date,
    issue_date date, application_date date, termination_date date, premium_cents bigint, premium_mode text, payment_method text,
    face_amount_cents bigint, product_code text, product_tier text, agent_identifier text, extra jsonb, content_hash text);

  select count(*) into v_changed from (
    (select policy_number, content_hash from public.policy_snapshot where file_id = p_file_id except select * from pg_temp.la46_old)
    union all
    (select * from pg_temp.la46_old except select policy_number, content_hash from public.policy_snapshot where file_id = p_file_id)
  ) d;
  select coalesce(array_agg(distinct p), '{}') into v_policies from (
    select policy_number p from public.policy_snapshot where file_id = p_file_id union select policy_number from pg_temp.la46_old
  ) x;
  return jsonb_build_object('changed', v_changed, 'policies', to_jsonb(v_policies), 'carrier_id', v_file.carrier_id);
end;
$$;

-- Replaces the derived history (changes, first-seen events) of a set of one agency's policies.
create or replace function public.replace_policy_changes(p_tenant_id uuid, p_carrier_id uuid, p_policies text[], p_changes jsonb, p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_removed integer;
  v_added integer;
begin
  delete from public.policy_change where tenant_id = p_tenant_id and carrier_id = p_carrier_id and policy_number = any(p_policies);
  get diagnostics v_removed = row_count;
  delete from public.policy_event where tenant_id = p_tenant_id and carrier_id = p_carrier_id and policy_number = any(p_policies);
  insert into public.policy_change (tenant_id, carrier_id, policy_number, field_name, old_value, new_value, from_snapshot_date, to_snapshot_date, from_file_id, to_file_id)
  select p_tenant_id, p_carrier_id, c.policy_number, c.field_name, c.old_value, c.new_value, c.from_snapshot_date, c.to_snapshot_date, c.from_file_id, c.to_file_id
    from jsonb_to_recordset(coalesce(p_changes, '[]'::jsonb)) as c(policy_number text, field_name text, old_value text, new_value text, from_snapshot_date date, to_snapshot_date date, from_file_id uuid, to_file_id uuid)
   where c.policy_number = any(p_policies);
  get diagnostics v_added = row_count;
  insert into public.policy_event (tenant_id, carrier_id, policy_number, event_type, snapshot_date, file_id)
  select p_tenant_id, p_carrier_id, e.policy_number, e.event_type, e.snapshot_date, e.file_id
    from jsonb_to_recordset(coalesce(p_events, '[]'::jsonb)) as e(policy_number text, event_type text, snapshot_date date, file_id uuid)
   where e.policy_number = any(p_policies);
  return jsonb_build_object('removed', v_removed, 'added', v_added);
end;
$$;

revoke all on function public.replace_file_snapshots(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.replace_policy_changes(uuid, uuid, text[], jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.replace_file_snapshots(uuid, uuid, jsonb) to service_role;
grant execute on function public.replace_policy_changes(uuid, uuid, text[], jsonb, jsonb) to service_role;

-- ─── access: read for the agency; written only through the functions above ─────────────────────
alter table public.policy_snapshot enable row level security;
alter table public.policy_change enable row level security;
alter table public.policy_event enable row level security;
drop policy if exists policy_snapshot_tenant_read on public.policy_snapshot;
create policy policy_snapshot_tenant_read on public.policy_snapshot for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists policy_change_tenant_read on public.policy_change;
create policy policy_change_tenant_read on public.policy_change for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists policy_event_tenant_read on public.policy_event;
create policy policy_event_tenant_read on public.policy_event for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.policy_snapshot, public.policy_change, public.policy_event from public, anon, authenticated;
revoke insert, update, delete, truncate on public.policy_snapshot, public.policy_change, public.policy_event from service_role, tenant_app;
grant select on public.policy_snapshot, public.policy_change, public.policy_event to service_role, tenant_app;

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'policy_snapshot_one_per_day') then
    raise exception '20261008140000: one snapshot per policy per file date is not enforced';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'policy_snapshot_raw_row_fkey') then
    raise exception '20261008140000: snapshots must point at their raw row';
  end if;
  if has_table_privilege('service_role', 'public.policy_snapshot', 'UPDATE')
     or has_table_privilege('service_role', 'public.policy_snapshot', 'INSERT')
     or has_table_privilege('service_role', 'public.policy_change', 'DELETE') then
    raise exception '20261008140000: Layer 2 can be written outside its functions';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'policy_snapshot_guard' and not tgisinternal) then
    raise exception '20261008140000: the snapshot guard is missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'replace_file_snapshots' and prosecdef)
     or not exists (select 1 from pg_proc where proname = 'replace_policy_changes' and prosecdef) then
    raise exception '20261008140000: a Layer 2 function is missing';
  end if;
end $$;
