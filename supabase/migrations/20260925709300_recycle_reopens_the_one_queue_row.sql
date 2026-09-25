-- ---------------------------------------------------------------------------
-- Lead recycling · a cleared lead reopens its one queue row instead of inserting a second
--
-- Found live 2026-09-25 by the Module 2 demo seed: every recycle batch stuck in 'screening'. When a
-- lead cleared its re-screen, complete_nurture_reactivation (20260925706500) inserted a NEW lead_queue
-- row, but the live table is UNIQUE(lead_id) (constraint lead_queue_lead_id_key), and every recycled
-- lead already has its row. So each completion raised 'duplicate key value violates unique constraint
-- lead_queue_lead_id_key', nothing cleared, and no recycled lead was ever served.
--
-- The fix, and nothing else: when the lead has no open dialer item, its one existing row is reopened
-- (unclaimed, tier 100, claim, lock and disposition cleared). A lead whose one row is a partner
-- transfer is refused with a reason rather than reopened, because an unclaimed partner row is a live
-- transfer to the inbox, the floor and run_unclaimed_sla (Design 3). A lead with no row at all still
-- gets a new one. Restated verbatim from 20260925706500 otherwise (generated from that file, not
-- retyped); same signature and grants.
-- ---------------------------------------------------------------------------

create or replace function public.complete_nurture_reactivation(
  p_tenant_id uuid, p_reactivation_id uuid, p_status text, p_result_id uuid,
  p_outcome text, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_row tenant_nurture_reactivations%rowtype;
  v_ceiling integer;
  v_status text := p_status;
  v_reason text := p_reason;
  v_lead_state text;
  v_phone text;
  v_product text;
  v_pipeline uuid;
  v_stage uuid;
  v_item uuid;
  v_src_id uuid;
  v_src_partner uuid;
  v_src_product text;
  v_src_stage_key text;
  v_src_stage uuid;
  v_src_pipeline uuid;
  v_left integer;
begin
  if p_status not in ('cleared', 'blocked', 'failed') then
    raise exception 'REACTIVATION_STATUS_INVALID';
  end if;
  select * into v_row from tenant_nurture_reactivations
   where id = p_reactivation_id and tenant_id = p_tenant_id and status = 'pending'
   for update;
  if not found then
    raise exception 'REACTIVATION_NOT_FOUND';
  end if;
  if v_row.batch_id is not null then
    select b.attempt_ceiling into v_ceiling from tenant_recycle_batches b where b.id = v_row.batch_id for update;
  end if;

  select l.lead_state, nullif(btrim(coalesce(l.values->>'phone', l.values->>'phone_number', '')), ''),
         l.product_line, l.pipeline_id, l.stage_id
    into v_lead_state, v_phone, v_product, v_pipeline, v_stage
    from agent_leads l
   where l.id = v_row.lead_id and l.tenant_id = p_tenant_id
   for update;

  if v_status = 'cleared' then
    if v_lead_state is null then
      v_status := 'failed'; v_reason := 'The lead no longer exists.';
    elsif v_lead_state not in ('exhausted', 'closed', 'nurture') then
      v_status := 'failed';
      v_reason := format('The lead became %s while it was being screened, so it was left where it is.', v_lead_state);
    elsif coalesce((select s.suppressed from is_phone_suppressed(p_tenant_id, v_phone) s limit 1), false) then
      v_status := 'blocked'; v_reason := 'The number is on a suppression list now.';
    elsif exists (
      select 1 from lead_queue q
       where q.tenant_id = p_tenant_id and q.lead_id = v_row.lead_id
         and (q.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active')
              or (q.status = 'unclaimed' and q.partner_id is not null))
    ) then
      v_status := 'failed'; v_reason := 'The lead has an open work item with someone, so it was left alone.';
    else
      -- The dialer item: reuse an open one (partner_id null), else a new one. Never a partner row:
      -- the inbox, the floor and the SLA ladder read partner_id, and a recycled lead is not a live
      -- transfer (Design 3). The partner row it came from is recorded so reopen_expired_lead
      -- closes this item before reopening that one.
      select q.id into v_item
        from lead_queue q
       where q.tenant_id = p_tenant_id and q.lead_id = v_row.lead_id
         and q.status = 'unclaimed' and q.partner_id is null
       limit 1;
      if v_item is null then
        -- lead_queue is UNIQUE(lead_id) (lead_queue_lead_id_key, checked live 2026-09-25): a lead has
        -- exactly one row for its whole life, so a second insert can never succeed. Reopen that row.
        select q.id, q.partner_id, q.product_line, q.stage_key, q.stage_id, q.pipeline_id
          into v_src_id, v_src_partner, v_src_product, v_src_stage_key, v_src_stage, v_src_pipeline
          from lead_queue q
         where q.tenant_id = p_tenant_id and q.lead_id = v_row.lead_id
         limit 1;
        -- The lead and its work item sit in the same pipeline and stage (a board renders from both).
        if v_pipeline is null then
          v_pipeline := v_src_pipeline;
          v_stage := coalesce(v_stage, v_src_stage);
        end if;
        if v_src_partner is not null then
          -- Its one row is a partner transfer. Reopening it as unclaimed would put it back in the
          -- Transfer inbox and start the SLA ladder (Design 3), and a second row is impossible. Left alone.
          v_status := 'failed';
          v_reason := 'This lead came from a partner transfer, so recycling it would put it back in the Transfer inbox. It was left alone.';
        elsif coalesce(v_product, v_src_product) is null or v_pipeline is null then
          v_status := 'failed'; v_reason := 'The lead has no product line or pipeline, so it cannot be queued.';
        elsif v_src_id is not null then
          update lead_queue
             set status = 'unclaimed', tier = 100, owner_user_id = null, claimed_by = null, claimed_at = null,
                 locked_until = null, disposition = null, disposition_at = null, disposition_by = null,
                 product_line = coalesce(v_product, v_src_product), pipeline_id = v_pipeline, stage_id = v_stage,
                 queued_at = now(), updated_at = now()
           where id = v_src_id and tenant_id = p_tenant_id
          returning id into v_item;
        else
          insert into lead_queue
            (tenant_id, lead_id, product_line, pipeline_id, stage_id, stage_key, status, tier)
          values
            (p_tenant_id, v_row.lead_id, coalesce(v_product, v_src_product), v_pipeline, v_stage, 'new', 'unclaimed', 100)
          returning id into v_item;
        end if;
      end if;

      if v_status = 'cleared' then
        update agent_leads
           set lead_state = 'nurture', attempts_made = 0, attempt_ceiling = v_ceiling,
               recycle_count = coalesce(recycle_count, 0) + 1,
               next_dial_after = now(), next_preferred_slot = null,
               last_reactivated_at = now(), nurture_entered_at = now(), updated_at = now()
         where id = v_row.lead_id and tenant_id = p_tenant_id;
        -- $0: the lead was paid for on its campaign already. Unique on (tenant, lead, campaign), so
        -- this lands only where the lead had no source row for its campaign.
        insert into tenant_lead_sources (tenant_id, lead_id, campaign_id, source_type, cost_cents, source_key)
        values (p_tenant_id, v_row.lead_id, v_row.campaign_id, 'recycle', 0,
                'recycle_batch:' || coalesce(v_row.batch_id::text, v_row.id::text))
        on conflict (tenant_id, lead_id, campaign_id) do nothing;
      end if;
    end if;
  end if;

  -- Blocked or failed: the lead is held where it was. One stranded by the old flow (nurture, due,
  -- with no work item) goes back to exhausted so it reads as what it is.
  if v_status <> 'cleared' and v_lead_state = 'nurture' then
    update agent_leads set lead_state = 'exhausted', next_dial_after = null, next_preferred_slot = null, updated_at = now()
     where id = v_row.lead_id and tenant_id = p_tenant_id and lead_state = 'nurture'
       and not exists (select 1 from lead_queue q where q.tenant_id = p_tenant_id and q.lead_id = v_row.lead_id
                        and q.status in ('unclaimed', 'claimed'));
  end if;

  update tenant_nurture_reactivations
     set status = v_status, screening_result_id = p_result_id, screening_outcome = p_outcome,
         reason = left(v_reason, 500), completed_at = now(), leased_until = null
   where id = v_row.id
  returning * into v_row;

  if v_row.batch_id is not null then
    update tenant_recycle_batches
       set cleared = cleared + (v_status = 'cleared')::integer,
           blocked = blocked + (v_status = 'blocked')::integer,
           failed = failed + (v_status = 'failed')::integer,
           last_progress_at = now()
     where id = v_row.batch_id;
    select count(*) into v_left from tenant_nurture_reactivations
     where batch_id = v_row.batch_id and status = 'pending';
    if v_left = 0 then
      update tenant_recycle_batches set status = 'complete', completed_at = now()
       where id = v_row.batch_id and status = 'screening';
      if found then
        insert into audit_log (actor_type, action, target_type, target_id, metadata)
        select 'system', 'tenant.recycle_batch_completed', 'recycle_batch', b.id::text,
               jsonb_build_object('tenantId', b.tenant_id, 'campaignId', b.campaign_id, 'queued', b.queued,
                                  'cleared', b.cleared, 'blocked', b.blocked, 'failed', b.failed)
          from tenant_recycle_batches b where b.id = v_row.batch_id;
      end if;
    end if;
  end if;

  return to_jsonb(v_row) || jsonb_build_object('work_item_id', v_item);
end;
$function$;

revoke all on function public.complete_nurture_reactivation(uuid, uuid, text, uuid, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.complete_nurture_reactivation(uuid, uuid, text, uuid, text, text) to service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_src text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709300: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  select pg_get_functiondef('public.complete_nurture_reactivation(uuid, uuid, text, uuid, text, text)'::regprocedure) into v_src;
  if v_src !~ 'update lead_queue\s+set status = ''unclaimed''' then
    raise exception 'complete_nurture_reactivation does not reopen the lead''s existing row';
  end if;
  if v_src ~ 'nurtured_from_work_item_id' then
    raise exception 'complete_nurture_reactivation still builds a second, partner-linked row';
  end if;
  if strpos(v_src, 'if v_src_partner is not null then') = 0 then
    raise exception 'a partner-transfer row could be reopened as a live transfer';
  end if;
  -- The insert that remains is only for a lead with no row at all, and never carries a partner.
  if v_src ~ 'insert into lead_queue\s*\([^)]*\mpartner_id\M' then
    raise exception 'complete_nurture_reactivation inserts a work item with a partner_id';
  end if;
end $$;
