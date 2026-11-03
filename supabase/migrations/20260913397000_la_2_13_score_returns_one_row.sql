-- ---------------------------------------------------------------------------
-- LA-2.13 criterion 5, third pass · a score is one row, so stop returning a set
--
-- After the counters and the candidate cap, scoring still cost about 2ms per lead. Profiling the
-- five queries inside `score_lead` accounted for only a quarter of that:
--
--   lead + campaign join      10.7 ms / 50 calls
--   current_slot_for_state     7.3
--   tried slots                1.4
--   consent exists             3.5
--   contact-rate lookup        1.4
--   ----------------------------------
--   the queries               24.3 ms / 50 calls
--   score_lead itself        103.7 ms / 50 calls
--
-- Three quarters of the time was not in the work. It was in the shape of the function.
-- `returns table(...)` makes a plpgsql function set-returning, and every call builds a tuplestore
-- to hold its one row — allocated, filled, read back and thrown away, fifty times per serve, for a
-- function that can never return more than one row.
--
-- OUT parameters return that row directly. The arithmetic is unchanged, character for character;
-- only the plumbing is gone. `select * from score_lead(...)` and `cross join lateral score_lead(...)`
-- both still work, because a composite-returning function is usable in exactly those positions.
-- ---------------------------------------------------------------------------

drop function if exists public.score_lead(uuid, uuid, timestamptz);

