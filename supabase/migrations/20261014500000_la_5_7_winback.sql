-- LA-5.7 (Notion sprint, Module 5 — Retention) · win-back of fully lapsed clients, handed to the
-- LA-2 lead machinery — carefully.
--
--   winback_candidate   one per lapse the files showed (tenant, carrier, policy, lapsed_on) once it
--                       is past reinstatement: no open LA-5.6 case, and the carrier's window has run
--                       out (or there is none). Classified by WHY it lapsed, most reliable source
--                       first, into a band and a cooling-off:
--
--     mechanical      draft timing / bounced, never said no     strong  30 days   (fair if inferred)
--     administrative  card expired, bank closed, moved          strong  30 days
--     unknown         just stopped; no stated reason            fair    90 days
--     carrier_declined  the carrier refused reinstatement       fair    90 days
--     affordability   said they could not afford it              poor    12 months (platform floor 6)
--     no_longer_wanted  said they no longer wanted it            poor    12 months
--     do_not_contact  complaint / asked not to be contacted     never   → internal DNC, permanently
--     deceased        a death                                   never   → household flagged for a claim
--
--   Sources, most reliable first: a reinstatement decline the client gave (LA-5.6, in their own words); a
--   save call where they agreed to keep the policy (LA-5.3) or promised to pay (LA-4.16); the
--   carrier's own status word (a requested termination is their decision; a death is a death); the
--   payment history (inferred: never better than fair); nothing at all (unknown). A number already
--   on the internal do-not-call list is `never`, whatever else is known.
--
--   Release (at eligible_from, by the app): into the agency's own "Win-back" lead list as a nurture
--   lead tagged source = winback, then the list is sent back through the scrub gate (LA-2.3) — so
--   nothing is dialled until it is scrubbed, inside the calling window (LA-2.4), on the normal cadence.
--   A `never` candidate can never be released: the table refuses it, whatever path asks.
--
--   household_claim_followup   a lapse after a death is not a lead; it may be an unpaid claim the
--                       family does not know how to make. Listed until someone handles it.
--
--   sync_winback_candidates    opens and classifies candidates (after each policy file and daily).
--   ensure_winback_list        the agency's "Win-back" lead list (vendor "Your own book"), once.
--
-- Also: retention_settings cooling-off per reason (LA-5.11) and winback_campaign_id; tenant_lead_sources
-- may now be tagged 'winback'.
--
-- Additive. Requires 20261014400000 (reinstatement_case) and LA-2's lead tables.
--
-- Rollback:
--   select cron.unschedule('la5-winback-daily');
--   drop function if exists public.sync_winback_candidates(uuid), public.ensure_winback_list(uuid);
--   drop table if exists public.winback_candidate, public.household_claim_followup;
--   drop function if exists public.winback_candidate_guard();
--   (restore tenant_lead_sources_source_type_check without 'winback'; drop the retention_settings columns)

-- ─── settings ───────────────────────────────────────────────────────────────────────────────────
alter table public.retention_settings add column if not exists winback_mechanical_days smallint not null default 30;
alter table public.retention_settings add column if not exists winback_administrative_days smallint not null default 30;
alter table public.retention_settings add column if not exists winback_unknown_days smallint not null default 90;
alter table public.retention_settings add column if not exists winback_carrier_declined_days smallint not null default 90;
alter table public.retention_settings add column if not exists winback_affordability_days smallint not null default 365;
alter table public.retention_settings add column if not exists winback_no_longer_wanted_days smallint not null default 365;
alter table public.retention_settings add column if not exists winback_campaign_id uuid references public.tenant_campaigns(id) on delete set null;
alter table public.retention_settings drop constraint if exists retention_settings_winback_days;
-- The affordability floor is a platform limit, not a preference: someone who could not afford $71 a
-- month is never called back inside six months.
alter table public.retention_settings add constraint retention_settings_winback_days check (
  winback_mechanical_days between 7 and 365 and winback_administrative_days between 7 and 365
  and winback_unknown_days between 30 and 730 and winback_carrier_declined_days between 30 and 730
  and winback_affordability_days between 180 and 1095 and winback_no_longer_wanted_days between 90 and 1095
);
create index if not exists retention_settings_winback_campaign_idx on public.retention_settings (winback_campaign_id) where winback_campaign_id is not null;

