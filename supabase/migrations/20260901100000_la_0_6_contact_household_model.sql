-- LA-0.6: one tenant-scoped contact record, grouped into households, with reversible merges.
-- The service layer supplies normalized search values; the database owns isolation and atomic writes.
create extension if not exists pg_trgm;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  address_hash text,
  address_line1 text,
  city text,
  state text check (state is null or state ~ '^[A-Z]{2}$'),
  postal_code text,
  address_search text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (address_hash is null or char_length(address_hash) = 64)
);

create unique index if not exists households_tenant_address_hash_idx
  on public.households (tenant_id, address_hash) where address_hash is not null;

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  household_id uuid references public.households(id) on delete set null,
  first_name text not null check (char_length(btrim(first_name)) between 1 and 120),
  last_name text not null check (char_length(btrim(last_name)) between 1 and 120),
  dob date,
  primary_phone text,
  state text check (state is null or state ~ '^[A-Z]{2}$'),
  name_search text not null check (char_length(name_search) between 2 and 241),
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  merged_into_id uuid references public.contacts(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contacts_tenant_idx on public.contacts (tenant_id, created_at desc);
create index if not exists contacts_tenant_dob_idx on public.contacts (tenant_id, dob);
create index if not exists contacts_tenant_phone_idx on public.contacts (tenant_id, primary_phone);
create index if not exists contacts_name_search_trgm_idx on public.contacts using gin (name_search gin_trgm_ops);
create index if not exists contacts_active_idx on public.contacts (tenant_id, id) where merged_into_id is null;

create table if not exists public.contact_phones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  phone text not null check (phone ~ '^[0-9]{7,15}$'),
  type text not null default 'other' check (type in ('mobile', 'landline', 'other')),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (contact_id, phone)
);
create index if not exists contact_phones_tenant_phone_idx on public.contact_phones (tenant_id, phone);

create table if not exists public.contact_emails (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  email text not null check (char_length(btrim(email)) between 3 and 320),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (contact_id, email)
);
create index if not exists contact_emails_tenant_email_idx on public.contact_emails (tenant_id, email);

create table if not exists public.field_schema (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entity text not null default 'contact' check (entity in ('contact', 'lead', 'policy', 'application')),
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]*$'),
  label text not null check (char_length(btrim(label)) between 1 and 120),
  type text not null check (type in ('text', 'number', 'date', 'single_select', 'multi_select', 'boolean', 'currency', 'phone')),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  is_required boolean not null default false,
  sort_order integer not null default 0 check (sort_order >= 0 and sort_order <= 9999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, entity, field_key)
);

create table if not exists public.merge_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kept_id uuid not null references public.contacts(id) on delete restrict,
  merged_id uuid not null references public.contacts(id) on delete restrict,
  field_choices jsonb not null default '{}'::jsonb check (jsonb_typeof(field_choices) = 'object'),
  kept_snapshot jsonb not null check (jsonb_typeof(kept_snapshot) = 'object'),
  merged_snapshot jsonb not null check (jsonb_typeof(merged_snapshot) = 'object'),
  kept_phones jsonb not null default '[]'::jsonb,
  merged_phones jsonb not null default '[]'::jsonb,
  kept_emails jsonb not null default '[]'::jsonb,
  merged_emails jsonb not null default '[]'::jsonb,
  merged_by uuid references public.users(id) on delete set null,
  merged_at timestamptz not null default now(),
  reversed_at timestamptz,
  check (kept_id <> merged_id)
);
create index if not exists merge_log_tenant_idx on public.merge_log (tenant_id, merged_at desc);

alter table public.households enable row level security;
alter table public.contacts enable row level security;
alter table public.contact_phones enable row level security;
alter table public.contact_emails enable row level security;
alter table public.field_schema enable row level security;
alter table public.merge_log enable row level security;

