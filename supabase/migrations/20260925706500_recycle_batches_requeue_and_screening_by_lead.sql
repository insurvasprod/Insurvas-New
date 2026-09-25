-- ---------------------------------------------------------------------------
-- Lead recycling (LA-2 §4) · batches with an angle, a work item the dialer can serve, and a
-- screening that holds one lead rather than the whole campaign.
--
-- What was wrong with 20260913450000 (the only earlier definition of these functions):
--
--   1. A reactivated lead was never dialled. An exhausted lead's work item is 'completed'
--      (complete_existing_dial_disposition, 20260924240200), reactivate_nurture reopened nothing,
--      and serve_next_lead serves lead_queue rows only. Tier 6 never saw a recycled lead.
--   2. One screening that did not complete set the WHOLE campaign's scrub_status to 'failed', and
--      every lead in it (fresh ones too) stopped being served. The lead that failed stayed in
--      nurture, due now.
--   3. The lead was moved to nurture BEFORE it was screened; the campaign-wide 'scrubbing' flag was
--      the only thing between an unscreened number and the dialer.
--   4. The rest clock read updated_at, which anything touches, and a rested lead with a future due
--      date could be pulled forward by a run.
--   5. There was no angle, no per-pass attempt ceiling and no record of a run as a thing.
--
-- Now (user decisions of 2026-09-25):
--
--   tenant_recycle_batches       one row per run: the angle (required), an optional script, the
--                                attempt ceiling for this pass (default 3), the rule as it stood,
--                                the $0 cost to attribute, progress and counts.
--   recycle_lead_candidates      ONE definition of who a run may pick up, with a verdict for every
--                                lead it looked at. The pool breakdown, "excluded as too recent",
--                                "eligible now" and the run itself all read it.
--   reactivate_nurture           (new signature) creates the batch and one PENDING reactivation per
--                                eligible lead. It changes no lead: nothing is servable until its
--                                own screening clears.
--   recycle_batch_claim_chunk    hands the page the next N pending leads to screen, each leased
--                                for five minutes. The page drives the run in chunks; progress is
--                                in the database, so a closed tab loses nothing. A batch with no
--                                progress for 15 minutes can be resumed by an owner.
--   complete_nurture_reactivation (same signature) settles one lead:
--                                  cleared → lead to nurture, attempts reset, the batch's ceiling
--                                            on the lead, and an UNCLAIMED DIALER work item
--                                            (partner_id null) so serve_next_lead's tier 6
--                                            serves it. An open dialer item is reused; the
--                                            one-open-item-per-lead index is never raced.
--                                  blocked → the lead stays where it was (suppressed by the app).
--                                  failed  → the lead is held where it was; nothing else changes.
--                                It never touches tenant_campaigns.scrub_status.
--   tenant_recycle_pool          per campaign, how many leads fall in each verdict.
--   tenant_recycle_batch_report  past batches: dials, contacts, contact rate, policies.
--   lead_recycle_context         the angle and script of the pass a lead is on — for the dialer.
--
-- Rules enforced here, not only in the UI:
--   · "Not interested" leads are recyclable only when the actor is an OWNER, the rule allows the
--     outcome, and at least 90 days (or the rule's wait, if longer) have passed since that outcome.
--   · Never eligible: any do-not-call outcome ever, a dnc / litigator screening outcome, any hit on
--     is_phone_suppressed (federal, state, litigator, internal DNC, complaint).
--   · A resting nurture lead (next_dial_after in the future) and a nurture lead already in the
--     dialer are left alone.
--   · Inbound partner leads (Design 3's constraint): the inbox, the floor and run_unclaimed_sla all
--     key on lead_queue.partner_id. A recycled lead only ever gets a row with partner_id NULL, the
--     same way nurture_expired_transfer (20260924230400) queues an expired transfer, and it points
--     nurtured_from_work_item_id at the partner row so reopen_expired_lead closes it first. A lead
--     with a partner row still open is never picked up. Asserted below.
--
-- The $0 'recycle' source row: tenant_lead_sources is unique on (tenant, lead, campaign) and every
-- campaign lead already has its import row there, and import_agent_lead_source's ON CONFLICT
-- depends on that exact index. The row is written ON CONFLICT DO NOTHING, so it lands only for a
-- lead that had no source row for its campaign; the batch itself carries the $0 attribution.
--
-- Additive and idempotent. No lead_queue columns or triggers. serve_next_lead is not touched.
-- ---------------------------------------------------------------------------

-- ── schema ────────────────────────────────────────────────────────────────

alter table public.agent_leads add column if not exists attempt_ceiling integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agent_leads_attempt_ceiling_range') then
    alter table public.agent_leads
      add constraint agent_leads_attempt_ceiling_range
      check (attempt_ceiling is null or attempt_ceiling between 1 and 7) not valid;
  end if;
  execute $c$comment on column public.agent_leads.attempt_ceiling is
    'Dials allowed on the current pass. Null = the cadence ceiling (7). Set by a recycle batch (20260925706500); read by schedule_next_attempt (20260925706600).'$c$;
end $$;

create table if not exists public.tenant_recycle_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid not null references public.tenant_campaigns(id) on delete cascade,
  angle text not null check (char_length(btrim(angle)) between 3 and 500),
  script text check (script is null or char_length(script) <= 5000),
  attempt_ceiling integer not null default 3 check (attempt_ceiling between 1 and 7),
  wait_days integer not null check (wait_days between 1 and 3650),
  allowed_dispositions text[] not null,
  max_recycles integer not null check (max_recycles between 0 and 100),
  cost_cents integer not null default 0 check (cost_cents >= 0),
  status text not null default 'screening' check (status in ('screening', 'complete')),
  queued integer not null default 0 check (queued >= 0),
  cleared integer not null default 0 check (cleared >= 0),
  blocked integer not null default 0 check (blocked >= 0),
  failed integer not null default 0 check (failed >= 0),
  excluded_too_recent integer not null default 0 check (excluded_too_recent >= 0),
  said_no integer not null default 0 check (said_no >= 0),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_progress_at timestamptz not null default now(),
  completed_at timestamptz,
  -- One run at a time per campaign: a second would race the first for the same leads.
  constraint tenant_recycle_batches_one_open exclude using btree (campaign_id with =) where (status = 'screening')
);

create index if not exists tenant_recycle_batches_campaign_idx
  on public.tenant_recycle_batches (tenant_id, campaign_id, created_at desc);

alter table public.tenant_nurture_reactivations
  add column if not exists batch_id uuid references public.tenant_recycle_batches(id) on delete set null,
  add column if not exists leased_until timestamptz;

create index if not exists tenant_nurture_reactivations_batch_idx
  on public.tenant_nurture_reactivations (batch_id, status)
  where batch_id is not null;

alter table public.tenant_recycle_batches enable row level security;
drop policy if exists tenant_recycle_batches_scoped on public.tenant_recycle_batches;
create policy tenant_recycle_batches_scoped on public.tenant_recycle_batches for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.tenant_recycle_batches from anon, authenticated, public;
grant select on public.tenant_recycle_batches to tenant_app;
grant select, insert, update on public.tenant_recycle_batches to service_role;

-- ── who may recycle what ──────────────────────────────────────────────────

create or replace function public.recycle_lead_candidates(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_actor uuid
)
returns table (
  lead_id uuid,
  campaign_id uuid,
  lead_state text,
  last_disposition text,
  last_outcome_at timestamptz,
  rested_since timestamptz,
  verdict text
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_role text;
begin
  select tu.role into v_role
    from tenant_users tu join users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor
     and tu.accepted_at is not null and u.status = 'active'
   limit 1;
  v_role := coalesce(v_role, '');

  return query
  with rules as (
    select c.id as cid,
           coalesce(r.wait_days, 180) as wait_days,
           coalesce(r.allowed_dispositions, array['no_answer', 'voicemail']::text[]) as allowed,
           coalesce(r.max_recycles, 3) as max_recycles
      from tenant_campaigns c
      left join tenant_campaign_recycle_rules r on r.campaign_id = c.id and r.tenant_id = c.tenant_id
     where c.tenant_id = p_tenant_id
       and (p_campaign_id is null or c.id = p_campaign_id)
  ),
  pool as materialized (
    select l.id, l.campaign_id as cid, l.lead_state as state, l.next_dial_after, l.screening_outcome,
           coalesce(l.recycle_count, 0) as recycle_count,
           nullif(btrim(coalesce(l.values->>'phone', l.values->>'phone_number', '')), '') as phone,
           la.disposition as last_disposition, la.attempted_at as last_outcome_at,
           -- The rest clock: the last dial or the last reactivation, whichever is later. Never the
           -- row's last-edit time, which any change to the lead moves.
           coalesce(greatest(la.attempted_at, l.last_reactivated_at), l.nurture_entered_at, l.created_at) as rested_since,
           ru.wait_days, ru.allowed, ru.max_recycles
      from agent_leads l
      join rules ru on ru.cid = l.campaign_id
      left join lateral (
        select ca.disposition, ca.attempted_at
          from tenant_call_attempts ca
         where ca.tenant_id = p_tenant_id and ca.lead_id = l.id
         order by ca.attempted_at desc
         limit 1
      ) la on true
     where l.tenant_id = p_tenant_id
       and l.lead_state in ('exhausted', 'nurture', 'closed')
       and (l.lead_state <> 'closed' or la.disposition = 'not_interested')
  )
  select p.id, p.cid, p.state, p.last_disposition, p.last_outcome_at, p.rested_since,
         case
           when exists (select 1 from tenant_call_attempts d
                         where d.tenant_id = p_tenant_id and d.lead_id = p.id and d.disposition = 'do_not_call')
             or coalesce(p.screening_outcome, '') in ('dnc', 'tcpa_litigator')
             or coalesce(sup.suppressed, false) then 'never'
           when p.phone is null then 'no_phone'
           when p.state = 'nurture' and p.next_dial_after > now() then 'resting'
           when p.state = 'nurture' and p.next_dial_after is not null and coalesce(oq.dialer_open, false) then 'live'
           when exists (select 1 from tenant_nurture_reactivations nr
                         where nr.tenant_id = p_tenant_id and nr.lead_id = p.id
                           and nr.status = 'pending' and nr.batch_id is not null) then 'pending'
           when coalesce(oq.worked, false) then 'being_worked'
           when p.recycle_count >= p.max_recycles then 'capped'
           when not (coalesce(p.last_disposition, '') = any(p.allowed)) then 'outcome_not_in_rule'
           when p.last_disposition = 'not_interested' and v_role <> 'owner' then 'owner_only'
           when p.rested_since > now() - make_interval(days =>
                  case when p.last_disposition = 'not_interested' then greatest(p.wait_days, 90) else p.wait_days end)
             then 'too_recent'
           else 'eligible'
         end
    from pool p
    left join lateral (select s.suppressed from is_phone_suppressed(p_tenant_id, p.phone) s limit 1) sup on true
    left join lateral (
      select bool_or(q.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active')
                     or (q.status = 'unclaimed' and q.partner_id is not null)) as worked,
             bool_or(q.status = 'unclaimed' and q.partner_id is null) as dialer_open
        from lead_queue q
       where q.tenant_id = p_tenant_id and q.lead_id = p.id
         and q.status in ('unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active')
    ) oq on true;
end;
$function$;

revoke all on function public.recycle_lead_candidates(uuid, uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.recycle_lead_candidates(uuid, uuid, uuid) to service_role;

-- Per campaign, the pool the page draws: every verdict counted, plus the board's two source pools.
create or replace function public.tenant_recycle_pool(p_tenant_id uuid, p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_out jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'campaign_id', g.campaign_id,
           'exhausted_no_outcome', g.exhausted_no_outcome,
           'said_no', g.said_no,
           'never', g.never,
           'no_phone', g.no_phone,
           'resting', g.resting,
           'live', g.live,
           'pending', g.pending,
           'being_worked', g.being_worked,
           'capped', g.capped,
           'outcome_not_in_rule', g.outcome_not_in_rule,
           'owner_only', g.owner_only,
           'too_recent', g.too_recent,
           'eligible', g.eligible,
           'eligible_said_no', g.eligible_said_no
         )), '[]'::jsonb)
    into v_out
    from (
      select c.campaign_id,
             count(*) filter (where c.lead_state = 'exhausted'
                                and coalesce(c.last_disposition, 'no_answer') in ('no_answer', 'voicemail', 'busy', 'call_dropped', 'disconnected', 'wrong_number'))::integer as exhausted_no_outcome,
             count(*) filter (where c.lead_state = 'closed' and c.last_disposition = 'not_interested')::integer as said_no,
             count(*) filter (where c.verdict = 'never')::integer as never,
             count(*) filter (where c.verdict = 'no_phone')::integer as no_phone,
             count(*) filter (where c.verdict = 'resting')::integer as resting,
             count(*) filter (where c.verdict = 'live')::integer as live,
             count(*) filter (where c.verdict = 'pending')::integer as pending,
             count(*) filter (where c.verdict = 'being_worked')::integer as being_worked,
             count(*) filter (where c.verdict = 'capped')::integer as capped,
             count(*) filter (where c.verdict = 'outcome_not_in_rule')::integer as outcome_not_in_rule,
             count(*) filter (where c.verdict = 'owner_only')::integer as owner_only,
             count(*) filter (where c.verdict = 'too_recent')::integer as too_recent,
             count(*) filter (where c.verdict = 'eligible')::integer as eligible,
             count(*) filter (where c.verdict = 'eligible' and c.last_disposition = 'not_interested')::integer as eligible_said_no
        from recycle_lead_candidates(p_tenant_id, null, p_actor) c
       group by c.campaign_id
    ) g;
  return v_out;
end;
$function$;

revoke all on function public.tenant_recycle_pool(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_recycle_pool(uuid, uuid) to service_role;

-- ── start a batch ─────────────────────────────────────────────────────────
--
-- The 3-argument form is dropped: it moved leads before screening them and flagged the whole
-- campaign. Its only caller (lib/nurture/service.ts) now calls this one.
drop function if exists public.reactivate_nurture(uuid, uuid, uuid);

create or replace function public.reactivate_nurture(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_actor uuid,
  p_angle text,
  p_script text,
  p_attempt_ceiling integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_role text;
  v_wait integer;
  v_allowed text[];
  v_max integer;
  v_batch uuid;
  v_queued integer := 0;
  v_recent integer := 0;
  v_said_no integer := 0;
begin
  select tu.role into v_role
    from tenant_users tu join users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor
     and tu.accepted_at is not null and u.status = 'active'
   limit 1;
  if coalesce(v_role, '') not in ('owner', 'producer') then
    raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED';
  end if;
  if not exists (select 1 from tenant_campaigns where id = p_campaign_id and tenant_id = p_tenant_id) then
    raise exception using errcode = 'P0002', message = 'CAMPAIGN_NOT_FOUND';
  end if;
  if p_angle is null or char_length(btrim(p_angle)) < 3 or char_length(btrim(p_angle)) > 500 then
    raise exception using errcode = '22023', message = 'RECYCLE_ANGLE_REQUIRED';
  end if;
  if p_script is not null and char_length(p_script) > 5000 then
    raise exception using errcode = '22023', message = 'RECYCLE_SCRIPT_TOO_LONG';
  end if;
  if p_attempt_ceiling is null or p_attempt_ceiling < 1 or p_attempt_ceiling > 7 then
    raise exception using errcode = '22023', message = 'RECYCLE_CEILING_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('recycle_batch:' || p_campaign_id::text, 0));
  if exists (select 1 from tenant_recycle_batches b
              where b.tenant_id = p_tenant_id and b.campaign_id = p_campaign_id and b.status = 'screening') then
    raise exception using errcode = 'P0001', message = 'RECYCLE_BATCH_OPEN';
  end if;

  select r.wait_days, r.allowed_dispositions, r.max_recycles into v_wait, v_allowed, v_max
    from tenant_campaign_recycle_rules r
   where r.tenant_id = p_tenant_id and r.campaign_id = p_campaign_id;
  v_wait := coalesce(v_wait, 180);
  v_allowed := coalesce(v_allowed, array['no_answer', 'voicemail']::text[]);
  v_max := coalesce(v_max, 3);
  if v_max = 0 then
    raise exception using errcode = 'P0001', message = 'RECYCLE_CAP_ZERO';
  end if;

  insert into tenant_recycle_batches
    (tenant_id, campaign_id, angle, script, attempt_ceiling, wait_days, allowed_dispositions, max_recycles, cost_cents, created_by)
  values
    (p_tenant_id, p_campaign_id, btrim(p_angle), nullif(btrim(coalesce(p_script, '')), ''), p_attempt_ceiling, v_wait, v_allowed, v_max, 0, p_actor)
  returning id into v_batch;

  -- One pending reactivation per lead; no lead changes until its own screening clears. The
  -- recycle number is the lead's next, counting every earlier try (a failed screening included),
  -- so (lead_id, recycle_number) stays unique when a held lead is tried again.
  with pick as materialized (
    select c.lead_id, c.verdict, c.last_disposition
      from recycle_lead_candidates(p_tenant_id, p_campaign_id, p_actor) c
     where c.verdict in ('eligible', 'too_recent')
  ), ins as (
    insert into tenant_nurture_reactivations (tenant_id, lead_id, campaign_id, recycle_number, reason, batch_id)
    select p_tenant_id, pk.lead_id, p_campaign_id,
           coalesce((select max(nr.recycle_number) from tenant_nurture_reactivations nr where nr.lead_id = pk.lead_id), 0) + 1,
           'Waiting for a fresh suppression screening',
           v_batch
      from pick pk
     where pk.verdict = 'eligible'
    returning 1
  )
  select (select count(*) from ins),
         (select count(*) from pick where verdict = 'too_recent'),
         (select count(*) from pick where verdict = 'eligible' and last_disposition = 'not_interested')
    into v_queued, v_recent, v_said_no;

  if v_queued = 0 then
    -- Rolls the batch row back with it.
    raise exception using errcode = 'P0001', message = 'RECYCLE_NOTHING_ELIGIBLE';
  end if;

  update tenant_recycle_batches
     set queued = v_queued, excluded_too_recent = v_recent, said_no = v_said_no, last_progress_at = now()
   where id = v_batch;

  insert into audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_actor, 'tenant.recycle_batch_started', 'recycle_batch', v_batch::text,
          jsonb_build_object('tenantId', p_tenant_id, 'campaignId', p_campaign_id, 'queued', v_queued,
                             'excludedTooRecent', v_recent, 'saidNo', v_said_no,
                             'attemptCeiling', p_attempt_ceiling, 'angle', btrim(p_angle)));

  return jsonb_build_object('batch_id', v_batch, 'campaign_id', p_campaign_id, 'queued', v_queued,
                            'excluded_too_recent', v_recent, 'said_no', v_said_no,
                            'attempt_ceiling', p_attempt_ceiling);
end;
$function$;

revoke all on function public.reactivate_nurture(uuid, uuid, uuid, text, text, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.reactivate_nurture(uuid, uuid, uuid, text, text, integer) to service_role;

-- ── screen it, a chunk at a time ──────────────────────────────────────────

create or replace function public.recycle_batch_claim_chunk(
  p_tenant_id uuid,
  p_batch_id uuid,
  p_actor uuid,
  p_limit integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_batch tenant_recycle_batches%rowtype;
  v_role text;
  v_stalled boolean;
  v_items jsonb;
  v_pending integer;
begin
  select * into v_batch from tenant_recycle_batches where id = p_batch_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'RECYCLE_BATCH_NOT_FOUND';
  end if;
  if v_batch.status <> 'screening' then
    return jsonb_build_object('done', true, 'items', '[]'::jsonb, 'pending', 0);
  end if;

  select tu.role into v_role
    from tenant_users tu join users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor
     and tu.accepted_at is not null and u.status = 'active'
   limit 1;
  if coalesce(v_role, '') not in ('owner', 'producer') then
    raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED';
  end if;
  -- The person who started a batch drives it. Anyone else may pick it up only when it has made no
  -- progress for 15 minutes, and only an owner.
  v_stalled := v_batch.last_progress_at < now() - interval '15 minutes';
  if p_actor is distinct from v_batch.created_by then
    if v_role <> 'owner' then
      raise exception using errcode = '42501', message = 'RECYCLE_BATCH_NOT_YOURS';
    end if;
    if not v_stalled then
      raise exception using errcode = 'P0001', message = 'RECYCLE_BATCH_RUNNING';
    end if;
  end if;

  with picked as (
    select nr.id
      from tenant_nurture_reactivations nr
     where nr.tenant_id = p_tenant_id and nr.batch_id = p_batch_id and nr.status = 'pending'
       and (nr.leased_until is null or nr.leased_until < now())
     order by nr.reactivated_at, nr.id
     limit greatest(1, least(coalesce(p_limit, 25), 100))
     for update skip locked
  ), leased as (
    update tenant_nurture_reactivations nr
       set leased_until = now() + interval '5 minutes'
      from picked
     where nr.id = picked.id
    returning nr.id, nr.lead_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'reactivation_id', le.id,
           'lead_id', le.lead_id,
           'phone', coalesce(l.values->>'phone', l.values->>'phone_number'))), '[]'::jsonb)
    into v_items
    from leased le
    join agent_leads l on l.id = le.lead_id and l.tenant_id = p_tenant_id;

  select count(*) into v_pending
    from tenant_nurture_reactivations nr
   where nr.tenant_id = p_tenant_id and nr.batch_id = p_batch_id and nr.status = 'pending';

  return jsonb_build_object('done', false, 'items', v_items, 'pending', v_pending, 'stalled', v_stalled);
end;
$function$;

revoke all on function public.recycle_batch_claim_chunk(uuid, uuid, uuid, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.recycle_batch_claim_chunk(uuid, uuid, uuid, integer) to service_role;

-- ── settle one lead ───────────────────────────────────────────────────────
--
-- 20260913450000's signature. The campaign's scrub_status is no longer written here at all.
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
        select q.id, q.partner_id, q.product_line, q.stage_key, q.stage_id, q.pipeline_id
          into v_src_id, v_src_partner, v_src_product, v_src_stage_key, v_src_stage, v_src_pipeline
          from lead_queue q
         where q.tenant_id = p_tenant_id and q.lead_id = v_row.lead_id
         order by q.queued_at desc nulls last, q.created_at desc
         limit 1;
        -- The lead and its work item sit in the same pipeline and stage (a board renders from both).
        if v_pipeline is null then
          v_pipeline := v_src_pipeline;
          v_stage := coalesce(v_stage, v_src_stage);
        end if;
        if coalesce(v_product, v_src_product) is null or v_pipeline is null then
          v_status := 'failed'; v_reason := 'The lead has no product line or pipeline, so it cannot be queued.';
        else
          insert into lead_queue
            (tenant_id, lead_id, product_line, pipeline_id, stage_id, stage_key, status, tier, nurtured_from_work_item_id)
          values
            (p_tenant_id, v_row.lead_id, coalesce(v_product, v_src_product), v_pipeline, v_stage,
             case when v_src_stage is not distinct from v_stage then coalesce(v_src_stage_key, 'new') else 'new' end,
             'unclaimed', 100,
             case when v_src_partner is not null then v_src_id end)
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

-- ── what the batches did ──────────────────────────────────────────────────
--
-- Contacts and the rate use tenant_recycle_performance's own definitions (tenant_lead_activity:
-- contacts are dispositions other than the no-contact six, divided by clicked dials), so a
-- batch's rate and the fresh baseline beside it are the same measurement. A dial belongs to the
-- lead's latest cleared reactivation before it. Policies are issued rows after the reactivation.
create or replace function public.tenant_recycle_batch_report(
  p_tenant_id uuid,
  p_campaign_id uuid default null,
  p_limit integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_out jsonb;
begin
  with c as materialized (
    select nr.batch_id, nr.lead_id, nr.completed_at,
           (select min(n2.completed_at) from tenant_nurture_reactivations n2
             where n2.tenant_id = p_tenant_id and n2.lead_id = nr.lead_id and n2.status = 'cleared'
               and n2.completed_at > nr.completed_at) as until_at
      from tenant_nurture_reactivations nr
     where nr.tenant_id = p_tenant_id and nr.status = 'cleared' and nr.completed_at is not null
       and (p_campaign_id is null or nr.campaign_id = p_campaign_id)
  ),
  perf as materialized (
    select c.batch_id, c.lead_id,
           (select count(a.clicked_at) from tenant_lead_activity a
             where a.tenant_id = p_tenant_id and a.lead_id = c.lead_id and a.served_at >= c.completed_at
               and (c.until_at is null or a.served_at < c.until_at))::integer as dials,
           (select count(*) from tenant_lead_activity a
             where a.tenant_id = p_tenant_id and a.lead_id = c.lead_id and a.served_at >= c.completed_at
               and (c.until_at is null or a.served_at < c.until_at)
               and a.disposition is not null
               and a.disposition not in ('no_answer', 'voicemail', 'busy', 'call_dropped', 'wrong_number', 'disconnected'))::integer as contacts,
           (select count(*) from tenant_issued_policies ip
             where ip.tenant_id = p_tenant_id and ip.lead_id = c.lead_id and ip.status = 'issued'
               and ip.issued_at >= c.completed_at and (c.until_at is null or ip.issued_at < c.until_at))::integer as policies
      from c
  ),
  agg as (
    select pf.batch_id, sum(pf.dials)::integer as dials, sum(pf.contacts)::integer as contacts,
           count(*) filter (where pf.contacts > 0)::integer as leads_reached, sum(pf.policies)::integer as policies
      from perf pf
     where pf.batch_id is not null
     group by pf.batch_id
  ),
  recent as (
    select b.*
      from tenant_recycle_batches b
     where b.tenant_id = p_tenant_id and (p_campaign_id is null or b.campaign_id = p_campaign_id)
     order by b.created_at desc
     limit greatest(1, least(coalesce(p_limit, 12), 50))
  )
  select jsonb_build_object(
    'batches', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', b.id, 'campaign_id', b.campaign_id, 'campaign_name', tc.name,
               'angle', b.angle, 'script', b.script, 'attempt_ceiling', b.attempt_ceiling,
               'status', b.status, 'created_at', b.created_at, 'completed_at', b.completed_at,
               'last_progress_at', b.last_progress_at,
               'stalled', b.status = 'screening' and b.last_progress_at < now() - interval '15 minutes',
               'created_by', b.created_by, 'created_by_name', u.name,
               'queued', b.queued, 'cleared', b.cleared, 'blocked', b.blocked, 'failed', b.failed,
               'pending', greatest(b.queued - b.cleared - b.blocked - b.failed, 0),
               'excluded_too_recent', b.excluded_too_recent, 'said_no', b.said_no,
               'cost_cents', b.cost_cents,
               'dials', coalesce(ag.dials, 0), 'contacts', coalesce(ag.contacts, 0),
               'leads_reached', coalesce(ag.leads_reached, 0), 'policies', coalesce(ag.policies, 0),
               'contact_rate_percent', case when coalesce(ag.dials, 0) > 0 then round(100.0 * ag.contacts / ag.dials, 1) end
             ) order by b.created_at desc), '[]'::jsonb)
        from recent b
        join tenant_campaigns tc on tc.id = b.campaign_id
        left join users u on u.id = b.created_by
        left join agg ag on ag.batch_id = b.id
    ),
    -- Every cleared reactivation, the ones from before batches existed included.
    'totals', (
      select jsonb_build_object(
               'recycled', count(*)::integer,
               'dials', coalesce(sum(pf.dials), 0)::integer,
               'contacts', coalesce(sum(pf.contacts), 0)::integer,
               'leads_reached', (count(*) filter (where pf.contacts > 0))::integer,
               'policies', coalesce(sum(pf.policies), 0)::integer,
               'contact_rate_percent', case when coalesce(sum(pf.dials), 0) > 0 then round(100.0 * sum(pf.contacts) / sum(pf.dials), 1) end)
        from perf pf
    )
  ) into v_out;
  return v_out;
