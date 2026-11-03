-- SA-0.4 · Remove direct client execution from trigger-only security-definer functions.
--
-- These functions are invoked by database triggers, not by API clients. Keeping EXECUTE on the
-- default PUBLIC role widened the callable surface unnecessarily. The trigger path remains intact;
-- only direct PostgREST/client execution is removed. Empty search_path prevents name resolution
-- from being influenced by a caller.

create or replace function public.bump_contact_rate_stats(
  p_tenant_id uuid,
  p_scope text,
  p_key text,
  p_contacted boolean
)
returns void
language sql
security definer
set search_path = ''
as $function$
  insert into public.tenant_contact_rate_stats (tenant_id, scope, key, attempts, contacts)
  values (p_tenant_id, p_scope, p_key, 1, case when p_contacted then 1 else 0 end)
  on conflict (tenant_id, scope, key) do update
     set attempts = public.tenant_contact_rate_stats.attempts + 1,
         contacts = public.tenant_contact_rate_stats.contacts + (case when p_contacted then 1 else 0 end),
         updated_at = now()
  where p_key is not null;
$function$;

create or replace function public.carry_attribution_to_case()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_campaign uuid;
  v_vendor uuid;
begin
  if new.campaign_id is null then
    select l.campaign_id into v_campaign
      from public.agent_leads l where l.id = new.lead_id and l.tenant_id = new.tenant_id;
    new.campaign_id := v_campaign;
  end if;
  if new.vendor_id is null and new.campaign_id is not null then
    select c.vendor_id into v_vendor from public.tenant_campaigns c where c.id = new.campaign_id;
    new.vendor_id := v_vendor;
  end if;
  return new;
end;
$function$;

create or replace function public.carry_campaign_id_to_deal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_campaign uuid;
  v_vendor uuid;
begin
  if new.lead_id is null then
    return new;
  end if;
  if new.campaign_id is null then
    select l.campaign_id into v_campaign
      from public.agent_leads l where l.id = new.lead_id and l.tenant_id = new.tenant_id;
    new.campaign_id := v_campaign;
  end if;
  if new.vendor_id is null and new.campaign_id is not null then
    select c.vendor_id into v_vendor from public.tenant_campaigns c where c.id = new.campaign_id;
    new.vendor_id := v_vendor;
  end if;
  return new;
end;
$function$;

-- This function already has an empty search_path in the current inventory; the revoke is still
-- included so the migration is idempotent across older shared-project snapshots.
revoke all on function public.bump_contact_rate_stats(uuid, text, text, boolean),
  public.carry_attribution_to_case(),
  public.carry_campaign_id_to_deal(),
  public.enforce_campaign_vendor_tenant()
  from public, anon, authenticated, tenant_app;
grant execute on function public.bump_contact_rate_stats(uuid, text, text, boolean),
  public.carry_attribution_to_case(),
  public.carry_campaign_id_to_deal(),
  public.enforce_campaign_vendor_tenant()
  to service_role;
