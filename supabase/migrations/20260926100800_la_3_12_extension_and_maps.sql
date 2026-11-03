-- LA-3 steps 12, 13 and 14 — extension grants (LA-3.12), copy-assist ticks (LA-3.14) and carrier
-- field maps (LA-3.13: storage, review and fill — no AI yet).
--
-- docs/la3/SCHEMA-PLAN.md "Step 12", "Step 13" and "Step 14" are the specification. In short:
--
--   tenant_extension_grants   NEW  one row per token (id = jti); 60-minute lifetime by CHECK;
--                                  revocation is read from here on every extension request
--   tenant_extension_events   NEW  every grant, read, rejection and revocation; append-only
--   tenant_copy_assist_ticks  NEW  shared between the web pop-out and the extension; a new attempt
--                                  has a new application_id, so ticks reset by construction
--   carrier_field_map         NEW  versioned map per carrier (product); tenant_id null = platform
--   carrier_field_map_step    NEW  one per carrier portal page
--   carrier_field_map_entry   NEW  one per filled field
--   carrier_field_map_events  NEW  map misses and fill rates; append-only
--
-- Table names are the ones lib/carriers/cancelledAutofillStaysCancelled.test.mjs allows (the LA-3.13
-- design, not the cancelled outbound one). Two triggers enforce LA-3.13's rules:
--   · publish guard — a map cannot become `published` while any SSN or bank / card number entry is
--     unverified, and cannot be inserted already published;
--   · immutability — once published, a map, its steps and its entries never change; the only moves
--     left are published ↔ needs_review and → retired. Editing makes version N + 1.
-- proposal_source = 'ai' is the seam for decision 4; nothing writes it yet.
--
-- Down (only while no row exists in the new tables):
--   drop table public.carrier_field_map_events, public.carrier_field_map_entry,
--              public.carrier_field_map_step, public.carrier_field_map,
--              public.tenant_copy_assist_ticks, public.tenant_extension_events, public.tenant_extension_grants;
--   drop function public.carrier_field_map_guard(), public.carrier_field_map_child_guard();

-- ── 1 · extension grants (3.12) ─────────────────────────────────────────────
create table if not exists public.tenant_extension_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  application_id uuid not null references public.tenant_applications(id) on delete cascade,
  carrier_origin text not null check (carrier_origin ~ '^https://[^/]+$'),
  scope text not null default 'read_application_fields' check (scope in ('read_application_fields')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason is null or char_length(revoked_reason) between 1 and 200),
  field_reads integer not null default 0 check (field_reads >= 0),
  -- Decision 1, settled at 60 minutes. Not a range: every token lives exactly this long.
  constraint tenant_extension_grants_lifetime check (expires_at - issued_at = interval '60 minutes'),
  constraint tenant_extension_grants_revoked_reason check (revoked_at is null or revoked_reason is not null)
);
create index if not exists tenant_extension_grants_live_idx
  on public.tenant_extension_grants (tenant_id, user_id) where revoked_at is null;
-- ready → draft revokes every live grant for the attempt.
create index if not exists tenant_extension_grants_app_idx
  on public.tenant_extension_grants (application_id) where revoked_at is null;
create index if not exists tenant_extension_grants_user_idx on public.tenant_extension_grants (user_id);

alter table public.tenant_extension_grants enable row level security;
drop policy if exists tenant_extension_grants_tenant_scoped on public.tenant_extension_grants;
create policy tenant_extension_grants_tenant_scoped on public.tenant_extension_grants
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_extension_grants to tenant_app;
grant select, insert, update on public.tenant_extension_grants to service_role;

create table if not exists public.tenant_extension_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  grant_id uuid references public.tenant_extension_grants(id) on delete set null,
  kind text not null check (kind in ('granted', 'read', 'rejected', 'revoked', 'expired')),
  field_key text check (field_key is null or field_key ~ '^[a-z]+\.[a-z0-9_]+$'),
  origin text check (origin is null or char_length(origin) <= 300),
  status_code smallint check (status_code is null or status_code between 100 and 599),
  at timestamptz not null default now()
);
create index if not exists tenant_extension_events_tenant_idx on public.tenant_extension_events (tenant_id, at desc);
create index if not exists tenant_extension_events_grant_idx on public.tenant_extension_events (grant_id) where grant_id is not null;

