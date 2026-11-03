-- ---------------------------------------------------------------------------
-- LA-2.14 · Interested → verification & application handoff
--
-- "Do not build a second application flow. The verification panel, the field definitions, the
--  dispositions and the deal-flow write all exist in Module 1. This task is the ENTRY POINT, not a
--  parallel implementation."
--
-- So there is no new verification service, no new field model, no second panel. What this adds is
-- the doorway an outbound lead walks through to reach the one that exists, plus the two columns
-- that make the money question answerable afterwards.
--
-- WHAT WAS ACTUALLY MISSING, in order of how badly:
--
--   1. Nothing creates a verification session for an outbound lead. `claim_transfer_lead` creates
--      one; `serve_next_lead` does not. The panel's own loader REQUIRES an existing session and
--      never creates one, so an outbound agent got `verification_owner_required` no matter what.
--
--   2. No deal_flow row exists for an outbound lead, ever. `writePartnerIntakeArtifacts` writes it
--      at partner-submission time, and an outbound lead has no partner submission — it arrived by
--      list import or the post API. So criterion 5, "an outbound sale appears correctly in the
--      daily deal flow", had nothing to appear.
--
--   3. `deal_flow` carries `campaign_id` (added by LA-2.1) but not `vendor_id`, and there is no
--      column anywhere saying whether a deal came from inbound or outbound.
--
-- ON THE WORDING OF THE HEADLINE RULE. The task page says "the outbound lead and the resulting
-- application are one record, not two". The decision log supersedes that sentence:
--
--   "It was never about cardinality ... replace with: The outbound lead is not duplicated and the
--    verification flow is not forked. The lead links to one application case; that case may hold
--    several application attempts (LA-3.16)."
--
-- Implemented to the amended rule. `tenant_application_cases` is the case; one open at a time per
-- lead, many over a lead's life. The attempts inside it belong to LA-3 and are not modelled here.
-- Taking the original sentence literally would have produced a lead that can only ever have one
-- application, and Rita declined by carrier A and issued by carrier C would have been unrepresentable.
-- ---------------------------------------------------------------------------

-- ── the two columns that make cost per issued policy computable ────────────
--
-- LA-2.1 carried campaign_id as far as the tenant plane went and recorded the rest as blocked on
-- this task. This is that hop. `vendor_id` is denormalised from the campaign rather than joined at
-- read time on purpose: a campaign can be re-pointed at a different vendor, and a deal must keep
-- the vendor it was actually bought from, not the one the campaign belongs to today.
alter table public.deal_flow
  add column if not exists vendor_id uuid references public.tenant_lead_vendors(id) on delete set null;

alter table public.deal_flow
  add column if not exists source text not null default 'inbound';

do $$
begin
  -- Backfill before the constraint, or the constraint refuses the table it is being added to.
  update public.deal_flow set source = 'manual' where manual_entry is true and source = 'inbound';

  if not exists (select 1 from pg_constraint where conname = 'deal_flow_source_check') then
    alter table public.deal_flow
      add constraint deal_flow_source_check check (source in ('inbound', 'outbound', 'manual'));
  end if;
end $$;

create index if not exists deal_flow_vendor_idx
  on public.deal_flow (tenant_id, vendor_id) where vendor_id is not null;

-- The existing trigger carries campaign_id from the lead. It now carries the vendor the campaign
-- belonged to at the moment of the write, for the reason above.
create or replace function public.carry_campaign_id_to_deal()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_campaign uuid;
  v_vendor uuid;
begin
  -- An explicit value wins. A caller that knows better than the lead -- a deal re-attributed by
  -- hand, say -- must not have its value overwritten by this.
  if new.lead_id is null then
    return new;
  end if;

  if new.campaign_id is null then
    select l.campaign_id into v_campaign
      from agent_leads l where l.id = new.lead_id and l.tenant_id = new.tenant_id;
    new.campaign_id := v_campaign;
  end if;

  if new.vendor_id is null and new.campaign_id is not null then
    select c.vendor_id into v_vendor from tenant_campaigns c where c.id = new.campaign_id;
    new.vendor_id := v_vendor;
  end if;

  return new;
end;
$function$;

-- ── the application case ───────────────────────────────────────────────────
--
-- One per SALE ATTEMPT, not one per lead and not one per carrier. The carrier attempts hang off
-- this in LA-3.7; the submissions off those in LA-3.15. Modelling the case here rather than waiting
-- for LA-3.16 is what lets campaign_id and vendor_id reach the level the decision log puts them at,
-- which is the only reason this task's criterion 2 is answerable at all.
create table if not exists public.tenant_application_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  -- The work item the case was opened from. Null once that queue row is gone; the case outlives it.
  work_item_id uuid,
  product_line text not null,
  source text not null default 'outbound' check (source in ('inbound', 'outbound', 'manual')),
  status text not null default 'open' check (status in ('open', 'submitted', 'closed', 'abandoned')),
  -- Attribution, carried rather than joined. Same argument as deal_flow above.
  campaign_id uuid references public.tenant_campaigns(id) on delete set null,
  vendor_id uuid references public.tenant_lead_vendors(id) on delete set null,
  opened_by uuid,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);