revoke all on table public.households, public.contacts, public.contact_phones, public.contact_emails, public.field_schema, public.merge_log from anon, authenticated;
grant select, insert, update, delete on table public.households, public.contacts, public.contact_phones, public.contact_emails, public.field_schema, public.merge_log to tenant_app;
grant select, insert, update, delete on table public.households, public.contacts, public.contact_phones, public.contact_emails, public.field_schema, public.merge_log to service_role;

create or replace function public.touch_contact_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists households_touch_updated_at on public.households;
create trigger households_touch_updated_at before update on public.households for each row execute function public.touch_contact_updated_at();
drop trigger if exists contacts_touch_updated_at on public.contacts;
create trigger contacts_touch_updated_at before update on public.contacts for each row execute function public.touch_contact_updated_at();
drop trigger if exists field_schema_touch_updated_at on public.field_schema;
create trigger field_schema_touch_updated_at before update on public.field_schema for each row execute function public.touch_contact_updated_at();

create or replace function public.find_contact_duplicates(
  p_tenant_id uuid,
  p_name_search text,
  p_dob date default null,
  p_phone text default null,
  p_address_search text default null,
  p_address_hash text default null,
  p_limit integer default 20
)
returns table (
  contact_id uuid,
  household_id uuid,
  first_name text,
  last_name text,
  dob date,
  primary_phone text,
  state text,
  custom_fields jsonb,
  address_line1 text,
  city text,
  postal_code text,
  score numeric,
  confidence text,
  matched_on text[]
)
language sql stable security invoker set search_path = public
as $$
with candidates as (
  select
    c.id as contact_id,
    c.household_id,
    c.first_name,
    c.last_name,
    c.dob,
    c.primary_phone,
    c.state,
    c.custom_fields,
    h.address_line1,
    h.city,
    h.postal_code,
    (
      (case when p_phone is not null and c.primary_phone = p_phone then 0.35 else 0 end) +
      (case when p_dob is not null and c.dob = p_dob then 0.25 else 0 end) +
      (case when p_address_hash is not null and h.address_hash = p_address_hash then 0.20 else 0 end) +
      (case when nullif(p_name_search, '') is not null then greatest(similarity(c.name_search, p_name_search), 0) * 0.40 else 0 end) +
      (case when nullif(p_address_search, '') is not null and h.address_search is not null then greatest(similarity(h.address_search, p_address_search), 0) * 0.20 else 0 end)
    )::numeric as raw_score,
    array_remove(array[
      case when p_phone is not null and c.primary_phone = p_phone then 'phone' end,
      case when p_dob is not null and c.dob = p_dob then 'dob' end,
      case when p_address_hash is not null and h.address_hash = p_address_hash then 'address' end,
      case when nullif(p_name_search, '') is not null and similarity(c.name_search, p_name_search) >= 0.45 then 'name' end
    ], null) as matched_on
  from public.contacts c
  left join public.households h on h.id = c.household_id and h.tenant_id = p_tenant_id
  where c.tenant_id = p_tenant_id
    and c.merged_into_id is null
    and (
      (p_phone is not null and c.primary_phone = p_phone) or
      (p_dob is not null and c.dob = p_dob) or
      (p_address_hash is not null and h.address_hash = p_address_hash) or
      (nullif(p_name_search, '') is not null and c.name_search % p_name_search) or
      (nullif(p_address_search, '') is not null and h.address_search % p_address_search)
    )
), filtered as (
  select *, round(raw_score, 4) as rounded_score from candidates where raw_score >= 0.45
)
select contact_id, household_id, first_name, last_name, dob, primary_phone, state, custom_fields,
       address_line1, city, postal_code, rounded_score,
       case when rounded_score >= 0.78 then 'high' when rounded_score >= 0.60 then 'medium' else 'low' end,
       matched_on
from filtered
order by rounded_score desc, contact_id
limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

