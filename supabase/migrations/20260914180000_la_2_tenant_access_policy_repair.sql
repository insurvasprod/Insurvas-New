-- LA-2 / SA-0.4 security repair discovered by the live tenant-app inventory.
--
-- The preceding LA migrations created these tables and grants but did not create the matching RLS
-- policies. With RLS enabled, a grant without a policy is an empty read and a denied write. Keep the
-- repair explicit and reversible: it restores the intended tenant_app scope and does not broaden
-- anon/authenticated access.

-- Statutory calling-window data is platform-owned and read-only to the tenant plane.
alter table public.calling_window_state_rules enable row level security;
drop policy if exists calling_window_state_rules_tenant_read on public.calling_window_state_rules;
create policy calling_window_state_rules_tenant_read
  on public.calling_window_state_rules
  for select to tenant_app
  using (true);

alter table public.calling_window_holidays enable row level security;
drop policy if exists calling_window_holidays_tenant_read on public.calling_window_holidays;
create policy calling_window_holidays_tenant_read
  on public.calling_window_holidays
  for select to tenant_app
  using (true);

-- Tenant-owned operational/configuration tables use the authenticated database tenant setting.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'tenant_application_cases',
    'tenant_contact_rate_stats',
    'tenant_scoring_decisions',
    'tenant_scoring_settings',
    'tenant_scoring_weights'
  ] loop
    if to_regclass(format('public.%s', table_name)) is null then
      raise exception 'required tenant table public.% does not exist', table_name;
    end if;

    execute format('drop policy if exists %I on public.%I', table_name || '_tenant_scoped', table_name);
    execute format($policy$
      create policy %I on public.%I
        for all to tenant_app
        using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
        with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
    $policy$, table_name || '_tenant_scoped', table_name);
  end loop;
end $$;

-- The key hash is never exposed. The tenant plane may inspect safe metadata only; service_role owns
-- creation, rotation, and revocation.
grant select (id, tenant_id, vendor_id, key_prefix, field_map, is_active, created_at, rotated_at, last_used_at)
  on public.tenant_vendor_post_keys to tenant_app;

-- Fail loudly during promotion if the repair did not produce the intended policy set.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'calling_window_state_rules',
    'calling_window_holidays',
    'tenant_application_cases',
    'tenant_contact_rate_stats',
    'tenant_scoring_decisions',
    'tenant_scoring_settings',
    'tenant_scoring_weights'
  ] loop
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = table_name
        and policyname = case
          when table_name like 'calling_window_%' then table_name || '_tenant_read'
          else table_name || '_tenant_scoped'
        end
    ) then
      raise exception 'tenant access policy missing after repair: %', table_name;
    end if;
  end loop;
end $$;