-- A lead may have many cases over its life and at most one open at a time. Two open cases on one
-- lead would mean two agents taking the same application, which is the duplicate pipeline the
-- original "one record, not two" sentence was reaching for.
create unique index if not exists tenant_application_cases_one_open_idx
  on public.tenant_application_cases (tenant_id, lead_id) where status = 'open';

create index if not exists tenant_application_cases_campaign_idx
  on public.tenant_application_cases (tenant_id, campaign_id) where campaign_id is not null;

alter table public.tenant_application_cases enable row level security;
grant select, insert, update, delete on public.tenant_application_cases to tenant_app, service_role;

create or replace function public.carry_attribution_to_case()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_campaign uuid;
  v_vendor uuid;
begin
  if new.campaign_id is null then
    select l.campaign_id into v_campaign
      from agent_leads l where l.id = new.lead_id and l.tenant_id = new.tenant_id;
    new.campaign_id := v_campaign;
  end if;
  if new.vendor_id is null and new.campaign_id is not null then
    select c.vendor_id into v_vendor from tenant_campaigns c where c.id = new.campaign_id;
    new.vendor_id := v_vendor;
  end if;
  return new;
end;
$function$;

drop trigger if exists carry_attribution_to_case_trg on public.tenant_application_cases;
create trigger carry_attribution_to_case_trg
  before insert on public.tenant_application_cases
  for each row execute function public.carry_attribution_to_case();

