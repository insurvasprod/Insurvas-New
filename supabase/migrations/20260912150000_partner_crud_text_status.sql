-- LA-1.1: let the partner create, update and transition paths run against the live tables.
--
-- Same two problems 20260912120000 fixed for the partner-user lifecycle, in the three functions the
-- partners screen actually calls:
--
--   1. `p_partner_type partner_type` and `p_next_status partner_status` are enums, while
--      `partners.partner_type` and `partners.status` are text. Postgres has no `text = partner_type`
--      operator, so create_partner_with_limits fails with `invalid_partner` before it writes
--      anything. That is LA-1.1's "owner can create a partner" criterion, and the five criteria
--      after it that need a partner to exist.
--
--   2. `partners.slug` is NOT NULL with no default and none of these functions sets it. It belongs
--      to the organizations-era product, which generates one from the name. Creation therefore
--      fails on the not-null even once the type error is gone.
--
-- Confirmed live on 2026-09-12 by scripts/verify-partners.mjs and scripts/verify-la1.mjs.
--
-- The slug is derived from the name with a short random suffix. A readable prefix keeps it useful
-- to the other product, and the suffix avoids a collision with an existing row, since two tenants
-- can legitimately both have a partner called "Apex Data".
--
-- Values are checked explicitly now that the enum does not do it.

drop function if exists public.create_partner_with_limits(uuid, text, public.partner_type, text, text, text, text, text, uuid, integer, integer, integer);
-- and the text signature, so re-running this migration replaces rather than collides.
drop function if exists public.create_partner_with_limits(uuid, text, text, text, text, text, text, text, uuid, integer, integer, integer);

create function public.create_partner_with_limits(
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
          nullif(btrim(p_contact_name), ''), nullif(lower(btrim(p_contact_email)), ''),
          btrim(p_timezone), nullif(btrim(p_notes), ''), p_created_by)
  returning * into v_row;

  return v_row;
end;
$function$;

drop function if exists public.update_partner_with_limits(uuid, uuid, text, public.partner_type, text, text, text, text, text, integer, integer, integer);
drop function if exists public.update_partner_with_limits(uuid, uuid, text, text, text, text, text, text, text, integer, integer, integer);

create function public.update_partner_with_limits(
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
         contact_name = nullif(btrim(p_contact_name), ''), contact_email = nullif(lower(btrim(p_contact_email)), ''),
         timezone = btrim(p_timezone), notes = nullif(btrim(p_notes), '')
   where id = p_partner_id and tenant_id = p_tenant_id
   returning * into v_row;

  return v_row;
end;
$function$;

drop function if exists public.transition_partner_with_limits(uuid, uuid, public.partner_status, text, integer, integer, integer, integer);
drop function if exists public.transition_partner_with_limits(uuid, uuid, text, text, integer, integer, integer, integer);

create function public.transition_partner_with_limits(
  p_tenant_id uuid, p_partner_id uuid, p_next_status text, p_confirmation text default null,
  p_max_publishers integer default null, p_max_marketing_partners integer default null,
  p_max_affiliates integer default null, p_max_partner_users integer default null
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
begin
  if p_next_status not in ('draft', 'active', 'paused', 'offboarded') then
    raise exception 'invalid_partner_status:%', p_next_status;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  select * into v_row from partners where id = p_partner_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'partner_not_found'; end if;
  if v_row.status = 'offboarded' then raise exception 'partner_already_offboarded'; end if;
  if p_next_status = 'offboarded' and coalesce(p_confirmation, '') <> 'OFFBOARD' then
    raise exception 'offboard_confirmation_required';
  end if;
  if not ((v_row.status = 'draft' and p_next_status = 'active')
       or (v_row.status = 'active' and p_next_status in ('paused', 'offboarded'))
       or (v_row.status = 'paused' and p_next_status in ('active', 'offboarded'))) then
    raise exception 'invalid_partner_transition:%:%', v_row.status, p_next_status;
  end if;

  if p_next_status = 'active' and v_row.status <> 'active' then
    v_key := case v_row.partner_type when 'publisher' then 'max_publishers' when 'marketing' then 'max_marketing_partners' else 'max_affiliates' end;
    v_limit := case v_row.partner_type when 'publisher' then p_max_publishers when 'marketing' then p_max_marketing_partners else p_max_affiliates end;
    select count(*)::integer into v_count from partners
     where tenant_id = p_tenant_id and partner_type = v_row.partner_type and status = 'active';
    if v_limit is not null and v_count >= v_limit then
      raise exception 'partner_limit_reached:%:%:%', v_key, v_count, v_limit;
    end if;
    select count(*)::integer into v_count from partner_users pu
      join partners p on p.id = pu.partner_id
     where pu.tenant_id = p_tenant_id and pu.status = 'active'
       and (p.status = 'active' or p.id = p_partner_id);
    if p_max_partner_users is not null and v_count >= p_max_partner_users then
      raise exception 'partner_user_limit_reached:max_partner_users:%:%', v_count, p_max_partner_users;
    end if;
  end if;

  update partners
     set status = p_next_status,
         paused_at = case when p_next_status = 'paused' then coalesce(paused_at, now()) else paused_at end,
         offboarded_at = case when p_next_status = 'offboarded' then now() else offboarded_at end
   where id = p_partner_id and tenant_id = p_tenant_id
   returning * into v_row;

  if p_next_status = 'offboarded' then
    update partner_users
       set status = 'revoked', revoked_at = coalesce(revoked_at, now()), deactivated_at = coalesce(deactivated_at, now())
     where tenant_id = p_tenant_id and partner_id = p_partner_id and status <> 'revoked';
  end if;

  return v_row;
end;
$function$;
