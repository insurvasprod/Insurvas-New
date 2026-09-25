-- LA-1.2: partner-user identity, invitation and portal-access boundary.
--
-- Partner users are deliberately not tenant_users. They sit inside a tenant for data ownership,
-- but authenticate through a separate cookie and are authorised by this membership on every
-- request. A revoked membership therefore invalidates the next request immediately, without
-- waiting for the 12-hour tenant JWT to expire.

do $$ begin
  create type public.partner_user_role as enum ('partner_admin', 'partner_user');
exception when duplicate_object then null; end $$;

alter table public.partner_users add column if not exists id uuid default gen_random_uuid();
alter table public.partner_users add column if not exists tenant_id uuid;
alter table public.partner_users add column if not exists role public.partner_user_role default 'partner_user';
alter table public.partner_users add column if not exists accepted_at timestamptz;
alter table public.partner_users add column if not exists deactivated_at timestamptz;

update public.partner_users pu
   set tenant_id = p.tenant_id
  from public.partners p
 where p.id = pu.partner_id
   and pu.tenant_id is null;

update public.partner_users
   set role = 'partner_user'
 where role is null;

update public.partner_users
   set deactivated_at = coalesce(deactivated_at, revoked_at, now())
 where status = 'revoked'
   and deactivated_at is null;

alter table public.partner_users alter column id set not null;
alter table public.partner_users alter column tenant_id set not null;
alter table public.partner_users alter column role set not null;

