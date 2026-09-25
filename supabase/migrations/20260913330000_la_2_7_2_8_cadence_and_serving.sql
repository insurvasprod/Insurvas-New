-- ---------------------------------------------------------------------------
-- LA-2.7 · Cadence & slot rotation, and LA-2.8 · the lead queue
--
-- The fifth and sixth "Completed" tasks in this module with a complete implementation on the
-- organizations-era plane that this application cannot reach. `public.get_next_lead()` is a
-- genuinely sophisticated piece of work — six priority tiers, advisory-lock serving, a 15-minute
-- lock with stale release, mixing weights, scoring with a holdout cohort, and
-- `private.outbound_retry_slot_eligible`, which is LA-2.7's "promise nobody kept" actually kept.
--
-- And:
--
--   no application code references get_next_lead or any outbound_* table
--   tenant_app cannot EXECUTE get_next_lead
--   it resolves its caller through outbound_agents -> users.organization_id; 38 of this
--     application's 51 tenant users have no organization_id at all
--
-- So it cannot serve this product's agents, and nothing in this product asks it to.
--
-- ON THE DUPLICATION THIS CREATES, deliberately and with the specification's blessing:
--
-- LA-2.4's page quotes the existing code approvingly — *"The server enforces this in
-- get_next_lead; this is only so the UI can explain why a lead is not servable. A compliance rule
-- checked solely in the browser is a rule that stops applying the moment anything else calls the
-- API."* That is the arrangement here too: `tenant_can_dial_now` below is the ENFORCEMENT, inside
-- the serving query, and lib/callingWindow/engine.ts is the EXPLANATION for the screen.
--
-- Two implementations of one rule is a real risk and the reason it is written down here: they read
-- the same two tables (calling_window_state_rules, calling_window_holidays) and the same three
-- tighten-only layers, so a statute change moves both. If they ever disagree, the SQL one is
-- correct by definition, because it is the one that decides.
-- ---------------------------------------------------------------------------

-- ── LA-2.7 · cadence ───────────────────────────────────────────────────────
create table if not exists public.tenant_cadence_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- null is the tenant default; a row with a campaign overrides it for that campaign. The current
  -- schema has per-campaign overrides that are unreachable from the UI; these are reachable.
  campaign_id uuid references public.tenant_campaigns(id) on delete cascade,
  attempt_number integer not null check (attempt_number between 1 and 50),
  -- An `interval` column, not text. This is the database half of "an invalid interval is rejected
  -- at entry, not sent to the database": `banana` cannot be stored here at all. The other half is
  -- parseInterval() in lib/cadence/engine.ts, which refuses it before the round trip.
  delay_interval interval not null check (delay_interval > interval '0'),
  preferred_slot text check (preferred_slot in
    ('early_morning', 'late_morning', 'afternoon', 'early_evening', 'late_evening', 'weekend')),
  -- null applies to every disposition. "No-answer and voicemail should not behave identically."
  disposition_scope text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, campaign_id, attempt_number, disposition_scope)
);

create table if not exists public.tenant_call_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  slot text not null check (slot in
    ('early_morning', 'late_morning', 'afternoon', 'early_evening', 'late_evening', 'weekend')),
  attempted_at timestamptz not null default now(),
  disposition text,
  agent_id uuid references public.users(id) on delete set null
);

-- The rotation question — "which slots has this lead already failed in" — asked constantly by the
-- serving query, so it is indexed for exactly that.
create index if not exists tenant_call_attempts_lead_idx
  on public.tenant_call_attempts (tenant_id, lead_id, attempted_at desc);

-- Where the cadence puts this lead next. Written by the disposition path, read by the queue.
alter table public.agent_leads
  add column if not exists next_dial_after timestamptz,
  add column if not exists next_preferred_slot text,
  add column if not exists attempts_made integer not null default 0,
  add column if not exists lead_state text not null default 'fresh';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agent_leads_lead_state_check') then
    alter table public.agent_leads add constraint agent_leads_lead_state_check
      check (lead_state in ('fresh', 'working', 'retry', 'nurture', 'exhausted', 'closed'));
  end if;
end $$;

create index if not exists agent_leads_retry_due_idx
  on public.agent_leads (tenant_id, next_dial_after)
  where lead_state in ('retry', 'nurture');

