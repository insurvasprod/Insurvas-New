-- SA-4.4 campaign offers layered over the SA-3.6 coupon record.
-- The existing coupon functions remain the authority for arithmetic, period consumption, the
-- one-active-coupon rule, and atomic redemption caps. An offer only adds eligibility and timing.

create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  coupon_id uuid not null unique references public.coupons(id) on delete restrict,
  starts_at timestamptz,
  ends_at timestamptz,
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  redeemed_count integer not null default 0 check (redeemed_count >= 0),
  auto_apply boolean not null default false,
  eligible_plan_types public.plan_type[] not null default '{}',
  eligible_plan_ids uuid[] not null default '{}',
  new_customers_only boolean not null default false,
  existing_customers_only boolean not null default false,
  eligible_cycles public.billing_cycle[] not null default '{}',
  is_active boolean not null default true,
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (not (new_customers_only and existing_customers_only))
);

create index if not exists offers_auto_apply_window_idx
  on public.offers (auto_apply, is_active, starts_at, ends_at);
create index if not exists offers_plan_ids_gin_idx on public.offers using gin (eligible_plan_ids);
create index if not exists offers_plan_types_gin_idx on public.offers using gin (eligible_plan_types);
create index if not exists offers_cycles_gin_idx on public.offers using gin (eligible_cycles);

alter table public.offers enable row level security;
revoke all on table public.offers from anon, authenticated;
grant select, insert, update, delete on table public.offers to service_role;

create or replace function public.touch_offer_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists offers_touch_updated_at on public.offers;
create trigger offers_touch_updated_at
before update on public.offers
for each row execute function public.touch_offer_updated_at();
revoke all on function public.touch_offer_updated_at() from public;

-- Keep the denormalised offer counter in step with the existing atomic coupon application path.
create or replace function public.increment_offer_redemption()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.offers
     set redeemed_count = redeemed_count + 1,
         updated_at = now()
   where coupon_id = new.coupon_id;
  return new;
end;
$$;

drop trigger if exists subscription_coupons_increment_offer on public.subscription_coupons;
create trigger subscription_coupons_increment_offer
after insert on public.subscription_coupons
for each row execute function public.increment_offer_redemption();
revoke all on function public.increment_offer_redemption() from public;

-- Called by the application immediately after a subscription is assigned. This deliberately calls
-- admin_apply_coupon rather than reimplementing its locking, cap, and exclusivity rules.
create or replace function public.apply_auto_offer_to_subscription(p_subscription_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  subscription_row record;
  plan_row record;
  offer_row record;
  prior_subscription boolean;
  apply_result text;
begin
  select s.* into subscription_row
    from public.subscriptions s
   where s.id = p_subscription_id;
  if not found then return null; end if;

  select p.* into plan_row from public.plans p where p.id = subscription_row.plan_id;
  if not found then return null; end if;

  select exists (
    select 1 from public.subscriptions previous
     where previous.tenant_id = subscription_row.tenant_id
       and previous.id <> subscription_row.id
       and previous.created_at < subscription_row.created_at
  ) into prior_subscription;

  for offer_row in
    select o.*, c.id as linked_coupon_id, c.max_redemptions as coupon_max_redemptions,
           c.redeemed_count as coupon_redeemed_count
      from public.offers o
      join public.coupons c on c.id = o.coupon_id
     where o.auto_apply
       and o.is_active
       and (o.starts_at is null or now() >= o.starts_at)
       and (o.ends_at is null or now() < o.ends_at)
       and (o.max_redemptions is null or o.redeemed_count < o.max_redemptions)
       and (c.is_active)
     order by o.created_at asc
  loop
    if cardinality(offer_row.eligible_plan_types) > 0
       and not (plan_row.plan_type = any(offer_row.eligible_plan_types)) then continue; end if;
    if cardinality(offer_row.eligible_plan_ids) > 0
       and not (subscription_row.plan_id = any(offer_row.eligible_plan_ids)) then continue; end if;
    if cardinality(offer_row.eligible_cycles) > 0
       and not (subscription_row.billing_cycle = any(offer_row.eligible_cycles)) then continue; end if;
    if offer_row.new_customers_only and prior_subscription then continue; end if;
    if offer_row.existing_customers_only and not prior_subscription then continue; end if;

    apply_result := public.admin_apply_coupon(p_subscription_id, offer_row.linked_coupon_id, null);
    if apply_result = 'ok' then return offer_row.id; end if;
    -- A subscription can have only one offer. If one is already present, later campaigns cannot
    -- replace it; other failed offers remain available for future assignments.
    if apply_result = 'already_has_coupon' then return null; end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.apply_auto_offer_to_subscription(uuid) from public;
grant execute on function public.apply_auto_offer_to_subscription(uuid) to service_role;
