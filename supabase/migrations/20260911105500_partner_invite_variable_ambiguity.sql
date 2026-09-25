-- Qualify legacy partner columns because the RETURNS TABLE output variables
-- are also named user_id and partner_id.
create or replace function public.consume_existing_partner_invite(p_token_hash text)
returns table(user_id uuid, tenant_id uuid, partner_id uuid, accepted_at timestamptz)
language plpgsql security definer set search_path = public, pg_catalog
as $$
declare
  v_inv public.user_invitations%rowtype;
  v_partner uuid;
  v_accepted timestamptz := now();
begin
  select i.* into v_inv
  from public.user_invitations i
  where i.token_hash = p_token_hash
    and i.accepted_at is null
    and i.expires_at > now()
  order by i.created_at desc
  limit 1
  for update;
  if not found then return; end if;
  select pu.partner_id into v_partner
  from public.partner_users pu
  where pu.user_id = v_inv.user_id
    and (v_inv.tenant_id is null or pu.tenant_id = v_inv.tenant_id)
    and pu.status in ('invited', 'active')
  order by pu.created_at desc
  limit 1
  for update;
  if v_partner is null then return; end if;
  update public.user_invitations i
  set accepted_at = v_accepted
  where i.id = v_inv.id;
  update public.partner_users pu
  set accepted_at = v_accepted
  where pu.user_id = v_inv.user_id
    and pu.partner_id = v_partner;
  return query select v_inv.user_id, v_inv.tenant_id, v_partner, v_accepted;
end;
$$;

revoke all on function public.consume_existing_partner_invite(text) from public, anon, authenticated, tenant_app;
grant execute on function public.consume_existing_partner_invite(text) to service_role;
