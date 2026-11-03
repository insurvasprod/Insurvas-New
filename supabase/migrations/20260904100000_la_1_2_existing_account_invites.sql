-- LA-1.2: let an existing Insurvas account accept partner access without replacing its password.
-- New accounts still use the set-password invitation. Existing accounts use a separate
-- credential-re-authenticated acceptance endpoint in the application layer.

create or replace function public.partner_invite_user_with_limit(
  p_tenant_id uuid, p_partner_id uuid, p_name text, p_email text, p_role public.partner_user_role,
  p_token_hash text, p_expires_at timestamptz, p_max_partner_users integer default null
)
returns table(user_id uuid, tenant_id uuid, partner_id uuid, name text, email text, role public.partner_user_role, invited_at timestamptz, accepted_at timestamptz)
language plpgsql security invoker set search_path = public as $$
declare
  v_user_id uuid;
  v_user_status public.user_status;
  v_invited_at timestamptz;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  perform 1 from partners p where p.id = p_partner_id and p.tenant_id = p_tenant_id and p.status <> 'offboarded' for update;
  if not found then raise exception 'partner_not_found_or_offboarded'; end if;

  select u.id, u.status into v_user_id, v_user_status
    from users u where u.email = lower(btrim(p_email)) for update;
  if found and v_user_status <> 'active' then raise exception 'partner_user_account_not_active'; end if;
  if v_user_id is not null and exists (select 1 from partner_users pu where pu.user_id = v_user_id) then
    raise exception 'partner_user_email_exists';
  end if;

  select count(*)::integer into v_count
    from partner_users pu join partners p on p.id = pu.partner_id
   where pu.tenant_id = p_tenant_id and pu.status = 'active' and p.status = 'active';
  if p_max_partner_users is not null and v_count >= p_max_partner_users then
    raise exception 'partner_user_limit_reached:max_partner_users:%:%', v_count, p_max_partner_users;
  end if;

  if v_user_id is null then
    insert into users(name, email, status)
    values (btrim(p_name), lower(btrim(p_email)), 'active')
    returning id into v_user_id;
  end if;

  insert into partner_users(id, tenant_id, partner_id, user_id, role, status)
  values (gen_random_uuid(), p_tenant_id, p_partner_id, v_user_id, p_role, 'active')
  returning partner_users.invited_at into v_invited_at;
  insert into user_invitations(user_id, partner_id, token_hash, expires_at, created_by, purpose)
  values (v_user_id, p_partner_id, p_token_hash, p_expires_at, null, 'invite');

  return query select v_user_id, p_tenant_id, p_partner_id, btrim(p_name), lower(btrim(p_email)), p_role, v_invited_at, null::timestamptz;
end;
$$;

create or replace function public.partner_resend_invite(
  p_tenant_id uuid, p_partner_id uuid, p_user_id uuid, p_token_hash text, p_expires_at timestamptz
)
returns table(user_id uuid, name text, email text)
language plpgsql security invoker set search_path = public as $$
declare
  v_user public.users%rowtype;
  v_membership public.partner_users%rowtype;
begin
  select pu.* into v_membership
    from public.partner_users pu
    join public.partners p on p.id = pu.partner_id
   where pu.tenant_id = p_tenant_id and pu.partner_id = p_partner_id and pu.user_id = p_user_id
     and p.status <> 'offboarded'
   for update;
  if not found then raise exception 'partner_user_not_found'; end if;
  if v_membership.status <> 'active' or v_membership.accepted_at is not null then
    raise exception 'partner_invite_not_pending';
  end if;

  select * into v_user from public.users where id = p_user_id for update;
  if not found then raise exception 'partner_invite_not_pending'; end if;

  delete from public.user_invitations invitation
   where invitation.user_id = p_user_id
     and invitation.partner_id = p_partner_id
     and invitation.accepted_at is null;
  insert into public.user_invitations(user_id, partner_id, token_hash, expires_at, created_by, purpose)
  values (p_user_id, p_partner_id, p_token_hash, p_expires_at, null, 'invite');

  return query select v_user.id, v_user.name, v_user.email;
end;
$$;

create or replace function public.consume_existing_partner_invite(p_token_hash text)
returns table(user_id uuid, tenant_id uuid, partner_id uuid, accepted_at timestamptz)
language plpgsql security invoker set search_path = public as $$
declare
  v_token public.user_invitations%rowtype;
  v_accepted_at timestamptz := now();
begin
  select invitation.* into v_token
    from public.user_invitations invitation
    join public.partner_users membership
      on membership.partner_id = invitation.partner_id and membership.user_id = invitation.user_id
    join public.partners partner on partner.id = membership.partner_id
    join public.users account on account.id = invitation.user_id
   where invitation.token_hash = p_token_hash
     and invitation.partner_id is not null
     and invitation.purpose = 'invite'
     and invitation.accepted_at is null
     and invitation.expires_at > now()
     and membership.status = 'active'
     and partner.status <> 'offboarded'
     and account.status = 'active'
     and account.password_hash is not null
   for update of invitation;
  if not found then raise exception using errcode = 'P0001', message = 'PARTNER_EXISTING_INVITE_INVALID_OR_EXPIRED'; end if;

  update public.user_invitations invitation set accepted_at = v_accepted_at
   where invitation.id = v_token.id and invitation.accepted_at is null;
  if not found then raise exception using errcode = 'P0001', message = 'PARTNER_EXISTING_INVITE_ALREADY_USED'; end if;

update public.partner_users membership
     set accepted_at = coalesce(membership.accepted_at, v_accepted_at), status = 'active', revoked_at = null, deactivated_at = null
   where membership.partner_id = v_token.partner_id and membership.user_id = v_token.user_id and membership.status = 'active';
  if not found then raise exception using errcode = 'P0001', message = 'PARTNER_MEMBERSHIP_NOT_ACTIVE'; end if;

  return query
    select v_token.user_id, membership.tenant_id, v_token.partner_id, v_accepted_at
      from public.partner_users membership
     where membership.partner_id = v_token.partner_id and membership.user_id = v_token.user_id;
end;
$$;

revoke all on function public.consume_existing_partner_invite(text) from public, anon, authenticated, tenant_app;
grant execute on function public.consume_existing_partner_invite(text) to service_role;
