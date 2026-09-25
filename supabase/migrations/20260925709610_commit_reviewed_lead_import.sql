-- LA-2.2-9 / LA-2.2-4 / LA-2.6-1 · one transaction for everything a list import writes.
--
-- A failure mid-commit must leave zero rows imported. The leads already committed in one
-- transaction (import_agent_lead_batch), but the scrub-rejection ledger was a separate round trip
-- written BEFORE it, so a file that failed on row 900 (a NUL in a first name was enough) left its
-- ledger rows behind: 0 leads, and a campaign whose usable-record count had already dropped.
--
-- commit_reviewed_lead_import does, in one transaction, in this order:
--   1. locks the staged batch (when there is one) so a second press waits and then stops,
--   2. records the scrub rejections (record_campaign_scrub_rejections, unchanged),
--   3. commits the leads, their sources and the campaign spend (import_agent_lead_batch, unchanged,
--      which also marks the batch completed),
--   4. stamps each NEW lead's dial_timezone from its item (20260925709600),
--   5. files each item's consent certificate in tenant_consent_artefacts as 'pending' (LA-2.6-1),
--      for new leads and for people the file matched alike: the certificate is this vendor's
--      evidence for this person, whoever already had them.
-- Any exception rolls all five back.
--
-- It calls the two existing functions rather than restating them, so their latest definitions
-- (20260924330100 and 20260925703100) stay the only copies.
--
-- p_rejections is {"campaign_id": uuid, "items": [...]} (the ledger's own payload) or null.
-- Items keep import_agent_lead_batch's shape, plus two optional keys:
--   dial_timezone  an IANA zone, applied to new leads only
--   consent        {provider, certificate_id, certificate_url, consent_timestamp, ip, source_url, landing_page}
-- Returns {"ids": [lead id per item, in order], "rejections_recorded": n, "artefacts": n}.

create or replace function public.commit_reviewed_lead_import(
  p_tenant_id uuid,
  p_created_by uuid,
  p_items jsonb,
  p_batch_id uuid,
  p_campaign_spend jsonb,
  p_rejections jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_ids jsonb := '[]'::jsonb;
  v_status text;
  v_rejection_campaign uuid;
  v_recorded integer := 0;
  v_artefacts integer := 0;
begin
  if p_tenant_id is null or p_created_by is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'IMPORT_BATCH_INVALID';
  end if;

  -- 1. The staged batch, first, so two commits of one review serialise here before either writes.
  if p_batch_id is not null then
    select b.status into v_status
      from public.agent_lead_import_batches b
     where b.id = p_batch_id and b.tenant_id = p_tenant_id
       for update;
    if not found then raise exception 'IMPORT_BATCH_NOT_FOUND'; end if;
    if v_status <> 'processing' then raise exception 'IMPORT_BATCH_ALREADY_COMMITTED'; end if;
  end if;

  -- 2. The ledger, inside this transaction.
  if p_rejections is not null and jsonb_typeof(p_rejections) = 'object'
     and jsonb_typeof(p_rejections->'items') = 'array'
     and jsonb_array_length(p_rejections->'items') > 0 then
    v_rejection_campaign := nullif(p_rejections->>'campaign_id', '')::uuid;
    if v_rejection_campaign is null then raise exception 'REJECTION_SCOPE_INVALID'; end if;
    v_recorded := public.record_campaign_scrub_rejections(p_tenant_id, v_rejection_campaign, p_created_by, p_rejections->'items');
  end if;

  -- 3. The leads. A file where every row was rejected has no items, and the batch is completed
  --    here instead, as import_agent_lead_batch would have done.
  if jsonb_array_length(p_items) > 0 then
    v_ids := public.import_agent_lead_batch(p_tenant_id, p_created_by, p_items, p_batch_id, p_campaign_spend);
  elsif p_batch_id is not null then
    update public.agent_lead_import_batches
       set status = 'completed', completed_at = now(), updated_at = now()
     where id = p_batch_id and tenant_id = p_tenant_id;
  end if;

  if jsonb_array_length(p_items) > 0 then
    -- 4. The corrected calling zone, on the leads this import created.
    update public.agent_leads l
       set dial_timezone = z.zone
      from (
        select (v_ids->>(e.ordinality::integer - 1))::uuid as lead_id, e.value->>'dial_timezone' as zone
          from jsonb_array_elements(p_items) with ordinality as e(value, ordinality)
         where nullif(e.value->>'lead_id', '') is null
           and coalesce(e.value->>'dial_timezone', '') ~ '^(America|Pacific)/[A-Za-z_]+(/[A-Za-z_]+)?$'
      ) z
     where l.id = z.lead_id and l.tenant_id = p_tenant_id;

    -- 5. The certificates. One per lead per provider (the table's own key), so a person already
    --    holding this provider's certificate keeps the one filed first.
    insert into public.tenant_consent_artefacts (
      tenant_id, lead_id, provider, certificate_id, certificate_url,
      consent_timestamp, ip, source_url, landing_page, capture_status
    )
    select p_tenant_id,
           (v_ids->>(e.ordinality::integer - 1))::uuid,
           e.value->'consent'->>'provider',
           left(nullif(e.value->'consent'->>'certificate_id', ''), 128),
           left(nullif(e.value->'consent'->>'certificate_url', ''), 2048),
           case when coalesce(e.value->'consent'->>'consent_timestamp', '') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$'
                then (e.value->'consent'->>'consent_timestamp')::timestamptz end,
           left(nullif(e.value->'consent'->>'ip', ''), 64),
           left(nullif(e.value->'consent'->>'source_url', ''), 2048),
           left(nullif(e.value->'consent'->>'landing_page', ''), 2048),
           'pending'
      from jsonb_array_elements(p_items) with ordinality as e(value, ordinality)
     where jsonb_typeof(e.value->'consent') = 'object'
       and e.value->'consent'->>'provider' in ('trustedform', 'jornaya', 'other')
       and (nullif(e.value->'consent'->>'certificate_url', '') is not null
            or nullif(e.value->'consent'->>'certificate_id', '') is not null)
    on conflict (tenant_id, lead_id, provider) do nothing;
    get diagnostics v_artefacts = row_count;
  end if;

  return jsonb_build_object('ids', v_ids, 'rejections_recorded', v_recorded, 'artefacts', v_artefacts);
end;
$function$;

revoke all on function public.commit_reviewed_lead_import(uuid, uuid, jsonb, uuid, jsonb, jsonb) from public, anon, authenticated, tenant_app;
grant execute on function public.commit_reviewed_lead_import(uuid, uuid, jsonb, uuid, jsonb, jsonb) to service_role;

-- ── proof ──────────────────────────────────────────────────────────────────────────────────────
-- Structural, plus one behavioural run that is rolled back: a failing item must take the ledger
-- rows written before it down with it.
do $$
declare
  v_body text;
  v_tenant uuid;
  v_user uuid;
  v_vendor uuid;
  v_campaign uuid;
  v_ledger integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709610: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if to_regprocedure('public.commit_reviewed_lead_import(uuid, uuid, jsonb, uuid, jsonb, jsonb)') is null then
    raise exception '20260925709610: commit_reviewed_lead_import was not created';
  end if;
  v_body := pg_get_functiondef('public.commit_reviewed_lead_import(uuid, uuid, jsonb, uuid, jsonb, jsonb)'::regprocedure);
  if position('record_campaign_scrub_rejections' in v_body) = 0 or position('import_agent_lead_batch' in v_body) = 0 then
    raise exception '20260925709610: the commit does not record the ledger and the leads in one body';
  end if;
  if position('record_campaign_scrub_rejections' in v_body) > position('public.import_agent_lead_batch(' in v_body) then
    raise exception '20260925709610: the ledger must be written inside the transaction, before the leads';
  end if;
  if has_function_privilege('anon', 'public.commit_reviewed_lead_import(uuid, uuid, jsonb, uuid, jsonb, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.commit_reviewed_lead_import(uuid, uuid, jsonb, uuid, jsonb, jsonb)', 'execute') then
    raise exception '20260925709610: commit_reviewed_lead_import must be service-role only';
  end if;

  select tu.tenant_id, tu.user_id into v_tenant, v_user
    from public.tenant_users tu join public.users u on u.id = tu.user_id
   where u.status = 'active'
   limit 1;
  if v_tenant is null then
    raise notice '20260925709610: behavioural check skipped, no active tenant user';
    return;
  end if;

  insert into public.tenant_lead_vendors (tenant_id, name, lead_type)
    values (v_tenant, '709610 atomic check ' || gen_random_uuid()::text, 'list')
    returning id into v_vendor;
  insert into public.tenant_campaigns (tenant_id, vendor_id, name, lead_type, total_spend_cents, records_purchased)
    values (v_tenant, v_vendor, '709610 atomic check ' || gen_random_uuid()::text, 'list', 1000, 10)
    returning id into v_campaign;

  -- An item that cannot be a lead (no template, no pipeline) after a valid ledger payload.
  begin
    perform public.commit_reviewed_lead_import(
      v_tenant, v_user,
      jsonb_build_array(jsonb_build_object('values', jsonb_build_object('first_name', 'Test'), 'campaign_id', v_campaign)),
      null, null,
      jsonb_build_object('campaign_id', v_campaign, 'items', jsonb_build_array(
        jsonb_build_object('phone_digits', '3125550142', 'outcome', 'dnc', 'source_key', 'csv:2')))
    );
    raise exception '20260925709610: an invalid item was committed';
  exception
    when raise_exception then
      if sqlerrm like '20260925709610:%' then raise; end if;
  end;

  select count(*) into v_ledger from public.tenant_campaign_scrub_rejections where campaign_id = v_campaign;
  if v_ledger <> 0 then
    raise exception '20260925709610: a failed commit left % ledger rows behind', v_ledger;
  end if;

  delete from public.tenant_campaigns where id = v_campaign;
  delete from public.tenant_lead_vendors where id = v_vendor;
end $$;
