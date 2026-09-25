-- Two outbound bugs found by the Module 2 demo-readiness pass (2026-09-25).
--
-- 1. LA-2.24-1 — a campaign assignment rule matched leads from EVERY campaign.
--    assignment_condition_matches returned NULL, not false, for another campaign's lead:
--    `campaign_ids ? id` is false, `values ? id` is NULL (no such key), and false OR NULL is NULL.
--    Its callers test `if not assignment_condition_matches(...) then return false`, and NOT NULL is
--    NULL, so the rule was treated as a match. The campaign branch now never returns NULL, and it
--    also reads the singular `campaign_id` key that rules saved before the campaign_ids shape carry.
--    Behaviour change to expect: a campaign rule now routes only its own campaign's leads.
--
-- 2. LA-2.13-2 / LA-2.13-4 — the dialer never taught the scorer anything.
--    The write-back to tenant_scoring_decisions and the contact-rate counters (vendor history,
--    state × slot fit) live in complete_dial_disposition, which the app no longer calls. The live
--    paths — complete_existing_dial_disposition and complete_dial_disposition_with_callback, which
--    delegates to it — set the disposition on an existing attempt row and do neither. So the
--    holdout report could never show a contact, and two signals stayed neutral forever.
--    A trigger on the attempt row, fired the first time a disposition is set, does both for every
--    path. complete_dial_disposition INSERTS its attempt row with the disposition already set and
--    does its own write-back, so an UPDATE-only trigger never counts one dial twice.
--
-- Not included (recorded on the demo-readiness tracker instead): the cadence built-in table is one
-- attempt out of step with the spec (LA-2.7-3), holidays never block at state level (LA-2.4-3), and
-- serves are logged to the 'control' cohort while scoring is switched off.
--
-- Optional, after applying: `select public.rebuild_contact_rate_stats('<tenant id>');` rebuilds the
-- counters from past attempts for one tenant.

-- The trigger needs a lock on a busy table. Wait at most 5 seconds for it and fail cleanly (the
-- whole file rolls back; run it again) instead of queueing behind dialer traffic.
set local lock_timeout = '5s';

create or replace function public.assignment_condition_matches(p_type text, p_values jsonb, p_lead public.agent_leads)
returns boolean
language plpgsql
stable
as $function$
declare
  v_value text;
  v_values jsonb;
  v_seconds numeric;
  v_match jsonb := coalesce(p_values, '{}'::jsonb);
begin
  if p_type = 'fallback' then return true; end if;
  if p_type = 'campaign' then
    -- Each test is coalesced: a missing key must read as "no", never as NULL (see note 1).
    return p_lead.campaign_id is not null and (
      coalesce(v_match->'campaign_ids' ? p_lead.campaign_id::text, false)
      or coalesce(v_match->'values' ? p_lead.campaign_id::text, false)
      or coalesce(v_match->>'campaign_id' = p_lead.campaign_id::text, false)
    );
  end if;
  if p_type = 'state' then
    v_value := upper(trim(coalesce(p_lead.values->>'state', p_lead.values->>'state_code', '')));
    v_values := coalesce(v_match->'states', v_match->'values', '[]'::jsonb);
    if jsonb_typeof(v_values) <> 'array' then return false; end if;
    return v_value <> '' and exists (select 1 from jsonb_array_elements_text(v_values) x(value) where upper(trim(x.value)) = v_value);
  end if;
  if p_type = 'language' then
    v_value := lower(trim(coalesce(p_lead.values->>'language', p_lead.values->>'preferred_language', p_lead.values->>'language_code', '')));
    v_values := coalesce(v_match->'languages', v_match->'values', '[]'::jsonb);
    if jsonb_typeof(v_values) <> 'array' then return false; end if;
    return v_value <> '' and exists (select 1 from jsonb_array_elements_text(v_values) x(value) where lower(trim(x.value)) = v_value);
  end if;
  if p_type = 'product' then
    v_value := lower(trim(coalesce(p_lead.product_line, p_lead.values->>'product_code', p_lead.values->>'product', '')));
    v_values := coalesce(v_match->'products', v_match->'product_codes', v_match->'values', '[]'::jsonb);
    if jsonb_typeof(v_values) <> 'array' then return false; end if;
    return v_value <> '' and exists (select 1 from jsonb_array_elements_text(v_values) x(value) where lower(trim(x.value)) = v_value);
  end if;
  if p_type = 'realtime' then
    v_seconds := case when jsonb_typeof(v_match->'seconds') = 'number' then (v_match->>'seconds')::numeric end;
    return v_seconds is not null and v_seconds > 0
       and p_lead.posted_at is not null
       and p_lead.posted_at >= now() - make_interval(secs => v_seconds::double precision);
  end if;
  return false;
end;
$function$;

create or replace function public.tenant_call_attempts_score_outcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_contacted boolean := public.is_contact_disposition(new.disposition);
  v_vendor text;
  v_state text;
begin
  -- A customer ringing back is not an outbound dial: it must not move a vendor's contact rate.
  if new.disposition = 'inbound_return_call' then return null; end if;

  if new.work_item_id is not null then
    update public.tenant_scoring_decisions d
       set contacted_at = case when v_contacted then now() else d.contacted_at end,
           disposition = new.disposition
     where d.tenant_id = new.tenant_id and d.work_item_id = new.work_item_id and d.disposition is null;
  end if;

  select c.vendor_id::text, nullif(upper(trim(l.values->>'state')), '')
    into v_vendor, v_state
    from public.agent_leads l
    left join public.tenant_campaigns c on c.id = l.campaign_id
   where l.id = new.lead_id and l.tenant_id = new.tenant_id;

  if v_vendor is not null then
    perform public.bump_contact_rate_stats(new.tenant_id, 'vendor', v_vendor, v_contacted);
  end if;
  if v_state is not null and new.slot is not null then
    perform public.bump_contact_rate_stats(new.tenant_id, 'state_slot', v_state || ':' || new.slot, v_contacted);
  end if;
  return null;
end;
$function$;

-- CREATE OR REPLACE rather than DROP + CREATE: DROP TRIGGER takes ACCESS EXCLUSIVE on the table,
-- which also blocks readers, and the first run of this file deadlocked against a live reader.
-- CREATE TRIGGER takes SHARE ROW EXCLUSIVE, which readers pass through.
create or replace trigger tenant_call_attempts_score_outcome
  after update of disposition on public.tenant_call_attempts
  for each row
  when (old.disposition is null and new.disposition is not null)
  execute function public.tenant_call_attempts_score_outcome();
