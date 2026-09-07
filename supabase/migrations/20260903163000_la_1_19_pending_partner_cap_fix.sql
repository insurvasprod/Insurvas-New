-- LA-1.19: a new partner is a pending capacity claim. Draft and active records count;
-- paused and offboarded records do not. This keeps the create control disabled at the cap
-- while still making pause immediately free a slot.
create or replace function public.create_partner_with_limits(
  p_tenant_id uuid, p_name text, p_partner_type public.partner_type, p_country text,
  p_contact_name text, p_contact_email text, p_timezone text, p_notes text, p_created_by uuid,
  p_max_publishers integer default null, p_max_marketing_partners integer default null, p_max_affiliates integer default null
)
returns public.partners language plpgsql security invoker set search_path = public as $$
declare v_row public.partners; v_count integer; v_limit integer; v_key text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  perform 1 from tenants where id=p_tenant_id for update;
  if not found then raise exception 'tenant_not_found'; end if;
  v_key := case p_partner_type when 'publisher' then 'max_publishers' when 'marketing' then 'max_marketing_partners' else 'max_affiliates' end;
  v_limit := case p_partner_type when 'publisher' then p_max_publishers when 'marketing' then p_max_marketing_partners else p_max_affiliates end;
  select count(*)::integer into v_count from partners where tenant_id=p_tenant_id and partner_type=p_partner_type and status in ('draft','active');
  if v_limit is not null and v_count >= v_limit then raise exception 'partner_limit_reached:%:%:%',v_key,v_count,v_limit; end if;
  insert into partners (tenant_id,name,partner_type,country,contact_name,contact_email,timezone,notes,created_by)
  values(p_tenant_id,btrim(p_name),p_partner_type,upper(btrim(p_country)),nullif(btrim(p_contact_name),''),nullif(lower(btrim(p_contact_email)),''),btrim(p_timezone),nullif(btrim(p_notes),''),p_created_by)
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.update_partner_with_limits(
  p_tenant_id uuid, p_partner_id uuid, p_name text, p_partner_type public.partner_type, p_country text,
  p_contact_name text, p_contact_email text, p_timezone text, p_notes text,
  p_max_publishers integer default null, p_max_marketing_partners integer default null, p_max_affiliates integer default null
)
returns public.partners language plpgsql security invoker set search_path = public as $$
declare v_row public.partners; v_old public.partners; v_count integer; v_limit integer; v_key text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text,0));
  select * into v_old from partners where id=p_partner_id and tenant_id=p_tenant_id for update;
  if not found or v_old.status in ('paused','offboarded') then raise exception 'partner_not_found_or_offboarded'; end if;
  if v_old.partner_type <> p_partner_type then
    v_key := case p_partner_type when 'publisher' then 'max_publishers' when 'marketing' then 'max_marketing_partners' else 'max_affiliates' end;
    v_limit := case p_partner_type when 'publisher' then p_max_publishers when 'marketing' then p_max_marketing_partners else p_max_affiliates end;
    select count(*)::integer into v_count from partners where tenant_id=p_tenant_id and partner_type=p_partner_type and status in ('draft','active') and id<>p_partner_id;
    if v_limit is not null and v_count >= v_limit then raise exception 'partner_limit_reached:%:%:%',v_key,v_count,v_limit; end if;
  end if;
  update partners set name=btrim(p_name),partner_type=p_partner_type,country=upper(btrim(p_country)),contact_name=nullif(btrim(p_contact_name),''),contact_email=nullif(lower(btrim(p_contact_email)),''),timezone=btrim(p_timezone),notes=nullif(btrim(p_notes),'') where id=p_partner_id and tenant_id=p_tenant_id returning * into v_row;
  return v_row;
end;
$$;
