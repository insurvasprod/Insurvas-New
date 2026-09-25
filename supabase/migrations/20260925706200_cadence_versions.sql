-- ---------------------------------------------------------------------------
-- Dialing cadence · every save is kept as a version
--
-- Campaigns concept audit (LA-2 §5, 2026-09-25). The board's campaign comparison carries a caveat:
-- "Same period, similar volume, different cadence … this compares two things at once." The product
-- could not say it, because tenant_cadence_rules holds only the rules in force now, and the
-- tenant.cadence_updated audit row records a count, not the rules. Which cadence a campaign ran
-- last month was not recorded anywhere.
--
-- User decision: yes — a versions table, written by replace_cadence_rules on every save.
--
--   tenant_cadence_versions   one row per save: the scope (tenant default when campaign_id is
--                             null), the rules as stored, a fingerprint for comparing two
--                             versions, who saved it and when. source = 'save' for a save,
--                             'baseline' for the snapshot this migration takes of what is in
--                             force at the moment it is applied.
--
-- History exists only from this migration on. The baseline makes the moment explicit: for a tenant
-- that existed before, nothing earlier than its baseline is known, and the comparison says so
-- rather than assuming the current cadence always ran. A tenant created afterwards has no baseline
-- and ran the built-in cadence until its first save (no other path writes cadence rules).
--
-- replace_cadence_rules is restated from its only definition (20260924230300) with one addition:
-- after the insert, the version row. It gains p_saved_by (default null), so the signature changes
-- and the old function is dropped first; the grants are re-applied exactly (service_role only).
-- The refusals the settings screen depends on — CADENCE_TENANT_REQUIRED, which is also its
-- "is 230300 applied" probe (lib/cadence/service.ts cadenceSchemaReady), CADENCE_ROWS_INVALID and
-- CADENCE_CAMPAIGN_NOT_FOUND — and the per-scope advisory lock are unchanged and asserted below.
-- ---------------------------------------------------------------------------

create table if not exists public.tenant_cadence_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Null is the tenant default. A deleted campaign takes its history with it.
  campaign_id uuid references public.tenant_campaigns(id) on delete cascade,
  rules jsonb not null default '[]'::jsonb check (jsonb_typeof(rules) = 'array'),
  rule_count integer not null default 0 check (rule_count >= 0),
  fingerprint text not null,
  source text not null default 'save' check (source in ('save', 'baseline')),
  saved_by uuid references public.users(id) on delete set null,
  saved_at timestamptz not null default now()
);

create index if not exists tenant_cadence_versions_scope_idx
  on public.tenant_cadence_versions (tenant_id, campaign_id, saved_at desc);

alter table public.tenant_cadence_versions enable row level security;

drop policy if exists tenant_cadence_versions_tenant_scoped on public.tenant_cadence_versions;
create policy tenant_cadence_versions_tenant_scoped
  on public.tenant_cadence_versions
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_cadence_versions from anon, authenticated, public;
grant select on public.tenant_cadence_versions to tenant_app;
grant select, insert on public.tenant_cadence_versions to service_role;

-- The rules of one scope, in one canonical order and shape, so two identical cadences produce the
-- same fingerprint whatever order they were saved in. The interval is Postgres's own rendering.
create or replace function public.cadence_scope_rules(p_tenant_id uuid, p_campaign_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'attempt_number', r.attempt_number,
        'delay_interval', r.delay_interval::text,
        'preferred_slot', r.preferred_slot,
        'disposition_scope', r.disposition_scope
      )
      order by r.attempt_number, r.disposition_scope nulls first
    ),
    '[]'::jsonb
  )
  from public.tenant_cadence_rules r
  where r.tenant_id = p_tenant_id
    and r.campaign_id is not distinct from p_campaign_id;
$function$;

