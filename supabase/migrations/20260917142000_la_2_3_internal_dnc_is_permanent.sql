-- LA-2.3 criterion 3: "'Do not call' adds the number permanently, and a later import of it is
-- rejected at scrub."
--
-- The second half worked. The first half did not, and the reason is that the tenant's own
-- do-not-call list lives in a different table from every other suppression list:
--
--   public.tenant_suppression_list   federal DNC, state DNC, TCPA litigator, invalid
--                                    → `tenant_suppression_list_permanent` refuses DELETE and
--                                      refuses UPDATE of phone_digits/list_type/tenant_id
--
--   public.tenant_do_not_call        the internal list, written by the "do not call" disposition
--                                    → one trigger, and it only touches `updated_at`
--
-- `is_phone_suppressed` reads both, and it filters the second on `is_active`. So a number that Ray
-- promised never to call again becomes dialable the moment that flag is cleared, and nothing in the
-- database stops it: `tenant_app` holds `update` on the table and the tenant-scoped RLS policy is
-- `for all`, so an ordinary session can do it within its own tenant.
--
-- Nothing in the product does this today — every write is an upsert that touches only `lead_id`,
-- `added_by` and `updated_at`, and no code path anywhere sets `is_active = false`. That is what
-- makes this worth closing rather than arguing about: the capability is open by accident, not by
-- design, so no feature is lost by removing it.
--
-- The earlier audit recorded this as an open product question — "the spec says a do-not-call entry
-- is permanent; the column allows deactivation; one of the two is wrong". The task page decides it
-- twice over: the suppression table lists the internal list as "Never dialable / Overridable: No",
-- and the in-scope bullet says the internal list is "permanent". So the column is wrong, and this
-- migration makes the table agree with the criterion.
--
-- `is_active` is kept rather than dropped. It is read by the unique index
-- `tenant_do_not_call_active_phone_idx` and by the existing `on conflict ... where is_active`
-- upserts, and dropping it would rewrite five call sites to fix a flag that can no longer change.

create or replace function public.prevent_internal_dnc_removal()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'suppression_permanent: % cannot be removed from the do-not-call list. A do-not-call request is permanent by design; if this is genuinely wrong, it takes a migration.', old.phone_digits
      using errcode = 'check_violation';
  end if;

  -- Re-suppressing an already suppressed number is fine, and so is correcting the note or the lead
  -- it came from. Only the transition that makes a suppressed number dialable again is refused.
  if old.is_active and not new.is_active then
    raise exception 'suppression_permanent: % cannot be reactivated for dialing. A do-not-call request is permanent by design.', old.phone_digits
      using errcode = 'check_violation';
  end if;

  if new.phone_digits is distinct from old.phone_digits
     or new.tenant_id is distinct from old.tenant_id then
    raise exception 'suppression_permanent: the number or owner of a do-not-call entry cannot be changed (%). Add a new entry instead.', old.phone_digits
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$;

drop trigger if exists tenant_do_not_call_permanent on public.tenant_do_not_call;
create trigger tenant_do_not_call_permanent
  before delete or update of is_active, phone_digits, tenant_id
  on public.tenant_do_not_call
  for each row execute function public.prevent_internal_dnc_removal();

-- ── the criterion, asserted ────────────────────────────────────────────────
do $$
declare
  v_tenant uuid;
  v_digits text := '2065550' || lpad((floor(random() * 1000))::int::text, 3, '0');
  v_blocked boolean;
  v_id uuid;
begin
  select id into v_tenant from public.tenants order by created_at limit 1;
  if v_tenant is null then
    raise notice 'LA-2.3 permanence check skipped: no tenant in this database';
    return;
  end if;

  insert into public.tenant_do_not_call (tenant_id, phone_digits, reason)
    values (v_tenant, v_digits, 'LA-2.3 permanence check')
    returning id into v_id;

  -- Deactivation must be refused.
  v_blocked := false;
  begin
    update public.tenant_do_not_call set is_active = false where id = v_id;
  exception when check_violation then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'LA-2.3: a do-not-call entry could be deactivated, so it is not permanent';
  end if;

  -- Deletion must be refused.
  v_blocked := false;
  begin
    delete from public.tenant_do_not_call where id = v_id;
  exception when check_violation then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'LA-2.3: a do-not-call entry could be deleted, so it is not permanent';
  end if;

  -- The upsert the disposition path uses must still work. A permanence rule that broke
  -- re-suppression would stop the "do not call" disposition recording anything at all, which is a
  -- worse failure than the one being fixed.
  insert into public.tenant_do_not_call (tenant_id, phone_digits, reason)
    values (v_tenant, v_digits, 'LA-2.3 permanence check, again')
    on conflict (tenant_id, phone_digits) where is_active
      do update set updated_at = now();

  if not public.is_tenant_phone_suppressed(v_tenant, v_digits) then
    raise exception 'LA-2.3: the number is no longer suppressed after a re-suppression upsert';
  end if;

  -- Clean up the fixture. The trigger refuses an ordinary delete by design, so it is disabled for
  -- this statement only, inside this transaction.
  alter table public.tenant_do_not_call disable trigger tenant_do_not_call_permanent;
  delete from public.tenant_do_not_call where id = v_id;
  alter table public.tenant_do_not_call enable trigger tenant_do_not_call_permanent;

  raise notice 'LA-2.3 permanence check passed: deactivation and deletion refused, re-suppression still works';
end $$;
