-- SA-2.6 · Add-on catalog administration
--
-- Additive only. The existing tables remain the compatibility store. This RPC is the single
-- transaction boundary for catalog writes: the API authorizes the platform admin, while this
-- service-role-only function validates references and replaces child rows atomically.

create or replace function public.admin_upsert_addon(
  p_addon_id       uuid default null,
  p_code           text default null,
  p_name           text default null,
  p_description    text default null,
  p_price_cents    integer default null,
  p_billing_cycle  public.billing_cycle default null,
  p_is_active      boolean default true,
  p_sort_order     integer default 0,
  p_feature_keys   text[] default '{}'::text[],
  p_meters         jsonb default '[]'::jsonb,
  p_plan_ids       uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_addon              public.addons%rowtype;
  v_id                 uuid;
  v_meter              jsonb;
  v_meter_key          text;
  v_qty                integer;
  v_has_live_attachments boolean := false;
  v_grants_changed     boolean := false;
  v_meters_changed     boolean := false;
begin
  if p_name is null or length(btrim(p_name)) = 0 or length(p_name) > 120 then
    raise exception 'invalid_addon_name' using errcode = 'check_violation';
  end if;
  if p_price_cents is null or p_price_cents < 0 then
    raise exception 'invalid_addon_price' using errcode = 'check_violation';
  end if;
  if p_billing_cycle is null then
    raise exception 'invalid_billing_cycle' using errcode = 'check_violation';
  end if;
  if p_sort_order is null or p_sort_order < 0 then
    raise exception 'invalid_sort_order' using errcode = 'check_violation';
  end if;
  if p_meters is null or jsonb_typeof(p_meters) <> 'array' then
    raise exception 'invalid_meter_configuration' using errcode = 'check_violation';
  end if;

  if p_addon_id is null then
    if p_code is null or p_code !~ '^[a-z][a-z0-9_]*$' then
      raise exception 'invalid_addon_code' using errcode = 'check_violation';
    end if;
  else
    select * into v_addon from public.addons where id = p_addon_id for update;
    if not found then
      raise exception 'addon_not_found' using errcode = 'foreign_key_violation';
    end if;
    -- Codes are referenced by invoices and external catalog consumers; archive and create a new
    -- code instead of renaming one in place.
    if p_code is not null and p_code <> v_addon.code then
      raise exception 'code_immutable' using errcode = 'check_violation';
    end if;
  end if;

  if exists (
    select 1 from unnest(coalesce(p_feature_keys, '{}'::text[])) as keys(feature_key)
    where not exists (
      select 1 from public.features f
      where f.feature_key = keys.feature_key and not f.is_archived
    )
  ) then
    raise exception 'feature_not_found' using errcode = 'foreign_key_violation';
  end if;

  if exists (
    select 1 from unnest(coalesce(p_feature_keys, '{}'::text[])) as keys(feature_key)
    group by keys.feature_key having count(*) > 1
  ) then
    raise exception 'duplicate_feature_key' using errcode = 'unique_violation';
  end if;

  for v_meter in select value from jsonb_array_elements(p_meters) as items(value) loop
    v_meter_key := v_meter->>'meter_key';
    if v_meter_key is null or length(btrim(v_meter_key)) = 0 or length(v_meter_key) > 80
       or (v_meter->>'included_qty') is null
       or (v_meter->>'included_qty') !~ '^[0-9]+$' then
      raise exception 'invalid_meter_configuration' using errcode = 'check_violation';
    end if;
    v_qty := (v_meter->>'included_qty')::integer;
    if v_qty <= 0 then
      raise exception 'invalid_meter_quantity' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.meters m where m.meter_key = v_meter_key) then
      raise exception 'meter_not_found' using errcode = 'foreign_key_violation';
    end if;
  end loop;

  if exists (
    select meter_key from jsonb_to_recordset(p_meters) as rows(meter_key text, included_qty integer)
    group by meter_key having count(*) > 1
  ) then
    raise exception 'duplicate_meter_key' using errcode = 'unique_violation';
  end if;

  if exists (
    select 1 from unnest(coalesce(p_plan_ids, '{}'::uuid[])) as ids(plan_id)
    where not exists (select 1 from public.plans p where p.id = ids.plan_id)
  ) then
    raise exception 'plan_not_found' using errcode = 'foreign_key_violation';
  end if;

  if p_addon_id is not null then
    select exists (
      select 1 from public.subscription_addons sa
      where sa.addon_id = p_addon_id and sa.detached_at is null
    ) into v_has_live_attachments;

    v_grants_changed :=
      exists (
        select 1 from public.addon_features af
        where af.addon_id = p_addon_id
          and not (af.feature_key = any(coalesce(p_feature_keys, '{}'::text[])))
      )
      or exists (
        select 1 from unnest(coalesce(p_feature_keys, '{}'::text[])) as keys(feature_key)
        where not exists (
          select 1 from public.addon_features af
          where af.addon_id = p_addon_id and af.feature_key = keys.feature_key
        )
      );

    v_meters_changed :=
      exists (
        select 1 from public.addon_meters am
        where am.addon_id = p_addon_id
          and not exists (
            select 1 from jsonb_to_recordset(p_meters) as rows(meter_key text, included_qty integer)
            where rows.meter_key = am.meter_key and rows.included_qty = am.included_qty
          )
      )
      or exists (
        select 1 from jsonb_to_recordset(p_meters) as rows(meter_key text, included_qty integer)
        where not exists (
          select 1 from public.addon_meters am
          where am.addon_id = p_addon_id
            and am.meter_key = rows.meter_key and am.included_qty = rows.included_qty
        )
      );

    if v_has_live_attachments and (v_grants_changed or v_meters_changed) then
      raise exception 'addon_grants_have_live_attachments' using errcode = 'check_violation';
    end if;
  end if;

  if p_addon_id is null then
    insert into public.addons (code, name, description, price_cents, billing_cycle, is_active, sort_order)
    values (p_code, btrim(p_name), nullif(btrim(p_description), ''), p_price_cents, p_billing_cycle, p_is_active, p_sort_order)
    returning id into v_id;
  else
    update public.addons
       set name = btrim(p_name),
           description = nullif(btrim(p_description), ''),
           price_cents = p_price_cents,
           billing_cycle = p_billing_cycle,
           is_active = p_is_active,
           sort_order = p_sort_order
     where id = p_addon_id;
    v_id := p_addon_id;
  end if;

  delete from public.addon_features where addon_id = v_id;
  insert into public.addon_features (addon_id, feature_key)
  select v_id, keys.feature_key from unnest(coalesce(p_feature_keys, '{}'::text[])) as keys(feature_key);

  delete from public.addon_meters where addon_id = v_id;
  insert into public.addon_meters (addon_id, meter_key, included_qty)
  select v_id, rows.meter_key, rows.included_qty
    from jsonb_to_recordset(p_meters) as rows(meter_key text, included_qty integer);

  delete from public.plan_available_addons where addon_id = v_id;
  insert into public.plan_available_addons (addon_id, plan_id)
  select v_id, ids.plan_id from unnest(coalesce(p_plan_ids, '{}'::uuid[])) as ids(plan_id);

  return v_id;
end;
$$;

revoke all on function public.admin_upsert_addon(uuid, text, text, text, integer, public.billing_cycle, boolean, integer, text[], jsonb, uuid[])
  from public, anon, authenticated, tenant_app;
grant execute on function public.admin_upsert_addon(uuid, text, text, text, integer, public.billing_cycle, boolean, integer, text[], jsonb, uuid[])
  to service_role;