create function public.score_lead(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_at timestamptz,
  out score numeric,
  out reasons text[],
  out signals jsonb
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  w jsonb;
  v_lead record;
  v_slot text;
  v_attempts integer;
  v_tried text[];
  v_vendor uuid;
  v_vendor_rate numeric;
  v_vendor_n integer;
  v_slot_rate numeric;
  v_slot_n integer;
  v_age_days numeric;
  v_has_consent boolean;
  v_fields integer;
  v_state text;
  f_recency numeric; f_attempt numeric; f_slot numeric;
  f_vendor numeric; f_time numeric; f_complete numeric; f_consent numeric;
begin
  reasons := array[]::text[];

  select jsonb_object_agg(s.signal, s.weight) into w from scoring_weights_for(p_tenant_id) s;

  select l.id, l.values, l.posted_at, l.created_at, l.attempts_made, c.vendor_id
    into v_lead
    from agent_leads l
    left join tenant_campaigns c on c.id = l.campaign_id
   where l.id = p_lead_id and l.tenant_id = p_tenant_id;
  if not found then
    score := 0;
    reasons := array['Lead not found.'];
    signals := '{}'::jsonb;
    return;
  end if;

  v_state := v_lead.values->>'state';
  v_vendor := v_lead.vendor_id;
  v_attempts := coalesce(v_lead.attempts_made, 0);
  v_slot := current_slot_for_state(v_state, p_at);

  -- RECENCY. "Fresher is better, sharply so." Half-life of three days rather than a straight line,
  -- because the difference between an hour old and a day old matters far more than the difference
  -- between twenty days and twenty-one.
  v_age_days := greatest(extract(epoch from (p_at - coalesce(v_lead.posted_at, v_lead.created_at))) / 86400.0, 0);
  f_recency := power(0.5, v_age_days / 3.0);
  if f_recency > 0.7 then
    reasons := reasons || format('posted %s ago', case
      when v_age_days < 1 then round(v_age_days * 24)::text || ' hours'
      else round(v_age_days)::text || ' days' end);
  end if;

  -- ATTEMPT POSITION. "Attempts two and three convert best; the seventh rarely does."
  f_attempt := case
    when v_attempts = 0 then 0.75
    when v_attempts between 1 and 2 then 1.0
    when v_attempts = 3 then 0.7
    when v_attempts = 4 then 0.5
    when v_attempts = 5 then 0.3
    else 0.1
  end;
  reasons := reasons || format('attempt %s of 7', v_attempts + 1);

  -- SLOT FRESHNESS. "Slots this lead has not failed in yet." Per lead by definition.
  select coalesce(array_agg(distinct ca.slot), array[]::text[]) into v_tried
    from tenant_call_attempts ca
   where ca.tenant_id = p_tenant_id and ca.lead_id = p_lead_id;
  if v_slot is null then
    f_slot := 0.5;
  elsif v_slot = any(v_tried) then
    f_slot := 0.0;
  else
    f_slot := 1.0;
    reasons := reasons || format('never tried in the %s slot', replace(v_slot, '_', ' '));
  end if;

  -- VENDOR HISTORY. "This vendor contacts at 14%, that one at 6%." One indexed row.
  if v_vendor is not null then
    select st.attempts, case when st.attempts > 0 then st.contacts::numeric / st.attempts end
      into v_vendor_n, v_vendor_rate
      from tenant_contact_rate_stats st
     where st.tenant_id = p_tenant_id and st.scope = 'vendor' and st.key = v_vendor::text;
  end if;
  -- Below thirty dials the rate is noise, and a vendor with one lucky answer would outrank a vendor
  -- with a thousand honest ones. Neutral until there is evidence.
  if coalesce(v_vendor_n, 0) >= 30 then
    f_vendor := least(v_vendor_rate / 0.20, 1.0);
    reasons := reasons || format('this vendor contacts at %s%%', round(v_vendor_rate * 100));
  else
    f_vendor := 0.5;
  end if;

  -- TIME-OF-DAY FIT. "This age band and state, at this hour, from historical contact data." Age
  -- banding is not attempted here: there is no dial history to support it, and a band invented
  -- without evidence is the unexplainable number this task exists to refuse. State and slot are
  -- what the stored attempts can actually answer.
  if v_slot is not null and v_state is not null then
    select st.attempts, case when st.attempts > 0 then st.contacts::numeric / st.attempts end
      into v_slot_n, v_slot_rate
      from tenant_contact_rate_stats st
     where st.tenant_id = p_tenant_id and st.scope = 'state_slot'
       and st.key = upper(v_state) || ':' || v_slot;
  end if;
  if coalesce(v_slot_n, 0) >= 30 then
    f_time := least(v_slot_rate / 0.20, 1.0);
    reasons := reasons || format('%s answers at %s%% in this slot', upper(v_state), round(v_slot_rate * 100));
  else
    f_time := 0.5;
  end if;

  -- DATA COMPLETENESS. "A record with a date of birth and full address outperforms a bare name and
  -- number."
  v_fields := (case when coalesce(v_lead.values->>'date_of_birth', v_lead.values->>'dob') is not null then 1 else 0 end)
            + (case when v_lead.values->>'address' is not null or v_lead.values->>'address_line1' is not null then 1 else 0 end)
            + (case when v_lead.values->>'email' is not null then 1 else 0 end)
            + (case when v_lead.values->>'zip' is not null or v_lead.values->>'postal_code' is not null then 1 else 0 end);
  f_complete := v_fields / 4.0;
  if v_fields = 4 then reasons := reasons || 'complete record'::text; end if;

  -- CONSENT ARTEFACT. "Both a compliance signal and a quality one."
  select exists (select 1 from tenant_consent_artefacts ta
                  where ta.tenant_id = p_tenant_id and ta.lead_id = p_lead_id)
    into v_has_consent;
  f_consent := case when v_has_consent then 1.0 else 0.0 end;
  if v_has_consent then reasons := reasons || 'consent on file'::text; end if;

  score := round(
      coalesce((w->>'recency')::numeric, 0) * f_recency
    + coalesce((w->>'attempt_position')::numeric, 0) * f_attempt
    + coalesce((w->>'slot_freshness')::numeric, 0) * f_slot
    + coalesce((w->>'vendor_contact_rate')::numeric, 0) * f_vendor
    + coalesce((w->>'time_of_day_fit')::numeric, 0) * f_time
    + coalesce((w->>'completeness')::numeric, 0) * f_complete
    + coalesce((w->>'consent_artefact')::numeric, 0) * f_consent, 3);

  signals := jsonb_build_object(
      'recency', round(f_recency, 3),
      'attempt_position', round(f_attempt, 3),
      'slot_freshness', round(f_slot, 3),
      'vendor_contact_rate', round(f_vendor, 3),
      'time_of_day_fit', round(f_time, 3),
      'completeness', round(f_complete, 3),
      'consent_artefact', round(f_consent, 3),
      'slot', to_jsonb(v_slot),
      'attempts_made', to_jsonb(v_attempts),
      'weights', w);
end;
$function$;

revoke all on function public.score_lead(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.score_lead(uuid, uuid, timestamptz) to tenant_app, service_role;

do $$
declare
  v_tenant uuid; v_lead uuid; a record; b record;
begin
  select tenant_id into v_tenant from public.agent_leads group by tenant_id order by count(*) desc limit 1;
  if v_tenant is null then raise notice 'no leads; skipped'; return; end if;
  select id into v_lead from public.agent_leads where tenant_id = v_tenant limit 1;

  select * into a from public.score_lead(v_tenant, v_lead, timestamptz '2026-09-14 15:00:00+00');
  select * into b from public.score_lead(v_tenant, v_lead, timestamptz '2026-09-14 15:00:00+00');
  if a.score is distinct from b.score or a.signals is distinct from b.signals then
    raise exception 'score_lead is no longer deterministic after the rewrite';
  end if;
  if a.score is null then raise exception 'score_lead returned no score'; end if;
  raise notice 'LA-2.13: score_lead returns one row, score %', a.score;
end $$;
