-- LA-8.8 (Notion sprint, Module 8 — Settings) · one settings audit log, and nothing can change it.
--
-- Five hubs promised "every change writes an audit row: who, what, from, to, when" and nothing could
-- read those rows. Three wrote their own tables (accounting_setting_change LA-7.9,
-- compliance_setting_change LA-6.8, retention_setting_change LA-5.11); sales (LA-3.17) and carrier
-- rules (LA-4.17) wrote none. This file adds the shared shape and makes every hub write it — from the
-- database, so no screen can forget:
--
--   settings_audit              one row per changed setting. setting_label is SNAPSHOTTED (a renamed
--                               or removed setting still reads sensibly); actor_role is the role held
--                               AT THE TIME, read from tenant_users when the row is written.
--   record_settings_audit(...)  the one writer, for triggers and for any future settings screen.
--   triggers                    the three hubs' change tables copy each new row across; sales
--                               settings, carrier settings, carrier operating settings and carrier
--                               retention rules are diffed field by field as they are saved.
--   backfill                    the three change tables' existing rows, source 'migration' (the role
--                               held then is not known, so actor_role is left empty rather than guessed).
--
-- READ-ONLY AND NEVER PURGED. No role can update, delete or truncate it — the grants are revoked from
-- every role, service_role included, and a trigger refuses UPDATE and DELETE for anyone at all
-- (raw_rows' and commission_entry's rule). LA-6.6's retention purge has no rule that can reach it.
--
-- Rollback: drop the eight capture triggers and their functions, then drop table public.settings_audit
--   (an owner can; nothing else can).

set local lock_timeout = '5s';

create table if not exists public.settings_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  section_key text not null,
  setting_key text not null,
  setting_label text not null,
  old_value text,
  new_value text,
  change_type text not null,
  actor_user_id uuid references public.users(id) on delete set null,
  actor_role text,
  occurred_at timestamptz not null default now(),
  source text not null default 'ui',
  reason text,
  constraint settings_audit_section check (section_key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  constraint settings_audit_key check (char_length(setting_key) between 1 and 200),
  constraint settings_audit_label check (char_length(setting_label) between 1 and 300),
  constraint settings_audit_values check ((old_value is null or char_length(old_value) <= 4000) and (new_value is null or char_length(new_value) <= 4000)),
  constraint settings_audit_change check (change_type in ('create', 'update', 'delete', 'reset_to_default')),
  constraint settings_audit_source check (source in ('ui', 'api', 'system', 'migration')),
  constraint settings_audit_reason check (reason is null or char_length(reason) <= 2000)
);
create index if not exists settings_audit_tenant_time_idx on public.settings_audit (tenant_id, occurred_at desc, id desc);
create index if not exists settings_audit_tenant_section_idx on public.settings_audit (tenant_id, section_key, occurred_at desc);
create index if not exists settings_audit_actor_idx on public.settings_audit (tenant_id, actor_user_id, occurred_at desc);

comment on table public.settings_audit is
  'LA-8.8 · Every settings change, append-only. Labels are snapshotted and actor_role is the role at the time. No role may update or delete a row; LA-6.6 never purges it.';

alter table public.settings_audit enable row level security;
revoke all on public.settings_audit from public, anon, authenticated;
-- Insert and read only, even for the service role. (Default privileges hand new tables everything.)
revoke update, delete, truncate on public.settings_audit from service_role;
grant select, insert on public.settings_audit to service_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'tenant_app') then
    execute 'revoke all on public.settings_audit from tenant_app';
  end if;
end;
$$;

create or replace function public.settings_audit_is_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'The settings audit log is read-only: rows are never changed or removed.' using errcode = 'P0001';
end;
$$;

drop trigger if exists settings_audit_append_only on public.settings_audit;
create trigger settings_audit_append_only before update or delete on public.settings_audit
  for each row execute function public.settings_audit_is_append_only();
drop trigger if exists settings_audit_no_truncate on public.settings_audit;
create trigger settings_audit_no_truncate before truncate on public.settings_audit
  for each statement execute function public.settings_audit_is_append_only();

