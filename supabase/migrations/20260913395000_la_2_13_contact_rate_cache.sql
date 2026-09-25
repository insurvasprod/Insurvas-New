-- ---------------------------------------------------------------------------
-- LA-2.13 criterion 5 · "Scoring adds under 50ms to serving"
--
-- The first version did not. Measured against 200 queued leads on the live database:
--
--   serve, scoring off   269.4 ms
--   serve, scoring on   1082.0 ms
--   scoring adds         812.7 ms
--
-- It passed the acceptance run only because that run queued forty leads, and forty was small
-- enough to hide an O(candidates x history) scan. The criterion is a performance number, so it has
-- to be measured at a size where being wrong is visible; a green light at forty leads was a
-- statement about the fixture rather than about the feature.
--
-- THE CAUSE. `score_lead` is called once per candidate, and two of its seven signals — the vendor's
-- contact rate and the state-and-slot contact rate — were each a full aggregate over
-- `tenant_call_attempts` joined to `agent_leads`. Two hundred candidates meant four hundred scans
-- to choose one lead. Worse, those two aggregates return the SAME answer for every lead sharing a
-- vendor or a state, so almost all of that work was recomputing a number that had not changed.
--
-- THE FIX. Two counters per fact, maintained where the fact is created. A disposition is the only
-- event that can change a contact rate, so `complete_dial_disposition` increments the counters as
-- it writes the attempt, and `score_lead` reads one indexed row per signal instead of scanning.
--
-- This is a cache in the sense that it is derived, but not in the sense that it can drift: it is
-- written in the same transaction as the attempt it counts, so the counter and the attempts table
-- commit together or not at all. `rebuild_contact_rate_stats` exists to recover from a historical
-- import that writes attempts directly, and is used below to seed from the rows already present.
-- ---------------------------------------------------------------------------

create table if not exists public.tenant_contact_rate_stats (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- 'vendor' keyed by the vendor id; 'state_slot' keyed by 'AZ:afternoon'.
  scope text not null check (scope in ('vendor', 'state_slot')),
  key text not null,
  attempts integer not null default 0,
  contacts integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, scope, key)
);

grant select, insert, update, delete on public.tenant_contact_rate_stats to tenant_app, service_role;
alter table public.tenant_contact_rate_stats enable row level security;

-- Supporting indexes for the two per-lead lookups that remain. Both are per-lead by definition and
-- cannot be summarised: a lead's own tried slots, and whether it has a consent artefact.
create index if not exists tenant_call_attempts_tenant_lead_idx
  on public.tenant_call_attempts (tenant_id, lead_id);
create index if not exists tenant_consent_artefacts_tenant_lead_idx
  on public.tenant_consent_artefacts (tenant_id, lead_id);

create or replace function public.bump_contact_rate_stats(
  p_tenant_id uuid,
  p_scope text,
  p_key text,
  p_contacted boolean
)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  insert into tenant_contact_rate_stats (tenant_id, scope, key, attempts, contacts)
  values (p_tenant_id, p_scope, p_key, 1, case when p_contacted then 1 else 0 end)
  on conflict (tenant_id, scope, key) do update
     set attempts = tenant_contact_rate_stats.attempts + 1,
         contacts = tenant_contact_rate_stats.contacts + (case when p_contacted then 1 else 0 end),
         updated_at = now()
  where p_key is not null;
$function$;

