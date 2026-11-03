-- Rinor's American Amicable policy 0118800007 in the demo agency "LA-1.25 Alert Demo".
-- When the carrier file closed the application as issued (2026-10-13), the layout did not read the
-- carrier's issue date yet, so the deal's issued policy took the file's date (Oct 13). Layout v2 now
-- reads PolicyDate as the issue date, and the book shows Aug 16, 2026. This copies that date onto
-- the deal's issued policy. It reads the date from the book; nothing is typed in.
-- Any mismatch raises and the WHOLE script rolls back.
begin;

do $$
declare
  v_t       constant uuid := 'd6f3950f-0d88-4e66-869f-0de2ea6b396b';
  v_carrier constant uuid := '5bd2ff41-fd83-485e-9373-9ada7a0aa3c7';  -- American Amicable
  v_policy  constant uuid := '3613ae4b-36ff-4416-a6a2-dc67e8474d57';  -- tenant_issued_policies row
  v_issue   date;
  n bigint;
begin
  if (select name from public.tenants where id = v_t) is distinct from 'LA-1.25 Alert Demo' then
    raise exception 'fix: % is not the demo agency; nothing changed', v_t;
  end if;
  select issue_date into v_issue from public.policy_current
   where tenant_id = v_t and carrier_id = v_carrier and policy_number = '0118800007';
  if v_issue is null then
    raise exception 'fix: the book has no issue date for 0118800007 (re-read the file with layout v2 first); nothing changed';
  end if;
  if not exists (select 1 from public.tenant_issued_policies
                  where tenant_id = v_t and id = v_policy and policy_number = '0118800007' and carrier = 'American Amicable') then
    raise exception 'fix: the issued policy row is not there; nothing changed';
  end if;
  update public.tenant_issued_policies
     set issued_at = v_issue::timestamptz, updated_at = now()
   where tenant_id = v_t and id = v_policy and issued_at::date <> v_issue
     and (lapsed_at is null or lapsed_at >= v_issue::timestamptz);
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'fix: expected to change 1 row, changed % (already fixed?); rolled back', n; end if;
end $$;

-- Should read: issued_on 2026-08-16, book_issue_date 2026-08-16.
select ip.issued_at::date as issued_on,
       (select issue_date from public.policy_current
         where tenant_id = ip.tenant_id and carrier_id = '5bd2ff41-fd83-485e-9373-9ada7a0aa3c7' and policy_number = '0118800007') as book_issue_date
  from public.tenant_issued_policies ip
 where ip.id = '3613ae4b-36ff-4416-a6a2-dc67e8474d57';

commit;
