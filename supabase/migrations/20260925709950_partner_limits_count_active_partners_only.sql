-- ---------------------------------------------------------------------------
-- LA-1.19 / W6.2 · only ACTIVE partners hold a slot against the plan's partner limits
--
-- The user's decision (M1 fulfilment, 2026-09-25): a draft never holds a slot. Activating a draft or
-- resuming a paused partner takes one and is refused at the cap. Create, resume and the usage figure
-- on /app/publishers all use the same count, status = 'active'.
--
-- Before this file create_partner_with_limits and update_partner_with_limits counted draft + active
-- while transition_partner_with_limits counted active only. With drafts filling the cap, the page said
-- 10 of 10 and refused a create, yet resuming a paused publisher went through and usage read 11 of 10
-- (found by W6.2).
--
-- Changes, and nothing else:
--   create_partner_with_limits   counts status = 'active' (was draft + active)
--   update_partner_with_limits   a type change counts status = 'active' in the new type (was draft + active)
--   transition_partner_with_limits   the partner-user check on activation refuses only when the count,
--     which already includes the partner's own users, is OVER the limit. It refused at exactly the
--     limit, so resuming a partner with no users was blocked when the plan's partner users were all in use.
--
-- Each body is the LIVE definition (pg_get_functiondef, read 2026-09-25, CRLF normalised) with one
-- single-line anchor replaced per change. create or replace keeps the signatures and grants.
-- create/update were last defined by 20260925709200, transition by 20260912150000.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_partner_with_limits(p_tenant_id uuid, p_name text, p_partner_type text, p_country text, p_contact_name text, p_contact_email text, p_timezone text, p_notes text, p_created_by uuid, p_max_publishers integer DEFAULT NULL::integer, p_max_marketing_partners integer DEFAULT NULL::integer, p_max_affiliates integer DEFAULT NULL::integer)
 RETURNS partners
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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

  -- LA-1.19: only an ACTIVE partner holds a slot. A draft holds none. Creating one is still refused
  -- at the cap, in the same count activation uses, because a draft made there could never be activated.
  v_key := case p_partner_type when 'publisher' then 'max_publishers' when 'marketing' then 'max_marketing_partners' else 'max_affiliates' end;
  v_limit := case p_partner_type when 'publisher' then p_max_publishers when 'marketing' then p_max_marketing_partners else p_max_affiliates end;
  select count(*)::integer into v_count from partners
   where tenant_id = p_tenant_id and partner_type = p_partner_type and status = 'active';
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
  -- never activated at all. It holds no slot until transition_partner_with_limits makes it active.
  insert into partners (tenant_id, name, slug, partner_type, status, country, contact_name, contact_email, timezone, notes, created_by)
  values (p_tenant_id, btrim(p_name), v_slug, p_partner_type, 'draft', upper(btrim(p_country)),
          coalesce(btrim(p_contact_name), ''), nullif(lower(btrim(p_contact_email)), ''),
          btrim(p_timezone), coalesce(btrim(p_notes), ''), p_created_by)
  returning * into v_row;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_partner_with_limits(p_tenant_id uuid, p_partner_id uuid, p_name text, p_partner_type text, p_country text, p_contact_name text, p_contact_email text, p_timezone text, p_notes text, p_max_publishers integer DEFAULT NULL::integer, p_max_marketing_partners integer DEFAULT NULL::integer, p_max_affiliates integer DEFAULT NULL::integer)
 RETURNS partners
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
       and status = 'active' and id <> p_partner_id;
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

CREATE OR REPLACE FUNCTION public.transition_partner_with_limits(p_tenant_id uuid, p_partner_id uuid, p_next_status text, p_confirmation text DEFAULT NULL::text, p_max_publishers integer DEFAULT NULL::integer, p_max_marketing_partners integer DEFAULT NULL::integer, p_max_affiliates integer DEFAULT NULL::integer, p_max_partner_users integer DEFAULT NULL::integer)
 RETURNS partners
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
    -- v_count already includes this partner's own users, so reaching the limit exactly is allowed.
    if p_max_partner_users is not null and v_count > p_max_partner_users then
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


-- ── assertions ─────────────────────────────────────────────────────────────
do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925709950: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
              and proname in ('create_partner_with_limits', 'update_partner_with_limits')
              and position('status in (''draft'', ''active'')' in prosrc) > 0) then
    raise exception '20260925709950: a draft still holds a partner slot';
  end if;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'create_partner_with_limits'
                  and position('partner_type = p_partner_type and status = ''active''' in prosrc) > 0) then
    raise exception '20260925709950: create_partner_with_limits does not count active partners only';
  end if;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'update_partner_with_limits'
                  and position('and status = ''active'' and id <> p_partner_id' in prosrc) > 0) then
    raise exception '20260925709950: update_partner_with_limits does not count active partners only';
  end if;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'transition_partner_with_limits'
                  and position('v_count > p_max_partner_users' in prosrc) > 0
                  and position('status = ''active''' in prosrc) > 0) then
    raise exception '20260925709950: transition_partner_with_limits still refuses at exactly the partner-user limit';
  end if;
  -- Coverage: LA-1.19-2, LA-1.19-5 and W6.2 (active partners only).
end $$;
