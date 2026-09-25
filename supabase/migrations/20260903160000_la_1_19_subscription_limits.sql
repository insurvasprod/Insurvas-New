-- LA-1.19: subscription-backed partner and seat capacity.
-- Limits are nullable data, not plan branches: NULL means unlimited and zero means none.

alter table public.plan_limits add column if not exists max_publishers integer;
alter table public.plan_limits add column if not exists max_marketing_partners integer;
alter table public.plan_limits add column if not exists max_affiliates integer;
alter table public.plan_limits add column if not exists max_buffer_seats integer;
alter table public.plan_limits add column if not exists max_partner_users integer;

alter table public.plan_limits drop constraint if exists plan_limits_non_negative;
alter table public.plan_limits add constraint plan_limits_non_negative check (
  (max_seats is null or max_seats >= 0) and
  (max_carriers is null or max_carriers >= 0) and
  (max_publishers is null or max_publishers >= 0) and
  (max_marketing_partners is null or max_marketing_partners >= 0) and
  (max_affiliates is null or max_affiliates >= 0) and
  (max_buffer_seats is null or max_buffer_seats >= 0) and
  (max_partner_users is null or max_partner_users >= 0)
);

-- Keep the entitlement snapshot complete even when a plan has no limits row.
create or replace function public.refresh_tenant_entitlement(p_tenant_id uuid)
returns jsonb language plpgsql as $$
declare
  r record;
  v_plan record;
  v_limits record;
  v_period timestamptz;
  v_meters jsonb := '{}'::jsonb;
  v_key text;
  v_value jsonb;
  v_used integer;
  v_entitlement jsonb;
  v_access text;
begin
  select * into r from resolve_tenant_entitlement(p_tenant_id);
  select pl.* into v_limits from plan_limits pl where pl.plan_id = r.plan_id;

  if r.plan_id is null then
    v_entitlement := jsonb_build_object(
      'tenant_id', p_tenant_id, 'plan_code', null, 'plan_version', null,
      'status', null, 'access', 'none', 'computed_at', now(),
      'features', '[]'::jsonb, 'meters', '{}'::jsonb,
      'limits', jsonb_build_object(
        'max_seats', null, 'max_publishers', null, 'max_marketing_partners', null,
        'max_affiliates', null, 'max_buffer_seats', null, 'max_partner_users', null
      )
    );
  else
    select code, version into v_plan from plans where id = r.plan_id;
    v_period := tenant_current_period_start(p_tenant_id);
    for v_key, v_value in select * from jsonb_each(r.meter_allowances) loop
      select coalesce(ut.used_qty, 0) into v_used from usage_totals ut
       where ut.tenant_id = p_tenant_id and ut.meter_key = v_key and ut.period_start = v_period;
      v_meters := v_meters || jsonb_build_object(v_key, jsonb_build_object(
        'included', v_value->'included', 'hard_cap', v_value->'hard_cap', 'used', coalesce(v_used, 0)
      ));
    end loop;
    v_access := case r.subscription_status when 'suspended' then 'read_only' when 'paused' then 'read_only' when 'cancelled' then 'none' else 'full' end;
    v_entitlement := jsonb_build_object(
      'tenant_id', p_tenant_id, 'plan_code', v_plan.code, 'plan_version', v_plan.version,
      'status', r.subscription_status, 'access', v_access, 'computed_at', now(),
      'features', to_jsonb(r.feature_keys), 'meters', v_meters,
      'limits', jsonb_build_object(
        'max_seats', v_limits.max_seats, 'max_publishers', v_limits.max_publishers,
        'max_marketing_partners', v_limits.max_marketing_partners, 'max_affiliates', v_limits.max_affiliates,
        'max_buffer_seats', v_limits.max_buffer_seats, 'max_partner_users', v_limits.max_partner_users
      ), 'period_start', v_period
    );
  end if;

  insert into tenant_entitlements as te (tenant_id, entitlement, computed_at, version)
  values (p_tenant_id, v_entitlement, now(), 1)
  on conflict (tenant_id) do update set entitlement = excluded.entitlement, computed_at = excluded.computed_at, version = te.version + 1;
  return v_entitlement;
end;
$$;

