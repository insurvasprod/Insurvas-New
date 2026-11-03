-- LA-1.2: let the partner lifecycle functions work against the live columns.
--
-- `partners.status`, `partners.partner_type` and `partner_users.status` are `text` in this database
-- and enum-typed in this repository. Postgres has no `text = partner_status` operator, so
-- `transition_partner` and `partner_set_user_status_with_limit` fail before they do anything, taking
-- six LA-1.2 acceptance criteria with them: deactivation, reactivation, offboarding, the atomic
-- revoke, the session rejection that follows it, and the audit assertions.
--
-- Converting the columns to the enums was the first instinct and it is wrong. Checked on
-- 2026-09-12: `partners.status` defaults to 'onboarding' and `partner_users.status` defaults to
-- 'invited', and NEITHER value exists in the enum. Those are lifecycle states the organizations-era
-- product uses and this one does not model. Converting would make every insert that relies on those
-- defaults fail, in the other application, immediately.
--
-- So the functions move to text instead. This gives up enum checking on these two parameters. The
-- transition table below is what actually constrains the values, and it is unchanged, so an invalid
-- status is still refused -- just by an explicit check rather than by the type system.
--
-- Both need a DROP first: changing a parameter type creates an overload rather than replacing, and
-- partner_set_user_status_with_limit also changes its return type, which CREATE OR REPLACE forbids.
--
-- The proper fix remains separating the SaaS partner tables, the way SA-3 separated the invoice
-- tables. Until that is decided, this keeps both products working.

drop function if exists public.partner_set_user_status_with_limit(uuid, uuid, uuid, public.partner_user_status, integer);

create function public.partner_set_user_status_with_limit(
  p_tenant_id uuid,
  p_partner_id uuid,
  p_user_id uuid,
  p_status text,
  p_max_partner_users integer default null
)
returns table(old_status text, new_status text)
language plpgsql
set search_path to 'public'
as $function$
declare
  v_old text;
  v_count integer;
begin
  -- The enum no longer guards this, so the values are checked explicitly.
  if p_status not in ('active', 'revoked') then
    raise exception 'invalid_partner_user_status:%', p_status;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  perform 1 from partners where id = p_partner_id and tenant_id = p_tenant_id and status = 'active' for update;
  if not found then raise exception 'partner_not_found_or_offboarded'; end if;

  select status into v_old from partner_users
   where tenant_id = p_tenant_id and partner_id = p_partner_id and user_id = p_user_id for update;
  if not found then raise exception 'partner_user_not_found'; end if;
  if v_old = p_status then raise exception 'partner_user_already_in_state'; end if;

  if p_status = 'active' then
    select count(*)::integer into v_count
      from partner_users pu
      join partners p on p.id = pu.partner_id
     where pu.tenant_id = p_tenant_id
       and pu.status = 'active'
       and p.status = 'active'
       and not (pu.partner_id = p_partner_id and pu.user_id = p_user_id);
    if p_max_partner_users is not null and v_count >= p_max_partner_users then
      raise exception 'partner_user_limit_reached:max_partner_users:%:%', v_count, p_max_partner_users;
    end if;
  end if;

  update partner_users
     set status = p_status,
         revoked_at = case when p_status = 'revoked' then coalesce(revoked_at, now()) else null end,
         deactivated_at = case when p_status = 'revoked' then coalesce(deactivated_at, now()) else null end
   where tenant_id = p_tenant_id and partner_id = p_partner_id and user_id = p_user_id;

  return query select v_old, p_status;
end;
$function$;

drop function if exists public.transition_partner(uuid, uuid, public.partner_status, text);

create function public.transition_partner(
  p_tenant_id uuid,
  p_partner_id uuid,
  p_next_status text,
  p_confirmation text default null
)
returns public.partners
language plpgsql
set search_path to 'public'
as $function$
declare
  v_row public.partners;
begin
  if p_next_status not in ('draft', 'active', 'paused', 'offboarded') then
    raise exception 'invalid_partner_status:%', p_next_status;
  end if;

  select * into v_row from public.partners where id = p_partner_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'partner_not_found'; end if;
  if v_row.status = 'offboarded' then raise exception 'partner_already_offboarded'; end if;
  if p_next_status = 'offboarded' and coalesce(p_confirmation, '') <> 'OFFBOARD' then
    raise exception 'offboard_confirmation_required';
  end if;

  -- The transition table, unchanged. This is what constrains the value now that the enum does not.
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
       set status = 'revoked',
           revoked_at = coalesce(revoked_at, now()),
           deactivated_at = coalesce(deactivated_at, now())
     where tenant_id = p_tenant_id and partner_id = p_partner_id and status <> 'revoked';
  end if;

  return v_row;
end;
$function$;

revoke all on function public.partner_set_user_status_with_limit(uuid, uuid, uuid, text, integer)
  from public, anon, authenticated, tenant_app;
grant execute on function public.partner_set_user_status_with_limit(uuid, uuid, uuid, text, integer)
  to service_role;

revoke all on function public.transition_partner(uuid, uuid, text, text)
  from public, anon, authenticated, tenant_app;
grant execute on function public.transition_partner(uuid, uuid, text, text)
  to service_role;
