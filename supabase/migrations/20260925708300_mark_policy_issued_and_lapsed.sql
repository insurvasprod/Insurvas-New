-- ---------------------------------------------------------------------------
-- Scorecard · the first writer of tenant_issued_policies
--
-- 20260922190000 measured it: nothing in the product writes tenant_issued_policies, so the
-- scorecard's Issued column and True CPA were "correct, computable, and permanently null". User
-- decision: a manual "Mark issued" on a deal (carrier, policy number, issue date), and later
-- "Mark lapsed" (lapse date), owner and producer only.
--
-- Both go through the table's existing BEFORE trigger, enforce_issued_policy_attribution
-- (20260913420000), which fills campaign and vendor from the deal, then the lead, and refuses a
-- policy whose attribution disagrees with its deal or application. These functions only add what
-- the trigger cannot know: which deal, that it belongs to the tenant, that it has no live policy
-- already, and that the dates are possible.
--
-- The deal-flow report (20260924320000) already reads the latest issued policy per lead, so a
-- "Policy issued" step appears on the deal's timeline the moment one is marked.
-- ---------------------------------------------------------------------------

create or replace function public.mark_deal_policy_issued(
  p_tenant_id uuid,
  p_deal_id uuid,
  p_carrier text,
  p_policy_number text,
  p_issued_on date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_deal record;
  v_policy tenant_issued_policies%rowtype;
begin
  if p_carrier is null or char_length(btrim(p_carrier)) not between 1 and 160 then
    raise exception 'ISSUED_POLICY_CARRIER_REQUIRED';
  end if;
  if p_policy_number is null or char_length(btrim(p_policy_number)) not between 1 and 120 then
    raise exception 'ISSUED_POLICY_NUMBER_REQUIRED';
  end if;
  if p_issued_on is null or p_issued_on > current_date then
    raise exception 'ISSUED_POLICY_DATE_INVALID';
  end if;

  select d.id, d.tenant_id, d.lead_id, d.product_line into v_deal
    from deal_flow d
   where d.id = p_deal_id and d.tenant_id = p_tenant_id
   for update;
  if not found then raise exception 'ISSUED_POLICY_DEAL_NOT_FOUND'; end if;

  if exists (select 1 from tenant_issued_policies p
              where p.tenant_id = p_tenant_id and p.deal_id = p_deal_id and p.status = 'issued') then
    raise exception 'ISSUED_POLICY_ALREADY_ISSUED';
  end if;

  insert into tenant_issued_policies (tenant_id, lead_id, deal_id, product_line, carrier, policy_number, status, issued_at)
  values (p_tenant_id, v_deal.lead_id, v_deal.id, v_deal.product_line, btrim(p_carrier), btrim(p_policy_number), 'issued', p_issued_on::timestamptz)
  returning * into v_policy;

  return to_jsonb(v_policy);
end;
$function$;

create or replace function public.mark_issued_policy_lapsed(
  p_tenant_id uuid,
  p_policy_id uuid,
  p_lapsed_on date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_policy tenant_issued_policies%rowtype;
begin
  select * into v_policy
    from tenant_issued_policies p
   where p.id = p_policy_id and p.tenant_id = p_tenant_id
   for update;
  if not found then raise exception 'ISSUED_POLICY_NOT_FOUND'; end if;
  if v_policy.status <> 'issued' then raise exception 'ISSUED_POLICY_NOT_IN_FORCE'; end if;
  if p_lapsed_on is null or p_lapsed_on > current_date then raise exception 'ISSUED_POLICY_DATE_INVALID'; end if;
  if p_lapsed_on::timestamptz < v_policy.issued_at then raise exception 'ISSUED_POLICY_LAPSE_BEFORE_ISSUE'; end if;

  update tenant_issued_policies
     set status = 'lapsed', lapsed_at = p_lapsed_on::timestamptz, updated_at = now()
   where id = v_policy.id
  returning * into v_policy;

  return to_jsonb(v_policy);
end;
$function$;

revoke all on function public.mark_deal_policy_issued(uuid, uuid, text, text, date) from public, anon, authenticated, tenant_app;
revoke all on function public.mark_issued_policy_lapsed(uuid, uuid, date) from public, anon, authenticated, tenant_app;
grant execute on function public.mark_deal_policy_issued(uuid, uuid, text, text, date) to service_role;
grant execute on function public.mark_issued_policy_lapsed(uuid, uuid, date) to service_role;

do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925708300: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if to_regprocedure('public.mark_deal_policy_issued(uuid, uuid, text, text, date)') is null
     or to_regprocedure('public.mark_issued_policy_lapsed(uuid, uuid, date)') is null then
    raise exception 'the issued-policy writers did not land';
  end if;
  if has_function_privilege('tenant_app', 'public.mark_deal_policy_issued(uuid, uuid, text, text, date)', 'execute')
     or has_function_privilege('tenant_app', 'public.mark_issued_policy_lapsed(uuid, uuid, date)', 'execute') then
    raise exception 'the tenant plane can write issued policies directly';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.tenant_issued_policies'::regclass
                    and tgname = 'tenant_issued_policies_attribution' and not tgisinternal) then
    raise exception 'the attribution trigger these writers rely on is missing';
  end if;

  -- A deal that is not the tenant's is refused before anything is written.
  begin
    perform public.mark_deal_policy_issued(gen_random_uuid(), gen_random_uuid(), 'Carrier', 'P-1', current_date);
    raise exception 'mark_deal_policy_issued accepted a deal that does not exist';
  exception when others then
    if sqlerrm <> 'ISSUED_POLICY_DEAL_NOT_FOUND' then raise; end if;
  end;
  raise notice '20260925708300: Mark issued and Mark lapsed write tenant_issued_policies through the attribution trigger';
end $$;
