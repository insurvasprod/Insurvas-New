-- LA-0.6 compatibility bridge for the live organization-era contact tables.
-- The tenant model is authoritative for application scope; legacy organization_id
-- remains populated only because those historical columns are still NOT NULL.

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
declare
  v_organization_id uuid;
  v_household_id uuid;
  v_contact_id uuid;
  item jsonb;
begin
  v_organization_id := coalesce(
    (select source_organization_id from public.tenants where id = p_tenant_id),
    p_tenant_id
  );
  if jsonb_typeof(coalesce(p_custom_fields, '{}'::jsonb)) <> 'object' then
    raise exception 'Custom fields must be an object';
  end if;
  if jsonb_typeof(coalesce(p_phones, '[]'::jsonb)) <> 'array' then
    raise exception 'Phones must be an array';
  end if;
  if jsonb_typeof(coalesce(p_emails, '[]'::jsonb)) <> 'array' then
    raise exception 'Emails must be an array';
  end if;
  if p_address_hash is not null then
    insert into public.households (
      organization_id, tenant_id, address_hash, address_line1, city, state,
      postal_code, address_search
    ) values (
      v_organization_id, p_tenant_id, p_address_hash,
      coalesce(nullif(trim(p_address_line1), ''), ''),
      coalesce(nullif(trim(p_city), ''), ''),
      coalesce(nullif(upper(trim(p_state)), ''), ''),
      coalesce(nullif(trim(p_postal_code), ''), ''), p_address_search
    ) on conflict do nothing;
    select h.id into v_household_id
    from public.households h
    where h.tenant_id = p_tenant_id and h.address_hash = p_address_hash;
  end if;
  insert into public.contacts (
    organization_id, tenant_id, household_id, first_name, last_name, dob,
    primary_phone, state, name_search, custom_fields
  ) values (
    v_organization_id, p_tenant_id, v_household_id, trim(p_first_name),
    trim(p_last_name), p_dob, nullif(trim(p_primary_phone), ''),
    nullif(upper(trim(p_state)), ''), p_name_search,
    coalesce(p_custom_fields, '{}'::jsonb)
  ) returning id into v_contact_id;
  for item in select value from jsonb_array_elements(p_phones) loop
    insert into public.contact_phones (
      organization_id, tenant_id, contact_id, phone, type, is_primary
    ) values (
      v_organization_id, p_tenant_id, v_contact_id, item->>'phone',
      coalesce(item->>'type', 'other'), coalesce((item->>'is_primary')::boolean, false)
    ) on conflict (contact_id, phone) do nothing;
  end loop;
  for item in select value from jsonb_array_elements(p_emails) loop
    insert into public.contact_emails (
      organization_id, tenant_id, contact_id, email, is_primary
    ) values (
      v_organization_id, p_tenant_id, v_contact_id, lower(trim(item->>'email')),
      coalesce((item->>'is_primary')::boolean, false)
    ) on conflict (contact_id, email) do nothing;
  end loop;
  return v_contact_id;
end;
$$;

create or replace function public.merge_contacts(
  p_tenant_id uuid, p_kept_id uuid, p_merged_id uuid,
  p_field_choices jsonb, p_merged_by uuid
)
returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_organization_id uuid;
  kept public.contacts%rowtype;
  merged public.contacts%rowtype;
  log_id uuid;
  kept_phones jsonb;
  merged_phones jsonb;
  kept_emails jsonb;
  merged_emails jsonb;
  item jsonb;
