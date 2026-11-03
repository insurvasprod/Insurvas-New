-- ---------------------------------------------------------------------------
-- LA-2.1 · Serving by mixing weight, and stopping the moment a campaign pauses
--
-- Two of LA-2.1's acceptance criteria are about serving rather than storage:
--
--   3. Pausing a campaign stops its leads being served within seconds
--   5. Two active campaigns with weights 4 and 2 serve roughly 2:1
--
-- Neither can be proven by a column. `mixing_weight` sitting in a table is a number nobody reads;
-- the criterion is about what comes out of the queue. The full queue is LA-2.8's job — tiers,
-- scoring, cadence — but the campaign-mixing half belongs here, with the weight it reads, or
-- LA-2.1 ships with two criteria that cannot be checked.
--
-- `within seconds` is met by construction rather than by a cache TTL: the picker reads `status`
-- live on every call, so a pause takes effect on the next lead served. There is nothing to
-- invalidate, which is the only version of "within seconds" that cannot drift. Compare the kill
-- switches (LA-1), where a process-local cache meant a toggle took up to 60 seconds to reach a
-- second process — correct there, because that cache saves a query per request; wrong here,
-- because a paused campaign that keeps serving is money spent on leads nobody meant to buy.
-- ---------------------------------------------------------------------------

create or replace function public.next_campaign_for_serving(p_tenant_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_total bigint;
  v_pick numeric;
  v_campaign uuid;
begin
  -- Only active campaigns, read now. A draft has not started, a paused one has been stopped
  -- deliberately, and an exhausted one has no records left to serve.
  select coalesce(sum(mixing_weight), 0) into v_total
    from campaigns_servable where tenant_id = p_tenant_id;

  if v_total = 0 then
    return null;
  end if;

  -- A point on the line [0, total), then the first campaign whose running total passes it. This is
  -- the standard weighted draw: with weights 4 and 2 the first owns 4/6 of the line and the second
  -- 2/6, which is the 2:1 in criterion 5.
  v_pick := random() * v_total;

  select id into v_campaign
    from (
      select id,
             sum(mixing_weight) over (order by id rows between unbounded preceding and current row) as running
        from campaigns_servable
       where tenant_id = p_tenant_id
    ) ranked
   where ranked.running > v_pick
   order by ranked.running
   limit 1;

  return v_campaign;
end;
$function$;

-- The servable set, named once so the picker and anything auditing it cannot drift apart.
create or replace view public.campaigns_servable as
select id, tenant_id, name, vendor_id, mixing_weight, product_code, target_states
  from public.tenant_campaigns
 where status = 'active';

alter view public.campaigns_servable set (security_invoker = on);

revoke all on public.campaigns_servable from anon, authenticated, public;
grant select on public.campaigns_servable to tenant_app, service_role;

revoke all on function public.next_campaign_for_serving(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.next_campaign_for_serving(uuid) to service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_vendor uuid;
  v_a uuid;
  v_b uuid;
  v_draws integer := 3000;
  v_a_hits integer := 0;
  v_pick uuid;
  v_ratio numeric;
  i integer;
begin
  select id into v_tenant from public.tenants order by created_at limit 1;
  if v_tenant is null then
    raise notice 'no tenant exists, so the serving assertion was skipped';
    return;
  end if;

  insert into public.tenant_lead_vendors (tenant_id, name, lead_type)
  values (v_tenant, 'Serving self-check vendor', 'list') returning id into v_vendor;

  insert into public.tenant_campaigns (tenant_id, vendor_id, name, lead_type, status, mixing_weight)
  values (v_tenant, v_vendor, 'Serving self-check A', 'list', 'active', 4) returning id into v_a;
  insert into public.tenant_campaigns (tenant_id, vendor_id, name, lead_type, status, mixing_weight)
  values (v_tenant, v_vendor, 'Serving self-check B', 'list', 'active', 2) returning id into v_b;

  -- Criterion 5, measured rather than asserted about. 3,000 draws of a 4:2 split lands on 2:1
  -- closely enough that a 1.8-2.2 band is a real test: a picker that ignored the weight entirely
  -- would sit at 1.0 and fail, and so would one that always picked the heavier campaign.
  for i in 1..v_draws loop
    v_pick := public.next_campaign_for_serving(v_tenant);
    if v_pick = v_a then v_a_hits := v_a_hits + 1; end if;
  end loop;

  v_ratio := v_a_hits::numeric / nullif(v_draws - v_a_hits, 0);
  if v_ratio < 1.8 or v_ratio > 2.2 then
    raise exception 'weights 4 and 2 served %:1 over % draws, which is not roughly 2:1',
      round(v_ratio, 2), v_draws;
  end if;

  -- Criterion 3. No cache to wait for: the very next call must not return it.
  update public.tenant_campaigns set status = 'paused' where id = v_a;
  for i in 1..200 loop
    if public.next_campaign_for_serving(v_tenant) = v_a then
      raise exception 'a paused campaign was still served';
    end if;
  end loop;

  -- And with everything paused, nothing is served rather than something being served anyway.
  update public.tenant_campaigns set status = 'paused' where id = v_b;
  if public.next_campaign_for_serving(v_tenant) is not null then
    raise exception 'a campaign was served while every campaign was paused';
  end if;

  delete from public.tenant_campaigns where tenant_id = v_tenant and name like 'Serving self-check %';
  delete from public.tenant_lead_vendors where id = v_vendor;

  raise notice 'weighted serving verified at %:1 over % draws', round(v_ratio, 2), v_draws;
exception when others then
  delete from public.tenant_campaigns where name like 'Serving self-check %';
  if v_vendor is not null then delete from public.tenant_lead_vendors where id = v_vendor; end if;
  raise;
end $$;
