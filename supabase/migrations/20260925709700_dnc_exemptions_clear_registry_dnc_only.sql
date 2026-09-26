-- ---------------------------------------------------------------------------
-- LA-2.3-3 · a recorded consent or business relationship clears federal/state DNC, and nothing else
--
-- Spec: "Federal/state DNC not dialable unless an explicit recorded consent / prior-relationship
-- record exists." Until now no record could clear a DNC hit anywhere.
--
-- User decision (binding, 2026-09-25): an OWNER records one exemption per number, on one of two
-- bases.
--   written_consent                 must attach a STORED consent certificate: a claimed
--                                   tenant_consent_artefacts row whose copy we hold (stored_copy or
--                                   stored_ref), on a lead with this same number. No expiry, until
--                                   revoked or the certificate stops being held.
--   existing_business_relationship  with its date and kind. Expires 18 months after a purchase,
--                                   3 months after an inquiry (the TSR windows).
-- It clears ONLY the federal and state DNC lists for that number. It never clears the tenant's own
-- do-not-call list (tenant_do_not_call) and never a TCPA litigator. Every use is audited.
--
-- What this file adds:
--   tenant_dnc_exemptions        the records. One unrevoked row per (tenant, number).
--   tenant_dnc_exemption_uses    one row per time an exemption cleared a DNC hit (the audit).
--   dnc_exemption_active_id()    the one test every gate uses. STABLE, read-only.
--   active_dnc_exemption()       the active record, for display (the TCPA screen and the dial).
--   record_dnc_exemption()       owner only, validates the basis, refuses a second active record.
--   revoke_dnc_exemption()       owner only, keeps the row (evidence) and stops it clearing.
--   use_dnc_exemption()          writes one audit row for a use the caller made (for the live DNC
--                                vendor lookup at the dial, which the database never sees).
-- What changes (from the live definitions):
--   is_phone_suppressed          the serve path, lead posting, lead lists and the TCPA check: a
--                                federal_dnc / state_dnc row is ignored while an exemption is
--                                active. internal and tcpa_litigator rows are untouched.
--   tenant_phone_suppression_hits  the dialer's gate: the same rule, and every call that clears a
--                                stored DNC hit writes a 'dial_gate' use row. It becomes VOLATILE
--                                for that write (same signature, same return type).
--
-- Safe order: the new objects exist before the two functions that read them are replaced, all in
-- one file. Before this file is applied the app answers 503 on every write and reads nothing.
-- ---------------------------------------------------------------------------

-- ── the records ────────────────────────────────────────────────────────────
create table if not exists public.tenant_dnc_exemptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone_digits text not null check (phone_digits ~ '^[0-9]{10}$'),
  basis text not null check (basis in ('written_consent', 'existing_business_relationship')),
  -- The certificate is referenced, not foreign-keyed: a lead's deletion cascades to its artefacts,
  -- and an FK would either block that deletion or erase this evidence with it. The provider and
  -- the certificate link are kept on the row, and the active test re-checks that the certificate
  -- is still held, so an exemption whose evidence is gone stops clearing anything.
  consent_artefact_id uuid,
  certificate_provider text,
  certificate_url text,
  relationship_kind text check (relationship_kind is null or relationship_kind in ('purchase', 'inquiry')),
  relationship_date date,
  expires_at timestamptz,
  note text check (note is null or length(note) <= 500),
  recorded_by uuid references public.users(id) on delete set null,
  recorded_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.users(id) on delete set null,
  revoke_reason text check (revoke_reason is null or length(revoke_reason) <= 500),
  constraint tenant_dnc_exemptions_basis_shape check (
    (basis = 'written_consent'
      and consent_artefact_id is not null and relationship_kind is null and relationship_date is null and expires_at is null)
    or
    (basis = 'existing_business_relationship'
      and consent_artefact_id is null and relationship_kind is not null and relationship_date is not null and expires_at is not null)
  ),
  constraint tenant_dnc_exemptions_revoke_shape check (revoked_at is null or revoke_reason is not null)
);

