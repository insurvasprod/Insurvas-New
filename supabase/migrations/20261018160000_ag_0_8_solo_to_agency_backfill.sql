-- AG-0.8 (Notion sprint, Agency Module 0) · solo agent → agency upgrade: the backfill.
--
-- Ray is on Basic with 340 policies and hires two producers. He must not re-onboard to pay us more.
--
--   1. the tenant gains an agency row (legal_name from his existing business profile)
--   2. the owner gains a producer row — he is owner AND producer #1
--   3. BACKFILL: every existing lead, application, policy, policy_current, commission_entry and cost_entry row
--      with no producer gets producer = owner (D1: the user-attribution column each table already has)
--   4. the plan switch individual → agency (band to_50) is SA-3's plan change, which bills it; this function runs
--      once the tenant's plan audience IS agency, and refuses before (it never moves money itself)
--   5. his writing numbers move from tenant settings (tenant_carriers.writing_number) into
--      producer_writing_number — and into LA-4's carrier_agent_map, so every identifier already on his statements
--      keeps resolving to him on the next policy refresh
--   6. his contract levels move into producer_contract_level WITH THE effective_from THEY ALREADY HAD, not today:
--      dating them from the upgrade day would recompute every historical expected commission wrong
--
-- Rules: idempotent (a second run changes nothing — every step fills only what is missing); one transaction (a
-- half-backfilled tenant has silently wrong reports); rehearsed first (agency_upgrade_preview counts what would
-- change, read-only — attach its numbers to the task); and it does NOT weaken a grant. commission_entry and
-- cost_entry stay immutable to the application role; their guards admit exactly one change — filling an EMPTY
-- producer/agency attribution — and only inside this function's transaction, which sets a transaction-local flag
-- the application cannot set.
--
-- Rejected (spec): leaving the old book unattributed. A permanent null bucket makes every per-producer report
-- wrong forever, including the owner's own persistency number.
--
-- Requires 20261018100000 (agency, producer), 20261018155000 (contract levels, writing numbers).
--
-- Rollback: restore commission_entry_guard / cost_entry_guard from their previous definitions; drop functions
--   agency_upgrade_from_solo(uuid, uuid), agency_upgrade_preview(uuid). (Backfilled attribution stays: it is true.)

-- ─── the guards admit the one backfill, and nothing else ──────────────────────────────────────────
create or replace function public.commission_entry_guard()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  -- AG-0.8: the solo → agency backfill fills an EMPTY producer / agency attribution, in its own transaction only.
  if tg_op = 'UPDATE' and current_setting('app.agency_backfill_tenant', true) = old.tenant_id::text
     and old.agent_user_id is null and (old.agency_id is null or old.agency_id = new.agency_id)
     and (to_jsonb(new) - 'agent_user_id' - 'agency_id') = (to_jsonb(old) - 'agent_user_id' - 'agency_id') then
    return new;
  end if;
  raise exception 'A commission entry is never changed or removed; write a reversal instead.' using errcode = 'P0001';
end;
$$;

create or replace function public.cost_entry_guard()
returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $$
begin
  -- A purge of this workspace, by this very connection (purge_tenant_workspace, 20261016430000).
  if tg_op = 'DELETE' and tg_level = 'ROW' then
    if public.tenant_purge_active(to_jsonb(old)) then return old; end if;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'A cost entry is never removed; write a reversing entry instead.' using errcode = 'P0001';
  end if;
  -- The one permitted change: recording when the money left. Once, and nothing else.
  if old.paid_on is null and new.paid_on is not null
     and (to_jsonb(new) - 'paid_on') = (to_jsonb(old) - 'paid_on') then
    return new;
  end if;
  -- AG-0.8: the solo → agency backfill fills an EMPTY producer / agency attribution, in its own transaction only.
  if current_setting('app.agency_backfill_tenant', true) = old.tenant_id::text
     and old.producer_user_id is null and (old.agency_id is null or old.agency_id = new.agency_id)
     and (to_jsonb(new) - 'producer_user_id' - 'agency_id') = (to_jsonb(old) - 'producer_user_id' - 'agency_id') then
    return new;
  end if;
  raise exception 'A cost entry is never changed; write a reversing entry instead.' using errcode = 'P0001';
end;
$$;

