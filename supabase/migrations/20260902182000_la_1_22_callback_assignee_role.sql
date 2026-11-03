-- LA-1.22: callback assignees must be operational agent roles, even for direct SQL writes.

create or replace function public.enforce_callback_assignee_role()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if not exists (
    select 1
    from public.tenant_users tu
    join public.users u on u.id = tu.user_id
    where tu.tenant_id = new.tenant_id
      and tu.user_id = new.assigned_to
      and tu.role in ('owner', 'producer', 'assistant')
      and tu.accepted_at is not null
      and u.status = 'active'
  ) then
    raise exception 'CALLBACK_ASSIGNEE_ROLE_INVALID';
  end if;
  return new;
end;
$$;

drop trigger if exists callbacks_assignee_role on public.callbacks;
create trigger callbacks_assignee_role
before insert or update of tenant_id, assigned_to on public.callbacks
for each row execute function public.enforce_callback_assignee_role();

revoke all on function public.enforce_callback_assignee_role() from public, anon, authenticated, tenant_app;
