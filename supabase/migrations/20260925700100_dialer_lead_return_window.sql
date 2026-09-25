-- ---------------------------------------------------------------------------
-- Dialer · Wrong number and Disconnected say whether the lead can go back to its vendor
--
-- User decision (2026-09-25): the dialer offers Wrong number and Disconnected as built-in outcomes.
-- Both close the lead (disposition_default_ends_call, 20260924140000). A lead bought from a vendor
-- campaign, still inside that vendor's return window, is then CLAIMABLE: vendor_claimable_leads
-- (20260913440000) already derives that from the attempt's disposition, so recording the outcome is
-- what marks it — there is no second flag to keep in step.
--
-- What was missing is the sentence the agent reads before recording it: "Claimable from DataLeads ·
-- 11 days left", or "Not claimable: <reason>". lead_return_window answers it with the SAME
-- arithmetic vendor_claimable_leads uses — the lead's created_at plus the vendor's
-- return_window_days, and a lead already on a claim is not claimable again — so the confirm line
-- and the Returns screen cannot disagree.
--
--   reason (null when claimable):
--     no_campaign       the lead did not come from a vendor campaign
--     no_return_window  the vendor's return window is 0 days
--     window_closed     the window has passed
--     already_claimed   the lead is already on a return claim — by lead, or (20260925703200) its
--                       number was already claimed from this campaign as an import removal
--
-- Read-only (STABLE). Additive: a new function, nothing else changes.
-- ---------------------------------------------------------------------------

create or replace function public.lead_return_window(p_tenant_id uuid, p_lead_id uuid)
returns table(
  campaign_id uuid,
  campaign_name text,
  vendor_name text,
  return_window_days integer,
  claimable_until timestamptz,
  days_remaining integer,
  claimable boolean,
  reason text
)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_lead record;
  v_until timestamptz;
  v_claimed boolean;
begin
  select l.id, l.created_at, c.id as cid, c.name as cname, v.name as vname, v.return_window_days as days,
         coalesce(l.values->>'phone', l.values->>'phone_number', l.values->>'primary_phone') as phone
    into v_lead
    from public.agent_leads l
    left join public.tenant_campaigns c on c.id = l.campaign_id and c.tenant_id = l.tenant_id
    left join public.tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = l.tenant_id
   where l.tenant_id = p_tenant_id and l.id = p_lead_id;
  if not found then
    return;
  end if;

  if v_lead.cid is null or v_lead.vname is null then
    return query select null::uuid, null::text, null::text, null::integer, null::timestamptz, null::integer, false, 'no_campaign'::text;
    return;
  end if;

  v_until := v_lead.created_at + make_interval(days => coalesce(v_lead.days, 0));
  select exists (
    select 1 from public.lead_claim_items i join public.lead_claims cl on cl.id = i.claim_id
     where i.tenant_id = p_tenant_id and i.lead_id = p_lead_id
  ) into v_claimed;

  -- One number, one claim (20260925703200): a number this campaign already claimed as an IMPORT
  -- REMOVAL (a claim item with scrub_rejection_id and no lead_id) is not claimable again, exactly as
  -- vendor_claimable_leads excludes it. That column arrives with 20260925703200, which may not be
  -- applied yet, so it is looked for first and the match runs through EXECUTE: this function
  -- creates and answers either way, and picks the check up as soon as the column exists.
  if not v_claimed and exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'lead_claim_items' and column_name = 'scrub_rejection_id'
  ) then
    execute $q$
      select exists (
        select 1 from public.lead_claim_items ri
          join public.tenant_campaign_scrub_rejections r on r.id = ri.scrub_rejection_id
         where ri.tenant_id = $1
           and r.tenant_id = $1
           and r.campaign_id = $2
           and r.phone_digits = right(regexp_replace(coalesce($3, ''), '[^0-9]', '', 'g'), 10)
      )$q$
      into v_claimed
      using p_tenant_id, v_lead.cid, v_lead.phone;
  end if;

  return query select
    v_lead.cid, v_lead.cname, v_lead.vname, coalesce(v_lead.days, 0), v_until,
    greatest(0, floor(extract(epoch from (v_until - now())) / 86400))::integer,
    (coalesce(v_lead.days, 0) > 0 and v_until > now() and not v_claimed),
    case
      when coalesce(v_lead.days, 0) = 0 then 'no_return_window'
      when v_claimed then 'already_claimed'
      when v_until <= now() then 'window_closed'
    end::text;
end;
$function$;

revoke all on function public.lead_return_window(uuid, uuid) from public, anon, authenticated;
grant execute on function public.lead_return_window(uuid, uuid) to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
  v_lead record;
  v_row record;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925700100: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  select pg_get_functiondef('public.lead_return_window(uuid, uuid)'::regprocedure) into v_def;
  -- The Returns screen's arithmetic, not a second opinion.
  if strpos(v_def, 'created_at + make_interval(days =>') = 0 or strpos(v_def, 'lead_claim_items') = 0 then
    raise exception 'lead_return_window no longer computes the window as vendor_claimable_leads does';
  end if;
  -- An import-removal claim of the same number counts as already claimed (20260925703200).
  if strpos(v_def, 'ri.scrub_rejection_id') = 0 or strpos(v_def, 'r.phone_digits = right(') = 0 then
    raise exception 'lead_return_window ignores import-removal claims of the same number';
  end if;
  -- The derived claim still reads these two outcomes, which is what "marks it claimable".
  if strpos(pg_get_functiondef('public.vendor_claimable_leads(uuid, uuid)'::regprocedure), '''wrong_number'', ''disconnected''') = 0 then
    raise exception 'vendor_claimable_leads no longer reads wrong_number / disconnected attempts';
  end if;
  if public.disposition_default_ends_call('wrong_number') is not true or public.disposition_default_ends_call('disconnected') is not true then
    raise exception 'wrong_number / disconnected no longer close the lead by default';
  end if;

  -- A real lead answers exactly one row, with a reason exactly when it is not claimable.
  select l.tenant_id, l.id into v_lead from public.agent_leads l limit 1;
  if v_lead.id is not null then
    select * into v_row from public.lead_return_window(v_lead.tenant_id, v_lead.id);
    if v_row.claimable is null then raise exception 'lead_return_window returned no row for a real lead'; end if;
    if v_row.claimable = (v_row.reason is not null) then
      raise exception 'lead_return_window: claimable and reason disagree (%, %)', v_row.claimable, v_row.reason;
    end if;
  end if;
  if not has_function_privilege('tenant_app', 'public.lead_return_window(uuid, uuid)', 'execute') then
    raise exception 'tenant_app cannot execute lead_return_window';
  end if;
  raise notice '20260925700100: lead_return_window answers whether a wrong number can go back to its vendor';
end $$;
