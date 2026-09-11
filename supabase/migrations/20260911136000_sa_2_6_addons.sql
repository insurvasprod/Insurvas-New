-- SA-2.6 · Add-ons
--
-- "The super admin can sell something extra without creating a whole new plan."
--
-- The instruction that shapes this migration is the emphasised one: "Add-ons feed the entitlement
-- exactly like plan features — do not build a parallel entitlement path for them." So there is no
-- addon branch in the agent app and no second enforcement route. `refresh_tenant_entitlement` is
-- superseded once more to UNION add-on features into the feature list and SUM add-on credits into
-- the meter allowances. Everything downstream — requireFeature, the menu, check_meter_capacity —
-- keeps working unchanged, because to them an add-on feature is just a feature.
--
-- Error contracts come from app/api/admin/subscriptions/[id]/addons/route.ts, which already
-- handles cycle_mismatch:<addon>:<sub>, not_available_on_plan, addon_inactive, and 23505 for an
-- add-on that is already attached.

-- --------------------------------------------------------------------------
-- Catalogue
-- --------------------------------------------------------------------------

create table if not exists public.addons (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  description   text,
  price_cents   integer not null,
  billing_cycle public.billing_cycle not null default 'monthly',
  is_active     boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);

comment on table public.addons is
  'SA-2.6 · An optional extra sold on top of a plan. price_cents is integer cents, like every '
  'other amount in the system.';

