-- LA-2.2: the live compatibility schema keeps tenant membership in tenant_users.
-- The first import-batch definition incorrectly read users.tenant_id, which does not exist in
-- the shared public users table. Keep the transaction boundary and replace only actor validation.

create or replace function public.import_agent_lead_batch(
  p_tenant_id uuid,
  p_created_by uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_item jsonb;
  v_lead_id uuid;
  v_ids jsonb := '[]'::jsonb;
  v_campaign_id uuid;
begin
  if p_tenant_id is null or p_created_by is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'IMPORT_BATCH_INVALID';
  end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 2000 then
    raise exception 'IMPORT_BATCH_SIZE_INVALID';
  end if;
  if not exists (
    select 1
      from public.tenant_users tu
      join public.users u on u.id = tu.user_id
     where tu.tenant_id = p_tenant_id
       and tu.user_id = p_created_by
       and u.status in ('active', 'invited')
  ) then
    raise exception 'IMPORT_ACTOR_INVALID';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'IMPORT_ITEM_INVALID'; end if;
    v_campaign_id := nullif(v_item->>'campaign_id', '')::uuid;
    v_lead_id := nullif(v_item->>'lead_id', '')::uuid;

    if v_lead_id is not null then
      if not exists (select 1 from public.agent_leads where id = v_lead_id and tenant_id = p_tenant_id) then
        raise exception 'IMPORT_LEAD_SCOPE_INVALID';
      end if;
      perform 1 from public.agent_leads where id = v_lead_id and tenant_id = p_tenant_id for update;
    else
      if jsonb_typeof(v_item->'values') <> 'object'
         or nullif(v_item->>'template_id', '') is null
         or nullif(v_item->>'product_line', '') is null
         or nullif(v_item->>'pipeline_id', '') is null
         or nullif(v_item->>'stage_id', '') is null then
        raise exception 'IMPORT_ITEM_INVALID';
      end if;
      insert into public.agent_leads (
        tenant_id, tenant_template_id, template_id, template_version, definition_version,
        product_line, pipeline_id, stage_id, values, campaign_id,
        screening_result_id, screening_version, screening_outcome, screening_warning,
        screening_checked_at, created_by
      ) values (
        p_tenant_id,
        nullif(v_item->>'tenant_template_id', '')::uuid,
        (v_item->>'template_id')::uuid,
        greatest(1, coalesce(nullif(v_item->>'template_version', '')::integer, 1)),
        greatest(1, coalesce(nullif(v_item->>'definition_version', '')::integer, 1)),
        v_item->>'product_line', (v_item->>'pipeline_id')::uuid, (v_item->>'stage_id')::uuid,
        v_item->'values', v_campaign_id,
        nullif(v_item->>'screening_result_id', '')::uuid,
        nullif(v_item->>'screening_version', '')::integer,
        nullif(v_item->>'screening_outcome', ''),
        nullif(v_item->>'screening_warning', ''),
        nullif(v_item->>'screening_checked_at', '')::timestamptz,
        p_created_by
      ) returning id into v_lead_id;
    end if;

    if v_campaign_id is not null then
      if not exists (select 1 from public.tenant_campaigns where id = v_campaign_id and tenant_id = p_tenant_id) then
        raise exception 'IMPORT_CAMPAIGN_SCOPE_INVALID';
      end if;
      perform public.import_agent_lead_source(
        p_tenant_id, v_lead_id, v_campaign_id, 'import',
        greatest(0, coalesce(nullif(v_item->>'cost_cents', '')::integer, 0)),
        nullif(v_item->>'source_key', '')
      );
    end if;
    v_ids := v_ids || jsonb_build_array(v_lead_id);
  end loop;
  return v_ids;
end;
$function$;

revoke all on function public.import_agent_lead_batch(uuid, uuid, jsonb) from public, anon, authenticated, tenant_app;
grant execute on function public.import_agent_lead_batch(uuid, uuid, jsonb) to service_role;