-- ─── what an upgrade would change (read-only — the rehearsal) ─────────────────────────────────────
create or replace function public.agency_upgrade_preview(p_tenant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'owner', public.tenant_owner_user(p_tenant_id),
    'audience', public.tenant_plan_audience(p_tenant_id),
    'agency_row_exists', exists (select 1 from public.agency where tenant_id = p_tenant_id),
    'lead_queue', (select count(*) from public.lead_queue where tenant_id = p_tenant_id and owner_user_id is null and status <> 'unclaimed'),
    'unclaimed_pool', (select count(*) from public.lead_queue where tenant_id = p_tenant_id and status = 'unclaimed'),
    'application_cases', (select count(*) from public.tenant_application_cases where tenant_id = p_tenant_id and opened_by is null),
    'policy_current', (select count(*) from public.policy_current where tenant_id = p_tenant_id and agent_user_id is null),
    'commission_entry', (select count(*) from public.commission_entry where tenant_id = p_tenant_id and agent_user_id is null),
    'cost_entry', (select count(*) from public.cost_entry where tenant_id = p_tenant_id and producer_user_id is null),
    'contract_levels', (select count(*) from public.tenant_carriers where tenant_id = p_tenant_id),
    'writing_numbers', (select count(*) from public.tenant_carriers where tenant_id = p_tenant_id and nullif(btrim(writing_number), '') is not null),
    'identifiers_to_map', (
      select count(*) from (
        select distinct carrier_id, agent_identifier from public.policy_current where tenant_id = p_tenant_id and agent_identifier is not null
        union
        select distinct carrier_id, agent_identifier from public.commission_entry where tenant_id = p_tenant_id and agent_identifier is not null and carrier_id is not null
      ) ids
      where not exists (select 1 from public.carrier_agent_map m where m.tenant_id = p_tenant_id and m.carrier_id = ids.carrier_id and m.agent_identifier = ids.agent_identifier)
    )
  );
$$;
revoke all on function public.agency_upgrade_preview(uuid) from public, anon, authenticated;
grant execute on function public.agency_upgrade_preview(uuid) to service_role;

