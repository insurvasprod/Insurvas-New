-- AG-0.10 (Notion sprint, Agency Module 0) · lead assignment and routing rules.
--
-- The trap this closes: once AG-0.4 filters a producer to his own rows, his lead queue is EMPTY on day one —
-- leads belong to the tenant and nothing says they are his. Leads belong to the agency; the owner routes them.
--
-- NOT a new lead system (spec). LA-2.24 already has everything a router needs — assignment_rules (state,
-- language, campaign, product, fallback), round robin and fewest-open strategies, the eligibility gate, the
-- unclaimed pool, and lead_assignment_events, the append-only history that answers "why did nobody call this
-- lead" (it is the spec's `lead_assignment`: every assignment, reassignment and return is a NEW row with who,
-- when and why; nothing updates a producer in place). This file adds only what an agency needs:
--
--   1. eligibility — in an agency a lead goes only to a producer who is WORKING (active; never invited,
--      onboarding, suspended or offboarded) and, for a lead with a state, APPOINTED in that state
--      (producer_appointment, AG-0.9). No appointment on record = not eligible: absent, not guessed.
--   2. a fourth strategy, "best recent placement rate" (best_placement): issued ÷ submitted over 90 days.
--   3. the history stays append-only: no update or delete on lead_assignment_events for any app role.
--   A live transfer is still assigned at the moment of transfer (LA-1's claim) — there is a human on the phone.
--   The unassigned pool's age and owner-only visibility are the application's (lib/agency/routing.ts).
--
-- assign_lead_core and publish_assignment_rules are patched IN PLACE on single anchor lines (their stored
-- bodies contain CRLF, so a whole-line match would miss); each patch asserts it landed.
--
-- Requires 20261018155000 (producer_appointment), 20260925702100 (strategies).
--
-- Rollback: restore assignment_candidate_is_eligible / assign_lead_core / publish_assignment_rules from
--   20260925702100+; the strategy check back to ('round_robin', 'least_loaded'); drop producer_recent_placement_bps.

-- ─── 1. eligibility ───────────────────────────────────────────────────────────────────────────────
create or replace function public.assignment_candidate_is_eligible(p_tenant_id uuid, p_user_id uuid, p_role text, p_product text, p_state text, p_requires_licensed boolean)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_state text := upper(btrim(coalesce(p_state, '')));
begin
  if p_role not in ('owner', 'producer', 'setter') then return false; end if;
  if p_requires_licensed and p_role = 'setter' then return false; end if;

  -- AG-0.10: inside an agency, only a WORKING producer, appointed in the lead's state, is handed a lead.
  if public.tenant_plan_audience(p_tenant_id) = 'agency' and p_role <> 'setter' then
    if not exists (select 1 from public.producer p where p.tenant_id = p_tenant_id and p.user_id = p_user_id and p.status = 'active') then
      return false;
    end if;
    if v_state <> '' and not exists (
      select 1 from public.producer_appointment a join public.producer p on p.id = a.producer_id
       where a.tenant_id = p_tenant_id and p.user_id = p_user_id and a.state = v_state and a.status = 'appointed'
         and (a.effective_from is null or a.effective_from <= current_date) and (a.expires_on is null or a.expires_on >= current_date)
    ) then
      return false;
    end if;
  end if;

  if p_role = 'setter' then return true; end if;
  if v_state = '' then return false; end if;

  return
    exists (
      select 1 from public.licenses l
       where l.tenant_id = p_tenant_id
         and upper(btrim(l.state)) = v_state
         and (l.expires_at is null or l.expires_at >= current_date)
    )
    and exists (
      select 1
        from public.appointments a
        join public.tenant_carriers tc
          on tc.tenant_id = a.tenant_id
         and tc.carrier_id = a.carrier_id
         and tc.is_active and not exists (select 1 from public.tenant_carrier_requirements r where r.tenant_id = tc.tenant_id and r.carrier_id = tc.carrier_id and not r.contracted)
       where a.tenant_id = p_tenant_id
         and upper(btrim(a.state)) = v_state
         and a.status = 'active'
         and (a.effective_from is null or a.effective_from <= current_date)
         and (a.terminated_at is null or a.terminated_at >= current_date)
         and (a.expires_at is null or a.expires_at >= current_date)
    )
    -- The agent's own states, when any are recorded (expired rows still count as "recorded", so a
    -- lapse never widens reach back to the agency's). New: a lapsed personal state is not held.
    and (
      not exists (select 1 from public.tenant_user_licensed_states s where s.tenant_id = p_tenant_id and s.user_id = p_user_id)
      or exists (select 1 from public.tenant_user_licensed_states s
                  where s.tenant_id = p_tenant_id and s.user_id = p_user_id and s.state = v_state
                    and (s.expires_on is null or s.expires_on >= current_date))
    );
end;
$function$;

-- ─── 2. best recent placement rate ────────────────────────────────────────────────────────────────
-- Issued ÷ submitted applications over the last 90 days, in basis points (integer arithmetic). 0 when none.
create or replace function public.producer_recent_placement_bps(p_tenant_id uuid, p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with submitted as (
    select count(distinct a.case_id) as n
      from public.tenant_applications a join public.tenant_application_cases c on c.id = a.case_id
     where a.tenant_id = p_tenant_id and c.opened_by = p_user_id and a.submitted_at >= now() - interval '90 days'
  ), issued as (
    select count(*) as n
      from public.tenant_issued_policies ip join public.tenant_application_cases c on c.id = ip.application_case_id
     where ip.tenant_id = p_tenant_id and c.opened_by = p_user_id and ip.issued_at >= now() - interval '90 days'
  )
  select case when s.n = 0 then 0 else least(10000, (i.n * 10000 / s.n))::integer end from submitted s, issued i;
$$;
revoke all on function public.producer_recent_placement_bps(uuid, uuid) from public, anon, authenticated;
grant execute on function public.producer_recent_placement_bps(uuid, uuid) to service_role;

alter table public.assignment_rules drop constraint if exists assignment_rules_strategy_valid;
alter table public.assignment_rules add constraint assignment_rules_strategy_valid
  check (strategy = any (array['round_robin', 'least_loaded', 'best_placement']));

do $$
declare
  v_proc regprocedure;
  v_def text;
  v_anchor constant text := 'case when v_least_loaded then coalesce(c.current_open, 0) else 0 end,';
  v_patch constant text := 'case when coalesce(v_rule.strategy, ''round_robin'') = ''best_placement'' then -public.producer_recent_placement_bps(p_tenant_id, tu.user_id) else 0 end, /* AG-0.10 */ ';
  v_valid_old constant text := 'v_strategy not in (''round_robin'', ''least_loaded'')';
  v_valid_new constant text := 'v_strategy not in (''round_robin'', ''least_loaded'', ''best_placement'')';
begin
  -- the picker: best placement first, when the rule asks for it
  for v_proc in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public' where p.proname = 'assign_lead_core' loop
    v_def := pg_get_functiondef(v_proc);
    if position(v_anchor in v_def) > 0 and position('/* AG-0.10 */' in v_def) = 0 then
      execute replace(v_def, v_anchor, v_patch || v_anchor);
    end if;
  end loop;
  if not exists (select 1 from pg_proc p where p.proname = 'assign_lead_core' and pg_get_functiondef(p.oid) like '%/* AG-0.10 */%') then
    raise exception 'AG-0.10: assign_lead_core was not patched (anchor not found)';
  end if;
  -- the rules publisher accepts the new strategy
  v_def := pg_get_functiondef('public.publish_assignment_rules'::regproc);
  if position(v_valid_old in v_def) > 0 then
    execute replace(v_def, v_valid_old, v_valid_new);
  end if;
  if pg_get_functiondef('public.publish_assignment_rules'::regproc) not like '%best_placement%' then
    raise exception 'AG-0.10: publish_assignment_rules still refuses best_placement';
  end if;
end;
$$;

-- ─── 3. the history is append-only ─────────────────────────────────────────────────────────────────
revoke update, delete, truncate on public.lead_assignment_events from service_role, tenant_app, authenticated;

-- ─── self-check ───────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if has_table_privilege('service_role', 'public.lead_assignment_events', 'UPDATE') then
    raise exception 'AG-0.10: assignment history can be rewritten';
  end if;
  if pg_get_functiondef('public.assignment_candidate_is_eligible(uuid,uuid,text,text,text,boolean)'::regprocedure) not like '%producer_appointment%' then
    raise exception 'AG-0.10: eligibility does not check the producer''s appointments';
  end if;
end;
$$;
