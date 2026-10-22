-- ============================================================================
-- Pending migrations — 1 files, each in its own transaction
-- Generated 2026-10-15 by scripts/build-pending-bundle.mjs. Do not hand-edit; regenerate.
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
--    1. 20261015300000_la_8_3_business_identity.sql
-- ============================================================================

-- ─── [1/1] 20261015300000_la_8_3_business_identity.sql ───────────────────────────
begin;

-- LA-8.3 (Notion sprint, Module 8 — Settings) · Business identity.
--
-- One record of who the business is, used by every document the platform produces. The spec calls it
-- `business_identity`; the record already exists as `agency_profiles` (20260924100000: legal name,
-- DBA, NPN, encrypted tax ID, a one-line address, timezone), so this extends it rather than starting a
-- second table two screens would both claim. Spec name → column:
--   trading_name → dba                       legal_name → legal_name (unchanged)
--   tax_id_encrypted → tax_id_ciphertext     logo_url → logo_path (a path in the private bucket)
--   address_line1, line2, city, state, postal_code, country, phone, email, website, entity_type,
--   tax_id_type → new columns below.
--
-- `principal_address` stays, written by the save function as the composed one-line address, so the
-- readers that print it (the platform invoice, quote print) keep working unchanged.
--
-- Per-document requirements live in business_identity_missing(): the one place SQL asks "can this
-- document be generated?". lib/agencyProfile/requirements.ts holds the same table for the app, and
-- lib/agencyProfile/businessIdentity.test.mjs asserts the two agree. Publishing a payout statement
-- (by hand or by the overnight auto-publish) refuses without a trading name and address.
--
-- Changes keep writing a dated agency_profile_history row, as every save has since 20260924100000.
--
-- Rollback: drop function public.save_business_identity(uuid, uuid, jsonb, boolean, text, text),
--   public.set_business_logo(uuid, uuid, text), public.business_identity_missing(uuid, text);
--   re-run 20260924220000 (save_agency_profile) and 20261015240000 (publish_payout_run, payout_drafts_due);
--   the new columns can stay (nothing else reads them); delete from storage.buckets where id = 'business-logos'.