create or replace function public.rebuild_contact_rate_stats(p_tenant_id uuid default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rows integer;
begin
  delete from tenant_contact_rate_stats
   where p_tenant_id is null or tenant_id = p_tenant_id;

  insert into tenant_contact_rate_stats (tenant_id, scope, key, attempts, contacts)
  select ca.tenant_id, 'vendor', c.vendor_id::text,
         count(*)::integer,
         count(*) filter (where is_contact_disposition(ca.disposition))::integer
    from tenant_call_attempts ca
    join agent_leads l on l.id = ca.lead_id
    join tenant_campaigns c on c.id = l.campaign_id
   where ca.disposition is not null
     and c.vendor_id is not null
     and (p_tenant_id is null or ca.tenant_id = p_tenant_id)
   group by 1, 3;

  insert into tenant_contact_rate_stats (tenant_id, scope, key, attempts, contacts)
  select ca.tenant_id, 'state_slot', upper(l.values->>'state') || ':' || ca.slot,
         count(*)::integer,
         count(*) filter (where is_contact_disposition(ca.disposition))::integer
    from tenant_call_attempts ca
    join agent_leads l on l.id = ca.lead_id
   where ca.disposition is not null
     and ca.slot is not null
     and l.values->>'state' is not null
     and (p_tenant_id is null or ca.tenant_id = p_tenant_id)
   group by 1, 3;

  get diagnostics v_rows = row_count;
  return (select count(*)::integer from tenant_contact_rate_stats
           where p_tenant_id is null or tenant_id = p_tenant_id);
end;
$function$;

revoke all on function public.rebuild_contact_rate_stats(uuid) from public, anon, authenticated;
grant execute on function public.rebuild_contact_rate_stats(uuid) to tenant_app, service_role;
grant execute on function public.bump_contact_rate_stats(uuid, text, text, boolean) to service_role;

select public.rebuild_contact_rate_stats(null);

-- ── score_lead, reading counters instead of scanning ───────────────────────
--
-- Identical arithmetic to the first version — same factors, same thresholds, same reasons. The only
-- change is where the two rates come from. That matters: a performance fix that also changes the
-- score would invalidate every decision row already written.
create or replace function public.score_lead(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_at timestamptz
)
returns table(score numeric, reasons text[], signals jsonb)
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
  f_recency numeric; f_attempt numeric; f_slot numeric;
  f_vendor numeric; f_time numeric; f_complete numeric; f_consent numeric;
  v_score numeric := 0;
  v_reasons text[] := array[]::text[];
begin
  select jsonb_object_agg(s.signal, s.weight) into w from scoring_weights_for(p_tenant_id) s;

  select l.*, c.vendor_id into v_lead
    from agent_leads l
    left join tenant_campaigns c on c.id = l.campaign_id
   where l.id = p_lead_id and l.tenant_id = p_tenant_id;
  if not found then
    return query select 0::numeric, array['Lead not found.']::text[], '{}'::jsonb;
    return;
  end if;

  v_vendor := v_lead.vendor_id;
  v_attempts := coalesce(v_lead.attempts_made, 0);
  v_slot := current_slot_for_state(v_lead.values->>'state', p_at);

  -- RECENCY. "Fresher is better, sharply so." Half-life of three days rather than a straight line,
  -- because the difference between an hour old and a day old matters far more than the difference
  -- between twenty days and twenty-one.
  v_age_days := greatest(extract(epoch from (p_at - coalesce(v_lead.posted_at, v_lead.created_at))) / 86400.0, 0);
  f_recency := power(0.5, v_age_days / 3.0);
  if f_recency > 0.7 then
    v_reasons := v_reasons || format('posted %s ago', case
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
  v_reasons := v_reasons || format('attempt %s of 7', v_attempts + 1);

  -- SLOT FRESHNESS. "Slots this lead has not failed in yet." Per lead by definition, and now on an
  -- index rather than a sequential scan.
  select coalesce(array_agg(distinct ca.slot), array[]::text[]) into v_tried
    from tenant_call_attempts ca
   where ca.tenant_id = p_tenant_id and ca.lead_id = p_lead_id;
  if v_slot is null then
    f_slot := 0.5;
  elsif v_slot = any(v_tried) then
    f_slot := 0.0;
  else
    f_slot := 1.0;
    v_reasons := v_reasons || format('never tried in the %s slot', replace(v_slot, '_', ' '));
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
    v_reasons := v_reasons || format('this vendor contacts at %s%%', round(v_vendor_rate * 100));
  else
    f_vendor := 0.5;
  end if;

  -- TIME-OF-DAY FIT. "This age band and state, at this hour, from historical contact data." Age
  -- banding is not attempted here: there is no dial history to support it, and a band invented
  -- without evidence is the unexplainable number this task exists to refuse. State and slot are
  -- what the stored attempts can actually answer.
  if v_slot is not null and v_lead.values->>'state' is not null then
    select st.attempts, case when st.attempts > 0 then st.contacts::numeric / st.attempts end
      into v_slot_n, v_slot_rate
      from tenant_contact_rate_stats st
     where st.tenant_id = p_tenant_id and st.scope = 'state_slot'
       and st.key = upper(v_lead.values->>'state') || ':' || v_slot;
  end if;
  if coalesce(v_slot_n, 0) >= 30 then
    f_time := least(v_slot_rate / 0.20, 1.0);
    v_reasons := v_reasons || format('%s answers at %s%% in this slot',
      upper(v_lead.values->>'state'), round(v_slot_rate * 100));
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
  if v_fields = 4 then v_reasons := v_reasons || 'complete record'::text; end if;

  -- CONSENT ARTEFACT. "Both a compliance signal and a quality one."
  select exists (select 1 from tenant_consent_artefacts ta
                  where ta.tenant_id = p_tenant_id and ta.lead_id = p_lead_id)
    into v_has_consent;
  f_consent := case when v_has_consent then 1.0 else 0.0 end;
  if v_has_consent then v_reasons := v_reasons || 'consent on file'::text; end if;

  v_score := coalesce((w->>'recency')::numeric, 0) * f_recency
           + coalesce((w->>'attempt_position')::numeric, 0) * f_attempt
           + coalesce((w->>'slot_freshness')::numeric, 0) * f_slot
           + coalesce((w->>'vendor_contact_rate')::numeric, 0) * f_vendor
           + coalesce((w->>'time_of_day_fit')::numeric, 0) * f_time
           + coalesce((w->>'completeness')::numeric, 0) * f_complete
           + coalesce((w->>'consent_artefact')::numeric, 0) * f_consent;

  return query select
    round(v_score, 3),
    v_reasons,
    jsonb_build_object(
      'recency', round(f_recency, 3),
      'attempt_position', round(f_attempt, 3),
      'slot_freshness', round(f_slot, 3),
      'vendor_contact_rate', round(f_vendor, 3),
      'time_of_day_fit', round(f_time, 3),
      'completeness', round(f_complete, 3),
      'consent_artefact', round(f_consent, 3),
      'slot', to_jsonb(v_slot),
      'attempts_made', to_jsonb(v_attempts),
      'weights', w
    );
end;
$function$;

-- ── the disposition keeps the counters current ─────────────────────────────
do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_dial_disposition';
  if v_src ~ 'bump_contact_rate_stats' then
    raise notice 'complete_dial_disposition already maintains the counters';
    return;
  end if;

  v_new := replace(
    v_src,
    E'  update agent_leads set attempts_made = coalesce(attempts_made, 0) + 1 where id = v_lead;',
    E'  perform public.bump_contact_rate_stats(p_tenant_id, ''vendor'',\n'
    || E'    (select c.vendor_id::text from public.agent_leads l2\n'
    || E'       join public.tenant_campaigns c on c.id = l2.campaign_id where l2.id = v_lead),\n'
    || E'    public.is_contact_disposition(p_disposition));\n'
    || E'  perform public.bump_contact_rate_stats(p_tenant_id, ''state_slot'',\n'
    || E'    case when v_state is null then null else upper(v_state) || '':'' || v_slot end,\n'
    || E'    public.is_contact_disposition(p_disposition));\n'
    || E'\n  update agent_leads set attempts_made = coalesce(attempts_made, 0) + 1 where id = v_lead;'
  );
  if v_new = v_src then
    raise exception 'complete_dial_disposition does not contain the expected attempt counter; the rate counters could not be placed';
  end if;
  execute v_new;
  raise notice 'complete_dial_disposition now maintains the contact-rate counters';
end $$;

do $$
declare
  v_tenant uuid; v_lead uuid; a record; b record;
begin
  select tenant_id into v_tenant from public.agent_leads group by tenant_id order by count(*) desc limit 1;
  if v_tenant is null then raise notice 'no leads; skipped'; return; end if;
  select id into v_lead from public.agent_leads where tenant_id = v_tenant limit 1;

  select * into a from public.score_lead(v_tenant, v_lead, timestamptz '2026-09-14 15:00:00+00');
  select * into b from public.score_lead(v_tenant, v_lead, timestamptz '2026-09-14 15:00:00+00');
  if a.score is distinct from b.score then
    raise exception 'score_lead is no longer deterministic';
  end if;

  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'complete_dial_disposition'
         and pg_get_functiondef(p.oid) ~ 'bump_contact_rate_stats') <> 1 then
    raise exception 'the disposition does not maintain the contact-rate counters';
  end if;

  raise notice 'LA-2.13 c5: the two scanning signals now read one indexed counter row each';
end $$;