end;
$function$;

revoke all on function public.tenant_recycle_batch_report(uuid, uuid, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_recycle_batch_report(uuid, uuid, integer) to service_role;

-- ── for the dialer: the pass a lead is on ─────────────────────────────────
--
-- The latest cleared reactivation that came from a batch, with its angle and script, and whether
-- the lead is still on that pass (in nurture, under the batch's ceiling). Null when never recycled
-- through a batch.
create or replace function public.lead_recycle_context(p_tenant_id uuid, p_lead_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_out jsonb;
begin
  select jsonb_build_object(
           'batch_id', b.id,
           'angle', b.angle,
           'script', b.script,
           'attempt_ceiling', b.attempt_ceiling,
           'recycle_number', nr.recycle_number,
           'recycled_at', nr.completed_at,
           'attempts_made', coalesce(l.attempts_made, 0),
           'current', l.lead_state in ('nurture', 'retry', 'working') and l.last_reactivated_at is not null
                      and l.last_reactivated_at >= nr.completed_at - interval '1 minute'
         )
    into v_out
    from tenant_nurture_reactivations nr
    join tenant_recycle_batches b on b.id = nr.batch_id
    join agent_leads l on l.id = nr.lead_id and l.tenant_id = p_tenant_id
   where nr.tenant_id = p_tenant_id and nr.lead_id = p_lead_id and nr.status = 'cleared'
   order by nr.completed_at desc
   limit 1;
  return v_out;
end;
$function$;

revoke all on function public.lead_recycle_context(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.lead_recycle_context(uuid, uuid) to service_role;

-- ── assertions ────────────────────────────────────────────────────────────

do $$
declare
  v_src text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925706500: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if to_regclass('public.tenant_recycle_batches') is null then
    raise exception 'tenant_recycle_batches is missing';
  end if;
  if to_regprocedure('public.reactivate_nurture(uuid, uuid, uuid)') is not null then
    raise exception 'the 3-argument reactivate_nurture still exists; it moves leads before screening them';
  end if;
  if to_regprocedure('public.reactivate_nurture(uuid, uuid, uuid, text, text, integer)') is null
     or to_regprocedure('public.recycle_batch_claim_chunk(uuid, uuid, uuid, integer)') is null
     or to_regprocedure('public.recycle_lead_candidates(uuid, uuid, uuid)') is null
     or to_regprocedure('public.tenant_recycle_pool(uuid, uuid)') is null
     or to_regprocedure('public.tenant_recycle_batch_report(uuid, uuid, integer)') is null
     or to_regprocedure('public.lead_recycle_context(uuid, uuid)') is null then
    raise exception 'a recycling function is missing';
  end if;

  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_nurture_reactivation'
     and pg_get_function_identity_arguments(p.oid) = 'p_tenant_id uuid, p_reactivation_id uuid, p_status text, p_result_id uuid, p_outcome text, p_reason text';
  if v_src is null then
    raise exception 'complete_nurture_reactivation is missing';
  end if;
  -- A screening never fails the campaign again.
  if v_src ~ 'update\s+(public\.)?tenant_campaigns' then
    raise exception 'complete_nurture_reactivation still writes tenant_campaigns';
  end if;
  -- A cleared lead gets a work item the dialer can serve.
  if v_src !~ 'insert into lead_queue' then
    raise exception 'complete_nurture_reactivation does not queue the cleared lead';
  end if;
  -- Design 3: the row it inserts never carries a partner_id, so the inbox, the floor and
  -- run_unclaimed_sla (all keyed on lead_queue.partner_id) never read it as a live transfer; and it
  -- never reuses a partner row.
  if v_src ~ 'insert into lead_queue\s*\([^)]*\mpartner_id\M' then
    raise exception 'complete_nurture_reactivation inserts a work item with a partner_id';
  end if;
  if v_src !~ 'q\.status = ''unclaimed'' and q\.partner_id is null' then
    raise exception 'complete_nurture_reactivation may reuse a partner work item';
  end if;
  if v_src !~ 'nurtured_from_work_item_id' then
    raise exception 'complete_nurture_reactivation does not point the item at the transfer it came from';
  end if;

  -- The eligibility rules live in SQL.
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recycle_lead_candidates';
  if v_src !~ 'v_role <> ''owner''' or v_src !~ 'greatest\(p\.wait_days, 90\)' or v_src !~ 'is_phone_suppressed'
     or v_src !~ 'do_not_call' or v_src !~ 'next_dial_after > now\(\)' or v_src ~ 'updated_at' then
    raise exception 'recycle_lead_candidates lost one of its rules';
  end if;
  if v_src !~ 'q\.status = ''unclaimed'' and q\.partner_id is not null' then
    raise exception 'recycle_lead_candidates does not treat an open partner row as being worked';
  end if;

  -- The lead_queue itself is not changed by this file (no columns, no triggers).
  if exists (select 1 from pg_trigger t where t.tgrelid = 'public.lead_queue'::regclass
              and not t.tgisinternal and t.tgname like '%recycl%') then
    raise exception 'a recycling trigger was added to lead_queue';
  end if;
end $$;
