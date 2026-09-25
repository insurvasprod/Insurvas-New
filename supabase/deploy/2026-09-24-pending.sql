-- ============================================================================
-- Pending migrations — 22 files, each in its own transaction
-- Generated 2026-09-24 by scripts/build-pending-bundle.mjs. Do not hand-edit; regenerate.
--
-- HOW TO RUN: Supabase dashboard → SQL editor → paste this whole file → Run.
-- Each file is begin … commit on its own. The SQL editor STOPS at the first error: that file is
-- rolled back, the files before it stay applied, and nothing after it runs. Fix the named file,
-- regenerate, and run the whole script again — re-running is safe: the files use
-- create-or-replace / if-not-exists, and history rows use on-conflict-do-nothing.
--
-- AFTERWARDS: node --env-file=.env.local scripts/verify-applied-migrations.mjs
--
-- Files, in order:
--    1. 20260923180000_notify_sound_treatments_are_a_user_setting.sql
--    2. 20260924200000_personal_producer_licence_numbers.sql
--    3. 20260924200100_admin_notification_reads.sql
--    4. 20260924210000_agency_partner_support_contact.sql
--    5. 20260924220000_agency_npn_check_and_workspace_timezone.sql
--    6. 20260924220100_carrier_requires_eo.sql
--    7. 20260924220300_vault_saves_are_atomic.sql
--    8. 20260924220400_team_member_last_seen.sql
--    9. 20260924230200_calendar_double_booking_agency_cap_linked_calendars.sql
--   10. 20260924230300_cadence_board_times_seven_dials_atomic_save.sql
--   11. 20260924230400_unclaimed_sla_expiry_becomes_a_nurture_lead.sql
--   12. 20260924240000_lead_post_rejection_reasons_for_consent_dob_and_licence.sql
--   13. 20260924240100_pipelines_partner_type_is_optional.sql
--   14. 20260924240200_dispositions_next_action_is_a_setting.sql
--   15. 20260924260000_commission_statements.sql
--   16. 20260924260100_commission_statement_import_and_review.sql
--   17. 20260924265000_policy_lapse_signals.sql
--   18. 20260924300000_lead_assignment_board.sql
--   19. 20260924310000_carrier_appointment_status_and_expiry.sql
--   20. 20260924310100_carrier_training_requirements.sql
--   21. 20260924341900_restore_pool_leads_stuck_in_working.sql
--   22. 20260925100000_pipeline_views_stage_rules_and_history.sql
-- ============================================================================

-- ─── [1/22] 20260923180000_notify_sound_treatments_are_a_user_setting.sql ─────────
begin;

-- Per-treatment sound preferences, stored per user rather than per browser.
--
-- The six notification treatments (win, arrive, done, warn, block, fail) each decide whether they
-- make a noise. Two of them are audible by default and two more are opt-in, and until now that
-- choice lived in localStorage — which meant an agent who switched machines, or whose browser data
-- was cleared, silently got the defaults back. The master controls beside it (do_not_disturb,
-- sound_muted, sound_volume) have been per user since LA-1.25; having half the sound settings
-- follow someone between machines and half not is worse than either answer on its own.
--
-- Additive only: one nullable-by-default jsonb column. Existing rows keep working untouched and
-- read as "no explicit choice", which is exactly what an empty object means to the application —
-- fall back to the defaults. Nothing needs backfilling.
--
-- Deliberately NOT a column per treatment. The set of treatments is a product decision that has
-- already changed once during this work; a shape that requires DDL every time someone adds a
-- seventh is a shape that will instead grow a second storage mechanism beside it.

alter table public.agent_notification_settings
  add column if not exists sound_treatments jsonb not null default '{}'::jsonb;

-- The application reads this as Partial<Record<Treatment, boolean>>: a missing key means "no
-- opinion, use the default", and a present key must be a real yes or no. Without the guard a null
-- or a string would read as neither, and the resulting silence would be indistinguishable from a
-- deliberate mute.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.agent_notification_settings'::regclass
      and conname = 'agent_notification_settings_sound_treatments_object'
  ) then
    alter table public.agent_notification_settings
      add constraint agent_notification_settings_sound_treatments_object
      check (jsonb_typeof(sound_treatments) = 'object');
  end if;
end $$;

-- Only the four treatments that can ever be audible may appear. `done` and `fail` are silent
-- permanently and by design — a chime for every routine save is a chime nobody hears, and a noise
-- for a server fault fires in bursts on exactly the days it is least welcome. Storing a key for
-- them would imply a control that does not exist, and would quietly become one the first time
-- somebody wrote the obvious loop over Object.keys.
--
-- Written without a subquery: Postgres refuses one in a CHECK (0A000 "cannot use subquery in check
-- constraint"), which is how the first apply of this file failed on 2026-09-24. `jsonb - text[]`
-- strips the four allowed keys, so anything left over is a key that must not be there; each allowed
-- key, when present, must hold a boolean. The CASE is there because `-` raises on a non-object and
-- Postgres does not promise to evaluate AND/OR left to right — the _object constraint above is what
-- rejects a non-object, and this one simply passes it through to that.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.agent_notification_settings'::regclass
      and conname = 'agent_notification_settings_sound_treatments_keys'
  ) then
    alter table public.agent_notification_settings
      add constraint agent_notification_settings_sound_treatments_keys
      check (
        case when jsonb_typeof(sound_treatments) = 'object' then
          (sound_treatments - array['win', 'arrive', 'warn', 'block']) = '{}'::jsonb
          and coalesce(jsonb_typeof(sound_treatments -> 'win'), 'boolean') = 'boolean'
          and coalesce(jsonb_typeof(sound_treatments -> 'arrive'), 'boolean') = 'boolean'
          and coalesce(jsonb_typeof(sound_treatments -> 'warn'), 'boolean') = 'boolean'
          and coalesce(jsonb_typeof(sound_treatments -> 'block'), 'boolean') = 'boolean'
        else true end
      );
  end if;
end $$;

comment on column public.agent_notification_settings.sound_treatments is
  'Per-treatment sound opt-in. Partial<Record<"win"|"arrive"|"warn"|"block", boolean>>; a missing key means use the default (win, arrive and block on, warn off). done and fail are never audible and must not appear.';

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260923180000', 'notify_sound_treatments_are_a_user_setting') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [2/22] 20260924200000_personal_producer_licence_numbers.sql ──────────────────
begin;

-- Your profile: a person's own producer numbers.
--
-- The account menu's first row is "Your profile · Name, phone, licence numbers". Name and phone
-- already live on `users`. Licence numbers did not exist per person at all: `licenses` holds the
-- AGENCY's licence per state, `agency_profiles.npn` the agency's NPN, and
-- `tenant_user_licensed_states` (20260924110000) only WHICH states a person is licensed in, set by
-- the owner. A National Producer Number and a state licence number belong to the individual
-- producer, so they get a per-person row here.
--
-- Per workspace (tenant_id, user_id) rather than on `users`, because the numbers are recorded for
-- the agency the person produces for, and every read and write in this product is tenant-scoped.
--
-- Additive and idempotent. Until this is applied the profile page shows the numbers as "needs the
-- database update" and the API refuses to save them with a 503; name and phone save regardless.

create table if not exists public.tenant_user_producer_profiles (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  -- NPNs are issued by NIPR as digits only, up to ten.
  npn text check (npn is null or npn ~ '^[0-9]{1,10}$'),
  -- { "AZ": "1234567", "TX": "2345678" } — keyed by two-letter state, values are the number as
  -- the state prints it (letters, digits and dashes, up to 32 characters).
  state_licence_numbers jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id),
  constraint tenant_user_producer_profiles_numbers_object check (jsonb_typeof(state_licence_numbers) = 'object')
);
create index if not exists tenant_user_producer_profiles_user_idx on public.tenant_user_producer_profiles (user_id);

alter table public.tenant_user_producer_profiles enable row level security;
revoke all on public.tenant_user_producer_profiles from anon, authenticated, public;
grant select, insert, update, delete on public.tenant_user_producer_profiles to service_role;
grant select, insert, update on public.tenant_user_producer_profiles to tenant_app;

-- Colleagues in the same workspace can read the numbers (an owner checking a producer's licence is
-- the ordinary case); only the person themselves writes them.
drop policy if exists tenant_user_producer_profiles_read on public.tenant_user_producer_profiles;
create policy tenant_user_producer_profiles_read on public.tenant_user_producer_profiles
  for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

drop policy if exists tenant_user_producer_profiles_write_own on public.tenant_user_producer_profiles;
create policy tenant_user_producer_profiles_write_own on public.tenant_user_producer_profiles
  for insert to tenant_app
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and user_id = nullif(current_setting('app.user_id', true), '')::uuid
  );

drop policy if exists tenant_user_producer_profiles_update_own on public.tenant_user_producer_profiles;
create policy tenant_user_producer_profiles_update_own on public.tenant_user_producer_profiles
  for update to tenant_app
  using (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and user_id = nullif(current_setting('app.user_id', true), '')::uuid
  )
  with check (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and user_id = nullif(current_setting('app.user_id', true), '')::uuid
  );

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924200000', 'personal_producer_licence_numbers') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [3/22] 20260924200100_admin_notification_reads.sql ───────────────────────────
begin;

-- Staff notifications: which ones each admin has read.
--
-- The staff top bar (p-nav-admin) draws a bell. Its notifications are events the platform already
-- records — trials ending with no card (admin_trials_in_flight), plan changes, cancellations and
-- early conversions (audit_log) — so nothing about the events themselves is stored here. What did
-- not exist is "this admin has read that one", which is what makes the badge count what is
-- unhandled rather than everything that ever happened. One row per admin per source key.
--
-- A platform table, not a tenant table: no tenant_id, no tenant_app grant and no tenant policy —
-- a workspace session must never read or write staff state. RLS is on with no policies, so only
-- the service role (the admin plane's client) can touch it, exactly like partner_notifications.
--
-- Additive and idempotent. Until this is applied the bell still shows every notification, and
-- "Mark all as read" is replaced by a line saying read marks need the database update.

create table if not exists public.admin_notification_reads (
  admin_user_id uuid not null references public.admin_users(id) on delete cascade,
  -- e.g. "audit:<audit_log id>" or "trial-ending:<subscription id>:<trial_ends_at>".
  source_key text not null check (char_length(source_key) between 1 and 300),
  read_at timestamptz not null default now(),
  primary key (admin_user_id, source_key)
);
create index if not exists admin_notification_reads_read_at_idx on public.admin_notification_reads (read_at);

alter table public.admin_notification_reads enable row level security;
revoke all on public.admin_notification_reads from anon, authenticated, public;
-- Explicit, in case default privileges ever grant new tables to the workspace role.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'tenant_app') then
    revoke all on public.admin_notification_reads from tenant_app;
  end if;
end $$;
grant select, insert, update, delete on public.admin_notification_reads to service_role;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924200100', 'admin_notification_reads') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [4/22] 20260924210000_agency_partner_support_contact.sql ─────────────────────
begin;

-- Partner portal › Messages › Details: the agency's "Support" email and "Phone".
--
-- The board shows partners who to contact at the agency. Nothing stored that: tenants has a name
-- only, business_profiles is the signup questionnaire, and agency_profiles (20260924100000) is the
-- legal identity — with a NOT NULL legal name an owner would have to fill before they could give a
-- phone number, and not applied yet either. Two nullable columns on tenants are the smallest honest
-- home: one row per agency, which is exactly what the partner portal reads.
--
-- Written by the owner through /api/app/partner-support-contact (service role, owner checked in the
-- API — the same arrangement as the agency profile). Read by /api/partner/chat, scoped to the
-- signed-in partner's own tenant. Until this is applied the API reports schemaReady=false and the
-- partner panel hides the two rows; saving returns 503.
--
-- Additive and idempotent. Grants are unchanged: tenants already grants select to tenant_app under
-- tenant_self_read, and every write goes through service_role.