-- ─── the record ───────────────────────────────────────────────────────────────────────────────
alter table public.agency_profiles
  add column if not exists entity_type text,
  add column if not exists tax_id_type text,
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists postal_code text,
  add column if not exists country text not null default 'US',
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists website text,
  add column if not exists logo_path text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agency_profiles_identity_valid') then
    alter table public.agency_profiles add constraint agency_profiles_identity_valid check (
          (entity_type is null or entity_type in ('individual', 'sole_prop', 'llc', 'corp'))
      and (tax_id_type is null or tax_id_type in ('ein', 'ssn'))
      and (address_line1 is null or length(address_line1) <= 200)
      and (address_line2 is null or length(address_line2) <= 200)
      and (city is null or length(city) <= 100)
      and (state is null or state ~ '^[A-Z]{2}$')
      and (postal_code is null or postal_code ~ '^[0-9]{5}(-[0-9]{4})?$')
      and country ~ '^[A-Z]{2}$'
      and (phone is null or length(phone) <= 40)
      and (email is null or (length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'))
      and (website is null or length(website) <= 300)
      and (logo_path is null or (length(logo_path) <= 300 and logo_path like tenant_id::text || '/%'))
    );
  end if;
end;
$$;

alter table public.agency_profile_history
  add column if not exists entity_type text,
  add column if not exists tax_id_type text,
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists postal_code text,
  add column if not exists country text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists website text,
  add column if not exists logo_path text;

-- What was there before: the one-line address becomes line 1 (it cannot be split reliably, so city,
-- state and ZIP stay empty until the owner fills them — the address then reads as incomplete, which it
-- is for a document). The old form only accepted an EIN, so a stored tax ID is one.
update public.agency_profiles set address_line1 = left(principal_address, 200)
 where address_line1 is null and nullif(btrim(principal_address), '') is not null;
update public.agency_profiles set tax_id_type = 'ein' where tax_id_type is null and tax_id_ciphertext is not null;

-- The logo: tenant storage, private, small, PNG or JPEG only. Documents embed it server-side.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-logos', 'business-logos', false, 524288, array['image/png', 'image/jpeg']::text[])
on conflict (id) do nothing;

-- ─── what each document needs ─────────────────────────────────────────────────────────────────
-- The fields a document cannot go out without, in the order a prompt names them. An empty array
-- means the document can be generated. Mirrors DOCUMENT_REQUIREMENTS in lib/agencyProfile/requirements.ts.
create or replace function public.business_identity_missing(p_tenant_id uuid, p_document text)
returns text[]
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  a public.agency_profiles;
  v_need text[];
  v_missing text[] := '{}';
begin
  v_need := case p_document
    when 'welcome_pack' then array['trading_name', 'phone']
    when 'payout_statement' then array['trading_name', 'address']
    when 'dispute_letter' then array['trading_name', 'npn', 'address']
    when 'doi_response' then array['legal_name', 'npn']
    when 'tax_export' then array['legal_name', 'tax_id']
  end;
  if v_need is null then
    raise exception 'business_identity_missing: unknown document %', p_document using errcode = '22023';
  end if;
  select * into a from public.agency_profiles where tenant_id = p_tenant_id;
  if 'trading_name' = any(v_need) and nullif(btrim(a.dba), '') is null then v_missing := array_append(v_missing, 'trading_name'); end if;
  if 'legal_name' = any(v_need) and nullif(btrim(a.legal_name), '') is null then v_missing := array_append(v_missing, 'legal_name'); end if;
  if 'npn' = any(v_need) and nullif(btrim(a.npn), '') is null then v_missing := array_append(v_missing, 'npn'); end if;
  if 'address' = any(v_need) and (nullif(btrim(a.address_line1), '') is null or nullif(btrim(a.city), '') is null or a.state is null or a.postal_code is null) then
    v_missing := array_append(v_missing, 'address');
  end if;
  if 'phone' = any(v_need) and nullif(btrim(a.phone), '') is null then v_missing := array_append(v_missing, 'phone'); end if;
  if 'tax_id' = any(v_need) and a.tax_id_ciphertext is null then v_missing := array_append(v_missing, 'tax_id'); end if;
  return v_missing;
end;
$$;

-- ─── saving ───────────────────────────────────────────────────────────────────────────────────
-- One save = the row plus its dated history row, atomically (as save_agency_profile did). The tax
-- ID arrives already encrypted; p_tax_id_change tells "leave it" from "clear it". A changed NPN drops
-- its NIPR verification: that vouched for the old number. The logo is set by set_business_logo.
create or replace function public.save_business_identity(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_identity jsonb,
  p_tax_id_change boolean,
  p_tax_id_ciphertext text,
  p_tax_id_last4 text
)
returns public.agency_profiles
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.agency_profiles;
  t text;
begin
  -- Blank strings are "not set", never an empty value on a document.
  t := nullif(btrim(p_identity->>'legal_name'), '');
  if t is null then
    raise exception 'save_business_identity: the legal name is required' using errcode = '22023';
  end if;

  insert into public.agency_profiles as ap (
    tenant_id, legal_name, dba, npn, npn_verified_at, entity_type, tax_id_type, tax_id_ciphertext, tax_id_last4,
    address_line1, address_line2, city, state, postal_code, country, phone, email, website, principal_address, timezone, updated_at, updated_by
  ) values (
    p_tenant_id, t,
    nullif(btrim(p_identity->>'trading_name'), ''),
    nullif(btrim(p_identity->>'npn'), ''),
    null,
    nullif(btrim(p_identity->>'entity_type'), ''),
    case when p_tax_id_change and p_tax_id_ciphertext is not null then nullif(btrim(p_identity->>'tax_id_type'), '') end,
    case when p_tax_id_change then p_tax_id_ciphertext end,
    case when p_tax_id_change then p_tax_id_last4 end,
    nullif(btrim(p_identity->>'address_line1'), ''),
    nullif(btrim(p_identity->>'address_line2'), ''),
    nullif(btrim(p_identity->>'city'), ''),
    upper(nullif(btrim(p_identity->>'state'), '')),
    nullif(btrim(p_identity->>'postal_code'), ''),
    coalesce(upper(nullif(btrim(p_identity->>'country'), '')), 'US'),
    nullif(btrim(p_identity->>'phone'), ''),
    lower(nullif(btrim(p_identity->>'email'), '')),
    nullif(btrim(p_identity->>'website'), ''),
    null,
    nullif(btrim(p_identity->>'timezone'), ''),
    now(), p_actor_id
  )
  on conflict (tenant_id) do update set
    legal_name = excluded.legal_name,
    dba = excluded.dba,
    npn = excluded.npn,
    npn_verified_at = case when ap.npn is not distinct from excluded.npn then ap.npn_verified_at else null end,
    npn_check_status = case when ap.npn is not distinct from excluded.npn then ap.npn_check_status else null end,
    npn_checked_at = case when ap.npn is not distinct from excluded.npn then ap.npn_checked_at else null end,
    entity_type = excluded.entity_type,
    -- The type travels with the number: replacing the number sets it, clearing the number clears it,
    -- and leaving the number alone may still correct the type.
    tax_id_type = case
      when p_tax_id_change then excluded.tax_id_type
      when ap.tax_id_ciphertext is not null then coalesce(nullif(btrim(p_identity->>'tax_id_type'), ''), ap.tax_id_type)
      else null end,
    tax_id_ciphertext = case when p_tax_id_change then excluded.tax_id_ciphertext else ap.tax_id_ciphertext end,
    tax_id_last4 = case when p_tax_id_change then excluded.tax_id_last4 else ap.tax_id_last4 end,
    address_line1 = excluded.address_line1,
    address_line2 = excluded.address_line2,
    city = excluded.city,
    state = excluded.state,
    postal_code = excluded.postal_code,
    country = excluded.country,
    phone = excluded.phone,
    email = excluded.email,
    website = excluded.website,
    timezone = excluded.timezone,
    updated_at = now(),
    updated_by = excluded.updated_by
  returning * into v_row;

  -- The one-line address the older readers print, composed from the parts.
  update public.agency_profiles set principal_address = nullif(left(concat_ws(', ',
      v_row.address_line1, v_row.address_line2, v_row.city,
      nullif(btrim(concat_ws(' ', v_row.state, v_row.postal_code)), '')), 300), '')
   where tenant_id = p_tenant_id
  returning * into v_row;

  insert into public.agency_profile_history (
    tenant_id, changed_by, legal_name, dba, npn, tax_id_last4, tax_id_changed, principal_address, timezone,
    entity_type, tax_id_type, address_line1, address_line2, city, state, postal_code, country, phone, email, website, logo_path
  ) values (
    p_tenant_id, p_actor_id, v_row.legal_name, v_row.dba, v_row.npn, v_row.tax_id_last4, coalesce(p_tax_id_change, false), v_row.principal_address, v_row.timezone,
    v_row.entity_type, v_row.tax_id_type, v_row.address_line1, v_row.address_line2, v_row.city, v_row.state, v_row.postal_code, v_row.country, v_row.phone, v_row.email, v_row.website, v_row.logo_path
  );
  return v_row;
end;
$$;

-- The logo is its own write (an upload, not a form field). The identity must exist first: a logo
-- with no name beside it is not a business. Returns the path it replaced, for the caller to remove.
create or replace function public.set_business_logo(p_tenant_id uuid, p_actor_id uuid, p_path text)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old text;
  v_row public.agency_profiles;
begin
  select logo_path into v_old from public.agency_profiles where tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'set_business_logo: save the business identity before adding a logo' using errcode = '22023';
  end if;
  update public.agency_profiles set logo_path = nullif(btrim(p_path), ''), updated_at = now(), updated_by = p_actor_id
   where tenant_id = p_tenant_id returning * into v_row;
  insert into public.agency_profile_history (
    tenant_id, changed_by, legal_name, dba, npn, tax_id_last4, tax_id_changed, principal_address, timezone,
    entity_type, tax_id_type, address_line1, address_line2, city, state, postal_code, country, phone, email, website, logo_path
  ) values (
    p_tenant_id, p_actor_id, v_row.legal_name, v_row.dba, v_row.npn, v_row.tax_id_last4, false, v_row.principal_address, v_row.timezone,
    v_row.entity_type, v_row.tax_id_type, v_row.address_line1, v_row.address_line2, v_row.city, v_row.state, v_row.postal_code, v_row.country, v_row.phone, v_row.email, v_row.website, v_row.logo_path
  );
  return v_old;
end;
$$;

-- save_business_identity replaces save_agency_profile: one writer for the record.
drop function if exists public.save_agency_profile(uuid, uuid, text, text, text, boolean, text, text, text, text);

revoke all on function public.business_identity_missing(uuid, text) from public, anon, authenticated, tenant_app;
revoke all on function public.save_business_identity(uuid, uuid, jsonb, boolean, text, text) from public, anon, authenticated, tenant_app;
revoke all on function public.set_business_logo(uuid, uuid, text) from public, anon, authenticated, tenant_app;
grant execute on function public.business_identity_missing(uuid, text) to service_role;
grant execute on function public.save_business_identity(uuid, uuid, jsonb, boolean, text, text) to service_role;
grant execute on function public.set_business_logo(uuid, uuid, text) to service_role;

-- ─── LA-7.4: a payout statement names who it is from ──────────────────────────────────────────
-- 20261015240000's publish_payout_run with one check first: a statement the partner reads must show
-- the agency's trading name and address, so a run is not published without them.
create or replace function public.publish_payout_run(p_tenant_id uuid, p_run_id uuid, p_by uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r public.payout_run;
  v_entry uuid;
  v_missing text[];
begin
  select * into r from public.payout_run where id = p_run_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'publish_payout_run: run % is not in this agency', p_run_id using errcode = 'P0002';
  end if;
  if r.status <> 'draft' then
    raise exception 'publish_payout_run: only a draft is published (this one is %)', r.status using errcode = '22023';
  end if;
  v_missing := public.business_identity_missing(p_tenant_id, 'payout_statement');
  if cardinality(v_missing) > 0 then
    raise exception 'publish_payout_run: Add your % before generating a payout statement. Partner statements must show who they are from.',
      array_to_string(array(select case m when 'trading_name' then 'trading name' when 'address' then 'business address' else m end from unnest(v_missing) m), ' and ')
      using errcode = '22023';
  end if;
  perform public.payout_run_totals(r.id);
  select * into r from public.payout_run where id = p_run_id;
  if r.net_cents > 0 then
    v_entry := public.record_cost_entry(p_tenant_id, jsonb_build_object('agency_id', r.agency_id, 'entry_type', 'partner_payout', 'amount_cents', -r.net_cents,
      'incurred_on', r.period_end, 'counterparty_type', 'partner', 'counterparty_id', r.partner_id, 'partner_id', r.partner_id, 'payout_run_id', r.id,
      'description', 'Payout ' || to_char(r.period_start, 'DD Mon') || ' – ' || to_char(r.period_end, 'DD Mon YYYY')), p_by);
  elsif r.net_cents < 0 then
    -- More came back than was earned: the partner owes the agency.
    v_entry := public.record_cost_entry(p_tenant_id, jsonb_build_object('agency_id', r.agency_id, 'entry_type', 'refund', 'amount_cents', -r.net_cents,
      'incurred_on', r.period_end, 'counterparty_type', 'partner', 'counterparty_id', r.partner_id, 'partner_id', r.partner_id, 'payout_run_id', r.id,
      'description', 'Owed by the partner ' || to_char(r.period_start, 'DD Mon') || ' – ' || to_char(r.period_end, 'DD Mon YYYY')), p_by);
  end if;
  perform set_config('app.payout_writer', 'on', true);
  update public.payout_run set status = 'published', published_by = p_by, published_at = now() where id = r.id;
  perform set_config('app.payout_writer', '', true);
  return v_entry;
end;
$$;

-- 20261015240000's overnight drafts, with the publish in its own block: an agency whose identity is
-- incomplete keeps the draft (it publishes by hand once the fields are in) rather than losing it.
create or replace function public.payout_drafts_due()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  s record;
  v_from date;
  v_to date;
  v_n integer := 0;
  v_run uuid;
begin
  for s in select a.tenant_id, a.payout_cadence, a.payout_draft_days, a.payout_auto_publish, p.id as partner_id
             from public.accounting_settings a
             join public.partners p on p.tenant_id = a.tenant_id and p.status in ('active', 'paused')
            where exists (select 1 from public.partner_terms t where t.partner_id = p.id) loop
    if s.payout_cadence = 'weekly' then
      v_to := (date_trunc('week', current_date - s.payout_draft_days) - interval '1 day')::date;
      v_from := v_to - 6;
    elsif s.payout_cadence = 'semi_monthly' then
      v_to := current_date - s.payout_draft_days - 1;
      if extract(day from v_to) >= 16 then
        v_from := date_trunc('month', v_to)::date; v_to := v_from + 14;
      else
        v_from := (date_trunc('month', v_to) - interval '1 month')::date + 15; v_to := (date_trunc('month', v_to) - interval '1 day')::date;
      end if;
    else
      v_to := (date_trunc('month', current_date - s.payout_draft_days) - interval '1 day')::date;
      v_from := date_trunc('month', v_to)::date;
    end if;
    continue when exists (select 1 from public.payout_run r where r.tenant_id = s.tenant_id and r.partner_id = s.partner_id and r.period_start = v_from and r.period_end = v_to and r.status <> 'void');
    begin
      v_run := public.build_payout_run(s.tenant_id, s.partner_id, v_from, v_to, null);
      v_n := v_n + 1;
    exception when others then
      -- One partner's missing terms must not stop the others' drafts.
      continue;
    end;
    if s.payout_auto_publish then
      begin
        perform public.publish_payout_run(s.tenant_id, v_run, null);
      exception when others then
        -- Left as a draft: publishing needs the agency's trading name and address (LA-8.3).
        null;
      end;
    end if;
  end loop;
  return v_n;
end;
$$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261015300000', 'la_8_3_business_identity') on conflict do nothing;
  end if;
end $bundle$;
commit;
