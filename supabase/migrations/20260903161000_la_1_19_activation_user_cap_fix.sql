-- LA-1.19 follow-up: users attached to a draft/paused partner become counted when that
-- partner is activated, so activation must not create a hidden over-cap state.
create or replace function public.transition_partner_with_limits(
  p_tenant_id uuid, p_partner_id uuid, p_next_status public.partner_status, p_confirmation text default null,
  p_max_publishers integer default null, p_max_marketing_partners integer default null, p_max_affiliates integer default null,
  p_max_partner_users integer default null
)
returns public.partners language plpgsql security invoker set search_path = public as $$
declare v_row public.partners; v_count integer; v_limit integer; v_key text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  select * into v_row from partners where id=p_partner_id and tenant_id=p_tenant_id for update;
  if not found then raise exception 'partner_not_found'; end if;
  if v_row.status='offboarded' then raise exception 'partner_already_offboarded'; end if;
  if p_next_status='offboarded' and coalesce(p_confirmation,'') <> 'OFFBOARD' then raise exception 'offboard_confirmation_required'; end if;
  if not ((v_row.status='draft' and p_next_status='active') or (v_row.status='active' and p_next_status in ('paused','offboarded')) or (v_row.status='paused' and p_next_status in ('active','offboarded'))) then raise exception 'invalid_partner_transition:%:%',v_row.status,p_next_status; end if;
  if p_next_status='active' and v_row.status <> 'active' then
    v_key := case v_row.partner_type when 'publisher' then 'max_publishers' when 'marketing' then 'max_marketing_partners' else 'max_affiliates' end;
    v_limit := case v_row.partner_type when 'publisher' then p_max_publishers when 'marketing' then p_max_marketing_partners else p_max_affiliates end;
    select count(*)::integer into v_count from partners where tenant_id=p_tenant_id and partner_type=v_row.partner_type and status='active';
    if v_limit is not null and v_count >= v_limit then raise exception 'partner_limit_reached:%:%:%',v_key,v_count,v_limit; end if;
    select count(*)::integer into v_count from partner_users pu join partners p on p.id=pu.partner_id where pu.tenant_id=p_tenant_id and pu.status='active' and (p.status='active' or p.id=p_partner_id);
    if p_max_partner_users is not null and v_count >= p_max_partner_users then raise exception 'partner_user_limit_reached:max_partner_users:%:%',v_count,p_max_partner_users; end if;
  end if;
  update partners set status=p_next_status, paused_at=case when p_next_status='paused' then coalesce(paused_at,now()) else paused_at end, offboarded_at=case when p_next_status='offboarded' then now() else offboarded_at end where id=p_partner_id and tenant_id=p_tenant_id returning * into v_row;
  if p_next_status='offboarded' then update partner_users set status='revoked',revoked_at=coalesce(revoked_at,now()),deactivated_at=coalesce(deactivated_at,now()) where tenant_id=p_tenant_id and partner_id=p_partner_id and status <> 'revoked'; end if;
  return v_row;
end;
$$;

revoke all on function public.transition_partner_with_limits(uuid,uuid,public.partner_status,text,integer,integer,integer,integer) from public, anon, authenticated, tenant_app;
grant execute on function public.transition_partner_with_limits(uuid,uuid,public.partner_status,text,integer,integer,integer,integer) to service_role;
