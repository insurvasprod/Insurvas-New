-- ---------------------------------------------------------------------------
-- LA-2.14, two criteria that were not met · audited 2026-09-22
--
-- ── 1. Criterion 5: "an outbound sale appears CORRECTLY in the daily deal flow"
--
-- `start_application_from_lead` inserts into `deal_flow` without `local_date`, so the column
-- default applies:
--
--   local_date date not null default current_date      (20260911100000, line 114)
--
-- `current_date` is the SESSION's date, which for every connection this product makes is UTC.
--
-- That is the exact bug LA-1.7 criterion 5 names — *"the deal-flow date is correct for an agent
-- working late in their own timezone"* — and that `lib/dealFlow/localDate.ts` exists to prevent.
-- The inbound and manual paths both compute it with `intakeLocalDate(timeZone)`; this one, added
-- later and in SQL, could not reach that helper and silently took the UTC default instead.
--
-- The window is not an edge case for THIS feature. For a tenant on US Pacific time, UTC has already
-- rolled over from 17:00 local onwards — the entire evening calling block, which is when outbound
-- dialling actually happens. An agent closes a sale at 19:00, opens Daily deal flow (which defaults
-- to today), and it is filed against tomorrow.
--
-- Whose day is it? LA-1.7 says the agent's. So: the agent's own timezone when it is known — which
-- is now a real source, because LA-2.11's availability editor exists — then the customer's state
-- timezone, then UTC. The fallback chain is written out rather than assumed, because each step is a
-- different person's midnight.
--
-- ── 2. Criterion 2: "campaign_id and vendor_id survive onto the application AND THE POLICY RECORD"
--
-- The application half is done: `tenant_application_cases` carries both, and `deal_flow` gained them
-- in 20260913410000. The policy half is done too, in `tenant_issued_policies` (LA-2.17) — which the
-- first draft of this migration did not know, having looked at `tenant_policies` and found no
-- attribution there. `tenant_policies` is the serviced book of business and correctly carries none;
-- see the long note above section 2 for why adding it there would have been a second chain.
--
-- What was genuinely missing at this hop is the LINEAGE VIEW. `tenant_lead_attribution_chain` —
-- the view that exists to trace exactly this — stopped at `deal_flow`, so a lead whose policy lost
-- its campaign was invisible. Section 2 extends it to the issued policy.
-- ---------------------------------------------------------------------------

-- ── 1 ──────────────────────────────────────────────────────────────────────

create or replace function public.deal_local_date(
  p_tenant_id uuid,
  p_agent_user_id uuid,
  p_lead_values jsonb,
  p_at timestamptz default now()
)
returns date
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_zone text;
begin
  -- The agent's own working timezone, from LA-2.11's availability. `min` rather than `limit 1`
  -- without an order by, so two rows for one agent cannot make this answer differ between calls.
  select min(av.timezone) into v_zone
    from tenant_agent_availability av
   where av.tenant_id = p_tenant_id and av.user_id = p_agent_user_id;

  -- Then the customer's. Not the same midnight as the agent's, but far closer than UTC's, and
  -- always available for a lead that was legal to dial at all.
  if v_zone is null then
    select st.timezone into v_zone
      from state_timezones st
     where st.state = upper(nullif(btrim(coalesce(p_lead_values->>'state', '')), ''));
  end if;

  return (p_at at time zone coalesce(v_zone, 'UTC'))::date;
end;
$function$;