-- --------------------------------------------------------------------------
-- The one writer
-- --------------------------------------------------------------------------

-- Values as text, so any type is expressible: a JSON string unwrapped, anything else as JSON.
create or replace function public.settings_audit_text(p_value jsonb)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case when p_value is null or p_value = 'null'::jsonb then null
              when jsonb_typeof(p_value) = 'string' then left(p_value #>> '{}', 4000)
              else left(p_value::text, 4000) end;
$$;

-- "first_payment_window_days" → "First payment window days".
create or replace function public.settings_audit_label(p_key text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select left(upper(left(replace(replace(p_key, '_', ' '), '.', ' › '), 1)) || substr(replace(replace(p_key, '_', ' '), '.', ' › '), 2), 300);
$$;

create or replace function public.record_settings_audit(
  p_tenant_id uuid, p_section_key text, p_setting_key text, p_setting_label text,
  p_old jsonb, p_new jsonb, p_actor uuid, p_source text default 'ui', p_reason text default null, p_change_type text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_role text;
  v_actor uuid := p_actor;
begin
  -- JSON null and no value are the same thing here: an empty column on a new row is not a change.
  if nullif(p_old, 'null'::jsonb) is not distinct from nullif(p_new, 'null'::jsonb) then
    return;
  end if;
  -- accounting_setting_change.changed_by has no foreign key; an id that is no user is not an actor,
  -- and must not make the hub's own save fail.
  if v_actor is not null and not exists (select 1 from public.users u where u.id = v_actor) then
    v_actor := null;
  end if;
  -- The role held now, at the moment of the change — kept, never re-read.
  select tu.role::text into v_role from public.tenant_users tu where tu.tenant_id = p_tenant_id and tu.user_id = v_actor;
  insert into public.settings_audit (tenant_id, section_key, setting_key, setting_label, old_value, new_value, change_type, actor_user_id, actor_role, source, reason)
  values (
    p_tenant_id, p_section_key, left(p_setting_key, 200), left(coalesce(nullif(btrim(p_setting_label), ''), public.settings_audit_label(p_setting_key)), 300),
    public.settings_audit_text(p_old), public.settings_audit_text(p_new),
    coalesce(p_change_type, case when p_old is null or p_old = 'null'::jsonb then 'create' when p_new is null or p_new = 'null'::jsonb then 'delete' else 'update' end),
    v_actor, v_role, coalesce(p_source, 'ui'), left(p_reason, 2000)
  );
end;
$$;

revoke all on function public.record_settings_audit(uuid, text, text, text, jsonb, jsonb, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_settings_audit(uuid, text, text, text, jsonb, jsonb, uuid, text, text, text) to service_role;

-- --------------------------------------------------------------------------
-- The three hubs with their own change tables: copy each row across
-- --------------------------------------------------------------------------

create or replace function public.settings_audit_from_change_table()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_section text := tg_argv[0];
  v_row jsonb := to_jsonb(new);
  v_key text;
  v_actor uuid;
begin
  -- accounting: field · compliance: section.setting · retention: setting
  v_key := case tg_table_name
             when 'accounting_setting_change' then v_row->>'field'
             when 'compliance_setting_change' then (v_row->>'section') || '.' || (v_row->>'setting')
             else v_row->>'setting' end;
  v_actor := nullif(v_row->>'changed_by', '')::uuid;
  perform public.record_settings_audit(new.tenant_id, v_section, v_key, public.settings_audit_label(v_key), v_row->'old_value', v_row->'new_value', v_actor, 'ui', null);
  return null;
end;
$$;

drop trigger if exists settings_audit_capture on public.accounting_setting_change;
create trigger settings_audit_capture after insert on public.accounting_setting_change
  for each row execute function public.settings_audit_from_change_table('accounting');
drop trigger if exists settings_audit_capture on public.compliance_setting_change;
create trigger settings_audit_capture after insert on public.compliance_setting_change
  for each row execute function public.settings_audit_from_change_table('compliance');
drop trigger if exists settings_audit_capture on public.retention_setting_change;
create trigger settings_audit_capture after insert on public.retention_setting_change
  for each row execute function public.settings_audit_from_change_table('retention');

-- --------------------------------------------------------------------------
-- Sales (LA-3.17) and carrier rules (LA-4.17): diff the saved row, field by field
-- --------------------------------------------------------------------------

-- tenant_sales_settings keeps every setting in one JSON object; each top-level key is a setting.
create or replace function public.settings_audit_sales_settings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_old jsonb := case when tg_op = 'UPDATE' then old.settings else '{}'::jsonb end;
  k text;
begin
  for k in select key from jsonb_object_keys(v_old || new.settings) as key loop
    if (v_old->k) is distinct from (new.settings->k) then
      perform public.record_settings_audit(new.tenant_id, 'sales-preferences', k, public.settings_audit_label(k), v_old->k, new.settings->k, new.updated_by, 'ui', null);
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists settings_audit_capture on public.tenant_sales_settings;
create trigger settings_audit_capture after insert or update on public.tenant_sales_settings
  for each row execute function public.settings_audit_sales_settings();

-- A row of named columns per carrier: tenant_carrier_settings (LA-3.17) and carrier_operating_settings
-- (LA-4.17). tg_argv: section key, then the columns that are settings.
create or replace function public.settings_audit_carrier_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_new jsonb := to_jsonb(new);
  v_carrier text;
  v_tenant uuid := nullif(v_new->>'tenant_id', '')::uuid;
  i integer;
  k text;
begin
  if v_tenant is null then
    return null;  -- a platform default, set by staff: not an agency's setting
  end if;
  select c.name into v_carrier from public.carriers c where c.id = (v_new->>'carrier_id')::uuid;
  for i in 1 .. tg_nargs - 1 loop
    k := tg_argv[i];
    if (v_old->k) is distinct from (v_new->k) then
      perform public.record_settings_audit(v_tenant, tg_argv[0], (v_new->>'carrier_id') || '.' || k,
        coalesce(v_carrier, 'Carrier') || ' › ' || public.settings_audit_label(k), v_old->k, v_new->k, nullif(v_new->>'updated_by', '')::uuid, 'ui', null);
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists settings_audit_capture on public.tenant_carrier_settings;
create trigger settings_audit_capture after insert or update on public.tenant_carrier_settings
  for each row execute function public.settings_audit_carrier_columns('sales-carriers', 'portal_origin', 'reference_pattern', 'billing_descriptor');
drop trigger if exists settings_audit_capture on public.carrier_operating_settings;
create trigger settings_audit_capture after insert or update on public.carrier_operating_settings
  for each row execute function public.settings_audit_carrier_columns('carrier-rules', 'commission_trigger', 'expected_lag_days', 'minimum_payout_cents', 'tolerance_cents', 'expected_cadence', 'statement_format');

-- carrier_retention_rule is versioned: a change is a new row from a date. Compared with the agency's
-- previous version of the same rule (or nothing); the source and note are the reason.
create or replace function public.settings_audit_carrier_rule()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_prev public.carrier_retention_rule%rowtype;
  v_carrier text;
  v_fields text[] := array['window_days', 'grace_days', 'redraft_attempts', 'redraft_interval_days', 'cleared'];
  k text;
  v_old jsonb;
  v_new jsonb := to_jsonb(new);
begin
  if new.tenant_id is null then
    return null;
  end if;
  select * into v_prev from public.carrier_retention_rule r
   where r.tenant_id = new.tenant_id and r.carrier_id = new.carrier_id and r.rule_type = new.rule_type and r.id <> new.id
   order by r.effective_from desc, r.created_at desc limit 1;
  v_old := case when v_prev.id is null then '{}'::jsonb else to_jsonb(v_prev) end;
  select c.name into v_carrier from public.carriers c where c.id = new.carrier_id;
  foreach k in array v_fields loop
    if (v_old->k) is distinct from (v_new->k) and not (k = 'cleared' and v_prev.id is null and not new.cleared) then
      perform public.record_settings_audit(new.tenant_id, 'carrier-rules', new.carrier_id || '.' || new.rule_type || '.' || k,
        coalesce(v_carrier, 'Carrier') || ' › ' || public.settings_audit_label(new.rule_type) || ' › ' || public.settings_audit_label(k),
        v_old->k, v_new->k, new.created_by, 'ui',
        nullif(concat_ws(' · ', 'from ' || new.effective_from, 'source: ' || replace(new.source, '_', ' '), new.notes), ''),
        case when k = 'cleared' and new.cleared then 'reset_to_default' end);
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists settings_audit_capture on public.carrier_retention_rule;
create trigger settings_audit_capture after insert on public.carrier_retention_rule
  for each row execute function public.settings_audit_carrier_rule();

revoke all on function public.settings_audit_from_change_table(), public.settings_audit_sales_settings(), public.settings_audit_carrier_columns(), public.settings_audit_carrier_rule(), public.settings_audit_is_append_only() from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- Backfill: what the three change tables already hold
-- --------------------------------------------------------------------------

insert into public.settings_audit (tenant_id, section_key, setting_key, setting_label, old_value, new_value, change_type, actor_user_id, actor_role, occurred_at, source)
select c.tenant_id, 'accounting', c.field, public.settings_audit_label(c.field), public.settings_audit_text(c.old_value), public.settings_audit_text(c.new_value),
       case when c.old_value is null then 'create' when c.new_value is null then 'delete' else 'update' end, u.id, null, c.changed_at, 'migration'
  from public.accounting_setting_change c left join public.users u on u.id = c.changed_by
 where not exists (select 1 from public.settings_audit a where a.tenant_id = c.tenant_id and a.section_key = 'accounting' and a.setting_key = c.field and a.occurred_at = c.changed_at);

insert into public.settings_audit (tenant_id, section_key, setting_key, setting_label, old_value, new_value, change_type, actor_user_id, actor_role, occurred_at, source)
select c.tenant_id, 'compliance', c.section || '.' || c.setting, public.settings_audit_label(c.section || '.' || c.setting), public.settings_audit_text(c.old_value), public.settings_audit_text(c.new_value),
       case when c.old_value is null then 'create' when c.new_value is null then 'delete' else 'update' end, c.changed_by, null, c.changed_at, 'migration'
  from public.compliance_setting_change c
 where not exists (select 1 from public.settings_audit a where a.tenant_id = c.tenant_id and a.section_key = 'compliance' and a.setting_key = c.section || '.' || c.setting and a.occurred_at = c.changed_at);

insert into public.settings_audit (tenant_id, section_key, setting_key, setting_label, old_value, new_value, change_type, actor_user_id, actor_role, occurred_at, source)
select c.tenant_id, 'retention', c.setting, public.settings_audit_label(c.setting), public.settings_audit_text(c.old_value), public.settings_audit_text(c.new_value),
       case when c.old_value is null then 'create' when c.new_value is null then 'delete' else 'update' end, c.changed_by, null, c.changed_at, 'migration'
  from public.retention_setting_change c
 where not exists (select 1 from public.settings_audit a where a.tenant_id = c.tenant_id and a.section_key = 'retention' and a.setting_key = c.setting and a.occurred_at = c.changed_at);

-- --------------------------------------------------------------------------
-- Self-check: the log refuses change, even from the service role
-- --------------------------------------------------------------------------

do $$
declare
  v_left text;
begin
  select string_agg(p, ', ') into v_left
    from unnest(array['UPDATE', 'DELETE', 'TRUNCATE']) p
   where has_table_privilege('service_role', 'public.settings_audit', p)
      or has_table_privilege('authenticated', 'public.settings_audit', p);
  if v_left is not null then
    raise exception 'LA-8.8: settings_audit still allows %', v_left;
  end if;
  if (select count(*) from pg_trigger where tgname = 'settings_audit_capture' and not tgisinternal) < 7 then
    raise exception 'LA-8.8: a hub is not writing to settings_audit';
  end if;
end;
$$;
