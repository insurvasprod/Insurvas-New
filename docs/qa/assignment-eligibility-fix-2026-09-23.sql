-- LA-2.24 assignment eligibility fix, plus the block-reason defect found alongside it.
-- 2026-09-23. Apply after the twelve already applied.
--
-- Effect, dry-run against the live data before this was written:
--   owner/producer eligible BEFORE: nowhere
--   owner/producer eligible AFTER:  AZ, FL, ME, TX
--   of the 10 attributed leads, 7 become assignable; the 3 Georgia ones stay refused,
--   because the agency's GA licence expired 2026-08-30 and there is no GA appointment.

-- ===========================================================================
-- 20260923110000_la_2_3_block_reason_only_when_blocked.sql
-- ===========================================================================
-- LA-2.3 · the empty-queue explanation fires when the queue is not empty.
--
-- `campaign_serving_block_reason` exists for a good reason, stated in its own migration: "The gate
-- is useless if the dialer can only report 'no leads' — an agent staring at an empty queue needs to
-- know it is a scrub, not a drought."
--
-- But every branch asks `exists (... status = 'active' and scrub_status = <bad>)`, which is true as
-- soon as ONE active campaign is in that state. A tenant with six active campaigns, five unscrubbed
-- and one scrubbed, is served from the scrubbed one — and told:
--
--     "This campaign has not been scrubbed against the suppression lists yet, so no leads can be
--      served."
--
-- Observed on the live project 2026-09-23: `next_campaign_for_serving` returned a campaign and this
-- function simultaneously claimed nothing could be served. The singular "This campaign" makes it
-- worse, because there is no campaign the sentence is about — it is a tenant-wide scan wearing the
-- grammar of a specific answer.
--
-- An agent who reads it goes looking for a scrub that is not blocking them, while the actual reason
-- their queue is short is something else entirely.
--
-- The fix is the guard the function never had: say nothing when anything is servable. A reason for
-- an empty queue is only a reason while the queue is empty. The wording also stops pretending to be
-- about one campaign, and the partial case — some servable, some not — gets its own sentence,
-- because "you are only seeing part of your inventory" is a different fact from "you are blocked".