-- One open record per number, as an exclusion constraint (the same shape as
-- tenant_recycle_batches_one_open). record_dnc_exemption checks first, this closes the race.
alter table public.tenant_dnc_exemptions drop constraint if exists tenant_dnc_exemptions_one_open;
alter table public.tenant_dnc_exemptions
  add constraint tenant_dnc_exemptions_one_open
  exclude using btree (tenant_id with =, phone_digits with =) where (revoked_at is null);
create index if not exists tenant_dnc_exemptions_tenant_recorded_idx
  on public.tenant_dnc_exemptions (tenant_id, recorded_at desc);
create index if not exists tenant_dnc_exemptions_recorded_by_idx
  on public.tenant_dnc_exemptions (recorded_by) where recorded_by is not null;
create index if not exists tenant_dnc_exemptions_revoked_by_idx
  on public.tenant_dnc_exemptions (revoked_by) where revoked_by is not null;

alter table public.tenant_dnc_exemptions enable row level security;
drop policy if exists tenant_dnc_exemptions_tenant_scoped on public.tenant_dnc_exemptions;
create policy tenant_dnc_exemptions_tenant_scoped on public.tenant_dnc_exemptions
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.tenant_dnc_exemptions from anon, authenticated, public;
grant select on public.tenant_dnc_exemptions to tenant_app;
grant select, insert, update on public.tenant_dnc_exemptions to service_role;

-- ── every use ──────────────────────────────────────────────────────────────
create table if not exists public.tenant_dnc_exemption_uses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  exemption_id uuid not null references public.tenant_dnc_exemptions(id) on delete cascade,
  phone_digits text not null check (phone_digits ~ '^[0-9]{10}$'),
  -- dial_gate       the dialer's stored-list gate cleared a federal/state DNC hit
  -- dial            the live DNC registry lookup at the click listed it and the exemption cleared it
  -- dial_preflight  the Check a number dialog
  -- lead_post       a real-time post
  context text not null check (context in ('dial_gate', 'dial', 'dial_preflight', 'lead_post')),
  cleared_lists text[] not null default '{}'::text[]
    check (cleared_lists <@ array['federal_dnc', 'state_dnc', 'dnc_registry']::text[]),
  lead_id uuid references public.agent_leads(id) on delete set null,
  attempt_id uuid,
  user_id uuid references public.users(id) on delete set null,
  used_at timestamptz not null default now()
);

create index if not exists tenant_dnc_exemption_uses_tenant_idx
  on public.tenant_dnc_exemption_uses (tenant_id, used_at desc);
create index if not exists tenant_dnc_exemption_uses_exemption_idx
  on public.tenant_dnc_exemption_uses (exemption_id, used_at desc);
create index if not exists tenant_dnc_exemption_uses_lead_idx
  on public.tenant_dnc_exemption_uses (lead_id) where lead_id is not null;
create index if not exists tenant_dnc_exemption_uses_user_idx
  on public.tenant_dnc_exemption_uses (user_id) where user_id is not null;

alter table public.tenant_dnc_exemption_uses enable row level security;
drop policy if exists tenant_dnc_exemption_uses_tenant_scoped on public.tenant_dnc_exemption_uses;
create policy tenant_dnc_exemption_uses_tenant_scoped on public.tenant_dnc_exemption_uses
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
-- Evidence: appended, never edited.
revoke all on public.tenant_dnc_exemption_uses from anon, authenticated, public;
grant select on public.tenant_dnc_exemption_uses to tenant_app;
grant select, insert on public.tenant_dnc_exemption_uses to service_role;

-- ── the one test ───────────────────────────────────────────────────────────
-- The id of the exemption that clears federal/state DNC for this number at p_at, or null. Same
-- normalisation as is_phone_suppressed (digits only, a leading 1 dropped from eleven digits).
create or replace function public.dnc_exemption_active_id(p_tenant_id uuid, p_phone text, p_at timestamptz default now())
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  select e.id
    from public.tenant_dnc_exemptions e
   cross join lateral (
     select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as raw
   ) x
   where e.tenant_id = p_tenant_id
     and e.phone_digits = case when length(x.raw) = 11 and left(x.raw, 1) = '1' then right(x.raw, 10) else x.raw end
     and e.revoked_at is null
     and (e.expires_at is null or e.expires_at > coalesce(p_at, now()))
     and (e.basis <> 'written_consent' or exists (
           select 1 from public.tenant_consent_artefacts a
            where a.id = e.consent_artefact_id and a.tenant_id = e.tenant_id
              and a.capture_status = 'claimed'
              and (a.stored_copy is not null or a.stored_ref is not null)))
   limit 1;