alter table public.tenant_extension_events enable row level security;
drop policy if exists tenant_extension_events_tenant_scoped on public.tenant_extension_events;
create policy tenant_extension_events_tenant_scoped on public.tenant_extension_events
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_extension_events to tenant_app;
grant select, insert on public.tenant_extension_events to service_role;
revoke update, delete, truncate on public.tenant_extension_events from service_role, tenant_app, anon, authenticated;

-- ── 2 · copy-assist ticks (3.14) ────────────────────────────────────────────
create table if not exists public.tenant_copy_assist_ticks (
  application_id uuid not null references public.tenant_applications(id) on delete cascade,
  field_key text not null check (field_key ~ '^[a-z]+\.[a-z0-9_]+$'),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  copied_at timestamptz not null default now(),
  copied_by uuid references public.users(id) on delete set null,
  surface text not null check (surface in ('web', 'popout', 'extension')),
  primary key (application_id, field_key)
);
create index if not exists tenant_copy_assist_ticks_tenant_idx on public.tenant_copy_assist_ticks (tenant_id);

alter table public.tenant_copy_assist_ticks enable row level security;
drop policy if exists tenant_copy_assist_ticks_tenant_scoped on public.tenant_copy_assist_ticks;
create policy tenant_copy_assist_ticks_tenant_scoped on public.tenant_copy_assist_ticks
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.tenant_copy_assist_ticks to tenant_app;
grant select, insert, update, delete on public.tenant_copy_assist_ticks to service_role;

-- ── 3 · carrier field maps (3.13) ───────────────────────────────────────────
create table if not exists public.carrier_field_map (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  carrier_product_id uuid references public.carrier_products(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'in_review', 'published', 'retired', 'needs_review')),
  origin text check (origin is null or origin ~ '^https://[^/]+$'),
  created_by uuid references public.users(id) on delete set null,
  approved_by uuid references public.users(id) on delete set null,
  approved_at timestamptz,
  proposal_source text not null default 'manual' check (proposal_source in ('manual', 'ai')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint carrier_field_map_published_approved check (status <> 'published' or (approved_by is not null and approved_at is not null))
);
create unique index if not exists carrier_field_map_version_unique
  on public.carrier_field_map (
    coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    carrier_id,
    coalesce(carrier_product_id, '00000000-0000-0000-0000-000000000000'::uuid),
    version
  );
create index if not exists carrier_field_map_carrier_idx on public.carrier_field_map (carrier_id, status);
create index if not exists carrier_field_map_product_idx on public.carrier_field_map (carrier_product_id) where carrier_product_id is not null;
create index if not exists carrier_field_map_tenant_idx on public.carrier_field_map (tenant_id) where tenant_id is not null;

create table if not exists public.carrier_field_map_step (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.carrier_field_map(id) on delete cascade,
  page_key text not null check (page_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  url_pattern text not null check (char_length(url_pattern) between 1 and 500),
  sort_order integer not null default 0,
  constraint carrier_field_map_step_page_unique unique (map_id, page_key)
);

create table if not exists public.carrier_field_map_entry (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references public.carrier_field_map_step(id) on delete cascade,
  field_key text not null check (field_key ~ '^[a-z]+\.[a-z0-9_]+$'),
  selector text not null check (char_length(selector) between 1 and 1000),
  selector_fallback text check (selector_fallback is null or char_length(selector_fallback) <= 1000),
  input_kind text not null check (input_kind in ('text', 'select', 'radio', 'checkbox', 'date', 'masked')),
  value_transform text check (value_transform is null or char_length(value_transform) <= 60),
  option_map jsonb check (option_map is null or jsonb_typeof(option_map) = 'object'),
  confidence numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  verified boolean not null default false,
  verified_by uuid references public.users(id) on delete set null,
  constraint carrier_field_map_entry_field_unique unique (step_id, field_key),
  constraint carrier_field_map_entry_verified_by check (not verified or verified_by is not null)
);
create index if not exists carrier_field_map_entry_verified_by_idx on public.carrier_field_map_entry (verified_by) where verified_by is not null;

create table if not exists public.carrier_field_map_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  map_id uuid not null references public.carrier_field_map(id) on delete cascade,
  step_id uuid references public.carrier_field_map_step(id) on delete set null,
  application_id uuid references public.tenant_applications(id) on delete set null,
  kind text not null check (kind in ('map_miss', 'fill_rate')),
  field_key text check (field_key is null or field_key ~ '^[a-z]+\.[a-z0-9_]+$'),
  fields_filled integer check (fields_filled is null or fields_filled >= 0),
  fields_total integer check (fields_total is null or fields_total >= 0),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  at timestamptz not null default now(),
  constraint carrier_field_map_events_fill_rate check (kind <> 'fill_rate' or (fields_filled is not null and fields_total is not null and fields_filled <= fields_total))
);
create index if not exists carrier_field_map_events_map_idx on public.carrier_field_map_events (map_id, at desc);
create index if not exists carrier_field_map_events_tenant_idx on public.carrier_field_map_events (tenant_id, at desc);
create index if not exists carrier_field_map_events_step_idx on public.carrier_field_map_events (step_id) where step_id is not null;
create index if not exists carrier_field_map_events_app_idx on public.carrier_field_map_events (application_id) where application_id is not null;

