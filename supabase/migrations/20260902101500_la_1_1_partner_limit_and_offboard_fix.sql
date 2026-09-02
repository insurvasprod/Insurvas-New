-- LA-1.1 follow-up: make confirmation null-safe and serialize entitlement-limit checks across
-- separate pooler connections. The original migration is also kept corrected for fresh installs.

create or replace function public.create_partner(
  p_tenant_id uuid,
  p_name text,
  p_partner_type public.partner_type,
  p_country text,
  p_contact_name text,
  p_contact_email text,
  p_timezone text,
  p_notes text,
  p_created_by uuid,
  p_max_partners integer default null
)
returns public.partners
language plpgsql security invoker set search_path = public
as $$
declare
  v_row public.partners;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  perform 1 from public.tenants where id = p_tenant_id for update;
  if not found then raise exception 'tenant_not_found'; end if;
  if p_max_partners is not null and p_max_partners < 0 then raise exception 'invalid_partner_limit'; end if;
  select count(*)::integer into v_count from public.partners where tenant_id = p_tenant_id and status <> 'offboarded';
  if p_max_partners is not null and v_count >= p_max_partners then raise exception 'partner_limit_reached:%:%', v_count, p_max_partners; end if;
  insert into public.partners (tenant_id, name, partner_type, country, contact_name, contact_email, timezone, notes, created_by)
  values (p_tenant_id, btrim(p_name), p_partner_type, upper(btrim(p_country)), nullif(btrim(p_contact_name), ''), nullif(lower(btrim(p_contact_email)), ''), btrim(p_timezone), nullif(btrim(p_notes), ''), p_created_by)
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.transition_partner(
  p_tenant_id uuid,
  p_partner_id uuid,
  p_next_status public.partner_status,
  p_confirmation text default null
)
returns public.partners
language plpgsql security invoker set search_path = public
as $$
declare v_row public.partners;
begin
  select * into v_row from public.partners where id = p_partner_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'partner_not_found'; end if;
  if v_row.status = 'offboarded' then raise exception 'partner_already_offboarded'; end if;
  if p_next_status = 'offboarded' and coalesce(p_confirmation, '') <> 'OFFBOARD' then raise exception 'offboard_confirmation_required'; end if;
  if not ((v_row.status = 'draft' and p_next_status = 'active') or (v_row.status = 'active' and p_next_status in ('paused', 'offboarded')) or (v_row.status = 'paused' and p_next_status in ('active', 'offboarded'))) then
    raise exception 'invalid_partner_transition:%:%', v_row.status, p_next_status;
  end if;
  update public.partners set status = p_next_status, paused_at = case when p_next_status = 'paused' then coalesce(paused_at, now()) else paused_at end, offboarded_at = case when p_next_status = 'offboarded' then now() else offboarded_at end where id = p_partner_id and tenant_id = p_tenant_id returning * into v_row;
  if p_next_status = 'offboarded' then update public.partner_users set status = 'revoked', revoked_at = coalesce(revoked_at, now()) where partner_id = p_partner_id and status = 'active'; end if;
  return v_row;
end;
$$;
