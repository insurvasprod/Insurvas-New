-- LA-2.22 · Outbound subscription limits
--
-- The tenant app reads the cap from tenant_entitlements. These database guards are the second
-- line: a forged REST/RPC request, an old client, or two racing requests cannot create a member or
-- activate a campaign beyond the plan. Pausing changes the counted status, so the slot is released
-- in the same committed update.

alter table public.plan_limits
  add column if not exists max_setter_seats integer,
  add column if not exists max_active_campaigns integer;

do $$
begin
  alter table public.plan_limits drop constraint if exists plan_limits_non_negative;
  alter table public.plan_limits add constraint plan_limits_non_negative check (
    coalesce(max_seats, 0) >= 0 and coalesce(max_carriers, 0) >= 0
    and coalesce(max_publishers, 0) >= 0 and coalesce(max_marketing_partners, 0) >= 0
    and coalesce(max_affiliates, 0) >= 0 and coalesce(max_buffer_seats, 0) >= 0
    and coalesce(max_partner_users, 0) >= 0 and coalesce(max_setter_seats, 0) >= 0
    and coalesce(max_active_campaigns, 0) >= 0
  );
exception when duplicate_object then null;
end $$;

insert into public.meters (meter_key, unit, label, default_hard_cap, sort_order) values
  ('monthly_leads_imported', 'lead', 'Leads imported this month', true, 7),
  ('consent_cert_claims', 'claim', 'Consent certificate claims', true, 8)
on conflict (meter_key) do update set
  unit = excluded.unit,
  label = excluded.label,
  default_hard_cap = excluded.default_hard_cap,
  sort_order = excluded.sort_order;

-- Normalize snapshots written before LA-2.22. The plan lookup is contained in this security-definer
-- compatibility function; callers receive and enforce the resulting entitlement object.
create or replace function public.ensure_outbound_entitlement(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_entitlement jsonb;
  v_plan_id uuid;
  v_limits public.plan_limits%rowtype;
begin
  select entitlement into v_entitlement from public.tenant_entitlements where tenant_id = p_tenant_id;
  if v_entitlement is null then
    v_entitlement := public.refresh_tenant_entitlement(p_tenant_id);
  end if;

  select s.plan_id into v_plan_id
    from public.subscriptions s
   where s.tenant_id = p_tenant_id and s.status <> 'cancelled'
   order by s.started_at desc limit 1;
  if v_plan_id is not null then
    select pl.* into v_limits from public.plan_limits pl where pl.plan_id = v_plan_id;
  end if;

  v_entitlement := jsonb_set(v_entitlement, '{limits,max_setter_seats}', coalesce(to_jsonb(v_limits.max_setter_seats), 'null'::jsonb), true);
  v_entitlement := jsonb_set(v_entitlement, '{limits,max_active_campaigns}', coalesce(to_jsonb(v_limits.max_active_campaigns), 'null'::jsonb), true);
  update public.tenant_entitlements
     set entitlement = v_entitlement, computed_at = now()
   where tenant_id = p_tenant_id;
  return v_entitlement;
end;
$$;

revoke all on function public.ensure_outbound_entitlement(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.ensure_outbound_entitlement(uuid) to service_role;

-- No-subscription bridge tenants keep the existing generous compatibility defaults, now including
-- the two outbound fixed-limit keys.
create or replace function public.la0_default_entitlement(p_tenant_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'tenant_id', t.id,
    'plan_code', coalesce(t.plan_code, 'individual'),
    'plan_version', 1,
    'status', case when t.status = 'suspended' then 'suspended' when t.status = 'cancelled' then 'cancelled' else 'active' end,
    'access', case when t.status = 'suspended' then 'read_only' when t.status = 'cancelled' then 'none' else 'full' end,
    'computed_at', now(),
    'features', jsonb_build_array('book_of_business','statement_ingestion','commission_ledger','appointment_vault','duplicate_detection','inbound_transfers','outbound_dialing','lead_import','callback_calendar'),
    'meters', '{}'::jsonb,
    'limits', jsonb_build_object('max_seats', 25, 'max_publishers', null, 'max_marketing_partners', null, 'max_affiliates', null, 'max_buffer_seats', 5, 'max_partner_users', 25, 'max_setter_seats', 25, 'max_active_campaigns', null),
    'period_start', now()
  )
  from public.tenants t where t.id = p_tenant_id;
$$;

create or replace function public.enforce_outbound_fixed_limits()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_plan uuid;
  v_cap integer;
  v_used integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text, 0));
  v_plan := public.tenant_current_plan(new.tenant_id);

  if TG_TABLE_NAME = 'tenant_users' and new.role::text = 'setter' then
    select max_setter_seats into v_cap from public.plan_limits where plan_id = v_plan;
    if v_cap is not null then
      select count(*)::integer into v_used from public.tenant_users where tenant_id = new.tenant_id and role::text = 'setter';
      if v_used > v_cap then raise exception 'max_setter_seats:%:%', v_used - 1, v_cap; end if;
    end if;
  elsif TG_TABLE_NAME = 'tenant_campaigns' and new.status = 'active' then
    select max_active_campaigns into v_cap from public.plan_limits where plan_id = v_plan;
    if v_cap is not null then
      select count(*)::integer into v_used from public.tenant_campaigns where tenant_id = new.tenant_id and status = 'active';
      if v_used > v_cap then raise exception 'max_active_campaigns:%:%', v_used - 1, v_cap; end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tenant_users_outbound_setter_limit on public.tenant_users;
