-- LA-1.2 follow-up: qualify the partner lookup in the invite RPC. The function returns a
-- tenant_id column, so an unqualified tenant_id in PL/pgSQL is ambiguous at execution time.
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

revoke all on function public.partner_invite_user(uuid, uuid, text, text, public.partner_user_role, text, timestamptz)
  from public, anon, authenticated, tenant_app;
grant execute on function public.partner_invite_user(uuid, uuid, text, text, public.partner_user_role, text, timestamptz)
  to service_role;
