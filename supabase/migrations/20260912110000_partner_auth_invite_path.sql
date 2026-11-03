-- LA-1.2: a partner invitation must attach a real Supabase Auth identity.
--
-- The same defect LA-0.2 fixed for the tenant plane on 2026-09-11, still present on the partner
-- plane. `partner_invite_user_with_limit` does `insert into public.users` with a `gen_random_uuid()`
-- id, and `public.users.id` references `auth.users(id)`, so that insert cannot succeed. Every
-- invitation of a NEW email returns 500. Inviting an address that already has an account works,
-- which is why the failure looked intermittent rather than total.
--
-- Confirmed live on 2026-09-12 with scripts/verify-partner-users.mjs: six LA-1.2 criteria fail on
-- this alone, including "invites use the required portal path and bounded expiry" and both resend
-- criteria, which cannot run without an invited user to resend to.
--
-- This mirrors public.tenant_invite_user_with_auth deliberately. The application creates the Auth
-- identity first, then calls this service-role-only function to attach it to the partner and write
-- the invitation atomically. Same contract, same failure names, so the two planes stay legible as
-- one pattern rather than two.
--
-- organization_id is deliberately not set: 20260912100000 made it nullable because the tenant plane
-- has no organization. The column stays for the organizations-era product's own rows.

create or replace function public.partner_invite_user_with_auth(
  p_auth_user_id uuid,
  p_tenant_id uuid,
  p_partner_id uuid,
  p_name text,
  p_email text,
  p_role public.partner_user_role,
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
  -- Serialised per partner, so two admins inviting at once cannot both pass the seat check.
  perform pg_advisory_xact_lock(hashtextextended(p_partner_id::text, 0));

  if not exists (select 1 from public.partners where id = p_partner_id and partners.tenant_id = p_tenant_id) then
    raise exception 'partner_not_found';
  end if;

  -- The caller must have created the Auth identity first. Refusing here rather than inserting is
  -- the whole point of this function.
  if not exists (
    select 1 from public.users
    where id = p_auth_user_id and lower(users.email) = lower(btrim(p_email))
  ) then
    raise exception 'auth_profile_not_found';
  end if;

  if exists (
    select 1 from public.users
    where lower(users.email) = lower(btrim(p_email)) and id <> p_auth_user_id
  ) then
    raise exception 'email_exists';
  end if;

  -- Already a member of this partner, or of another one. A person belongs to one partner, per
  -- LA-1.2's out-of-scope note.
  if exists (select 1 from public.partner_users pu where pu.user_id = p_auth_user_id and pu.partner_id = p_partner_id) then
    raise exception 'email_exists';
  end if;

  if p_max_partner_users is not null then
    select count(*)::integer into v_count
    from public.partner_users pu
    where pu.partner_id = p_partner_id
      and pu.status = 'active';
    if v_count >= p_max_partner_users then
      raise exception 'max_partner_users:%:%', v_count, p_max_partner_users;
    end if;
  end if;

  -- Only a brand new account becomes 'invited'. Inviting somebody who ALREADY has an Insurvas
  -- account must not downgrade them: /api/partner/auth/accept-invite requires
  -- `account.status === 'active'` for the existing-account flow, and returns 400 before checking
  -- the password if it is not. That path signs the person in with the password they already have,
  -- so there is nothing to reset.
  update public.users
     set name = btrim(p_name),
         full_name = btrim(p_name),
         display_name = btrim(p_name),
         status = case when password_hash is null then 'invited' else status end,
         active = case when password_hash is null then false else active end,
         must_reset_password = case when password_hash is null then true else must_reset_password end,
         updated_at = now()
   where id = p_auth_user_id;

  insert into public.partner_users (tenant_id, partner_id, user_id, role, status, invited_at)
  values (p_tenant_id, p_partner_id, p_auth_user_id, p_role, 'active', v_invited_at);

  -- partner_id set, tenant_id deliberately left null. `user_invitations` is shared across the two
  -- planes, and which column is populated is how the consumers tell the invitations apart: a tenant
  -- invite carries tenant_id, a partner invite carries partner_id. Setting both makes the row
  -- ambiguous and consume_existing_partner_invite rejects it, which returns 400 from
  -- /api/partner/auth/accept-invite before the password is ever checked.
  insert into public.user_invitations (user_id, partner_id, token_hash, expires_at, created_by, purpose)
  values (p_auth_user_id, p_partner_id, p_token_hash, p_expires_at, null, 'invite');

  return query
    select p_auth_user_id, p_tenant_id, p_partner_id, btrim(p_name), lower(btrim(p_email)), p_role, v_invited_at;
end;
$$;

revoke all on function public.partner_invite_user_with_auth(uuid,uuid,uuid,text,text,public.partner_user_role,text,timestamptz,integer)
  from public, anon, authenticated, tenant_app;
grant execute on function public.partner_invite_user_with_auth(uuid,uuid,uuid,text,text,public.partner_user_role,text,timestamptz,integer)
  to service_role;