begin
  if p_kept_id = p_merged_id then raise exception 'Choose two different contacts'; end if;
  v_organization_id := coalesce(
    (select source_organization_id from public.tenants where id = p_tenant_id),
    p_tenant_id
  );
  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant_id::text || ':' || least(p_kept_id::text, p_merged_id::text) || ':' ||
    greatest(p_kept_id::text, p_merged_id::text), 0
  ));
  select * into kept from public.contacts
  where id = p_kept_id and tenant_id = p_tenant_id for update;
  select * into merged from public.contacts
  where id = p_merged_id and tenant_id = p_tenant_id for update;
  if kept.id is null or merged.id is null then
    raise exception 'Both contacts must belong to this tenant';
  end if;
  if kept.merged_into_id is not null or merged.merged_into_id is not null then
    raise exception 'A merged contact cannot be merged again';
  end if;
  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into kept_phones
  from public.contact_phones p where p.contact_id = kept.id;
  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into merged_phones
  from public.contact_phones p where p.contact_id = merged.id;
  select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) into kept_emails
  from public.contact_emails e where e.contact_id = kept.id;
  select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) into merged_emails
  from public.contact_emails e where e.contact_id = merged.id;
  insert into public.merge_log (
    tenant_id, kept_id, merged_id, field_choices, kept_snapshot, merged_snapshot,
    kept_phones, merged_phones, kept_emails, merged_emails, merged_by
  ) values (
    p_tenant_id, kept.id, merged.id, coalesce(p_field_choices, '{}'::jsonb),
    to_jsonb(kept), to_jsonb(merged), kept_phones, merged_phones,
    kept_emails, merged_emails, p_merged_by
  ) returning id into log_id;
  update public.contacts set
    first_name = case when p_field_choices->>'first_name' = 'merged' then merged.first_name else kept.first_name end,
    last_name = case when p_field_choices->>'last_name' = 'merged' then merged.last_name else kept.last_name end,
    dob = case when p_field_choices->>'dob' = 'merged' then merged.dob else kept.dob end,
    primary_phone = case when p_field_choices->>'primary_phone' = 'merged' then merged.primary_phone else kept.primary_phone end,
    state = case when p_field_choices->>'state' = 'merged' then merged.state else kept.state end,
    household_id = case when p_field_choices->>'household_id' = 'merged' then merged.household_id else kept.household_id end,
    name_search = case
      when p_field_choices->>'first_name' = 'merged' or p_field_choices->>'last_name' = 'merged'
      then lower(regexp_replace(trim(
        case when p_field_choices->>'first_name' = 'merged' then merged.first_name else kept.first_name end || ' ' ||
        case when p_field_choices->>'last_name' = 'merged' then merged.last_name else kept.last_name end
      ), '[^a-zA-Z0-9]+', '', 'g'))
      else kept.name_search
    end,
    custom_fields = case when p_field_choices->>'custom_fields' = 'merged' then merged.custom_fields else kept.custom_fields end
  where id = kept.id;
  for item in select value from jsonb_array_elements(merged_phones) loop
    insert into public.contact_phones (
      organization_id, tenant_id, contact_id, phone, type, is_primary
    ) values (
      v_organization_id, p_tenant_id, kept.id, item->>'phone',
      coalesce(item->>'type', 'other'), coalesce((item->>'is_primary')::boolean, false)
    ) on conflict (contact_id, phone) do nothing;
  end loop;
  for item in select value from jsonb_array_elements(merged_emails) loop
    insert into public.contact_emails (
      organization_id, tenant_id, contact_id, email, is_primary
    ) values (
      v_organization_id, p_tenant_id, kept.id, lower(item->>'email'),
      coalesce((item->>'is_primary')::boolean, false)
    ) on conflict (contact_id, email) do nothing;
  end loop;
  update public.contacts set merged_into_id = kept.id where id = merged.id;
  return log_id;
end;
$$;

create or replace function public.undo_contact_merge(p_tenant_id uuid, p_merge_id uuid)
returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_organization_id uuid;
  log_row public.merge_log%rowtype;
  item jsonb;
