-- Put self-serve signup on the Auth path the tenant plane already uses.
--
-- public.self_serve_signup takes a bcrypt p_password_hash and does
--
--   insert into public.users (email, password_hash, name, phone, status) values (...)
--
-- but public.users.id has no default and references auth.users(id): LA-0.2 made Supabase Auth the
-- credential authority for this plane. The insert therefore cannot supply an id and every signup
-- fails with
--
--   23502 null value in column "id" of relation "users"
--
-- which the route reports as "Could not create your account". Self-serve signup does not work, at
-- all, for anybody. SA-5.2 checkout, SA-5.3 trials and SA-5.4's acceptance-at-signup test all fail
-- behind it, because each one needs an account that cannot be created.
--
-- This is the third occurrence of one root cause, and the last one in the signup direction:
-- SA-1.2/1.3 fixed it for admin-created users (fbd319d), 20260912110000 fixed it for partner
-- invitations, and this fixes it for a customer signing themselves up. The shape is deliberately
-- identical to both -- p_auth_user_id first, no password in the database, the caller creates the
-- Auth identity and then calls this to attach everything in one transaction.
--
-- Why the row is UPDATEd rather than INSERTed. Creating an auth.users row fires the
-- on_auth_user_created bridge, which writes the public.users row before this function is reached.
-- Inserting again would raise 23505 on users_email_lower_unique. Same reasoning as
-- partner_invite_user_with_auth.
--
-- p_password_hash is dropped rather than ignored. A signature that still accepted it would invite a
-- caller to keep sending one, and a bcrypt hash sitting in public.users alongside a real Auth
-- identity is precisely the two-credential-stores problem recorded as open in
-- docs/qa/LA-1-QA-AUDIT.md. There is one credential store for this plane and it is Supabase Auth.
--
-- The old function is left in place, not dropped. It is referenced by historical migrations and
-- dropping it would rewrite what they mean; it is simply no longer called by the application.

create or replace function public.self_serve_signup_with_auth(
  p_auth_user_id uuid,
  p_name text,
  p_email text,
  p_phone text,
  p_plan_id uuid,
  p_billing_cycle public.billing_cycle,
  p_token_hash text,
  p_expires_at timestamptz
)
returns table(user_id uuid, tenant_id uuid, verification_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_verification_id uuid;
  v_plan public.plans%rowtype;
  v_cycle_available boolean;
begin
  -- The bridge trigger must have produced this profile already. If it has not, the Auth identity and
  -- the application row have diverged and continuing would attach a workspace to nothing.
  if not exists (
    select 1 from public.users
     where id = p_auth_user_id and lower(users.email) = lower(btrim(p_email))
  ) then
    raise exception using errcode = 'P0001', message = 'AUTH_PROFILE_NOT_FOUND';
  end if;

  -- Somebody else already owns this address. Same errcode the route maps to 409.
  if exists (
    select 1 from public.users
     where lower(users.email) = lower(btrim(p_email)) and id <> p_auth_user_id
  ) then
    raise exception using errcode = '23505', message = 'EMAIL_EXISTS';
  end if;

  -- Signing up twice with the same identity must not create a second workspace.
  if exists (select 1 from public.tenant_users tu where tu.user_id = p_auth_user_id) then
    raise exception using errcode = '23505', message = 'EMAIL_EXISTS';
  end if;

  select p.*
    into v_plan
    from public.plans p
   where p.id = p_plan_id
     and p.is_public
     and not p.is_archived
     and p.version = (
       select max(latest.version)
         from public.plans latest
        where latest.code = p.code
     )
   for share;

  if not found then
    raise exception using errcode = 'P0001', message = 'PLAN_UNAVAILABLE';
  end if;

  select case p_billing_cycle
    when 'monthly' then prices.price_monthly_cents is not null
    when 'quarterly' then prices.price_quarterly_cents is not null
    when 'yearly' then prices.price_yearly_cents is not null
  end
    into v_cycle_available
    from public.plan_prices prices
   where prices.plan_id = p_plan_id;

  if coalesce(v_cycle_available, false) is not true then
    raise exception using errcode = 'P0001', message = 'BILLING_CYCLE_UNAVAILABLE';
  end if;

  -- The bridge created this row as 'invited'. Signup owns the name, the phone and the state, and
  -- explicitly does not write password_hash: Supabase Auth holds the credential.
  update public.users
     set name = btrim(p_name),
         full_name = btrim(p_name),
         display_name = btrim(p_name),
         phone = nullif(btrim(p_phone), ''),
         status = 'pending_verification'::public.user_status,
         updated_at = now()
   where id = p_auth_user_id;

  insert into public.tenants (name, status, onboarding_state)
  values (btrim(p_name) || '''s Workspace', 'provisioning', 'pending_verification')
  returning id into v_tenant_id;

  insert into public.tenant_users (tenant_id, user_id, role)
  values (v_tenant_id, p_auth_user_id, 'owner');

  insert into public.signup_selections (tenant_id, plan_id, billing_cycle)
  values (v_tenant_id, p_plan_id, p_billing_cycle);

  insert into public.user_invitations (user_id, token_hash, purpose, expires_at)
  values (
    p_auth_user_id,
    p_token_hash,
    'email_verification'::public.user_token_purpose,
    p_expires_at
  )
  returning id into v_verification_id;

  return query select p_auth_user_id, v_tenant_id, v_verification_id;
end;
$$;

revoke all on function public.self_serve_signup_with_auth(uuid, text, text, text, uuid, public.billing_cycle, text, timestamptz)
  from public, anon, authenticated, tenant_app;
grant execute on function public.self_serve_signup_with_auth(uuid, text, text, text, uuid, public.billing_cycle, text, timestamptz)
  to service_role;

comment on function public.self_serve_signup_with_auth(uuid, text, text, text, uuid, public.billing_cycle, text, timestamptz) is
  'Self-serve signup on the Auth path. The caller creates the auth.users identity, then this attaches the workspace, membership, plan selection and verification token in one transaction. Supersedes self_serve_signup, which cannot satisfy users_id_fkey. See 20260912330000.';
