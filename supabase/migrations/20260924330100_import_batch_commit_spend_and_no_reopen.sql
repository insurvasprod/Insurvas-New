-- List import · the reviewed commit: one batch, its spend, and no reopened work.
--
-- Built on the latest definition of import_agent_lead_batch (20260917146000) — same validation,
-- same actor check through tenant_users, same 20,000-item bound, same lead insert, same source
-- attribution — with four changes.
--
-- 1. A new overload that takes the staged batch it is committing (`p_batch_id`). It locks that
--    batch row first and refuses one that is not still 'processing', so pressing "Import" twice — or
--    in two tabs — cannot commit one reviewed file twice. It marks the batch completed in the same
--    transaction as the leads.
--
-- 2. New leads are stamped with `agent_leads.import_batch_id` (20260924330000). A person who was
--    already a lead keeps whatever batch first brought them in.
--
-- 3. The campaign's spend, when the person asked for it. `p_campaign_spend` is
--    `{campaign_id, cost_cents, records_purchased}` or null. It is added to
--    `tenant_campaigns.total_spend_cents` / `records_purchased` inside this transaction, so the
--    campaign's cost and the leads that cost it can never disagree: all of it lands or none of it.
--    Integer cents, non-negative, bounded, and refused rather than wrapped if the sum would
--    overflow the integer columns.
--
-- 4. A lead with ANY `lead_queue` history no longer gets a new work item. The previous guard only
--    looked for a LIVE work item, so a person who had been dialled, dispositioned and closed came
--    straight back into the dialer the moment their number turned up in another vendor's file — the
--    import quietly undid the disposition. Now:
--
--        new lead                                  → one work item (unchanged)
--        existing lead, no queue row ever          → one work item (unchanged: leads imported
--                                                    before 20260917146000 still get theirs)
--        existing lead with a live work item       → nothing new (unchanged)
--        existing lead whose work items are all
--        settled (completed/closed/dropped/expired) → nothing new (CHANGED)
--
--    In every case the campaign is still added as a source through import_agent_lead_source, so
--    the vendor who sold the person again is still attributed. Putting a worked lead back in front
--    of an agent is the recycling path's decision (LA-2.20, reactivate_nurture), with its own wait
--    and disposition rules — never a side effect of appearing in a CSV.
--
-- The 3-argument signature is kept for its existing caller (the direct POST /api/app/leads/import,
-- via importAgentLeads) and now delegates to the new overload with no batch and no spend, so both
-- paths share one body and change 4 applies to both.
--
-- The new overload has no defaults on purpose: PostgREST picks an overload by argument names, and
-- a default on p_batch_id would make a 3-argument call ambiguous.

