-- QA 2026-11-03 · "The client cancelled — the chargeback is right" is its own resolution.
--
-- A person could only dismiss a finding ('dismissed') or settle it ('resolved_by_person'). Accepting a
-- chargeback (the client really cancelled) was saved as dismissed with the reason in the note. Now
-- set_discrepancy_status takes 'accepted': the finding closes with status 'dismissed' (so the detection run
-- never reopens it while the files keep showing the chargeback) and resolution 'accepted', which the
-- Closed view and reports can tell apart from a write-off. The resolution column has no value check, so
-- only the function changes. Same signature: create or replace.
--
-- Rollback: re-run set_discrepancy_status from 20261008250000_la_4_15_commission_discrepancies.sql.

create or replace function public.set_discrepancy_status(p_tenant_id uuid, p_id uuid, p_user_id uuid, p_status text, p_note text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('open', 'dismissed', 'resolved', 'accepted') then
    raise exception 'set_discrepancy_status: a person opens, dismisses, accepts or resolves' using errcode = '22023';
  end if;
  update public.commission_discrepancy set status = case p_status when 'accepted' then 'dismissed' else p_status end,
         resolution = case p_status when 'open' then null when 'dismissed' then 'dismissed' when 'accepted' then 'accepted' else 'resolved_by_person' end,
         resolution_note = case when p_status = 'open' then null else nullif(btrim(coalesce(p_note, '')), '') end,
         resolved_by = case when p_status = 'open' then null else p_user_id end,
         resolved_at = case when p_status = 'open' then null else now() end
   where id = p_id and tenant_id = p_tenant_id and status <> 'disputed';
  return found;
end;
$$;

revoke all on function public.set_discrepancy_status(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_discrepancy_status(uuid, uuid, uuid, text, text) to service_role;

do $$
begin
  if position('''accepted''' in pg_get_functiondef('public.set_discrepancy_status(uuid, uuid, uuid, text, text)'::regprocedure)) = 0 then
    raise exception '20261103301000: set_discrepancy_status does not take accepted';
  end if;
end;
$$;
