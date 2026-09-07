-- M2-1 / M2-7 · Every individual plan has its one-seat default, and a new plan version keeps
-- the complete commercial configuration rather than silently dropping limits, meters or add-ons.

create or replace function public.seed_individual_plan_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.plan_type = 'individual' then
    insert into public.plan_limits (plan_id, max_seats)
    values (new.id, 1)
    on conflict (plan_id) do nothing;
  end if;
  return new;
end;
$function$;

drop trigger if exists plans_individual_defaults on public.plans;
create trigger plans_individual_defaults
after insert on public.plans
for each row execute function public.seed_individual_plan_defaults();

-- Backfill the invariant for individual plans created before this migration.
insert into public.plan_limits (plan_id, max_seats)
select p.id, 1
  from public.plans p
 where p.plan_type = 'individual'
on conflict (plan_id) do nothing;

create or replace function public.admin_create_plan_version(p_plan_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_new_id uuid;
  v_code text;
  v_next integer;
begin
  select p.code into v_code from public.plans p where p.id = p_plan_id;
  if not found then
    raise exception 'plan_not_found' using errcode = 'no_data_found';
  end if;

  select coalesce(max(p.version), 0) + 1 into v_next
    from public.plans p where p.code = v_code;

  insert into public.plans (code, version, name, plan_type, description, is_public, is_archived, sort_order)
  select p.code, v_next, p.name, p.plan_type, p.description, p.is_public, false, p.sort_order
    from public.plans p where p.id = p_plan_id
  returning id into v_new_id;

  insert into public.plan_features (plan_id, feature_key)
  select v_new_id, feature_key from public.plan_features where plan_id = p_plan_id;

  insert into public.plan_prices (
    plan_id, price_monthly_cents, price_quarterly_cents, price_yearly_cents,
    setup_fee_cents, trial_days, currency
  )
  select v_new_id, price_monthly_cents, price_quarterly_cents, price_yearly_cents,
         setup_fee_cents, trial_days, currency
    from public.plan_prices where plan_id = p_plan_id;

  insert into public.plan_limits (
    plan_id, max_seats, max_carriers, max_publishers, max_marketing_partners,
    max_affiliates, max_buffer_seats, max_partner_users
  )
  select v_new_id, max_seats, max_carriers, max_publishers, max_marketing_partners,
         max_affiliates, max_buffer_seats, max_partner_users
    from public.plan_limits where plan_id = p_plan_id
  on conflict (plan_id) do update set
    max_seats = excluded.max_seats,
    max_carriers = excluded.max_carriers,
    max_publishers = excluded.max_publishers,
    max_marketing_partners = excluded.max_marketing_partners,
    max_affiliates = excluded.max_affiliates,
    max_buffer_seats = excluded.max_buffer_seats,
    max_partner_users = excluded.max_partner_users;

  insert into public.plan_meters (plan_id, meter_key, included_qty, hard_cap)
  select v_new_id, meter_key, included_qty, hard_cap
    from public.plan_meters where plan_id = p_plan_id;

  insert into public.plan_available_addons (plan_id, addon_id)
  select v_new_id, addon_id
    from public.plan_available_addons where plan_id = p_plan_id;

  return v_new_id;
end;
$function$;

revoke all on function public.seed_individual_plan_defaults() from public, anon, authenticated, tenant_app;
grant execute on function public.seed_individual_plan_defaults() to service_role;
revoke all on function public.admin_create_plan_version(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.admin_create_plan_version(uuid) to service_role;