-- RLS: platform maps are readable by every tenant; a tenant writes only its own. Steps and entries
-- have no tenant_id and scope through their map.
alter table public.carrier_field_map enable row level security;
drop policy if exists carrier_field_map_tenant_read on public.carrier_field_map;
create policy carrier_field_map_tenant_read on public.carrier_field_map
  for select to tenant_app
  using (tenant_id is null or tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists carrier_field_map_tenant_scoped on public.carrier_field_map;
create policy carrier_field_map_tenant_scoped on public.carrier_field_map
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.carrier_field_map to tenant_app;
grant select, insert, update, delete on public.carrier_field_map to service_role;

alter table public.carrier_field_map_step enable row level security;
drop policy if exists carrier_field_map_step_tenant_read on public.carrier_field_map_step;
create policy carrier_field_map_step_tenant_read on public.carrier_field_map_step
  for select to tenant_app
  using (exists (select 1 from public.carrier_field_map m
                  where m.id = carrier_field_map_step.map_id
                    and (m.tenant_id is null or m.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)));
drop policy if exists carrier_field_map_step_tenant_scoped on public.carrier_field_map_step;
create policy carrier_field_map_step_tenant_scoped on public.carrier_field_map_step
  for all to tenant_app
  using (exists (select 1 from public.carrier_field_map m
                  where m.id = carrier_field_map_step.map_id
                    and m.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid))
  with check (exists (select 1 from public.carrier_field_map m
                       where m.id = carrier_field_map_step.map_id
                         and m.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid));
grant select on public.carrier_field_map_step to tenant_app;
grant select, insert, update, delete on public.carrier_field_map_step to service_role;

alter table public.carrier_field_map_entry enable row level security;
drop policy if exists carrier_field_map_entry_tenant_read on public.carrier_field_map_entry;
create policy carrier_field_map_entry_tenant_read on public.carrier_field_map_entry
  for select to tenant_app
  using (exists (select 1 from public.carrier_field_map_step s
                   join public.carrier_field_map m on m.id = s.map_id
                  where s.id = carrier_field_map_entry.step_id
                    and (m.tenant_id is null or m.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)));
drop policy if exists carrier_field_map_entry_tenant_scoped on public.carrier_field_map_entry;
create policy carrier_field_map_entry_tenant_scoped on public.carrier_field_map_entry
  for all to tenant_app
  using (exists (select 1 from public.carrier_field_map_step s
                   join public.carrier_field_map m on m.id = s.map_id
                  where s.id = carrier_field_map_entry.step_id
                    and m.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid))
  with check (exists (select 1 from public.carrier_field_map_step s
                        join public.carrier_field_map m on m.id = s.map_id
                       where s.id = carrier_field_map_entry.step_id
                         and m.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid));
grant select on public.carrier_field_map_entry to tenant_app;
grant select, insert, update, delete on public.carrier_field_map_entry to service_role;

alter table public.carrier_field_map_events enable row level security;
drop policy if exists carrier_field_map_events_tenant_scoped on public.carrier_field_map_events;
create policy carrier_field_map_events_tenant_scoped on public.carrier_field_map_events
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
grant select on public.carrier_field_map_events to tenant_app;
grant select, insert on public.carrier_field_map_events to service_role;
revoke update, delete, truncate on public.carrier_field_map_events from service_role, tenant_app, anon, authenticated;

-- ── 4 · publish guard and immutability ──────────────────────────────────────
--
-- A map is frozen once it has been published: status published or retired, or needs_review after
-- an approval (a published map a miss has flagged). A draft or in-review map is freely editable.
create or replace function public.carrier_field_map_guard()
returns trigger language plpgsql as $function$
declare
  v_unverified text;
  v_frozen boolean;
begin
  if tg_op = 'INSERT' then
    if new.status = 'published' then
      raise exception 'CARRIER_FIELD_MAP_PUBLISH_ON_INSERT: insert the map as a draft, add its entries, then publish it';
    end if;
    return new;
  end if;

  v_frozen := old.status in ('published', 'retired') or (old.status = 'needs_review' and old.approved_at is not null);

  if tg_op = 'DELETE' then
    if v_frozen then
      raise exception 'CARRIER_FIELD_MAP_PUBLISHED_IMMUTABLE: map v% has been published and cannot be deleted', old.version;
    end if;
    return old;
  end if;

  if v_frozen then
    if (new.tenant_id, new.carrier_id, new.carrier_product_id, new.version, new.origin, new.created_by,
        new.approved_by, new.approved_at, new.proposal_source)
       is distinct from
       (old.tenant_id, old.carrier_id, old.carrier_product_id, old.version, old.origin, old.created_by,
        old.approved_by, old.approved_at, old.proposal_source) then
      raise exception 'CARRIER_FIELD_MAP_PUBLISHED_IMMUTABLE: map v% has been published; edit a new version instead', old.version;
    end if;
    if new.status is distinct from old.status
       and not ((old.status = 'published' and new.status in ('needs_review', 'retired'))
             or (old.status = 'needs_review' and new.status in ('published', 'retired'))) then
      raise exception 'CARRIER_FIELD_MAP_PUBLISHED_IMMUTABLE: map v% cannot go from % to %', old.version, old.status, new.status;
    end if;
    return new;
  end if;

  if new.status = 'published' and old.status is distinct from 'published' then
    select string_agg(distinct e.field_key, ', ' order by e.field_key) into v_unverified
      from public.carrier_field_map_entry e
      join public.carrier_field_map_step s on s.id = e.step_id
     where s.map_id = new.id
       and e.field_key in ('insured.ssn', 'pay.routing_number', 'pay.account_number', 'pay.card_number')
       and not e.verified;
    if v_unverified is not null then
      raise exception 'CARRIER_FIELD_MAP_SENSITIVE_UNVERIFIED: verify % before publishing', v_unverified;
    end if;
  end if;
  return new;
end;
$function$;

-- Steps and entries of a frozen map cannot be added, changed or removed.
create or replace function public.carrier_field_map_child_guard()
returns trigger language plpgsql as $function$
declare
  v_map_ids uuid[];
begin
  if tg_table_name = 'carrier_field_map_step' then
    v_map_ids := array_remove(array[
      case when tg_op <> 'INSERT' then old.map_id end,
      case when tg_op <> 'DELETE' then new.map_id end], null);
  else
    select array_agg(s.map_id) into v_map_ids
      from public.carrier_field_map_step s
     where s.id in (case when tg_op <> 'INSERT' then old.step_id end,
                    case when tg_op <> 'DELETE' then new.step_id end);
  end if;

  if exists (select 1 from public.carrier_field_map m
              where m.id = any (coalesce(v_map_ids, '{}'::uuid[]))
                and (m.status in ('published', 'retired') or (m.status = 'needs_review' and m.approved_at is not null))) then
    raise exception 'CARRIER_FIELD_MAP_PUBLISHED_IMMUTABLE: this map has been published; edit a new version instead';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

drop trigger if exists carrier_field_map_guard on public.carrier_field_map;
create trigger carrier_field_map_guard before insert or update or delete on public.carrier_field_map
  for each row execute function public.carrier_field_map_guard();
drop trigger if exists carrier_field_map_touch on public.carrier_field_map;
create trigger carrier_field_map_touch before update on public.carrier_field_map
  for each row execute function public.la3_touch_updated_at();
drop trigger if exists carrier_field_map_step_guard on public.carrier_field_map_step;
create trigger carrier_field_map_step_guard before insert or update or delete on public.carrier_field_map_step
  for each row execute function public.carrier_field_map_child_guard();
drop trigger if exists carrier_field_map_entry_guard on public.carrier_field_map_entry;
create trigger carrier_field_map_entry_guard before insert or update or delete on public.carrier_field_map_entry
  for each row execute function public.carrier_field_map_child_guard();

-- ── 5 · checks ──────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_extension_grants_lifetime' and contype = 'c'
                  and pg_get_constraintdef(oid) ~ '(01:00:00|60 minutes|1 hour)') then
    raise exception '20260926100800: the extension grant lifetime is not fixed at 60 minutes';
  end if;
  if has_table_privilege('service_role', 'public.tenant_extension_events', 'UPDATE')
     or has_table_privilege('service_role', 'public.carrier_field_map_events', 'DELETE') then
    raise exception '20260926100800: an extension or field-map event log is not append-only';
  end if;
  if (select count(*) from information_schema.tables
       where table_schema = 'public'
         and table_name in ('carrier_field_map', 'carrier_field_map_step', 'carrier_field_map_entry', 'carrier_field_map_events')) <> 4 then
    raise exception '20260926100800: a LA-3.13 field-map table is missing';
  end if;
  if (select count(*) from pg_trigger
       where not tgisinternal
         and tgname in ('carrier_field_map_guard', 'carrier_field_map_step_guard', 'carrier_field_map_entry_guard')) <> 3 then
    raise exception '20260926100800: the field-map publish guard or immutability trigger is missing';
  end if;
  if position('insured.ssn' in (select prosrc from pg_proc where proname = 'carrier_field_map_guard' limit 1)) = 0 then
    raise exception '20260926100800: the publish guard does not cover the SSN';
  end if;