create or replace function public.save_contact(
  p_tenant_id uuid,
  p_first_name text,
  p_last_name text,
  p_dob date,
  p_primary_phone text,
  p_state text,
  p_name_search text,
  p_custom_fields jsonb,
  p_address_hash text,
  p_address_search text,
  p_address_line1 text,
  p_city text,
  p_postal_code text,
  p_phones jsonb default '[]'::jsonb,
  p_emails jsonb default '[]'::jsonb
)
returns uuid
language plpgsql security invoker set search_path = public
as $$
declare v_household_id uuid; v_contact_id uuid; item jsonb;
begin
  if jsonb_typeof(coalesce(p_custom_fields, '{}'::jsonb)) <> 'object' then raise exception 'Custom fields must be an object'; end if;
  if jsonb_typeof(coalesce(p_phones, '[]'::jsonb)) <> 'array' then raise exception 'Phones must be an array'; end if;
  if jsonb_typeof(coalesce(p_emails, '[]'::jsonb)) <> 'array' then raise exception 'Emails must be an array'; end if;
  if p_address_hash is not null then
    insert into public.households (tenant_id, address_hash, address_line1, city, state, postal_code, address_search)
    values (p_tenant_id, p_address_hash, nullif(trim(p_address_line1), ''), nullif(trim(p_city), ''), nullif(upper(trim(p_state)), ''), nullif(trim(p_postal_code), ''), p_address_search)
    on conflict do nothing;
    select h.id into v_household_id from public.households h where h.tenant_id = p_tenant_id and h.address_hash = p_address_hash;
  end if;
  insert into public.contacts (tenant_id, household_id, first_name, last_name, dob, primary_phone, state, name_search, custom_fields)
  values (p_tenant_id, v_household_id, trim(p_first_name), trim(p_last_name), p_dob, nullif(trim(p_primary_phone), ''), nullif(upper(trim(p_state)), ''), p_name_search, coalesce(p_custom_fields, '{}'::jsonb))
  returning id into v_contact_id;
  for item in select value from jsonb_array_elements(p_phones) loop
    insert into public.contact_phones (tenant_id, contact_id, phone, type, is_primary)
    values (p_tenant_id, v_contact_id, item->>'phone', coalesce(item->>'type', 'other'), coalesce((item->>'is_primary')::boolean, false))
    on conflict (contact_id, phone) do nothing;
  end loop;
  for item in select value from jsonb_array_elements(p_emails) loop
    insert into public.contact_emails (tenant_id, contact_id, email, is_primary)
    values (p_tenant_id, v_contact_id, lower(trim(item->>'email')), coalesce((item->>'is_primary')::boolean, false))
    on conflict (contact_id, email) do nothing;
  end loop;
  return v_contact_id;
end;
$$;

create or replace function public.save_field_schema(
  p_tenant_id uuid, p_entity text, p_field_key text, p_label text, p_type text,
  p_options jsonb, p_is_required boolean, p_sort_order integer
)
returns public.field_schema
language sql security invoker set search_path = public
as $$
  insert into public.field_schema (tenant_id, entity, field_key, label, type, options, is_required, sort_order)
  values (p_tenant_id, p_entity, lower(trim(p_field_key)), trim(p_label), p_type, coalesce(p_options, '[]'::jsonb), coalesce(p_is_required, false), p_sort_order)
  on conflict (tenant_id, entity, field_key) do update set label = excluded.label, type = excluded.type, options = excluded.options, is_required = excluded.is_required, sort_order = excluded.sort_order
  returning *;
$$;

create or replace function public.merge_contacts(
  p_tenant_id uuid, p_kept_id uuid, p_merged_id uuid, p_field_choices jsonb, p_merged_by uuid
)
returns uuid
language plpgsql security invoker set search_path = public
as $$
declare kept public.contacts%rowtype; merged public.contacts%rowtype; log_id uuid;
  kept_phones jsonb; merged_phones jsonb; kept_emails jsonb; merged_emails jsonb;
