-- SA-5.1 hotfix for databases that applied 20260830010100 before this correction.
-- RETURNS TABLE creates PL/pgSQL variables named user_id/tenant_id/email. Qualifying the
-- table columns prevents PostgreSQL from treating `user_id` as ambiguous at verification time.

create or replace function public.complete_signup_email_verification(p_token_hash text)
returns table(user_id uuid, tenant_id uuid, email text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_token public.user_invitations%rowtype;
  v_tenant_id uuid;
  v_email text;
begin
  select invitation.*
    into v_token
    from public.user_invitations invitation
   where invitation.token_hash = p_token_hash
     and invitation.purpose = 'email_verification'
     and invitation.accepted_at is null
     and invitation.expires_at > now()
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'VERIFICATION_INVALID_OR_EXPIRED';
  end if;

  select membership.tenant_id
    into v_tenant_id
    from public.tenant_users membership
   where membership.user_id = v_token.user_id
     and membership.role = 'owner'
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'OWNER_MEMBERSHIP_NOT_FOUND';
  end if;

  update public.users as account
     set status = 'active'
   where account.id = v_token.user_id
     and account.status = 'pending_verification'
  returning account.email into v_email;

  if not found then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_NOT_PENDING_VERIFICATION';
  end if;

  update public.user_invitations as invitation
     set accepted_at = now()
   where invitation.user_id = v_token.user_id
     and invitation.purpose = 'email_verification'
     and invitation.accepted_at is null;

  update public.tenant_users as membership
     set accepted_at = coalesce(membership.accepted_at, now())
   where membership.user_id = v_token.user_id
     and membership.tenant_id = v_tenant_id;

  update public.tenants as tenant
     set onboarding_state = 'business_profile'
   where tenant.id = v_tenant_id
     and tenant.onboarding_state = 'pending_verification';

  return query select v_token.user_id, v_tenant_id, v_email;
end;
$$;

revoke execute on function public.complete_signup_email_verification(text)
  from public, anon, authenticated;
grant execute on function public.complete_signup_email_verification(text)
  to service_role;
