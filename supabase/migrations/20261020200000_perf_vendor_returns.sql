-- Performance pass (2026-10-20, SQL leftovers) · Vendor returns and the Lead lists "claimable" column.
--
-- vendor_returns_candidates_summary / vendor_return_candidates / vendor_returns_report all end in
-- vendor_claimable_leads, and all four ask tenant_calendar_zone for the agency's zone (six times for one
-- summary call). Measured on the demo tenant (LA-1.25 Alert Demo, 15,784 list leads), warm:
--   · tenant_calendar_zone checked the zone against pg_timezone_names, which reads and parses every zone
--     file on disk (1,196 of them) on every call: ~48 ms warm and 380–500 ms on a fresh connection, per
--     call. In vendor_return_candidates' plan two such lookups took 427 of 562 ms.
--   · vendor_claimable_leads' "wrong number / disconnected" arm ran a LATERAL probe of
--     tenant_call_attempts for each of the tenant's 15,784 leads (76 ms, 51k buffers) to find 968 leads.
--
-- What changes (the results are the same — see "Parity" below):
--   1. timezone_names_known(): the names pg_timezone_names listed when this file was applied, as a
--      constant, valid only while the server is the same Postgres build (server_version_num is part of the
--      check, so an upgrade empties the list and every lookup falls back to the scan until this is re-run).
--   2. tenant_calendar_zone: a zone in that list is accepted without the scan; anything else still goes
--      through pg_timezone_names exactly as before. The list is taken from pg_timezone_names itself, so a
--      name it holds is a name the scan would have found.
--   3. vendor_claimable_leads: the disposition arm starts from the tenant's wrong_number / disconnected
--      attempts (DISTINCT ON lead, newest first — the same row the LATERAL ... LIMIT 1 picked) and joins
--      the lead, instead of probing per lead. Everything else in the body is unchanged.
--   4. vendor_return_candidates gets plan_cache_mode = force_custom_plan: after five calls on one
--      connection its RETURN QUERY switched to a generic plan (~40% slower); plan choice only.
--   5. vendor_claimable_lead_counts(tenant): claimable rows per campaign. The Lead lists screen read the
--      whole vendor_returns_report (~490 KB of JSON on the demo tenant, plus a claim-name lookup) only to
--      count `claimable` rows per campaign; this is that count. The app falls back to the report while this
--      is not applied (PGRST202 / 42883).
--
-- Parity (demo tenant, rolled-back rehearsal as tenant_app with app.tenant_id + owner app.user_id): the new
-- vendor_claimable_leads, vendor_return_candidates, vendor_returns_candidates_summary and
-- vendor_returns_report give the same rows as the live definitions; vendor_claimable_lead_counts equals
-- the app's own count from the report; tenant_calendar_zone agrees for every agency_profiles.timezone value.
--
-- Rollback: re-create tenant_calendar_zone and vendor_claimable_leads from their previous definitions
-- (20260925707900 / pg_get_functiondef before this file) and
--   drop function public.vendor_claimable_lead_counts(uuid); drop function public.timezone_names_known();
--   alter function public.vendor_return_candidates(uuid, uuid) reset plan_cache_mode;

begin;

-- ─── 1. the known zone names, as a constant ─────────────────────────────────────────────────────
do $do$
declare
  v_names text[];
begin
  select array_agg(tz.name order by tz.name) into v_names from pg_catalog.pg_timezone_names tz;
  execute format($f$
    create or replace function public.timezone_names_known()
    returns text[]
    language sql
    stable
    parallel safe
    set search_path to 'pg_catalog'
    as $b$
      -- pg_timezone_names as of server build %s, empty on any other build (callers then fall back to the scan)
      select case when current_setting('server_version_num') = %L then %L::text[] else '{}'::text[] end
    $b$$f$, current_setting('server_version_num'), current_setting('server_version_num'), v_names);
end;
$do$;

