-- LA-0.2 follow-up: tenant-created invitations cannot populate user_invitations.created_by,
-- whose legacy foreign key points to admin_users. Keep the tenant actor in audit_log instead.

create or replace function public.tenant_invite_user(
  p_name text,
  p_email text,
  p_role public.tenant_user_role,
  p_tenant_id uuid,
  p_token_hash text,
  p_expires_at timestamptz,
  p_created_by uuid
)
returns table(user_id uuid, tenant_id uuid)
language plpgsql
as $$
declare
  v_user_id uuid;
begin
  if p_tenant_id is null then
    raise exception 'tenant_required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'tenant_not_found' using errcode = 'P0002';
  end if;

  insert into public.users (name, email, status)
  values (btrim(p_name), lower(btrim(p_email)), 'active')
  returning id into v_user_id;

  insert into public.tenant_users (tenant_id, user_id, role, accepted_at)
  values (p_tenant_id, v_user_id, p_role, null);

  insert into public.user_invitations (user_id, token_hash, expires_at, created_by, purpose)
  values (v_user_id, p_token_hash, p_expires_at, null, 'invite');

  return query select v_user_id, p_tenant_id;
end;
$$;

revoke execute on function public.tenant_invite_user(text, text, public.tenant_user_role, uuid, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.tenant_invite_user(text, text, public.tenant_user_role, uuid, text, timestamptz, uuid) to service_role;
