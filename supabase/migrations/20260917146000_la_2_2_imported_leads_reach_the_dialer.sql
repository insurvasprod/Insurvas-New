-- LA-2.2 / LA-2.8 · an imported list could never be dialled.
--
-- Found by driving the product in a browser rather than by reading it. A four-row CSV imported
-- cleanly — "2 imported", the right two rows, the DNC row withheld, the repeat collapsed — and then
-- the dialer said "Nothing servable" with both leads sitting in `agent_leads`.
--
-- `serve_next_lead` selects `from lead_queue q join agent_leads l on l.id = q.lead_id`. The queue is
-- the work-item table and it is the ONLY thing the server reads; a lead with no `lead_queue` row is
-- invisible to every tier, to scoring, to slot rotation and to the mixing weights. Confirmed against
-- the live database rather than against the source, because string-replacement migrations have made
-- grep unreliable here twice:
--
--   triggers on agent_leads                          stamp_lead_nurture_entry, touch_updated_at
--   live functions that INSERT into lead_queue       none
--   live import_agent_lead_batch mentions lead_queue  false
--
-- Two application paths enqueue — `lib/leadPost/service.ts` (a vendor POST, at tier 0) and
-- `lib/agentTemplates/intake.ts`. CSV import was never one of them, so the whole
-- VENDOR → CAMPAIGN → LIST → LEADS chain of Module 2 §5 ended one step short of the dialer.
--
-- Worth saying plainly: this was latent before LA-2.8 and the dialer hid it. The old dialer read
-- `/api/app/leads?limit=100` and auto-selected `loaded[0]`, so imported leads appeared — in the
-- wrong order, ignoring cadence and the priority tiers, but they appeared. Moving the dialer onto
-- `serve_next_lead` was right, and it turned a silent ordering bug into a visible empty queue.
--
-- The enqueue goes HERE, inside the function, rather than in TypeScript after the RPC returns,
-- because the review screen promises "Committed as one transaction — all of it or none of it". A
-- second round trip after the commit would make a partial import possible in exactly the way that
-- sentence says it is not: leads written, queue rows missing, and nothing to roll back to.
--
-- `tier` is left at its default of 100. LA-2.9's tier 0 is documented as "ahead of every list lead,
-- regardless of scoring", so a list lead taking the default is the intended ordering rather than an
-- omission. `status` defaults to 'unclaimed' and `stage_key` to 'new'; both are spelled out anyway,
-- because 'queued' is not one of the nine values the status check constraint allows and the next
-- person to read this should not have to go and find that out.

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

    -- The step that was missing. Guarded by "has no live work item" rather than by which branch we
    -- came through, so that re-importing a number that already exists as a lead does not create a
    -- second open work item, and so that a lead imported before this migration gets one the next
    -- time it appears in a file.
    --
    -- The four settled statuses are excluded deliberately: a lead that was worked and closed should
    -- become dialable again through the recycling path (LA-2.20), which is a decision with its own
    -- rules, not a side effect of appearing in another CSV.
    if not exists (
      select 1 from public.lead_queue
       where tenant_id = p_tenant_id
         and lead_id = v_lead_id
         and status not in ('completed', 'closed', 'dropped', 'expired')
    ) then
      insert into public.lead_queue (
        tenant_id, lead_id, product_line, pipeline_id, stage_id, stage_key, status, tier
      )
      select p_tenant_id, l.id, l.product_line, l.pipeline_id, l.stage_id, 'new', 'unclaimed', 100
        from public.agent_leads l
       where l.id = v_lead_id and l.tenant_id = p_tenant_id;
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

-- Backfill: every lead that has no live work item and was never worked. Without this, the two leads
-- imported during the verification pass — and any list a tenant has already imported — stay
-- permanently undialable, which is the same defect wearing a different hat.
--
-- Scoped to leads that have NO row at all rather than to a date, because "was imported before the
-- fix" is not recorded anywhere and a settled work item must not be reopened.
-- Written as a loop rather than one statement because of how many rows this actually is. Measured
-- on the live project, 2026-09-23: 214,823 leads against 11,543 queue rows, so the backfill inserts
-- a little over 203,000. That is one statement large enough to exceed a statement timeout — and a
-- timeout here does not fail politely, it rolls back every migration in front of it too.
--
-- Batching does not weaken anything. The whole file still runs in one transaction, so the
-- all-or-nothing property is unchanged; each statement simply gets its own timeout budget. The
-- `not exists` guard makes each pass idempotent, which is also what terminates the loop.
do $$
declare
  v_batch integer;
  v_total bigint := 0;
begin
  loop
    insert into public.lead_queue (
      tenant_id, lead_id, product_line, pipeline_id, stage_id, stage_key, status, tier
    )
    select l.tenant_id, l.id, l.product_line, l.pipeline_id, l.stage_id, 'new', 'unclaimed', 100
      from public.agent_leads l
     where not exists (select 1 from public.lead_queue q where q.tenant_id = l.tenant_id and q.lead_id = l.id)
     limit 25000;

    get diagnostics v_batch = row_count;
    exit when v_batch = 0;
    v_total := v_total + v_batch;
    raise notice 'LA-2.2 backfill: % work items created so far', v_total;
  end loop;
  raise notice 'LA-2.2 backfill complete: % lead(s) can now be served', v_total;
end $$;

-- Proof the function now does what the comment claims, asserted rather than asserted-in-prose.
do $$
declare
  v_missing integer;
begin
  select count(*) into v_missing
    from public.agent_leads l
   where not exists (select 1 from public.lead_queue q where q.tenant_id = l.tenant_id and q.lead_id = l.id);
  if v_missing > 0 then
    raise exception 'LA-2.2 backfill left % lead(s) with no work item', v_missing;
  end if;

  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'import_agent_lead_batch'
         and pg_get_functiondef(p.oid) ~* 'insert\s+into\s+public\.lead_queue') <> 1 then
    raise exception 'import_agent_lead_batch does not enqueue';
  end if;
end $$;
