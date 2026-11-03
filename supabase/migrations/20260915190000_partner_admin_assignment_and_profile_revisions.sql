-- Publisher hierarchy: persist the partner-admin that owns a partner-user relationship.
-- Existing rows deliberately remain null until an owner assigns them in the publisher Team view.
alter table public.partner_users
  add column if not exists partner_admin_user_id uuid references public.users(id) on delete set null;

create index if not exists partner_users_admin_lookup_idx
  on public.partner_users (tenant_id, partner_id, partner_admin_user_id)
  where partner_admin_user_id is not null;

create or replace function public.validate_partner_user_admin_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.partner_admin_user_id is null then
    return new;
  end if;

  if new.partner_admin_user_id = new.user_id or not exists (
    select 1
      from public.partner_users admin_membership
     where admin_membership.tenant_id = new.tenant_id
       and admin_membership.partner_id = new.partner_id
       and admin_membership.user_id = new.partner_admin_user_id
       and admin_membership.role = 'partner_admin'
  ) then
    raise exception 'invalid_partner_admin_assignment';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_partner_user_admin_assignment() from public, anon, authenticated, tenant_app;

drop trigger if exists partner_users_validate_admin_assignment on public.partner_users;
create trigger partner_users_validate_admin_assignment
before insert or update of partner_admin_user_id, tenant_id, partner_id, role on public.partner_users
for each row execute function public.validate_partner_user_admin_assignment();

-- Extend the service-role-only invite operation: partner-portal invitations attach the current
-- partner admin, while License Agent-created legacy-style invitations stay explicitly unassigned.
create or replace function public.partner_invite_user_with_auth(
  p_auth_user_id uuid,
  p_tenant_id uuid,
  p_partner_id uuid,
  p_name text,
  p_email text,
  p_role public.partner_user_role,
  p_partner_admin_user_id uuid,
  p_token_hash text,
  p_expires_at timestamptz,
  p_max_partner_users integer default null
)
returns table(user_id uuid, tenant_id uuid, partner_id uuid, name text, email text, role public.partner_user_role, invited_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_invited_at timestamptz := now();
begin
  perform pg_advisory_xact_lock(hashtextextended(p_partner_id::text, 0));
  if not exists (select 1 from public.partners where id = p_partner_id and partners.tenant_id = p_tenant_id) then raise exception 'partner_not_found'; end if;
  if not exists (select 1 from public.users where id = p_auth_user_id and lower(users.email) = lower(btrim(p_email))) then raise exception 'auth_profile_not_found'; end if;
  if exists (select 1 from public.users where lower(users.email) = lower(btrim(p_email)) and id <> p_auth_user_id) then raise exception 'email_exists'; end if;
  if exists (select 1 from public.partner_users pu where pu.user_id = p_auth_user_id and pu.partner_id = p_partner_id) then raise exception 'email_exists'; end if;
  if p_role <> 'partner_user' and p_partner_admin_user_id is not null then raise exception 'invalid_partner_admin_assignment'; end if;
  if p_partner_admin_user_id is not null and not exists (
    select 1 from public.partner_users pu where pu.tenant_id = p_tenant_id and pu.partner_id = p_partner_id and pu.user_id = p_partner_admin_user_id and pu.role = 'partner_admin'
  ) then raise exception 'invalid_partner_admin_assignment'; end if;
  if p_max_partner_users is not null then
    select count(*)::integer into v_count from public.partner_users pu where pu.partner_id = p_partner_id and pu.status = 'active';
    if v_count >= p_max_partner_users then raise exception 'max_partner_users:%:%', v_count, p_max_partner_users; end if;
  end if;
  update public.users set name = btrim(p_name), full_name = btrim(p_name), display_name = btrim(p_name), status = case when password_hash is null then 'invited' else status end, active = case when password_hash is null then false else active end, must_reset_password = case when password_hash is null then true else must_reset_password end, updated_at = now() where id = p_auth_user_id;
  insert into public.partner_users (tenant_id, partner_id, user_id, role, status, invited_at, partner_admin_user_id)
  values (p_tenant_id, p_partner_id, p_auth_user_id, p_role, 'active', v_invited_at, p_partner_admin_user_id);
  insert into public.user_invitations (user_id, partner_id, token_hash, expires_at, created_by, purpose)
  values (p_auth_user_id, p_partner_id, p_token_hash, p_expires_at, null, 'invite');
  return query select p_auth_user_id, p_tenant_id, p_partner_id, btrim(p_name), lower(btrim(p_email)), p_role, v_invited_at;
end;
$$;

revoke all on function public.partner_invite_user_with_auth(uuid,uuid,uuid,text,text,public.partner_user_role,uuid,text,timestamptz,integer) from public, anon, authenticated, tenant_app;
grant execute on function public.partner_invite_user_with_auth(uuid,uuid,uuid,text,text,public.partner_user_role,uuid,text,timestamptz,integer) to service_role;

-- Leads retain the resolved form-profile revision that governed the submission. This is metadata
-- only: the existing tenant template revision continues to provide the shared field definition.
alter table public.agent_leads
  add column if not exists partner_submission_profile_id uuid references public.partner_submission_profiles(id) on delete restrict,
  add column if not exists partner_submission_profile_revision integer;

create index if not exists agent_leads_partner_submission_profile_idx
  on public.agent_leads (tenant_id, partner_submission_profile_id, partner_submission_profile_revision)
  where partner_submission_profile_id is not null;