revoke all on function public.cadence_scope_rules(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.cadence_scope_rules(uuid, uuid) to service_role;

-- ── the atomic save, now leaving a version behind ──────────────────────────
drop function if exists public.replace_cadence_rules(uuid, uuid, jsonb);

create or replace function public.replace_cadence_rules(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_rows jsonb,
  p_saved_by uuid default null
)
returns setof public.tenant_cadence_rules
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rules jsonb;
begin
  if p_tenant_id is null then
    raise exception 'CADENCE_TENANT_REQUIRED';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'CADENCE_ROWS_INVALID';
  end if;
  if p_campaign_id is not null and not exists (
    select 1 from tenant_campaigns c where c.id = p_campaign_id and c.tenant_id = p_tenant_id
  ) then
    raise exception 'CADENCE_CAMPAIGN_NOT_FOUND';
  end if;

  -- Two owners saving the same scope at once get one result each, in order, never an interleaving.
  perform pg_advisory_xact_lock(
    hashtextextended('cadence:' || p_tenant_id::text || ':' || coalesce(p_campaign_id::text, 'default'), 0)
  );

  delete from tenant_cadence_rules r
   where r.tenant_id = p_tenant_id
     and r.campaign_id is not distinct from p_campaign_id;

  insert into tenant_cadence_rules
    (tenant_id, campaign_id, attempt_number, delay_interval, preferred_slot, disposition_scope)
  select p_tenant_id,
         p_campaign_id,
         (e->>'attemptNumber')::integer,
         (e->>'delayInterval')::interval,
         nullif(e->>'preferredSlot', ''),
         nullif(btrim(coalesce(e->>'dispositionScope', '')), '')
    from jsonb_array_elements(p_rows) as e;

  -- The version, in the same transaction as the rules it describes: a save that rolls back leaves
  -- no version, and a version never describes rules that were not stored.
  v_rules := cadence_scope_rules(p_tenant_id, p_campaign_id);
  insert into tenant_cadence_versions (tenant_id, campaign_id, rules, rule_count, fingerprint, source, saved_by)
  values (p_tenant_id, p_campaign_id, v_rules, jsonb_array_length(v_rules), md5(v_rules::text), 'save', p_saved_by);

  return query
  select r.* from tenant_cadence_rules r
   where r.tenant_id = p_tenant_id
     and r.campaign_id is not distinct from p_campaign_id
   order by r.attempt_number, r.disposition_scope nulls first;
end;
$function$;

revoke all on function public.replace_cadence_rules(uuid, uuid, jsonb, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.replace_cadence_rules(uuid, uuid, jsonb, uuid) to service_role;

-- ── the baseline: what is in force now ─────────────────────────────────────
-- Every tenant gets a tenant-default baseline (an empty one means the built-in cadence), and every
-- campaign that has rules of its own gets one. Once per scope: re-running this file adds nothing.
-- Guarded only so scripts/check-migrations.mjs (which cannot create the table) can run the rest of
-- the file; applied for real, the table always exists here.
do $$
begin
  if to_regclass('public.tenant_cadence_versions') is null then
    return;
  end if;

  insert into public.tenant_cadence_versions (tenant_id, campaign_id, rules, rule_count, fingerprint, source)
  select t.id, null, x.rules, jsonb_array_length(x.rules), md5(x.rules::text), 'baseline'
    from public.tenants t
    cross join lateral (select public.cadence_scope_rules(t.id, null) as rules) x
   where not exists (
     select 1 from public.tenant_cadence_versions v
      where v.tenant_id = t.id and v.campaign_id is null and v.source = 'baseline'
   );

  insert into public.tenant_cadence_versions (tenant_id, campaign_id, rules, rule_count, fingerprint, source)
  select s.tenant_id, s.campaign_id, x.rules, jsonb_array_length(x.rules), md5(x.rules::text), 'baseline'
    from (select distinct r.tenant_id, r.campaign_id
            from public.tenant_cadence_rules r
           where r.campaign_id is not null) s
    cross join lateral (select public.cadence_scope_rules(s.tenant_id, s.campaign_id) as rules) x
   where not exists (
     select 1 from public.tenant_cadence_versions v
      where v.tenant_id = s.tenant_id and v.campaign_id = s.campaign_id and v.source = 'baseline'
   );
end $$;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
  v_count integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925706200: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  select count(*), max(pg_get_functiondef(p.oid)) into v_count, v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'replace_cadence_rules';
  if v_count <> 1 then
    raise exception 'replace_cadence_rules has % definitions; the three-argument one must be gone', v_count;
  end if;

  -- What the settings screen and the route depend on survived the restatement.
  if v_def !~ 'CADENCE_TENANT_REQUIRED' then
    raise exception 'replace_cadence_rules no longer refuses a missing tenant (the schema probe depends on it)';
  end if;
  if v_def !~ 'CADENCE_ROWS_INVALID' or v_def !~ 'CADENCE_CAMPAIGN_NOT_FOUND' or v_def !~ 'pg_advisory_xact_lock' then
    raise exception 'replace_cadence_rules lost a refusal or its per-scope lock';
  end if;
  if v_def !~ 'insert into tenant_cadence_versions' then
    raise exception 'replace_cadence_rules does not record a version';
  end if;

  if has_function_privilege('tenant_app', 'public.replace_cadence_rules(uuid, uuid, jsonb, uuid)', 'execute') then
    raise exception 'the tenant plane can replace cadence rules directly';
  end if;
  if not exists (select 1 from pg_class where relname = 'tenant_cadence_versions' and relrowsecurity) then
    raise exception 'tenant_cadence_versions has no row security';
  end if;

  -- Every tenant has a baseline for its default scope.
  if exists (
    select 1 from public.tenants t
     where not exists (select 1 from public.tenant_cadence_versions v
                        where v.tenant_id = t.id and v.campaign_id is null)
  ) then
    raise exception 'a tenant has no cadence baseline';
  end if;
end $$;