do $$ begin
  alter table public.partner_users add constraint partner_users_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete restrict;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.partner_users add constraint partner_users_id_key unique (id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.partner_users add constraint partner_users_one_partner_per_user_key unique (user_id);
exception when duplicate_object then null; end $$;

alter table public.partner_users drop constraint if exists partner_users_status_dates;
alter table public.partner_users add constraint partner_users_status_dates check (
  (status = 'active' and deactivated_at is null) or
  (status = 'revoked' and deactivated_at is not null)
);

alter table public.user_invitations add column if not exists partner_id uuid;
do $$ begin
  alter table public.user_invitations add constraint user_invitations_partner_id_fkey
    foreign key (partner_id) references public.partners(id) on delete restrict;
exception when duplicate_object then null; end $$;
alter table public.user_invitations add constraint user_invitations_partner_invite_check
  check (partner_id is null or purpose = 'invite');

create index if not exists partner_users_tenant_partner_idx
  on public.partner_users(tenant_id, partner_id, status);
create index if not exists partner_users_user_status_idx
  on public.partner_users(user_id, status);
create index if not exists user_invitations_partner_pending_idx
  on public.user_invitations(partner_id, user_id, accepted_at)
  where partner_id is not null and accepted_at is null;

create or replace function public.partner_invite_user(
  p_tenant_id uuid,
  p_partner_id uuid,
  p_name text,
  p_email text,
  p_role public.partner_user_role,
  p_token_hash text,
  p_expires_at timestamptz
)
returns table(user_id uuid, tenant_id uuid, partner_id uuid, name text, email text,
              role public.partner_user_role, invited_at timestamptz, accepted_at timestamptz)
language plpgsql security invoker set search_path = public
as $$
declare
  v_user_id uuid;
  v_invited_at timestamptz;
begin
  perform 1 from public.partners p
   where p.id = p_partner_id and p.tenant_id = p_tenant_id and p.status <> 'offboarded'
   for update;
  if not found then raise exception 'partner_not_found_or_offboarded'; end if;

  if exists (select 1 from public.users u where u.email = lower(btrim(p_email))) then
    raise exception 'partner_user_email_exists';
  end if;

  insert into public.users (name, email, status)
  values (btrim(p_name), lower(btrim(p_email)), 'active')
  returning id into v_user_id;

  insert into public.partner_users (id, tenant_id, partner_id, user_id, role, status)
  values (gen_random_uuid(), p_tenant_id, p_partner_id, v_user_id, p_role, 'active')
  returning partner_users.invited_at into v_invited_at;

  insert into public.user_invitations (user_id, partner_id, token_hash, expires_at, created_by, purpose)
  values (v_user_id, p_partner_id, p_token_hash, p_expires_at, null, 'invite');

  return query
  select v_user_id, p_tenant_id, p_partner_id, btrim(p_name), lower(btrim(p_email)),
         p_role, v_invited_at, null::timestamptz;
end;
$$;

create or replace function public.partner_resend_invite(
  p_tenant_id uuid,
  p_partner_id uuid,
  p_user_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns table(user_id uuid, name text, email text)
language plpgsql security invoker set search_path = public
as $$
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
  if not found or v_user.password_hash is not null then raise exception 'partner_invite_not_pending'; end if;

  delete from public.user_invitations
   where user_id = p_user_id and partner_id = p_partner_id and accepted_at is null;
  insert into public.user_invitations (user_id, partner_id, token_hash, expires_at, created_by, purpose)
  values (p_user_id, p_partner_id, p_token_hash, p_expires_at, null, 'invite');

  return query select v_user.id, v_user.name, v_user.email;
end;
$$;

create or replace function public.partner_set_user_status(
  p_tenant_id uuid,
  p_partner_id uuid,
  p_user_id uuid,
  p_status public.partner_user_status
)
returns table(old_status public.partner_user_status, new_status public.partner_user_status)
language plpgsql security invoker set search_path = public
as $$
declare
  v_old public.partner_user_status;
begin
  perform 1 from public.partners
   where id = p_partner_id and tenant_id = p_tenant_id and status <> 'offboarded'
   for update;
  if not found then raise exception 'partner_not_found_or_offboarded'; end if;

  select status into v_old from public.partner_users
   where tenant_id = p_tenant_id and partner_id = p_partner_id and user_id = p_user_id
   for update;
  if not found then raise exception 'partner_user_not_found'; end if;
  if v_old = p_status then raise exception 'partner_user_already_in_state'; end if;

  update public.partner_users
     set status = p_status,
         revoked_at = case when p_status = 'revoked' then coalesce(revoked_at, now()) else null end,
         deactivated_at = case when p_status = 'revoked' then coalesce(deactivated_at, now()) else null end
   where tenant_id = p_tenant_id and partner_id = p_partner_id and user_id = p_user_id;

  return query select v_old, p_status;
end;
$$;

create or replace function public.consume_partner_password_token(
  p_token_hash text,
  p_password_hash text
)
returns table(user_id uuid, partner_id uuid, accepted_at timestamptz)
language plpgsql security invoker set search_path = public
as $$
declare
  v_token public.user_invitations%rowtype;
  v_accepted_at timestamptz := now();
begin
  select invitation.* into v_token
    from public.user_invitations invitation
    join public.partner_users membership
      on membership.partner_id = invitation.partner_id and membership.user_id = invitation.user_id
    join public.partners partner on partner.id = membership.partner_id
   where invitation.token_hash = p_token_hash
     and invitation.partner_id is not null
     and invitation.purpose = 'invite'
     and invitation.accepted_at is null
     and invitation.expires_at > now()
     and membership.status = 'active'
     and partner.status <> 'offboarded'
   for update of invitation;
  if not found then raise exception using errcode = 'P0001', message = 'PARTNER_PASSWORD_TOKEN_INVALID_OR_EXPIRED'; end if;

  update public.users set password_hash = p_password_hash where id = v_token.user_id;
  if not found then raise exception using errcode = 'P0001', message = 'PARTNER_PASSWORD_TOKEN_USER_NOT_FOUND'; end if;

  update public.user_invitations set accepted_at = v_accepted_at
   where id = v_token.id and accepted_at is null;
  if not found then raise exception using errcode = 'P0001', message = 'PARTNER_PASSWORD_TOKEN_ALREADY_USED'; end if;

  update public.partner_users membership
     set accepted_at = coalesce(accepted_at, v_accepted_at), status = 'active',
         revoked_at = null, deactivated_at = null
   where membership.partner_id = v_token.partner_id and membership.user_id = v_token.user_id and membership.status = 'active';
  if not found then raise exception using errcode = 'P0001', message = 'PARTNER_MEMBERSHIP_NOT_ACTIVE'; end if;

  return query select v_token.user_id, v_token.partner_id, v_accepted_at;
end;
$$;

-- LA-1.1's offboard transition now deactivates every membership, including an already individually
-- deactivated user, in the same locked transaction.
create or replace function public.transition_partner(
  p_tenant_id uuid,
  p_partner_id uuid,
  p_next_status public.partner_status,
  p_confirmation text default null
)
returns public.partners
language plpgsql security invoker set search_path = public
as $$
declare
  v_row public.partners;
begin
  select * into v_row from public.partners where id = p_partner_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'partner_not_found'; end if;
  if v_row.status = 'offboarded' then raise exception 'partner_already_offboarded'; end if;
  if p_next_status = 'offboarded' and coalesce(p_confirmation, '') <> 'OFFBOARD' then raise exception 'offboard_confirmation_required'; end if;
  if not ((v_row.status = 'draft' and p_next_status = 'active') or
          (v_row.status = 'active' and p_next_status in ('paused', 'offboarded')) or
          (v_row.status = 'paused' and p_next_status in ('active', 'offboarded'))) then
    raise exception 'invalid_partner_transition:%:%', v_row.status, p_next_status;
  end if;

  update public.partners
     set status = p_next_status,
         paused_at = case when p_next_status = 'paused' then coalesce(paused_at, now()) else paused_at end,
         offboarded_at = case when p_next_status = 'offboarded' then now() else offboarded_at end
   where id = p_partner_id and tenant_id = p_tenant_id
   returning * into v_row;

  if p_next_status = 'offboarded' then
    update public.partner_users
       set status = 'revoked', revoked_at = coalesce(revoked_at, now()),
           deactivated_at = coalesce(deactivated_at, now())
     where tenant_id = p_tenant_id and partner_id = p_partner_id and status <> 'revoked';
  end if;
  return v_row;
end;
$$;

revoke all on function public.partner_invite_user(uuid, uuid, text, text, public.partner_user_role, text, timestamptz) from public, anon, authenticated, tenant_app;
revoke all on function public.partner_resend_invite(uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated, tenant_app;
revoke all on function public.partner_set_user_status(uuid, uuid, uuid, public.partner_user_status) from public, anon, authenticated, tenant_app;
revoke all on function public.consume_partner_password_token(text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.partner_invite_user(uuid, uuid, text, text, public.partner_user_role, text, timestamptz) to service_role;
grant execute on function public.partner_resend_invite(uuid, uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.partner_set_user_status(uuid, uuid, uuid, public.partner_user_status) to service_role;
grant execute on function public.consume_partner_password_token(text, text) to service_role;

-- Keep the two password-setting endpoints mutually exclusive. A partner invitation must never
-- be redeemable through the tenant-agent endpoint, even if somebody pastes its token there.
create or replace function public.consume_user_password_token(
  p_token_hash text,
  p_password_hash text
)
returns table(user_id uuid, purpose public.user_token_purpose, accepted_at timestamptz)
language plpgsql security invoker set search_path = ''
as $$
declare
  v_token public.user_invitations%rowtype;
  v_accepted_at timestamptz := now();
begin
  select invitation.* into v_token
    from public.user_invitations invitation
   where invitation.token_hash = p_token_hash
     and invitation.partner_id is null
     and invitation.purpose in ('invite', 'password_reset')
     and invitation.accepted_at is null
     and invitation.expires_at > now()
   for update;
  if not found then raise exception using errcode = 'P0001', message = 'PASSWORD_TOKEN_INVALID_OR_EXPIRED'; end if;

  update public.users account set password_hash = p_password_hash where account.id = v_token.user_id;
  if not found then raise exception using errcode = 'P0001', message = 'PASSWORD_TOKEN_USER_NOT_FOUND'; end if;

  update public.user_invitations invitation set accepted_at = v_accepted_at
   where invitation.id = v_token.id and invitation.accepted_at is null;
  if not found then raise exception using errcode = 'P0001', message = 'PASSWORD_TOKEN_ALREADY_USED'; end if;

  if v_token.purpose = 'invite' then
    update public.tenant_users membership set accepted_at = coalesce(membership.accepted_at, v_accepted_at)
     where membership.user_id = v_token.user_id;
  end if;
  return query select v_token.user_id, v_token.purpose, v_accepted_at;
end;
$$;

revoke execute on function public.consume_user_password_token(text, text)
  from public, anon, authenticated, tenant_app;
grant execute on function public.consume_user_password_token(text, text) to service_role;
