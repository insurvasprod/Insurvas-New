-- LA-2.2 criterion 6: "A 20,000-row file imports without the browser running out of memory."
--
-- The commit function refused any batch over 2,000 rows, so the criterion was unreachable from the
-- database upward however well the browser behaved. `MAX_LEAD_IMPORT_ROWS` in
-- `lib/agentTemplates/csv.ts` is now 20,000 and this guard has to agree with it, or the server
-- accepts a file that the database then rejects after the user has waited for the upload.
--
-- Why one transaction of 20,000 rather than ten of 2,000: criterion 3 is that a failure at any step
-- leaves ZERO rows imported. Chunking would make that false between chunks — a failure at chunk
-- seven leaves six chunks committed and no honest answer to "what is in my pipeline". A single
-- transaction keeps the two criteria from contradicting each other. 20,000 rows of this shape is a
-- few tens of megabytes of WAL; it is a large transaction, not an unreasonable one.
--
-- The cap is kept rather than removed because it bounds how long one transaction may hold its
-- locks, and an unbounded import is how a single upload stalls every other writer on the tenant.

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
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 20000 then
    raise exception 'IMPORT_BATCH_SIZE_INVALID';
  end if;
  -- Membership lives in `tenant_users`, NOT on `public.users` — that column does not exist, and an
  -- earlier draft of this migration checked `users.tenant_id`. It would have applied cleanly
  -- (PL/pgSQL resolves column references at run time, not at CREATE) and then raised
  -- `42703 column "tenant_id" does not exist` on every single import, replacing a working actor
  -- check with a broken one. This is the shape the live function already uses; keep them identical.
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