create or replace function public.campaign_serving_block_reason(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when not exists (select 1 from tenant_campaigns where tenant_id = p_tenant_id) then
      'No campaigns exist yet.'
    when not exists (select 1 from tenant_campaigns where tenant_id = p_tenant_id and status = 'active') then
      'Every campaign is paused, draft or exhausted.'

    -- The guard. `campaigns_servable` is the same view the serving query filters on, so this asks
    -- the question the agent is actually asking: is anything being served at all.
    when exists (select 1 from campaigns_servable where tenant_id = p_tenant_id) then
      case
        when exists (
          select 1 from tenant_campaigns
           where tenant_id = p_tenant_id and status = 'active'
             and scrub_status in ('unscrubbed', 'scrubbing', 'failed')
        ) then
          'Some active campaigns are still being scrubbed, so you are seeing leads from the scrubbed ones only.'
        else null
      end

    -- Nothing is servable. Now the scrub states are the reason, and they are reported in the order
    -- that tells the reader what to do: a failure needs attention, a run in progress needs waiting,
    -- and never-scrubbed needs starting.
    when exists (select 1 from tenant_campaigns where tenant_id = p_tenant_id and status = 'active' and scrub_status = 'failed') then
      'Scrubbing failed for at least one active campaign. Dialing is blocked until it succeeds.'
    when exists (select 1 from tenant_campaigns where tenant_id = p_tenant_id and status = 'active' and scrub_status = 'scrubbing') then
      'Scrubbing is still running. Dialing starts when it finishes.'
    when exists (select 1 from tenant_campaigns where tenant_id = p_tenant_id and status = 'active' and scrub_status = 'unscrubbed') then
      'No active campaign has been scrubbed against the suppression lists yet, so no leads can be served.'
    else null
  end;
$function$;

revoke all on function public.campaign_serving_block_reason(uuid) from public, anon, authenticated;
grant execute on function public.campaign_serving_block_reason(uuid) to tenant_app, service_role;

-- ── the contradiction, asserted absent ─────────────────────────────────────
--
-- The property is a relationship between two functions, so it is checked as one: if a campaign is
-- being served, the explanation for an empty queue must not claim the queue is blocked.
do $$
declare
  v_tenant uuid;
  v_reason text;
  v_served uuid;
begin
  for v_tenant in
    select distinct tenant_id from tenant_campaigns where status = 'active'
  loop
    v_served := public.next_campaign_for_serving(v_tenant);
    v_reason := public.campaign_serving_block_reason(v_tenant);

    if v_served is not null and v_reason is not null and v_reason ilike '%no leads can be served%' then
      raise exception
        'tenant % is being served campaign % and was still told no leads can be served', v_tenant, v_served;
    end if;

    -- And the other direction, which is the worse one: a blocked tenant told nothing at all leaves
    -- an agent staring at an empty dialer with no explanation, which is the defect the original
    -- function was written to prevent.
    if v_served is null and v_reason is null
       and exists (select 1 from tenant_campaigns where tenant_id = v_tenant and status = 'active') then
      raise exception 'tenant % is serving nothing and was given no reason why', v_tenant;
    end if;
  end loop;

  raise notice 'LA-2.3: the empty-queue explanation and the serving gate now agree';
end $$;

-- ===========================================================================
-- 20260923130000_la_2_24_eligibility_reads_the_appointments_we_keep.sql
-- ===========================================================================
-- LA-2.24 · no owner or producer could ever be assigned a lead.
--
-- Measured on the live project 2026-09-23, across every role and four states:
--
--     owner      TX=false  FL=false  GA=false  AZ=false
--     producer   TX=false  FL=false  GA=false  AZ=false
--     setter     TX=true   FL=true   GA=true   AZ=true
--     assistant  TX=false  FL=false  GA=false  AZ=false
--
-- Only a setter could take a lead — and a setter is the one role that cannot sell. Step three of
-- the outbound workflow was closed to the people the module exists for.
--
-- ── Why ────────────────────────────────────────────────────────────────────
--
-- `assignment_candidate_is_eligible` short-circuits true for a setter and otherwise falls through
-- to `can_write`, which reads:
--
--     agent_carrier_contracts    0 rows, entire database
--     agent_appointments         0 rows, entire database
--
-- Those are the organization-era CRM's tables, keyed by `organization_id` and `user_id`. Nothing
-- in this product writes them, so the check could only ever return false.
--
-- The product does keep appointments. It keeps them somewhere else:
--
--     appointments   tenant_id, carrier_id, state, status, effective_from, terminated_at
--     licenses       tenant_id, state, license_number, expires_at
--
-- written and read by the Carrier appointments screen, and holding 38 appointments across 24
-- states and 5 licences on the demo tenant. So the product knows the agency is appointed in Texas,
-- and the assignment gate was asking a different table that nobody fills in.
--
-- ── What this changes, said plainly ────────────────────────────────────────
--
-- **Eligibility becomes per agency, not per agent.** The tenant tables carry no `user_id`; there
-- is no per-agent licensing data anywhere in this product. So the question this can answer is "is
-- the AGENCY licensed and appointed in that state", and every owner and producer on the tenant is
-- equally eligible wherever that is true.
--
-- That is weaker than LA-2.24's wording, which reads as though each agent carries their own
-- licence. It is also the only question the data supports, and it is a real control rather than
-- none: a lead in a state the agency cannot write is still refused. If per-agent licensing is
-- wanted later, `licenses` and `appointments` grow a nullable `user_id`, and the two `exists`
-- clauses below gain `and (user_id is null or user_id = p_user_id)`. That is a smaller change than
-- the one this replaces, and it does not need a second table.
--
-- **Both halves are required.** LA-2.24 says "licensed and appointed in that state", so this asks
-- for both, which is stricter than the function it replaces (that one checked appointments only,
-- through can_write). On the demo tenant that is the difference between 24 states and 4: there are
-- appointments in 24 states and licences in 5, one of which expired in August. Georgia fails on
-- both counts and should.
--
-- `can_write` itself is left alone. It is an LA-0 compatibility shim with its own callers, and
-- widening it would reach further than the assignment gate this is about.

create or replace function public.assignment_candidate_is_eligible(
  p_tenant_id uuid,
  p_user_id uuid,
  p_role text,
  p_product text,
  p_state text,
  p_requires_licensed boolean
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_state text := upper(btrim(coalesce(p_state, '')));
begin
  if p_role not in ('owner', 'producer', 'setter') then return false; end if;

  -- A setter cannot sell, so a lead that needs a licensed agent is not theirs. Unchanged.
  if p_requires_licensed and p_role = 'setter' then return false; end if;

  -- A setter qualifies and books; they do not write business, so no licence is asked of them.
  -- Unchanged, and the reason it is safe: the leads they can be given are the ones that do not
  -- require a licensed agent, which the branch above has already established.
  if p_role = 'setter' then return true; end if;

  -- No state, no permission. Absence of data is not consent — the same rule the dialer applies to
  -- a lead with no state before it will place a call.
  if v_state = '' then return false; end if;

  return
    -- Licensed there, and the licence has not run out. A licence with no expiry is treated as
    -- current rather than invalid: the column is nullable and a missing date means "not recorded",
    -- which is a data-entry gap, not evidence the licence has lapsed.
    exists (
      select 1 from public.licenses l
       where l.tenant_id = p_tenant_id
         and upper(btrim(l.state)) = v_state
         and (l.expires_at is null or l.expires_at >= current_date)
    )
    -- and appointed there, with a carrier the agency still has switched on. The carrier join
    -- matters: an appointment with a carrier that has been deactivated is history, not permission.
    and exists (
      select 1
        from public.appointments a
        join public.tenant_carriers tc
          on tc.tenant_id = a.tenant_id
         and tc.carrier_id = a.carrier_id
         and tc.is_active
       where a.tenant_id = p_tenant_id
         and upper(btrim(a.state)) = v_state
         and a.status = 'active'
         and (a.effective_from is null or a.effective_from <= current_date)
         and (a.terminated_at is null or a.terminated_at >= current_date)
    );
end;
$function$;

-- ── why a refusal happened ─────────────────────────────────────────────────
--
-- `assign_lead` raises a bare `ASSIGNMENT_TARGET_NOT_ELIGIBLE`, which reached the screen verbatim.
-- An owner reading that cannot tell whether the problem is the licence, the appointment, the role
-- or the state — and the four have completely different remedies.
--
-- Returning null when the candidate IS eligible is deliberate: a caller can use this as both the
-- test and the explanation without asking twice, and a non-null answer always means refused.
create or replace function public.assignment_ineligibility_reason(
  p_tenant_id uuid,
  p_user_id uuid,
  p_role text,
  p_product text,
  p_state text,
  p_requires_licensed boolean
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_state text := upper(btrim(coalesce(p_state, '')));
  v_licensed boolean;
  v_appointed boolean;
begin
  if p_role not in ('owner', 'producer', 'setter') then
    return format('A %s cannot be given leads to work.', coalesce(p_role, 'member with no role'));
  end if;
  if p_requires_licensed and p_role = 'setter' then
    return 'This lead needs a licensed agent, and a setter cannot write business.';
  end if;
  if p_role = 'setter' then return null; end if;
  if v_state = '' then
    return 'This lead has no state on it, so there is no way to tell who is licensed to work it.';
  end if;

  select exists (
    select 1 from public.licenses l
     where l.tenant_id = p_tenant_id and upper(btrim(l.state)) = v_state
       and (l.expires_at is null or l.expires_at >= current_date)
  ) into v_licensed;

  select exists (
    select 1 from public.appointments a
      join public.tenant_carriers tc
        on tc.tenant_id = a.tenant_id and tc.carrier_id = a.carrier_id and tc.is_active
     where a.tenant_id = p_tenant_id and upper(btrim(a.state)) = v_state
       and a.status = 'active'
       and (a.effective_from is null or a.effective_from <= current_date)
       and (a.terminated_at is null or a.terminated_at >= current_date)
  ) into v_appointed;

  if v_licensed and v_appointed then return null; end if;

  -- Naming BOTH gaps when both are missing, rather than stopping at the first. An owner who fixes
  -- the licence and is refused again for the appointment has been sent round twice for one
  -- problem, and a "missing licence" message that turns into a "missing appointment" message reads
  -- like the system changing its mind.
  if not v_licensed and not v_appointed then
    -- "No current licence" is true of an expired one and of one that was never recorded, and the
    -- two are different jobs — renewing beats going looking for a licence you already hold. The
    -- demo tenant's Georgia licence expired in August, so this is the live case, not a hypothetical.
    return format(
      'Your agency %s for %s and has no active carrier appointment there. Both are needed before anyone can be given a %s lead.',
      case when exists (select 1 from public.licenses l where l.tenant_id = p_tenant_id and upper(btrim(l.state)) = v_state)
           then 'has an expired licence' else 'has no licence on record' end,
      v_state, v_state);
  end if;
  if not v_licensed then
    -- Distinguishes "never recorded" from "lapsed", because one is paperwork and the other is a
    -- deadline that has already passed.
    if exists (select 1 from public.licenses l where l.tenant_id = p_tenant_id and upper(btrim(l.state)) = v_state) then
      return format('Your agency''s %s licence has expired. Renew it on Carrier appointments before working %s leads.', v_state, v_state);
    end if;
    return format('Your agency has no %s licence on record. Add it on Carrier appointments before working %s leads.', v_state, v_state);
  end if;
  return format('Your agency is licensed in %s but has no active carrier appointment there, so nothing can be written. Add one on Carrier appointments.', v_state);
end;
$function$;

revoke all on function public.assignment_candidate_is_eligible(uuid, uuid, text, text, text, boolean)
  from public, anon, authenticated, tenant_app;
grant execute on function public.assignment_candidate_is_eligible(uuid, uuid, text, text, text, boolean)
  to service_role;
revoke all on function public.assignment_ineligibility_reason(uuid, uuid, text, text, text, boolean)
  from public, anon, authenticated, tenant_app;
grant execute on function public.assignment_ineligibility_reason(uuid, uuid, text, text, text, boolean)
  to service_role;

-- ── asserted against whatever this database actually holds ─────────────────
--
-- Written to be true of any tenant rather than of the demo fixture: the check derives the states
-- it expects from the data, so it does not go stale when the seed changes.
do $$
declare
  v_tenant uuid;
  v_user uuid;
  v_good text;
  v_bad text;
  v_reason text;
begin
  select tu.tenant_id, tu.user_id into v_tenant, v_user
    from public.tenant_users tu
    join public.users u on u.id = tu.user_id
   where tu.role::text in ('owner', 'producer') and tu.accepted_at is not null and u.status::text = 'active'
   order by tu.tenant_id
   limit 1;

  if v_tenant is null then
    raise notice 'LA-2.24 eligibility check skipped: no active owner or producer in this database';
    return;
  end if;

  -- A state the agency is both licensed and appointed in, if one exists.
  select upper(btrim(l.state)) into v_good
    from public.licenses l
   where l.tenant_id = v_tenant
     and (l.expires_at is null or l.expires_at >= current_date)
     and exists (
       select 1 from public.appointments a
         join public.tenant_carriers tc on tc.tenant_id = a.tenant_id and tc.carrier_id = a.carrier_id and tc.is_active
        where a.tenant_id = v_tenant and upper(btrim(a.state)) = upper(btrim(l.state)) and a.status = 'active'
     )
   limit 1;

  if v_good is not null then
    if not public.assignment_candidate_is_eligible(v_tenant, v_user, 'owner', 'term_life', v_good, true) then
      raise exception 'LA-2.24: an owner is still ineligible in %, where the agency is licensed and appointed', v_good;
    end if;
    if public.assignment_ineligibility_reason(v_tenant, v_user, 'owner', 'term_life', v_good, true) is not null then
      raise exception 'LA-2.24: % is eligible but a refusal reason was still produced', v_good;
    end if;
    raise notice 'LA-2.24: an owner is now eligible in %', v_good;
  else
    raise notice 'LA-2.24: this tenant is not both licensed and appointed anywhere; eligibility correctly stays closed';
  end if;

  -- And the gate still bites. A state nobody is licensed in must refuse, with a sentence.
  select code into v_bad from (select unnest(array['WY','VT','ND','SD']) as code) s
   where not exists (
     select 1 from public.licenses l where l.tenant_id = v_tenant and upper(btrim(l.state)) = s.code
   )
   limit 1;

  if v_bad is not null then
    if public.assignment_candidate_is_eligible(v_tenant, v_user, 'owner', 'term_life', v_bad, true) then
      raise exception 'LA-2.24: an owner was eligible in %, where the agency holds no licence', v_bad;
    end if;
    v_reason := public.assignment_ineligibility_reason(v_tenant, v_user, 'owner', 'term_life', v_bad, true);
    if v_reason is null or v_reason = '' then
      raise exception 'LA-2.24: % was refused with no reason given', v_bad;
    end if;
    raise notice 'LA-2.24: % refused — %', v_bad, v_reason;
  end if;

  -- A lead with no state stays refused. This is the branch that would quietly open everything if
  -- someone "simplified" the empty-state check away.
  if public.assignment_candidate_is_eligible(v_tenant, v_user, 'owner', 'term_life', '', true) then
    raise exception 'LA-2.24: a lead with no state was assignable';
  end if;

  -- The setter path is unchanged, both ways round.
  if not public.assignment_candidate_is_eligible(v_tenant, v_user, 'setter', 'term_life', 'TX', false) then
    raise exception 'LA-2.24: a setter can no longer be given an unlicensed lead';
  end if;
  if public.assignment_candidate_is_eligible(v_tenant, v_user, 'setter', 'term_life', 'TX', true) then
    raise exception 'LA-2.24: a setter was given a lead that needs a licensed agent';
  end if;
end $$;