begin
  v_organization_id := coalesce(
    (select source_organization_id from public.tenants where id = p_tenant_id),
    p_tenant_id
  );
  select * into log_row from public.merge_log
  where id = p_merge_id and tenant_id = p_tenant_id for update;
  if log_row.id is null then raise exception 'Merge not found'; end if;
  if log_row.reversed_at is not null then raise exception 'This merge was already undone'; end if;
  update public.contacts set
    first_name = log_row.kept_snapshot->>'first_name',
    last_name = log_row.kept_snapshot->>'last_name',
    dob = nullif(log_row.kept_snapshot->>'dob', '')::date,
    primary_phone = log_row.kept_snapshot->>'primary_phone',
    state = log_row.kept_snapshot->>'state',
    household_id = nullif(log_row.kept_snapshot->>'household_id', '')::uuid,
    name_search = log_row.kept_snapshot->>'name_search',
    custom_fields = log_row.kept_snapshot->'custom_fields'
  where id = log_row.kept_id and tenant_id = p_tenant_id;
  update public.contacts set
    first_name = log_row.merged_snapshot->>'first_name',
    last_name = log_row.merged_snapshot->>'last_name',
    dob = nullif(log_row.merged_snapshot->>'dob', '')::date,
    primary_phone = log_row.merged_snapshot->>'primary_phone',
    state = log_row.merged_snapshot->>'state',
    household_id = nullif(log_row.merged_snapshot->>'household_id', '')::uuid,
    name_search = log_row.merged_snapshot->>'name_search',
    custom_fields = log_row.merged_snapshot->'custom_fields',
    merged_into_id = null
  where id = log_row.merged_id and tenant_id = p_tenant_id;
  delete from public.contact_phones where contact_id in (log_row.kept_id, log_row.merged_id);
  for item in select value from jsonb_array_elements(log_row.kept_phones) loop
    insert into public.contact_phones (
      id, organization_id, tenant_id, contact_id, phone, type, is_primary
    ) values (
      (item->>'id')::uuid, v_organization_id, p_tenant_id, log_row.kept_id,
      item->>'phone', coalesce(item->>'type', 'other'),
      coalesce((item->>'is_primary')::boolean, false)
    );
  end loop;
  for item in select value from jsonb_array_elements(log_row.merged_phones) loop
    insert into public.contact_phones (
      id, organization_id, tenant_id, contact_id, phone, type, is_primary
    ) values (
      (item->>'id')::uuid, v_organization_id, p_tenant_id, log_row.merged_id,
      item->>'phone', coalesce(item->>'type', 'other'),
      coalesce((item->>'is_primary')::boolean, false)
    );
  end loop;
  delete from public.contact_emails where contact_id in (log_row.kept_id, log_row.merged_id);
  for item in select value from jsonb_array_elements(log_row.kept_emails) loop
    insert into public.contact_emails (
      id, organization_id, tenant_id, contact_id, email, is_primary
    ) values (
      (item->>'id')::uuid, v_organization_id, p_tenant_id, log_row.kept_id,
      lower(item->>'email'), coalesce((item->>'is_primary')::boolean, false)
    );
  end loop;
  for item in select value from jsonb_array_elements(log_row.merged_emails) loop
    insert into public.contact_emails (
      id, organization_id, tenant_id, contact_id, email, is_primary
    ) values (
      (item->>'id')::uuid, v_organization_id, p_tenant_id, log_row.merged_id,
      lower(item->>'email'), coalesce((item->>'is_primary')::boolean, false)
    );
  end loop;
  update public.merge_log set reversed_at = now() where id = log_row.id;
  return log_row.id;
end;
$$;

revoke execute on function public.save_contact(uuid, text, text, date, text, text, text, jsonb, text, text, text, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.merge_contacts(uuid, uuid, uuid, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.undo_contact_merge(uuid, uuid) from public, anon, authenticated;
grant execute on function public.save_contact(uuid, text, text, date, text, text, text, jsonb, text, text, text, text, text, jsonb, jsonb) to service_role;
grant execute on function public.merge_contacts(uuid, uuid, uuid, jsonb, uuid) to service_role;
grant execute on function public.undo_contact_merge(uuid, uuid) to service_role;