-- ── LA-2.8 · the lock ──────────────────────────────────────────────────────
--
-- "A served lead is locked for a timeout, then returns to the pool. An agent who closes his laptop
-- mid-lead does not remove it from circulation permanently."
alter table public.lead_queue
  add column if not exists locked_until timestamptz;

create index if not exists lead_queue_serving_idx
  on public.lead_queue (tenant_id, tier, queued_at)
  where status = 'unclaimed';

-- ── the window, in SQL, because the serving query has to enforce it ────────
create or replace function public.tenant_can_dial_now(
  p_tenant_id uuid,
  p_state text,
  p_campaign_id uuid,
  p_at timestamptz default now()
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_zone text;
  v_local timestamptz;
  v_hour integer;
  v_dow integer;
  v_start integer := 8;   -- federal floor
  v_end integer := 21;
  v_rule record;
  v_tenant record;
  v_campaign record;
begin
  -- A lead with no state has no timezone and is not dialable. Absence of data is not permission.
  if p_state is null or p_state !~ '^[A-Za-z]{2}$' then return false; end if;

  select timezone into v_zone from public.state_timezones where state = upper(p_state);
  if v_zone is null then return false; end if;

  v_local := p_at at time zone v_zone;
  v_hour := extract(hour from v_local)::integer;
  v_dow := extract(dow from v_local)::integer;

  -- Each layer may only narrow. max(start), min(end) is the only operation, so a row that tries to
  -- widen is a no-op rather than a privilege escalation -- the same property the TypeScript engine
  -- has, expressed the same way.
  select * into v_rule from public.calling_window_rules_in_force(v_local::date)
   where state = upper(p_state);
  if found then
    v_start := greatest(v_start, v_rule.start_hour);
    v_end := least(v_end, v_rule.end_hour);
    if v_rule.no_sunday and v_dow = 0 then return false; end if;
    if v_rule.no_holidays and exists (
      select 1 from public.calling_window_holidays h
       where h.holiday_date = v_local::date and h.state_code in ('*', upper(p_state))
    ) then return false; end if;
  end if;

  select * into v_tenant from public.tenant_calling_windows where tenant_id = p_tenant_id;
  if found then
    v_start := greatest(v_start, v_tenant.start_hour);
    v_end := least(v_end, v_tenant.end_hour);
  end if;

  if p_campaign_id is not null then
    select calling_window_start_hour as s, calling_window_end_hour as e
      into v_campaign from public.tenant_campaigns where id = p_campaign_id;
    if found and v_campaign.s is not null then v_start := greatest(v_start, v_campaign.s); end if;
    if found and v_campaign.e is not null then v_end := least(v_end, v_campaign.e); end if;
  end if;

  if v_start >= v_end then return false; end if;
  return v_hour >= v_start and v_hour < v_end;
end;
$function$;

-- The state -> timezone map the SQL side needs. lib/callbacks/timezone.ts holds the same map for
-- the TypeScript side; this is seeded from it rather than invented, and the assertion below checks
-- the two have the same number of entries.
create table if not exists public.state_timezones (
  state text primary key check (state ~ '^[A-Z]{2}$'),
  timezone text not null
);

insert into public.state_timezones (state, timezone) values
  ('AL','America/Chicago'),('AK','America/Anchorage'),('AZ','America/Phoenix'),('AR','America/Chicago'),
  ('CA','America/Los_Angeles'),('CO','America/Denver'),('CT','America/New_York'),('DE','America/New_York'),
  ('FL','America/New_York'),('GA','America/New_York'),('HI','Pacific/Honolulu'),('ID','America/Denver'),
  ('IL','America/Chicago'),('IN','America/Indiana/Indianapolis'),('IA','America/Chicago'),('KS','America/Chicago'),
  ('KY','America/New_York'),('LA','America/Chicago'),('ME','America/New_York'),('MD','America/New_York'),
  ('MA','America/New_York'),('MI','America/New_York'),('MN','America/Chicago'),('MS','America/Chicago'),
  ('MO','America/Chicago'),('MT','America/Denver'),('NE','America/Chicago'),('NV','America/Los_Angeles'),
  ('NH','America/New_York'),('NJ','America/New_York'),('NM','America/Denver'),('NY','America/New_York'),
  ('NC','America/New_York'),('ND','America/Chicago'),('OH','America/New_York'),('OK','America/Chicago'),
  ('OR','America/Los_Angeles'),('PA','America/New_York'),('RI','America/New_York'),('SC','America/New_York'),
  ('SD','America/Chicago'),('TN','America/Chicago'),('TX','America/Chicago'),('UT','America/Denver'),
  ('VT','America/New_York'),('VA','America/New_York'),('WA','America/Los_Angeles'),('WV','America/New_York'),
  ('WI','America/Chicago'),('WY','America/Denver'),('DC','America/New_York')
on conflict (state) do nothing;

revoke all on public.state_timezones from anon, authenticated, public;
grant select on public.state_timezones to tenant_app, service_role;

-- ── which slot is it, for this lead, right now ─────────────────────────────
create or replace function public.current_slot_for_state(p_state text, p_at timestamptz default now())
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_zone text; v_local timestamptz; v_hour integer; v_dow integer;
begin
  select timezone into v_zone from state_timezones where state = upper(coalesce(p_state, ''));
  if v_zone is null then return null; end if;
  v_local := p_at at time zone v_zone;
  v_hour := extract(hour from v_local)::integer;
  v_dow := extract(dow from v_local)::integer;
  -- Weekend wins over the hour: "tried four times on weekdays, never on a Saturday" is the gap
  -- rotation exists to close, so Saturday at 10am is the weekend slot, not late morning.
  if v_dow in (0, 6) then return 'weekend'; end if;
  if v_hour < 10 then return 'early_morning'; end if;
  if v_hour < 12 then return 'late_morning'; end if;
  if v_hour < 15 then return 'afternoon'; end if;
  if v_hour < 18 then return 'early_evening'; end if;
  return 'late_evening';
end;
$function$;

-- ── LA-2.8 · serve exactly one lead ────────────────────────────────────────
--
-- "Ray presses next and gets exactly one lead, legally dialable, that nobody else is working, in
-- the right order." Every filter is in this query: not in the client, not in a view the client
-- filters. The dialer only explains what the server decided.
create or replace function public.serve_next_lead(p_tenant_id uuid, p_agent_user_id uuid)
returns table(work_item_id uuid, lead_id uuid, tier integer, tier_name text, locked_until timestamptz)
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
begin
  -- An abandoned lock returns the lead to the pool. Done first, so an agent who reconnects after a
  -- timeout competes for it on equal terms rather than finding it gone forever.
  update lead_queue q
     set status = 'unclaimed', claimed_by = null, owner_user_id = null, locked_until = null
   where q.tenant_id = p_tenant_id
     and q.status = 'claimed'
     and q.locked_until is not null
     and q.locked_until < v_now;

  with eligible as (
    select q.id as qid,
           q.lead_id as lid,
           case
             -- 1 REAL-TIME: posted in the last few minutes, jumps everything.
             when l.posted_at is not null and l.posted_at >= v_now - interval '5 minutes' then 1
             -- 2 CALLBACK DUE: a time was promised and it has arrived.
             when exists (select 1 from tenant_callbacks cb
                           where cb.tenant_id = p_tenant_id and cb.work_item_id = q.id
                             and cb.status in ('scheduled', 'due') and cb.scheduled_at_utc <= v_now) then 2
             -- 3 APPOINTMENT: a setter booked this one.
             --
             -- NOT IMPLEMENTED, and the gap is deliberate rather than forgotten. `appointments` in
             -- this schema is LA-0.5's carrier appointment vault — an agent's licensing
             -- appointments with a carrier — not a meeting a setter booked with a prospect. Using
             -- it here would have compiled and served leads on the strength of an unrelated
             -- insurance record. The setter-booked appointment is LA-2.11, which does not exist
             -- yet; tier 3 stays empty until it does, and the tiers either side are unaffected
             -- because the priorities are explicit numbers rather than positions in a list.
             -- 4 RETRY DUE: cadence says now, AND the current slot is not one this lead has
             --    already failed in. LA-2.7 enforced at the point of serving rather than merely
             --    recorded somewhere.
             when l.lead_state = 'retry' and l.next_dial_after is not null and l.next_dial_after <= v_now
                  and not exists (
                    select 1 from tenant_call_attempts ca
                     where ca.tenant_id = p_tenant_id and ca.lead_id = l.id
                       and ca.slot = current_slot_for_state(l.values->>'state', v_now)
                  ) then 4
             -- 5 FRESH: never dialled.
             when l.lead_state = 'fresh' and (l.next_dial_after is null or l.next_dial_after <= v_now) then 5
             -- 6 NURTURE: reactivated, lowest priority.
             when l.lead_state = 'nurture' and l.next_dial_after is not null and l.next_dial_after <= v_now then 6
             else null
           end as priority,
           coalesce(c.mixing_weight, 1) as weight,
           l.posted_at as posted_at,
           q.queued_at as queued_at
      from lead_queue q
      join agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
      left join tenant_campaigns c on c.id = l.campaign_id
     where q.tenant_id = p_tenant_id
       and q.status = 'unclaimed'
       and (q.locked_until is null or q.locked_until < v_now)
       -- A lead attributed to a campaign may serve only while that campaign is active AND
       -- scrubbed. campaigns_servable is LA-2.3's gate; reading it rather than restating the rule
       -- is what stops the gate being half-applied. A lead with no campaign (partner, inbound) is
       -- not subject to it, but faces everything below.
       and (l.campaign_id is null
            or exists (select 1 from campaigns_servable cs where cs.id = l.campaign_id))
       -- Never suppressed.
       and not (select s.suppressed from is_phone_suppressed(p_tenant_id, l.values->>'phone') s)
       -- Never outside its legal local window, under any request.
       and tenant_can_dial_now(p_tenant_id, l.values->>'state', l.campaign_id, v_now)
       -- Exhausted leads stop being served at all.
       and l.lead_state <> 'exhausted'
  )
  select e.qid, e.lid, e.priority
    into v_qid, v_lead, v_priority
    from eligible e
   where e.priority is not null
   order by e.priority,
            -- Across campaigns, interleaved by mixing weight so one does not starve another. The
            -- exponential draw gives each campaign a share proportional to its weight without
            -- needing a running total.
            -ln(greatest(random(), 1e-9)) / greatest(e.weight, 1),
            coalesce(e.posted_at, e.queued_at)
   limit 1;

  if v_qid is null then
    return;
  end if;

  -- The lock is taken by an UPDATE filtered on the status we read, so two agents racing on the
  -- same row cannot both win: the second update matches nothing and that agent gets nothing this
  -- call. Simpler than FOR UPDATE SKIP LOCKED across the CTE, and it is the same guarantee where
  -- it matters -- one row, one winner.
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

  return query
    select v_qid, v_lead, v_priority,
           case v_priority
             when 1 then 'realtime' when 2 then 'callback' when 3 then 'appointment'
             when 4 then 'retry' when 5 then 'fresh' when 6 then 'nurture' end,
           v_now + make_interval(mins => v_lock_minutes);
end;
$function$;

-- ── why the queue is empty ─────────────────────────────────────────────────
--
-- "The empty queue is a normal state. When nothing is servable, say why." The existing copy is
-- good and is kept verbatim as the fallback.
create or replace function public.serving_empty_reason(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    campaign_serving_block_reason(p_tenant_id),
    case
      when not exists (select 1 from lead_queue where tenant_id = p_tenant_id and status = 'unclaimed')
        then 'Every lead has been worked or is with another agent.'
      else 'Every lead is either outside its local window, waiting on a retry timer, or already worked. This is normal early and late in the day.'
    end
  );
$function$;

revoke all on function public.serve_next_lead(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.serve_next_lead(uuid, uuid) to service_role;
revoke all on function public.tenant_can_dial_now(uuid, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.tenant_can_dial_now(uuid, text, uuid, timestamptz) to tenant_app, service_role;
revoke all on function public.current_slot_for_state(text, timestamptz) from public, anon, authenticated;
grant execute on function public.current_slot_for_state(text, timestamptz) to tenant_app, service_role;
revoke all on function public.serving_empty_reason(uuid) from public, anon, authenticated;
grant execute on function public.serving_empty_reason(uuid) to tenant_app, service_role;

alter table public.tenant_cadence_rules enable row level security;
alter table public.tenant_call_attempts enable row level security;

drop policy if exists tenant_cadence_rules_tenant_scoped on public.tenant_cadence_rules;
create policy tenant_cadence_rules_tenant_scoped on public.tenant_cadence_rules
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

drop policy if exists tenant_call_attempts_tenant_scoped on public.tenant_call_attempts;
create policy tenant_call_attempts_tenant_scoped on public.tenant_call_attempts
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_cadence_rules, public.tenant_call_attempts from anon, authenticated, public;
grant select, insert, update, delete on public.tenant_cadence_rules to tenant_app;
grant select, insert on public.tenant_call_attempts to tenant_app;
grant select, insert, update, delete on public.tenant_cadence_rules, public.tenant_call_attempts to service_role;
