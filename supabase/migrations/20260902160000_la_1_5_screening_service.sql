-- LA-1.5: one typed, replayable TCPA/DNC screening boundary for partner lead intake.
-- Screening rows are immutable evidence. Cache locks only coordinate concurrent checks; they are
-- not a second source of truth and expire automatically if a worker disappears.

create table if not exists public.screening_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone_digits text not null check (phone_digits ~ '^[0-9]{10}$'),
  outcome text not null check (outcome in ('clear', 'dnc', 'internal_dq', 'tcpa_litigator', 'unavailable')),
  vendor text not null check (length(trim(vendor)) between 1 and 240),
  raw_response jsonb not null check (jsonb_typeof(raw_response) = 'object'),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  version integer not null check (version > 0),
  checked_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (expires_at > checked_at)
);

create index if not exists screening_results_cache_idx
  on public.screening_results (tenant_id, phone_digits, version, expires_at desc);
create index if not exists screening_results_tenant_checked_idx
  on public.screening_results (tenant_id, checked_at desc);

create table if not exists public.screening_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  partner_id uuid references public.partners(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  phone_digits text check (phone_digits is null or phone_digits ~ '^[0-9]{10}$'),
  outcome text not null check (outcome in ('clear', 'dnc', 'internal_dq', 'tcpa_litigator', 'invalid_phone', 'unavailable')),
  vendor text,
  raw_response jsonb not null check (jsonb_typeof(raw_response) = 'object'),
  result_id uuid references public.screening_results(id) on delete set null,
  cached boolean not null default false,
  version integer not null check (version > 0),
  ts timestamptz not null default now()
);

create index if not exists screening_audit_tenant_ts_idx
  on public.screening_audit (tenant_id, ts desc);
create index if not exists screening_audit_phone_idx
  on public.screening_audit (tenant_id, phone_digits, ts desc);

create table if not exists public.screening_cache_locks (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone_digits text not null check (phone_digits ~ '^[0-9]{10}$'),
  version integer not null check (version > 0),
  claim_token uuid,
  claimed_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, phone_digits, version)
);

alter table public.agent_leads
  add column if not exists screening_result_id uuid references public.screening_results(id) on delete set null,
  add column if not exists screening_version integer,
  add column if not exists screening_outcome text,
  add column if not exists screening_warning text,
  add column if not exists screening_checked_at timestamptz;

alter table public.agent_leads
  drop constraint if exists agent_leads_screening_outcome_check;
alter table public.agent_leads
  add constraint agent_leads_screening_outcome_check
  check (screening_outcome is null or screening_outcome in ('clear', 'dnc', 'internal_dq'));

create index if not exists agent_leads_screening_result_idx
  on public.agent_leads (tenant_id, screening_result_id);

-- A partner can only submit a lead with a configured phone field. This lookup deliberately reads
-- the two supported top-level phone keys; it does not walk arbitrary JSON or trust vendor prose.
create or replace function public.has_existing_lead_phone(p_tenant_id uuid, p_phone_digits text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.agent_leads l
    where l.tenant_id = p_tenant_id
      and right(regexp_replace(coalesce(l.values->>'phone', l.values->>'phone_number', ''), '[^0-9]', '', 'g'), 10) = p_phone_digits
  );
$$;

