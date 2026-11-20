-- Statement lines can match policies that arrived in CARRIER FILES (owner 2026-11-19, "fix matching").
--
-- Statement lines match tenant_policies (hand-entered / hand-imported policies, LA-0.7). A Basic or Advanced
-- agency's book arrives in carrier files (policy_current), so all its statement lines read "No policy … in your
-- book". The statement import now writes a MIRROR row for such a policy — tenant_policies with source
-- 'carrier_file', built from the carrier's latest values (lib/ledger/statementMirror.ts) — and matches the line to
-- it. The book's lists, counts, export and search leave mirrors out; the statement check judges them; the carrier
-- file check skips them (lib/ingestion/discrepancyStore.ts runDetection).
--
-- The only schema change: the source check gains 'carrier_file'. Until this runs, the database refuses the
-- mirror (23514) and the app leaves those lines unmatched, exactly as before.
--
-- Safe to run more than once. Rollback: delete the mirrors, then put the old check back:
--   delete from public.tenant_policies where source = 'carrier_file';  -- only if no accepted match points at them
--   alter table public.tenant_policies drop constraint tenant_policies_source_check;
--   alter table public.tenant_policies add constraint tenant_policies_source_check check (source in ('manual', 'csv'));

begin;

do $$
declare
  v_name text;
begin
  -- The check was declared inline (20260921…_tenant_policies), so find it by what it checks, whatever its name.
  for v_name in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.tenant_policies'::regclass
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%source%'
  loop
    execute format('alter table public.tenant_policies drop constraint %I', v_name);
  end loop;
end
$$;

alter table public.tenant_policies
  add constraint tenant_policies_source_check check (source in ('manual', 'csv', 'carrier_file'));

-- The lookups the app now makes: the mirrors of a tenant (detection) and a statement's numbers per carrier.
create index if not exists tenant_policies_carrier_file_idx
  on public.tenant_policies (tenant_id, policy_number)
  where source = 'carrier_file';

commit;

-- Check: the constraint allows the new source.
select pg_get_constraintdef(oid) as source_check
  from pg_constraint
 where conrelid = 'public.tenant_policies'::regclass and conname = 'tenant_policies_source_check';