-- ── the doorway ────────────────────────────────────────────────────────────
--
-- "Interested — start application" is one call. It is idempotent by construction, which is the
-- whole of criterion 3: calling it again after a dropped call returns the SAME verification
-- session, and the verification_fields rows hang off the session id, so everything already
-- collected is still there. Resuming is not a separate code path that has to be kept in step with
-- starting — it is the same call, returning what already exists.
--
-- The session insert is character-for-character the one in `claim_transfer_lead`, including the
-- conflict target. That is deliberate: two inserts that differ by a column are how the inbound and
-- outbound panels start behaving differently six months from now.
create or replace function public.start_application_from_lead(
  p_tenant_id uuid,
  p_work_item_id uuid,
  p_agent_user_id uuid,
  p_product_line text default null
)
returns table(
  verification_session_id uuid,
  application_case_id uuid,
  deal_id uuid,
  lead_id uuid,
  source text,
  resumed boolean
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_queue record;
  v_lead record;
  v_role text;
  v_session uuid;
  v_case uuid;
  v_deal uuid;
  v_source text;
  v_product text;
  v_resumed boolean := false;
  v_name text;
  v_phone text;
begin
  select q.* into v_queue
    from lead_queue q
   where q.id = p_work_item_id and q.tenant_id = p_tenant_id
   for update;
  if not found then
    raise exception 'WORK_ITEM_NOT_FOUND';
  end if;

  -- The agent must be holding this lead. An application started on somebody else's work item is
  -- the same defect as LA-2.12's cross-setter leak, arriving by a different door.
  if v_queue.owner_user_id is distinct from p_agent_user_id then
    raise exception 'APPLICATION_OWNER_REQUIRED';
  end if;
  if v_queue.status not in ('claimed', 'buffer_active', 'la_active') then
    raise exception 'APPLICATION_WORK_ITEM_NOT_CLAIMED';
  end if;

  select l.* into v_lead from agent_leads l
   where l.id = v_queue.lead_id and l.tenant_id = p_tenant_id;
  if not found then
    raise exception 'LEAD_NOT_FOUND';
  end if;

  -- A lead that arrived from a partner is an inbound one however it is being worked now. The
  -- source describes where the lead came from, not which screen opened it.
  v_source := case when v_queue.partner_id is not null then 'inbound' else 'outbound' end;

  -- "Product chosen at this point, and the field set follows it." The caller may name it; the
  -- lead's own product line is the default, and the field set follows from the lead either way.
  v_product := coalesce(nullif(btrim(coalesce(p_product_line, '')), ''), v_lead.product_line);
  if v_product is distinct from v_lead.product_line then
    update agent_leads set product_line = v_product, updated_at = now()
     where id = v_lead.id and tenant_id = p_tenant_id;
  end if;

  select tu.role::text into v_role
    from tenant_users tu where tu.tenant_id = p_tenant_id and tu.user_id = p_agent_user_id;
  v_role := coalesce(v_role, 'producer');

  -- An unlicensed setter may not take an application. LA-2.12's role table, enforced in the RPC
  -- rather than only at the route, for the same reason the calling-window check is.
  if v_role = 'setter' then
    raise exception 'SETTER_MAY_NOT_TAKE_APPLICATIONS';
  end if;

  v_resumed := exists (
    select 1 from tenant_verification_sessions s
     where s.tenant_id = p_tenant_id and s.work_item_id = p_work_item_id and s.ended_at is null
  );

  insert into tenant_verification_sessions (tenant_id, work_item_id, lead_id, user_id, agent_role)
  values (p_tenant_id, p_work_item_id, v_lead.id, p_agent_user_id, v_role)
  on conflict (work_item_id) where ended_at is null do update
    set user_id = excluded.user_id,
        agent_role = excluded.agent_role,
        status = 'open',
        ended_at = null,
        updated_at = now()
  returning id into v_session;

  -- The open case, reused if one is already open. The partial unique index is what makes the
  -- reuse correct under a race rather than merely likely.
  select c.id into v_case from tenant_application_cases c
   where c.tenant_id = p_tenant_id and c.lead_id = v_lead.id and c.status = 'open';
  if v_case is null then
    insert into tenant_application_cases
      (tenant_id, lead_id, work_item_id, product_line, source, opened_by)
    values (p_tenant_id, v_lead.id, p_work_item_id, v_product, v_source, p_agent_user_id)
    returning id into v_case;
  end if;

  -- The deal-flow row. Inbound already has one by now, written at submission time; outbound has
  -- never had one, because there was no submission. Upserting on lead_id means the inbound row is
  -- found rather than duplicated, and the outbound row is created here.
  v_name := coalesce(
    nullif(btrim(coalesce(v_lead.values->>'full_name', '')), ''),
    nullif(btrim(concat_ws(' ', v_lead.values->>'first_name', v_lead.values->>'last_name')), ''));
  v_phone := coalesce(v_lead.values->>'phone', v_lead.values->>'phone_number');

  select d.id into v_deal from deal_flow d
   where d.tenant_id = p_tenant_id and d.lead_id = v_lead.id;
  if v_deal is null then
    insert into deal_flow
      (tenant_id, lead_id, partner_id, product_line, pipeline_id, stage_id,
       insured_name, phone, source, worked_by)
    values
      (p_tenant_id, v_lead.id, v_queue.partner_id, v_product, v_queue.pipeline_id, v_queue.stage_id,
       v_name, v_phone, v_source, p_agent_user_id)
    returning id into v_deal;
  else
    update deal_flow set worked_by = coalesce(worked_by, p_agent_user_id), updated_at = now()
     where id = v_deal;
  end if;

  return query select v_session, v_case, v_deal, v_lead.id, v_source, v_resumed;
end;
$function$;

revoke all on function public.start_application_from_lead(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.start_application_from_lead(uuid, uuid, uuid, text) to tenant_app, service_role;

-- ── the attribution chain, readable end to end ─────────────────────────────
--
-- LA-2.17 needs cost per issued policy, which needs every hop of the chain to agree about which
-- campaign paid for the lead. This view is that chain in one place, so a figure that looks wrong
-- can be traced to the hop that lost the attribution rather than argued about.
create or replace view public.tenant_lead_attribution_chain as
select l.tenant_id,
       l.id as lead_id,
       l.campaign_id as lead_campaign_id,
       c.vendor_id as lead_vendor_id,
       ac.id as application_case_id,
       ac.campaign_id as case_campaign_id,
       ac.vendor_id as case_vendor_id,
       d.id as deal_id,
       d.campaign_id as deal_campaign_id,
       d.vendor_id as deal_vendor_id,
       d.source as deal_source,
       -- The whole point: where the chain disagrees with itself.
       (ac.id is not null and ac.campaign_id is distinct from l.campaign_id) as case_attribution_lost,
       (d.id is not null and d.campaign_id is distinct from l.campaign_id) as deal_attribution_lost
  from agent_leads l
  left join tenant_campaigns c on c.id = l.campaign_id
  left join tenant_application_cases ac on ac.lead_id = l.id and ac.tenant_id = l.tenant_id
  left join deal_flow d on d.lead_id = l.id and d.tenant_id = l.tenant_id;

alter view public.tenant_lead_attribution_chain set (security_invoker = on);
revoke all on public.tenant_lead_attribution_chain from anon, authenticated, public;
grant select on public.tenant_lead_attribution_chain to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='deal_flow' and column_name='vendor_id') then
    raise exception 'deal_flow.vendor_id did not land';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='deal_flow' and column_name='source') then
    raise exception 'deal_flow.source did not land';
  end if;
  if to_regclass('public.tenant_application_cases') is null then
    raise exception 'tenant_application_cases did not land';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='start_application_from_lead') <> 1 then
    raise exception 'start_application_from_lead did not land';
  end if;
  perform 1 from public.tenant_lead_attribution_chain limit 1;
  raise notice 'LA-2.14: the outbound doorway, the application case, and the attribution chain are in place';
end $$;