-- ─── the upgrade ──────────────────────────────────────────────────────────────────────────────────
create or replace function public.agency_upgrade_from_solo(p_tenant_id uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_agency uuid;
  v_producer uuid;
  v_counts jsonb := '{}'::jsonb;
  v_n bigint;
  v_tc record;
begin
  if coalesce(public.tenant_plan_audience(p_tenant_id), '') <> 'agency' then
    raise exception 'agency_plan_required' using errcode = 'P0001', hint = 'Change the plan to an agency band first (Billing).';
  end if;
  v_owner := public.tenant_owner_user(p_tenant_id);
  if v_owner is null then raise exception 'owner_missing' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('agency_upgrade:' || p_tenant_id::text, 0));

  -- 1. the agency
  insert into public.agency (tenant_id, legal_name, dba_name, npn, primary_state)
  select t.id, coalesce(nullif(btrim(ap.legal_name), ''), t.name), nullif(btrim(ap.dba), ''), nullif(btrim(ap.npn), ''),
         case when upper(ap.state) ~ '^[A-Z]{2}$' then upper(ap.state) end
    from public.tenants t left join public.agency_profiles ap on ap.tenant_id = t.id
   where t.id = p_tenant_id
  on conflict (tenant_id) do nothing;
  select id into v_agency from public.agency where tenant_id = p_tenant_id;

  -- 2. the owner is producer #1
  insert into public.producer (tenant_id, agency_id, user_id, display_name, npn, status, hired_on)
  select p_tenant_id, v_agency, u.id, coalesce(nullif(btrim(u.name), ''), u.email), pp.npn, 'active', t.created_at::date
    from public.users u
    join public.tenants t on t.id = p_tenant_id
    left join public.tenant_user_producer_profiles pp on pp.tenant_id = p_tenant_id and pp.user_id = u.id
   where u.id = v_owner
  on conflict on constraint producer_one_per_member do nothing;
  select id into v_producer from public.producer where tenant_id = p_tenant_id and user_id = v_owner;

  -- 6. contract levels, with the dates they already had (each LA-0.4 row runs until the next one starts)
  for v_tc in
    select tc.carrier_id, tc.contract_level_bp, tc.effective_from,
           lead(tc.effective_from) over (partition by tc.carrier_id order by tc.effective_from) - 1 as effective_to
      from public.tenant_carriers tc where tc.tenant_id = p_tenant_id and tc.contract_level_bp is not null
  loop
    insert into public.producer_contract_level (tenant_id, agency_id, producer_id, carrier_id, level_bps, effective_from, effective_to, created_by)
    values (p_tenant_id, v_agency, v_producer, v_tc.carrier_id, v_tc.contract_level_bp, v_tc.effective_from, v_tc.effective_to, p_actor)
    on conflict on constraint producer_contract_level_unique_start do nothing;
  end loop;

  -- 5. writing numbers (the earliest date each carrier's number is known from)
  insert into public.producer_writing_number (tenant_id, agency_id, producer_id, carrier_id, writing_number, effective_from, created_by)
  select distinct on (tc.carrier_id) p_tenant_id, v_agency, v_producer, tc.carrier_id, btrim(tc.writing_number), tc.effective_from, p_actor
    from public.tenant_carriers tc
   where tc.tenant_id = p_tenant_id and nullif(btrim(tc.writing_number), '') is not null
     and not exists (select 1 from public.producer_writing_number w where w.producer_id = v_producer and w.carrier_id = tc.carrier_id)
   order by tc.carrier_id, tc.effective_from;
  -- …and every identifier already on his statements, so the next policy refresh keeps them his
  insert into public.carrier_agent_map (tenant_id, carrier_id, agent_identifier, user_id, mapped_by, mapped_at)
  select p_tenant_id, ids.carrier_id, ids.agent_identifier, v_owner, p_actor, now()
    from (
      select distinct carrier_id, agent_identifier from public.policy_current where tenant_id = p_tenant_id and agent_identifier is not null and carrier_id is not null
      union
      select distinct carrier_id, agent_identifier from public.commission_entry where tenant_id = p_tenant_id and agent_identifier is not null and carrier_id is not null
      union
      select carrier_id, btrim(writing_number) from public.tenant_carriers where tenant_id = p_tenant_id and nullif(btrim(writing_number), '') is not null
    ) ids
  on conflict (tenant_id, carrier_id, agent_identifier) do nothing;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('identifiers_mapped', v_n);

  -- 3. the backfill — only empty attribution, never a changed one
  perform set_config('app.agency_backfill_tenant', p_tenant_id::text, true);
  -- An UNCLAIMED lead stays in the owner-visible pool to be routed (AG-0.10); a worked one was his.
  update public.lead_queue set owner_user_id = v_owner where tenant_id = p_tenant_id and owner_user_id is null and status <> 'unclaimed';
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('lead_queue', v_n);
  update public.tenant_application_cases set opened_by = v_owner where tenant_id = p_tenant_id and opened_by is null;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('application_cases', v_n);
  update public.policy_current set agent_user_id = v_owner, agency_id = coalesce(agency_id, v_agency) where tenant_id = p_tenant_id and agent_user_id is null;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('policy_current', v_n);
  update public.commission_entry set agent_user_id = v_owner, agency_id = coalesce(agency_id, v_agency) where tenant_id = p_tenant_id and agent_user_id is null;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('commission_entry', v_n);
  update public.cost_entry set producer_user_id = v_owner, agency_id = coalesce(agency_id, v_agency) where tenant_id = p_tenant_id and producer_user_id is null;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('cost_entry', v_n);
  perform set_config('app.agency_backfill_tenant', '', true);

  -- what is left unattributed must be nothing
  if exists (select 1 from public.policy_current where tenant_id = p_tenant_id and agent_user_id is null)
     or exists (select 1 from public.commission_entry where tenant_id = p_tenant_id and agent_user_id is null)
     or exists (select 1 from public.cost_entry where tenant_id = p_tenant_id and producer_user_id is null)
     or exists (select 1 from public.tenant_application_cases where tenant_id = p_tenant_id and opened_by is null) then
    raise exception 'agency_upgrade_left_nulls' using errcode = 'P0001';
  end if;
  return v_counts || jsonb_build_object('agency_id', v_agency, 'owner_producer_id', v_producer);
end;
$$;
revoke all on function public.agency_upgrade_from_solo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agency_upgrade_from_solo(uuid, uuid) to service_role;

-- ─── self-check ───────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if has_table_privilege('service_role', 'public.commission_entry', 'UPDATE') and not exists (
       select 1 from pg_trigger where tgrelid = 'public.commission_entry'::regclass and tgname = 'commission_entry_guard') then
    raise exception 'AG-0.8: commission_entry lost its immutability guard';
  end if;
  if pg_get_functiondef('public.commission_entry_guard()'::regprocedure) not like '%A commission entry is never changed or removed%' then
    raise exception 'AG-0.8: the commission guard no longer refuses ordinary changes';
  end if;
end;
$$;
