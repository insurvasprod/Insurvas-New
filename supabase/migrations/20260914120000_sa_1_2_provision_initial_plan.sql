-- SA-1.2 · Provision a new tenant with its first owner and initial plan.
--
-- This is intentionally a separate additive RPC. Existing-tenant invitations continue to use
-- admin_attach_user_to_tenant, while the new-tenant path can atomically create the tenant,
-- membership, invitation, and first subscription. The route compensates for the Auth boundary
-- if this function fails by deleting the just-created Auth identity.

create or replace function public.admin_attach_user_to_tenant_with_plan(
  p_user_id         uuid,
  p_name            text,
  p_email           text,
  p_phone           text,
  p_tenant_id       uuid,
  p_new_tenant_name text,
  p_role            text,
  p_plan_id         uuid,
  p_token_hash      text,
  p_expires_at      timestamptz,
  p_created_by      uuid
)
returns table (user_id uuid, tenant_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant uuid;
begin
  if p_tenant_id is not null
     or nullif(btrim(coalesce(p_new_tenant_name, '')), '') is null then
    raise exception 'new_tenant_required' using errcode = 'check_violation';
  end if;

  if p_plan_id is null then
    raise exception 'plan_required' using errcode = 'check_violation';
  end if;

  if not exists (select 1 from public.users u where u.id = p_user_id) then
    raise exception 'user_not_provisioned' using errcode = 'no_data_found';
  end if;

  if exists (
    select 1
      from public.users u
     where lower(u.email) = lower(p_email)
       and u.id <> p_user_id
  ) then
    raise exception 'EMAIL_ALREADY_REGISTERED' using errcode = 'unique_violation';
  end if;

  -- The plan assignment below validates that this is an existing, non-archived, sellable plan
  -- and creates either an active or trialing subscription according to its configured trial.
  insert into public.tenants (name, status, onboarding_state)
  values (btrim(p_new_tenant_name), 'active', 'pending')
  returning id into v_tenant;

  update public.users
     set name   = coalesce(nullif(btrim(p_name), ''), name),
         email  = lower(btrim(p_email)),
         phone  = p_phone,
         status = case when status = 'deleted' then status else 'pending_verification' end
   where id = p_user_id;

  insert into public.tenant_users (tenant_id, user_id, role)
  values (v_tenant, p_user_id, 'owner'::public.tenant_user_role)
  on conflict on constraint tenant_users_pkey do update
    set role = excluded.role;

  insert into public.user_invitations (user_id, purpose, token_hash, expires_at, created_by)
  values (p_user_id, 'invite', p_token_hash, p_expires_at, p_created_by);

  perform public.admin_assign_subscription(v_tenant, p_plan_id, 'monthly', now());

  return query select p_user_id, v_tenant;
end;
$$;

comment on function public.admin_attach_user_to_tenant_with_plan(uuid, text, text, text, uuid, text, text, uuid, text, timestamptz, uuid) is
  'SA-1.2 · Atomically provisions a new tenant, its first owner invitation, and initial monthly subscription.';

revoke all on function public.admin_attach_user_to_tenant_with_plan(uuid, text, text, text, uuid, text, text, uuid, text, timestamptz, uuid)
  from public, anon, authenticated, tenant_app;
grant execute on function public.admin_attach_user_to_tenant_with_plan(uuid, text, text, text, uuid, text, text, uuid, text, timestamptz, uuid)
  to service_role;
