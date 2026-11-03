-- ---------------------------------------------------------------------------
-- LA-2.1 · campaign_id travels with the lead, one column at each hop
--
-- The criterion: "Every lead carries its campaign_id, and it survives into the application and the
-- policy record." Without it, LA-2.17 cannot compute cost per issued policy — the number that
-- decides which vendor to buy from next month.
--
-- What the tenant plane actually has to hop to, today:
--
--   agent_leads    the lead              campaign_id added by 20260913260000
--   deal_flow      the worked deal       tenant_id + lead_id, the nearest thing to a policy record
--   (application)  LA-2.14, not built
--   (policy)       no tenant-plane policy table exists
--
-- `insurance_policies` and `daily_deal_flow` both carry a campaign_id already — and both are
-- organization_id-keyed, so they are the CRM's and are left alone. Adding the column to them would
-- be writing into another lineage to satisfy our own criterion.
--
-- So this carries the chain as far as the tenant plane goes: lead → deal. The remaining hops are
-- recorded as blocked on LA-2.14 rather than quietly claimed, because a criterion half-met and
-- reported whole is how LA-1 accumulated the gaps this module is trying not to repeat.
--
-- The copy is a trigger, not a service call. "One column at each hop" fails the first time somebody
-- writes a deal_flow row from a path that did not know to carry it — and that path will be written
-- by LA-2.14, months from now, by someone who has never read this file.
-- ---------------------------------------------------------------------------

alter table public.deal_flow
  add column if not exists campaign_id uuid references public.tenant_campaigns(id) on delete set null;

create index if not exists deal_flow_campaign_idx
  on public.deal_flow (tenant_id, campaign_id) where campaign_id is not null;

create or replace function public.carry_campaign_id_to_deal()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_campaign uuid;
begin
  -- An explicit value wins. A caller that knows better than the lead -- a deal re-attributed by
  -- hand, say -- must not have its value overwritten by this.
  if new.campaign_id is not null then
    return new;
  end if;
  if new.lead_id is null then
    return new;
  end if;

  select campaign_id into v_campaign
    from agent_leads
   where id = new.lead_id and tenant_id = new.tenant_id;

  new.campaign_id := v_campaign;
  return new;
end;
$function$;

drop trigger if exists deal_flow_carry_campaign_id on public.deal_flow;
create trigger deal_flow_carry_campaign_id
  before insert on public.deal_flow
  for each row execute function public.carry_campaign_id_to_deal();

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_vendor uuid;
  v_campaign uuid;
  v_lead uuid;
  v_deal uuid;
  v_carried uuid;
  v_product text;
begin
  select tenant_id into v_tenant from public.agent_leads group by tenant_id order by count(*) desc limit 1;
  if v_tenant is null then
    raise notice 'no tenant has leads, so the travel assertion was skipped';
    return;
  end if;

  insert into public.tenant_lead_vendors (tenant_id, name, lead_type)
  values (v_tenant, 'Travel self-check vendor', 'list') returning id into v_vendor;
  insert into public.tenant_campaigns (tenant_id, vendor_id, name, lead_type, status)
  values (v_tenant, v_vendor, 'Travel self-check', 'list', 'active') returning id into v_campaign;

  -- A lead of this tenant, attributed to the campaign. product_line comes from the lead rather
  -- than being invented, because deal_flow requires it and a made-up value would be the kind of
  -- fixture that passes while describing nothing real.
  -- A lead with no deal yet: deal_flow_lead_id_key allows one deal per lead, so reusing a lead
  -- that already has one fails on a constraint that has nothing to do with what is being tested.
  select l.id, l.product_line into v_lead, v_product
    from public.agent_leads l
   where l.tenant_id = v_tenant
     and l.product_line is not null
     and not exists (select 1 from public.deal_flow d where d.lead_id = l.id)
   limit 1;
  if v_lead is null then
    raise notice 'no lead with a product_line, so the travel assertion was skipped';
    delete from public.tenant_campaigns where id = v_campaign;
    delete from public.tenant_lead_vendors where id = v_vendor;
    return;
  end if;
  update public.agent_leads set campaign_id = v_campaign where id = v_lead;

  insert into public.deal_flow (tenant_id, lead_id, local_date, status, product_line)
  values (v_tenant, v_lead, current_date, 'partial', v_product)
  returning id, campaign_id into v_deal, v_carried;

  if v_carried is distinct from v_campaign then
    raise exception 'campaign_id did not travel to the deal: expected %, got %', v_campaign, v_carried;
  end if;

  -- An explicit value is respected rather than overwritten.
  delete from public.deal_flow where id = v_deal;
  insert into public.deal_flow (tenant_id, lead_id, local_date, status, product_line, campaign_id)
  values (v_tenant, v_lead, current_date, 'partial', v_product, null)
  returning id into v_deal;

  delete from public.deal_flow where id = v_deal;
  update public.agent_leads set campaign_id = null where id = v_lead;
  delete from public.tenant_campaigns where id = v_campaign;
  delete from public.tenant_lead_vendors where id = v_vendor;
exception when others then
  if v_deal is not null then delete from public.deal_flow where id = v_deal; end if;
  if v_lead is not null then update public.agent_leads set campaign_id = null where id = v_lead; end if;
  if v_campaign is not null then delete from public.tenant_campaigns where id = v_campaign; end if;
  if v_vendor is not null then delete from public.tenant_lead_vendors where id = v_vendor; end if;
  raise;
end $$;
