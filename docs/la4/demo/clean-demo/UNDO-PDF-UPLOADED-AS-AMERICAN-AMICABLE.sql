-- Undo the Americo statement PDF ("Commissions - Statements - Agent Portal.pdf") uploaded on 2026-10-12
-- under the wrong carrier, American Amicable, in the demo agency "Advance Team (QA demo)".
--
-- It was never read (no PDF layout for American Amicable), but as the newest American Amicable
-- commission file of Oct 12 it marked the American Amicable CSV statement as replaced. This removes
-- the PDF's registration (and its 6 run steps) and makes the CSV statement current again. The CSV's
-- 6 ledger lines were never touched. Afterwards the same PDF can be uploaded under Americo.
-- A replaced file refuses to become current again by design, so that guard is switched off for this
-- transaction only and back on before it ends. Any mismatch raises and the WHOLE script rolls back.
begin;

do $$
declare
  v_t   constant uuid := 'd6f3950f-0d88-4e66-869f-0de2ea6b396b';
  v_pdf constant uuid := 'ebe308a7-7719-432e-b54e-39ff5b1024a4';
  v_csv constant uuid := '39a6bbc7-835e-4a62-99a7-5e244cf45707';
  n bigint;
begin
  if (select name from public.tenants where id = v_t) is distinct from 'LA-1.25 Alert Demo' then
    raise exception 'undo: % is not the demo agency; nothing changed', v_t;
  end if;
  if not exists (select 1 from public.file_registry where tenant_id = v_t and id = v_pdf and status = 'failed' and original_filename = 'Commissions - Statements - Agent Portal.pdf') then
    raise exception 'undo: the failed PDF is not there (already undone?); nothing changed';
  end if;
  if exists (select 1 from public.raw_rows where tenant_id = v_t and file_id = v_pdf) or exists (select 1 from public.commission_entry where tenant_id = v_t and file_id = v_pdf) then
    raise exception 'undo: the PDF has rows or lines after all; nothing changed';
  end if;
  if (select superseded_by_file_id from public.file_registry where tenant_id = v_t and id = v_csv) is distinct from v_pdf then
    raise exception 'undo: the CSV statement is not the one the PDF replaced; nothing changed';
  end if;

  alter table public.file_registry disable trigger file_registry_guard;

  -- The PDF goes first: only one file per carrier, type and day can be current.
  delete from public.pipeline_stage_run where tenant_id = v_t and file_id = v_pdf;
  delete from public.file_registry where tenant_id = v_t and id = v_pdf;
  get diagnostics n = row_count; if n <> 1 then raise exception 'undo: the PDF was not removed'; end if;
  update public.file_registry set superseded_by_file_id = null, superseded_at = null, status = 'parsed'
   where tenant_id = v_t and id = v_csv;
  get diagnostics n = row_count; if n <> 1 then raise exception 'undo: the CSV statement was not restored'; end if;

  set constraints all immediate;
  alter table public.file_registry enable trigger file_registry_guard;

  if (select count(*) from public.commission_entry where tenant_id = v_t and file_id = v_csv and reverses_entry_id is null) <> 6 then
    raise exception 'undo: the CSV statement does not have its 6 lines; rolled back';
  end if;
  select count(*) into n from pg_trigger where not tgisinternal and tgenabled <> 'O';
  if n > 0 then raise exception 'undo: % trigger(s) still off; rolled back', n; end if;
end $$;

-- Should read: csv_status parsed, pdf_left 0, csv_lines 6, triggers_off 0.
select
  (select status from public.file_registry where id = '39a6bbc7-835e-4a62-99a7-5e244cf45707') as csv_status,
  (select count(*) from public.file_registry where id = 'ebe308a7-7719-432e-b54e-39ff5b1024a4') as pdf_left,
  (select count(*) from public.commission_entry where file_id = '39a6bbc7-835e-4a62-99a7-5e244cf45707') as csv_lines,
  (select count(*) from pg_trigger where not tgisinternal and tgenabled <> 'O') as triggers_off;

commit;