begin
  if p_kept_id = p_merged_id then raise exception 'Choose two different contacts'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || least(p_kept_id::text, p_merged_id::text) || ':' || greatest(p_kept_id::text, p_merged_id::text), 0));
  select * into kept from public.contacts where id = p_kept_id and tenant_id = p_tenant_id for update;
  select * into merged from public.contacts where id = p_merged_id and tenant_id = p_tenant_id for update;
  if kept.id is null or merged.id is null then raise exception 'Both contacts must belong to this tenant'; end if;
  if kept.merged_into_id is not null or merged.merged_into_id is not null then raise exception 'A merged contact cannot be merged again'; end if;
  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into kept_phones from public.contact_phones p where p.contact_id = kept.id;
  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into merged_phones from public.contact_phones p where p.contact_id = merged.id;
  select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) into kept_emails from public.contact_emails e where e.contact_id = kept.id;
  select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) into merged_emails from public.contact_emails e where e.contact_id = merged.id;
  insert into public.merge_log (tenant_id, kept_id, merged_id, field_choices, kept_snapshot, merged_snapshot, kept_phones, merged_phones, kept_emails, merged_emails, merged_by)
  values (p_tenant_id, kept.id, merged.id, coalesce(p_field_choices, '{}'::jsonb), to_jsonb(kept), to_jsonb(merged), kept_phones, merged_phones, kept_emails, merged_emails, p_merged_by)
  returning id into log_id;
  update public.contacts set
    first_name = case when p_field_choices->>'first_name' = 'merged' then merged.first_name else kept.first_name end,
    last_name = case when p_field_choices->>'last_name' = 'merged' then merged.last_name else kept.last_name end,
    dob = case when p_field_choices->>'dob' = 'merged' then merged.dob else kept.dob end,
    primary_phone = case when p_field_choices->>'primary_phone' = 'merged' then merged.primary_phone else kept.primary_phone end,
    state = case when p_field_choices->>'state' = 'merged' then merged.state else kept.state end,
    household_id = case when p_field_choices->>'household_id' = 'merged' then merged.household_id else kept.household_id end,
    name_search = case when p_field_choices->>'first_name' = 'merged' or p_field_choices->>'last_name' = 'merged' then lower(regexp_replace(trim(case when p_field_choices->>'first_name' = 'merged' then merged.first_name else kept.first_name end || ' ' || case when p_field_choices->>'last_name' = 'merged' then merged.last_name else kept.last_name end), '[^a-zA-Z0-9]+', '', 'g')) else kept.name_search end,
    custom_fields = case when p_field_choices->>'custom_fields' = 'merged' then merged.custom_fields else kept.custom_fields end
  where id = kept.id;
  insert into public.contact_phones (tenant_id, contact_id, phone, type, is_primary)
  select p_tenant_id, kept.id, item->>'phone', coalesce(item->>'type', 'other'), coalesce((item->>'is_primary')::boolean, false)
  from jsonb_array_elements(merged_phones) item on conflict (contact_id, phone) do nothing;
  insert into public.contact_emails (tenant_id, contact_id, email, is_primary)
  select p_tenant_id, kept.id, item->>'email', coalesce((item->>'is_primary')::boolean, false)
  from jsonb_array_elements(merged_emails) item on conflict (contact_id, email) do nothing;
  update public.contacts set merged_into_id = kept.id where id = merged.id;
  return log_id;
end;
$$;

