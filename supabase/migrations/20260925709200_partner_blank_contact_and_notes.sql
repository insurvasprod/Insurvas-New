-- ---------------------------------------------------------------------------
-- Partners · a publisher can be added without a contact name or notes
--
-- Found 2026-09-25 (agent-side readiness AG-5.2.8.4-2): POST /api/app/partners without notes →
-- 400 'null value in column "notes" of relation "partners" violates not-null constraint', and the same
-- without a contact name, while the form sends both as empty by default. partners.contact_name and
-- partners.notes are NOT NULL DEFAULT '' (checked live), but create_partner_with_limits and
-- update_partner_with_limits stored a blank as nullif(btrim(x), '') = NULL.
--
-- The fix, and nothing else: a blank is stored as '' (coalesce(btrim(x), '')). Both functions are
-- restated verbatim from their latest definition, 20260912150000 (generated from that file, not
-- retyped), with create or replace so the signatures and grants are kept. contact_email is nullable
-- and keeps nullif.
-- ---------------------------------------------------------------------------

create or replace function public.create_partner_with_limits(
  p_tenant_id uuid, p_name text, p_partner_type text, p_country text, p_contact_name text,
  p_contact_email text, p_timezone text, p_notes text, p_created_by uuid,
  p_max_publishers integer default null, p_max_marketing_partners integer default null,
  p_max_affiliates integer default null
)
returns public.partners
language plpgsql
set search_path to 'public'
as $function$
declare
  v_row public.partners;
  v_count integer;
  v_limit integer;
  v_key text;
  v_slug text;
begin
  if p_partner_type not in ('publisher', 'marketing', 'affiliate') then
    raise exception 'invalid_partner_type:%', p_partner_type;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  perform 1 from tenants where id = p_tenant_id for update;
  if not found then raise exception 'tenant_not_found'; end if;

  v_key := case p_partner_type when 'publisher' then 'max_publishers' when 'marketing' then 'max_marketing_partners' else 'max_affiliates' end;
  v_limit := case p_partner_type when 'publisher' then p_max_publishers when 'marketing' then p_max_marketing_partners else p_max_affiliates end;
  select count(*)::integer into v_count from partners
   where tenant_id = p_tenant_id and partner_type = p_partner_type and status in ('draft', 'active');
  if v_limit is not null and v_count >= v_limit then
    raise exception 'partner_limit_reached:%:%:%', v_key, v_count, v_limit;
  end if;

  -- Readable prefix, random suffix. `partners.slug` is required by the organizations-era schema.
  -- gen_random_uuid() rather than gen_random_bytes(): pgcrypto is installed into the `extensions`
  -- schema and this function's search_path is `public`, so gen_random_bytes is not resolvable here.
  -- gen_random_uuid is core from PG13 and needs no schema qualification.
  v_slug := left(nullif(regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'), ''), 40);
  v_slug := trim(both '-' from coalesce(v_slug, 'partner')) || '-' || left(replace(gen_random_uuid()::text, '-', ''), 8);

  -- status is set explicitly. The column default is 'onboarding', the organizations-era product's
  -- first state, and LA-1.1's lifecycle is draft -> active -> paused -> offboarded. A partner left
  -- on the default can never be activated ("invalid_partner_transition:onboarding:active") and is
  -- invisible to the plan-limit counts below, which count `status in ('draft','active')`.
  insert into partners (tenant_id, name, slug, partner_type, status, country, contact_name, contact_email, timezone, notes, created_by)
  values (p_tenant_id, btrim(p_name), v_slug, p_partner_type, 'draft', upper(btrim(p_country)),
          coalesce(btrim(p_contact_name), ''), nullif(lower(btrim(p_contact_email)), ''),
          btrim(p_timezone), coalesce(btrim(p_notes), ''), p_created_by)
  returning * into v_row;

  return v_row;
end;
$function$;

create or replace function public.update_partner_with_limits(
  p_tenant_id uuid, p_partner_id uuid, p_name text, p_partner_type text, p_country text,
  p_contact_name text, p_contact_email text, p_timezone text, p_notes text,
  p_max_publishers integer default null, p_max_marketing_partners integer default null,
  p_max_affiliates integer default null
)
returns public.partners
language plpgsql
set search_path to 'public'
as $function$
declare
  v_row public.partners;
  v_old public.partners;
  v_count integer;
  v_limit integer;
  v_key text;
begin
  if p_partner_type not in ('publisher', 'marketing', 'affiliate') then
    raise exception 'invalid_partner_type:%', p_partner_type;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  select * into v_old from partners where id = p_partner_id and tenant_id = p_tenant_id for update;
  if not found or v_old.status in ('paused', 'offboarded') then
    raise exception 'partner_not_found_or_offboarded';
  end if;

  if v_old.partner_type <> p_partner_type then
    v_key := case p_partner_type when 'publisher' then 'max_publishers' when 'marketing' then 'max_marketing_partners' else 'max_affiliates' end;
    v_limit := case p_partner_type when 'publisher' then p_max_publishers when 'marketing' then p_max_marketing_partners else p_max_affiliates end;
    select count(*)::integer into v_count from partners
     where tenant_id = p_tenant_id and partner_type = p_partner_type
       and status in ('draft', 'active') and id <> p_partner_id;
    if v_limit is not null and v_count >= v_limit then
      raise exception 'partner_limit_reached:%:%:%', v_key, v_count, v_limit;
    end if;
  end if;

  update partners
     set name = btrim(p_name), partner_type = p_partner_type, country = upper(btrim(p_country)),
         contact_name = coalesce(btrim(p_contact_name), ''), contact_email = nullif(lower(btrim(p_contact_email)), ''),
         timezone = btrim(p_timezone), notes = coalesce(btrim(p_notes), '')
   where id = p_partner_id and tenant_id = p_tenant_id
   returning * into v_row;

  return v_row;
end;
$function$;

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_fn text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709200: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  foreach v_fn in array array['create_partner_with_limits', 'update_partner_with_limits'] loop
    if exists (select 1 from pg_proc where proname = v_fn and pronamespace = 'public'::regnamespace
                and (position('nullif(btrim(p_notes)' in prosrc) > 0 or position('nullif(btrim(p_contact_name)' in prosrc) > 0)) then
      raise exception '%: a blank contact name or notes still becomes NULL', v_fn;
    end if;
    if not exists (select 1 from pg_proc where proname = v_fn and pronamespace = 'public'::regnamespace
                    and position('coalesce(btrim(p_notes), '''')' in prosrc) > 0) then
      raise exception '%: the coalesce was not applied', v_fn;
    end if;
  end loop;
end $$;