alter table public.tenants add column if not exists support_email text;
alter table public.tenants add column if not exists support_phone text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenants_support_email_format' and conrelid = 'public.tenants'::regclass) then
    alter table public.tenants add constraint tenants_support_email_format
      check (support_email is null or (length(support_email) <= 254 and support_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenants_support_phone_format' and conrelid = 'public.tenants'::regclass) then
    alter table public.tenants add constraint tenants_support_phone_format
      check (support_phone is null or (length(support_phone) <= 32 and length(regexp_replace(support_phone, '[^0-9]', '', 'g')) between 7 and 15));
  end if;
end;
$$;

comment on column public.tenants.support_email is
  'Shown to this agency''s partners as "Support" in partner portal Messages. Set by an owner.';
comment on column public.tenants.support_phone is
  'Shown to this agency''s partners as "Phone" in partner portal Messages. Stored as typed; formatted for display.';

-- PostgREST caches the schema; without this the new columns 404 (PGRST204) until the next reload.
notify pgrst, 'reload schema';

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924210000', 'agency_partner_support_contact') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [5/22] 20260924220000_agency_npn_check_and_workspace_timezone.sql ────────────
begin;

-- Settings › Agency profile, the two lines the board states that were not yet true.
--
-- ── 1. "Verified against NIPR 3 March 2026."
--
-- 20260924100000 created `agency_profiles.npn_verified_at` and said nothing sets it, because there
-- is no NIPR integration. NIPR's Producer Database (PDB) lookup is a paid, contracted service with
-- its own credentials, so the lookup itself cannot be written here. What can be is everything
-- around it: where a check's outcome is kept, and the one function the lookup calls to record it.
-- lib/agencyProfile/nipr.ts is the hook; it calls record_agency_npn_check once a client exists.
--
--   npn_check_status   what the last lookup said: verified, not_found (NIPR has no producer with
--                      that number), name_mismatch (it does, under another name) or error
--   npn_checked_at     when that lookup ran
--
-- The check is recorded against the NPN it looked up. If the owner changed the number while the
-- lookup was in flight, the result describes a number the agency no longer uses and is dropped.
-- save_agency_profile already clears npn_verified_at when the NPN changes; it now clears the
-- status with it (below), so a stale "not found" cannot sit beside a corrected number either.
--
-- ── 2. "Every calling window, callback and report reads this."
--
-- The report half: `deal_local_date` files a deal against the agent's own timezone, then the
-- customer's, then UTC. The agency's timezone is a far better guess at the agent's midnight than
-- the customer's is, so it now sits second. (Callbacks read it in lib/callbacks/service.ts; calling
-- windows follow the customer's own timezone by law and are not changed by this file.)
--
-- Additive and idempotent. Requires 20260924100000 (agency_profiles).

alter table public.agency_profiles add column if not exists npn_check_status text;
alter table public.agency_profiles add column if not exists npn_checked_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agency_profiles_npn_check_status_valid') then
    alter table public.agency_profiles
      add constraint agency_profiles_npn_check_status_valid
      check (npn_check_status is null or npn_check_status in ('verified', 'not_found', 'name_mismatch', 'error'));
  end if;
end $$;

-- Records one NIPR lookup. Returns false when the NPN on file is no longer the one that was checked.
create or replace function public.record_agency_npn_check(
  p_tenant_id uuid,
  p_npn text,
  p_status text,
  p_checked_at timestamptz default now()
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_status not in ('verified', 'not_found', 'name_mismatch', 'error') then
    raise exception 'invalid_npn_check_status';
  end if;
  update public.agency_profiles ap
     set npn_check_status = p_status,
         npn_checked_at = p_checked_at,
         -- An error says nothing about the number, so it leaves an earlier verification standing.
         npn_verified_at = case
           when p_status = 'verified' then p_checked_at
           when p_status = 'error' then ap.npn_verified_at
           else null end
   where ap.tenant_id = p_tenant_id
     and ap.npn is not distinct from nullif(btrim(p_npn), '');
  return found;
end;
$$;

revoke all on function public.record_agency_npn_check(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_agency_npn_check(uuid, text, text, timestamptz) to service_role;

-- A changed NPN drops the check with the verification stamp. Same body as 20260924100000 plus the
-- two check columns; re-stated rather than patched because it is short and owned by this section.
create or replace function public.save_agency_profile(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_legal_name text,
  p_dba text,
  p_npn text,
  p_tax_id_change boolean,
  p_tax_id_ciphertext text,
  p_tax_id_last4 text,
  p_principal_address text,
  p_timezone text
)
returns public.agency_profiles
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.agency_profiles;
begin
  insert into public.agency_profiles as ap
    (tenant_id, legal_name, dba, npn, npn_verified_at, tax_id_ciphertext, tax_id_last4, principal_address, timezone, updated_at, updated_by)
  values
    (p_tenant_id, trim(p_legal_name), nullif(trim(p_dba), ''), nullif(trim(p_npn), ''), null,
     case when p_tax_id_change then p_tax_id_ciphertext else null end,
     case when p_tax_id_change then p_tax_id_last4 else null end,
     nullif(trim(p_principal_address), ''), nullif(trim(p_timezone), ''), now(), p_actor_id)
  on conflict (tenant_id) do update set
    legal_name = excluded.legal_name,
    dba = excluded.dba,
    npn = excluded.npn,
    npn_verified_at = case when ap.npn is not distinct from excluded.npn then ap.npn_verified_at else null end,
    npn_check_status = case when ap.npn is not distinct from excluded.npn then ap.npn_check_status else null end,
    npn_checked_at = case when ap.npn is not distinct from excluded.npn then ap.npn_checked_at else null end,
    tax_id_ciphertext = case when p_tax_id_change then excluded.tax_id_ciphertext else ap.tax_id_ciphertext end,
    tax_id_last4 = case when p_tax_id_change then excluded.tax_id_last4 else ap.tax_id_last4 end,
    principal_address = excluded.principal_address,
    timezone = excluded.timezone,
    updated_at = now(),
    updated_by = excluded.updated_by
  returning * into v_row;

  insert into public.agency_profile_history
    (tenant_id, changed_by, legal_name, dba, npn, tax_id_last4, tax_id_changed, principal_address, timezone)
  values
    (p_tenant_id, p_actor_id, v_row.legal_name, v_row.dba, v_row.npn, v_row.tax_id_last4, coalesce(p_tax_id_change, false), v_row.principal_address, v_row.timezone);

  return v_row;
end;
$$;

revoke all on function public.save_agency_profile(uuid, uuid, text, text, text, boolean, text, text, text, text) from public, anon, authenticated;
grant execute on function public.save_agency_profile(uuid, uuid, text, text, text, boolean, text, text, text, text) to service_role;

-- ── 2 ──────────────────────────────────────────────────────────────────────
-- 20260922190000's function with one step inserted: agent → agency → customer → UTC.
create or replace function public.deal_local_date(
  p_tenant_id uuid,
  p_agent_user_id uuid,
  p_lead_values jsonb,
  p_at timestamptz default now()
)
returns date
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_zone text;
begin
  select min(av.timezone) into v_zone
    from tenant_agent_availability av
   where av.tenant_id = p_tenant_id and av.user_id = p_agent_user_id;

  -- The agency's own timezone (Settings › Agency profile), when the agent has none of their own.
  if v_zone is null then
    select ap.timezone into v_zone
      from agency_profiles ap
     where ap.tenant_id = p_tenant_id
       and ap.timezone is not null
       and exists (select 1 from pg_timezone_names tz where tz.name = ap.timezone);
  end if;

  if v_zone is null then
    select st.timezone into v_zone
      from state_timezones st
     where st.state = upper(nullif(btrim(coalesce(p_lead_values->>'state', '')), ''));
  end if;

  return (p_at at time zone coalesce(v_zone, 'UTC'))::date;
end;
$function$;

revoke all on function public.deal_local_date(uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.deal_local_date(uuid, uuid, jsonb, timestamptz) to tenant_app, service_role;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924220000', 'agency_npn_check_and_workspace_timezone') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [6/22] 20260924220100_carrier_requires_eo.sql ────────────────────────────────
begin;

-- Settings › Carrier library: which carriers require E&O cover in force.
--
-- Two boards count it: Agency profile ("E&O policy expires in 41 days · six carriers require it")
-- and States & licences ("Six carrier appointments require E&O in force"). Nothing recorded it, so
-- both counts would have been invented. It is a term of the carrier's contract with the agency, so
-- it is kept per tenant and carrier, beside the contract rows — not on tenant_carriers itself,
-- whose rows are effective-dated and re-inserted on every contract change, which would drop a flag
-- the owner set once.
--
-- Additive and idempotent. Written by the service role after the API has checked the caller is an
-- owner, the same arrangement as the rest of the carrier library.

create table if not exists public.tenant_carrier_requirements (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete cascade,
  requires_eo boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  primary key (tenant_id, carrier_id)
);
create index if not exists tenant_carrier_requirements_carrier_idx on public.tenant_carrier_requirements (carrier_id);
create index if not exists tenant_carrier_requirements_updated_by_idx on public.tenant_carrier_requirements (updated_by);

alter table public.tenant_carrier_requirements enable row level security;
revoke all on public.tenant_carrier_requirements from public, anon, authenticated;
grant select, insert, update, delete on public.tenant_carrier_requirements to service_role;
grant select on public.tenant_carrier_requirements to tenant_app;
drop policy if exists tenant_carrier_requirements_read on public.tenant_carrier_requirements;
create policy tenant_carrier_requirements_read on public.tenant_carrier_requirements
  for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924220100', 'carrier_requires_eo') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [7/22] 20260924220300_vault_saves_are_atomic.sql ─────────────────────────────
begin;

-- Settings › States & licences: one save, one statement.
--
-- 20260924110000 added licence type and lines, E&O per-claim and aggregate limits, and CE ethics
-- credits. The application wrote them in two steps: the LA-0.5 RPC for the original columns, then a
-- separate UPDATE for the new ones. A failure between the two left a licence saved with its old type,
-- or an E&O policy with its new expiry and its old limits — a half-save the screen reported as an
-- error while the first half stood.
--
-- These three functions write the whole record in one INSERT … ON CONFLICT. `p_details` carries only
-- the new fields the caller sent: a key that is absent keeps what is stored (a JSON null clears it),
-- which is the "undefined means keep" rule the API already had. The original RPCs are unchanged, so
-- anything still calling them keeps working.
--
-- lib/appointments/service.ts calls these first and falls back to the two-step path only when they
-- are missing (this file not applied yet).
--
-- Additive and idempotent. Requires 20260924110000 (the columns).

create or replace function public.save_license_with_details(
  p_tenant_id uuid,
  p_state text,
  p_license_number text,
  p_expires_at date,
  p_details jsonb default '{}'::jsonb
)
returns public.licenses
language plpgsql
security invoker
set search_path = public
as $$
declare
  v public.licenses;
  d jsonb := coalesce(p_details, '{}'::jsonb);
  v_lines text[] := case when d ? 'lines_of_authority' and jsonb_typeof(d->'lines_of_authority') = 'array'
                         then array(select jsonb_array_elements_text(d->'lines_of_authority')) else '{}'::text[] end;
begin
  insert into public.licenses as l (tenant_id, state, license_number, expires_at, licence_type, lines_of_authority)
  values (p_tenant_id, upper(trim(p_state)), trim(p_license_number), p_expires_at, d->>'licence_type', v_lines)
  on conflict (tenant_id, state) do update set
    license_number = excluded.license_number,
    expires_at = excluded.expires_at,
    licence_type = case when d ? 'licence_type' then excluded.licence_type else l.licence_type end,
    lines_of_authority = case when d ? 'lines_of_authority' then excluded.lines_of_authority else l.lines_of_authority end
  returning * into v;
  return v;
end;
$$;

create or replace function public.save_eo_policy_with_limits(
  p_tenant_id uuid,
  p_carrier text,
  p_policy_number text,
  p_expires_at date,
  p_coverage_amount_cents bigint,
  p_details jsonb default '{}'::jsonb
)
returns public.eo_policies
language plpgsql
security invoker
set search_path = public
as $$
declare
  v public.eo_policies;
  d jsonb := coalesce(p_details, '{}'::jsonb);
begin
  insert into public.eo_policies as e (tenant_id, carrier, policy_number, expires_at, coverage_amount_cents, per_claim_cents, aggregate_cents)
  values (p_tenant_id, trim(p_carrier), trim(p_policy_number), p_expires_at, p_coverage_amount_cents,
          (d->>'per_claim_cents')::bigint, (d->>'aggregate_cents')::bigint)
  on conflict (tenant_id, policy_number) do update set
    carrier = excluded.carrier,
    expires_at = excluded.expires_at,
    coverage_amount_cents = excluded.coverage_amount_cents,
    per_claim_cents = case when d ? 'per_claim_cents' then excluded.per_claim_cents else e.per_claim_cents end,
    aggregate_cents = case when d ? 'aggregate_cents' then excluded.aggregate_cents else e.aggregate_cents end
  returning * into v;
  return v;
end;
$$;

create or replace function public.save_ce_record_with_ethics(
  p_tenant_id uuid,
  p_state text,
  p_credits_required integer,
  p_credits_completed integer,
  p_deadline date,
  p_details jsonb default '{}'::jsonb
)
returns public.ce_records
language plpgsql
security invoker
set search_path = public
as $$
declare
  v public.ce_records;
  d jsonb := coalesce(p_details, '{}'::jsonb);
begin
  insert into public.ce_records as c (tenant_id, state, credits_required, credits_completed, deadline, ethics_required, ethics_completed)
  values (p_tenant_id, upper(trim(p_state)), p_credits_required, p_credits_completed, p_deadline,
          (d->>'ethics_required')::integer, (d->>'ethics_completed')::integer)
  on conflict (tenant_id, state) do update set
    credits_required = excluded.credits_required,
    credits_completed = excluded.credits_completed,
    deadline = excluded.deadline,
    ethics_required = case when d ? 'ethics_required' then excluded.ethics_required else c.ethics_required end,
    ethics_completed = case when d ? 'ethics_completed' then excluded.ethics_completed else c.ethics_completed end
  returning * into v;
  return v;
end;
$$;

revoke all on function public.save_license_with_details(uuid, text, text, date, jsonb) from public, anon, authenticated;
revoke all on function public.save_eo_policy_with_limits(uuid, text, text, date, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.save_ce_record_with_ethics(uuid, text, integer, integer, date, jsonb) from public, anon, authenticated;
grant execute on function public.save_license_with_details(uuid, text, text, date, jsonb) to service_role;
grant execute on function public.save_eo_policy_with_limits(uuid, text, text, date, bigint, jsonb) to service_role;
grant execute on function public.save_ce_record_with_ethics(uuid, text, integer, integer, date, jsonb) to service_role;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924220300', 'vault_saves_are_atomic') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [8/22] 20260924220400_team_member_last_seen.sql ──────────────────────────────
begin;

-- Settings › Team & access: "Last seen — Now, 4 min ago, 1 hr ago".
--
-- The product could only show users.last_login_at, the last successful sign-in, which says nothing
-- about whether someone is working now: a producer who signed in on Monday and has dialled all week
-- read "4 days ago". agent_presence.last_seen_at is written by the Agent Floor heartbeat only, and
-- every write to it broadcasts a floor refresh, so it cannot double as a general activity stamp.
--
-- This is that stamp: one row per member, touched by the alert-feed poll every signed-in agent tab
-- already makes (GET /api/app/notifications, every few seconds). The application throttles it to at
-- most one write per member per minute per server, and the function below refuses a write inside
-- the same minute, so a dozen open tabs still cost one small UPDATE a minute. A table of its own
-- rather than a column on tenant_users so this write never fires the membership triggers.
--
-- Additive and idempotent. The team screen reads last sign-in until this is applied.

create table if not exists public.tenant_member_activity (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index if not exists tenant_member_activity_user_idx on public.tenant_member_activity (user_id);

alter table public.tenant_member_activity enable row level security;
revoke all on public.tenant_member_activity from public, anon, authenticated;
grant select, insert, update, delete on public.tenant_member_activity to service_role;
grant select on public.tenant_member_activity to tenant_app;
drop policy if exists tenant_member_activity_read on public.tenant_member_activity;
create policy tenant_member_activity_read on public.tenant_member_activity
  for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Stamps a member as seen now, unless they were stamped in the last minute. Only for a real member
-- of that tenant, so a stale session for a removed person cannot write a row.
create or replace function public.touch_tenant_member_activity(p_tenant_id uuid, p_user_id uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.tenant_member_activity as a (tenant_id, user_id, last_seen_at)
  select p_tenant_id, p_user_id, now()
   where exists (select 1 from public.tenant_users tu where tu.tenant_id = p_tenant_id and tu.user_id = p_user_id)
  on conflict (tenant_id, user_id) do update set last_seen_at = excluded.last_seen_at
   where a.last_seen_at < excluded.last_seen_at - interval '1 minute';
$$;

revoke all on function public.touch_tenant_member_activity(uuid, uuid) from public, anon, authenticated;
grant execute on function public.touch_tenant_member_activity(uuid, uuid) to service_role;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924220400', 'team_member_last_seen') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [9/22] 20260924230200_calendar_double_booking_agency_cap_linked_calendars.sql ───
begin;

-- ---------------------------------------------------------------------------
-- Settings · Calendar & availability — the three things the board says and booking did not do
--
-- 1. ALLOW DOUBLE-BOOKING. "Two appointments in one slot." Per agent, default off (today's rule).
--    The exclusion constraint that refuses an overlap stays the only arbiter — that is what makes
--    two setters racing on one slot get one winner — but it now counts SEATS: every live
--    appointment holds seat 1 or seat 2, and the constraint refuses an overlap only within a seat.
--    `book_appointment` takes seat 1; if that collides and the agent allows double-booking, it tries
--    seat 2; if that collides too, the slot is taken. So "two in one slot" is exactly two, never
--    three, and the race is still settled by the index rather than by a count that is stale by the
--    time the insert runs. Existing rows get seat 1, which makes the new constraint identical to
--    the old one on every row that satisfied it.
--
-- 2. MAXIMUM PER DAY, ACROSS THE WHOLE AGENCY. The board: "Across the whole agency, not per agent."
--    `tenant_booking_settings.max_per_day` (null = no agency cap). Counted over every live
--    appointment in the tenant on the booked day, in the agency's timezone (Agency profile), else
--    the agent's, else UTC. A per-tenant-day advisory lock makes the count and the insert one
--    decision, so two setters cannot both take the last place. The per-agent cap
--    (`tenant_agent_booking_policy.max_per_day`) is kept and still enforced; both must pass.
--
-- 3. HONOUR LINKED CALENDARS. Stored since 20260924120000 and read by nothing, because there was
--    no calendar integration. This adds the integration's data model and the rule that reads it:
--
--      tenant_connected_calendars  one row per agent per provider (google | microsoft): status,
--                                  the account, the encrypted refresh token, last sync, last error.
--                                  Service role only — no tenant-plane grant on tokens.
--      tenant_calendar_busy        busy intervals synced from a connected calendar.
--      replace_calendar_busy       swaps one calendar's busy set in a single transaction.
--
--    `book_appointment` refuses a start that overlaps busy time from a CONNECTED calendar when the
--    agent's `honour_linked_calendars` is on (APPOINTMENT_LINKED_CALENDAR_BUSY). With no calendar
--    connected there is no busy time, and the screen says so instead of offering a switch that
--    does nothing. The OAuth apps that fill these tables are configured outside the database; see
--    lib/appointments/linkedCalendars.ts for exactly which credentials.
--
-- Also: a stale state-rules feed (20260924230100) refuses a booking with its own code
-- (APPOINTMENT_CALLING_RULES_STALE) instead of reporting "outside the customer's window".
--
-- `book_appointment` is reproduced from 20260924120000 (applied); every rule is kept in the same
-- order with the same exception names. The additions are marked.
-- ---------------------------------------------------------------------------

-- ── 1. seats ───────────────────────────────────────────────────────────────
alter table public.tenant_agent_booking_policy
  add column if not exists allow_double_booking boolean not null default false;

alter table public.tenant_appointments
  add column if not exists seat smallint not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_appointments_seat_known') then
    alter table public.tenant_appointments
      add constraint tenant_appointments_seat_known check (seat in (1, 2));
  end if;
end $$;

-- Same name, same scope (live appointments only), same buffer-inclusive range; one more column.
-- Dropped and re-added in one migration transaction, so there is no moment without a constraint.
alter table public.tenant_appointments
  drop constraint if exists tenant_appointments_no_double_booking;
alter table public.tenant_appointments
  add constraint tenant_appointments_no_double_booking
  exclude using gist (
    tenant_id with =,
    agent_user_id with =,
    seat with =,
    tstzrange(starts_at_utc, occupied_until_utc, '[)') with &&
  ) where (status in ('booked', 'confirmed'));

-- ── 2. the agency's daily cap ──────────────────────────────────────────────
create table if not exists public.tenant_booking_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  max_per_day integer check (max_per_day is null or max_per_day between 1 and 1000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);

create index if not exists tenant_booking_settings_updated_by_idx
  on public.tenant_booking_settings (updated_by);

alter table public.tenant_booking_settings enable row level security;
drop policy if exists tenant_booking_settings_scoped on public.tenant_booking_settings;
create policy tenant_booking_settings_scoped on public.tenant_booking_settings for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_booking_settings from anon, authenticated, public;
grant select, insert, update on public.tenant_booking_settings to tenant_app;
grant select, insert, update, delete on public.tenant_booking_settings to service_role;

-- The agency cap counts a tenant's appointments by day.
create index if not exists tenant_appointments_tenant_live_start_idx
  on public.tenant_appointments (tenant_id, starts_at_utc)
  where status in ('booked', 'confirmed');

-- ── 3. linked calendars ────────────────────────────────────────────────────
create table if not exists public.tenant_connected_calendars (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  status text not null default 'pending' check (status in ('pending', 'connected', 'error', 'revoked')),
  account_email text check (account_email is null or char_length(account_email) <= 320),
  -- The OAuth `state` nonce while a connection is pending; cleared once it completes.
  oauth_state text unique,
  oauth_state_expires_at timestamptz,
  -- AES-256-GCM, encrypted by the application with CALENDAR_TOKEN_KEY. Never readable in the tenant
  -- plane: this table has no tenant_app grant at all.
  refresh_token_ciphertext text,
  scopes text[] not null default array[]::text[],
  last_synced_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id, provider)
);

create index if not exists tenant_connected_calendars_user_idx
  on public.tenant_connected_calendars (tenant_id, user_id);
create index if not exists tenant_connected_calendars_user_fk_idx
  on public.tenant_connected_calendars (user_id);

create table if not exists public.tenant_calendar_busy (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  calendar_id uuid not null references public.tenant_connected_calendars(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists tenant_calendar_busy_lookup_idx
  on public.tenant_calendar_busy (tenant_id, user_id, ends_at);
create index if not exists tenant_calendar_busy_calendar_idx
  on public.tenant_calendar_busy (calendar_id);
create index if not exists tenant_calendar_busy_user_fk_idx
  on public.tenant_calendar_busy (user_id);

alter table public.tenant_connected_calendars enable row level security;
alter table public.tenant_calendar_busy enable row level security;
-- No tenant_app policy or grant: the tokens and the busy cache are handled by the server only.
revoke all on public.tenant_connected_calendars, public.tenant_calendar_busy from anon, authenticated, public, tenant_app;
grant select, insert, update, delete on public.tenant_connected_calendars, public.tenant_calendar_busy to service_role;

create or replace function public.replace_calendar_busy(p_calendar_id uuid, p_rows jsonb, p_synced_at timestamptz default now())
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cal record;
  v_count integer;
begin
  select * into v_cal from tenant_connected_calendars where id = p_calendar_id for update;
  if not found then raise exception 'CALENDAR_NOT_FOUND'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'CALENDAR_BUSY_ROWS_INVALID'; end if;

  delete from tenant_calendar_busy where calendar_id = p_calendar_id;
  insert into tenant_calendar_busy (tenant_id, user_id, calendar_id, starts_at, ends_at, fetched_at)
  select v_cal.tenant_id, v_cal.user_id, p_calendar_id,
         (e->>'startsAt')::timestamptz, (e->>'endsAt')::timestamptz, p_synced_at
    from jsonb_array_elements(p_rows) e
   where (e->>'endsAt')::timestamptz > (e->>'startsAt')::timestamptz;
  get diagnostics v_count = row_count;

  update tenant_connected_calendars
     set status = 'connected', last_synced_at = p_synced_at, last_error = null, updated_at = now()
   where id = p_calendar_id;
  return v_count;
end;
$function$;

revoke all on function public.replace_calendar_busy(uuid, jsonb, timestamptz) from public, anon, authenticated, tenant_app;
grant execute on function public.replace_calendar_busy(uuid, jsonb, timestamptz) to service_role;

-- ── booking, with every rule the server owns ───────────────────────────────
create or replace function public.book_appointment(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_agent_user_id uuid,
  p_booked_by uuid,
  p_starts_at_utc timestamptz,
  p_notes text default null,
  p_duration_minutes integer default null
)
returns table(appointment_id uuid, starts_at_utc timestamptz, duration_minutes integer, reason text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_policy record;
  v_minutes integer;
  v_buffer integer;
  v_zone text;
  v_state text;
  v_campaign uuid;
  v_customer_zone text;
  v_local timestamp;
  v_dow smallint;
  v_id uuid;
  v_booked_that_day integer;
  v_range tstzrange;
  v_agency_cap integer;
  v_agency_zone text;
  v_agency_day date;
  v_seat smallint := 1;
begin
  if p_starts_at_utc <= now() then
    raise exception 'APPOINTMENT_IN_THE_PAST';
  end if;

  select * into v_policy from tenant_agent_booking_policy
   where tenant_id = p_tenant_id and user_id = p_agent_user_id;
  v_minutes := coalesce(p_duration_minutes, v_policy.appointment_minutes, 30);
  v_buffer := coalesce(v_policy.buffer_minutes, 0);
  v_range := tstzrange(p_starts_at_utc, p_starts_at_utc + make_interval(mins => v_minutes), '[)');

  select l.values->>'state', l.campaign_id into v_state, v_campaign
    from agent_leads l where l.id = p_lead_id and l.tenant_id = p_tenant_id;
  if v_state is null then
    raise exception 'APPOINTMENT_LEAD_HAS_NO_STATE';
  end if;

  select timezone into v_customer_zone from state_timezones where state = upper(v_state);
  if v_customer_zone is null then
    raise exception 'APPOINTMENT_LEAD_HAS_NO_STATE';
  end if;

  -- [added] A stale state-rules feed refuses every dial (20260924230100), and an appointment is a
  -- call. Said as itself rather than as "outside the customer's window".
  if public.calling_window_rules_stale(now()) then
    raise exception 'APPOINTMENT_CALLING_RULES_STALE';
  end if;

  -- The customer's legal window, at the booked instant. An appointment is a call, and an
  -- appointment at 3am is a call at 3am that our own system put in the diary.
  if not tenant_can_dial_now(p_tenant_id, v_state, v_campaign, p_starts_at_utc) then
    raise exception 'APPOINTMENT_OUTSIDE_CUSTOMER_WINDOW';
  end if;

  -- The agent's own working hours, in the agent's zone.
  select av.timezone into v_zone from tenant_agent_availability av
   where av.tenant_id = p_tenant_id and av.user_id = p_agent_user_id limit 1;

  -- Same-day booking, in the agent's own day. On by default, which is how booking always behaved.
  if coalesce(v_policy.allow_same_day, true) = false
     and (p_starts_at_utc at time zone coalesce(v_zone, 'UTC'))::date
         = (now() at time zone coalesce(v_zone, 'UTC'))::date then
    raise exception 'APPOINTMENT_SAME_DAY_NOT_ALLOWED';
  end if;

  if v_zone is not null then
    v_local := p_starts_at_utc at time zone v_zone;
    v_dow := extract(dow from v_local)::smallint;

    if not exists (
      select 1 from tenant_agent_availability av
       where av.tenant_id = p_tenant_id and av.user_id = p_agent_user_id
         and av.weekday = v_dow
         and v_local::time >= av.start_time
         and (v_local + make_interval(mins => v_minutes))::time <= av.end_time
    ) then
      raise exception 'APPOINTMENT_OUTSIDE_AVAILABILITY';
    end if;

    -- One-off blocks: the stored instant, exactly as before.
    if exists (
      select 1 from tenant_agent_blocks b
       where b.tenant_id = p_tenant_id and b.user_id = p_agent_user_id
         and coalesce(b.repeats, 'none') = 'none'
         and tstzrange(b.starts_at, b.ends_at, '[)') && v_range
    ) then
      raise exception 'APPOINTMENT_BLOCKED_TIME';
    end if;

    -- Repeating blocks: every occurrence whose day could reach the requested range.
    if exists (
      select 1
        from tenant_agent_blocks b
        cross join lateral generate_series(
          ((p_starts_at_utc at time zone v_zone)::date
            - ceil(extract(epoch from (b.ends_at - b.starts_at)) / 86400.0)::integer)::timestamp,
          ((p_starts_at_utc + make_interval(mins => v_minutes)) at time zone v_zone)::date::timestamp,
          interval '1 day'
        ) as g(d)
       where b.tenant_id = p_tenant_id and b.user_id = p_agent_user_id
         and coalesce(b.repeats, 'none') <> 'none'
         and g.d::date >= (b.starts_at at time zone v_zone)::date
         and case b.repeats
               when 'daily' then true
               when 'weekdays' then extract(isodow from g.d) between 1 and 5
               when 'weekly' then extract(dow from g.d) = extract(dow from (b.starts_at at time zone v_zone))
               when 'yearly' then to_char(g.d, 'MM-DD') = to_char(b.starts_at at time zone v_zone, 'MM-DD')
               else false
             end
         and tstzrange(
               (g.d::date + (b.starts_at at time zone v_zone)::time) at time zone v_zone,
               ((g.d::date + (b.starts_at at time zone v_zone)::time) at time zone v_zone) + (b.ends_at - b.starts_at),
               '[)'
             ) && v_range
    ) then
      raise exception 'APPOINTMENT_BLOCKED_TIME';
    end if;
  end if;

  -- [added] Busy time in a connected Google or Outlook calendar, when the agent honours it. Only a
  -- CONNECTED calendar counts: a pending or failed connection has no trustworthy busy set.
  if coalesce(v_policy.honour_linked_calendars, true) and exists (
    select 1
      from tenant_calendar_busy cb
      join tenant_connected_calendars cc on cc.id = cb.calendar_id and cc.status = 'connected'
     where cb.tenant_id = p_tenant_id and cb.user_id = p_agent_user_id
       and cb.ends_at > p_starts_at_utc
       and tstzrange(cb.starts_at, cb.ends_at, '[)') && v_range
  ) then
    raise exception 'APPOINTMENT_LINKED_CALENDAR_BUSY';
  end if;

  -- The daily cap, server-side. Counted in the AGENT's day, not UTC's: a cap of eight means eight
  -- in his working day, and a UTC day would split it across two of his.
  if v_policy.max_per_day is not null then
    select count(*) into v_booked_that_day
      from tenant_appointments a
     where a.tenant_id = p_tenant_id
       and a.agent_user_id = p_agent_user_id
       and a.status in ('booked', 'confirmed')
       and (a.starts_at_utc at time zone coalesce(v_zone, 'UTC'))::date
           = (p_starts_at_utc at time zone coalesce(v_zone, 'UTC'))::date;

    if v_booked_that_day >= v_policy.max_per_day then
      raise exception 'APPOINTMENT_DAILY_CAP_REACHED';
    end if;
  end if;

  -- [added] The agency's cap: every live appointment in the tenant that day, in the agency's own
  -- timezone. The lock makes "count, then insert" one decision per tenant-day.
  select s.max_per_day into v_agency_cap from tenant_booking_settings s where s.tenant_id = p_tenant_id;
  if v_agency_cap is not null then
    begin
      select nullif(btrim(ap.timezone), '') into v_agency_zone from agency_profiles ap where ap.tenant_id = p_tenant_id;
    exception when undefined_table or undefined_column then
      v_agency_zone := null;
    end;
    v_agency_zone := coalesce(v_agency_zone, v_zone, 'UTC');
    v_agency_day := (p_starts_at_utc at time zone v_agency_zone)::date;
    perform pg_advisory_xact_lock(hashtextextended('booking-cap:' || p_tenant_id::text || ':' || v_agency_day::text, 0));

    select count(*) into v_booked_that_day
      from tenant_appointments a
     where a.tenant_id = p_tenant_id
       and a.status in ('booked', 'confirmed')
       and a.starts_at_utc >= (v_agency_day::timestamp at time zone v_agency_zone)
       and a.starts_at_utc < ((v_agency_day + 1)::timestamp at time zone v_agency_zone);

    if v_booked_that_day >= v_agency_cap then
      raise exception 'APPOINTMENT_AGENCY_DAILY_CAP_REACHED';
    end if;
  end if;

  -- The overlap itself is NOT checked here — buffer included. The exclusion constraint decides it,
  -- seat by seat, which is the only way two setters racing on the same slot get one winner.
  begin
    insert into tenant_appointments
      (tenant_id, lead_id, agent_user_id, booked_by, starts_at_utc, duration_minutes,
       customer_timezone, notes, buffer_minutes, seat)
    values
      (p_tenant_id, p_lead_id, p_agent_user_id, p_booked_by, p_starts_at_utc, v_minutes,
       v_customer_zone, nullif(btrim(p_notes), ''), v_buffer, 1)
    returning id into v_id;
  exception when exclusion_violation then
    -- [added] Double-booking allowed: the second seat. Refused in turn if it is taken too.
    if not coalesce(v_policy.allow_double_booking, false) then
      raise exception 'APPOINTMENT_SLOT_TAKEN';
    end if;
    v_seat := 2;
  end;

  if v_id is null and v_seat = 2 then
    begin
      insert into tenant_appointments
        (tenant_id, lead_id, agent_user_id, booked_by, starts_at_utc, duration_minutes,
         customer_timezone, notes, buffer_minutes, seat)
      values
        (p_tenant_id, p_lead_id, p_agent_user_id, p_booked_by, p_starts_at_utc, v_minutes,
         v_customer_zone, nullif(btrim(p_notes), ''), v_buffer, 2)
      returning id into v_id;
    exception when exclusion_violation then
      raise exception 'APPOINTMENT_SLOT_TAKEN';
    end;
  end if;

  return query select v_id, p_starts_at_utc, v_minutes,
    format('Booked for %s in the customer''s %s.', p_starts_at_utc at time zone v_customer_zone, v_customer_zone)
      || case when v_seat = 2 then ' Double-booked: this slot already had an appointment.' else '' end;
end;
$function$;

revoke all on function public.book_appointment(uuid, uuid, uuid, uuid, timestamptz, text, integer) from public, anon, authenticated, tenant_app;
grant execute on function public.book_appointment(uuid, uuid, uuid, uuid, timestamptz, text, integer) to service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = 'public.tenant_appointments'::regclass
     and c.conname = 'tenant_appointments_no_double_booking';
  if v_def is null or v_def !~ 'occupied_until_utc' or v_def !~ 'seat' then
    raise exception 'the double-booking constraint lost the buffer or the seat: %', v_def;
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'book_appointment';
  if v_def !~ 'APPOINTMENT_SAME_DAY_NOT_ALLOWED' or v_def !~ 'b\.repeats' or v_def !~ 'APPOINTMENT_DAILY_CAP_REACHED'
     or v_def !~ 'APPOINTMENT_AGENCY_DAILY_CAP_REACHED' or v_def !~ 'APPOINTMENT_LINKED_CALENDAR_BUSY'
     or v_def !~ 'allow_double_booking' then
    raise exception 'book_appointment is missing a rule after the rewrite';
  end if;

  if has_table_privilege('tenant_app', 'public.tenant_connected_calendars', 'select') then
    raise exception 'the tenant plane can read calendar tokens';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924230200', 'calendar_double_booking_agency_cap_linked_calendars') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [10/22] 20260924230300_cadence_board_times_seven_dials_atomic_save.sql ────────
begin;

-- ---------------------------------------------------------------------------
-- Settings · Dialing cadence — the four things the board says and the scheduler did not do
--
-- 1. THE BOARD'S TIMES OF DAY. A rule could prefer one of six fixed slots. The board offers three
--    preferences a person actually thinks in — "opposite half of the day", "morning", "evening" —
--    and they are now real values of `preferred_slot`, honoured by `schedule_next_attempt`:
--
--      morning        the customer's local 00:00–12:00 (the legal window starts it at 8 or later)
--      evening        the customer's local 17:00 onward (the legal window ends it)
--      opposite_half  the other half of the day from the previous dial, in the customer's zone:
--                     a morning dial is retried after noon, an afternoon dial before it
--
--    The delay is still a FLOOR. From there the scheduler walks forward in 15-minute steps (at most
--    eight days) to the first instant that is inside the preferred part of the day AND inside the
--    legal window (`tenant_can_dial_now`, so federal, state, agency and campaign limits all apply).
--    Within the preferred part it takes a slot this lead has not failed in if one comes up within a
--    day of the first match, otherwise the first match. `next_dial_after` becomes that instant and
--    `next_preferred_slot` the slot it falls in, so the serving query's existing condition
--    (`current_slot_for_state(...) = next_preferred_slot`) admits the lead exactly then. No change
--    to `serve_next_lead` is needed, which matters because other work is touching it.
--
--    Preference chooses inside the window; it never moves the edge. When no legal instant in the
--    preferred part exists within eight days (a 9–5 agency asking for "evening"), the rule falls
--    back to ordinary slot rotation from the floor instead of never calling.
--
--    The six fixed slots stay valid values, so every stored rule keeps meaning what it meant.
--
-- 2. SEVEN DIALS. Comparing `v_made` with the ceiling minus one, with `attempts_made` already incremented made the
--    SIXTH dial the last, while the ceiling constant, the engine and the board all say seven. The
--    check is now `v_made >= v_ceiling`: the seventh dial is the last, then the lead rests. A lead
--    that was exhausted at six stays exhausted — this only changes what the scheduler decides next.
--
-- 3. A CAMPAIGN CADENCE REPLACES THE TENANT DEFAULT ENTIRELY. The board: "A campaign cadence
--    replaces this one entirely; the two are never merged." The lookup used to merge them attempt
--    by attempt (`campaign_id = v_campaign or campaign_id is null`, campaign row first). Now, if the
--    lead's campaign has ANY rule, only that campaign's rules are read; attempts it does not cover
--    use the built-in delay. A campaign with no rules still runs the tenant default.
--
-- 4. AN ATOMIC SAVE. The editor deleted a scope's rules and then inserted the new set in two
--    requests, so for the length of a round trip the dialer read the built-in cadence — and a
--    failed insert relied on a best-effort restore. `replace_cadence_rules` does both in one
--    transaction, refuses a campaign that is not the tenant's, and serialises concurrent saves of
--    the same scope. The scheduler reads the old rows until the new ones commit.
--
-- `schedule_next_attempt` is reproduced from 20260917144000 (the latest definition); the LRU
-- fallback, the null-slot guard and the advance-by-attempt rotation are unchanged.
-- ---------------------------------------------------------------------------

-- ── the board's preferences are storable ────────────────────────────────────
alter table public.tenant_cadence_rules
  drop constraint if exists tenant_cadence_rules_preferred_slot_check;
alter table public.tenant_cadence_rules
  drop constraint if exists tenant_cadence_rules_preferred_slot_known;
alter table public.tenant_cadence_rules
  add constraint tenant_cadence_rules_preferred_slot_known
  check (preferred_slot is null or preferred_slot in (
    'opposite_half', 'morning', 'evening',
    'early_morning', 'late_morning', 'afternoon', 'early_evening', 'late_evening', 'weekend'));

-- ── the scheduler ──────────────────────────────────────────────────────────
create or replace function public.schedule_next_attempt(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_disposition text,
  p_at timestamptz default now()
)
returns table(due_at timestamptz, attempt_number integer, slot text, exhausted boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_made integer;
  v_next integer;
  v_ceiling integer := 7;
  v_campaign uuid;
  v_state text;
  v_delay interval;
  v_preferred text;
  v_slot text;
  v_tried text[];
  v_unused text[];
  v_available text[] := array['early_morning','late_morning','afternoon','early_evening','late_evening','weekend'];
  v_campaign_owns boolean := false;
  v_due timestamptz;
  v_zone text;
  v_last timestamptz;
  v_last_hour integer;
  v_from integer;
  v_to integer;
  v_t timestamptz;
  v_hour integer;
  v_here text;
  v_first timestamptz;
  v_first_slot text;
  v_found timestamptz;
  v_found_slot text;
  v_step integer;
begin
  select coalesce(attempts_made, 0), campaign_id, values->>'state'
    into v_made, v_campaign, v_state
    from agent_leads where id = p_lead_id and tenant_id = p_tenant_id;

  v_next := v_made + 1;

  -- The seventh dial is the last. `v_made` already counts the dial that was just dispositioned, so
  -- `v_made >= v_ceiling` means "seven dials have happened"; the old ceiling-minus-one stopped at six.
  -- The ceiling terminates rather than schedules: a date far in the future would still be served
  -- eventually by a queue that only checks whether the timer has elapsed.
  if v_made >= v_ceiling then
    return query select null::timestamptz, v_next, null::text, true;
    return;
  end if;

  -- A campaign cadence replaces the tenant default entirely; the two are never merged.
  if v_campaign is not null then
    select exists (
      select 1 from tenant_cadence_rules r
       where r.tenant_id = p_tenant_id and r.campaign_id = v_campaign
    ) into v_campaign_owns;
  end if;

  -- A disposition-specific row beats the catch-all. "No-answer and voicemail should not behave
  -- identically."
  select r.delay_interval, r.preferred_slot into v_delay, v_preferred
    from tenant_cadence_rules r
   where r.tenant_id = p_tenant_id
     and r.attempt_number = v_next
     and (case when v_campaign_owns then r.campaign_id = v_campaign else r.campaign_id is null end)
     and (r.disposition_scope = p_disposition or r.disposition_scope is null)
   order by (r.disposition_scope is not null) desc
   limit 1;

  -- The default table from the task, front-loaded, used when no rule covers this attempt.
  if v_delay is null then
    v_delay := case v_next
      when 1 then interval '2 hours'
      when 2 then interval '1 day'
      when 3 then interval '1 day'
      when 4 then interval '2 days'
      when 5 then interval '3 days'
      else interval '5 days'
    end;
    if v_next = 4 then v_preferred := 'weekend'; end if;
  end if;

  v_due := p_at + v_delay;

  -- Slots this lead has already been DIALLED in. `slot` is NOT NULL on the attempts table, but the
  -- filter is explicit anyway: a single null would make `not (s = any(v_tried))` evaluate to null
  -- for every candidate and silently empty `v_unused`, which would turn slot rotation off across
  -- the whole tenant without any error.
  select coalesce(array_agg(distinct ca.slot), array[]::text[]) into v_tried
    from tenant_call_attempts ca
   where ca.tenant_id = p_tenant_id and ca.lead_id = p_lead_id and ca.slot is not null;

  -- ── the board's three preferences: a part of the day, found inside the legal window ──
  if v_preferred in ('morning', 'evening', 'opposite_half') then
    select timezone into v_zone from state_timezones where state = upper(coalesce(v_state, ''));

    if v_zone is not null then
      select max(ca.attempted_at) into v_last
        from tenant_call_attempts ca
       where ca.tenant_id = p_tenant_id and ca.lead_id = p_lead_id;
      v_last_hour := extract(hour from (coalesce(v_last, p_at) at time zone v_zone))::integer;

      v_from := case v_preferred
        when 'morning' then 0
        when 'evening' then 17
        else case when v_last_hour < 12 then 12 else 0 end
      end;
      v_to := case v_preferred
        when 'morning' then 12
        when 'evening' then 24
        else case when v_last_hour < 12 then 24 else 12 end
      end;

      v_t := v_due;
      -- 8 days of 15-minute steps. The legal-window check runs only on steps already inside the
      -- preferred hours, so an "evening" search asks it about 28 times a day, not 96.
      for v_step in 0 .. 768 loop
        v_hour := extract(hour from (v_t at time zone v_zone))::integer;
        if v_hour >= v_from and v_hour < v_to
           and tenant_can_dial_now(p_tenant_id, v_state, v_campaign, v_t) then
          v_here := current_slot_for_state(v_state, v_t);
          if v_first is null then
            v_first := v_t;
            v_first_slot := v_here;
          end if;
          -- Rotation still applies inside the preference: an untried slot wins if one comes up
          -- within a day of the first legal match.
          if v_here is not null and not (v_here = any(v_tried)) then
            v_found := v_t;
            v_found_slot := v_here;
            exit;
          end if;
          exit when v_t > v_first + interval '1 day';
        end if;
        -- The next quarter hour on the clock, so later steps land on :00, :15, :30, :45.
        v_t := date_trunc('hour', v_t)
               + make_interval(mins => ((floor(extract(minute from v_t) / 15)::integer + 1) * 15));
      end loop;

      if v_found is not null then
        return query select v_found, v_next, v_found_slot, false;
        return;
      elsif v_first is not null and v_first_slot is not null then
        return query select v_first, v_next, v_first_slot, false;
        return;
      end if;
    end if;

    -- No legal instant in the preferred part of the day within eight days, or no timezone for the
    -- lead's state: fall through to ordinary rotation from the floor rather than never calling.
    v_preferred := null;
  end if;

  -- A preference is honoured only while it is unused: a stored preference must not override the
  -- evidence that it already failed.
  if v_preferred is not null and not (v_preferred = any(v_tried)) then
    v_slot := v_preferred;
  else
    select coalesce(array_agg(s order by ord), array[]::text[]) into v_unused
      from unnest(v_available) with ordinality as u(s, ord)
     where not (u.s = any(v_tried));

    if array_length(v_unused, 1) is null then
      -- Every slot has been dialled. Decision 2: take the LEAST RECENTLY USED slot rather than
      -- blocking. `ca.slot` breaks ties so the answer is deterministic.
      select ca.slot into v_slot
        from tenant_call_attempts ca
       where ca.tenant_id = p_tenant_id and ca.lead_id = p_lead_id and ca.slot is not null
       group by ca.slot
       order by max(ca.attempted_at) asc, ca.slot asc
       limit 1;
      v_slot := coalesce(v_slot, v_available[1]);
    else
      -- ADVANCE BY ATTEMPT NUMBER rather than always taking the first unused slot. Every call in a
      -- single working day happens in the same real-world slot, so `v_tried` barely moves between
      -- attempts, and taking the first unused entry proposed the same hour over and over.
      v_slot := v_unused[((v_next - 1) % array_length(v_unused, 1)) + 1];
    end if;
  end if;

  -- The delay is a FLOOR, not an appointment: the serving query holds the lead back until the
  -- chosen slot actually arrives.
  return query select v_due, v_next, v_slot, false;
end;
$function$;

revoke all on function public.schedule_next_attempt(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.schedule_next_attempt(uuid, uuid, text, timestamptz) to tenant_app, service_role;

-- ── the atomic save ────────────────────────────────────────────────────────
--
-- `p_rows` is a JSON array of {attemptNumber, delayInterval, preferredSlot, dispositionScope}. The
-- route has already validated every field (parseInterval, the slot vocabulary, no duplicates, no
-- gaps); the table's own checks and unique constraint still apply here, and any violation rolls the
-- whole save back, leaving the previous rules exactly as they were.
create or replace function public.replace_cadence_rules(
  p_tenant_id uuid,
  p_campaign_id uuid,
  p_rows jsonb
)
returns setof public.tenant_cadence_rules
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_tenant_id is null then
    raise exception 'CADENCE_TENANT_REQUIRED';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'CADENCE_ROWS_INVALID';
  end if;
  if p_campaign_id is not null and not exists (
    select 1 from tenant_campaigns c where c.id = p_campaign_id and c.tenant_id = p_tenant_id
  ) then
    raise exception 'CADENCE_CAMPAIGN_NOT_FOUND';
  end if;

  -- Two owners saving the same scope at once get one result each, in order, never an interleaving.
  perform pg_advisory_xact_lock(
    hashtextextended('cadence:' || p_tenant_id::text || ':' || coalesce(p_campaign_id::text, 'default'), 0)
  );

  delete from tenant_cadence_rules r
   where r.tenant_id = p_tenant_id
     and r.campaign_id is not distinct from p_campaign_id;

  insert into tenant_cadence_rules
    (tenant_id, campaign_id, attempt_number, delay_interval, preferred_slot, disposition_scope)
  select p_tenant_id,
         p_campaign_id,
         (e->>'attemptNumber')::integer,
         (e->>'delayInterval')::interval,
         nullif(e->>'preferredSlot', ''),
         nullif(btrim(coalesce(e->>'dispositionScope', '')), '')
    from jsonb_array_elements(p_rows) as e;

  return query
  select r.* from tenant_cadence_rules r
   where r.tenant_id = p_tenant_id
     and r.campaign_id is not distinct from p_campaign_id
   order by r.attempt_number, r.disposition_scope nulls first;
end;
$function$;

revoke all on function public.replace_cadence_rules(uuid, uuid, jsonb) from public, anon, authenticated, tenant_app;
grant execute on function public.replace_cadence_rules(uuid, uuid, jsonb) to service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'schedule_next_attempt';

  -- The fixes from 20260917144000 must survive this rewrite.
  if v_def !~ 'order by max\(ca\.attempted_at\) asc' then
    raise exception 'LA-2.7: the all-slots-used fallback is no longer least-recently-used';
  end if;
  if v_def ~ 'v_slot := v_tried\[1\]' then
    raise exception 'LA-2.7: the non-deterministic v_tried[1] fallback came back';
  end if;
  if v_def ~ 'v_ceiling - 1' then
    raise exception 'cadence: the scheduler still stops one dial short of the ceiling';
  end if;
  if v_def !~ 'opposite_half' or v_def !~ 'tenant_can_dial_now' then
    raise exception 'cadence: the board''s times of day are not honoured by the scheduler';
  end if;
  if v_def ~ 'r\.campaign_id = v_campaign or r\.campaign_id is null' then
    raise exception 'cadence: a campaign cadence is still merged with the tenant default';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tenant_cadence_rules'::regclass
       and conname = 'tenant_cadence_rules_preferred_slot_known'
  ) then
    raise exception 'cadence: the preferred-time vocabulary constraint is missing';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924230300', 'cadence_board_times_seven_dials_atomic_save') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [11/22] 20260924230400_unclaimed_sla_expiry_becomes_a_nurture_lead.sql ────────
begin;

-- ---------------------------------------------------------------------------
-- Settings · Queue & SLA — "It leaves the active queue and becomes a nurture lead"
--
-- The expire rung (`run_unclaimed_sla`, 20260924150000 — owned by other work and NOT redefined
-- here) sets the inbound transfer's work item to 'expired'. That took it out of the active queue,
-- and there it stopped: the lead was a paid-for lead that nobody would ever call.
--
-- `nurture_expired_transfer` is what the SLA job's expire side effect now calls
-- (lib/queueSla/service.ts), once per expire event:
--
--   1. the lead becomes a nurture lead — `lead_state = 'nurture'`, due now;
--   2. when the agency dials (p_queue), it gets a DIALER work item (no partner, so the inbox and
--      the SLA ladder never see it) that the serving query picks up in its nurture tier, inside the
--      legal window and past suppression like every other lead;
--   3. the expired transfer stays exactly as it was, so the partner's pipeline row and the SLA
--      history still say nobody claimed it.
--
-- The dialer work item records which transfer it came from (`nurtured_from_work_item_id`), and
-- `reopen_expired_lead` closes it before reopening the transfer — otherwise the one-open-work-item
-- index would refuse the reopen. A nurture call already in progress refuses the reopen instead
-- (LEAD_BEING_DIALLED): two agents must not hold the same person.
--
-- Idempotent: a second call for the same transfer finds the nurture work item and does nothing.
-- ---------------------------------------------------------------------------

alter table public.lead_queue
  add column if not exists nurtured_from_work_item_id uuid references public.lead_queue(id) on delete set null;

create index if not exists lead_queue_nurtured_from_idx
  on public.lead_queue (nurtured_from_work_item_id)
  where nurtured_from_work_item_id is not null;

create or replace function public.nurture_expired_transfer(
  p_tenant_id uuid,
  p_work_item_id uuid,
  p_queue boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  q public.lead_queue;
  v_lead record;
  v_existing uuid;
  v_new uuid;
begin
  select * into q from public.lead_queue where id = p_work_item_id and tenant_id = p_tenant_id for update;
  if not found then
    return jsonb_build_object('nurtured', false, 'reason', 'not_found');
  end if;
  if q.status <> 'expired' or q.partner_id is null or q.sla_expired_at is null then
    -- Reopened, claimed or never an inbound transfer: the ladder's expiry no longer applies.
    return jsonb_build_object('nurtured', false, 'reason', 'not_an_expired_transfer');
  end if;

  select id into v_existing from public.lead_queue
   where tenant_id = p_tenant_id and nurtured_from_work_item_id = q.id
   limit 1;
  if v_existing is not null then
    return jsonb_build_object('nurtured', true, 'workItemId', v_existing, 'duplicate', true);
  end if;

  select l.id, l.lead_state into v_lead from public.agent_leads l
   where l.id = q.lead_id and l.tenant_id = p_tenant_id for update;
  if not found then
    return jsonb_build_object('nurtured', false, 'reason', 'lead_missing');
  end if;
  -- A lead that is closed, exhausted or being worked is not the ladder's to move.
  if v_lead.lead_state in ('closed', 'exhausted', 'working') then
    return jsonb_build_object('nurtured', false, 'reason', 'lead_' || v_lead.lead_state);
  end if;

  update public.agent_leads
     set lead_state = 'nurture', next_dial_after = now(), next_preferred_slot = null, updated_at = now()
   where id = q.lead_id and tenant_id = p_tenant_id;

  if coalesce(p_queue, true) and not exists (
    select 1 from public.lead_queue other
     where other.lead_id = q.lead_id and other.status in ('unclaimed', 'claimed')
  ) then
    insert into public.lead_queue
      (tenant_id, lead_id, product_line, pipeline_id, stage_id, stage_key, status, tier, nurtured_from_work_item_id)
    values
      (p_tenant_id, q.lead_id, q.product_line, q.pipeline_id, q.stage_id, q.stage_key, 'unclaimed', 100, q.id)
    returning id into v_new;
  end if;

  insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
  values ('system', 'tenant.lead_sla_nurtured', 'lead_queue', q.id::text,
          jsonb_build_object('leadId', q.lead_id, 'dialerWorkItemId', v_new, 'queued', v_new is not null));

  return jsonb_build_object('nurtured', true, 'workItemId', v_new, 'queued', v_new is not null);
end;
$function$;

revoke all on function public.nurture_expired_transfer(uuid, uuid, boolean) from public, anon, authenticated, tenant_app;
grant execute on function public.nurture_expired_transfer(uuid, uuid, boolean) to service_role;

-- ── reopening an expired transfer takes the lead back out of nurture ───────
--
-- 20260913190000's body, with the nurture work item closed first. Signature unchanged.
create or replace function public.reopen_expired_lead(p_tenant_id uuid, p_work_item_id uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare q public.lead_queue;
begin
  if not exists (select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id
    where tu.tenant_id = p_tenant_id and tu.user_id = p_actor and tu.accepted_at is not null and u.status = 'active'
      and tu.role in ('owner', 'producer', 'assistant')) then raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED'; end if;
  select * into q from public.lead_queue where id = p_work_item_id and tenant_id = p_tenant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'WORK_ITEM_NOT_FOUND'; end if;
  if q.status = 'unclaimed' then return jsonb_build_object('id', q.id, 'status', q.status, 'duplicate', true); end if;
  if q.status <> 'expired' then raise exception using errcode = 'P0001', message = 'LEAD_NOT_EXPIRED'; end if;

  -- The nurture call that expiry queued (20260924230400). Being dialled now: refuse, so two agents
  -- never hold the same person. Still waiting: close it, and the lead is a transfer again.
  if exists (select 1 from public.lead_queue n
              where n.tenant_id = p_tenant_id and n.nurtured_from_work_item_id = q.id
                and n.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active')) then
    raise exception using errcode = 'P0001', message = 'LEAD_BEING_DIALLED';
  end if;
  update public.lead_queue n set status = 'closed', updated_at = now()
   where n.tenant_id = p_tenant_id and n.nurtured_from_work_item_id = q.id and n.status = 'unclaimed';
  update public.agent_leads l set lead_state = 'fresh', next_dial_after = null, next_preferred_slot = null, updated_at = now()
   where l.id = q.lead_id and l.tenant_id = p_tenant_id and l.lead_state = 'nurture';

  update public.lead_queue set status = 'unclaimed', queued_at = now(), sla_warned_at = null,
    sla_escalated_at = null, sla_partner_notified_at = null, sla_expired_at = null, updated_at = now()
    where id = q.id returning * into q;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
    values ('tenant', p_actor, 'tenant.lead_sla_reopened', 'lead_queue', q.id::text, jsonb_build_object('leadId', q.lead_id));
  return jsonb_build_object('id', q.id, 'status', q.status, 'queued_at', q.queued_at, 'duplicate', false);
end;
$$;

revoke all on function public.reopen_expired_lead(uuid, uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.reopen_expired_lead(uuid, uuid, uuid) to service_role;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'reopen_expired_lead'
       and pg_get_function_identity_arguments(p.oid) = 'p_tenant_id uuid, p_work_item_id uuid, p_actor uuid'
       and p.prosrc like '%nurtured_from_work_item_id%'
  ) then
    raise exception 'reopen_expired_lead does not close the nurture work item first';
  end if;
  -- The ladder itself is 20260924150000's and is not touched here.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'run_unclaimed_sla' and p.prosrc like '%q.partner_id is not null%'
  ) then
    raise exception 'run_unclaimed_sla lost its inbound-only predicate';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924230400', 'unclaimed_sla_expiry_becomes_a_nurture_lead') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [12/22] 20260924240000_lead_post_rejection_reasons_for_consent_dob_and_licence.sql ───
begin;

-- ---------------------------------------------------------------------------
-- Settings → Lead posting: four more reasons a vendor post is refused.
--
-- The board's rejection meters read "No consent text", "Missing consent IP", "Unparseable date of
-- birth" and "State not licensed". The post path (lib/leadPost/service.ts) now refuses a post for
-- each of them, and records the refusal in tenant_lead_post_log under its own code so the meters
-- can count it:
--
--   missing_consent_text     no consent_text on the post (after the vendor's field map)
--   missing_consent_ip       no consent IP (consent_ip, or ip), or one that is not an IP address
--   invalid_date_of_birth    a date_of_birth that was sent but cannot be read as a real date
--   state_not_licensed       the agency holds no current licence in the lead's state
--
-- `reason_code` is a closed vocabulary (20260913320000), so the check constraint has to learn the
-- four codes. Until this file is applied the post path still refuses the post with the precise code
-- in its response, and falls back to the nearest older code for the log row (missing_required_field
-- or unknown_state) so the billing record is never lost.
--
-- A missing consent CERTIFICATE (TrustedForm, Jornaya) is still not a rejection: LA-2.6 says flag,
-- do not block. Consent text and the consent IP are the consent itself, not a certificate of it.
--
-- Idempotent: the constraint is dropped and re-added with the full list.
-- ---------------------------------------------------------------------------

alter table public.tenant_lead_post_log
  drop constraint if exists tenant_lead_post_log_reason_code_check;

alter table public.tenant_lead_post_log
  add constraint tenant_lead_post_log_reason_code_check check (reason_code in (
    'accepted',
    'duplicate',
    'suppressed_litigator',
    'suppressed_internal',
    'suppressed_dnc',
    'invalid_phone',
    'missing_required_field',
    'unknown_state',
    'campaign_not_accepting',
    'scrub_unavailable',
    'rate_limited',
    'unauthorised',
    'missing_consent_text',
    'missing_consent_ip',
    'invalid_date_of_birth',
    'state_not_licensed'
  ));

comment on constraint tenant_lead_post_log_reason_code_check on public.tenant_lead_post_log is
  'Closed vocabulary of post outcomes. Settings → Lead posting labels each one (lib/leadPost/types.ts REJECTION_LABELS).';

-- The licence check reads one (tenant_id, state) row per post; licenses_unique_state already
-- indexes exactly that, so no index is added here.

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924240000', 'lead_post_rejection_reasons_for_consent_dob_and_licence') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [13/22] 20260924240100_pipelines_partner_type_is_optional.sql ─────────────────
begin;

-- ---------------------------------------------------------------------------
-- Settings → Pipelines: a pipeline need not belong to a partner type.
--
-- The board lists "Outbound final expense" and "Inbound transfers" with no partner type ("—") beside
-- "Partner submissions · Affiliate". The model made partner_type mandatory, so those pipelines could
-- not exist: every pipeline had to be a publisher, marketing or affiliate pipeline.
--
-- Partner routing is unchanged by this file. Every reader that routes a partner's lead looks the
-- pipeline up BY partner type (`partner_type = <the partner's type> and is_default`), and a NULL
-- never equals anything, so a pipeline with no partner type is simply never a partner default.
-- It is reached the other ways a pipeline is reached: a disposition mapped to one of its stages, a
-- lead moved into it, and — when it is the default with no partner type — leads that arrive with no
-- partner at all (list imports and vendor posts; lib/pipelines/service.ts resolveUnpartneredEntry).
--
-- What NULL needs, because the existing uniques do not cover it (NULLs are distinct in a unique):
--   · a name is unique among a tenant's pipelines with no partner type, as it is within a type;
--   · at most one of them is the default.
--
-- Also: one grouped count of leads per pipeline and stage for the settings screen, which was
-- counting with one request per stage (tenant_pipeline_lead_counts).
--
-- Additive and idempotent. The application degrades before this is applied: a pipeline with no
-- partner type answers 503 with "needs a database update", and the counts fall back to per-stage
-- counting.
-- ---------------------------------------------------------------------------

alter table public.tenant_pipelines alter column partner_type drop not null;

create unique index if not exists tenant_pipelines_unpartnered_name_idx
  on public.tenant_pipelines (tenant_id, name)
  where partner_type is null;

create unique index if not exists tenant_pipelines_one_unpartnered_default_idx
  on public.tenant_pipelines (tenant_id)
  where is_default and partner_type is null;

comment on column public.tenant_pipelines.partner_type is
  'The partner type whose leads default into this pipeline. NULL: no partner type — reached by disposition routing, by moving a lead, or (as the unpartnered default) by imports and vendor posts.';

-- ── leads per pipeline and stage, in one statement ─────────────────────────
create or replace function public.tenant_pipeline_lead_counts(p_tenant_id uuid)
returns table(pipeline_id uuid, stage_id uuid, leads bigint)
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  -- Served by agent_leads (tenant_id, pipeline_id, stage_id, created_at desc).
  select l.pipeline_id, l.stage_id, count(*)::bigint
    from public.agent_leads l
   where l.tenant_id = p_tenant_id
   group by l.pipeline_id, l.stage_id
$function$;

revoke all on function public.tenant_pipeline_lead_counts(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_pipeline_lead_counts(uuid) to service_role;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924240100', 'pipelines_partner_type_is_optional') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [14/22] 20260924240200_dispositions_next_action_is_a_setting.sql ──────────────
begin;

-- ---------------------------------------------------------------------------
-- Settings → Dispositions · the "Next action" column becomes a setting the dialer honours.
--
-- The board's Next action reads "Next cadence attempt", "Retry in 20 minutes", "Rest 90 days",
-- "Book a time · required". The screen could only show one of four phrases derived from the key
-- and `ends_call`, and none of them could be changed. This adds the setting and makes
-- `complete_existing_dial_disposition` act on it.
--
--   next_action   next_action_minutes   what the dialer does after the outcome
--   cadence       null                  the tenant's retry cadence (schedule_next_attempt)
--   retry         1 … 525600            back in the queue after exactly that long; the cadence's
--                                       attempt ceiling still applies
--   rest          1 … 525600            off the dialer for that long, then served again as a
--                                       nurture lead
--   close         null                  closed, no further attempts
--   callback      null                  callback_scheduled only: a callback is booked
--   suppress      null                  do_not_call only: suppressed and closed
--
-- `ends_call` (20260924140000) stays, and a trigger keeps it consistent with the next action:
-- close, rest, callback and suppress end dialing; cadence and retry do not. An older writer that
-- changes only `ends_call` still works: the next action is re-derived from it (close / cadence).
--
-- Every existing row is seeded from exactly what the dialer does for it today, so nothing changes
-- until a tenant edits an outcome. A key with no row (the dialer's no answer / voicemail / busy)
-- still falls back to the built-in behaviour; a tenant that adds an outcome with that key gets its
-- own setting read.
--
-- Requires 20260924140000. The function body below is derived from that file's body, not retyped:
-- only the flag read, the rest branch, the retry timing, the routing set and the queue status for a
-- rest change. Additive and idempotent; lib/dispositions reads the columns tolerantly.
-- ---------------------------------------------------------------------------

alter table public.dispositions add column if not exists next_action text;
alter table public.dispositions add column if not exists next_action_minutes integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dispositions_next_action_known') then
    alter table public.dispositions
      add constraint dispositions_next_action_known
      check (next_action is null or next_action in ('cadence', 'retry', 'rest', 'close', 'callback', 'suppress'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dispositions_next_action_minutes_shape') then
    -- A delay belongs to retry and rest, and only to them; a year is the longest.
    alter table public.dispositions
      add constraint dispositions_next_action_minutes_shape
      check (
        (next_action in ('retry', 'rest') and next_action_minutes between 1 and 525600)
        or (next_action is distinct from 'retry' and next_action is distinct from 'rest' and next_action_minutes is null)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'dispositions_fixed_next_actions') then
    -- The two compliance branches the dialer runs first cannot be configured away, and no other
    -- outcome can claim them.
    alter table public.dispositions
      add constraint dispositions_fixed_next_actions
      check (
        next_action is null
        or (disposition_key = 'do_not_call' and next_action = 'suppress')
        or (disposition_key = 'callback_scheduled' and next_action = 'callback')
        or (disposition_key not in ('do_not_call', 'callback_scheduled') and next_action not in ('suppress', 'callback'))
      );
  end if;
end $$;

create or replace function public.disposition_default_next_action(p_disposition_key text, p_ends_call boolean)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case
    when p_disposition_key = 'do_not_call' then 'suppress'
    when p_disposition_key = 'callback_scheduled' then 'callback'
    when coalesce(p_ends_call, public.disposition_default_ends_call(p_disposition_key)) then 'close'
    else 'cadence'
  end
$$;

revoke all on function public.disposition_default_next_action(text, boolean) from public, anon, authenticated;
grant execute on function public.disposition_default_next_action(text, boolean) to tenant_app, service_role;

-- Runs after dispositions_fill_ends_call (triggers fire in name order), so ends_call is already set.
create or replace function public.dispositions_keep_next_action()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'UPDATE'
     and new.next_action is not distinct from old.next_action
     and new.ends_call is distinct from old.ends_call then
    -- Only the flag changed: an older writer. Follow it.
    new.next_action := public.disposition_default_next_action(new.disposition_key, new.ends_call);
    new.next_action_minutes := null;
  elsif new.next_action is null then
    new.next_action := public.disposition_default_next_action(new.disposition_key, new.ends_call);
    new.next_action_minutes := null;
  end if;
  new.ends_call := new.next_action in ('close', 'rest', 'callback', 'suppress');
  return new;
end;
$$;

drop trigger if exists dispositions_keep_next_action on public.dispositions;
create trigger dispositions_keep_next_action before insert or update on public.dispositions
  for each row execute function public.dispositions_keep_next_action();

-- Seed and describe the columns. Inside a block only so a parse-check run, which cannot add the
-- columns, does not trip on them; applied for real, the columns exist and this always runs.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'dispositions' and column_name = 'next_action') then
    update public.dispositions
       set next_action = public.disposition_default_next_action(disposition_key, ends_call)
     where next_action is null;

    comment on column public.dispositions.next_action is
      'What the dialer does after this outcome: cadence, retry (after next_action_minutes), rest (for next_action_minutes), close, callback (callback_scheduled only), suppress (do_not_call only).';
    comment on column public.dispositions.next_action_minutes is
      'The retry delay or rest period, in minutes. Set only for retry and rest.';
  end if;
end $$;

-- ── the dialer honours it ──────────────────────────────────────────────────
create or replace function public.complete_existing_dial_disposition(
  p_tenant_id uuid,
  p_attempt_id uuid,
  p_agent_user_id uuid,
  p_disposition text,
  p_dial_clicked_at timestamptz default null,
  p_provider_call_id text default null
)
returns table(lead_state text, next_dial_after timestamptz, next_slot text, suppressed boolean, reason text)
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_attempt public.tenant_call_attempts;
  v_item public.lead_queue;
  v_lead public.agent_leads;
  v_phone text;
  v_slot text;
  v_now timestamptz := clock_timestamp();
  v_sched record;
  v_due_at timestamptz;
  v_due_slot text;
  v_stage_id uuid;
  v_stage_pipeline uuid;
  v_new_state text;
  v_suppressed boolean := false;
  v_reason text;
  v_existing_next_dial_after timestamptz;
  v_existing_next_slot text;
  v_ends_call boolean;
  v_next_action text;
  v_next_minutes integer;
begin
  select * into v_attempt
    from public.tenant_call_attempts
   where id = p_attempt_id and tenant_id = p_tenant_id and agent_id = p_agent_user_id
   for update;
  if not found then raise exception 'CALL_ATTEMPT_NOT_FOUND'; end if;

  -- An inbound return call has no work item by design: it did not come from the queue, so nothing
  -- was ever claimed. Every other disposition still requires one, because every other disposition
  -- moves the queue row it belongs to.
  if v_attempt.work_item_id is null and p_disposition <> 'inbound_return_call' then
    raise exception 'CALL_ATTEMPT_WORK_ITEM_MISSING';
  end if;

  if v_attempt.disposition is not null then
    if v_attempt.disposition <> p_disposition then raise exception 'CALL_ATTEMPT_ALREADY_DISPOSITIONED'; end if;
    select l.lead_state, l.next_dial_after, l.next_preferred_slot
      into v_new_state, v_existing_next_dial_after, v_existing_next_slot
      from public.agent_leads l where l.id = v_attempt.lead_id and l.tenant_id = p_tenant_id;
    return query select v_new_state, v_existing_next_dial_after, v_existing_next_slot, false, 'Disposition was already recorded for this attempt.';
    return;
  end if;
  if v_attempt.disclosure_confirmed_at is null then raise exception 'DISCLOSURE_NOT_CONFIRMED'; end if;
  if coalesce(v_attempt.dial_clicked_at, p_dial_clicked_at) is null then raise exception 'DIAL_NOT_RECORDED'; end if;

  select * into v_lead from public.agent_leads
   where id = v_attempt.lead_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'LEAD_NOT_FOUND'; end if;

  -- ── the inbound return call, handled before anything is mutated ──────────
  --
  -- Records the call and returns the lead's cadence EXACTLY as it already stood. No
  -- `attempts_made` increment, no `schedule_next_attempt`, no `lead_queue` write. The lead's place
  -- in the queue, its retry timer and its next slot are all left where the outbound cadence put
  -- them, which is decision 1's whole requirement.
  if p_disposition = 'inbound_return_call' then
    update public.tenant_call_attempts
       set disposition = p_disposition,
           dial_clicked_at = coalesce(dial_clicked_at, p_dial_clicked_at, v_now),
           provider_call_id = coalesce(provider_call_id, p_provider_call_id)
     where id = v_attempt.id;

    insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
    values ('tenant', p_agent_user_id, 'tenant.dial_dispositioned', 'tenant_call_attempts', v_attempt.id::text,
            jsonb_build_object('leadId', v_lead.id, 'disposition', p_disposition,
                               'leadState', v_lead.lead_state, 'countsTowardCadence', false));

    return query select v_lead.lead_state, v_lead.next_dial_after, v_lead.next_preferred_slot, false,
                        'Logged as an inbound return call. The outbound cadence is unchanged and no attempt was used.';
    return;
  end if;

  select * into v_item from public.lead_queue
   where id = v_attempt.work_item_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'WORK_ITEM_NOT_FOUND'; end if;

  v_phone := v_lead.values->>'phone';
  v_slot := coalesce(v_attempt.slot, current_slot_for_state(v_lead.values->>'state', v_now), 'late_morning');
  update public.tenant_call_attempts
     set disposition = p_disposition,
         dial_clicked_at = coalesce(dial_clicked_at, p_dial_clicked_at),
         provider_call_id = coalesce(provider_call_id, p_provider_call_id)
   where id = v_attempt.id;
  update public.agent_leads set attempts_made = coalesce(attempts_made, 0) + 1 where id = v_lead.id;

  -- The tenant's "ends dialing" flag, read from its own outcome row. A key with no row (the
  -- dialer's attempt outcomes: no answer, voicemail, busy) falls back to the built-in default, so a
  -- tenant that has changed nothing gets exactly the behaviour it had before this migration.
  -- And its next action (20260924240200): a fixed retry delay, or a rest period, instead of the
  -- cadence's own timing. A key with no row has no next action and behaves exactly as before.
  select d.ends_call, d.next_action, d.next_action_minutes into v_ends_call, v_next_action, v_next_minutes
    from public.dispositions d
   where d.tenant_id = p_tenant_id and d.disposition_key = p_disposition;
  v_ends_call := coalesce(v_ends_call, public.disposition_default_ends_call(p_disposition));

  if p_disposition = 'do_not_call' then
    if v_phone is not null then
      perform suppress_phone(p_tenant_id, v_phone, 'internal', 'Agent recorded do not call on the dialer', 'disposition', p_agent_user_id);
      v_suppressed := true;
    end if;
    v_new_state := 'closed';
    v_reason := 'Added to the do-not-call list permanently. This lead will never be served again.';
  elsif p_disposition = 'callback_scheduled' then
    v_new_state := 'working';
    v_reason := 'A callback is scheduled; the cadence does not apply.';
  elsif v_ends_call and v_next_action = 'rest' and v_next_minutes is not null then
    -- Rest: the lead leaves the dialer for the configured period and is then served again, as a
    -- nurture lead (serve_next_lead tier 6 once next_dial_after has passed). Not closed: a rested
    -- lead is one the agency still wants to call, later.
    v_new_state := 'nurture';
    v_due_at := v_now + make_interval(mins => v_next_minutes);
    v_reason := format('Resting until %s. The lead is served again after that.', to_char(v_due_at, 'Dy DD Mon'));
    update public.agent_leads set lead_state = 'nurture', next_dial_after = v_due_at, next_preferred_slot = null where id = v_lead.id;
  elsif v_ends_call and p_disposition in ('wrong_number', 'disconnected') then
    v_new_state := 'closed';
    v_reason := 'Closed and flagged for a vendor credit claim.';
  elsif v_ends_call then
    v_new_state := 'closed';
    v_reason := 'Closed. No further attempts.';
  else
    select * into v_sched from schedule_next_attempt(p_tenant_id, v_lead.id, p_disposition, v_now);
    if v_sched.exhausted then
      v_new_state := 'exhausted';
      v_reason := format('Attempt %s reached the ceiling. Moved to nurture and no longer served.', coalesce(v_lead.attempts_made, 0) + 1);
      update public.agent_leads set lead_state = 'exhausted', next_dial_after = null, next_preferred_slot = null where id = v_lead.id;
    else
      v_new_state := 'retry';
      v_due_at := v_sched.due_at;
      v_due_slot := v_sched.slot;
      -- A fixed retry delay replaces the cadence's timing but not its ceiling: the exhausted branch
      -- above has already run, so "Retry in 20 minutes" cannot retry for ever. The slot is the one
      -- the retry falls in, so serve_next_lead's slot rule serves it when it comes due.
      if v_next_action = 'retry' and v_next_minutes is not null then
        v_due_at := v_now + make_interval(mins => v_next_minutes);
        v_due_slot := coalesce(current_slot_for_state(v_lead.values->>'state', v_due_at), v_sched.slot);
      end if;
      v_reason := format('Attempt %s scheduled for %s in the %s slot.', v_sched.attempt_number, to_char(v_due_at, 'Dy DD Mon HH24:MI'), replace(v_due_slot, '_', ' '));
      update public.agent_leads set lead_state = 'retry', next_dial_after = v_due_at, next_preferred_slot = v_due_slot where id = v_lead.id;
    end if;
  end if;

  if v_new_state in ('closed', 'working') then
    update public.agent_leads set lead_state = v_new_state, next_dial_after = null, next_preferred_slot = null where id = v_lead.id;
  end if;

  -- Route a TERMINAL outcome to the pipeline reserved for it.
  --
  -- 'closed', 'exhausted' and 'working'. Everything except 'retry'.
  --
  -- 'working' is reached by exactly one disposition, callback_scheduled, which is mapped to
  -- "Needs Callback" — a dedicated pipeline for that outcome is the whole point, and the lead
  -- is coming back at a time the customer named rather than on the dialer's cadence.
  --
  -- 'retry' is the one that must never be here. That lead is going back into the queue for the
  -- next attempt, and relocating it would take it off the board the dialer serves from —
  -- a worse failure than not routing at all, and a silent one.
  --
  -- The lookup is deliberately not confined to the lead's current pipeline: the destination is a
  -- DIFFERENT pipeline, reserved for that disposition. An unmapped disposition leaves both ids
  -- null and the lead where it is, so this is opt-in per disposition and a tenant that has
  -- configured nothing sees no change at all.
  -- 'nurture' (a rest) routes like the other outcomes that take the lead off the cadence.
  if v_new_state in ('closed', 'exhausted', 'working', 'nurture') then
    select ps.id, ps.pipeline_id into v_stage_id, v_stage_pipeline
      from public.stage_dispositions sd
      join public.tenant_pipeline_stages ps on ps.id = sd.stage_id
     where sd.tenant_id = p_tenant_id
       and sd.disposition_key = p_disposition
       and not ps.is_archived
     limit 1;
    if v_stage_id is not null then
      update public.agent_leads
         set stage_id = v_stage_id, pipeline_id = v_stage_pipeline
       where id = v_lead.id and tenant_id = p_tenant_id;
    end if;
  end if;
  update public.lead_queue
     -- A rested lead stays unclaimed so it can be served when the rest ends.
     set status = case when v_new_state in ('retry', 'nurture') then 'unclaimed' else 'completed' end,
         claimed_by = null, owner_user_id = null, locked_until = null,
         -- coalesce so an unmapped disposition leaves the work item alone. The lead and its
         -- queue row move together or not at all: a board renders from both, and a lead in
         -- pipeline A displaying a stage from pipeline B appears in no column.
         stage_id = coalesce(v_stage_id, stage_id),
         pipeline_id = coalesce(v_stage_pipeline, pipeline_id),
         disposition = p_disposition, disposition_at = v_now, disposition_by = p_agent_user_id,
         updated_at = v_now
   where id = v_item.id and tenant_id = p_tenant_id;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('tenant', p_agent_user_id, 'tenant.dial_dispositioned', 'tenant_call_attempts', v_attempt.id::text,
          jsonb_build_object('workItemId', v_item.id, 'leadId', v_lead.id, 'disposition', p_disposition, 'leadState', v_new_state));
  -- Say where it went. The agent is told the lead closed; without this they are not told it
  -- also left their board.
  if v_stage_id is not null then
    v_reason := v_reason || format(' Moved to %s.',
      (select ps.name from public.tenant_pipeline_stages ps where ps.id = v_stage_id));
  end if;

  return query select v_new_state,
                      v_due_at,
                      v_due_slot,
                      v_suppressed, v_reason;
end;
$function$;

revoke all on function public.complete_existing_dial_disposition(uuid, uuid, uuid, text, timestamptz, text) from public, anon, authenticated, tenant_app;
grant execute on function public.complete_existing_dial_disposition(uuid, uuid, uuid, text, timestamptz, text) to service_role;

do $$
declare
  v_src text;
  v_count integer;
begin
  -- A parse-check run cannot add the columns or replace the function; there is nothing to verify.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'dispositions' and column_name = 'next_action') then
    raise notice 'dispositions.next_action is not present; skipping the dialer body check';
    return;
  end if;

  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_existing_dial_disposition';
  if v_count <> 1 then
    raise exception 'expected exactly one complete_existing_dial_disposition, found %', v_count;
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'complete_existing_dial_disposition';

  if strpos(v_src, 'd.next_action') = 0 then raise exception 'the dialer does not read the next action'; end if;
  if strpos(v_src, 'd.ends_call') = 0 then raise exception 'the dialer does not read the ends_call setting'; end if;
  if strpos(v_src, 'disposition_default_ends_call') = 0 then raise exception 'a key with no row lost its default'; end if;
  if strpos(v_src, $q$v_new_state in ('closed', 'exhausted', 'working', 'nurture')$q$) = 0 then raise exception 'pipeline routing was lost'; end if;
  if strpos(v_src, $q$'working', 'nurture', 'retry')$q$) > 0 then raise exception 'a retry now moves pipeline'; end if;
  if strpos(v_src, 'v_sched.exhausted') = 0 then raise exception 'a fixed retry escaped the attempt ceiling'; end if;
  if strpos(v_src, 'inbound_return_call') = 0 then raise exception 'the inbound return branch was lost'; end if;
  if strpos(v_src, 'suppress_phone') = 0 then raise exception 'the do-not-call write was lost'; end if;
  if strpos(v_src, 'coalesce(v_stage_id') = 0 then raise exception 'the work item no longer follows the lead'; end if;

  raise notice 'Settings: the next action is now a per-tenant outcome setting the dialer reads';
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924240200', 'dispositions_next_action_is_a_setting') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [15/22] 20260924260000_commission_statements.sql ──────────────────────────────
begin;

-- Book of Business › Statements: carrier commission statements, their lines, and the matches a
-- person accepted.
--
-- The commission ledger's board says "Nothing is recorded automatically without a source. Every
-- entry will keep the statement it came from, the policy it matched and who accepted the match."
-- These tables are that sentence:
--
--   tenant_commission_statements        one uploaded file: carrier, period, who uploaded it, the
--                                       file's name and SHA-256, the column mapping used. Never
--                                       deleted; a wrong import is VOIDED with a reason.
--   tenant_commission_statement_lines   one row of that file, kept verbatim in `raw`, plus what
--                                       was read out of it (policy number, insured, amount, kind,
--                                       date). A row that could not be read keeps its error and
--                                       stays visible; it never posts.
--   tenant_commission_statement_matches line → tenant_policies row. `exact` proposals are made by
--                                       the import (policy number + carrier); `manual` ones by a
--                                       person. Only an ACCEPTED match posts, and it records
--                                       accepted_by / accepted_at.
--   tenant_statement_column_mappings    the column mapping last used per carrier, so the second
--                                       statement from a carrier needs no mapping.
--
-- Two views read them: tenant_commission_statement_entries (accepted lines on statements that
-- are not voided — what the ledger posts) and tenant_commission_statement_summaries (per-statement
-- line counts for the history list).
--
-- Written by the service role after the API has checked the caller (owner or bookkeeper, with the
-- statement_ingestion feature and full access); the tenant plane may read its own tenant's rows.
-- No role is granted DELETE on any of the three record tables: "never delete statements" is a
-- privilege, not a convention. (Tenant removal still cascades: FK actions run as the table owner.)
--
-- Additive and idempotent. The import and review functions are in 20260924260100.

-- ── statements ────────────────────────────────────────────────────────────────
create table if not exists public.tenant_commission_statements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  original_filename text not null,
  file_sha256 text not null,
  headers jsonb not null default '[]'::jsonb,
  column_mapping jsonb not null default '{}'::jsonb,
  row_count integer not null,
  status text not null default 'review',
  uploaded_by uuid references public.users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  void_reason text,
  voided_by uuid references public.users(id) on delete set null,
  voided_at timestamptz,
  constraint tenant_commission_statements_period check (period_end >= period_start),
  constraint tenant_commission_statements_filename check (char_length(btrim(original_filename)) between 1 and 255),
  constraint tenant_commission_statements_sha256 check (file_sha256 ~ '^[0-9a-f]{64}$'),
  constraint tenant_commission_statements_headers check (jsonb_typeof(headers) = 'array'),
  constraint tenant_commission_statements_mapping check (jsonb_typeof(column_mapping) = 'object'),
  constraint tenant_commission_statements_row_count check (row_count between 0 and 10000),
  constraint tenant_commission_statements_status check (status in ('review', 'reviewed', 'voided')),
  constraint tenant_commission_statements_void_complete check (
    (status = 'voided') = (voided_at is not null)
    and (status <> 'voided' or char_length(btrim(coalesce(void_reason, ''))) between 3 and 500)
  )
);

create index if not exists tenant_commission_statements_tenant_uploaded_idx
  on public.tenant_commission_statements (tenant_id, uploaded_at desc);
create index if not exists tenant_commission_statements_carrier_idx
  on public.tenant_commission_statements (carrier_id);
create index if not exists tenant_commission_statements_uploaded_by_idx
  on public.tenant_commission_statements (uploaded_by);
create index if not exists tenant_commission_statements_voided_by_idx
  on public.tenant_commission_statements (voided_by);
-- Duplicate detection: the same file for the same carrier and period is refused while the first
-- import stands. Voiding the first import is how a corrected re-import is allowed.
create unique index if not exists tenant_commission_statements_no_duplicate_idx
  on public.tenant_commission_statements (tenant_id, carrier_id, period_start, period_end, file_sha256)
  where status <> 'voided';

-- ── lines ─────────────────────────────────────────────────────────────────────
create table if not exists public.tenant_commission_statement_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  statement_id uuid not null references public.tenant_commission_statements(id) on delete cascade,
  line_number integer not null,
  raw jsonb not null,
  policy_number text,
  insured_name text,
  amount_cents bigint,
  kind text,
  line_date date,
  parse_error text,
  review_status text not null default 'unmatched',
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint tenant_commission_statement_lines_unique_line unique (statement_id, line_number),
  constraint tenant_commission_statement_lines_line_number check (line_number >= 1),
  constraint tenant_commission_statement_lines_raw check (jsonb_typeof(raw) = 'object'),
  constraint tenant_commission_statement_lines_policy_number check (policy_number is null or char_length(policy_number) <= 120),
  constraint tenant_commission_statement_lines_insured check (insured_name is null or char_length(insured_name) <= 200),
  constraint tenant_commission_statement_lines_kind check (kind is null or kind in ('advance', 'commission', 'chargeback', 'adjustment')),
  constraint tenant_commission_statement_lines_review_status check (review_status in ('proposed', 'accepted', 'unmatched', 'left_unmatched', 'error')),
  -- An unreadable row is exactly the rows with an error, and every other row has an amount and a kind.
  constraint tenant_commission_statement_lines_error_is_unpostable check ((review_status = 'error') = (parse_error is not null)),
  constraint tenant_commission_statement_lines_postable_is_complete check (review_status = 'error' or (amount_cents is not null and kind is not null))
);

create index if not exists tenant_commission_statement_lines_tenant_status_idx
  on public.tenant_commission_statement_lines (tenant_id, review_status);
create index if not exists tenant_commission_statement_lines_reviewed_by_idx
  on public.tenant_commission_statement_lines (reviewed_by);

-- ── matches ───────────────────────────────────────────────────────────────────
create table if not exists public.tenant_commission_statement_matches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  line_id uuid not null references public.tenant_commission_statement_lines(id) on delete cascade,
  policy_id uuid not null references public.tenant_policies(id) on delete restrict,
  method text not null,
  status text not null default 'proposed',
  proposed_by uuid references public.users(id) on delete set null,
  proposed_at timestamptz not null default now(),
  accepted_by uuid references public.users(id) on delete set null,
  accepted_at timestamptz,
  rejected_by uuid references public.users(id) on delete set null,
  rejected_at timestamptz,
  constraint tenant_commission_statement_matches_method check (method in ('exact', 'manual')),
  constraint tenant_commission_statement_matches_status check (status in ('proposed', 'accepted', 'rejected')),
  constraint tenant_commission_statement_matches_accepted_complete check ((status = 'accepted') = (accepted_at is not null)),
  constraint tenant_commission_statement_matches_rejected_complete check ((status = 'rejected') = (rejected_at is not null)),
  -- A person choosing a policy by hand IS the acceptance; only the import proposes.
  constraint tenant_commission_statement_matches_manual_is_decided check (method = 'exact' or status <> 'proposed')
);

-- One live match per line. Rejected proposals are kept as history beside it.
create unique index if not exists tenant_commission_statement_matches_one_live_idx
  on public.tenant_commission_statement_matches (line_id)
  where status <> 'rejected';
create index if not exists tenant_commission_statement_matches_line_idx
  on public.tenant_commission_statement_matches (line_id);
create index if not exists tenant_commission_statement_matches_tenant_status_idx
  on public.tenant_commission_statement_matches (tenant_id, status);
create index if not exists tenant_commission_statement_matches_policy_idx
  on public.tenant_commission_statement_matches (policy_id);
create index if not exists tenant_commission_statement_matches_proposed_by_idx
  on public.tenant_commission_statement_matches (proposed_by);
create index if not exists tenant_commission_statement_matches_accepted_by_idx
  on public.tenant_commission_statement_matches (accepted_by);
create index if not exists tenant_commission_statement_matches_rejected_by_idx
  on public.tenant_commission_statement_matches (rejected_by);

-- ── remembered column mappings ────────────────────────────────────────────────
create table if not exists public.tenant_statement_column_mappings (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete cascade,
  mapping jsonb not null,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, carrier_id),
  constraint tenant_statement_column_mappings_mapping check (jsonb_typeof(mapping) = 'object')
);
create index if not exists tenant_statement_column_mappings_carrier_idx
  on public.tenant_statement_column_mappings (carrier_id);
create index if not exists tenant_statement_column_mappings_updated_by_idx
  on public.tenant_statement_column_mappings (updated_by);

-- ── what a record may not become ──────────────────────────────────────────────
-- The source of a ledger entry does not change after the fact. A statement's identity, a line's
-- verbatim row and what was read from it, and a match's line/policy/method are fixed at insert; a
-- voided statement stays voided; an accepted or rejected match stays decided. Corrections are a
-- void and a re-import, which leaves both on the record.
create or replace function public.guard_commission_statement_records()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'tenant_commission_statements' then
    if new.tenant_id <> old.tenant_id or new.carrier_id <> old.carrier_id
       or new.period_start <> old.period_start or new.period_end <> old.period_end
       or new.original_filename <> old.original_filename or new.file_sha256 <> old.file_sha256
       or new.headers <> old.headers or new.row_count <> old.row_count
       or new.uploaded_at <> old.uploaded_at then
      raise exception 'A commission statement''s source cannot be changed after import' using errcode = '55000';
    end if;
    if old.status = 'voided' and (new.status <> 'voided' or new.void_reason is distinct from old.void_reason) then
      raise exception 'A voided commission statement stays voided' using errcode = '55000';
    end if;
  elsif tg_table_name = 'tenant_commission_statement_lines' then
    if new.tenant_id <> old.tenant_id or new.statement_id <> old.statement_id or new.line_number <> old.line_number
       or new.raw <> old.raw or new.policy_number is distinct from old.policy_number
       or new.insured_name is distinct from old.insured_name or new.amount_cents is distinct from old.amount_cents
       or new.kind is distinct from old.kind or new.line_date is distinct from old.line_date
       or new.parse_error is distinct from old.parse_error then
      raise exception 'A statement line is kept as imported' using errcode = '55000';
    end if;
    if old.review_status = 'accepted' and new.review_status <> 'accepted' then
      raise exception 'An accepted statement line stays accepted; void the statement to correct it' using errcode = '55000';
    end if;
  elsif tg_table_name = 'tenant_commission_statement_matches' then
    if new.tenant_id <> old.tenant_id or new.line_id <> old.line_id or new.policy_id <> old.policy_id or new.method <> old.method then
      raise exception 'A statement match cannot be pointed somewhere else; reject it and match again' using errcode = '55000';
    end if;
    if old.status <> 'proposed' and new.status <> old.status then
      raise exception 'A decided statement match stays decided' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tenant_commission_statements_guard on public.tenant_commission_statements;
create trigger tenant_commission_statements_guard
  before update on public.tenant_commission_statements
  for each row execute function public.guard_commission_statement_records();
drop trigger if exists tenant_commission_statement_lines_guard on public.tenant_commission_statement_lines;
create trigger tenant_commission_statement_lines_guard
  before update on public.tenant_commission_statement_lines
  for each row execute function public.guard_commission_statement_records();
drop trigger if exists tenant_commission_statement_matches_guard on public.tenant_commission_statement_matches;
create trigger tenant_commission_statement_matches_guard
  before update on public.tenant_commission_statement_matches
  for each row execute function public.guard_commission_statement_records();

-- ── views ─────────────────────────────────────────────────────────────────────
-- What the ledger posts: accepted matches on statements that are not voided. A line with no date
-- posts on the last day of its statement's period.
create or replace view public.tenant_commission_statement_entries
with (security_invoker = true) as
select
  l.id as line_id,
  l.tenant_id,
  s.id as statement_id,
  s.carrier_id,
  s.period_start,
  s.period_end,
  s.original_filename,
  l.line_number,
  l.policy_number as statement_policy_number,
  l.insured_name as statement_insured_name,
  l.amount_cents,
  l.kind,
  l.line_date,
  coalesce(l.line_date, s.period_end) as posted_on,
  m.id as match_id,
  m.policy_id,
  m.method,
  m.accepted_by,
  m.accepted_at
from public.tenant_commission_statement_lines l
join public.tenant_commission_statements s on s.id = l.statement_id and s.tenant_id = l.tenant_id
join public.tenant_commission_statement_matches m on m.line_id = l.id and m.tenant_id = l.tenant_id and m.status = 'accepted'
where s.status <> 'voided';

create or replace view public.tenant_commission_statement_summaries
with (security_invoker = true) as
select
  s.id as statement_id,
  s.tenant_id,
  s.status,
  count(l.id)::integer as line_count,
  (count(l.id) filter (where l.review_status = 'accepted'))::integer as accepted_count,
  (count(l.id) filter (where l.review_status = 'proposed'))::integer as proposed_count,
  (count(l.id) filter (where l.review_status = 'unmatched'))::integer as unmatched_count,
  (count(l.id) filter (where l.review_status = 'left_unmatched'))::integer as left_unmatched_count,
  (count(l.id) filter (where l.review_status = 'error'))::integer as error_count,
  coalesce(sum(l.amount_cents) filter (where l.review_status = 'accepted'), 0)::bigint as accepted_cents,
  coalesce(sum(l.amount_cents) filter (where l.review_status <> 'error'), 0)::bigint as statement_cents
from public.tenant_commission_statements s
left join public.tenant_commission_statement_lines l on l.statement_id = s.id and l.tenant_id = s.tenant_id
group by s.id, s.tenant_id, s.status;

-- ── row level security and grants ─────────────────────────────────────────────
alter table public.tenant_commission_statements enable row level security;
alter table public.tenant_commission_statement_lines enable row level security;
alter table public.tenant_commission_statement_matches enable row level security;
alter table public.tenant_statement_column_mappings enable row level security;

drop policy if exists tenant_commission_statements_tenant_read on public.tenant_commission_statements;
create policy tenant_commission_statements_tenant_read on public.tenant_commission_statements
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists tenant_commission_statement_lines_tenant_read on public.tenant_commission_statement_lines;
create policy tenant_commission_statement_lines_tenant_read on public.tenant_commission_statement_lines
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists tenant_commission_statement_matches_tenant_read on public.tenant_commission_statement_matches;
create policy tenant_commission_statement_matches_tenant_read on public.tenant_commission_statement_matches
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists tenant_statement_column_mappings_tenant_read on public.tenant_statement_column_mappings;
create policy tenant_statement_column_mappings_tenant_read on public.tenant_statement_column_mappings
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_commission_statements from public, anon, authenticated;
revoke all on public.tenant_commission_statement_lines from public, anon, authenticated;
revoke all on public.tenant_commission_statement_matches from public, anon, authenticated;
revoke all on public.tenant_statement_column_mappings from public, anon, authenticated;
revoke all on public.tenant_commission_statement_entries from public, anon, authenticated;
revoke all on public.tenant_commission_statement_summaries from public, anon, authenticated;

-- No DELETE, for anybody.
revoke delete, truncate on public.tenant_commission_statements from service_role, tenant_app;
revoke delete, truncate on public.tenant_commission_statement_lines from service_role, tenant_app;
revoke delete, truncate on public.tenant_commission_statement_matches from service_role, tenant_app;
grant select, insert, update on public.tenant_commission_statements to service_role;
grant select, insert, update on public.tenant_commission_statement_lines to service_role;
grant select, insert, update on public.tenant_commission_statement_matches to service_role;
grant select, insert, update on public.tenant_statement_column_mappings to service_role;
grant select on public.tenant_commission_statement_entries to service_role;
grant select on public.tenant_commission_statement_summaries to service_role;

grant select on public.tenant_commission_statements to tenant_app;
grant select on public.tenant_commission_statement_lines to tenant_app;
grant select on public.tenant_commission_statement_matches to tenant_app;
grant select on public.tenant_statement_column_mappings to tenant_app;
grant select on public.tenant_commission_statement_entries to tenant_app;
grant select on public.tenant_commission_statement_summaries to tenant_app;

-- ── asserted against whatever this database holds ─────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['tenant_commission_statements', 'tenant_commission_statement_lines', 'tenant_commission_statement_matches', 'tenant_statement_column_mappings'] loop
    if to_regclass('public.' || t) is null then
      raise exception '% is missing', t;
    end if;
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = t and c.relrowsecurity
    ) then
      raise exception '% has row level security switched off', t;
    end if;
    if has_table_privilege('tenant_app', 'public.' || t, 'insert')
       or has_table_privilege('tenant_app', 'public.' || t, 'update')
       or has_table_privilege('tenant_app', 'public.' || t, 'delete') then
      raise exception 'the tenant plane can write %', t;
    end if;
    if not has_table_privilege('tenant_app', 'public.' || t, 'select') then
      raise exception 'the tenant plane cannot read %', t;
    end if;
  end loop;
  foreach t in array array['tenant_commission_statements', 'tenant_commission_statement_lines', 'tenant_commission_statement_matches'] loop
    if has_table_privilege('service_role', 'public.' || t, 'delete') then
      raise exception '% can be deleted from; statements are voided, never deleted', t;
    end if;
  end loop;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924260000', 'commission_statements') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [16/22] 20260924260100_commission_statement_import_and_review.sql ─────────────
begin;

-- Book of Business › Statements: importing a statement, and a person deciding its lines.
--
-- Both are one transaction each, because both write several tables and a half-written result is a
-- ledger that disagrees with its own source:
--
--   import_commission_statement        the statement, every line (verbatim), the exact-match
--                                      PROPOSALS the application computed (policy number + carrier;
--                                      lib/ledger/statementMatch.ts), and the carrier's remembered
--                                      column mapping. Nothing posts: a proposal is not a match
--                                      until a person accepts it.
--   decide_commission_statement_lines  a batch of accept / reject / match (by hand) / leave
--                                      unmatched, with the person recorded on each, and the
--                                      statement's review status recomputed.
--
-- Duplicate detection is the partial unique index from 20260924260000: a second import of the same
-- file for the same carrier and period raises unique_violation (23505), which the API answers with
-- a refusal naming the first import.
--
-- Called by the service role only, after the API has checked the caller. Security invoker: the
-- functions run with the service role's own rights, and every row they touch is pinned to
-- p_tenant_id. Requires 20260924260000.

create or replace function public.import_commission_statement(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_carrier_id uuid,
  p_period_start date,
  p_period_end date,
  p_original_filename text,
  p_file_sha256 text,
  p_headers jsonb,
  p_mapping jsonb,
  p_lines jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_statement_id uuid;
  v_count integer;
  v_foreign integer;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'The statement lines must be a list' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_lines);
  if v_count = 0 then
    raise exception 'The statement has no lines' using errcode = '22023';
  end if;
  if v_count > 10000 then
    raise exception 'A statement can hold at most 10,000 lines' using errcode = '22023';
  end if;
  if not exists (select 1 from public.carriers where id = p_carrier_id) then
    raise exception 'Choose a carrier from the carrier library' using errcode = '22023';
  end if;

  -- A proposal may only name a policy in this tenant's book.
  select count(*) into v_foreign
    from jsonb_array_elements(p_lines) e
   where nullif(e->>'proposed_policy_id', '') is not null
     and not exists (
       select 1 from public.tenant_policies p
        where p.id = (e->>'proposed_policy_id')::uuid and p.tenant_id = p_tenant_id
     );
  if v_foreign > 0 then
    raise exception 'A proposed match names a policy outside this workspace' using errcode = '22023';
  end if;

  insert into public.tenant_commission_statements (
    tenant_id, carrier_id, period_start, period_end, original_filename, file_sha256,
    headers, column_mapping, row_count, status, uploaded_by
  )
  values (
    p_tenant_id, p_carrier_id, p_period_start, p_period_end, btrim(p_original_filename), lower(p_file_sha256),
    coalesce(p_headers, '[]'::jsonb), coalesce(p_mapping, '{}'::jsonb), v_count,
    case when exists (select 1 from jsonb_array_elements(p_lines) e where nullif(e->>'parse_error', '') is null)
         then 'review' else 'reviewed' end,
    p_actor_user_id
  )
  returning id into v_statement_id;

  insert into public.tenant_commission_statement_lines (
    tenant_id, statement_id, line_number, raw, policy_number, insured_name, amount_cents, kind,
    line_date, parse_error, review_status
  )
  select
    p_tenant_id,
    v_statement_id,
    (e->>'line_number')::integer,
    coalesce(e->'raw', '{}'::jsonb),
    nullif(btrim(e->>'policy_number'), ''),
    nullif(btrim(e->>'insured_name'), ''),
    (e->>'amount_cents')::bigint,
    nullif(e->>'kind', ''),
    nullif(e->>'line_date', '')::date,
    nullif(e->>'parse_error', ''),
    case
      when nullif(e->>'parse_error', '') is not null then 'error'
      when nullif(e->>'proposed_policy_id', '') is not null then 'proposed'
      else 'unmatched'
    end
  from jsonb_array_elements(p_lines) e;

  insert into public.tenant_commission_statement_matches (tenant_id, line_id, policy_id, method, status)
  select p_tenant_id, l.id, (e->>'proposed_policy_id')::uuid, 'exact', 'proposed'
    from jsonb_array_elements(p_lines) e
    join public.tenant_commission_statement_lines l
      on l.statement_id = v_statement_id and l.line_number = (e->>'line_number')::integer
   where nullif(e->>'proposed_policy_id', '') is not null
     and nullif(e->>'parse_error', '') is null;

  insert into public.tenant_statement_column_mappings (tenant_id, carrier_id, mapping, updated_by, updated_at)
  values (p_tenant_id, p_carrier_id, coalesce(p_mapping, '{}'::jsonb), p_actor_user_id, now())
  on conflict (tenant_id, carrier_id)
  do update set mapping = excluded.mapping, updated_by = excluded.updated_by, updated_at = now();

  return v_statement_id;
end;
$$;

create or replace function public.decide_commission_statement_lines(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_statement_id uuid,
  p_decisions jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_statement public.tenant_commission_statements%rowtype;
  v_line public.tenant_commission_statement_lines%rowtype;
  v_match public.tenant_commission_statement_matches%rowtype;
  v_decision jsonb;
  v_action text;
  v_policy uuid;
  v_accepted integer := 0;
  v_rejected integer := 0;
  v_matched integer := 0;
  v_left integer := 0;
  v_status text;
  v_log jsonb := '[]'::jsonb;
begin
  if p_decisions is null or jsonb_typeof(p_decisions) <> 'array' or jsonb_array_length(p_decisions) = 0 then
    raise exception 'Choose at least one line' using errcode = '22023';
  end if;
  if jsonb_array_length(p_decisions) > 10000 then
    raise exception 'Too many lines in one decision' using errcode = '22023';
  end if;

  select * into v_statement
    from public.tenant_commission_statements
   where id = p_statement_id and tenant_id = p_tenant_id
   for update;
  if not found then
    raise exception 'That statement is not in this workspace' using errcode = 'P0002';
  end if;
  if v_statement.status = 'voided' then
    raise exception 'This statement was voided; its lines can no longer be matched' using errcode = '55000';
  end if;

  for v_decision in select value from jsonb_array_elements(p_decisions) loop
    v_action := v_decision->>'action';

    select * into v_line
      from public.tenant_commission_statement_lines
     where id = nullif(v_decision->>'line_id', '')::uuid
       and statement_id = p_statement_id
       and tenant_id = p_tenant_id
     for update;
    if not found then
      raise exception 'A line is not part of this statement' using errcode = '22023';
    end if;
    if v_line.review_status = 'error' then
      raise exception 'Row % could not be read, so it cannot be matched', v_line.line_number using errcode = '22023';
    end if;
    if v_line.review_status = 'accepted' then
      raise exception 'Row % is already accepted; void the statement to correct it', v_line.line_number using errcode = '55000';
    end if;

    v_match := null;
    v_policy := null;
    select * into v_match
      from public.tenant_commission_statement_matches
     where line_id = v_line.id and tenant_id = p_tenant_id and status = 'proposed'
     for update;

    if v_action = 'accept' then
      if v_match.id is null then
        raise exception 'Row % has no proposed match to accept', v_line.line_number using errcode = '22023';
      end if;
      update public.tenant_commission_statement_matches
         set status = 'accepted', accepted_by = p_actor_user_id, accepted_at = now()
       where id = v_match.id;
      update public.tenant_commission_statement_lines
         set review_status = 'accepted', reviewed_by = p_actor_user_id, reviewed_at = now()
       where id = v_line.id;
      v_accepted := v_accepted + 1;

    elsif v_action = 'reject' then
      if v_match.id is null then
        raise exception 'Row % has no proposed match to reject', v_line.line_number using errcode = '22023';
      end if;
      update public.tenant_commission_statement_matches
         set status = 'rejected', rejected_by = p_actor_user_id, rejected_at = now()
       where id = v_match.id;
      update public.tenant_commission_statement_lines
         set review_status = 'unmatched', reviewed_by = p_actor_user_id, reviewed_at = now()
       where id = v_line.id;
      v_rejected := v_rejected + 1;

    elsif v_action = 'match' then
      v_policy := nullif(v_decision->>'policy_id', '')::uuid;
      if v_policy is null or not exists (
        select 1 from public.tenant_policies where id = v_policy and tenant_id = p_tenant_id
      ) then
        raise exception 'Row %: choose a policy from this workspace''s book', v_line.line_number using errcode = '22023';
      end if;
      if v_match.id is not null and v_match.policy_id = v_policy then
        -- Choosing the proposed policy by hand is accepting the proposal.
        update public.tenant_commission_statement_matches
           set status = 'accepted', accepted_by = p_actor_user_id, accepted_at = now()
         where id = v_match.id;
      else
        if v_match.id is not null then
          update public.tenant_commission_statement_matches
             set status = 'rejected', rejected_by = p_actor_user_id, rejected_at = now()
           where id = v_match.id;
        end if;
        insert into public.tenant_commission_statement_matches (
          tenant_id, line_id, policy_id, method, status, proposed_by, proposed_at, accepted_by, accepted_at
        )
        values (p_tenant_id, v_line.id, v_policy, 'manual', 'accepted', p_actor_user_id, now(), p_actor_user_id, now());
      end if;
      update public.tenant_commission_statement_lines
         set review_status = 'accepted', reviewed_by = p_actor_user_id, reviewed_at = now()
       where id = v_line.id;
      v_matched := v_matched + 1;

    elsif v_action = 'leave_unmatched' then
      if v_match.id is not null then
        update public.tenant_commission_statement_matches
           set status = 'rejected', rejected_by = p_actor_user_id, rejected_at = now()
         where id = v_match.id;
      end if;
      update public.tenant_commission_statement_lines
         set review_status = 'left_unmatched', reviewed_by = p_actor_user_id, reviewed_at = now()
       where id = v_line.id;
      v_left := v_left + 1;

    else
      raise exception 'Unknown decision %', coalesce(v_action, '(none)') using errcode = '22023';
    end if;

    -- What was decided, line by line, for the caller's audit rows: the policy chosen (match), or
    -- the proposal accepted / rejected / set aside.
    v_log := v_log || jsonb_build_array(jsonb_build_object(
      'line_id', v_line.id,
      'line_number', v_line.line_number,
      'action', v_action,
      'policy_id', case when v_action = 'match' then v_policy else v_match.policy_id end,
      'proposed_policy_id', v_match.policy_id
    ));
  end loop;

  v_status := case
    when exists (
      select 1 from public.tenant_commission_statement_lines
       where statement_id = p_statement_id and review_status in ('proposed', 'unmatched')
    ) then 'review'
    else 'reviewed'
  end;
  update public.tenant_commission_statements set status = v_status where id = p_statement_id and status <> v_status;

  return jsonb_build_object(
    'accepted', v_accepted,
    'rejected', v_rejected,
    'matched', v_matched,
    'left_unmatched', v_left,
    'status', v_status,
    'lines', v_log
  );
end;
$$;

revoke all on function public.import_commission_statement(uuid, uuid, uuid, date, date, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.decide_commission_statement_lines(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.import_commission_statement(uuid, uuid, uuid, date, date, text, text, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.decide_commission_statement_lines(uuid, uuid, uuid, jsonb) to service_role;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924260100', 'commission_statement_import_and_review') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [17/22] 20260924265000_policy_lapse_signals.sql ───────────────────────────────
begin;

-- /app/lapse-risk: the signals that put a policy at risk.
--
-- The board is explicit that "a risk score without a reason is not actionable, so no policy will
-- ever appear here without one". Nothing supplied a reason until now: no carrier or payment feed
-- reports a missed draft, so the page could only ever be empty. This is the reason, recorded by a
-- person today (source 'manual') and by a feed later (source 'feed', de-duplicated on source_ref).
--
-- One row per signal. A policy is at risk while it has at least one OPEN signal (resolved_at null).
-- A signal is resolved, never deleted: resolution says how it ended, resolved_by who ended it. The
-- only way a row disappears is its tenant being deleted.
--
-- Same arrangement as tenant_policies (20260917120000): written by the service role after the API
-- has checked the caller's feature, role and producer scope; the tenant plane may read its own
-- tenant's rows. Additive and idempotent.

create table if not exists public.tenant_policy_lapse_signals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  policy_id uuid not null references public.tenant_policies(id) on delete cascade,
  kind text not null,
  occurred_on date not null,
  note text,
  source text not null default 'manual',
  -- A feed's own id for the event, so re-delivering the same file cannot record it twice.
  source_ref text,
  recorded_by uuid references public.users(id) on delete set null,
  recorded_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  resolution text,
  resolution_note text,
  constraint tenant_policy_lapse_signals_kind check (kind in ('missed_draft', 'returned_payment', 'service_call', 'other')),
  constraint tenant_policy_lapse_signals_source check (source in ('manual', 'feed')),
  constraint tenant_policy_lapse_signals_note_length check (note is null or char_length(btrim(note)) between 1 and 1000),
  -- "Other" is only a reason if someone writes it down.
  constraint tenant_policy_lapse_signals_other_needs_note check (kind <> 'other' or (note is not null and char_length(btrim(note)) >= 3)),
  constraint tenant_policy_lapse_signals_occurred_sane check (occurred_on >= date '2000-01-01'),
  -- policy_cancelled is written only by the tenant_policies trigger below, never offered by the UI.
  constraint tenant_policy_lapse_signals_resolution check (resolution is null or resolution in ('payment_received', 'policy_reinstated', 'policy_lapsed', 'false_alarm', 'policy_cancelled')),
  constraint tenant_policy_lapse_signals_resolved_together check ((resolved_at is null) = (resolution is null)),
  constraint tenant_policy_lapse_signals_resolution_note_length check (resolution_note is null or char_length(btrim(resolution_note)) between 1 and 1000),
  -- A feed re-delivering the same event cannot record it twice. Manual rows carry no source_ref, and
  -- NULLs never collide in a unique constraint, so this binds feed rows only.
  constraint tenant_policy_lapse_signals_feed_ref unique (tenant_id, source, source_ref)
);

create index if not exists tenant_policy_lapse_signals_open_idx
  on public.tenant_policy_lapse_signals (tenant_id, policy_id) where resolved_at is null;
create index if not exists tenant_policy_lapse_signals_policy_idx on public.tenant_policy_lapse_signals (policy_id);
create index if not exists tenant_policy_lapse_signals_recorded_by_idx on public.tenant_policy_lapse_signals (recorded_by);
create index if not exists tenant_policy_lapse_signals_resolved_by_idx on public.tenant_policy_lapse_signals (resolved_by);

alter table public.tenant_policy_lapse_signals enable row level security;
revoke all on public.tenant_policy_lapse_signals from public, anon, authenticated;
-- No delete, for anyone: a signal is resolved, not removed. The tenant cascade still works, because
-- referential actions run as the table owner.
revoke delete on public.tenant_policy_lapse_signals from service_role;
grant select, insert, update on public.tenant_policy_lapse_signals to service_role;
grant select on public.tenant_policy_lapse_signals to tenant_app;
drop policy if exists tenant_policy_lapse_signals_read on public.tenant_policy_lapse_signals;
create policy tenant_policy_lapse_signals_read on public.tenant_policy_lapse_signals
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

-- ── what may change, and what never does ─────────────────────────────────
-- A signal is a record of what happened. Its facts are fixed once written; the only transition is
-- open → resolved, once. The ON DELETE SET NULL on the two user columns is the one exception.
create or replace function public.guard_tenant_policy_lapse_signal()
returns trigger language plpgsql set search_path = public as $$
declare
  v_policy record;
begin
  if tg_op = 'INSERT' then
    select tenant_id, status into v_policy from public.tenant_policies where id = new.policy_id;
    if not found or v_policy.tenant_id <> new.tenant_id then
      raise exception 'policy % does not belong to tenant %', new.policy_id, new.tenant_id using errcode = '23503';
    end if;
    if v_policy.status not in ('active', 'pending') then
      raise exception 'a % policy cannot be put at risk', v_policy.status using errcode = '23514';
    end if;
    if new.resolved_at is not null then
      raise exception 'a signal is recorded open' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.tenant_id <> old.tenant_id or new.policy_id <> old.policy_id or new.kind <> old.kind
     or new.occurred_on <> old.occurred_on or new.note is distinct from old.note or new.source <> old.source
     or new.source_ref is distinct from old.source_ref or new.recorded_at <> old.recorded_at
     or (new.recorded_by is distinct from old.recorded_by and new.recorded_by is not null) then
    raise exception 'a lapse signal''s facts cannot be changed' using errcode = '23514';
  end if;
  if old.resolved_at is not null and (
       new.resolved_at is distinct from old.resolved_at or new.resolution is distinct from old.resolution
       or new.resolution_note is distinct from old.resolution_note
       or (new.resolved_by is distinct from old.resolved_by and new.resolved_by is not null)) then
    raise exception 'a resolved lapse signal is final' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists tenant_policy_lapse_signals_guard on public.tenant_policy_lapse_signals;
create trigger tenant_policy_lapse_signals_guard
  before insert or update on public.tenant_policy_lapse_signals
  for each row execute function public.guard_tenant_policy_lapse_signal();

-- ── a policy that ends closes its signals ────────────────────────────────
-- However a policy comes to be lapsed or cancelled (the policies page, an import, the resolve path
-- below), it is no longer "at risk": it happened. Its open signals are closed with the matching
-- resolution and no resolver, which reads as "closed by the policy's own status change".
create or replace function public.close_lapse_signals_on_policy_end()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('lapsed', 'cancelled') and old.status is distinct from new.status then
    update public.tenant_policy_lapse_signals
       set resolved_at = now(),
           resolution = case when new.status = 'lapsed' then 'policy_lapsed' else 'policy_cancelled' end
     where tenant_id = new.tenant_id and policy_id = new.id and resolved_at is null;
  end if;
  return new;
end;
$$;
revoke all on function public.close_lapse_signals_on_policy_end() from public, anon, authenticated;

drop trigger if exists tenant_policies_close_lapse_signals on public.tenant_policies;
create trigger tenant_policies_close_lapse_signals
  after update of status on public.tenant_policies
  for each row execute function public.close_lapse_signals_on_policy_end();

-- ── resolving, in one transaction ────────────────────────────────────────
-- Resolves every open signal on one policy and, for policy_lapsed, marks the policy lapsed in the
-- same transaction — so the commission ledger (lib/ledger) sees the lapse and posts its chargeback,
-- and a failure half-way cannot leave a lapsed policy with open signals or the reverse. The signals
-- are resolved FIRST so they carry the resolver; the status trigger then finds none left open.
create or replace function public.resolve_policy_lapse_signals(
  p_tenant_id uuid,
  p_policy_id uuid,
  p_resolution text,
  p_actor uuid,
  p_note text default null
) returns table (resolved_count integer, policy_status text)
language plpgsql set search_path = public as $$
declare
  v_status text;
  v_count integer;
begin
  if p_resolution not in ('payment_received', 'policy_reinstated', 'policy_lapsed', 'false_alarm') then
    raise exception 'unknown resolution %', p_resolution using errcode = '22023';
  end if;

  select p.status into v_status from public.tenant_policies p
   where p.id = p_policy_id and p.tenant_id = p_tenant_id
   for update;
  if not found then
    raise exception 'policy not found' using errcode = 'P0002';
  end if;

  update public.tenant_policy_lapse_signals s
     set resolved_at = now(), resolved_by = p_actor, resolution = p_resolution, resolution_note = nullif(btrim(p_note), '')
   where s.tenant_id = p_tenant_id and s.policy_id = p_policy_id and s.resolved_at is null;
  get diagnostics v_count = row_count;

  if v_count > 0 and p_resolution = 'policy_lapsed' and v_status in ('active', 'pending') then
    update public.tenant_policies set status = 'lapsed' where id = p_policy_id and tenant_id = p_tenant_id;
    v_status := 'lapsed';
  end if;

  return query select v_count, v_status;
end;
$$;
revoke all on function public.resolve_policy_lapse_signals(uuid, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_policy_lapse_signals(uuid, uuid, text, uuid, text) to service_role;

-- ── asserted against whatever this database holds ─────────────────────────
do $$
begin
  if to_regclass('public.tenant_policy_lapse_signals') is null then
    raise exception 'tenant_policy_lapse_signals is missing';
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'tenant_policy_lapse_signals' and c.relrowsecurity
  ) then
    raise exception 'tenant_policy_lapse_signals has row level security switched off';
  end if;
  if has_table_privilege('tenant_app', 'public.tenant_policy_lapse_signals', 'insert')
     or has_table_privilege('tenant_app', 'public.tenant_policy_lapse_signals', 'update')
     or has_table_privilege('tenant_app', 'public.tenant_policy_lapse_signals', 'delete') then
    raise exception 'the tenant plane can write lapse signals';
  end if;
  if has_table_privilege('service_role', 'public.tenant_policy_lapse_signals', 'delete') then
    raise exception 'lapse signals can be deleted; they must only ever be resolved';
  end if;
  if not has_table_privilege('tenant_app', 'public.tenant_policy_lapse_signals', 'select') then
    raise exception 'the tenant plane cannot read lapse signals';
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'tenant_policy_lapse_signals' and policyname = 'tenant_policy_lapse_signals_read'
  ) then
    raise exception 'tenant_policy_lapse_signals_read policy is missing';
  end if;
  if to_regprocedure('public.resolve_policy_lapse_signals(uuid, uuid, text, uuid, text)') is null then
    raise exception 'resolve_policy_lapse_signals is missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tenant_policies_close_lapse_signals' and not tgisinternal) then
    raise exception 'tenant_policies_close_lapse_signals trigger is missing';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924265000', 'policy_lapse_signals') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [18/22] 20260924300000_lead_assignment_board.sql ──────────────────────────────
begin;

-- /app/assignments · the Lead assignment board, made true.
--
-- The redesigned board states things the router did not do. This file makes each of them so, or the
-- application says less than the board did. What changes, in the order a reader of the board meets it:
--
--   Licence card     "Evaluated before rule 1" was false: a lead whose first matching rule had no
--                    eligible candidate raised NO_ELIGIBLE_ASSIGNEE even when a later rule, or the
--                    fallback, had someone who could take it. The router now FALLS THROUGH (user
--                    decision 1), so the licence gate really does run ahead of every rule.
--   "Assign next"    tried the first unclaimed lead and failed on it. It now SKIPS AHEAD over up to 25
--                    unclaimed leads in queue order until one routes (user decision 2).
--   Rule rows        need "N routed" and "skipped X N×". lead_assignment_events gains rule_id, and a
--                    new assignment_skip_events log records who was passed over and why.
--   Real-time rule   new match_type 'realtime': "arrived within N seconds", read from posted_at.
--   Language rule    "matches pairing": candidates are narrowed to agents whose recorded languages
--                    include the lead's. agent_capacity gains `languages`.
--   Rest day         agent_capacity gains `weekday_off`; automated assignment skips an agent on it.
--   Household card   "Same household — one agent at a time": a candidate is skipped when a DIFFERENT
--                    user owns an open lead with the same household key. Applied to manual reassign
--                    too. Rest days apply there as well, except to an owner or producer who gives a
--                    reason: that deliberate, recorded move is the override.
--                    "Attempts before rotate" is assignment_settings.attempts_before_rotate, run by a
--                    scheduled job (rotate_unanswered_assignments), never by a dialer trigger.
--   Preview card     assignment_preview: the real assign_lead, per lead, inside a savepoint that is
--                    always rolled back.
--   Publish rules    publish_assignment_rules: the whole draft in one transaction.
--
-- Additive. Every new column is nullable or defaulted, the one widened CHECK keeps every value it
-- accepted, and assign_lead keeps its signature, its return type and its grants. The lead_queue
-- capacity trigger is not touched. assignment_candidate_is_eligible and assignment_ineligibility_reason
-- are CALLED here, never redefined (Settings › States & licences owns them, 20260924110000).
--
-- Requires 20260913490000 (LA-2.24), 20260924110000 (per-agent licensed states) and 20260924100000
-- (agency_profiles.timezone, read for the weekday-off check).

-- ── schema ────────────────────────────────────────────────────────────────

-- 'realtime' joins the match types. Dropped and re-added under its generated name so the check is
-- identical apart from the one new value; every existing row passes it.
alter table public.assignment_rules drop constraint if exists assignment_rules_match_type_check;
alter table public.assignment_rules
  add constraint assignment_rules_match_type_check
  check (match_type in ('campaign', 'state', 'language', 'product', 'fallback', 'realtime'));

-- Per-agent routing facts, kept beside the ceiling they are read with.
--   languages    lower-case names or codes as the lead carries them ('spanish', 'es'); empty = none recorded
--   weekday_off  0 = Sunday … 6 = Saturday, in the agency's timezone; null = works every day
alter table public.agent_capacity add column if not exists languages text[] not null default '{}'::text[];
alter table public.agent_capacity add column if not exists weekday_off smallint;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agent_capacity_weekday_off_valid') then
    alter table public.agent_capacity
      add constraint agent_capacity_weekday_off_valid check (weekday_off is null or weekday_off between 0 and 6);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agent_capacity_languages_bounded') then
    alter table public.agent_capacity
      add constraint agent_capacity_languages_bounded check (coalesce(array_length(languages, 1), 0) <= 12);
  end if;
end $$;

-- Null or 0 = rotation off, which is every tenant until an owner sets it.
alter table public.assignment_settings add column if not exists attempts_before_rotate integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'assignment_settings_attempts_before_rotate_valid') then
    alter table public.assignment_settings
      add constraint assignment_settings_attempts_before_rotate_valid
      check (attempts_before_rotate is null or attempts_before_rotate between 0 and 50);
  end if;
end $$;

-- Which rule routed the lead. Null for a manual reassignment, for the implicit whole-roster fallback,
-- and for every event written before this file.
alter table public.lead_assignment_events
  add column if not exists rule_id uuid references public.assignment_rules(id) on delete set null;
create index if not exists lead_assignment_events_rule_idx
  on public.lead_assignment_events (tenant_id, rule_id, created_at desc) where rule_id is not null;

-- Who the router passed over, and why. Written only by assign_lead, only when the assignment it was
-- part of went through: a call that ends in NO_ELIGIBLE_ASSIGNEE rolls its skips back with it, so the
-- counts describe routing that happened, not attempts that did not.
create table if not exists public.assignment_skip_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  work_item_id uuid not null references public.lead_queue(id) on delete cascade,
  rule_id uuid references public.assignment_rules(id) on delete set null,
  user_id uuid not null references public.users(id) on delete cascade,
  reason text not null check (reason in ('capacity', 'rest', 'household', 'day_off')),
  created_at timestamptz not null default now()
);
create index if not exists assignment_skip_events_tenant_created_idx
  on public.assignment_skip_events (tenant_id, created_at desc);
create index if not exists assignment_skip_events_work_item_idx
  on public.assignment_skip_events (work_item_id);
create index if not exists assignment_skip_events_user_idx
  on public.assignment_skip_events (user_id);
create index if not exists assignment_skip_events_rule_idx
  on public.assignment_skip_events (rule_id) where rule_id is not null;

alter table public.assignment_skip_events enable row level security;
drop policy if exists assignment_skip_events_tenant_scoped on public.assignment_skip_events;
create policy assignment_skip_events_tenant_scoped on public.assignment_skip_events
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.assignment_skip_events from anon, authenticated, public;
grant select on public.assignment_skip_events to tenant_app;
grant select, insert, update, delete on public.assignment_skip_events to service_role;

-- ── rule matching ─────────────────────────────────────────────────────────
--
-- Unchanged except for the 'realtime' branch. That branch reads now(), so the function is STABLE
-- rather than IMMUTABLE: an immutable function that reads the clock can be constant-folded and
-- answer with the time it was planned.
create or replace function public.assignment_rule_matches(p_rule public.assignment_rules, p_lead public.agent_leads)
returns boolean
language plpgsql
stable
as $function$
declare
  v_value text;
  v_values jsonb;
  v_seconds numeric;
begin
  if p_rule.match_type = 'fallback' then return true; end if;
  if p_rule.match_type = 'campaign' then
    return p_lead.campaign_id is not null and (
      p_rule.match_values->'campaign_ids' ? p_lead.campaign_id::text
      or p_rule.match_values->'values' ? p_lead.campaign_id::text
    );
  end if;
  if p_rule.match_type = 'state' then
    v_value := upper(trim(coalesce(p_lead.values->>'state', p_lead.values->>'state_code', '')));
    v_values := coalesce(p_rule.match_values->'states', p_rule.match_values->'values', '[]'::jsonb);
    if jsonb_typeof(v_values) <> 'array' then return false; end if;
    return v_value <> '' and exists (select 1 from jsonb_array_elements_text(v_values) x(value) where upper(trim(x.value)) = v_value);
  end if;
  if p_rule.match_type = 'language' then
    v_value := lower(trim(coalesce(p_lead.values->>'language', p_lead.values->>'preferred_language', p_lead.values->>'language_code', '')));
    v_values := coalesce(p_rule.match_values->'languages', p_rule.match_values->'values', '[]'::jsonb);
    if jsonb_typeof(v_values) <> 'array' then return false; end if;
    return v_value <> '' and exists (select 1 from jsonb_array_elements_text(v_values) x(value) where lower(trim(x.value)) = v_value);
  end if;
  if p_rule.match_type = 'product' then
    v_value := lower(trim(coalesce(p_lead.product_line, p_lead.values->>'product_code', p_lead.values->>'product', '')));
    v_values := coalesce(p_rule.match_values->'products', p_rule.match_values->'product_codes', p_rule.match_values->'values', '[]'::jsonb);
    if jsonb_typeof(v_values) <> 'array' then return false; end if;
    return v_value <> '' and exists (select 1 from jsonb_array_elements_text(v_values) x(value) where lower(trim(x.value)) = v_value);
  end if;
  -- NEW. "Arrived within N seconds": the lead was posted (LA-2.5) no more than N seconds ago. A
  -- list lead has no posted_at and never matches. This decides WHO gets the lead, not WHEN: posted
  -- leads already enter lead_queue at tier 0 and sort first in assignment order without any rule.
  if p_rule.match_type = 'realtime' then
    v_seconds := case when jsonb_typeof(p_rule.match_values->'seconds') = 'number'
                      then (p_rule.match_values->>'seconds')::numeric end;
    return v_seconds is not null and v_seconds > 0
       and p_lead.posted_at is not null
       and p_lead.posted_at >= now() - make_interval(secs => v_seconds::double precision);
  end if;
  return false;
end;
$function$;

-- ── assign_lead ───────────────────────────────────────────────────────────
--
-- The body moves to assign_lead_core, which takes one extra, internal argument: the owner a
-- scheduled rotation is moving a lead away from. assign_lead keeps its exact signature, return type
-- and grants (service_role only) and passes null, so every existing caller — the API, the preview —
-- gets the router below with rotation off.
--
-- Every change from the 20260913490000 body is marked "CHANGE n" where it happens:
--
--   1  Rotation (decision 3). With p_rotate_from_user_id set, the actor may be null (the scheduler),
--      the lead must still be claimed by that owner and undispositioned, the sticky refusal is not
--      applied (the job has already checked there is no live call), and that owner is excluded
--      from the candidates. Nothing else differs: same rules, same gates, same audit event.
--   2  Skip-ahead (decision 2). With no work item AND no target, up to 25 unclaimed leads are tried
--      in queue order (tier, queued_at, id; skip locked), one row lock at a time, until one routes.
--      With a work item or a target, exactly one lead is tried, as before.
--   3  Fall-through (decision 1). Automated routing tries every matching rule in order, then the
--      implicit whole-roster fallback when no fallback rule of the tenant's own matched, until one
--      has an eligible candidate. The first matching rule with a candidate is the same rule that
--      routed the lead before, so nothing that routed before routes differently. A licensed-only
--      product rule that matched keeps requiring a licensed agent for the rules tried after it.
--   4  Language pairing. Under a 'language' rule a candidate must have the lead's language among
--      their recorded languages. This is where the previously unused v_language is read.
--   5  Weekday off. An agent is skipped by automated routing on their recorded day off, in the
--      agency's timezone (UTC when none is set or it is not a valid zone name).
--   6  Same household. A candidate is skipped when a DIFFERENT user owns another open lead with the
--      same assignment_contact_key.
--   7  Manual reassignment now honours same household always, and rest days unless an owner or
--      producer gives a reason (the recorded reason is the override). Both apply only when the
--      target is not already the owner; they raise ASSIGNMENT_TARGET_RESTING and
--      ASSIGNMENT_HOUSEHOLD_OWNED, which the API turns into sentences. The weekday-off and language
--      checks do NOT apply to a manager's deliberate choice.
--   8  Logging. The assignment event carries rule_id when a rule routed it automatically; skips for
--      capacity, rest, household and day off go to assignment_skip_events, written once, on success.
--   9  NO_ELIGIBLE_ASSIGNEE keeps its message and gains a DETAIL (JSON counts of why each candidate
--      was passed over) so the preview and the API can say why nobody could take the lead.
--  10  The returned object gains 'leads_skipped' (leads passed over by skip-ahead). Every existing
--      key keeps its meaning.
create or replace function public.assign_lead_core(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_work_item_id uuid,
  p_target_user_id uuid,
  p_reason text,
  p_rotate_from_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_item public.lead_queue%rowtype;
  v_lead public.agent_leads%rowtype;
  v_rule public.assignment_rules%rowtype;
  v_selected_rule public.assignment_rules%rowtype;
  v_capacity public.agent_capacity%rowtype;
  v_candidate record;
  v_owner_role text;
  v_state text;
  v_product text;
  v_language text;
  v_contact_key text;
  v_rest_days integer := 0;
  v_requires_licensed boolean := false;
  v_selected_user uuid;
  v_selected_role text;
  v_from_user uuid;
  v_event_type text;
  v_event_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
  v_open integer;
  v_last_position integer;
  v_position integer;
  v_rule_found boolean := false;
  v_round_robin_last uuid;
  v_actor_role text;
  -- CHANGE 2–9 state.
  v_settings_last uuid;          -- the tenant-wide round-robin pointer, kept apart from the per-rule one
  v_max_items integer := 1;
  v_items_tried integer := 0;
  v_tried uuid[] := '{}'::uuid[];
  v_rules public.assignment_rules[];
  v_real_rules integer := 0;
  v_has_fallback boolean := false;
  v_household_owners uuid[] := '{}'::uuid[];
  v_zone text;
  v_dow integer;
  v_skip_items uuid[] := '{}'::uuid[];
  v_skip_rules uuid[] := '{}'::uuid[];
  v_skip_users uuid[] := '{}'::uuid[];
  v_skip_reasons text[] := '{}'::text[];
  v_n_candidates integer := 0;
  v_n_licence integer := 0;
  v_n_language integer := 0;
  v_n_day_off integer := 0;
  v_n_rest integer := 0;
  v_n_household integer := 0;
  v_n_capacity integer := 0;
begin
  -- CHANGE 1: a rotation may run with no actor. Everything else must name an active member.
  if p_rotate_from_user_id is not null and (p_work_item_id is null or p_target_user_id is not null) then
    raise exception 'ASSIGNMENT_ROTATION_INVALID';
  end if;
  if p_rotate_from_user_id is not null and p_actor_user_id is null then
    v_actor_role := null;
  else
    select tu.role::text into v_actor_role
      from public.tenant_users tu join public.users u on u.id = tu.user_id
       where tu.tenant_id = p_tenant_id and tu.user_id = p_actor_user_id
         and tu.accepted_at is not null and u.status::text = 'active'
      limit 1;
    if not found then raise exception 'ASSIGNMENT_ACTOR_INVALID'; end if;
  end if;

  -- Reconcile stale rows even if an external user-status mutation did not fire the trigger.
  update public.lead_queue q
     set status = 'unclaimed', claimed_by = null, owner_user_id = null, owner_role = null,
         claimed_at = null, locked_until = null, updated_at = now()
    from public.users u
   where q.tenant_id = p_tenant_id and q.owner_user_id = u.id
     and u.status::text <> 'active'
     and q.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active')
     and q.disposition is null;

  -- Read once rather than once per lead: nothing below changes them.
  select coalesce(s.rest_days, 0), s.last_assignee_id into v_rest_days, v_settings_last from public.assignment_settings s where s.tenant_id = p_tenant_id;
  v_rest_days := coalesce(v_rest_days, 0);

  -- CHANGE 5: today's weekday where the agency is. A zone Postgres does not know falls back to UTC
  -- rather than failing every assignment over a typo on Agency profile.
  begin
    select nullif(btrim(ap.timezone), '') into v_zone from public.agency_profiles ap where ap.tenant_id = p_tenant_id;
    v_dow := extract(dow from (now() at time zone coalesce(v_zone, 'UTC')))::integer;
  exception when others then
    v_dow := extract(dow from (now() at time zone 'UTC'))::integer;
  end;

  -- CHANGE 2: skip-ahead only for "assign the next eligible lead" — no work item, no target.
  if p_work_item_id is null and p_target_user_id is null then v_max_items := 25; end if;

  <<items>>
  loop
    exit items when v_items_tried >= v_max_items;
    v_items_tried := v_items_tried + 1;

    if p_work_item_id is null then
      select q.* into v_item
        from public.lead_queue q
       where q.tenant_id = p_tenant_id and q.status = 'unclaimed'
         and q.id <> all(v_tried)
       order by q.tier nulls last, q.queued_at, q.id
       limit 1
       for update skip locked;
    else
      select q.* into v_item from public.lead_queue q
       where q.tenant_id = p_tenant_id and q.id = p_work_item_id for update;
    end if;
    if not found then
      -- The first lead missing is the error it always was. A later one means the queue ran out
      -- while skipping ahead, which is "nobody could take any of them", raised below.
      if v_items_tried = 1 then raise exception 'ASSIGNMENT_WORK_ITEM_NOT_FOUND'; end if;
      exit items;
    end if;
    v_tried := array_append(v_tried, v_item.id);
    select l.* into v_lead from public.agent_leads l where l.id = v_item.lead_id and l.tenant_id = p_tenant_id for update;
    if not found then raise exception 'ASSIGNMENT_LEAD_NOT_FOUND'; end if;

    v_state := upper(trim(coalesce(v_lead.values->>'state', v_lead.values->>'state_code', '')));
    v_product := lower(trim(coalesce(v_lead.product_line, v_lead.values->>'product_code', v_lead.values->>'product', '')));
    v_language := lower(trim(coalesce(v_lead.values->>'language', v_lead.values->>'preferred_language', v_lead.values->>'language_code', '')));
    v_contact_key := public.assignment_contact_key(v_lead.values, v_lead.id);

    -- Per-lead diagnostics restart with each lead (CHANGE 9).
    v_n_candidates := 0; v_n_licence := 0; v_n_language := 0; v_n_day_off := 0;
    v_n_rest := 0; v_n_household := 0; v_n_capacity := 0;
    v_selected_rule := null;
    v_rule_found := false;
    v_selected_user := null;
    v_selected_role := null;

    -- CHANGE 1: the rotation must still find the lead where the job left it.
    if p_rotate_from_user_id is not null
       and (v_item.owner_user_id is distinct from p_rotate_from_user_id or v_item.status <> 'claimed' or v_item.disposition is not null) then
      raise exception 'ASSIGNMENT_ROTATION_STALE';
    end if;

    -- A claimed, undispositioned row is the live conversation. Automated assignment never takes it
    -- away from its current owner. An explicit target is the deliberate manual reassignment path and
    -- requires a reason below. (CHANGE 1: a rotation is the one automated caller let past, and only
    -- after rotate_unanswered_assignments has established there is no call, open attempt or
    -- promised callback on it.)
    if v_item.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active') and v_item.owner_user_id is not null and v_item.disposition is null and p_target_user_id is null and p_rotate_from_user_id is null then
      return jsonb_build_object('work_item_id', v_item.id, 'lead_id', v_item.lead_id, 'owner_user_id', v_item.owner_user_id, 'owner_role', v_item.owner_role, 'sticky', true, 'reason', 'Active ownership is sticky until disposition');
    end if;
    if v_item.status not in ('unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active') then raise exception 'ASSIGNMENT_WORK_ITEM_CLOSED'; end if;
    if p_target_user_id is not null and p_target_user_id <> coalesce(v_item.owner_user_id, p_actor_user_id)
       and v_actor_role not in ('owner', 'producer') then
      raise exception 'ASSIGNMENT_MANAGER_REQUIRED';
    end if;
    if p_target_user_id is not null and v_item.owner_user_id is not null and p_target_user_id <> v_item.owner_user_id and v_event_reason is null then raise exception 'REASSIGNMENT_REASON_REQUIRED'; end if;

    -- CHANGE 6: everyone else holding this household right now. The row being assigned is left out,
    -- so a reassignment is not blocked by the owner it is being taken from.
    select coalesce(array_agg(distinct q2.owner_user_id), '{}'::uuid[]) into v_household_owners
      from public.lead_queue q2
      join public.agent_leads l2 on l2.id = q2.lead_id and l2.tenant_id = q2.tenant_id
     where q2.tenant_id = p_tenant_id
       and q2.id <> v_item.id
       and q2.owner_user_id is not null
       and q2.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active')
       and q2.disposition is null
       and public.assignment_contact_key(l2.values, l2.id) = v_contact_key;

    if p_target_user_id is not null then
      -- First match wins. The rule row is locked with the tenant assignment operation, and the tie
      -- breaker on id makes equal priorities deterministic. Unchanged for the manual path: the first
      -- matching rule still decides whether the lead needs a licensed agent, and still has its
      -- round-robin pointer moved by the assignment, exactly as before.
      for v_rule in
        select r.* from public.assignment_rules r
         where r.tenant_id = p_tenant_id and r.is_active
           and public.assignment_rule_matches(r, v_lead)
         order by r.priority, r.id
      loop
        v_selected_rule := v_rule;
        v_rule_found := true;
        exit;
      end loop;
      if v_selected_rule.id is null then
        v_selected_rule.id := gen_random_uuid();
        v_selected_rule.assignee_ids := '{}'::uuid[];
        v_selected_rule.match_type := 'fallback';
      end if;
      v_round_robin_last := coalesce(v_selected_rule.last_assignee_id, v_settings_last);
      v_requires_licensed := v_product in ('term_life', 'term-life', 'term life')
        or (v_selected_rule.match_type = 'product' and case when jsonb_typeof(v_selected_rule.match_values->'licensed_only') = 'boolean' then (v_selected_rule.match_values->>'licensed_only')::boolean else false end);

      select tu.role::text into v_selected_role
        from public.tenant_users tu join public.users u on u.id = tu.user_id
       where tu.tenant_id = p_tenant_id and tu.user_id = p_target_user_id
         and tu.accepted_at is not null and u.status::text = 'active';
      if not found or not public.assignment_candidate_is_eligible(p_tenant_id, p_target_user_id, v_selected_role, v_product, v_state, v_requires_licensed) then raise exception 'ASSIGNMENT_TARGET_NOT_ELIGIBLE'; end if;
      -- CHANGE 7: the two household rules the automated path always applied (rest) or now applies
      -- (same household). Not asked when the target already owns the lead: that is not a new owner.
      -- Rest days yield to a manager who gives a reason: a deliberate, recorded reassignment (an agent
      -- out sick, a complaint) is the one case the rest window must not block. Anyone else pulling a
      -- household inside its window is refused, as the automated path is. Same household is absolute.
      if p_target_user_id <> coalesce(v_item.owner_user_id, '00000000-0000-0000-0000-000000000000')::uuid then
        if v_rest_days > 0
           and not (v_actor_role in ('owner', 'producer') and v_event_reason is not null)
           and exists (
          select 1 from public.lead_assignment_events e
           where e.tenant_id = p_tenant_id and e.contact_key = v_contact_key
             and e.to_user_id is not null and e.to_user_id <> p_target_user_id
             and e.created_at > now() - make_interval(days => v_rest_days)
        ) then raise exception 'ASSIGNMENT_TARGET_RESTING'; end if;
        if exists (select 1 from unnest(v_household_owners) o(user_id) where o.user_id <> p_target_user_id) then
          raise exception 'ASSIGNMENT_HOUSEHOLD_OWNED';
        end if;
      end if;
      insert into public.agent_capacity (tenant_id, user_id) values (p_tenant_id, p_target_user_id) on conflict do nothing;
      select c.* into v_capacity from public.agent_capacity c where c.tenant_id = p_tenant_id and c.user_id = p_target_user_id for update;
      select count(*)::integer into v_open from public.lead_queue q
       where q.tenant_id = p_tenant_id and q.owner_user_id = p_target_user_id
         and q.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active') and q.disposition is null
         and q.id <> v_item.id;
      update public.agent_capacity set current_open = v_open, updated_at = now() where tenant_id = p_tenant_id and user_id = p_target_user_id;
      if p_target_user_id <> coalesce(v_item.owner_user_id, '00000000-0000-0000-0000-000000000000')::uuid and v_open >= v_capacity.max_open_leads then raise exception 'ASSIGNMENT_TARGET_AT_CAPACITY'; end if;
      v_selected_user := p_target_user_id;
    else
      -- CHANGE 3: every matching rule, in order, then the implicit fallback. Collected first so the
      -- rule rows are read once per lead, and so the implicit fallback can be appended only when the
      -- tenant's own fallback did not match (an active fallback rule always matches).
      select coalesce(array_agg(r order by r.priority, r.id), '{}'::public.assignment_rules[]),
             coalesce(bool_or(r.match_type = 'fallback'), false)
        into v_rules, v_has_fallback
        from public.assignment_rules r
       where r.tenant_id = p_tenant_id and r.is_active
         and public.assignment_rule_matches(r, v_lead);
      v_real_rules := coalesce(cardinality(v_rules), 0);
      if not v_has_fallback then
        -- The same stand-in rule the original built when nothing matched: a fresh id, no assignees
        -- (so the whole roster), match type fallback, every other field null.
        v_rule := null;
        v_rule.id := gen_random_uuid();
        v_rule.assignee_ids := '{}'::uuid[];
        v_rule.match_type := 'fallback';
        v_rules := array_append(v_rules, v_rule);
      end if;

      v_requires_licensed := false;
      <<rules>>
      for v_rule_index in 1 .. cardinality(v_rules) loop
        v_rule := v_rules[v_rule_index];
        v_round_robin_last := coalesce(v_rule.last_assignee_id, v_settings_last);
        -- The same test as before for the rule being tried, OR-ed with the rules already tried: a
        -- licensed-only product rule the lead matched is a fact about the lead, so falling through
        -- it to a later rule must not let a setter take what it said needs a licence. For the first
        -- rule tried this is exactly the original expression.
        v_requires_licensed := v_requires_licensed or v_product in ('term_life', 'term-life', 'term life')
          or (v_rule.match_type = 'product' and case when jsonb_typeof(v_rule.match_values->'licensed_only') = 'boolean' then (v_rule.match_values->>'licensed_only')::boolean else false end);

        -- Lock each capacity row before recounting it. The row itself is never trusted as the source of
        -- truth, which keeps concurrent assignments from crossing the configured maximum.
        for v_candidate in
          select tu.user_id, tu.role::text as role, c.max_open_leads,
                 coalesce(c.languages, '{}'::text[]) as languages, c.weekday_off,
                 case when cardinality(v_rule.assignee_ids) > 0 then array_position(v_rule.assignee_ids, tu.user_id) else null end as configured_position
            from public.tenant_users tu
            join public.users u on u.id = tu.user_id and u.status::text = 'active'
            left join public.agent_capacity c on c.tenant_id = p_tenant_id and c.user_id = tu.user_id
           where tu.tenant_id = p_tenant_id and tu.accepted_at is not null
             and (cardinality(v_rule.assignee_ids) = 0 or tu.user_id = any(v_rule.assignee_ids))
             -- CHANGE 1: never back to the owner it is being rotated away from.
             and (p_rotate_from_user_id is null or tu.user_id <> p_rotate_from_user_id)
           order by case
                      when cardinality(v_rule.assignee_ids) > 0 and v_round_robin_last is not null
                        then case when array_position(v_rule.assignee_ids, tu.user_id) > coalesce(array_position(v_rule.assignee_ids, v_round_robin_last), 0) then 0 else 1 end
                      when cardinality(v_rule.assignee_ids) = 0 and v_round_robin_last is not null
                        then case when tu.user_id > v_round_robin_last then 0 else 1 end
                      else 0
                    end,
                    case when cardinality(v_rule.assignee_ids) > 0 then array_position(v_rule.assignee_ids, tu.user_id) end nulls last,
                    tu.user_id
        loop
          v_n_candidates := v_n_candidates + 1;
          if not public.assignment_candidate_is_eligible(p_tenant_id, v_candidate.user_id, v_candidate.role, v_product, v_state, v_requires_licensed) then
            v_n_licence := v_n_licence + 1;
            continue;
          end if;
          -- CHANGE 4: a language rule pairs the lead with someone who speaks it.
          if v_rule.match_type = 'language' and not exists (
            select 1 from unnest(v_candidate.languages) x(value) where lower(btrim(x.value)) = v_language
          ) then
            v_n_language := v_n_language + 1;
            continue;
          end if;
          -- CHANGE 5: not on their day off.
          if v_candidate.weekday_off is not null and v_candidate.weekday_off = v_dow then
            v_n_day_off := v_n_day_off + 1;
            v_skip_items := array_append(v_skip_items, v_item.id);
            v_skip_rules := array_append(v_skip_rules, case when v_rule_index <= v_real_rules then v_rule.id end);
            v_skip_users := array_append(v_skip_users, v_candidate.user_id);
            v_skip_reasons := array_append(v_skip_reasons, 'day_off'::text);
            continue;
          end if;
          if v_rest_days > 0 and exists (
            select 1 from public.lead_assignment_events e
             where e.tenant_id = p_tenant_id and e.contact_key = v_contact_key
               and e.to_user_id is not null and e.to_user_id <> v_candidate.user_id
               and e.created_at > now() - make_interval(days => v_rest_days)
          ) then
            v_n_rest := v_n_rest + 1;
            v_skip_items := array_append(v_skip_items, v_item.id);
            v_skip_rules := array_append(v_skip_rules, case when v_rule_index <= v_real_rules then v_rule.id end);
            v_skip_users := array_append(v_skip_users, v_candidate.user_id);
            v_skip_reasons := array_append(v_skip_reasons, 'rest'::text);
            continue;
          end if;
          -- CHANGE 6: one agent at a time per household.
          if exists (select 1 from unnest(v_household_owners) o(user_id) where o.user_id <> v_candidate.user_id) then
            v_n_household := v_n_household + 1;
            v_skip_items := array_append(v_skip_items, v_item.id);
            v_skip_rules := array_append(v_skip_rules, case when v_rule_index <= v_real_rules then v_rule.id end);
            v_skip_users := array_append(v_skip_users, v_candidate.user_id);
            v_skip_reasons := array_append(v_skip_reasons, 'household'::text);
            continue;
          end if;
          insert into public.agent_capacity (tenant_id, user_id) values (p_tenant_id, v_candidate.user_id) on conflict do nothing;
          select c.* into v_capacity from public.agent_capacity c where c.tenant_id = p_tenant_id and c.user_id = v_candidate.user_id for update;
          select count(*)::integer into v_open from public.lead_queue q
           where q.tenant_id = p_tenant_id and q.owner_user_id = v_candidate.user_id
             and q.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active') and q.disposition is null;
          update public.agent_capacity set current_open = v_open, updated_at = now() where tenant_id = p_tenant_id and user_id = v_candidate.user_id;
          -- CHANGE 8: recorded on its own line so the skip it logs and the skip it makes cannot drift.
          if v_open >= v_capacity.max_open_leads then
            v_n_capacity := v_n_capacity + 1;
            v_skip_items := array_append(v_skip_items, v_item.id);
            v_skip_rules := array_append(v_skip_rules, case when v_rule_index <= v_real_rules then v_rule.id end);
            v_skip_users := array_append(v_skip_users, v_candidate.user_id);
            v_skip_reasons := array_append(v_skip_reasons, 'capacity'::text);
          end if;
          if v_open >= v_capacity.max_open_leads then continue; end if;
          v_selected_user := v_candidate.user_id;
          v_selected_role := v_candidate.role;
          exit;
        end loop;

        if v_selected_user is not null then
          v_selected_rule := v_rule;
          v_rule_found := v_rule_index <= v_real_rules;
          exit;
        end if;
      end loop;
    end if;

    exit items when v_selected_user is not null;
  end loop;

  if v_selected_user is null then
    -- CHANGE 9: same message, now with the reasons. Counts are for the last lead tried (the only
    -- lead, when a work item was named).
    raise exception 'NO_ELIGIBLE_ASSIGNEE' using detail = jsonb_build_object(
      'leads_tried', v_items_tried, 'work_item_id', v_item.id, 'state', v_state, 'product', v_product,
      'requires_licensed', v_requires_licensed, 'candidates', v_n_candidates, 'licence', v_n_licence,
      'language', v_n_language, 'day_off', v_n_day_off, 'rest', v_n_rest, 'household', v_n_household,
      'capacity', v_n_capacity)::text;
  end if;

  v_from_user := v_item.owner_user_id;
  v_event_type := case when v_from_user is null then case when p_work_item_id is null then 'assigned' else 'pulled' end else 'reassigned' end;
  if v_from_user is not null and v_event_reason is null then v_event_reason := 'Manual reassignment'; end if;
  v_event_reason := coalesce(v_event_reason, 'Rule-based assignment');
  update public.lead_queue
     set status = 'claimed', claimed_by = v_selected_user, owner_user_id = v_selected_user,
         owner_role = v_selected_role, claimed_at = coalesce(claimed_at, now()), locked_until = null, updated_at = now()
   where id = v_item.id and tenant_id = p_tenant_id;
  -- CHANGE 8: rule_id, only when a rule of the tenant's routed it automatically.
  insert into public.lead_assignment_events (tenant_id, work_item_id, lead_id, contact_key, from_user_id, to_user_id, event_type, reason, assigned_by, rule_id)
  values (p_tenant_id, v_item.id, v_item.lead_id, v_contact_key, v_from_user, v_selected_user, v_event_type, v_event_reason, p_actor_user_id,
          case when p_target_user_id is null and v_rule_found then v_selected_rule.id end);
  if cardinality(v_skip_users) > 0 then
    insert into public.assignment_skip_events (tenant_id, work_item_id, rule_id, user_id, reason)
    select p_tenant_id, s.work_item_id, s.rule_id, s.user_id, s.reason
      from unnest(v_skip_items, v_skip_rules, v_skip_users, v_skip_reasons) as s(work_item_id, rule_id, user_id, reason);
  end if;
  if v_selected_rule.id is not null and v_selected_rule.match_type <> 'fallback' then
    update public.assignment_rules set last_assignee_id = v_selected_user where id = v_selected_rule.id and tenant_id = p_tenant_id;
  end if;
  if v_selected_rule.match_type = 'fallback' then
    if v_rule_found then
      update public.assignment_rules set last_assignee_id = v_selected_user where id = v_selected_rule.id and tenant_id = p_tenant_id;
    else
      insert into public.assignment_settings (tenant_id, last_assignee_id) values (p_tenant_id, v_selected_user)
      on conflict (tenant_id) do update set last_assignee_id = excluded.last_assignee_id, updated_at = now();
    end if;
  end if;
  perform public.refresh_agent_capacity_for_user(p_tenant_id, v_selected_user);
  if v_from_user is not null and v_from_user <> v_selected_user then perform public.refresh_agent_capacity_for_user(p_tenant_id, v_from_user); end if;
  return jsonb_build_object('work_item_id', v_item.id, 'lead_id', v_item.lead_id, 'owner_user_id', v_selected_user, 'owner_role', v_selected_role, 'rule_id', case when v_rule_found then v_selected_rule.id else null end, 'rule_match_type', v_selected_rule.match_type, 'sticky', false, 'reason', v_event_reason, 'leads_skipped', greatest(v_items_tried - 1, 0));
end;
$function$;

-- Same signature, return type and grants as 20260913490000; the router is assign_lead_core with
-- rotation off.
create or replace function public.assign_lead(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_work_item_id uuid default null,
  p_target_user_id uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
begin
  return public.assign_lead_core(p_tenant_id, p_actor_user_id, p_work_item_id, p_target_user_id, p_reason, null);
end;
$function$;

-- ── routing preview ───────────────────────────────────────────────────────
--
-- The next few unclaimed leads, each run through the REAL assign_lead in queue order, all inside one
-- block that always ends by raising and catching its own sentinel — so every row it touched, every
-- event and skip it wrote and every capacity count it moved is rolled back before it returns. The
-- leads are assigned in sequence inside that block, so the second sees the first's capacity and
-- round-robin effect, as a real run of "Assign next" would. The pattern is 20260924110000's probe.
--
-- Manager-only, and at most ten leads: it takes the same row locks assign_lead does, briefly.
create or replace function public.assignment_preview(p_tenant_id uuid, p_actor_user_id uuid, p_limit integer default 5)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 10);
  v_actor_role text;
  v_rows jsonb := '[]'::jsonb;
  v_item record;
  v_result jsonb;
  v_error text;
  v_detail text;
  v_detail_json jsonb;
  v_full uuid[];
  v_licensed_anyone boolean;
  v_reason text;
  v_explainer record;
begin
  select tu.role::text into v_actor_role
    from public.tenant_users tu join public.users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor_user_id
     and tu.accepted_at is not null and u.status::text = 'active'
   limit 1;
  if not found then raise exception 'ASSIGNMENT_ACTOR_INVALID'; end if;
  if v_actor_role not in ('owner', 'producer') then raise exception 'ASSIGNMENT_MANAGER_REQUIRED'; end if;

  begin
    for v_item in
      select q.id, q.lead_id, l.product_line,
             upper(btrim(coalesce(l.values->>'state', l.values->>'state_code', ''))) as state,
             lower(btrim(coalesce(l.product_line, l.values->>'product_code', l.values->>'product', ''))) as product,
             coalesce(nullif(btrim(l.values->>'full_name'), ''),
                      nullif(btrim(concat_ws(' ', nullif(btrim(l.values->>'first_name'), ''), nullif(btrim(l.values->>'last_name'), ''))), ''),
                      nullif(btrim(l.values->>'name'), ''),
                      'Unnamed lead') as name
        from public.lead_queue q
        join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
       where q.tenant_id = p_tenant_id and q.status = 'unclaimed'
       order by q.tier nulls last, q.queued_at, q.id
       limit v_limit
    loop
      v_result := null; v_error := null; v_detail := null; v_detail_json := null;
      v_full := '{}'::uuid[]; v_reason := null; v_licensed_anyone := null;
      begin
        v_result := public.assign_lead(p_tenant_id, p_actor_user_id, v_item.id, null, 'Routing preview');
      exception when others then
        get stacked diagnostics v_error = message_text, v_detail = pg_exception_detail;
      end;

      if v_result is not null and not coalesce((v_result->>'sticky')::boolean, false) then
        -- Who the router passed over for being full, on the way to this lead's owner.
        select coalesce(array_agg(s.user_id order by s.created_at, s.id), '{}'::uuid[]) into v_full
          from public.assignment_skip_events s
         where s.tenant_id = p_tenant_id and s.work_item_id = v_item.id and s.reason = 'capacity';
        -- A setter took it: was there a licensed agent who could have?
        if v_result->>'owner_role' = 'setter' then
          select exists (
            select 1 from public.tenant_users tu join public.users u on u.id = tu.user_id and u.status::text = 'active'
             where tu.tenant_id = p_tenant_id and tu.accepted_at is not null and tu.role::text in ('owner', 'producer')
               and public.assignment_candidate_is_eligible(p_tenant_id, tu.user_id, tu.role::text, v_item.product, v_item.state, false)
          ) into v_licensed_anyone;
        end if;
      elsif v_error = 'NO_ELIGIBLE_ASSIGNEE' then
        begin v_detail_json := v_detail::jsonb; exception when others then v_detail_json := null; end;
        -- The same sentence the gate would give: asked of the first licensed-role member, which is
        -- the agency-level answer unless that agent's own states are recorded.
        select tu.user_id, tu.role::text as role into v_explainer
          from public.tenant_users tu join public.users u on u.id = tu.user_id and u.status::text = 'active'
         where tu.tenant_id = p_tenant_id and tu.accepted_at is not null and tu.role::text in ('owner', 'producer')
         order by tu.user_id
         limit 1;
        if found then
          v_reason := public.assignment_ineligibility_reason(p_tenant_id, v_explainer.user_id, v_explainer.role, v_item.product, v_item.state,
                        coalesce((v_detail_json->>'requires_licensed')::boolean, false));
        end if;
      end if;

      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'work_item_id', v_item.id,
        'lead_id', v_item.lead_id,
        'name', v_item.name,
        'state', nullif(v_item.state, ''),
        'outcome', case
                     when v_result is not null and coalesce((v_result->>'sticky')::boolean, false) then 'taken'
                     when v_result is not null then 'routed'
                     when v_error = 'NO_ELIGIBLE_ASSIGNEE' then 'nobody'
                     else 'error' end,
        'owner_user_id', v_result->'owner_user_id',
        'owner_role', v_result->'owner_role',
        'rule_id', v_result->'rule_id',
        'full_user_ids', to_jsonb(v_full),
        'setter_without_licensed_agent', case when v_licensed_anyone is null then null else not v_licensed_anyone end,
        'detail', v_detail_json,
        'licence_reason', v_reason,
        'error', case when v_result is null and coalesce(v_error, '') <> 'NO_ELIGIBLE_ASSIGNEE' then v_error end
      ));
    end loop;
    raise exception using errcode = 'P0001', message = 'assignment_preview_rollback';
  exception when others then
    if sqlerrm <> 'assignment_preview_rollback' then raise; end if;
  end;
  return v_rows;
end;
$function$;

-- ── board figures ─────────────────────────────────────────────────────────
--
-- One round trip for the numbers the board prints: routed per rule and skips since p_since, the
-- states each owner or producer may be handed (asked of assignment_candidate_is_eligible, state by
-- state, over the states the agency holds any licence in — eligibility needs one), and how many
-- unclaimed leads sit in a state none of them can work.
create or replace function public.assignment_insights(p_tenant_id uuid, p_since timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_routed jsonb;
  v_skips jsonb;
  v_skipped_leads jsonb;
  v_states jsonb := '{}'::jsonb;
  v_union text[] := '{}'::text[];
  v_member record;
  v_member_states text[];
  v_unlicensed integer;
begin
  select coalesce(jsonb_object_agg(x.rule_id::text, x.n), '{}'::jsonb) into v_routed
    from (select e.rule_id, count(*)::integer as n
            from public.lead_assignment_events e
           where e.tenant_id = p_tenant_id and e.rule_id is not null and e.created_at >= p_since
           group by e.rule_id) x;

  select coalesce(jsonb_agg(jsonb_build_object('rule_id', y.rule_id, 'user_id', y.user_id, 'reason', y.reason, 'count', y.n)), '[]'::jsonb) into v_skips
    from (select s.rule_id, s.user_id, s.reason, count(*)::integer as n
            from public.assignment_skip_events s
           where s.tenant_id = p_tenant_id and s.created_at >= p_since
           group by s.rule_id, s.user_id, s.reason) y;

  -- The same person can be passed over under two rules for one lead (full under rule 1, still full
  -- under the fallback). Per rule that is two skips; per person it is one lead they could not take.
  select coalesce(jsonb_agg(jsonb_build_object('user_id', z.user_id, 'reason', z.reason, 'leads', z.n)), '[]'::jsonb) into v_skipped_leads
    from (select s.user_id, s.reason, count(distinct s.work_item_id)::integer as n
            from public.assignment_skip_events s
           where s.tenant_id = p_tenant_id and s.created_at >= p_since
           group by s.user_id, s.reason) z;

  for v_member in
    select tu.user_id, tu.role::text as role
      from public.tenant_users tu join public.users u on u.id = tu.user_id and u.status::text = 'active'
     where tu.tenant_id = p_tenant_id and tu.accepted_at is not null and tu.role::text in ('owner', 'producer')
  loop
    select coalesce(array_agg(st.state order by st.state), '{}'::text[]) into v_member_states
      from (select distinct upper(btrim(l.state)) as state from public.licenses l where l.tenant_id = p_tenant_id and btrim(coalesce(l.state, '')) <> '') st
     where public.assignment_candidate_is_eligible(p_tenant_id, v_member.user_id, v_member.role, null, st.state, false);
    v_states := v_states || jsonb_build_object(v_member.user_id::text, to_jsonb(v_member_states));
    v_union := v_union || v_member_states;
  end loop;

  select count(*)::integer into v_unlicensed
    from public.lead_queue q
    join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
   where q.tenant_id = p_tenant_id and q.status = 'unclaimed'
     and not (upper(btrim(coalesce(l.values->>'state', l.values->>'state_code', ''))) = any(v_union));

  return jsonb_build_object('since', p_since, 'routed', v_routed, 'skips', v_skips, 'skipped_leads', v_skipped_leads,
                            'eligible_states', v_states, 'unlicensed_leads', v_unlicensed);
end;
$function$;

-- ── publishing a draft of the rules ───────────────────────────────────────
--
-- The board edits the chain as a draft and publishes it whole. p_rules is the chain in order:
--   [{ "id"?: uuid, "match_type": text, "match_values": object, "assignee_ids": [uuid], "is_active"?: bool }]
-- Priority becomes the position (10, 20, 30 …). A rule of the tenant's that is not in the list is
-- deactivated, never deleted: its routed history keeps pointing at it. Assignees who are not
-- members of the tenant are dropped rather than stored. One transaction, so the router never reads
-- half a chain.
create or replace function public.publish_assignment_rules(p_tenant_id uuid, p_actor_user_id uuid, p_rules jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_actor_role text;
  v_rule jsonb;
  v_index integer := 0;
  v_id uuid;
  v_kept uuid[] := '{}'::uuid[];
  v_assignees uuid[];
begin
  select tu.role::text into v_actor_role
    from public.tenant_users tu join public.users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id and tu.user_id = p_actor_user_id
     and tu.accepted_at is not null and u.status::text = 'active'
   limit 1;
  if not found then raise exception 'ASSIGNMENT_ACTOR_INVALID'; end if;
  if v_actor_role not in ('owner', 'producer') then raise exception 'ASSIGNMENT_MANAGER_REQUIRED'; end if;
  if jsonb_typeof(p_rules) <> 'array' then raise exception 'ASSIGNMENT_RULES_INVALID'; end if;

  -- Two managers publishing at once: the second waits for the first, then replaces it whole.
  perform 1 from public.assignment_rules r where r.tenant_id = p_tenant_id for update;

  for v_rule in select value from jsonb_array_elements(p_rules)
  loop
    v_index := v_index + 1;
    -- Order is kept: a rule's round-robin runs in the order its assignees were listed.
    select coalesce(array_agg(d.user_id order by d.ord), '{}'::uuid[]) into v_assignees
      from (
        select distinct on (tu.user_id) tu.user_id, x.ord
          from jsonb_array_elements_text(coalesce(v_rule->'assignee_ids', '[]'::jsonb)) with ordinality x(value, ord)
          join public.tenant_users tu on tu.tenant_id = p_tenant_id and tu.user_id::text = lower(btrim(x.value))
         order by tu.user_id, x.ord
      ) d;
    v_id := nullif(v_rule->>'id', '')::uuid;
    if v_id is not null then
      update public.assignment_rules
         set priority = v_index * 10,
             match_type = v_rule->>'match_type',
             match_values = coalesce(v_rule->'match_values', '{}'::jsonb),
             assignee_ids = v_assignees,
             is_active = coalesce((v_rule->>'is_active')::boolean, true)
       where id = v_id and tenant_id = p_tenant_id;
      if not found then raise exception 'ASSIGNMENT_RULE_NOT_FOUND'; end if;
    else
      insert into public.assignment_rules (tenant_id, priority, match_type, match_values, assignee_ids, is_active, created_by)
      values (p_tenant_id, v_index * 10, v_rule->>'match_type', coalesce(v_rule->'match_values', '{}'::jsonb), v_assignees,
              coalesce((v_rule->>'is_active')::boolean, true), p_actor_user_id)
      returning id into v_id;
    end if;
    v_kept := v_kept || v_id;
  end loop;

  update public.assignment_rules set is_active = false
   where tenant_id = p_tenant_id and is_active and not (id = any(v_kept));

  return coalesce((
    select jsonb_agg(to_jsonb(r) order by r.priority, r.id)
      from public.assignment_rules r where r.tenant_id = p_tenant_id
  ), '[]'::jsonb);
end;
$function$;

-- ── attempts before rotate (decision 3) ───────────────────────────────────
--
-- Run by /api/cron/assignment-rotation, never from the dialer's path: no trigger reads
-- tenant_call_attempts. For each tenant with attempts_before_rotate > 0 it looks at leads that are
-- OWNED — claimed, an owner, no disposition, no live dialer lock — and counts the owner's unanswered
-- attempts on that lead since anyone last reached it.
--
-- "Unanswered" is tenant_call_attempts.disposition in no_answer, voicemail, busy, call_dropped: the
-- codes every contact-rate query here treats as "no contact". agent_leads.attempts_made is NOT used:
-- it counts every attempt by anyone, answered or not, so it cannot say what this owner has tried.
--
-- Sticky ownership exists so nobody loses a live conversation. A lead is therefore never rotated
-- while it has an open call (active_calls), an attempt with no disposition in the last two hours
-- (a dial may be in progress), or a callback the customer booked (scheduled or due); and only
-- status 'claimed' qualifies, never a live transfer (buffer_active, handed_pending, la_active).
--
-- The move itself is assign_lead_core with that owner excluded: the rules, the licence gate, the
-- language, capacity, day-off, rest-day and same-household checks all apply, so with rest days set
-- a lead cannot rotate until the rest period since its last assignment has passed. When nobody else
-- may take it, it stays with its owner. Each rotation writes the usual 'reassigned' event (reason
-- "Rotated after N unanswered attempts …", assigned_by null) and an audit_log row.
create or replace function public.rotate_unanswered_assignments(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_unanswered constant text[] := array['no_answer', 'voicemail', 'busy', 'call_dropped'];
  v_row record;
  v_result jsonb;
  v_checked integer := 0;
  v_rotated integer := 0;
  v_kept integer := 0;
  v_error text;
  v_kept_reasons jsonb := '{}'::jsonb;
begin
  for v_row in
    select q.id as work_item_id, q.tenant_id, q.lead_id, q.owner_user_id, s.attempts_before_rotate as threshold, a.unanswered
      from public.assignment_settings s
      join public.lead_queue q on q.tenant_id = s.tenant_id
      cross join lateral (
        select count(*)::integer as unanswered
          from public.tenant_call_attempts ca
         where ca.tenant_id = q.tenant_id and ca.lead_id = q.lead_id and ca.agent_id = q.owner_user_id
           and ca.disposition = any(v_unanswered)
           and ca.attempted_at > coalesce((
             select max(cb.attempted_at) from public.tenant_call_attempts cb
              where cb.tenant_id = q.tenant_id and cb.lead_id = q.lead_id
                and cb.disposition is not null and not (cb.disposition = any(v_unanswered))
           ), '-infinity'::timestamptz)
      ) a
     where coalesce(s.attempts_before_rotate, 0) > 0
       and q.status = 'claimed' and q.owner_user_id is not null and q.disposition is null
       and (q.locked_until is null or q.locked_until < now())
       and a.unanswered >= s.attempts_before_rotate
       and not exists (select 1 from public.active_calls ac where ac.tenant_id = q.tenant_id and ac.work_item_id = q.id and ac.ended_at is null)
       and not exists (select 1 from public.tenant_call_attempts op
                        where op.tenant_id = q.tenant_id and op.lead_id = q.lead_id
                          and op.disposition is null and op.attempted_at > now() - interval '2 hours')
       and not exists (select 1 from public.tenant_callbacks cb
                        where cb.tenant_id = q.tenant_id and cb.work_item_id = q.id and cb.status in ('scheduled', 'due'))
     order by q.tenant_id, q.claimed_at nulls first, q.id
     limit greatest(coalesce(p_limit, 200), 1)
  loop
    v_checked := v_checked + 1;
    begin
      perform 1 from public.lead_queue
       where id = v_row.work_item_id and tenant_id = v_row.tenant_id and owner_user_id = v_row.owner_user_id
         and status = 'claimed' and disposition is null
       for update skip locked;
      if not found then
        v_kept := v_kept + 1;
        v_kept_reasons := v_kept_reasons || jsonb_build_object('busy', coalesce((v_kept_reasons->>'busy')::integer, 0) + 1);
        continue;
      end if;
      v_result := public.assign_lead_core(v_row.tenant_id, null, v_row.work_item_id, null,
                    format('Rotated after %s unanswered attempts by the previous owner', v_row.unanswered),
                    v_row.owner_user_id);
      insert into public.audit_log (actor_type, action, target_type, target_id, metadata)
      values ('system', 'tenant.lead_rotated', 'lead_queue', v_row.work_item_id::text,
              jsonb_build_object('tenantId', v_row.tenant_id, 'leadId', v_row.lead_id,
                                 'fromUserId', v_row.owner_user_id, 'toUserId', v_result->'owner_user_id',
                                 'ruleId', v_result->'rule_id', 'unansweredAttempts', v_row.unanswered,
                                 'threshold', v_row.threshold));
      v_rotated := v_rotated + 1;
    exception when others then
      -- NO_ELIGIBLE_ASSIGNEE (nobody else may take it) is the ordinary case: the lead stays put.
      v_error := sqlerrm;
      v_kept := v_kept + 1;
      v_kept_reasons := v_kept_reasons || jsonb_build_object(v_error, coalesce((v_kept_reasons->>v_error)::integer, 0) + 1);
    end;
  end loop;
  return jsonb_build_object('checked', v_checked, 'rotated', v_rotated, 'kept', v_kept, 'kept_reasons', v_kept_reasons);
end;
$function$;

-- ── grants ────────────────────────────────────────────────────────────────
-- assign_lead and assignment_rule_matches were replaced in place and keep their grants.
-- assign_lead_core is internal: only its owner (through assign_lead and the rotation) runs it.
revoke all on function
  public.assign_lead_core(uuid, uuid, uuid, uuid, text, uuid),
  public.assignment_preview(uuid, uuid, integer),
  public.assignment_insights(uuid, timestamptz),
  public.publish_assignment_rules(uuid, uuid, jsonb),
  public.rotate_unanswered_assignments(integer)
  from public, anon, authenticated, tenant_app;
grant execute on function
  public.assignment_preview(uuid, uuid, integer),
  public.assignment_insights(uuid, timestamptz),
  public.publish_assignment_rules(uuid, uuid, jsonb),
  public.rotate_unanswered_assignments(integer)
  to service_role;

-- ── asserted against whatever this database holds ─────────────────────────
do $$
declare
  v_core text;
  v_wrapper text;
  v_rule public.assignment_rules;
  v_lead public.agent_leads;
  v_tenant uuid;
  v_actor uuid;
  v_before bigint;
  v_after bigint;
  v_skips_before bigint;
  v_skips_after bigint;
  v_preview jsonb;
begin
  -- A parse-check run (tenant_app) cannot add the column or replace the functions.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'lead_assignment_events' and column_name = 'rule_id')
     or to_regprocedure('public.assign_lead_core(uuid,uuid,uuid,uuid,text,uuid)') is null then
    raise notice 'lead assignment board: schema not present; skipping the behaviour checks';
    return;
  end if;

  select prosrc into v_core from pg_proc where oid = to_regprocedure('public.assign_lead_core(uuid,uuid,uuid,uuid,text,uuid)');
  select prosrc into v_wrapper from pg_proc where oid = to_regprocedure('public.assign_lead(uuid,uuid,uuid,uuid,text)');
  if v_wrapper not like '%assign_lead_core%' then raise exception 'assign_lead does not route through assign_lead_core'; end if;
  if v_core not like '%v_max_items := 25%' then raise exception 'assign_lead: skip-ahead is missing'; end if;
  if v_core not like '%for v_rule_index in 1 .. cardinality(v_rules)%' then raise exception 'assign_lead: rule fall-through is missing'; end if;
  if v_core not like '%assignment_skip_events%' then raise exception 'assign_lead: the skip log is not written'; end if;
  if v_core not like '%rule_id)%' then raise exception 'assign_lead: rule_id is not recorded on the event'; end if;
  if v_core not like '%ASSIGNMENT_TARGET_RESTING%' or v_core not like '%ASSIGNMENT_HOUSEHOLD_OWNED%' then raise exception 'assign_lead: manual reassignment skips the household checks'; end if;
  if v_core not like '%v_rule.match_type = ''language''%' then raise exception 'assign_lead: language pairing is missing'; end if;
  if v_core not like '%p_rotate_from_user_id is null or tu.user_id <> p_rotate_from_user_id%' then raise exception 'assign_lead: a rotation can hand the lead back to its owner'; end if;
  -- The refusals that must survive.
  if v_core not like '%ASSIGNMENT_TARGET_NOT_ELIGIBLE%' or v_core not like '%ASSIGNMENT_TARGET_AT_CAPACITY%'
     or v_core not like '%REASSIGNMENT_REASON_REQUIRED%' or v_core not like '%ASSIGNMENT_MANAGER_REQUIRED%'
     or v_core not like '%Active ownership is sticky until disposition%' then
    raise exception 'assign_lead lost one of its refusals';
  end if;

  if (select provolatile from pg_proc where oid = to_regprocedure('public.assignment_rule_matches(public.assignment_rules,public.agent_leads)')) <> 's' then
    raise exception 'assignment_rule_matches reads now() and must be stable';
  end if;

  -- Real-time matching, built in memory: nothing is written.
  v_rule.match_type := 'realtime';
  v_rule.match_values := '{"seconds": 60}'::jsonb;
  v_lead.posted_at := now() - interval '10 seconds';
  if not public.assignment_rule_matches(v_rule, v_lead) then raise exception 'a lead posted 10 seconds ago missed a 60-second rule'; end if;
  v_lead.posted_at := now() - interval '5 minutes';
  if public.assignment_rule_matches(v_rule, v_lead) then raise exception 'a lead posted 5 minutes ago matched a 60-second rule'; end if;
  v_lead.posted_at := null;
  if public.assignment_rule_matches(v_rule, v_lead) then raise exception 'a list lead with no posted_at matched a real-time rule'; end if;

  -- The preview leaves nothing behind.
  select tu.tenant_id, tu.user_id into v_tenant, v_actor
    from public.tenant_users tu join public.users u on u.id = tu.user_id and u.status::text = 'active'
   where tu.accepted_at is not null and tu.role::text in ('owner', 'producer')
     and exists (select 1 from public.lead_queue q where q.tenant_id = tu.tenant_id and q.status = 'unclaimed')
   order by tu.tenant_id
   limit 1;
  if v_tenant is null then
    raise notice 'lead assignment board: no tenant with a manager and an unclaimed lead; preview probe skipped';
    return;
  end if;
  select count(*) into v_before from public.lead_assignment_events where tenant_id = v_tenant;
  select count(*) into v_skips_before from public.assignment_skip_events where tenant_id = v_tenant;
  v_preview := public.assignment_preview(v_tenant, v_actor, 3);
  select count(*) into v_after from public.lead_assignment_events where tenant_id = v_tenant;
  select count(*) into v_skips_after from public.assignment_skip_events where tenant_id = v_tenant;
  if jsonb_typeof(v_preview) <> 'array' then raise exception 'assignment_preview did not return rows'; end if;
  if v_after <> v_before or v_skips_after <> v_skips_before then
    raise exception 'assignment_preview left % event(s) and % skip(s) behind', v_after - v_before, v_skips_after - v_skips_before;
  end if;
  raise notice 'lead assignment board: fall-through, skip-ahead, pairing, household and rotation are in place; preview of % lead(s) rolled back cleanly', jsonb_array_length(v_preview);
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924300000', 'lead_assignment_board') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [19/22] 20260924310000_carrier_appointment_status_and_expiry.sql ──────────────
begin;

-- /app/appointments: an appointment can be pending, and it can expire.
--
-- The board shows six states for a carrier × state cell: Appointed, Expires <60d, Pending, Expired,
-- Ended and nothing. The vault kept two (active, terminated) and no expiry, so "Pending" and
-- "Expired" could not be recorded and routing could not respect them. This file:
--
--   appointments.expires_at   the date the carrier's appointment lapses; null = does not expire
--   appointments.status       'pending' | 'active' | 'terminated' (was 'active' | 'terminated')
--   save_appointments_with_details   the grid and the per-cell dialog's save, one statement
--   assignment_candidate_is_eligible / assignment_ineligibility_reason   an expired appointment
--       stops counting, exactly as a terminated one does; a pending one never counted (status must
--       be 'active') and now says so when it is the reason.
--
-- The two eligibility functions are restated from their latest definition, 20260924110000 (applied).
-- No later migration redefines them: 20260924220200 and 20260924300000 only call them. Signatures
-- and grants are unchanged. save_appointments (LA-0.5) is left exactly as it is, for any caller
-- that still uses it; lib/appointments/service.ts calls the new function first and falls back.
--
-- Additive and idempotent. Nothing existing becomes invalid: every row is 'active' or 'terminated'
-- and has no expiry.

-- ── expiry ────────────────────────────────────────────────────────────────
alter table public.appointments add column if not exists expires_at date;
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.appointments'::regclass and conname = 'appointments_expiry_after_effective'
  ) then
    alter table public.appointments
      add constraint appointments_expiry_after_effective check (expires_at is null or expires_at >= effective_from);
  end if;
end $$;

-- ── status: pending, active, terminated ───────────────────────────────────
-- The original check was declared inline, so its name is whatever Postgres chose
-- (appointments_status_check on a fresh database). Find every check on the table that constrains
-- `status` and replace it with one named constraint.
do $$
declare
  r record;
begin
  for r in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.appointments'::regclass
       and c.contype = 'c'
       and c.conname <> 'appointments_status_valid'
       and pg_get_constraintdef(c.oid) ~ '\mstatus\M'
  loop
    execute format('alter table public.appointments drop constraint %I', r.conname);
  end loop;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.appointments'::regclass and conname = 'appointments_status_valid'
  ) then
    alter table public.appointments
      add constraint appointments_status_valid check (status in ('pending', 'active', 'terminated'));
  end if;
end $$;

-- ── the save ──────────────────────────────────────────────────────────────
-- Each element of p_rows: carrier_id, state, status, effective_from, terminated_at, and optionally
-- expires_at and id.
--   id present   edits that row (its effective date included). The row must belong to the tenant
--                and to the same carrier and state, or the batch fails with appointment_not_found.
--   id absent    upserts on (tenant, carrier, state, effective_from), as save_appointments does.
--   expires_at   an absent key keeps what is stored (a JSON null clears it), so the Settings grid,
--                which does not send it, never wipes an expiry an owner set on the page.
--   terminated_at  as in save_appointments: the value sent, null when absent.
create or replace function public.save_appointments_with_details(p_tenant_id uuid, p_rows jsonb)
returns setof public.appointments
language plpgsql
security invoker
set search_path = public
as $$
declare
  item jsonb;
  v_id uuid;
  v_row public.appointments;
begin
  if p_tenant_id is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 500 then
    raise exception 'invalid_appointment_batch' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(p_rows) loop
    v_id := nullif(item->>'id', '')::uuid;
    if v_id is not null then
      update public.appointments a
         set status = item->>'status',
             effective_from = (item->>'effective_from')::date,
             terminated_at = (item->>'terminated_at')::date,
             expires_at = case when item ? 'expires_at' then (item->>'expires_at')::date else a.expires_at end
       where a.id = v_id
         and a.tenant_id = p_tenant_id
         and a.carrier_id = (item->>'carrier_id')::uuid
         and a.state = upper(btrim(item->>'state'))
      returning a.* into v_row;
      if not found then
        raise exception 'appointment_not_found' using errcode = 'P0002';
      end if;
    else
      insert into public.appointments as a (tenant_id, carrier_id, state, status, effective_from, terminated_at, expires_at)
      values (
        p_tenant_id,
        (item->>'carrier_id')::uuid,
        upper(btrim(item->>'state')),
        item->>'status',
        (item->>'effective_from')::date,
        (item->>'terminated_at')::date,
        (item->>'expires_at')::date
      )
      on conflict (tenant_id, carrier_id, state, effective_from) do update set
        status = excluded.status,
        terminated_at = excluded.terminated_at,
        expires_at = case when item ? 'expires_at' then excluded.expires_at else a.expires_at end
      returning a.* into v_row;
    end if;
    return next v_row;
  end loop;
end;
$$;

revoke all on function public.save_appointments_with_details(uuid, jsonb) from public, anon, authenticated, tenant_app;
grant execute on function public.save_appointments_with_details(uuid, jsonb) to service_role;

-- ── eligibility: an expired appointment no longer counts ──────────────────
-- Restated from 20260924110000. The only change in each function is the expires_at condition on
-- the appointment, and, in the reason, two branches that name an expired or pending appointment.
create or replace function public.assignment_candidate_is_eligible(
  p_tenant_id uuid,
  p_user_id uuid,
  p_role text,
  p_product text,
  p_state text,
  p_requires_licensed boolean
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_state text := upper(btrim(coalesce(p_state, '')));
begin
  if p_role not in ('owner', 'producer', 'setter') then return false; end if;
  if p_requires_licensed and p_role = 'setter' then return false; end if;
  if p_role = 'setter' then return true; end if;
  if v_state = '' then return false; end if;

  return
    exists (
      select 1 from public.licenses l
       where l.tenant_id = p_tenant_id
         and upper(btrim(l.state)) = v_state
         and (l.expires_at is null or l.expires_at >= current_date)
    )
    and exists (
      select 1
        from public.appointments a
        join public.tenant_carriers tc
          on tc.tenant_id = a.tenant_id
         and tc.carrier_id = a.carrier_id
         and tc.is_active
       where a.tenant_id = p_tenant_id
         and upper(btrim(a.state)) = v_state
         and a.status = 'active'
         and (a.effective_from is null or a.effective_from <= current_date)
         and (a.terminated_at is null or a.terminated_at >= current_date)
         -- New: an appointment past its expiry stops counting, as a terminated one does.
         and (a.expires_at is null or a.expires_at >= current_date)
    )
    -- The agent's own states, when any are recorded. None recorded means "judge me on the
    -- agency", which is what every agent was before 20260924110000.
    and (
      not exists (select 1 from public.tenant_user_licensed_states s where s.tenant_id = p_tenant_id and s.user_id = p_user_id)
      or exists (select 1 from public.tenant_user_licensed_states s where s.tenant_id = p_tenant_id and s.user_id = p_user_id and s.state = v_state)
    );
end;
$function$;

create or replace function public.assignment_ineligibility_reason(
  p_tenant_id uuid,
  p_user_id uuid,
  p_role text,
  p_product text,
  p_state text,
  p_requires_licensed boolean
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_state text := upper(btrim(coalesce(p_state, '')));
  v_licensed boolean;
  v_appointed boolean;
  v_agent_ok boolean;
begin
  if p_role not in ('owner', 'producer', 'setter') then
    return format('A %s cannot be given leads to work.', coalesce(p_role, 'member with no role'));
  end if;
  if p_requires_licensed and p_role = 'setter' then
    return 'This lead needs a licensed agent, and a setter cannot write business.';
  end if;
  if p_role = 'setter' then return null; end if;
  if v_state = '' then
    return 'This lead has no state on it, so there is no way to tell who is licensed to work it.';
  end if;

  select exists (
    select 1 from public.licenses l
     where l.tenant_id = p_tenant_id and upper(btrim(l.state)) = v_state
       and (l.expires_at is null or l.expires_at >= current_date)
  ) into v_licensed;

  select exists (
    select 1 from public.appointments a
      join public.tenant_carriers tc
        on tc.tenant_id = a.tenant_id and tc.carrier_id = a.carrier_id and tc.is_active
     where a.tenant_id = p_tenant_id and upper(btrim(a.state)) = v_state
       and a.status = 'active'
       and (a.effective_from is null or a.effective_from <= current_date)
       and (a.terminated_at is null or a.terminated_at >= current_date)
       and (a.expires_at is null or a.expires_at >= current_date)
  ) into v_appointed;

  select not exists (select 1 from public.tenant_user_licensed_states s where s.tenant_id = p_tenant_id and s.user_id = p_user_id)
      or exists (select 1 from public.tenant_user_licensed_states s where s.tenant_id = p_tenant_id and s.user_id = p_user_id and s.state = v_state)
    into v_agent_ok;

  if v_licensed and v_appointed and v_agent_ok then return null; end if;

  if not v_licensed and not v_appointed then
    return format(
      'Your agency %s for %s and has no active carrier appointment there. Both are needed before anyone can be given a %s lead.',
      case when exists (select 1 from public.licenses l where l.tenant_id = p_tenant_id and upper(btrim(l.state)) = v_state)
           then 'has an expired licence' else 'has no licence on record' end,
      v_state, v_state);
  end if;
  if not v_licensed then
    if exists (select 1 from public.licenses l where l.tenant_id = p_tenant_id and upper(btrim(l.state)) = v_state) then
      return format('Your agency''s %s licence has expired. Renew it on States & licences before working %s leads.', v_state, v_state);
    end if;
    return format('Your agency has no %s licence on record. Add it on States & licences before working %s leads.', v_state, v_state);
  end if;
  if not v_appointed then
    -- New: say which of the two new reasons it is, when it is one of them.
    if exists (
      select 1 from public.appointments a
        join public.tenant_carriers tc on tc.tenant_id = a.tenant_id and tc.carrier_id = a.carrier_id and tc.is_active
       where a.tenant_id = p_tenant_id and upper(btrim(a.state)) = v_state
         and a.status = 'active'
         and (a.effective_from is null or a.effective_from <= current_date)
         and (a.terminated_at is null or a.terminated_at >= current_date)
         and a.expires_at < current_date
    ) then
      return format('Your agency''s carrier appointment in %s has expired, so nothing can be written there. Renew it on Appointments & licences.', v_state);
    end if;
    if exists (
      select 1 from public.appointments a
        join public.tenant_carriers tc on tc.tenant_id = a.tenant_id and tc.carrier_id = a.carrier_id and tc.is_active
       where a.tenant_id = p_tenant_id and upper(btrim(a.state)) = v_state
         and a.status = 'pending'
    ) then
      return format('Your agency''s carrier appointment in %s is still pending with the carrier. %s leads can be worked once it is active.', v_state, v_state);
    end if;
    return format('Your agency is licensed in %s but has no active carrier appointment there, so nothing can be written. Add one on States & licences.', v_state);
  end if;
  return format('This agent is not licensed in %s. Add %s to their licensed states on Team & access, or give the lead to someone who is.', v_state, v_state);
end;
$function$;

revoke all on function public.assignment_candidate_is_eligible(uuid, uuid, text, text, text, boolean)
  from public, anon, authenticated, tenant_app;
grant execute on function public.assignment_candidate_is_eligible(uuid, uuid, text, text, text, boolean)
  to service_role;
revoke all on function public.assignment_ineligibility_reason(uuid, uuid, text, text, text, boolean)
  from public, anon, authenticated, tenant_app;
grant execute on function public.assignment_ineligibility_reason(uuid, uuid, text, text, text, boolean)
  to service_role;

-- ── asserted against whatever this database holds ─────────────────────────
do $$
declare
  v_def text;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'appointments' and column_name = 'expires_at'
  ) then
    raise exception 'appointments.expires_at is missing';
  end if;

  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = 'public.appointments'::regclass and c.conname = 'appointments_status_valid';
  if v_def is null or v_def !~ 'pending' or v_def !~ 'active' or v_def !~ 'terminated' then
    raise exception 'appointments_status_valid does not admit pending, active and terminated: %', v_def;
  end if;
  if exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.appointments'::regclass and c.contype = 'c'
       and c.conname <> 'appointments_status_valid' and pg_get_constraintdef(c.oid) ~ '\mstatus\M'
  ) then
    raise exception 'an older status check on appointments survived and still refuses pending';
  end if;
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.appointments'::regclass and c.conname = 'appointments_expiry_after_effective'
  ) then
    raise exception 'appointments_expiry_after_effective is missing';
  end if;

  if to_regprocedure('public.save_appointments_with_details(uuid, jsonb)') is null then
    raise exception 'save_appointments_with_details is missing';
  end if;
  if to_regprocedure('public.save_appointments(uuid, jsonb)') is null then
    raise exception 'save_appointments was dropped; it must stay for its existing callers';
  end if;

  select pg_get_functiondef('public.assignment_candidate_is_eligible(uuid, uuid, text, text, text, boolean)'::regprocedure) into v_def;
  if v_def !~ 'a\.expires_at is null or a\.expires_at >= current_date' or v_def !~ 'a\.status = ''active''' or v_def !~ 'tenant_user_licensed_states' then
    raise exception 'assignment_candidate_is_eligible lost a rule after the rewrite';
  end if;
  select pg_get_functiondef('public.assignment_ineligibility_reason(uuid, uuid, text, text, text, boolean)'::regprocedure) into v_def;
  if v_def !~ 'has expired, so nothing can be written there' or v_def !~ 'still pending with the carrier' then
    raise exception 'assignment_ineligibility_reason does not explain an expired or pending appointment';
  end if;

  if has_function_privilege('tenant_app', 'public.save_appointments_with_details(uuid, jsonb)', 'execute')
     or has_function_privilege('tenant_app', 'public.assignment_candidate_is_eligible(uuid, uuid, text, text, text, boolean)', 'execute') then
    raise exception 'the tenant plane can execute a service-role function';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924310000', 'carrier_appointment_status_and_expiry') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [20/22] 20260924310100_carrier_training_requirements.sql ──────────────────────
begin;

-- /app/appointments: carrier-specific trainings.
--
-- The board's Continuing education card counts "Carrier-specific · 2 outstanding", and its Readiness
-- card lists trainings coming due. Carriers require their own product and AML trainings before an
-- agent may sell for them, separate from the state's CE hours, and nothing recorded them, so the
-- count would have been invented. One row per training an owner records against a carrier; it is
-- outstanding until completed_on is set.
--
-- Same arrangement as tenant_carrier_requirements (20260924220100): written by the service role
-- after the API has checked the caller is an owner with full access; the tenant plane may read its
-- own tenant's rows. Additive and idempotent.

create table if not exists public.tenant_carrier_training (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete cascade,
  title text not null,
  due_on date not null,
  completed_on date,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  constraint tenant_carrier_training_title_length check (char_length(btrim(title)) between 1 and 160)
);
create index if not exists tenant_carrier_training_tenant_due_idx on public.tenant_carrier_training (tenant_id, due_on);
create index if not exists tenant_carrier_training_carrier_idx on public.tenant_carrier_training (carrier_id);
create index if not exists tenant_carrier_training_updated_by_idx on public.tenant_carrier_training (updated_by);

alter table public.tenant_carrier_training enable row level security;
revoke all on public.tenant_carrier_training from public, anon, authenticated;
grant select, insert, update, delete on public.tenant_carrier_training to service_role;
grant select on public.tenant_carrier_training to tenant_app;
drop policy if exists tenant_carrier_training_read on public.tenant_carrier_training;
create policy tenant_carrier_training_read on public.tenant_carrier_training
  for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- ── asserted against whatever this database holds ─────────────────────────
do $$
begin
  if to_regclass('public.tenant_carrier_training') is null then
    raise exception 'tenant_carrier_training is missing';
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'tenant_carrier_training' and c.relrowsecurity
  ) then
    raise exception 'tenant_carrier_training has row level security switched off';
  end if;
  if has_table_privilege('tenant_app', 'public.tenant_carrier_training', 'insert')
     or has_table_privilege('tenant_app', 'public.tenant_carrier_training', 'update')
     or has_table_privilege('tenant_app', 'public.tenant_carrier_training', 'delete') then
    raise exception 'the tenant plane can write carrier trainings';
  end if;
  if not has_table_privilege('tenant_app', 'public.tenant_carrier_training', 'select') then
    raise exception 'the tenant plane cannot read carrier trainings';
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'tenant_carrier_training' and policyname = 'tenant_carrier_training_read'
  ) then
    raise exception 'tenant_carrier_training_read policy is missing';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924310100', 'carrier_training_requirements') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [21/22] 20260924341900_restore_pool_leads_stuck_in_working.sql ────────────────
begin;

-- ---------------------------------------------------------------------------
-- Pool leads stuck in `working` are returned to the cadence.
--
-- 20260913401000 made serve_next_lead's reclaim restore the LEAD as well as the work item: a lead
-- whose lock lapsed went back to `fresh` (never dialled) or `retry` (due now). 20260917144000
-- restated serve_next_lead and dropped that restore, so for a week every abandoned lock put the
-- work item back in the pool with its lead still `working` — a state no serving tier matches. The
-- item is visible, unclaimed, and never served again. 20260924323000 put the restore back; this
-- repairs the leads the gap left behind.
--
-- Measured before writing (2026-09-24, service role, all tenants): 15 pool items with a `working`
-- lead, all in one tenant, none with an attempt on them. The rule is the reclaim's, applied once:
--   · a lead nobody dialled goes back to `fresh`, its next_dial_after untouched;
--   · a lead with attempts goes back to `retry`, due now (the abandoned call was not an attempt).
-- Only items that are genuinely in the pool: unclaimed, not locked, and with no other live claim on
-- the same lead. A `working` lead behind a claimed item is being worked and is left alone.
--
-- Idempotent: a second run finds nothing to change.
-- ---------------------------------------------------------------------------

update public.agent_leads l
   set lead_state = case when coalesce(l.attempts_made, 0) = 0 then 'fresh' else 'retry' end,
       next_dial_after = case when coalesce(l.attempts_made, 0) = 0 then l.next_dial_after
                              else least(coalesce(l.next_dial_after, now()), now()) end,
       updated_at = now()
  from public.lead_queue q
 where q.lead_id = l.id
   and q.tenant_id = l.tenant_id
   and q.status = 'unclaimed'
   and (q.locked_until is null or q.locked_until < now())
   and l.lead_state = 'working'
   and not exists (
         select 1 from public.lead_queue other
          where other.lead_id = l.id
            and other.tenant_id = l.tenant_id
            and other.status = 'claimed'
       );

do $$
declare
  v_left integer;
begin
  select count(*) into v_left
    from public.lead_queue q
    join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
   where q.status = 'unclaimed'
     and (q.locked_until is null or q.locked_until < now())
     and l.lead_state = 'working'
     and not exists (select 1 from public.lead_queue other
                      where other.lead_id = l.id and other.tenant_id = l.tenant_id and other.status = 'claimed');
  if v_left <> 0 then
    raise exception '% pool leads are still stuck in working', v_left;
  end if;
  raise notice 'no pool lead is stuck in working';
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924341900', 'restore_pool_leads_stuck_in_working') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [22/22] 20260925100000_pipeline_views_stage_rules_and_history.sql ─────────────
begin;

-- Pipeline views (the /app/leads Stages · Board · Table · List screens, the stage editor and the
-- new-pipeline wizard). Additive only: new columns with defaults, one new table, one new function.
-- Nothing is dropped or renamed, and the screens work before this is applied — they switch these
-- features on when the columns and the function exist.
--
--   1. A stage can say how long a lead may sit in it (time_allowed_minutes) and whether reaching it
--      counts as the lead being worked (counts_as_worked). Past the time a lead turns red everywhere;
--      it never moves on its own.
--   2. A pipeline can be a draft (status = 'draft'): built but not live. A draft is never a default,
--      so no lead is routed into it, and agents are not offered it.
--   3. Every stage change is written down (tenant_lead_stage_events): from where, to where, which
--      disposition moved it, from which screen, and who. Until now only the audit log held the new
--      stage — never the old one.
--   4. apply_lead_disposition_move: the one path a board drop, a table bulk change or a list quick
--      action takes. It resolves the disposition's stage (one stage per outcome, agency-wide — the
--      existing stage_dispositions rule), moves the lead on all three rows it is stored on, stamps
--      the outcome on the work item and records the event, in one transaction.

-- ── 1. stage rules ────────────────────────────────────────────────────────────────────────────
alter table public.tenant_pipeline_stages
  add column if not exists time_allowed_minutes integer;

-- The first stage of a pipeline is where a lead arrives untouched, so it is not "worked" by default.
-- Set only in the run that adds the column; a re-run never overwrites what an owner chose since.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tenant_pipeline_stages' and column_name = 'counts_as_worked'
  ) then
    alter table public.tenant_pipeline_stages add column counts_as_worked boolean not null default true;
    update public.tenant_pipeline_stages set counts_as_worked = false where position = 0;
  end if;
end;
$$;

alter table public.tenant_pipeline_stages drop constraint if exists tenant_pipeline_stages_time_allowed_range;
alter table public.tenant_pipeline_stages add constraint tenant_pipeline_stages_time_allowed_range
  check (time_allowed_minutes is null or (time_allowed_minutes between 1 and 525600));

-- When a lead entered the stage it is in — what "in stage 2d 04h" and "past the time allowed" are
-- measured from. Kept by a trigger on every stage change, so the dialer, the outcome wizard, the
-- board and an owner's correction all keep it right without each remembering to.
alter table public.agent_leads add column if not exists stage_entered_at timestamptz;
-- Deliberately NOT backfilled. Leads already in a stage have no honest entry time: updated_at moves
-- on any edit, and rewriting ~215k rows would fire agent_leads_touch_updated_at (erasing "last
-- touched" across the book) or need a table lock to avoid it. A null reads as "since arrival" in the
-- app and is never counted past its time allowed; the trigger below stamps every lead on its next
-- stage change, and setting a default rewrites nothing that exists.
alter table public.agent_leads alter column stage_entered_at set default now();

create or replace function public.agent_leads_stamp_stage_entered()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.stage_entered_at := coalesce(new.stage_entered_at, now());
  elsif new.stage_id is distinct from old.stage_id then
    new.stage_entered_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists agent_leads_stamp_stage_entered on public.agent_leads;
create trigger agent_leads_stamp_stage_entered
  before insert or update of stage_id on public.agent_leads
  for each row execute function public.agent_leads_stamp_stage_entered();

create index if not exists agent_leads_tenant_stage_entered_idx
  on public.agent_leads (tenant_id, stage_id, stage_entered_at);

-- ── 2. draft pipelines ────────────────────────────────────────────────────────────────────────
alter table public.tenant_pipelines
  add column if not exists status text not null default 'live';

alter table public.tenant_pipelines drop constraint if exists tenant_pipelines_status_check;
alter table public.tenant_pipelines add constraint tenant_pipelines_status_check
  check (status in ('draft', 'live'));

-- A draft can never be where new leads land.
alter table public.tenant_pipelines drop constraint if exists tenant_pipelines_draft_not_default;
alter table public.tenant_pipelines add constraint tenant_pipelines_draft_not_default
  check (status = 'live' or not is_default);

-- ── 3. stage history ──────────────────────────────────────────────────────────────────────────
create table if not exists public.tenant_lead_stage_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  from_pipeline_id uuid,
  from_stage_id uuid,
  to_pipeline_id uuid not null,
  to_stage_id uuid not null,
  -- Null only for an owner correcting data with the direct stage edit.
  disposition_key text,
  source text not null check (source in ('board', 'table', 'list', 'lead_detail', 'owner_fix')),
  actor_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists tenant_lead_stage_events_lead_idx
  on public.tenant_lead_stage_events (tenant_id, lead_id, created_at desc);
create index if not exists tenant_lead_stage_events_stage_idx
  on public.tenant_lead_stage_events (tenant_id, to_stage_id, created_at desc);

alter table public.tenant_lead_stage_events enable row level security;
drop policy if exists tenant_lead_stage_events_tenant_scoped on public.tenant_lead_stage_events;
create policy tenant_lead_stage_events_tenant_scoped on public.tenant_lead_stage_events
  for all to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)
  with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_lead_stage_events from anon, authenticated, public;
grant select on public.tenant_lead_stage_events to tenant_app;
-- Append-only: the history is only ever added to.
grant select, insert on public.tenant_lead_stage_events to service_role;

-- ── 4. the move ───────────────────────────────────────────────────────────────────────────────
create or replace function public.apply_lead_disposition_move(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_disposition_key text,
  p_actor uuid,
  p_source text
)
returns table (lead_id uuid, from_stage_id uuid, to_pipeline_id uuid, to_stage_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_destination record;
  v_lead record;
begin
  if p_source not in ('board', 'table', 'list', 'lead_detail') then
    raise exception 'invalid_move_source';
  end if;

  -- The outcome must exist and still be pickable.
  if not exists (
    select 1 from public.dispositions d
     where d.tenant_id = p_tenant_id and d.disposition_key = p_disposition_key and d.is_active
  ) then
    raise exception 'disposition_not_active';
  end if;

  -- Its one stage, which must be live and in a live pipeline.
  select s.pipeline_id, s.id as stage_id into v_destination
    from public.stage_dispositions m
    join public.tenant_pipeline_stages s on s.id = m.stage_id
    join public.tenant_pipelines p on p.id = s.pipeline_id and p.tenant_id = m.tenant_id
   where m.tenant_id = p_tenant_id
     and m.disposition_key = p_disposition_key
     and not s.is_archived
     and p.status = 'live';
  if not found then raise exception 'disposition_not_mapped'; end if;

  select l.pipeline_id, l.stage_id into v_lead
    from public.agent_leads l
   where l.id = p_lead_id and l.tenant_id = p_tenant_id
   for update;
  if not found then raise exception 'lead_not_found'; end if;

  update public.agent_leads
     set pipeline_id = v_destination.pipeline_id, stage_id = v_destination.stage_id, updated_at = now()
   where id = p_lead_id and tenant_id = p_tenant_id;
  update public.lead_queue
     set pipeline_id = v_destination.pipeline_id, stage_id = v_destination.stage_id,
         disposition = p_disposition_key, disposition_at = now(), disposition_by = p_actor, updated_at = now()
   where lead_queue.lead_id = p_lead_id and lead_queue.tenant_id = p_tenant_id;
  update public.deal_flow
     set pipeline_id = v_destination.pipeline_id, stage_id = v_destination.stage_id, updated_at = now()
   where deal_flow.lead_id = p_lead_id and deal_flow.tenant_id = p_tenant_id;

  insert into public.tenant_lead_stage_events
    (tenant_id, lead_id, from_pipeline_id, from_stage_id, to_pipeline_id, to_stage_id, disposition_key, source, actor_user_id)
  values
    (p_tenant_id, p_lead_id, v_lead.pipeline_id, v_lead.stage_id, v_destination.pipeline_id, v_destination.stage_id, p_disposition_key, p_source, p_actor);

  return query select p_lead_id, v_lead.stage_id, v_destination.pipeline_id, v_destination.stage_id;
end;
$$;

revoke all on function public.apply_lead_disposition_move(uuid, uuid, text, uuid, text) from public, anon, authenticated, tenant_app;
grant execute on function public.apply_lead_disposition_move(uuid, uuid, text, uuid, text) to service_role;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260925100000', 'pipeline_views_stage_rules_and_history') on conflict do nothing;
  end if;
end $bundle$;
commit;