do $$ begin
  alter table public.addons add constraint addons_price_non_negative check (price_cents >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.addons add constraint addons_code_format check (code ~ '^[a-z][a-z0-9_]*$');
exception when duplicate_object then null; end $$;

create table if not exists public.addon_features (
  addon_id    uuid not null,
  feature_key text not null,
  constraint addon_features_pkey primary key (addon_id, feature_key)
);

create table if not exists public.addon_meters (
  addon_id     uuid not null,
  meter_key    text not null,
  included_qty integer not null,
  constraint addon_meters_pkey primary key (addon_id, meter_key)
);

comment on column public.addon_meters.included_qty is
  'Credits this add-on grants. NOT NULL and stacking: an add-on tops the plan allowance up, it '
  'never replaces it and never makes a metered thing unlimited.';

create table if not exists public.plan_available_addons (
  plan_id  uuid not null,
  addon_id uuid not null,
  constraint plan_available_addons_pkey primary key (plan_id, addon_id)
);

comment on table public.plan_available_addons is
  'SA-2.6 · Which add-ons a plan offers. An admin may still attach one that is not offered, by '
  'overriding — the override is recorded on the attachment.';

do $$ begin
  alter table public.addon_features add constraint addon_features_addon_id_fkey
    foreign key (addon_id) references public.addons (id) on delete cascade;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.addon_features add constraint addon_features_feature_key_fkey
    foreign key (feature_key) references public.features (feature_key) on update cascade;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.addon_meters add constraint addon_meters_addon_id_fkey
    foreign key (addon_id) references public.addons (id) on delete cascade;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.addon_meters add constraint addon_meters_meter_key_fkey
    foreign key (meter_key) references public.meters (meter_key) on update cascade;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.addon_meters add constraint addon_meters_qty_positive check (included_qty > 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.plan_available_addons add constraint plan_available_addons_plan_id_fkey
    foreign key (plan_id) references public.plans (id) on delete cascade;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.plan_available_addons add constraint plan_available_addons_addon_id_fkey
    foreign key (addon_id) references public.addons (id) on delete cascade;
exception when duplicate_object then null; end $$;

-- --------------------------------------------------------------------------
-- Attachments
-- --------------------------------------------------------------------------

create table if not exists public.subscription_addons (
  id                      uuid primary key default gen_random_uuid(),
  subscription_id         uuid not null,
  addon_id                uuid not null,
  attached_at             timestamptz not null default now(),
  attached_by             uuid,
  detached_at             timestamptz,
  availability_overridden boolean not null default false
);

comment on table public.subscription_addons is
  'SA-2.6 · Soft-detached on removal: the row survives with detached_at set, so a past invoice '
  'can still explain what was charged. Never deleted.';

do $$ begin
  alter table public.subscription_addons add constraint subscription_addons_subscription_id_fkey
    foreign key (subscription_id) references public.subscriptions (id) on delete cascade;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.subscription_addons add constraint subscription_addons_addon_id_fkey
    foreign key (addon_id) references public.addons (id);
exception when duplicate_object then null; end $$;

-- One live attachment of a given add-on per subscription. This is the 23505 the attach route
-- reports as "That add-on is already attached"; a detached row does not block re-attaching.
create unique index if not exists subscription_addons_live_idx
  on public.subscription_addons (subscription_id, addon_id) where detached_at is null;

create index if not exists subscription_addons_subscription_idx
  on public.subscription_addons (subscription_id) where detached_at is null;

-- --------------------------------------------------------------------------
-- Attach / detach
-- --------------------------------------------------------------------------

create or replace function public.admin_attach_addon(
  p_subscription_id       uuid,
  p_addon_id              uuid,
  p_override_availability boolean default false,
  p_attached_by           uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sub   public.subscriptions%rowtype;
  v_addon public.addons%rowtype;
  v_id    uuid;
begin
  select * into v_sub from public.subscriptions where id = p_subscription_id;
  if v_sub.id is null then
    raise exception 'subscription_not_found' using errcode = 'foreign_key_violation';
  end if;

  select * into v_addon from public.addons where id = p_addon_id;
  if v_addon.id is null then
    raise exception 'addon_not_found' using errcode = 'foreign_key_violation';
  end if;

  if not v_addon.is_active then
    raise exception 'addon_inactive' using errcode = 'check_violation';
  end if;

  -- Cycles must match: an add-on billed yearly on a monthly subscription has no coherent invoice
  -- line. The route parses this message to name both cycles back to the admin.
  if v_addon.billing_cycle <> v_sub.billing_cycle then
    raise exception 'cycle_mismatch:%:%', v_addon.billing_cycle, v_sub.billing_cycle
      using errcode = 'check_violation';
  end if;

  if not p_override_availability
     and not exists (
       select 1 from public.plan_available_addons
        where plan_id = v_sub.plan_id and addon_id = p_addon_id
     ) then
    raise exception 'not_available_on_plan' using errcode = 'check_violation';
  end if;

  insert into public.subscription_addons
    (subscription_id, addon_id, attached_by, availability_overridden)
  values
    (p_subscription_id, p_addon_id, p_attached_by,
     p_override_availability
       and not exists (select 1 from public.plan_available_addons
                        where plan_id = v_sub.plan_id and addon_id = p_addon_id))
  returning id into v_id;

  -- "Attaching an add-on grants its features within seconds, on the next page load."
  perform public.refresh_tenant_entitlement(v_sub.tenant_id);

  return v_id;
end;
$$;

create or replace function public.admin_detach_addon_for_subscription(
  p_subscription_id       uuid,
  p_subscription_addon_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant uuid;
  v_hit    boolean := false;
begin
  select s.tenant_id into v_tenant
    from public.subscriptions s where s.id = p_subscription_id;
  if v_tenant is null then
    raise exception 'subscription_not_found' using errcode = 'foreign_key_violation';
  end if;

  -- Soft detach only. The attachment is part of the billing record.
  update public.subscription_addons
     set detached_at = now()
   where id = p_subscription_addon_id
     and subscription_id = p_subscription_id
     and detached_at is null;

  v_hit := found;

  if v_hit then
    -- "Detaching removes them, and the agent's menu shrinks accordingly."
    perform public.refresh_tenant_entitlement(v_tenant);
  end if;

  return v_hit;
end;
$$;

-- --------------------------------------------------------------------------
-- Access
-- --------------------------------------------------------------------------

alter table public.addons                enable row level security;
alter table public.addon_features        enable row level security;
alter table public.addon_meters          enable row level security;
alter table public.plan_available_addons enable row level security;
alter table public.subscription_addons   enable row level security;

drop policy if exists addons_service_role_only on public.addons;
create policy addons_service_role_only on public.addons for all to service_role using (true) with check (true);
drop policy if exists addon_features_service_role_only on public.addon_features;
create policy addon_features_service_role_only on public.addon_features for all to service_role using (true) with check (true);
drop policy if exists addon_meters_service_role_only on public.addon_meters;
create policy addon_meters_service_role_only on public.addon_meters for all to service_role using (true) with check (true);
drop policy if exists plan_available_addons_service_role_only on public.plan_available_addons;
create policy plan_available_addons_service_role_only on public.plan_available_addons for all to service_role using (true) with check (true);
drop policy if exists subscription_addons_service_role_only on public.subscription_addons;
create policy subscription_addons_service_role_only on public.subscription_addons for all to service_role using (true) with check (true);

revoke all on public.addons, public.addon_features, public.addon_meters,
              public.plan_available_addons, public.subscription_addons
  from public, anon, authenticated, tenant_app;
grant select, insert, update, delete
  on public.addons, public.addon_features, public.addon_meters,
     public.plan_available_addons, public.subscription_addons
  to service_role;

-- The attachment history is part of the billing record, like usage_events.
revoke delete on public.subscription_addons from service_role;

revoke all on function public.admin_attach_addon(uuid, uuid, boolean, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.admin_detach_addon_for_subscription(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.admin_attach_addon(uuid, uuid, boolean, uuid) to service_role;
grant execute on function public.admin_detach_addon_for_subscription(uuid, uuid) to service_role;

-- --------------------------------------------------------------------------
-- The entitlement, with add-ons folded in
--
-- No parallel path: add-on features join the same feature array and add-on credits are summed
-- into the same meters object. requireFeature(), the menu and check_meter_capacity are unchanged.
-- --------------------------------------------------------------------------

create or replace function public.refresh_tenant_entitlement(p_tenant_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sub         public.subscriptions%rowtype;
  v_plan        public.plans%rowtype;
  v_limits      public.plan_limits%rowtype;
  v_features    jsonb;
  v_meters      jsonb;
  v_status      text;
  v_access      text;
  v_entitlement jsonb;
begin
  select s.* into v_sub
    from public.subscriptions s
   where s.tenant_id = p_tenant_id
   order by (s.status <> 'cancelled') desc, s.started_at desc
   limit 1;

  if v_sub.id is null then
    v_entitlement := public.la0_default_entitlement(p_tenant_id);
    if v_entitlement is null then
      raise exception 'tenant_not_found' using errcode = 'no_data_found';
    end if;
  else
    select p.* into v_plan from public.plans p where p.id = v_sub.plan_id;
    if v_plan.id is null then
      raise exception 'plan_not_found for subscription %', v_sub.id using errcode = 'foreign_key_violation';
    end if;

    select l.* into v_limits from public.plan_limits l where l.plan_id = v_plan.id;

    v_status := v_sub.status::text;
    v_access := public.entitlement_access_for_status(v_status);

    if v_status = 'cancelled' then
      v_features := '[]'::jsonb;
      v_meters   := '{}'::jsonb;
    else
      -- Plan features UNION attached add-on features. Archived features stay granted (SA-2.1).
      select coalesce(jsonb_agg(feature_key order by feature_key), '[]'::jsonb)
        into v_features
        from (
          select pf.feature_key
            from public.plan_features pf
           where pf.plan_id = v_plan.id
          union
          select af.feature_key
            from public.subscription_addons sa
            join public.addon_features af on af.addon_id = sa.addon_id
           where sa.subscription_id = v_sub.id and sa.detached_at is null
        ) granted;

      -- Plan allowance plus add-on credits for the same meter (SA-2.6 criterion 3). An unlimited
      -- plan allowance stays unlimited — adding credits to "no ceiling" is still no ceiling.
      with plan_m as (
        select pm.meter_key, pm.included_qty, pm.hard_cap
          from public.plan_meters pm
         where pm.plan_id = v_plan.id
      ),
      addon_m as (
        select am.meter_key, sum(am.included_qty)::integer as qty
          from public.subscription_addons sa
          join public.addon_meters am on am.addon_id = sa.addon_id
         where sa.subscription_id = v_sub.id and sa.detached_at is null
         group by am.meter_key
      ),
      merged as (
        select
          coalesce(p.meter_key, a.meter_key) as meter_key,
          case
            when p.meter_key is not null and p.included_qty is null then null
            else coalesce(p.included_qty, 0) + coalesce(a.qty, 0)
          end as included_qty,
          coalesce(p.hard_cap, m.default_hard_cap, true) as hard_cap
        from plan_m p
        full join addon_m a on a.meter_key = p.meter_key
        left join public.meters m on m.meter_key = coalesce(p.meter_key, a.meter_key)
      )
      select coalesce(jsonb_object_agg(merged.meter_key, jsonb_build_object(
               'included', merged.included_qty,
               'hard_cap', merged.hard_cap,
               'used',     coalesce(t.used_qty, 0)
             )), '{}'::jsonb)
        into v_meters
        from merged
        left join public.usage_totals t
          on t.tenant_id = p_tenant_id
         and t.meter_key = merged.meter_key
         and t.period_start = v_sub.current_period_start;
    end if;

    v_entitlement := jsonb_build_object(
      'tenant_id',    p_tenant_id,
      'plan_code',    v_plan.code,
      'plan_version', v_plan.version,
      'status',       v_status,
      'access',       v_access,
      'computed_at',  now(),
      'features',     v_features,
      'meters',       v_meters,
      'limits',       jsonb_build_object(
                        'max_seats',              coalesce(v_limits.max_seats,
                                                    case when v_plan.plan_type = 'individual' then 1 else null end),
                        'max_publishers',         v_limits.max_publishers,
                        'max_marketing_partners', v_limits.max_marketing_partners,
                        'max_affiliates',         v_limits.max_affiliates,
                        'max_buffer_seats',       v_limits.max_buffer_seats,
                        'max_partner_users',      v_limits.max_partner_users
                      ),
      'period_start', v_sub.current_period_start
    );
  end if;

  insert into public.tenant_entitlements (tenant_id, entitlement, computed_at, version)
  values (p_tenant_id, v_entitlement, now(), 1)
  on conflict (tenant_id) do update
    set entitlement = excluded.entitlement,
        computed_at = excluded.computed_at,
        version     = public.tenant_entitlements.version + 1;

  return v_entitlement;
end;
$$;