create constraint trigger tenant_users_outbound_setter_limit
after insert or update of tenant_id, role on public.tenant_users
deferrable initially immediate for each row execute function public.enforce_outbound_fixed_limits();

drop trigger if exists tenant_campaigns_outbound_active_limit on public.tenant_campaigns;
create constraint trigger tenant_campaigns_outbound_active_limit
after insert or update of tenant_id, status on public.tenant_campaigns
deferrable initially immediate for each row execute function public.enforce_outbound_fixed_limits();

revoke all on function public.enforce_outbound_fixed_limits() from public, anon, authenticated, tenant_app;

-- Screening is concurrent by design. This operation holds a tenant/meter lock while checking
-- and recording the event, so a hard-capped DNC allowance cannot be overshot by parallel imports.
create or replace function public.consume_meter_capacity(
  p_tenant_id uuid,
  p_meter_key text,
  p_qty integer,
  p_idempotency_key text,
  p_ref text default null
)
returns table (allowed boolean, used integer, included integer, hard_cap boolean, pct_used numeric, reason text)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_period timestamptz;
  v_check record;
  v_existing boolean;
begin
  if p_qty < 1 or p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'meter quantity and idempotency key are required' using errcode = 'invalid_parameter_value';
  end if;
  v_period := public.tenant_current_period_start(p_tenant_id);
  perform pg_advisory_xact_lock(hashtextextended('meter:' || p_tenant_id::text || ':' || p_meter_key, 0));
  select exists (select 1 from public.usage_events where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key) into v_existing;
  select * into v_check from public.check_meter_capacity(p_tenant_id, p_meter_key, p_qty);
  if not v_existing and not v_check.allowed and v_check.hard_cap then
    return query select v_check.allowed, v_check.used, v_check.included, v_check.hard_cap, v_check.pct_used, v_check.reason;
    return;
  end if;
  if not v_existing then
    insert into public.usage_events (tenant_id, meter_key, qty, ref, idempotency_key, period_start)
    values (p_tenant_id, p_meter_key, p_qty, p_ref, p_idempotency_key, v_period);
    insert into public.usage_totals (tenant_id, meter_key, period_start, used_qty, updated_at)
    values (p_tenant_id, p_meter_key, v_period, p_qty, now())
    on conflict (tenant_id, meter_key, period_start) do update
      set used_qty = public.usage_totals.used_qty + excluded.used_qty, updated_at = now();
  end if;
  select * into v_check from public.check_meter_capacity(p_tenant_id, p_meter_key, 1);
  return query select true, v_check.used, v_check.included, v_check.hard_cap, v_check.pct_used, v_check.reason;
end;
$$;

revoke all on function public.consume_meter_capacity(uuid, text, integer, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.consume_meter_capacity(uuid, text, integer, text, text) to service_role;

-- Assertions are intentionally structural: the live project may have no plan configured yet.
do $$
begin
  if not exists (select 1 from public.meters where meter_key = 'monthly_leads_imported') then raise exception 'monthly leads meter missing'; end if;
  if not exists (select 1 from public.meters where meter_key = 'consent_cert_claims') then raise exception 'consent claims meter missing'; end if;
end $$;