create or replace function public.undo_contact_merge(p_tenant_id uuid, p_merge_id uuid)
returns uuid
language plpgsql security invoker set search_path = public
as $$
declare log_row public.merge_log%rowtype; item jsonb;
begin
  select * into log_row from public.merge_log where id = p_merge_id and tenant_id = p_tenant_id for update;
  if log_row.id is null then raise exception 'Merge not found'; end if;
  if log_row.reversed_at is not null then raise exception 'This merge was already undone'; end if;
  update public.contacts set first_name = log_row.kept_snapshot->>'first_name', last_name = log_row.kept_snapshot->>'last_name', dob = nullif(log_row.kept_snapshot->>'dob', '')::date, primary_phone = log_row.kept_snapshot->>'primary_phone', state = log_row.kept_snapshot->>'state', household_id = nullif(log_row.kept_snapshot->>'household_id', '')::uuid, name_search = log_row.kept_snapshot->>'name_search', custom_fields = log_row.kept_snapshot->'custom_fields' where id = log_row.kept_id and tenant_id = p_tenant_id;
  update public.contacts set first_name = log_row.merged_snapshot->>'first_name', last_name = log_row.merged_snapshot->>'last_name', dob = nullif(log_row.merged_snapshot->>'dob', '')::date, primary_phone = log_row.merged_snapshot->>'primary_phone', state = log_row.merged_snapshot->>'state', household_id = nullif(log_row.merged_snapshot->>'household_id', '')::uuid, name_search = log_row.merged_snapshot->>'name_search', custom_fields = log_row.merged_snapshot->'custom_fields', merged_into_id = null where id = log_row.merged_id and tenant_id = p_tenant_id;
  delete from public.contact_phones where contact_id in (log_row.kept_id, log_row.merged_id);
  for item in select value from jsonb_array_elements(log_row.kept_phones) loop insert into public.contact_phones (id, tenant_id, contact_id, phone, type, is_primary) values ((item->>'id')::uuid, p_tenant_id, log_row.kept_id, item->>'phone', coalesce(item->>'type', 'other'), coalesce((item->>'is_primary')::boolean, false)); end loop;
  for item in select value from jsonb_array_elements(log_row.merged_phones) loop insert into public.contact_phones (id, tenant_id, contact_id, phone, type, is_primary) values ((item->>'id')::uuid, p_tenant_id, log_row.merged_id, item->>'phone', coalesce(item->>'type', 'other'), coalesce((item->>'is_primary')::boolean, false)); end loop;
  delete from public.contact_emails where contact_id in (log_row.kept_id, log_row.merged_id);
  for item in select value from jsonb_array_elements(log_row.kept_emails) loop insert into public.contact_emails (id, tenant_id, contact_id, email, is_primary) values ((item->>'id')::uuid, p_tenant_id, log_row.kept_id, item->>'email', coalesce((item->>'is_primary')::boolean, false)); end loop;
  for item in select value from jsonb_array_elements(log_row.merged_emails) loop insert into public.contact_emails (id, tenant_id, contact_id, email, is_primary) values ((item->>'id')::uuid, p_tenant_id, log_row.merged_id, item->>'email', coalesce((item->>'is_primary')::boolean, false)); end loop;
  update public.merge_log set reversed_at = now() where id = log_row.id;
  return log_row.id;
end;
$$;

revoke all on function public.find_contact_duplicates(uuid, text, date, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.save_contact(uuid, text, text, date, text, text, text, jsonb, text, text, text, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.save_field_schema(uuid, text, text, text, text, jsonb, boolean, integer) from public, anon, authenticated;
revoke all on function public.merge_contacts(uuid, uuid, uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.undo_contact_merge(uuid, uuid) from public, anon, authenticated;
grant execute on function public.find_contact_duplicates(uuid, text, date, text, text, text, integer) to service_role;
grant execute on function public.save_contact(uuid, text, text, date, text, text, text, jsonb, text, text, text, text, text, jsonb, jsonb) to service_role;
grant execute on function public.save_field_schema(uuid, text, text, text, text, jsonb, boolean, integer) to service_role;
grant execute on function public.merge_contacts(uuid, uuid, uuid, jsonb, uuid) to service_role;
grant execute on function public.undo_contact_merge(uuid, uuid) to service_role;

revoke all on function public.touch_contact_updated_at() from public;