-- Admins configure capacity as part of a plan version. The API performs the audit write.
create or replace function public.admin_save_plan_limits(
  p_plan_id uuid,
  p_max_publishers integer default null,
  p_max_marketing_partners integer default null,
  p_max_affiliates integer default null,
  p_max_buffer_seats integer default null,
  p_max_partner_users integer default null
)
returns public.plan_limits language plpgsql security invoker set search_path = public as $$
declare v_row public.plan_limits;
begin
  if not exists (select 1 from plans where id = p_plan_id) then raise exception 'plan_not_found'; end if;
  if p_max_publishers < 0 or p_max_marketing_partners < 0 or p_max_affiliates < 0 or p_max_buffer_seats < 0 or p_max_partner_users < 0 then
    raise exception 'invalid_plan_limit';
  end if;
  insert into plan_limits (plan_id, max_publishers, max_marketing_partners, max_affiliates, max_buffer_seats, max_partner_users)
  values (p_plan_id, p_max_publishers, p_max_marketing_partners, p_max_affiliates, p_max_buffer_seats, p_max_partner_users)
  on conflict (plan_id) do update set
    max_publishers = excluded.max_publishers, max_marketing_partners = excluded.max_marketing_partners,
    max_affiliates = excluded.max_affiliates, max_buffer_seats = excluded.max_buffer_seats,
    max_partner_users = excluded.max_partner_users
  returning * into v_row;
  return v_row;
end;
$$;

