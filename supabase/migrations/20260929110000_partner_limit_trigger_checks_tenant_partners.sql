-- ---------------------------------------------------------------------------
-- M1 D7 / LA-1.19 · the database-side partner limit also covers partners created through the app
--
-- partners_enforce_limit (BEFORE INSERT OR UPDATE OF status, partner_type ON partners) runs
-- private.enforce_partner_type_limit, an organizations-era guard. It reads the limit from
-- organization_entitlements by partners.organization_id. Every partner the app creates
-- (create_partner_with_limits) has tenant_id and NO organization_id, so the limit read returns null
-- and the check is skipped. Only the app-side check (the limits the route passes into the
-- *_with_limits functions) stood between a direct write and the plan's cap.
--
-- This restates the trigger function from its LIVE definition (pg_get_functiondef, read
-- 2026-09-29, CRLF normalised, not defined in any migration file) with one new branch.
-- A partner with no organization id and a tenant id is checked against the tenant's cached plan
-- limits, tenant_entitlements.entitlement -> limits -> max_publishers / max_marketing_partners /
-- max_affiliates (the same snapshot the app reads its limits from). The count is the user's
-- LA-1.19 rule, ACTIVE partners of that type in the tenant, this row left out. The refusal is
-- raised in the functions' own words, partner_limit_reached:<key>:<count>:<limit>, which the
-- partners routes already answer as a 403 that names the limit. The organizations branch is
-- unchanged.
--
-- The tenant branch takes the same transaction advisory lock the *_with_limits functions take,
-- so a create, activation or type change and this check are serialised per tenant.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.enforce_partner_type_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  limit_key text;
  limit_value integer;
  active_count integer;
  raw_limit jsonb;
begin
  if new.status = 'active' then
    if new.partner_type = 'publisher' then limit_key := 'max_publishers';
    elsif new.partner_type = 'marketing' then limit_key := 'max_marketing_partners';
    elsif new.partner_type = 'affiliate' then limit_key := 'max_affiliates';
    else raise exception 'Invalid partner type';
    end if;

    if new.organization_id is null and new.tenant_id is not null then
      -- LA-1.19 (D7): a tenant partner, created through the app. Only ACTIVE partners hold a slot.
      if tg_op = 'INSERT' or old.status <> 'active' or old.partner_type <> new.partner_type then
        perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text, 0));
        select te.entitlement -> 'limits' -> limit_key into raw_limit
          from public.tenant_entitlements te where te.tenant_id = new.tenant_id;
        limit_value := case when jsonb_typeof(raw_limit) = 'number' and (raw_limit #>> '{}')::numeric >= 0
                            then floor((raw_limit #>> '{}')::numeric)::integer else null end;
        if limit_value is not null then
          select count(*)::integer into active_count from public.partners p
           where p.tenant_id = new.tenant_id and p.partner_type = new.partner_type
             and p.status = 'active' and p.id <> new.id;
          if active_count >= limit_value then
            raise exception 'partner_limit_reached:%:%:%', limit_key, active_count, limit_value;
          end if;
        end if;
      end if;
      return new;
    end if;

    perform pg_advisory_xact_lock(hashtextextended('la-1.19:partner:' || new.organization_id::text || ':' || new.partner_type, 0));
    limit_value := private.cached_partner_limit(new.organization_id, limit_key);
    active_count := private.partner_active_count(new.organization_id, new.partner_type);
    if limit_value is not null and active_count >= limit_value
       and (tg_op = 'INSERT' or old.status <> 'active' or old.partner_type <> new.partner_type) then
      raise exception '% limit reached', replace(limit_key, 'max_', '');
    end if;
  end if;
  return new;
end;
$function$;


-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_src text;
begin
  if not has_schema_privilege(current_user, 'private', 'CREATE') then
    raise notice '20260929110000: assertions skipped, % cannot create in private', current_user;
    return;
  end if;
  select p.prosrc into v_src from pg_proc p
   where p.pronamespace = 'private'::regnamespace and p.proname = 'enforce_partner_type_limit';
  if v_src is null or position('tenant_entitlements' in v_src) = 0
     or position('partner_limit_reached:%:%:%' in v_src) = 0 then
    raise exception '20260929110000: the partner limit trigger still skips partners with no organization id';
  end if;
  if not exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                  where t.tgrelid = 'public.partners'::regclass and not t.tgisinternal
                    and p.proname = 'enforce_partner_type_limit') then
    raise exception '20260929110000: partners_enforce_limit is not attached to partners';
  end if;
  -- Coverage: M1 D7, LA-1.19-3 (a direct write over the cap is refused by the database).
end $$;
