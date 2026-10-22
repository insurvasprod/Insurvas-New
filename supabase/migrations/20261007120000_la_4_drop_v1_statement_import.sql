-- LA-4 follow-up · drop the LA-0 statement import, now that every import goes through v2.
--
-- import_commission_statement (20260924260100) was kept as the fallback while migration
-- 20261002100000 (LA-4.1–4.3: stored originals, PDFs, name matching, re-processing) was not yet
-- applied. That migration has been live since 2026-10-02 and the app no longer calls the v1
-- function (lib/ledger/statementService.ts importStatementFile), so it is removed: one import path,
-- the one that keeps the original file.
--
-- Nothing else uses it: decide_commission_statement_lines, the void path and the views do not
-- call it. Every statement it ever wrote stays exactly as it is.
--
-- Rollback: re-run the import_commission_statement block and its grants from 20260924260100.

drop function if exists public.import_commission_statement(uuid, uuid, uuid, date, date, text, text, jsonb, jsonb, jsonb);

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'import_commission_statement') then
    raise exception '20261007120000: import_commission_statement is still there';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'import_commission_statement_v2') then
    raise exception '20261007120000: import_commission_statement_v2 is missing; do not drop v1 without it';
  end if;
end $$;