-- These RPCs take the cached limit values from the server. The tenant lock makes the check and
-- write one transaction, including two HTTP calls that use different pooler connections.
create or replace function public.create_partner_with_limits(
  p_tenant_id uuid, p_name text, p_partner_type public.partner_type, p_country text,
  p_contact_name text, p_contact_email text, p_timezone text, p_notes text, p_created_by uuid,
  p_max_publishers integer default null, p_max_marketing_partners integer default null, p_max_affiliates integer default null
)
returns public.partners language plpgsql security invoker set search_path = public as $$
declare v_row public.partners; v_count integer; v_limit integer; v_key text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  perform 1 from tenants where id = p_tenant_id for update;
  if not found then raise exception 'tenant_not_found'; end if;
  v_key := case p_partner_type when 'publisher' then 'max_publishers' when 'marketing' then 'max_marketing_partners' else 'max_affiliates' end;
  v_limit := case p_partner_type when 'publisher' then p_max_publishers when 'marketing' then p_max_marketing_partners else p_max_affiliates end;
  if v_limit is not null and v_limit < 0 then raise exception 'invalid_plan_limit'; end if;
  select count(*)::integer into v_count from partners where tenant_id = p_tenant_id and partner_type = p_partner_type and status = 'active';
  if v_limit is not null and v_count >= v_limit then raise exception 'partner_limit_reached:%:%:%', v_key, v_count, v_limit; end if;
  insert into partners (tenant_id, name, partner_type, country, contact_name, contact_email, timezone, notes, created_by)
  values (p_tenant_id, btrim(p_name), p_partner_type, upper(btrim(p_country)), nullif(btrim(p_contact_name), ''), nullif(lower(btrim(p_contact_email)), ''), btrim(p_timezone), nullif(btrim(p_notes), ''), p_created_by)
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
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  select * into v_old from partners where id = p_partner_id and tenant_id = p_tenant_id for update;
  if not found or v_old.status = 'offboarded' then raise exception 'partner_not_found_or_offboarded'; end if;
  if v_old.status = 'active' and v_old.partner_type <> p_partner_type then
    v_key := case p_partner_type when 'publisher' then 'max_publishers' when 'marketing' then 'max_marketing_partners' else 'max_affiliates' end;
    v_limit := case p_partner_type when 'publisher' then p_max_publishers when 'marketing' then p_max_marketing_partners else p_max_affiliates end;
    select count(*)::integer into v_count from partners where tenant_id = p_tenant_id and partner_type = p_partner_type and status = 'active' and id <> p_partner_id;
    if v_limit is not null and v_count >= v_limit then raise exception 'partner_limit_reached:%:%:%', v_key, v_count, v_limit; end if;
  end if;
  update partners set name=btrim(p_name), partner_type=p_partner_type, country=upper(btrim(p_country)), contact_name=nullif(btrim(p_contact_name), ''), contact_email=nullif(lower(btrim(p_contact_email)), ''), timezone=btrim(p_timezone), notes=nullif(btrim(p_notes), '') where id=p_partner_id and tenant_id=p_tenant_id returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.transition_partner_with_limits(
  p_tenant_id uuid, p_partner_id uuid, p_next_status public.partner_status, p_confirmation text default null,
  p_max_publishers integer default null, p_max_marketing_partners integer default null, p_max_affiliates integer default null
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
  end if;
  update partners set status=p_next_status, paused_at=case when p_next_status='paused' then coalesce(paused_at,now()) else paused_at end, offboarded_at=case when p_next_status='offboarded' then now() else offboarded_at end where id=p_partner_id and tenant_id=p_tenant_id returning * into v_row;
  if p_next_status='offboarded' then update partner_users set status='revoked',revoked_at=coalesce(revoked_at,now()),deactivated_at=coalesce(deactivated_at,now()) where tenant_id=p_tenant_id and partner_id=p_partner_id and status <> 'revoked'; end if;
  return v_row;
end;
$$;

create or replace function public.partner_invite_user_with_limit(
  p_tenant_id uuid, p_partner_id uuid, p_name text, p_email text, p_role public.partner_user_role,
  p_token_hash text, p_expires_at timestamptz, p_max_partner_users integer default null
)
returns table(user_id uuid, tenant_id uuid, partner_id uuid, name text, email text, role public.partner_user_role, invited_at timestamptz, accepted_at timestamptz)
language plpgsql security invoker set search_path = public as $$
declare v_user_id uuid; v_invited_at timestamptz; v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  perform 1 from partners p where p.id=p_partner_id and p.tenant_id=p_tenant_id and p.status <> 'offboarded' for update;
  if not found then raise exception 'partner_not_found_or_offboarded'; end if;
  select count(*)::integer into v_count from partner_users pu join partners p on p.id=pu.partner_id where pu.tenant_id=p_tenant_id and pu.status='active' and p.status='active';
  if p_max_partner_users is not null and v_count >= p_max_partner_users then raise exception 'partner_user_limit_reached:max_partner_users:%:%',v_count,p_max_partner_users; end if;
  if exists(select 1 from users u where u.email=lower(btrim(p_email))) then raise exception 'partner_user_email_exists'; end if;
  insert into users(name,email,status) values(btrim(p_name),lower(btrim(p_email)),'active') returning id into v_user_id;
  insert into partner_users(id,tenant_id,partner_id,user_id,role,status) values(gen_random_uuid(),p_tenant_id,p_partner_id,v_user_id,p_role,'active') returning partner_users.invited_at into v_invited_at;
  insert into user_invitations(user_id,partner_id,token_hash,expires_at,created_by,purpose) values(v_user_id,p_partner_id,p_token_hash,p_expires_at,null,'invite');
  return query select v_user_id,p_tenant_id,p_partner_id,btrim(p_name),lower(btrim(p_email)),p_role,v_invited_at,null::timestamptz;
end;
$$;

create or replace function public.partner_set_user_status_with_limit(
  p_tenant_id uuid, p_partner_id uuid, p_user_id uuid, p_status public.partner_user_status, p_max_partner_users integer default null
)
returns table(old_status public.partner_user_status, new_status public.partner_user_status)
language plpgsql security invoker set search_path = public as $$
declare v_old public.partner_user_status; v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  perform 1 from partners where id=p_partner_id and tenant_id=p_tenant_id and status='active' for update;
  if not found then raise exception 'partner_not_found_or_offboarded'; end if;
  select status into v_old from partner_users where tenant_id=p_tenant_id and partner_id=p_partner_id and user_id=p_user_id for update;
  if not found then raise exception 'partner_user_not_found'; end if;
  if v_old=p_status then raise exception 'partner_user_already_in_state'; end if;
  if p_status='active' then
    select count(*)::integer into v_count from partner_users pu join partners p on p.id=pu.partner_id where pu.tenant_id=p_tenant_id and pu.status='active' and p.status='active' and not (pu.partner_id=p_partner_id and pu.user_id=p_user_id);
    if p_max_partner_users is not null and v_count >= p_max_partner_users then raise exception 'partner_user_limit_reached:max_partner_users:%:%',v_count,p_max_partner_users; end if;
  end if;
  update partner_users set status=p_status, revoked_at=case when p_status='revoked' then coalesce(revoked_at,now()) else null end, deactivated_at=case when p_status='revoked' then coalesce(deactivated_at,now()) else null end where tenant_id=p_tenant_id and partner_id=p_partner_id and user_id=p_user_id;
  return query select v_old,p_status;
end;
$$;

create or replace function public.tenant_invite_user_with_limit(
  p_name text, p_email text, p_role public.tenant_user_role, p_tenant_id uuid, p_token_hash text, p_expires_at timestamptz, p_created_by uuid, p_max_buffer_seats integer default null
)
returns table(user_id uuid, tenant_id uuid) language plpgsql security invoker set search_path = public as $$
declare v_user_id uuid; v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  if not exists(select 1 from tenants where id=p_tenant_id) then raise exception 'tenant_not_found'; end if;
  if p_role='assistant' then
    select count(*)::integer into v_count from tenant_users tu join users u on u.id=tu.user_id where tu.tenant_id=p_tenant_id and tu.role='assistant' and u.status in ('active','suspended');
    if p_max_buffer_seats is not null and v_count >= p_max_buffer_seats then raise exception 'buffer_seat_limit_reached:max_buffer_seats:%:%',v_count,p_max_buffer_seats; end if;
  end if;
  insert into users(name,email,status) values(btrim(p_name),lower(btrim(p_email)),'active') returning id into v_user_id;
  insert into tenant_users(tenant_id,user_id,role,accepted_at) values(p_tenant_id,v_user_id,p_role,null);
  insert into user_invitations(user_id,token_hash,expires_at,created_by,purpose) values(v_user_id,p_token_hash,p_expires_at,null,'invite');
  return query select v_user_id,p_tenant_id;
end;
$$;

create or replace function public.tenant_update_member_role_with_limit(
  p_tenant_id uuid, p_user_id uuid, p_role public.tenant_user_role, p_max_buffer_seats integer default null
)
returns table(old_role public.tenant_user_role, new_role public.tenant_user_role) language plpgsql security invoker set search_path = public as $$
declare v_old public.tenant_user_role; v_count integer; v_status public.user_status;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  if not exists(select 1 from tenants where id=p_tenant_id) then raise exception 'tenant_not_found'; end if;
  select tu.role,u.status into v_old,v_status from tenant_users tu join users u on u.id=tu.user_id where tu.tenant_id=p_tenant_id and tu.user_id=p_user_id for update;
  if not found then raise exception 'member_not_found'; end if;
  if v_old='owner' and p_role <> 'owner' and (select count(*) from tenant_users where tenant_id=p_tenant_id and role='owner') <= 1 then raise exception 'last_owner'; end if;
  if p_role='assistant' and v_old <> 'assistant' and v_status in ('active','suspended') then
    select count(*)::integer into v_count from tenant_users tu join users u on u.id=tu.user_id where tu.tenant_id=p_tenant_id and tu.role='assistant' and u.status in ('active','suspended');
    if p_max_buffer_seats is not null and v_count >= p_max_buffer_seats then raise exception 'buffer_seat_limit_reached:max_buffer_seats:%:%',v_count,p_max_buffer_seats; end if;
  end if;
  update tenant_users set role=p_role where tenant_id=p_tenant_id and user_id=p_user_id;
  return query select v_old,p_role;
end;
$$;

revoke all on function public.admin_save_plan_limits(uuid,integer,integer,integer,integer,integer) from public, anon, authenticated, tenant_app;
grant execute on function public.admin_save_plan_limits(uuid,integer,integer,integer,integer,integer) to service_role;
revoke all on function public.create_partner_with_limits(uuid,text,public.partner_type,text,text,text,text,text,uuid,integer,integer,integer) from public, anon, authenticated, tenant_app;
grant execute on function public.create_partner_with_limits(uuid,text,public.partner_type,text,text,text,text,text,uuid,integer,integer,integer) to service_role;
revoke all on function public.update_partner_with_limits(uuid,uuid,text,public.partner_type,text,text,text,text,text,integer,integer,integer) from public, anon, authenticated, tenant_app;
grant execute on function public.update_partner_with_limits(uuid,uuid,text,public.partner_type,text,text,text,text,text,integer,integer,integer) to service_role;
revoke all on function public.transition_partner_with_limits(uuid,uuid,public.partner_status,text,integer,integer,integer) from public, anon, authenticated, tenant_app;
grant execute on function public.transition_partner_with_limits(uuid,uuid,public.partner_status,text,integer,integer,integer) to service_role;
revoke all on function public.partner_invite_user_with_limit(uuid,uuid,text,text,public.partner_user_role,text,timestamptz,integer) from public, anon, authenticated, tenant_app;
grant execute on function public.partner_invite_user_with_limit(uuid,uuid,text,text,public.partner_user_role,text,timestamptz,integer) to service_role;
revoke all on function public.partner_set_user_status_with_limit(uuid,uuid,uuid,public.partner_user_status,integer) from public, anon, authenticated, tenant_app;
grant execute on function public.partner_set_user_status_with_limit(uuid,uuid,uuid,public.partner_user_status,integer) to service_role;
revoke all on function public.tenant_invite_user_with_limit(text,text,public.tenant_user_role,uuid,text,timestamptz,uuid,integer) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_invite_user_with_limit(text,text,public.tenant_user_role,uuid,text,timestamptz,uuid,integer) to service_role;
revoke all on function public.tenant_update_member_role_with_limit(uuid,uuid,public.tenant_user_role,integer) from public, anon, authenticated, tenant_app;
grant execute on function public.tenant_update_member_role_with_limit(uuid,uuid,public.tenant_user_role,integer) to service_role;