$function$;

revoke all on function public.dnc_exemption_active_id(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.dnc_exemption_active_id(uuid, text, timestamptz) to tenant_app, service_role;

-- The active record, for display.
create or replace function public.active_dnc_exemption(p_tenant_id uuid, p_phone text)
returns table(exemption_id uuid, basis text, relationship_kind text, relationship_date date, expires_at timestamptz,
              consent_artefact_id uuid, certificate_provider text, certificate_url text,
              recorded_by uuid, recorded_at timestamptz, note text)
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  select e.id, e.basis, e.relationship_kind, e.relationship_date, e.expires_at,
         e.consent_artefact_id, e.certificate_provider, e.certificate_url,
         e.recorded_by, e.recorded_at, e.note
    from public.tenant_dnc_exemptions e
   where e.id = public.dnc_exemption_active_id(p_tenant_id, p_phone, now());
$function$;

revoke all on function public.active_dnc_exemption(uuid, text) from public, anon, authenticated;
grant execute on function public.active_dnc_exemption(uuid, text) to tenant_app, service_role;

-- ── recording ──────────────────────────────────────────────────────────────
create or replace function public.record_dnc_exemption(
  p_tenant_id uuid,
  p_phone text,
  p_basis text,
  p_consent_artefact_id uuid,
  p_relationship_kind text,
  p_relationship_date date,
  p_note text,
  p_actor uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_digits text;
  v_role text;
  v_open_id uuid;
  v_open_expires timestamptz;
  v_art_id uuid;
  v_art_lead uuid;
  v_art_provider text;
  v_art_url text;
  v_art_status text;
  v_art_held boolean;
  v_lead_digits text;
  v_expires timestamptz;
  v_id uuid;
begin
  v_digits := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if length(v_digits) = 11 and left(v_digits, 1) = '1' then
    v_digits := right(v_digits, 10);
  end if;
  if length(v_digits) <> 10 then
    raise exception 'not_a_us_phone: % could not be normalised to ten digits', p_phone using errcode = 'check_violation';
  end if;

  select tu.role::text into v_role from public.tenant_users tu where tu.tenant_id = p_tenant_id and tu.user_id = p_actor;
  if v_role is distinct from 'owner' then
    raise exception 'dnc_exemption_owner_only: only an owner records a DNC exemption' using errcode = 'insufficient_privilege';
  end if;

  if p_basis = 'written_consent' then
    if p_consent_artefact_id is null then
      raise exception 'dnc_exemption_certificate_required: written consent needs a stored consent certificate' using errcode = 'check_violation';
    end if;
    select a.id, a.lead_id, a.provider, a.certificate_url, a.capture_status,
           (a.stored_copy is not null or a.stored_ref is not null)
      into v_art_id, v_art_lead, v_art_provider, v_art_url, v_art_status, v_art_held
      from public.tenant_consent_artefacts a
     where a.id = p_consent_artefact_id and a.tenant_id = p_tenant_id;
    if v_art_id is null then
      raise exception 'dnc_exemption_certificate_not_found: that consent certificate is not on this workspace' using errcode = 'check_violation';
    end if;
    if v_art_status is distinct from 'claimed' or not coalesce(v_art_held, false) then
      raise exception 'dnc_exemption_certificate_not_stored: the certificate is not claimed and stored' using errcode = 'check_violation';
    end if;
    select regexp_replace(coalesce(l.values->>'phone', l.values->>'phone_number', ''), '[^0-9]', '', 'g')
      into v_lead_digits
      from public.agent_leads l
     where l.id = v_art_lead and l.tenant_id = p_tenant_id;
    if length(v_lead_digits) = 11 and left(v_lead_digits, 1) = '1' then
      v_lead_digits := right(v_lead_digits, 10);
    end if;
    if v_lead_digits is distinct from v_digits then
      raise exception 'dnc_exemption_certificate_other_number: the certificate belongs to a lead with a different number' using errcode = 'check_violation';
    end if;
    v_expires := null;
  elsif p_basis = 'existing_business_relationship' then
    if p_relationship_kind is null or p_relationship_kind not in ('purchase', 'inquiry') then
      raise exception 'dnc_exemption_relationship_kind: say whether the relationship is a purchase or an inquiry' using errcode = 'check_violation';
    end if;
    if p_relationship_date is null or p_relationship_date > current_date then
      raise exception 'dnc_exemption_relationship_date: the relationship date must be today or earlier' using errcode = 'check_violation';
    end if;
    if p_relationship_kind = 'purchase' then
      v_expires := ((p_relationship_date + interval '18 months')::date)::timestamp at time zone 'UTC';
    else
      v_expires := ((p_relationship_date + interval '3 months')::date)::timestamp at time zone 'UTC';
    end if;
    if v_expires <= now() then
      raise exception 'dnc_exemption_expired: a relationship from that date has already expired' using errcode = 'check_violation';
    end if;
  else
    raise exception 'dnc_exemption_basis: the basis must be written consent or an existing business relationship' using errcode = 'check_violation';
  end if;

  -- One open record per number. An expired one is closed (kept, as evidence) so a new one can be
  -- recorded. A live one is refused: revoke it first, so replacing a record is always two audited acts.
  select e.id, e.expires_at into v_open_id, v_open_expires
    from public.tenant_dnc_exemptions e
   where e.tenant_id = p_tenant_id and e.phone_digits = v_digits and e.revoked_at is null
   for update;
  if v_open_id is not null then
    if v_open_expires is not null and v_open_expires <= now() then
      update public.tenant_dnc_exemptions
         set revoked_at = now(), revoked_by = p_actor, revoke_reason = 'Expired, closed when a new record was made'
       where id = v_open_id;
    else
      raise exception 'dnc_exemption_exists: this number already has an active exemption' using errcode = 'unique_violation';
    end if;
  end if;

  insert into public.tenant_dnc_exemptions
    (tenant_id, phone_digits, basis, consent_artefact_id, certificate_provider, certificate_url,
     relationship_kind, relationship_date, expires_at, note, recorded_by)
  values
    (p_tenant_id, v_digits, p_basis,
     v_art_id, v_art_provider, v_art_url,
     case when p_basis = 'existing_business_relationship' then p_relationship_kind end,
     case when p_basis = 'existing_business_relationship' then p_relationship_date end,
     v_expires, nullif(btrim(coalesce(p_note, '')), ''), p_actor)
  returning id into v_id;
  return v_id;
end;
$function$;

revoke all on function public.record_dnc_exemption(uuid, text, text, uuid, text, date, text, uuid) from public, anon, authenticated;
grant execute on function public.record_dnc_exemption(uuid, text, text, uuid, text, date, text, uuid) to service_role;

create or replace function public.revoke_dnc_exemption(p_tenant_id uuid, p_exemption_id uuid, p_actor uuid, p_reason text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_role text;
  v_id uuid;
begin
  select tu.role::text into v_role from public.tenant_users tu where tu.tenant_id = p_tenant_id and tu.user_id = p_actor;
  if v_role is distinct from 'owner' then
    raise exception 'dnc_exemption_owner_only: only an owner revokes a DNC exemption' using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'dnc_exemption_reason_required: say why the exemption is revoked' using errcode = 'check_violation';
  end if;
  update public.tenant_dnc_exemptions
     set revoked_at = now(), revoked_by = p_actor, revoke_reason = left(btrim(p_reason), 500)
   where id = p_exemption_id and tenant_id = p_tenant_id and revoked_at is null
  returning id into v_id;
  if v_id is null then
    raise exception 'dnc_exemption_not_open: that exemption is not on this workspace or is already revoked' using errcode = 'no_data_found';
  end if;
  return v_id;
end;
$function$;

revoke all on function public.revoke_dnc_exemption(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.revoke_dnc_exemption(uuid, uuid, uuid, text) to service_role;

-- A use the caller made (the live registry lookup at the dial, which the database never sees).
-- Returns the exemption that cleared it and the audit row, or no row when nothing is active.
create or replace function public.use_dnc_exemption(
  p_tenant_id uuid,
  p_phone text,
  p_context text,
  p_cleared_lists text[],
  p_lead_id uuid default null,
  p_attempt_id uuid default null,
  p_actor uuid default null
)
returns table(exemption_id uuid, basis text, expires_at timestamptz, use_id uuid)
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $function$
#variable_conflict use_column
declare
  v_id uuid;
  v_digits text;
  v_use uuid;
  v_lists text[];
begin
  v_id := public.dnc_exemption_active_id(p_tenant_id, p_phone, now());
  if v_id is null then
    return;
  end if;
  select e.phone_digits into v_digits from public.tenant_dnc_exemptions e where e.id = v_id;
  select coalesce(array_agg(distinct l order by l), '{}'::text[]) into v_lists
    from unnest(coalesce(p_cleared_lists, '{}'::text[])) l
   where l in ('federal_dnc', 'state_dnc', 'dnc_registry');
  insert into public.tenant_dnc_exemption_uses (tenant_id, exemption_id, phone_digits, context, cleared_lists, lead_id, attempt_id, user_id)
  values (p_tenant_id, v_id, v_digits, p_context, v_lists, p_lead_id, p_attempt_id, p_actor)
  returning id into v_use;
  return query select e.id, e.basis, e.expires_at, v_use from public.tenant_dnc_exemptions e where e.id = v_id;
end;
$function$;

revoke all on function public.use_dnc_exemption(uuid, text, text, text[], uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.use_dnc_exemption(uuid, text, text, text[], uuid, uuid, uuid) to service_role;

-- ── is_phone_suppressed, from the live definition (20260913300000), exemption-aware ─────────────
create or replace function public.is_phone_suppressed(p_tenant_id uuid, p_phone text)
returns table(suppressed boolean, list_type text, reason text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_digits text;
begin
  v_digits := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if length(v_digits) = 11 and left(v_digits, 1) = '1' then
    v_digits := right(v_digits, 10);
  end if;

  return query
    select true, hit.list_type, hit.reason
      from (
        select s.list_type, s.reason
          from tenant_suppression_list s
         where s.tenant_id = p_tenant_id and s.phone_digits = v_digits
           -- [709700] A recorded consent or business relationship clears federal and state DNC for
           -- this number, and nothing else: internal and litigator rows are never skipped.
           and not (s.list_type in ('federal_dnc', 'state_dnc')
                    and public.dnc_exemption_active_id(p_tenant_id, v_digits, now()) is not null)
        union all
        select 'internal', d.reason
          from tenant_do_not_call d
         where d.tenant_id = p_tenant_id and d.phone_digits = v_digits and d.is_active
      ) hit
     -- Worst news first: a litigator hit is never overridable, so it must not be hidden behind an
     -- internal note that merely says somebody asked not to be called.
     order by case hit.list_type
                when 'tcpa_litigator' then 0
                when 'internal' then 1
                when 'federal_dnc' then 2
                when 'state_dnc' then 3
                else 4
              end
     limit 1;

  if not found then
    return query select false, null::text, null::text;
  end if;
end;
$function$;

revoke all on function public.is_phone_suppressed(uuid, text) from public, anon, authenticated;
grant execute on function public.is_phone_suppressed(uuid, text) to tenant_app, service_role;

-- ── tenant_phone_suppression_hits, from the live definition (20260925700200), exemption-aware ───
-- VOLATILE now, for one reason: a call that clears a stored federal/state DNC hit writes a
-- 'dial_gate' use row, so every time the dialer's gate relied on an exemption there is a record.
create or replace function public.tenant_phone_suppression_hits(p_tenant_id uuid, p_phone text)
returns table(list_type text, reason text, source text, added_at timestamptz)
language plpgsql
volatile
security definer
set search_path = public, pg_catalog
as $function$
#variable_conflict use_column
declare
  v_raw text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_digits text;
  v_exemption uuid;
  v_cleared text[];
begin
  v_digits := case when length(v_raw) = 11 and left(v_raw, 1) = '1' then right(v_raw, 10) else v_raw end;
  v_exemption := public.dnc_exemption_active_id(p_tenant_id, v_digits, now());
  if v_exemption is not null then
    select coalesce(array_agg(distinct s.list_type order by s.list_type), '{}'::text[]) into v_cleared
      from public.tenant_suppression_list s
     where s.tenant_id = p_tenant_id and s.phone_digits = v_digits and s.list_type in ('federal_dnc', 'state_dnc');
    -- A use is a dial the exemption let through: recorded only when no other list still refuses
    -- the number (the agency's own list, a litigator, an invalid number).
    if cardinality(v_cleared) > 0
       and not exists (select 1 from public.tenant_do_not_call x
                        where x.tenant_id = p_tenant_id and x.phone_digits = v_digits and x.is_active)
       and not exists (select 1 from public.tenant_suppression_list y
                        where y.tenant_id = p_tenant_id and y.phone_digits = v_digits
                          and y.list_type not in ('federal_dnc', 'state_dnc')) then
      insert into public.tenant_dnc_exemption_uses (tenant_id, exemption_id, phone_digits, context, cleared_lists)
      values (p_tenant_id, v_exemption, v_digits, 'dial_gate', v_cleared);
    end if;
  end if;

  return query
  select t.list_type, t.reason, t.source, t.added_at
    from (
      select 'internal'::text as list_type, dnc.reason, 'disposition'::text as source, dnc.created_at as added_at
        from public.tenant_do_not_call dnc
       where dnc.tenant_id = p_tenant_id and dnc.is_active and dnc.phone_digits = v_digits
      union all
      select s.list_type, s.reason, s.source, s.added_at
        from public.tenant_suppression_list s
       where s.tenant_id = p_tenant_id and s.phone_digits = v_digits
         and not (v_exemption is not null and s.list_type in ('federal_dnc', 'state_dnc'))
    ) t
   order by case t.list_type when 'tcpa_litigator' then 0 when 'federal_dnc' then 1 when 'state_dnc' then 2 when 'internal' then 3 else 4 end,
            t.added_at;
end;
$function$;

revoke all on function public.tenant_phone_suppression_hits(uuid, text) from public, anon, authenticated;
grant execute on function public.tenant_phone_suppression_hits(uuid, text) to tenant_app, service_role;

-- ── assertions ─────────────────────────────────────────────────────────────
-- Run against a real tenant and owner inside a block that always rolls back.
do $$
declare
  v_tenant uuid;
  v_owner uuid;
  v_hit record;
  v_id uuid;
  v_n integer;
  v_failed text;
  v_phone constant text := '5555550199';
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709700: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  select tu.tenant_id, tu.user_id into v_tenant, v_owner
    from public.tenant_users tu
   where tu.role = 'owner'
     and not exists (select 1 from public.tenant_suppression_list s where s.tenant_id = tu.tenant_id and s.phone_digits = v_phone)
     and not exists (select 1 from public.tenant_do_not_call d where d.tenant_id = tu.tenant_id and d.phone_digits = v_phone)
     and not exists (select 1 from public.tenant_dnc_exemptions e where e.tenant_id = tu.tenant_id and e.phone_digits = v_phone)
   limit 1;
  if v_tenant is null then
    raise notice '20260925709700: no owner to test with, assertions skipped';
    return;
  end if;

  begin
    perform public.suppress_phone(v_tenant, v_phone, 'federal_dnc', 'self-check', 'manual', v_owner);
    perform public.suppress_phone(v_tenant, v_phone, 'state_dnc', 'self-check', 'manual', v_owner);
    select * into v_hit from public.is_phone_suppressed(v_tenant, v_phone);
    if not v_hit.suppressed then raise exception 'a federal DNC number read as clear before any exemption'; end if;

    -- A relationship already past its window is refused.
    begin
      perform public.record_dnc_exemption(v_tenant, v_phone, 'existing_business_relationship', null, 'inquiry', current_date - 120, null, v_owner);
      raise exception 'an expired inquiry was accepted';
    exception when check_violation then null;
    end;
    -- Written consent needs a certificate.
    begin
      perform public.record_dnc_exemption(v_tenant, v_phone, 'written_consent', null, null, null, null, v_owner);
      raise exception 'written consent was accepted without a certificate';
    exception when check_violation then null;
    end;

    v_id := public.record_dnc_exemption(v_tenant, '+1 (555) 555-0199', 'existing_business_relationship', null, 'purchase', current_date - 30, 'self-check', v_owner);
    select * into v_hit from public.is_phone_suppressed(v_tenant, v_phone);
    if v_hit.suppressed then raise exception 'an active exemption did not clear federal/state DNC (still %)', v_hit.list_type; end if;
    select count(*) into v_n from public.tenant_phone_suppression_hits(v_tenant, v_phone);
    if v_n <> 0 then raise exception 'the dial gate still reports % DNC hit(s) under an exemption', v_n; end if;
    select count(*) into v_n from public.tenant_dnc_exemption_uses u where u.exemption_id = v_id and u.context = 'dial_gate'
       and u.cleared_lists = array['federal_dnc', 'state_dnc']::text[];
    if v_n <> 1 then raise exception 'the dial gate cleared a DNC hit without an audit row (% rows)', v_n; end if;

    -- One open record per number.
    begin
      perform public.record_dnc_exemption(v_tenant, v_phone, 'existing_business_relationship', null, 'purchase', current_date, null, v_owner);
      raise exception 'a second active exemption was accepted';
    exception when unique_violation then null;
    end;

    -- Never the agency's own list.
    perform public.suppress_phone(v_tenant, v_phone, 'internal', 'self-check', 'manual', v_owner);
    select * into v_hit from public.is_phone_suppressed(v_tenant, v_phone);
    if not v_hit.suppressed or v_hit.list_type <> 'internal' then raise exception 'an exemption cleared the internal list (got %)', v_hit.list_type; end if;
    select count(*) into v_n from public.tenant_phone_suppression_hits(v_tenant, v_phone) h where h.list_type = 'internal';
    if v_n <> 1 then raise exception 'the dial gate lost the internal hit under an exemption'; end if;

    -- Never a litigator.
    perform public.suppress_phone(v_tenant, v_phone, 'tcpa_litigator', 'self-check', 'manual', v_owner);
    select * into v_hit from public.is_phone_suppressed(v_tenant, v_phone);
    if v_hit.list_type <> 'tcpa_litigator' then raise exception 'an exemption cleared a litigator (got %)', v_hit.list_type; end if;

    -- Revoked, it stops clearing.
    perform public.revoke_dnc_exemption(v_tenant, v_id, v_owner, 'self-check');
    if public.dnc_exemption_active_id(v_tenant, v_phone) is not null then raise exception 'a revoked exemption still clears'; end if;
    select count(*) into v_n from public.tenant_phone_suppression_hits(v_tenant, v_phone) h where h.list_type in ('federal_dnc', 'state_dnc');
    if v_n <> 2 then raise exception 'revoking did not restore the DNC hits (% rows)', v_n; end if;

    raise exception 'fix_s_709700_rollback';
  exception when raise_exception then
    get stacked diagnostics v_failed = message_text;
    if v_failed <> 'fix_s_709700_rollback' then raise exception '20260925709700 check failed: %', v_failed; end if;
  end;

  if not has_function_privilege('tenant_app', 'public.is_phone_suppressed(uuid, text)', 'execute')
     or not has_function_privilege('tenant_app', 'public.tenant_phone_suppression_hits(uuid, text)', 'execute') then
    raise exception 'tenant_app lost execute on the suppression functions';
  end if;
  raise notice '20260925709700: exemptions clear federal/state DNC only, every dial-gate use is audited';
end $$;