-- ─── the source tag ─────────────────────────────────────────────────────────────────────────────
alter table public.tenant_lead_sources drop constraint if exists tenant_lead_sources_source_type_check;
alter table public.tenant_lead_sources add constraint tenant_lead_sources_source_type_check check (source_type in ('import', 'partner', 'affiliate', 'recycle', 'winback'));

-- ─── candidates ─────────────────────────────────────────────────────────────────────────────────
create table if not exists public.winback_candidate (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  household_id uuid,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  source_policy_number text not null,
  lapsed_on date not null,
  months_paid integer,
  premium_cents bigint,
  face_amount_cents bigint,
  lapse_reason_category text not null,
  reason_source text not null,
  reason_inferred boolean not null default false,
  reason_detail text,
  winback_band text not null,
  eligible_from date,
  released_to_nurture_at timestamptz,
  released_lead_id uuid references public.agent_leads(id) on delete set null,
  campaign_id uuid references public.tenant_campaigns(id) on delete set null,
  release_blocked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint winback_candidate_one_per_lapse unique (tenant_id, carrier_id, source_policy_number, lapsed_on),
  constraint winback_candidate_category check (lapse_reason_category in ('mechanical', 'administrative', 'unknown', 'carrier_declined', 'affordability', 'no_longer_wanted', 'do_not_contact', 'deceased')),
  constraint winback_candidate_source check (reason_source in ('client_said', 'save_call', 'carrier_status', 'reinstatement_decline', 'do_not_call_list', 'payment_history', 'none')),
  constraint winback_candidate_band check (winback_band in ('strong', 'fair', 'poor', 'never')),
  -- A guess may route someone to fair; only something the client actually said routes them to strong.
  constraint winback_candidate_inferred check (not reason_inferred or winback_band <> 'strong'),
  constraint winback_candidate_never check ((winback_band = 'never') = (lapse_reason_category in ('do_not_contact', 'deceased'))),
  constraint winback_candidate_never_dates check (winback_band <> 'never' or (eligible_from is null and released_to_nurture_at is null and released_lead_id is null)),
  constraint winback_candidate_eligible check (winback_band = 'never' or eligible_from is not null),
  constraint winback_candidate_released check ((released_to_nurture_at is null) = (released_lead_id is null)),
  constraint winback_candidate_lengths check ((reason_detail is null or char_length(reason_detail) <= 500) and (release_blocked_reason is null or char_length(release_blocked_reason) <= 300))
);
create index if not exists winback_candidate_due_idx on public.winback_candidate (tenant_id, eligible_from) where released_to_nurture_at is null and winback_band <> 'never';
create index if not exists winback_candidate_recent_idx on public.winback_candidate (tenant_id, created_at desc);
create index if not exists winback_candidate_carrier_idx on public.winback_candidate (carrier_id);
create index if not exists winback_candidate_contact_idx on public.winback_candidate (contact_id) where contact_id is not null;
create index if not exists winback_candidate_lead_idx on public.winback_candidate (released_lead_id) where released_lead_id is not null;
create index if not exists winback_candidate_campaign_idx on public.winback_candidate (campaign_id) where campaign_id is not null;