revoke all on function public.timezone_names_known() from public, anon, authenticated;
grant execute on function public.timezone_names_known() to service_role, tenant_app;

-- ─── 2. tenant_calendar_zone ─────────────────────────────────────────────────────────────────────
create or replace function public.tenant_calendar_zone(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select ap.timezone
       from agency_profiles ap
      where ap.tenant_id = p_tenant_id
        and ap.timezone is not null
        -- A known name skips the scan of every zone file; anything else is checked exactly as before.
        and (ap.timezone = any (public.timezone_names_known())
             or exists (select 1 from pg_timezone_names tz where tz.name = ap.timezone))
      limit 1),
    'UTC');
$$;

-- ─── 3. vendor_claimable_leads ───────────────────────────────────────────────────────────────────
create or replace function public.vendor_claimable_leads(p_tenant_id uuid, p_campaign_id uuid default null::uuid)
returns table(lead_id uuid, campaign_id uuid, vendor_id uuid, campaign_name text, vendor_name text, lead_created_at timestamp with time zone, reason text, source_type text, source_id uuid, evidence jsonb, claimable_until timestamp with time zone, days_remaining integer, claimable boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with candidates as (
    select l.id as lead_id, l.campaign_id, c.vendor_id, c.name as campaign_name, v.name as vendor_name,
           l.created_at as lead_created_at,
            case coalesce(sr.outcome, l.screening_outcome) when 'dnc' then 'dnc' when 'tcpa_litigator' then 'tcpa_litigator' else 'invalid_phone' end as reason,
           'scrub'::text as source_type, l.screening_result_id as source_id,
           jsonb_build_object('source', 'scrub', 'lead_id', l.id, 'lead_created_at', l.created_at,
              'phone', coalesce(l.values->>'phone', l.values->>'phone_number', l.values->>'primary_phone'), 'state', l.values->>'state', 'screening_outcome', coalesce(sr.outcome, l.screening_outcome),
             'screening_result_id', l.screening_result_id, 'screening_checked_at', l.screening_checked_at,
             'screening_version', l.screening_version) as evidence,
           l.created_at + make_interval(days => v.return_window_days) as claimable_until,
           1 as priority
       from agent_leads l
       left join screening_results sr on sr.id = l.screening_result_id and sr.tenant_id = l.tenant_id
      join tenant_campaigns c on c.id = l.campaign_id and c.tenant_id = l.tenant_id
      join tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = l.tenant_id
     where l.tenant_id = p_tenant_id
       and (p_campaign_id is null or l.campaign_id = p_campaign_id)
       and coalesce(sr.outcome, l.screening_outcome) in ('dnc', 'tcpa_litigator', 'invalid_phone')
       -- A hit on the agency's OWN do-not-call list is stored as 'dnc' with no screening result
       -- (lib/compliance/screening.ts): it is the agency's decision, not the vendor's defect, and is
       -- never charged back. Only a registry hit — one with a screening result — is.
       and not (coalesce(sr.outcome, l.screening_outcome) = 'dnc' and l.screening_result_id is null)
       -- A hit found by a later re-scrub (source_key 'scrub:<run>', 20260925706100) is not the
       -- vendor's defect either: the number went onto the list after it was bought (20260925707900).
       and not exists (
         select 1 from tenant_campaign_scrub_rejections rs
          where rs.tenant_id = l.tenant_id
            and rs.campaign_id = l.campaign_id
            and rs.source_key like 'scrub:%'
            and rs.phone_digits = right(regexp_replace(coalesce(l.values->>'phone', l.values->>'phone_number', l.values->>'primary_phone', ''), '[^0-9]', '', 'g'), 10)
       )
       -- Nor a hit a nurture reactivation's re-screen stamped on the lead (lib/nurture/service.ts,
       -- complete_nurture_reactivation — 20260913450000, restated by 20260925706500). The exact link:
       -- the reactivation row records the same screening_result_id it wrote onto the lead.
       and not exists (
         select 1 from tenant_nurture_reactivations nr
          where nr.tenant_id = l.tenant_id
            and nr.lead_id = l.id
            and nr.screening_result_id = l.screening_result_id
       )
    union all
    select l.id, l.campaign_id, c.vendor_id, c.name, v.name, l.created_at,
           a.disposition, 'disposition', a.id,
           jsonb_build_object('source', 'disposition', 'lead_id', l.id, 'lead_created_at', l.created_at,
              'phone', coalesce(l.values->>'phone', l.values->>'phone_number', l.values->>'primary_phone'), 'state', l.values->>'state', 'disposition', a.disposition,
             'attempt_id', a.id, 'attempted_at', a.attempted_at, 'dial_clicked_at', a.dial_clicked_at,
             'attempt_number', a.attempt_number) as evidence,
           l.created_at + make_interval(days => v.return_window_days), 2
      -- Each lead's newest wrong-number / disconnected attempt (perf 2026-10-20: read once from the
      -- attempts, not probed once per lead).
      from (select distinct on (ta.lead_id) ta.*
              from tenant_call_attempts ta
             where ta.tenant_id = p_tenant_id
               and ta.lead_id is not null
               and ta.disposition in ('wrong_number', 'disconnected')
             order by ta.lead_id, ta.attempted_at desc, ta.id desc) a
      join agent_leads l on l.id = a.lead_id and l.tenant_id = a.tenant_id
      join tenant_campaigns c on c.id = l.campaign_id and c.tenant_id = l.tenant_id
      join tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = l.tenant_id
     where l.tenant_id = p_tenant_id
       and (p_campaign_id is null or l.campaign_id = p_campaign_id)
  ),
  one_per_lead as (
    select distinct on (lead_id) * from candidates
     where not exists (
       select 1 from lead_claim_items i join lead_claims cl on cl.id = i.claim_id
        where i.tenant_id = p_tenant_id and i.lead_id = candidates.lead_id
     )
       -- One number, one claim: not a lead whose number this campaign already claimed as an
       -- import removal (20260925703200).
       and not exists (
         select 1 from lead_claim_items ri
           join tenant_campaign_scrub_rejections r on r.id = ri.scrub_rejection_id
          where ri.tenant_id = p_tenant_id
            and r.tenant_id = p_tenant_id
            and r.campaign_id = candidates.campaign_id
            and r.phone_digits = right(regexp_replace(coalesce(candidates.evidence->>'phone', ''), '[^0-9]', '', 'g'), 10)
       )
     order by lead_id, priority, claimable_until desc
  )
  select lead_id, campaign_id, vendor_id, campaign_name, vendor_name, lead_created_at, reason,
         source_type, source_id, evidence, claimable_until,
         greatest(0, (claimable_until at time zone (select public.tenant_calendar_zone(p_tenant_id)))::date - (now() at time zone (select public.tenant_calendar_zone(p_tenant_id)))::date)::integer as days_remaining,
         claimable_until > now() as claimable
    from one_per_lead
   order by claimable_until asc, lead_created_at asc;
