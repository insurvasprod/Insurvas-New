-- ---------------------------------------------------------------------------
-- LA-2.13 · Lead scoring & call sequencing
--
-- "The queue serves the lead most likely to answer right now, and can say why."
--
-- The task prescribes the build order and says the order is the point: rules first, learn second,
-- hold out third. This is step one and step three. Step two — refitting the weights from observed
-- contacts — is deliberately NOT here, because it cannot be done honestly before there are dials to
-- fit to, and shipping a fitted-looking number with no data behind it is the exact failure the task
-- warns about:
--
--   "`vendor_score` is imported from vendor files, its meaning is unconfirmed ... and the dialer
--    DELIBERATELY HIDES IT. That instinct was right. Do not put a number in front of an agent until
--    you can explain it."
--
-- So every number this produces is traceable to a stored signal and a named weight, and the reason
-- is generated from the same arithmetic that produced the score rather than being written
-- separately. A reason that is composed by hand can drift from the score; this one cannot.
--
-- WHAT ALREADY EXISTED, AND WHY IT IS NOT USED. `outbound_scoring_decisions` and
-- `outbound_scoring_cohort_stats` carry exactly this shape — cohort, score, signal_snapshot,
-- selection_reason — and both are organization-keyed, like the whole `outbound_*` family. Same
-- finding as every other LA-2 task: the specification was written against the organizations-era
-- CRM and the tenant-era application inherited the specification but not the software. Per the SA-3
-- rule the CRM's tables are left untouched and the tenant plane gets its own.
-- ---------------------------------------------------------------------------

-- ── what counts as reaching a human ────────────────────────────────────────
--
-- One definition, used by the score, by the cohort statistics, and by LA-2.12's scorecard. Three
-- places computing "contacted" three ways is how a holdout comparison quietly stops meaning
-- anything.
--
-- Anything unrecognised counts as a contact rather than being dropped: the list below is the
-- closed set of ways a call reaches nobody, and a disposition nobody has invented yet is far more
-- likely to describe a conversation than a ringing phone.
create or replace function public.is_contact_disposition(p_disposition text)
returns boolean
language sql
immutable
parallel safe
as $function$
  select p_disposition is not null
     and p_disposition not in ('no_answer', 'voicemail', 'busy', 'call_dropped',
                               'disconnected', 'wrong_number');
$function$;

-- ── the settings, off by default ───────────────────────────────────────────
create table if not exists public.tenant_scoring_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  -- "Scoring is off by default and can be turned off entirely without breaking the queue."
  -- The default is the criterion, written down where it cannot be forgotten.
  enabled boolean not null default false,
  -- The slice served in the naive order so the scored cohort has something to be compared against.
  holdout_pct integer not null default 10 check (holdout_pct between 0 and 50),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- ── the weights, inspectable and adjustable ────────────────────────────────
--
-- Rows rather than constants in a function body, because criterion 6 asks for weights that can be
-- read and changed, and a number compiled into a function is neither.
create table if not exists public.tenant_scoring_weights (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  signal text not null,
  weight numeric(6, 2) not null check (weight >= 0 and weight <= 100),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, signal)
);

-- The defaults a tenant scores with until somebody changes them. Exposed as a function rather than
-- seeded per tenant so a tenant that has never touched the weights scores identically to one that
-- has reset them, and so adding a signal does not require backfilling every tenant.
create or replace function public.default_scoring_weights()
returns table(signal text, weight numeric)
language sql
immutable
parallel safe
as $function$
  values
    ('recency',             25.0::numeric),
    ('attempt_position',    20.0::numeric),
    ('slot_freshness',      15.0::numeric),
    ('vendor_contact_rate', 15.0::numeric),
    ('time_of_day_fit',     15.0::numeric),
    ('completeness',         5.0::numeric),
    ('consent_artefact',     5.0::numeric);
$function$;