-- The structural rule: `never` is never released and never softened; a released candidate is history;
-- the classification moves only with the sync; nothing is released before its cooling-off ends.
create or replace function public.winback_candidate_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_sync boolean := coalesce(current_setting('app.winback_sync', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    raise exception 'A win-back candidate is never removed.' using errcode = 'P0001';
  end if;
  if (new.tenant_id, new.carrier_id, new.source_policy_number, new.lapsed_on, new.created_at)
     is distinct from (old.tenant_id, old.carrier_id, old.source_policy_number, old.lapsed_on, old.created_at) then
    raise exception 'A candidate''s policy and lapse never change.' using errcode = 'P0001';
  end if;
  if old.winback_band = 'never' and new.winback_band <> 'never' then
    raise exception 'A client who must not be called stays that way.' using errcode = 'P0001';
  end if;
  if new.released_to_nurture_at is not null and old.released_to_nurture_at is null then
    if new.winback_band = 'never' then
      raise exception 'A never-call candidate cannot be released.' using errcode = 'P0001';
    end if;
    if new.eligible_from is null or new.eligible_from > current_date then
      raise exception 'Not before the cooling-off ends (%).', new.eligible_from using errcode = 'P0001';
    end if;
  end if;
  if old.released_to_nurture_at is not null and (to_jsonb(new) - 'updated_at' - 'released_lead_id' - 'campaign_id') is distinct from (to_jsonb(old) - 'updated_at' - 'released_lead_id' - 'campaign_id') then
    raise exception 'A released candidate is history.' using errcode = 'P0001';
  end if;
  if (new.lapse_reason_category, new.reason_source, new.reason_inferred, new.winback_band, new.eligible_from)
     is distinct from (old.lapse_reason_category, old.reason_source, old.reason_inferred, old.winback_band, old.eligible_from)
     and not v_sync then
    raise exception 'Only the win-back check classifies a candidate.' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists winback_candidate_guard on public.winback_candidate;
create trigger winback_candidate_guard before update or delete on public.winback_candidate
  for each row execute function public.winback_candidate_guard();

-- ─── possible claims ────────────────────────────────────────────────────────────────────────────
create table if not exists public.household_claim_followup (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  household_id uuid,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  policy_number text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  note text,
  constraint household_claim_followup_one unique (tenant_id, carrier_id, policy_number),
  constraint household_claim_followup_reason check (char_length(btrim(reason)) between 3 and 500),
  constraint household_claim_followup_note check (note is null or char_length(note) <= 2000),
  constraint household_claim_followup_resolved check ((resolved_at is null) = (resolved_by is null))
);
create index if not exists household_claim_followup_open_idx on public.household_claim_followup (tenant_id) where resolved_at is null;
create index if not exists household_claim_followup_carrier_idx on public.household_claim_followup (carrier_id);
create index if not exists household_claim_followup_contact_idx on public.household_claim_followup (contact_id) where contact_id is not null;
create index if not exists household_claim_followup_by_idx on public.household_claim_followup (resolved_by) where resolved_by is not null;

-- ─── classify ───────────────────────────────────────────────────────────────────────────────────
-- The category a reason in someone's own words points to; null when it says nothing classifiable.
create or replace function public.winback_reason_category(p_text text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_text is null or btrim(p_text) = '' then null
    when p_text ~* '\m(died|passed away|deceased|death|funeral)\M' then 'deceased'
    when p_text ~* '(do not (call|contact)|don''?t (call|contact)|stop calling|never call|remove (me|her|him|them)|complain|harass)' then 'do_not_contact'
    when p_text ~* '(afford|money|expensive|too much|cost|price|budget|income|can''?t pay|cannot pay)' then 'affordability'
    when p_text ~* '\m(bank|card|account|moved|address|closed)\M' then 'administrative'
    when p_text ~* '(don''?t want|no longer|not interested|changed (her|his|their) mind|other (policy|coverage)|already covered|cancel)' then 'no_longer_wanted'
    else null
  end;
$$;

create or replace function public.sync_winback_candidates(p_tenant_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_category text;
  v_source text;
  v_inferred boolean;
  v_detail text;
  v_band text;
  v_days integer;
  v_eligible date;
  v_phone text;
  v_opened integer := 0;
  v_reclassified integer := 0;
  v_never integer := 0;
  v_claims integer := 0;
  v_existing record;
begin
  perform set_config('app.winback_sync', 'on', true);
  for r in
    select pc.tenant_id, pc.carrier_id, pc.policy_number, pc.contact_id, pc.household_id, pc.lapsed_on, pc.months_paid,
           pc.premium_cents, pc.premium_mode, pc.annualised_premium_cents, pc.face_amount_cents, pc.carrier_status_raw,
           c.primary_phone,
           (select case when own.cleared then plat.window_days else coalesce(own.window_days, plat.window_days) end
              from (select 1) one
              left join lateral (select r1.window_days, r1.cleared from public.carrier_retention_rule r1
                 where r1.tenant_id = pc.tenant_id and r1.carrier_id = pc.carrier_id and r1.rule_type = 'reinstatement' and r1.effective_from <= current_date
                 order by r1.effective_from desc, r1.created_at desc limit 1) own on true
              left join lateral (select r2.window_days from public.carrier_retention_rule r2
                 where r2.tenant_id is null and r2.carrier_id = pc.carrier_id and r2.rule_type = 'reinstatement' and r2.effective_from <= current_date
                 order by r2.effective_from desc, r2.created_at desc limit 1) plat on true) as window_days,
           rs.winback_mechanical_days, rs.winback_administrative_days, rs.winback_unknown_days, rs.winback_carrier_declined_days,
           rs.winback_affordability_days, rs.winback_no_longer_wanted_days
      from public.policy_current pc
      left join public.contacts c on c.id = pc.contact_id and c.tenant_id = pc.tenant_id
      left join public.retention_settings rs on rs.tenant_id = pc.tenant_id
     where pc.status_normalized = 'lapsed' and pc.lapsed_on is not null
       and (p_tenant_id is null or pc.tenant_id = p_tenant_id)
       -- Past reinstatement: no case still open for this lapse.
       and not exists (select 1 from public.reinstatement_case rc where rc.tenant_id = pc.tenant_id and rc.carrier_id = pc.carrier_id and rc.policy_number = pc.policy_number
                        and rc.lapsed_on = pc.lapsed_on and rc.status in ('identified', 'contacted', 'client_agreed', 'submitted'))
  loop
    -- Still inside a known window with no case (the reinstatement sync has not run yet): not yet.
    if r.window_days is not null and r.lapsed_on + r.window_days >= current_date then continue; end if;

    v_category := null; v_source := 'none'; v_inferred := false; v_detail := null;
    v_phone := nullif(right(regexp_replace(coalesce(r.primary_phone, ''), '\D', '', 'g'), 10), '');
    if v_phone is not null and char_length(v_phone) <> 10 then v_phone := null; end if;

    -- 1. In their own words: why they declined reinstatement.
    select rc.decline_reason, rc.status into v_existing from public.reinstatement_case rc
     where rc.tenant_id = r.tenant_id and rc.carrier_id = r.carrier_id and rc.policy_number = r.policy_number and rc.lapsed_on = r.lapsed_on
       and rc.status in ('declined_by_client', 'declined_by_carrier') limit 1;
    if found and v_existing.status = 'declined_by_client' then
      v_category := coalesce(public.winback_reason_category(v_existing.decline_reason), 'unknown');
      v_source := 'reinstatement_decline';
      v_detail := left(v_existing.decline_reason, 500);
    elsif found and v_existing.status = 'declined_by_carrier' then
      v_category := coalesce(nullif(public.winback_reason_category(v_existing.decline_reason), 'affordability'), 'carrier_declined');
      v_source := 'reinstatement_decline';
      v_detail := left('The carrier declined reinstatement: ' || coalesce(v_existing.decline_reason, ''), 500);
    end if;

    -- 2. A save call: they agreed to keep it, or promised to pay — they never said no; the mechanics failed them.
    if v_category is null then
      if exists (select 1 from public.save_attempt sa where sa.tenant_id = r.tenant_id and sa.carrier_id = r.carrier_id and sa.policy_number = r.policy_number
                  and sa.contact_outcome = 'reached_agreed' and sa.attempted_at::date <= r.lapsed_on)
         or exists (select 1 from public.retention_action ra where ra.tenant_id = r.tenant_id and ra.carrier_id = r.carrier_id and ra.policy_number = r.policy_number
                  and ra.outcome in ('promised_to_pay', 'converting_to_draft') and ra.acted_at::date <= r.lapsed_on) then
        v_category := 'mechanical'; v_source := 'save_call';
        v_detail := 'Told us they wanted to keep it, then a payment failed.';
      end if;
    end if;

    -- 3. The carrier's word: a death is a death; a requested termination is their decision.
    if r.carrier_status_raw ~* '\m(death|deceased|died|claim)\M' then
      v_category := 'deceased'; v_source := 'carrier_status'; v_detail := 'The carrier reports: ' || left(r.carrier_status_raw, 200);
    elsif v_category is null and r.carrier_status_raw ~* '(cancel\w*|request\w*\s+(cancel|termination)|surrender|free\s?look)' then
      v_category := 'no_longer_wanted'; v_source := 'carrier_status'; v_detail := 'The carrier reports: ' || left(r.carrier_status_raw, 200);
    end if;

    -- 4. Inferred from the payment history: probably mechanical, never better than fair.
    if v_category is null and (
         exists (select 1 from public.servicing_request s where s.tenant_id = r.tenant_id and s.carrier_id = r.carrier_id and s.policy_number = r.policy_number and s.status = 'failed')
         or exists (select 1 from public.policy_change ch where ch.tenant_id = r.tenant_id and ch.carrier_id = r.carrier_id and ch.policy_number = r.policy_number
                     and ch.field_name = 'paid_to_date' and ch.new_value < ch.old_value)) then
      v_category := 'mechanical'; v_source := 'payment_history'; v_inferred := true;
      v_detail := 'A payment bounced before it lapsed (inferred).';
    end if;

    if v_category is null then v_category := 'unknown'; v_detail := 'It just stopped: no reason on record.'; end if;

    -- 5. Already on the internal do-not-call list: never, whatever else is known.
    if v_category <> 'deceased' and v_phone is not null and exists (select 1 from public.tenant_do_not_call d where d.tenant_id = r.tenant_id and d.phone_digits = v_phone and d.is_active) then
      v_category := 'do_not_contact'; v_source := 'do_not_call_list'; v_inferred := false; v_detail := 'The number is on your do-not-call list.';
    end if;

    v_band := case
      when v_category in ('do_not_contact', 'deceased') then 'never'
      when v_category in ('affordability', 'no_longer_wanted') then 'poor'
      when v_category in ('mechanical', 'administrative') and not v_inferred and v_source in ('reinstatement_decline', 'save_call', 'client_said') then 'strong'
      else 'fair' end;
    v_days := case
      when v_band = 'never' then null
      when v_category = 'affordability' then coalesce(r.winback_affordability_days, 365)
      when v_category = 'no_longer_wanted' then coalesce(r.winback_no_longer_wanted_days, 365)
      when v_category = 'carrier_declined' then coalesce(r.winback_carrier_declined_days, 90)
      when v_band = 'strong' and v_category = 'administrative' then coalesce(r.winback_administrative_days, 30)
      when v_band = 'strong' then coalesce(r.winback_mechanical_days, 30)
      else coalesce(r.winback_unknown_days, 90) end;
    v_eligible := case when v_days is null then null else r.lapsed_on + v_days end;

    select wc.id, wc.winback_band, wc.released_to_nurture_at, wc.lapse_reason_category, wc.reason_source into v_existing
      from public.winback_candidate wc
     where wc.tenant_id = r.tenant_id and wc.carrier_id = r.carrier_id and wc.source_policy_number = r.policy_number and wc.lapsed_on = r.lapsed_on;
    if not found then
      insert into public.winback_candidate (tenant_id, contact_id, household_id, carrier_id, source_policy_number, lapsed_on, months_paid, premium_cents, face_amount_cents,
                                            lapse_reason_category, reason_source, reason_inferred, reason_detail, winback_band, eligible_from)
      values (r.tenant_id, r.contact_id, r.household_id, r.carrier_id, r.policy_number, r.lapsed_on, r.months_paid,
              coalesce(round(r.annualised_premium_cents / 12.0)::bigint, case when r.premium_mode = 'monthly' then r.premium_cents end), r.face_amount_cents,
              v_category, v_source, v_inferred, v_detail, v_band, v_eligible);
      v_opened := v_opened + 1;
    elsif v_existing.released_to_nurture_at is null and v_existing.winback_band <> 'never'
          and (v_existing.lapse_reason_category, v_existing.reason_source) is distinct from (v_category, v_source) then
      -- Newer, better evidence before release (a decline in their words arrives after the window closed).
      update public.winback_candidate set lapse_reason_category = v_category, reason_source = v_source, reason_inferred = v_inferred, reason_detail = v_detail,
             winback_band = v_band, eligible_from = v_eligible, release_blocked_reason = null
       where id = v_existing.id;
      v_reclassified := v_reclassified + 1;
    else
      continue;
    end if;

    if v_category = 'do_not_contact' then
      if v_phone is not null then
        insert into public.tenant_do_not_call (tenant_id, phone_digits, reason)
        values (r.tenant_id, v_phone, left('Win-back: ' || coalesce(v_detail, 'asked not to be contacted'), 500))
        on conflict (tenant_id, phone_digits) where is_active do nothing;
      end if;
      v_never := v_never + 1;
    elsif v_category = 'deceased' then
      insert into public.household_claim_followup (tenant_id, contact_id, household_id, carrier_id, policy_number, reason)
      values (r.tenant_id, r.contact_id, r.household_id, r.carrier_id, r.policy_number, left(coalesce(v_detail, 'A death was reported'), 500))
      on conflict (tenant_id, carrier_id, policy_number) do nothing;
      v_never := v_never + 1;
      v_claims := v_claims + 1;
    end if;
  end loop;
  return jsonb_build_object('opened', v_opened, 'reclassified', v_reclassified, 'never', v_never, 'claims', v_claims);
end;
$$;

-- ─── the agency's win-back list ─────────────────────────────────────────────────────────────────
create or replace function public.ensure_winback_list(p_tenant_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign uuid;
  v_vendor uuid;
begin
  select rs.winback_campaign_id into v_campaign from public.retention_settings rs where rs.tenant_id = p_tenant_id;
  if v_campaign is not null and exists (select 1 from public.tenant_campaigns where id = v_campaign and tenant_id = p_tenant_id) then
    return v_campaign;
  end if;
  insert into public.tenant_lead_vendors (tenant_id, name, lead_type, notes)
  values (p_tenant_id, 'Your own book', 'aged', 'Clients from your own book of business: win-back of lapsed policies (LA-5.7).')
  on conflict (tenant_id, name) do update set updated_at = now()
  returning id into v_vendor;
  insert into public.tenant_campaigns (tenant_id, vendor_id, name, lead_type, status)
  values (p_tenant_id, v_vendor, 'Win-back', 'aged', 'active')
  returning id into v_campaign;
  insert into public.retention_settings (tenant_id, winback_campaign_id) values (p_tenant_id, v_campaign)
  on conflict (tenant_id) do update set winback_campaign_id = excluded.winback_campaign_id, updated_at = now();
  return v_campaign;
end;
$$;

-- ─── access ─────────────────────────────────────────────────────────────────────────────────────
alter table public.winback_candidate enable row level security;
drop policy if exists winback_candidate_read on public.winback_candidate;
create policy winback_candidate_read on public.winback_candidate for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.winback_candidate from public, anon, authenticated;
-- The sync opens and classifies; the app records a release (the guard decides whether it may).
grant select, update on public.winback_candidate to service_role;
revoke insert, delete, truncate on public.winback_candidate from service_role, tenant_app;
revoke update on public.winback_candidate from tenant_app;
grant select on public.winback_candidate to tenant_app;

alter table public.household_claim_followup enable row level security;
drop policy if exists household_claim_followup_read on public.household_claim_followup;
create policy household_claim_followup_read on public.household_claim_followup for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.household_claim_followup from public, anon, authenticated;
grant select, update on public.household_claim_followup to service_role;
revoke insert, delete, truncate on public.household_claim_followup from service_role, tenant_app;
revoke update on public.household_claim_followup from tenant_app;
grant select on public.household_claim_followup to tenant_app;

revoke all on function public.sync_winback_candidates(uuid) from public, anon, authenticated;
grant execute on function public.sync_winback_candidates(uuid) to service_role;
revoke all on function public.ensure_winback_list(uuid) from public, anon, authenticated;
grant execute on function public.ensure_winback_list(uuid) to service_role;
revoke all on function public.winback_reason_category(text) from public, anon, authenticated;
grant execute on function public.winback_reason_category(text) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('la5-winback-daily', '0 8 * * *', $cron$select public.sync_winback_candidates()$cron$);
    exception when others then
      raise notice '20261014500000: the daily win-back check could not be scheduled (%).', sqlerrm;
    end;
  end if;
end $$;

-- ─── self-check ─────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v jsonb;
begin
  begin
    v := public.sync_winback_candidates();
    if v ? 'opened' is not true then
      raise exception '20261014500000: the win-back check did not report';
    end if;
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  if public.winback_reason_category('She said they could not afford it') <> 'affordability'
     or public.winback_reason_category('Asked us to stop calling') <> 'do_not_contact'
     or public.winback_reason_category('Her husband passed away') <> 'deceased'
     or public.winback_reason_category('Bank account closed') <> 'administrative'
     or public.winback_reason_category('Just because') is not null then
    raise exception '20261014500000: the reason classifier is wrong';
  end if;
  if has_table_privilege('service_role', 'public.winback_candidate', 'INSERT') or has_table_privilege('service_role', 'public.winback_candidate', 'DELETE') then
    raise exception '20261014500000: only the sync opens a candidate, and none is removed';
  end if;
end $$;