create or replace function public.claim_screening_cache(
  p_tenant_id uuid,
  p_phone_digits text,
  p_version integer,
  p_claim_seconds integer default 30
)
returns table(state text, result_id uuid, claim_token uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock public.screening_cache_locks%rowtype;
  v_cached uuid;
  v_token uuid;
begin
  if p_phone_digits !~ '^[0-9]{10}$' then raise exception 'invalid_screening_phone'; end if;
  if p_version <= 0 or p_claim_seconds < 1 then raise exception 'invalid_screening_claim'; end if;

  insert into public.screening_cache_locks (tenant_id, phone_digits, version)
  values (p_tenant_id, p_phone_digits, p_version)
  on conflict (tenant_id, phone_digits, version) do nothing;

  select * into v_lock
  from public.screening_cache_locks
  where tenant_id = p_tenant_id and phone_digits = p_phone_digits and version = p_version
  for update;

  select sr.id into v_cached
  from public.screening_results sr
  where sr.tenant_id = p_tenant_id
    and sr.phone_digits = p_phone_digits
    and sr.version = p_version
    and sr.expires_at > now()
  order by sr.checked_at desc
  limit 1;
  if v_cached is not null then
    return query select 'cached'::text, v_cached, null::uuid;
    return;
  end if;

  if v_lock.claimed_until is not null and v_lock.claimed_until > now() then
    return query select 'in_flight'::text, null::uuid, null::uuid;
    return;
  end if;

  v_token := gen_random_uuid();
  update public.screening_cache_locks
  set claim_token = v_token, claimed_until = now() + make_interval(secs => p_claim_seconds), updated_at = now()
  where tenant_id = p_tenant_id and phone_digits = p_phone_digits and version = p_version;
  return query select 'claimed'::text, null::uuid, v_token;
end;
$$;

create or replace function public.complete_screening_cache(
  p_tenant_id uuid,
  p_phone_digits text,
  p_version integer,
  p_claim_token uuid,
  p_outcome text,
  p_vendor text,
  p_raw_response jsonb,
  p_warnings jsonb,
  p_checked_at timestamptz,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result uuid;
begin
  if not exists (
    select 1 from public.screening_cache_locks
    where tenant_id = p_tenant_id and phone_digits = p_phone_digits and version = p_version
      and claim_token = p_claim_token and claimed_until > now()
  ) then raise exception 'screening_claim_expired'; end if;
  insert into public.screening_results (tenant_id, phone_digits, outcome, vendor, raw_response, warnings, version, checked_at, expires_at)
  values (p_tenant_id, p_phone_digits, p_outcome, p_vendor, p_raw_response, coalesce(p_warnings, '[]'::jsonb), p_version, coalesce(p_checked_at, now()), p_expires_at)
  returning id into v_result;
  update public.screening_cache_locks
  set claim_token = null, claimed_until = null, updated_at = now()
  where tenant_id = p_tenant_id and phone_digits = p_phone_digits and version = p_version and claim_token = p_claim_token;
  return v_result;
end;
$$;

create or replace function public.release_screening_cache(
  p_tenant_id uuid,
  p_phone_digits text,
  p_version integer,
  p_claim_token uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
  update public.screening_cache_locks
  set claim_token = null, claimed_until = null, updated_at = now()
  where tenant_id = p_tenant_id and phone_digits = p_phone_digits and version = p_version and claim_token = p_claim_token
  returning true;
$$;

alter table public.screening_results enable row level security;
alter table public.screening_audit enable row level security;
alter table public.screening_cache_locks enable row level security;

drop policy if exists screening_results_tenant_scoped on public.screening_results;
create policy screening_results_tenant_scoped on public.screening_results
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists screening_audit_tenant_scoped on public.screening_audit;
create policy screening_audit_tenant_scoped on public.screening_audit
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists screening_cache_locks_tenant_scoped on public.screening_cache_locks;
create policy screening_cache_locks_tenant_scoped on public.screening_cache_locks
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.screening_results, public.screening_audit, public.screening_cache_locks from public, anon, authenticated, tenant_app;
grant select on public.screening_results, public.screening_audit, public.screening_cache_locks to tenant_app;
grant select, insert on public.screening_results to service_role;
grant select, insert on public.screening_audit to service_role;
grant select, insert, update on public.screening_cache_locks to service_role;
revoke all on function public.has_existing_lead_phone(uuid, text) from public, anon, authenticated, tenant_app;
grant execute on function public.has_existing_lead_phone(uuid, text) to service_role;
revoke all on function public.claim_screening_cache(uuid, text, integer, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.claim_screening_cache(uuid, text, integer, integer) to service_role;
revoke all on function public.complete_screening_cache(uuid, text, integer, uuid, text, text, jsonb, jsonb, timestamptz, timestamptz) from public, anon, authenticated, tenant_app;
grant execute on function public.complete_screening_cache(uuid, text, integer, uuid, text, text, jsonb, jsonb, timestamptz, timestamptz) to service_role;
revoke all on function public.release_screening_cache(uuid, text, integer, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.release_screening_cache(uuid, text, integer, uuid) to service_role;

-- The original Term Life seed predates LA-1.5. Add the required phone field to the active source
-- and every already-created tenant copy, including their replayable revision snapshots.
do $$
declare
  r record;
  v_fields jsonb;
  v_form jsonb;
begin
  for r in
    select id, version from public.templates where product_code = 'term_life' and is_active
  loop
    insert into public.template_fields (template_id, version, field_key, label, type, is_required, options, sort_order)
    select r.id, r.version, 'phone', 'Phone number', 'phone', true, '[]'::jsonb,
      coalesce((select max(sort_order) + 10 from public.template_fields where template_id = r.id and version = r.version), 10)
    where not exists (select 1 from public.template_fields where template_id = r.id and version = r.version and field_key = 'phone');
    update public.template_forms f
    set form_definition = jsonb_set(f.form_definition, '{sections,0,fields}',
      (f.form_definition->'sections'->0->'fields') || '{"field_key":"phone","is_required":true,"show_when":null}'::jsonb)
    where f.template_id = r.id and f.version = r.version
      and not exists (select 1 from jsonb_array_elements(f.form_definition->'sections'->0->'fields') item where item->>'field_key' = 'phone');
  end loop;

  for r in select id, template_id, template_version from public.tenant_templates
  loop
    v_fields := null;
    v_form := null;
    insert into public.tenant_template_fields (tenant_template_id, field_key, label, type, is_required, options, sort_order)
    select r.id, 'phone', 'Phone number', 'phone', true, '[]'::jsonb,
      coalesce((select max(sort_order) + 10 from public.tenant_template_fields where tenant_template_id = r.id), 10)
    where not exists (select 1 from public.tenant_template_fields where tenant_template_id = r.id and field_key = 'phone');
    update public.tenant_template_forms f
    set form_definition = jsonb_set(f.form_definition, '{sections,0,fields}',
      (f.form_definition->'sections'->0->'fields') || '{"field_key":"phone","is_required":true,"show_when":null}'::jsonb)
    where f.tenant_template_id = r.id
      and not exists (select 1 from jsonb_array_elements(f.form_definition->'sections'->0->'fields') item where item->>'field_key' = 'phone');
    select fields, form_definition into v_fields, v_form
    from public.tenant_template_revisions
    where tenant_template_id = r.id
    order by revision desc limit 1;
    if v_fields is not null and not exists (select 1 from jsonb_array_elements(v_fields) item where item->>'field_key' = 'phone') then
      update public.tenant_template_revisions
      set fields = v_fields || '{"field_key":"phone","label":"Phone number","type":"phone","is_required":true,"options":[],"sort_order":999}'::jsonb,
          form_definition = jsonb_set(v_form, '{sections,0,fields}',
            (v_form->'sections'->0->'fields') || '{"field_key":"phone","is_required":true,"show_when":null}'::jsonb)
      where tenant_template_id = r.id
        and revision = (select max(revision) from public.tenant_template_revisions where tenant_template_id = r.id);
    end if;
  end loop;
end;
$$;