create or replace function public.import_agent_lead_batch(
  p_tenant_id uuid,
  p_created_by uuid,
  p_items jsonb,
  p_batch_id uuid,
  p_campaign_spend jsonb
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
  v_batch_status text;
  v_spend_campaign uuid;
  v_spend_cents bigint;
  v_spend_records bigint;
begin
  if p_tenant_id is null or p_created_by is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'IMPORT_BATCH_INVALID';
  end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 20000 then
    raise exception 'IMPORT_BATCH_SIZE_INVALID';
  end if;
  -- Membership lives in `tenant_users`, NOT on `public.users` — that column does not exist. The
  -- shape the live function uses since 20260914193000; keep them identical.
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

  -- The staged batch, locked for the length of the commit. A second commit of the same review
  -- waits here, then finds it completed and stops before writing anything.
  if p_batch_id is not null then
    select b.status into v_batch_status
      from public.agent_lead_import_batches b
     where b.id = p_batch_id and b.tenant_id = p_tenant_id
       for update;
    if not found then raise exception 'IMPORT_BATCH_NOT_FOUND'; end if;
    if v_batch_status <> 'processing' then raise exception 'IMPORT_BATCH_ALREADY_COMMITTED'; end if;
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
        screening_checked_at, created_by, import_batch_id
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
        p_created_by,
        p_batch_id
      ) returning id into v_lead_id;
    end if;

    -- One work item for a lead that has never had one, and none for a lead that has any queue
    -- history at all — live or settled. A live item is already the lead's place in the dialer; a
    -- settled one is a decision somebody made (dialled, dispositioned, closed), and reopening it is
    -- the recycling path's call (LA-2.20), not this import's.
    if not exists (
      select 1 from public.lead_queue
       where tenant_id = p_tenant_id
         and lead_id = v_lead_id
    ) then
      insert into public.lead_queue (
        tenant_id, lead_id, product_line, pipeline_id, stage_id, stage_key, status, tier
      )
      select p_tenant_id, l.id, l.product_line, l.pipeline_id, l.stage_id, 'new', 'unclaimed', 100
        from public.agent_leads l
       where l.id = v_lead_id and l.tenant_id = p_tenant_id;
    end if;

    -- The campaign is added as a source whether or not a work item was created, so a person the
    -- vendor sold again is attributed to this campaign even when they are not dialled again.
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

  -- The file's cost, added to its campaign in the same transaction as its leads.
  if p_campaign_spend is not null and jsonb_typeof(p_campaign_spend) = 'object' then
    v_spend_campaign := nullif(p_campaign_spend->>'campaign_id', '')::uuid;
    v_spend_cents := coalesce(nullif(p_campaign_spend->>'cost_cents', '')::bigint, 0);
    v_spend_records := coalesce(nullif(p_campaign_spend->>'records_purchased', '')::bigint, 0);
    if v_spend_campaign is null
       or v_spend_cents < 0 or v_spend_cents > 100000000
       or v_spend_records < 0 or v_spend_records > 10000000 then
      raise exception 'IMPORT_SPEND_INVALID';
    end if;
    update public.tenant_campaigns c
       set total_spend_cents = c.total_spend_cents + v_spend_cents,
           records_purchased = c.records_purchased + v_spend_records,
           updated_at = now()
     where c.id = v_spend_campaign
       and c.tenant_id = p_tenant_id
       and c.total_spend_cents::bigint + v_spend_cents <= 2147483647
       and c.records_purchased::bigint + v_spend_records <= 2147483647;
    if not found then
      if exists (select 1 from public.tenant_campaigns where id = v_spend_campaign and tenant_id = p_tenant_id) then
        raise exception 'IMPORT_SPEND_OVERFLOW';
      end if;
      raise exception 'IMPORT_CAMPAIGN_SCOPE_INVALID';
    end if;
  end if;

  if p_batch_id is not null then
    update public.agent_lead_import_batches
       set status = 'completed', completed_at = now(), updated_at = now()
     where id = p_batch_id and tenant_id = p_tenant_id;
  end if;

  return v_ids;
end;
$function$;

revoke all on function public.import_agent_lead_batch(uuid, uuid, jsonb, uuid, jsonb) from public, anon, authenticated, tenant_app;
grant execute on function public.import_agent_lead_batch(uuid, uuid, jsonb, uuid, jsonb) to service_role;

-- The existing signature, same return type, now one line: no batch to lock, no spend to add.
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
begin
  return public.import_agent_lead_batch(p_tenant_id, p_created_by, p_items, null::uuid, null::jsonb);
end;
$function$;

revoke all on function public.import_agent_lead_batch(uuid, uuid, jsonb) from public, anon, authenticated, tenant_app;
grant execute on function public.import_agent_lead_batch(uuid, uuid, jsonb) to service_role;

-- ── proof ──────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_body text;
begin
  if to_regprocedure('public.import_agent_lead_batch(uuid, uuid, jsonb, uuid, jsonb)') is null then
    raise exception 'the batch-aware import_agent_lead_batch overload was not created';
  end if;
  if to_regprocedure('public.import_agent_lead_batch(uuid, uuid, jsonb)') is null then
    raise exception 'the 3-argument import_agent_lead_batch was dropped; importAgentLeads still calls it';
  end if;

  v_body := pg_get_functiondef('public.import_agent_lead_batch(uuid, uuid, jsonb, uuid, jsonb)'::regprocedure);
  if v_body !~* 'insert\s+into\s+public\.lead_queue' then
    raise exception 'import_agent_lead_batch no longer enqueues new leads';
  end if;
  if v_body ~* 'status not in' then
    raise exception 'import_agent_lead_batch still reopens leads whose work items are settled';
  end if;
  if v_body !~* 'import_batch_id' or v_body !~* 'total_spend_cents' or v_body !~* 'for update' then
    raise exception 'import_agent_lead_batch is missing the batch stamp, the spend or the batch lock';
  end if;

  v_body := pg_get_functiondef('public.import_agent_lead_batch(uuid, uuid, jsonb)'::regprocedure);
  if v_body !~* 'null::uuid, null::jsonb' then
    raise exception 'the 3-argument import_agent_lead_batch does not delegate to the shared body';
  end if;

  if has_function_privilege('anon', 'public.import_agent_lead_batch(uuid, uuid, jsonb, uuid, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.import_agent_lead_batch(uuid, uuid, jsonb, uuid, jsonb)', 'execute') then
    raise exception 'import_agent_lead_batch must be service-role only';
  end if;
end $$;