$function$;

-- ─── 4. vendor_return_candidates: a plan for this tenant on every call ────────────────────────────
-- A plpgsql RETURN QUERY is planned for its parameter values five times, then the backend may keep a
-- generic plan. PostgREST reuses its connections, so from the sixth call on a connection this one ran
-- ~40% slower (350 → 490 ms in the rehearsal). Plan choice only — the rows are the same. A later
-- CREATE OR REPLACE of this function without this SET clause drops it again.
alter function public.vendor_return_candidates(uuid, uuid) set plan_cache_mode = force_custom_plan;

-- ─── 5. claimable rows per campaign, for the Lead lists screen ──────────────────────────────────
create or replace function public.vendor_claimable_lead_counts(p_tenant_id uuid)
returns table (campaign_id uuid, claimable integer)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  -- lib/leadLists/service.ts counted vendor_returns_report's `claimable` list the same way.
  select k.campaign_id, count(*)::integer
    from public.vendor_claimable_leads(p_tenant_id, null) k
   where k.claimable
   group by k.campaign_id;
$$;

revoke all on function public.vendor_claimable_lead_counts(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.vendor_claimable_lead_counts(uuid) to service_role;

-- ─── self-check ──────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_bad text;
  v_tenant uuid;
  v_new bigint;
  v_ref bigint;
begin
  if not exists (select 1 from pg_proc where oid = 'public.vendor_return_candidates(uuid, uuid)'::regprocedure
                  and 'plan_cache_mode=force_custom_plan' = any (proconfig)) then
    raise exception 'perf: vendor_return_candidates is missing plan_cache_mode = force_custom_plan';
  end if;
  -- Every name in the constant is one pg_timezone_names lists (the fast path never accepts more).
  select string_agg(n, ', ') into v_bad
    from unnest(public.timezone_names_known()) n
   where not exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = n);
  if v_bad is not null then
    raise exception 'perf: timezone_names_known holds names pg_timezone_names does not: %', left(v_bad, 300);
  end if;
  if cardinality(public.timezone_names_known()) <> (select count(*) from pg_catalog.pg_timezone_names) then
    raise exception 'perf: timezone_names_known is not the whole pg_timezone_names list';
  end if;
  -- Every stored zone resolves exactly as the scan does.
  select string_agg(ap.tenant_id::text, ', ') into v_bad
    from public.agency_profiles ap
   where public.tenant_calendar_zone(ap.tenant_id)
         is distinct from coalesce(case when exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = ap.timezone) then ap.timezone end, 'UTC');
  if v_bad is not null then
    raise exception 'perf: tenant_calendar_zone differs from the scan for %', left(v_bad, 300);
  end if;
  -- The disposition arm finds the same leads the per-lead LATERAL did, for the tenant with the most.
  select a.tenant_id into v_tenant from public.tenant_call_attempts a
   where a.disposition in ('wrong_number', 'disconnected') group by a.tenant_id order by count(*) desc limit 1;
  if v_tenant is not null then
    select count(*) into v_ref
      from public.agent_leads l
      join public.tenant_campaigns c on c.id = l.campaign_id and c.tenant_id = l.tenant_id
      join public.tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = l.tenant_id
     where l.tenant_id = v_tenant
       and exists (select 1 from public.tenant_call_attempts a
                    where a.tenant_id = l.tenant_id and a.lead_id = l.id and a.disposition in ('wrong_number', 'disconnected'));
    select count(*) into v_new
      from (select distinct on (ta.lead_id) ta.lead_id, ta.tenant_id from public.tenant_call_attempts ta
             where ta.tenant_id = v_tenant and ta.lead_id is not null and ta.disposition in ('wrong_number', 'disconnected')
             order by ta.lead_id, ta.attempted_at desc, ta.id desc) a
      join public.agent_leads l on l.id = a.lead_id and l.tenant_id = a.tenant_id
      join public.tenant_campaigns c on c.id = l.campaign_id and c.tenant_id = l.tenant_id
      join public.tenant_lead_vendors v on v.id = c.vendor_id and v.tenant_id = l.tenant_id;
    if v_new <> v_ref then
      raise exception 'perf: disposition arm found % leads, the per-lead check %', v_new, v_ref;
    end if;
    select coalesce(sum(k.claimable), 0) into v_new from public.vendor_claimable_lead_counts(v_tenant) k;
    select count(*) into v_ref from public.vendor_claimable_leads(v_tenant, null) k where k.claimable;
    if v_new <> v_ref then
      raise exception 'perf: vendor_claimable_lead_counts gave %, vendor_claimable_leads %', v_new, v_ref;
    end if;
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