end $$;

-- The guard, exercised: an unverified SSN entry blocks publishing, and a published map's entries
-- are frozen. Everything the probe writes is undone by the sentinel exception.
do $$
declare
  v_carrier uuid := (select id from public.carriers order by created_at limit 1);
  v_user uuid := (select id from public.users order by created_at limit 1);
  v_map uuid;
  v_step uuid;
begin
  if v_carrier is null or v_user is null then
    raise notice '20260926100800: no carrier or user to probe the publish guard with; skipped';
    return;
  end if;
  begin
    insert into public.carrier_field_map (tenant_id, carrier_id, version, status)
    values (null, v_carrier, 999999, 'draft') returning id into v_map;
    insert into public.carrier_field_map_step (map_id, page_key, url_pattern)
    values (v_map, 'probe', '/probe') returning id into v_step;
    insert into public.carrier_field_map_entry (step_id, field_key, selector, input_kind)
    values (v_step, 'insured.ssn', '#ssn', 'masked');

    begin
      update public.carrier_field_map set status = 'published', approved_by = v_user, approved_at = now() where id = v_map;
      raise exception '20260926100800: a map with an unverified SSN entry was published';
    exception when others then
      if sqlerrm not like 'CARRIER_FIELD_MAP_SENSITIVE_UNVERIFIED%' then raise; end if;
    end;

    update public.carrier_field_map_entry set verified = true, verified_by = v_user where step_id = v_step;
    update public.carrier_field_map set status = 'published', approved_by = v_user, approved_at = now() where id = v_map;

    begin
      update public.carrier_field_map_entry set selector = '#changed' where step_id = v_step;
      raise exception '20260926100800: an entry of a published map was edited';
    exception when others then
      if sqlerrm not like 'CARRIER_FIELD_MAP_PUBLISHED_IMMUTABLE%' then raise; end if;
    end;

    raise exception 'la3_probe_rollback';
  exception when others then
    if sqlerrm <> 'la3_probe_rollback' then raise; end if;
  end;
end $$;