revoke all on function public.deal_local_date(uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.deal_local_date(uuid, uuid, jsonb, timestamptz) to tenant_app, service_role;

-- Patch the insert inside `start_application_from_lead` rather than restating the function, for the
-- same reason the LA-2.12 notify was patched in: this migration must not become a second copy of
-- the handoff's rules, which are long and are not what is being changed.
do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'start_application_from_lead';

  if v_src is null then
    raise exception 'start_application_from_lead does not exist; apply the LA-2.14 handoff migration first';
  end if;

  if v_src ~ 'deal_local_date' then
    raise notice 'the outbound deal already files against a local date';
    return;
  end if;

  v_new := replace(
    v_src,
    E'      (tenant_id, lead_id, partner_id, product_line, pipeline_id, stage_id,\n'
    || E'       insured_name, phone, source, worked_by)',
    E'      (tenant_id, lead_id, partner_id, product_line, pipeline_id, stage_id,\n'
    || E'       insured_name, phone, source, worked_by, local_date)'
  );
  if v_new = v_src then
    raise exception 'the deal_flow column list is not in the expected form; fix by hand';
  end if;
  v_src := v_new;

  v_new := replace(
    v_src,
    E'       v_name, v_phone, v_source, p_agent_user_id)',
    E'       v_name, v_phone, v_source, p_agent_user_id,\n'
    || E'       deal_local_date(p_tenant_id, p_agent_user_id, v_lead.values))'
  );
  if v_new = v_src then
    raise exception 'the deal_flow values list is not in the expected form; fix by hand';
  end if;

  execute v_new;
  raise notice 'the outbound deal now files against the agent local date';
end $$;


-- ── 2 ──────────────────────────────────────────────────────────────────────
--
-- CORRECTED 2026-09-22, during the LA-2.17 audit, before this migration was applied.
--
-- The first draft of this section added `campaign_id`, `vendor_id`, `lead_id` and an application
-- link to `public.tenant_policies`, on the finding that nothing joined a policy to the campaign that
-- produced it. The finding was right about `tenant_policies` and **wrong about the conclusion**:
-- LA-2.17 had already solved this, with a different table and for a stated reason.
--
--   `tenant_issued_policies`   tenant_id, lead_id, application_case_id, deal_id,
--                              campaign_id, vendor_id, carrier, policy_number, status, issued_at
--                              + enforce_issued_policy_attribution() as a before-trigger
--
-- and the LA-2.17 migration says why it did not extend the table this one was about to:
--
--   "The old `policies`-looking tables belong to the organization-era CRM or to the E&O vault and
--    cannot answer this question. A fabricated policy count would make vendor selection worse than
--    an honest empty report."
--
-- That reasoning holds. `tenant_policies` is the serviced book of business — rows an agent maintains
-- by hand, including policies written long before this product existed. Attribution on it would be a
-- SECOND chain answering the same question as the first, and two chains that can disagree about
-- which campaign produced a policy is worse than one chain that sometimes says "unknown".
--
-- So the columns are not added. What remains is the part that was genuinely missing: the lineage
-- view still stopped at `deal_flow`, so nothing could show a lead whose policy lost its attribution.
-- It now ends at `tenant_issued_policies`, which is where an outbound policy actually lands.
--
-- WHAT IS STILL OPEN, and it is not a schema problem: **no application code writes
-- `tenant_issued_policies`.** Measured live on 2026-09-22 — 0 rows, and no `from("tenant_issued_
-- policies")` anywhere under lib/ or app/. Recording an issued policy belongs to the Sell module,
-- so the report's Issued column and True CPA are correct, computable, and permanently null until
-- LA-3 writes that row. The view below makes that visible rather than leaving it to be discovered.

-- The same 42P16 that stopped the cost views, and it would have stopped this one three
-- migrations later. The deployed chain has `case_attribution_lost` in position 12; this
-- definition puts `issued_policy_id` there, because the policy columns belong beside the deal
-- columns they follow rather than tacked on after the loss flags.
--
-- No `cascade`: nothing reads this view today, and if something starts to, that should fail here
-- rather than disappear. The grant and `security_invoker` are re-applied immediately below.
drop view if exists public.tenant_lead_attribution_chain;

create or replace view public.tenant_lead_attribution_chain as
select l.tenant_id,
       l.id                as lead_id,
       l.campaign_id       as lead_campaign_id,
       c.vendor_id         as lead_vendor_id,
       ac.id               as application_case_id,
       ac.campaign_id      as case_campaign_id,
       ac.vendor_id        as case_vendor_id,
       d.id                as deal_id,
       d.campaign_id       as deal_campaign_id,
       d.vendor_id         as deal_vendor_id,
       d.source            as deal_source,
       p.id                as issued_policy_id,
       p.campaign_id       as policy_campaign_id,
       p.vendor_id         as policy_vendor_id,
       (ac.id is not null and l.campaign_id is not null and ac.campaign_id is null) as case_attribution_lost,
       (d.id  is not null and l.campaign_id is not null and d.campaign_id  is null) as deal_attribution_lost,
       (p.id  is not null and l.campaign_id is not null and p.campaign_id  is null) as policy_attribution_lost
  from agent_leads l
  left join tenant_campaigns c on c.id = l.campaign_id
  left join tenant_application_cases ac on ac.lead_id = l.id and ac.tenant_id = l.tenant_id
  left join deal_flow d on d.lead_id = l.id and d.tenant_id = l.tenant_id
  -- Only a live policy counts as the end of the chain. A lapsed or cancelled one did exist, and its
  -- attribution is still worth reading, so the status is not filtered here — the scorecard filters
  -- on `status = 'issued'` where that is the question being asked.
  left join tenant_issued_policies p on p.lead_id = l.id and p.tenant_id = l.tenant_id;

alter view public.tenant_lead_attribution_chain set (security_invoker = on);
revoke all on public.tenant_lead_attribution_chain from anon, authenticated, public;
grant select on public.tenant_lead_attribution_chain to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'start_application_from_lead'
         and pg_get_functiondef(p.oid) ~ 'deal_local_date') <> 1 then
    raise exception 'the outbound deal still files against the UTC date';
  end if;

  -- The chain must end at the table LA-2.17 built for this, not at the serviced book of business.
  if not exists (select 1 from information_schema.view_column_usage
                  where table_schema = 'public' and view_name = 'tenant_lead_attribution_chain'
                    and table_name = 'tenant_issued_policies') then
    raise exception 'the attribution chain does not reach tenant_issued_policies';
  end if;
  if exists (select 1 from information_schema.view_column_usage
              where table_schema = 'public' and view_name = 'tenant_lead_attribution_chain'
                and table_name = 'tenant_policies') then
    raise exception 'the attribution chain reads the serviced book of business; it must read tenant_issued_policies';
  end if;

  perform 1 from public.tenant_lead_attribution_chain limit 1;
end $$;