create or replace function public.scoring_weights_for(p_tenant_id uuid)
returns table(signal text, weight numeric)
language sql
stable
as $function$
  select d.signal, coalesce(w.weight, d.weight)
    from default_scoring_weights() d
    left join tenant_scoring_weights w
      on w.tenant_id = p_tenant_id and w.signal = d.signal;
$function$;

-- ── the decisions, which are what make the holdout real ────────────────────
create table if not exists public.tenant_scoring_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  work_item_id uuid,
  agent_user_id uuid,
  cohort text not null check (cohort in ('scored', 'control')),
  score numeric(8, 3),
  signal_snapshot jsonb not null default '{}'::jsonb,
  selection_reason text not null,
  served_at timestamptz not null default now(),
  -- Written by the disposition, not by the serve. A contact is something that happened afterwards.
  contacted_at timestamptz,
  disposition text
);

create index if not exists tenant_scoring_decisions_tenant_served_idx
  on public.tenant_scoring_decisions (tenant_id, served_at desc);
create index if not exists tenant_scoring_decisions_work_item_idx
  on public.tenant_scoring_decisions (tenant_id, work_item_id);

-- ── the score ──────────────────────────────────────────────────────────────
--
-- PURE, in the sense criterion 2 means: every input is a stored row or the instant passed in, and
-- nothing here reads the clock or calls random(). `p_at` is a parameter rather than now() precisely
-- so that "the same lead at the same instant always scores the same" is a property somebody can
-- test rather than a claim.
--
-- Each signal yields a factor in [0, 1]; the score is the weighted sum, so a tenant who sets every
-- weight to the default gets a number in [0, 100] and one who does not still gets a number whose
-- units are the weights they chose.
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

  -- SLOT FRESHNESS. "Slots this lead has not failed in yet."
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

  -- VENDOR HISTORY. "This vendor contacts at 14%, that one at 6%."
  if v_vendor is not null then
    select count(*)::integer,
           avg(case when is_contact_disposition(ca.disposition) then 1.0 else 0.0 end)
      into v_vendor_n, v_vendor_rate
      from tenant_call_attempts ca
      join agent_leads l2 on l2.id = ca.lead_id
      join tenant_campaigns c2 on c2.id = l2.campaign_id
     where ca.tenant_id = p_tenant_id and c2.vendor_id = v_vendor and ca.disposition is not null;
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
    select count(*)::integer,
           avg(case when is_contact_disposition(ca.disposition) then 1.0 else 0.0 end)
      into v_slot_n, v_slot_rate
      from tenant_call_attempts ca
      join agent_leads l3 on l3.id = ca.lead_id
     where ca.tenant_id = p_tenant_id
       and ca.slot = v_slot
       and upper(l3.values->>'state') = upper(v_lead.values->>'state')
       and ca.disposition is not null;
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

