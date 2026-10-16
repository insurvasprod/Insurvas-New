-- Remove the hand-entered (LA-0.7) test statements from the demo agency "Advance Team (QA demo)"
-- (tenant "LA-1.25 Alert Demo"), so the Commission ledger, Discrepancies and Statements show only
-- what the carrier files did.
--
-- Removed: the 20 imported statements, their 182 lines, their 158 policy matches and the 23
-- findings raised from them.
-- Kept: the 120 hand-entered policies (Policies › Entered by hand), the saved column mappings for
-- the statement import, and everything from the carrier files (LA-4).
-- None of these tables refuses a delete, so no guard is switched off. Any mismatch raises and the
-- WHOLE script rolls back.
begin;

do $$
declare
  v_t constant uuid := 'd6f3950f-0d88-4e66-869f-0de2ea6b396b';
  v_hand_policies bigint;
  v_carrier_lines bigint;
  n bigint;
  v_left text;
begin
  if (select name from public.tenants where id = v_t) is distinct from 'LA-1.25 Alert Demo' then
    raise exception 'remove: % is not the demo agency; nothing changed', v_t;
  end if;
  select count(*) into v_hand_policies from public.tenant_policies where tenant_id = v_t;
  select count(*) into v_carrier_lines from public.commission_entry where tenant_id = v_t;

  delete from public.tenant_commission_discrepancies where tenant_id = v_t;
  delete from public.tenant_commission_statement_matches where tenant_id = v_t;
  delete from public.tenant_commission_statement_lines where tenant_id = v_t;
  -- A re-read statement points at the one it replaced, so delete the newest first.
  loop
    delete from public.tenant_commission_statements s
     where s.tenant_id = v_t
       and not exists (select 1 from public.tenant_commission_statements r where r.reprocessed_from = s.id);
    get diagnostics n = row_count;
    exit when n = 0;
  end loop;

  select string_agg(t || ' ' || c, ', ') into v_left from (
    select 'statements' t, count(*) c from public.tenant_commission_statements where tenant_id = v_t
    union all select 'lines', count(*) from public.tenant_commission_statement_lines where tenant_id = v_t
    union all select 'matches', count(*) from public.tenant_commission_statement_matches where tenant_id = v_t
    union all select 'findings', count(*) from public.tenant_commission_discrepancies where tenant_id = v_t
  ) x where c > 0;
  if v_left is not null then raise exception 'remove: left behind (%); rolled back', v_left; end if;

  if (select count(*) from public.tenant_policies where tenant_id = v_t) <> v_hand_policies then
    raise exception 'remove: hand-entered policies changed; rolled back';
  end if;
  if (select count(*) from public.commission_entry where tenant_id = v_t) <> v_carrier_lines then
    raise exception 'remove: carrier-file ledger lines changed; rolled back';
  end if;
end $$;

-- Should read: 0 statements, 0 lines, 0 findings, 120 hand policies, and the carrier-file lines unchanged.
select
  (select count(*) from public.tenant_commission_statements where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as statements,
  (select count(*) from public.tenant_commission_statement_lines where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as lines,
  (select count(*) from public.tenant_commission_discrepancies where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as findings,
  (select count(*) from public.tenant_policies where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as hand_policies,
  (select count(*) from public.commission_entry where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as carrier_lines;

commit;