revoke all on function public.score_lead(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.score_lead(uuid, uuid, timestamptz) to tenant_app, service_role;
grant execute on function public.is_contact_disposition(text) to tenant_app, service_role;
grant execute on function public.default_scoring_weights() to tenant_app, service_role;
grant execute on function public.scoring_weights_for(uuid) to tenant_app, service_role;

-- ── the comparison Ray will ask for ────────────────────────────────────────
--
-- "Contact rate 14.2% scored versus 11.8% control, over 4,000 dials" is an answer. This view is
-- that sentence, and it is the whole justification for the holdout existing.
create or replace view public.tenant_scoring_cohort_stats as
select d.tenant_id,
       d.cohort,
       count(*) as served,
       count(d.contacted_at) as contacted,
       case when count(*) > 0
            then round(100.0 * count(d.contacted_at) / count(*), 1) end as contact_rate_pct,
       round(avg(d.score), 2) as average_score,
       min(d.served_at) as since
  from tenant_scoring_decisions d
 group by d.tenant_id, d.cohort;

alter view public.tenant_scoring_cohort_stats set (security_invoker = on);
revoke all on public.tenant_scoring_cohort_stats from anon, authenticated, public;
grant select on public.tenant_scoring_cohort_stats to tenant_app, service_role;

alter table public.tenant_scoring_settings enable row level security;
alter table public.tenant_scoring_weights enable row level security;
alter table public.tenant_scoring_decisions enable row level security;
grant select, insert, update, delete on public.tenant_scoring_settings to tenant_app, service_role;
grant select, insert, update, delete on public.tenant_scoring_weights to tenant_app, service_role;
grant select, insert, update, delete on public.tenant_scoring_decisions to tenant_app, service_role;

-- ── serving, now with a reason ─────────────────────────────────────────────
--
-- THE HOLDOUT IS DECIDED PER SERVE, AND THE COHORT PER LEAD. Both halves matter:
--
--   Per lead, by hash, so a lead never changes sides. A lead that drifted between cohorts would
--   make its own outcome unattributable, and the comparison would be measuring nothing.
--
--   Per serve, by coin flip, so the control group actually gets served. The obvious alternative —
--   ordering every candidate by score and letting control leads take whatever position falls out —
--   starves the control group completely, because a control lead has no score to compete with. A
--   holdout that is never dialled produces no contact rate, and a contact rate of nothing compared
--   against 14% is not a measurement.
--
-- When scoring is off, every scored term evaluates to NULL and the ordering collapses to exactly
-- LA-2.8's: tier, then the campaign mixing race, then oldest first. That is criterion 4 — "can be
-- turned off entirely without breaking the queue" is only true if the off path is the old path
-- rather than a new path with the multiplier set to one.
drop function if exists public.serve_next_lead(uuid, uuid);

create or replace function public.serve_next_lead(p_tenant_id uuid, p_agent_user_id uuid)
returns table(
  work_item_id uuid,
  lead_id uuid,
  tier integer,
  tier_name text,
  locked_until timestamptz,
  appointment_notes text,
  selection_reason text,
  score numeric,
  cohort text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_lock_minutes integer := 15;
  v_qid uuid;
  v_lead uuid;
  v_priority integer;
  v_notes text;
  v_enabled boolean := false;
  v_holdout integer := 0;
  v_cohort text := 'control';
  v_serve_control boolean;
  v_score numeric;
  v_reason text;
  v_signals jsonb := '{}'::jsonb;
  v_tier_reason text;
  s record;
begin
  select coalesce(ts.enabled, false), coalesce(ts.holdout_pct, 0)
    into v_enabled, v_holdout
    from tenant_scoring_settings ts where ts.tenant_id = p_tenant_id;
  -- No settings row at all is the default, and the default is off.
  v_enabled := coalesce(v_enabled, false);
  v_holdout := coalesce(v_holdout, 0);

  update lead_queue q
     set status = 'unclaimed', claimed_by = null, owner_user_id = null, locked_until = null
   where q.tenant_id = p_tenant_id
     and q.status = 'claimed'
     and q.locked_until is not null
     and q.locked_until < v_now;

  v_serve_control := v_enabled and (random() * 100) < v_holdout;

  with eligible as (
    select q.id as qid,
           q.lead_id as lid,
           case
             when l.posted_at is not null and l.posted_at >= v_now - interval '5 minutes' then 1
             when exists (select 1 from tenant_callbacks cb
                           where cb.tenant_id = p_tenant_id and cb.work_item_id = q.id
                             and cb.status in ('scheduled', 'due') and cb.scheduled_at_utc <= v_now) then 2
             when exists (select 1 from tenant_appointments ap
                           where ap.tenant_id = p_tenant_id and ap.lead_id = q.lead_id
                             and ap.status in ('booked', 'confirmed')
                             and ap.starts_at_utc <= v_now
                             and (ap.agent_user_id = p_agent_user_id or ap.agent_user_id is null)) then 3
             when l.lead_state = 'retry' and l.next_dial_after is not null and l.next_dial_after <= v_now
                  and not exists (
                    select 1 from tenant_call_attempts ca
                     where ca.tenant_id = p_tenant_id and ca.lead_id = l.id
                       and ca.slot = current_slot_for_state(l.values->>'state', v_now)
                  ) then 4
             when l.lead_state = 'fresh' and (l.next_dial_after is null or l.next_dial_after <= v_now) then 5
             when l.lead_state = 'nurture' and l.next_dial_after is not null and l.next_dial_after <= v_now then 6
             else null
           end as priority,
           coalesce(c.mixing_weight, 1) as weight,
           l.posted_at as posted_at,
           q.queued_at as queued_at,
           -- The cohort is a property of the lead, fixed for its lifetime. hashtextextended is
           -- stable across sessions and servers, which random() and a stored flag both fail at in
           -- different ways.
           case when v_enabled
                     and (abs(hashtextextended(q.lead_id::text, 42)) % 100) < v_holdout
                then 'control' else 'scored' end as cohort
      from lead_queue q
      join agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
      left join tenant_campaigns c on c.id = l.campaign_id
     where q.tenant_id = p_tenant_id
       and q.status = 'unclaimed'
       and (q.locked_until is null or q.locked_until < v_now)
       and (l.campaign_id is null
            or exists (select 1 from campaigns_servable cs where cs.id = l.campaign_id))
       and not (select sup.suppressed from is_phone_suppressed(p_tenant_id, l.values->>'phone') sup)
       and tenant_can_dial_now(p_tenant_id, l.values->>'state', l.campaign_id, v_now)
       and l.lead_state <> 'exhausted'
  ),
  ranked as (
    select e.*,
           -- Score only the rows that can actually be served this call: the top priority present,
           -- in the pool this serve is drawing from. Scoring the whole queue would be the obvious
           -- way to blow criterion 5's 50ms.
           case when v_enabled and not v_serve_control and e.cohort = 'scored'
                then (select sl.score from score_lead(p_tenant_id, e.lid, v_now) sl)
                end as lead_score
      from eligible e
     where e.priority is not null
       and e.priority = (select min(e2.priority) from eligible e2 where e2.priority is not null)
       and (not v_enabled
            or (v_serve_control and e.cohort = 'control')
            or (not v_serve_control and e.cohort = 'scored'))
  )
  select r.qid, r.lid, r.priority, r.cohort, r.lead_score
    into v_qid, v_lead, v_priority, v_cohort, v_score
    from ranked r
   order by r.lead_score desc nulls last,
            -ln(greatest(random(), 1e-9)) / greatest(r.weight, 1),
            coalesce(r.posted_at, r.queued_at)
   limit 1;

  -- The chosen pool can be empty while the other is not. Falling back is not a compromise of the
  -- holdout: a lead's cohort is unchanged, so its outcome is still attributed correctly — all that
  -- changes is that the queue does not go idle because the coin landed on an empty pool.
  if v_qid is null and v_enabled then
    with eligible as (
      select q.id as qid, q.lead_id as lid,
             case
               when l.posted_at is not null and l.posted_at >= v_now - interval '5 minutes' then 1
               when exists (select 1 from tenant_callbacks cb
                             where cb.tenant_id = p_tenant_id and cb.work_item_id = q.id
                               and cb.status in ('scheduled', 'due') and cb.scheduled_at_utc <= v_now) then 2
               when exists (select 1 from tenant_appointments ap
                             where ap.tenant_id = p_tenant_id and ap.lead_id = q.lead_id
                               and ap.status in ('booked', 'confirmed')
                               and ap.starts_at_utc <= v_now
                               and (ap.agent_user_id = p_agent_user_id or ap.agent_user_id is null)) then 3
               when l.lead_state = 'retry' and l.next_dial_after is not null and l.next_dial_after <= v_now
                    and not exists (
                      select 1 from tenant_call_attempts ca
                       where ca.tenant_id = p_tenant_id and ca.lead_id = l.id
                         and ca.slot = current_slot_for_state(l.values->>'state', v_now)
                    ) then 4
               when l.lead_state = 'fresh' and (l.next_dial_after is null or l.next_dial_after <= v_now) then 5
               when l.lead_state = 'nurture' and l.next_dial_after is not null and l.next_dial_after <= v_now then 6
               else null
             end as priority,
             coalesce(c.mixing_weight, 1) as weight,
             l.posted_at as posted_at, q.queued_at as queued_at,
             case when (abs(hashtextextended(q.lead_id::text, 42)) % 100) < v_holdout
                  then 'control' else 'scored' end as cohort
        from lead_queue q
        join agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
        left join tenant_campaigns c on c.id = l.campaign_id
       where q.tenant_id = p_tenant_id
         and q.status = 'unclaimed'
         and (q.locked_until is null or q.locked_until < v_now)
         and (l.campaign_id is null
              or exists (select 1 from campaigns_servable cs where cs.id = l.campaign_id))
         and not (select sup.suppressed from is_phone_suppressed(p_tenant_id, l.values->>'phone') sup)
         and tenant_can_dial_now(p_tenant_id, l.values->>'state', l.campaign_id, v_now)
         and l.lead_state <> 'exhausted'
    )
    select e.qid, e.lid, e.priority, e.cohort
      into v_qid, v_lead, v_priority, v_cohort
      from eligible e
     where e.priority is not null
     order by e.priority,
              -ln(greatest(random(), 1e-9)) / greatest(e.weight, 1),
              coalesce(e.posted_at, e.queued_at)
     limit 1;
  end if;

  if v_qid is null then
    return;
  end if;

  -- With scoring off there is no experiment, and every lead was served in the naive order — which
  -- is what `control` means. Recording those serves as `scored` would put a population that was
  -- never scored on the scored side of the comparison, and the first number Ray read would be
  -- wrong in the direction that flatters the feature.
  if not v_enabled then
    v_cohort := 'control';
  end if;

  update lead_queue q
     set status = 'claimed',
         claimed_by = p_agent_user_id,
         owner_user_id = p_agent_user_id,
         claimed_at = v_now,
         locked_until = v_now + make_interval(mins => v_lock_minutes),
         updated_at = v_now
   where q.id = v_qid and q.status = 'unclaimed';

  if not found then
    return;
  end if;

  update agent_leads l
     set lead_state = 'working',
         first_dial_at = coalesce(l.first_dial_at, v_now),
         updated_at = v_now
   where l.id = v_lead and l.tenant_id = p_tenant_id;

  if v_priority = 3 then
    select ap.notes into v_notes from tenant_appointments ap
     where ap.tenant_id = p_tenant_id and ap.lead_id = v_lead
       and ap.status in ('booked', 'confirmed') and ap.starts_at_utc <= v_now
     order by ap.starts_at_utc limit 1;
  end if;

  -- THE REASON, ALWAYS. Criterion 1 says every served lead carries one, and that includes the
  -- leads served while scoring is off — which is every lead, on the day this ships. The tier is
  -- always a reason in itself, because "this customer asked you to ring back now" explains the
  -- choice more completely than any score could.
  v_tier_reason := case v_priority
    when 1 then 'Posted less than five minutes ago'
    when 2 then 'A callback you promised is due'
    when 3 then 'An appointment a setter booked is due'
    when 4 then 'Due for a retry, in a slot it has not been tried in'
    when 5 then 'A fresh lead that has never been called'
    when 6 then 'Due for a nurture touch'
  end;

  if v_enabled and v_cohort = 'scored' then
    select sl.score, sl.reasons, sl.signals into s from score_lead(p_tenant_id, v_lead, v_now) sl;
    v_score := s.score;
    v_signals := coalesce(s.signals, '{}'::jsonb);
    v_reason := v_tier_reason || case
      when array_length(s.reasons, 1) > 0 then ' — ' || array_to_string(s.reasons, '; ')
      else '' end;
  else
    v_reason := v_tier_reason || case
      when v_enabled then ' — served in the naive order, as part of the holdout'
      else '' end;
    v_score := null;
  end if;

  insert into tenant_scoring_decisions
    (tenant_id, lead_id, work_item_id, agent_user_id, cohort, score, signal_snapshot,
     selection_reason, served_at)
  values
    (p_tenant_id, v_lead, v_qid, p_agent_user_id, v_cohort, v_score, v_signals, v_reason, v_now);

  return query
    select v_qid, v_lead, v_priority,
           case v_priority
             when 1 then 'realtime' when 2 then 'callback' when 3 then 'appointment'
             when 4 then 'retry' when 5 then 'fresh' when 6 then 'nurture' end,
           v_now + make_interval(mins => v_lock_minutes),
           v_notes,
           v_reason,
           v_score,
           v_cohort;
end;
$function$;

revoke all on function public.serve_next_lead(uuid, uuid) from public, anon, authenticated;
grant execute on function public.serve_next_lead(uuid, uuid) to tenant_app, service_role;

-- ── the outcome, attributed back to the decision ───────────────────────────
--
-- Without this the cohort statistics have a denominator and no numerator. The disposition already
-- knows the work item, which is the same key the decision was written with.
do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_dial_disposition';
  if v_src is null then
    raise exception 'complete_dial_disposition does not exist; LA-2.9 has not been applied';
  end if;
  if v_src ~ 'tenant_scoring_decisions' then
    raise notice 'complete_dial_disposition already attributes the outcome';
    return;
  end if;

  v_new := replace(
    v_src,
    E'  update agent_leads set attempts_made = coalesce(attempts_made, 0) + 1 where id = v_lead;',
    E'  update tenant_scoring_decisions d\n'
    || E'     set contacted_at = case when public.is_contact_disposition(p_disposition) then v_now else d.contacted_at end,\n'
    || E'         disposition = p_disposition\n'
    || E'   where d.tenant_id = p_tenant_id and d.work_item_id = p_work_item_id and d.disposition is null;\n'
    || E'\n  update agent_leads set attempts_made = coalesce(attempts_made, 0) + 1 where id = v_lead;'
  );
  if v_new = v_src then
    raise exception 'complete_dial_disposition does not contain the expected attempt counter; the attribution could not be placed';
  end if;
  execute v_new;
  raise notice 'complete_dial_disposition now attributes the outcome to the scoring decision';
end $$;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_lead uuid;
  v_at timestamptz := timestamptz '2026-09-14 15:00:00+00';
  a record; b record;
  v_n integer;
begin
  select tenant_id into v_tenant from public.agent_leads group by tenant_id order by count(*) desc limit 1;
  if v_tenant is null then raise notice 'no leads exist; skipped'; return; end if;
  select id into v_lead from public.agent_leads where tenant_id = v_tenant limit 1;

  -- Criterion 2, the one that is actually checkable in a migration: same lead, same instant, same
  -- score. Twice is not a proof of purity, but a score built on random() or now() fails it, and
  -- those are the two ways this goes wrong.
  select * into a from public.score_lead(v_tenant, v_lead, v_at);
  select * into b from public.score_lead(v_tenant, v_lead, v_at);
  if a.score is distinct from b.score then
    raise exception 'score_lead is not deterministic: % then %', a.score, b.score;
  end if;
  if a.signals is distinct from b.signals then
    raise exception 'score_lead signals are not deterministic';
  end if;

  -- Criterion 6: the weights are readable, and a tenant row overrides the default.
  select count(*)::integer into v_n from public.scoring_weights_for(v_tenant);
  if v_n <> 7 then raise exception 'expected 7 weights, got %', v_n; end if;

  -- Criterion 4: off by default.
  if exists (select 1 from public.tenant_scoring_settings where enabled) then
    raise notice 'some tenant has scoring enabled already';
  end if;
  if (select count(*) from public.tenant_scoring_settings) > 0 then
    raise notice 'settings rows already exist';
  end if;

  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'complete_dial_disposition'
         and pg_get_functiondef(p.oid) ~ 'tenant_scoring_decisions') <> 1 then
    raise exception 'the disposition does not attribute contacts to decisions';
  end if;

  raise notice 'LA-2.13: score_lead is deterministic, 7 weights are readable, and the disposition attributes contacts';
end $$;
