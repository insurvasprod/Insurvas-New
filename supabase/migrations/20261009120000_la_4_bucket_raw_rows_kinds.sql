-- LA-4 bucket door, round 2 (2026-10-09) · PDF statements and Excel 2003 (.xls) workbooks keep their
-- rows too. insert_raw_rows (20261008110000) still took rows only from csv and xlsx files, so a PDF or
-- .xls file read with its layout had nowhere to put them. Found by the live bucket run on the
-- fixture agency: the files registered, then never read.
--
-- Same function, same grants; only the file kinds change.
-- Rollback: re-run the function from 20261008110000.

create or replace function public.insert_raw_rows(p_tenant_id uuid, p_file_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted integer;
begin
  if not exists (select 1 from public.file_registry where id = p_file_id and tenant_id = p_tenant_id and raw_extracted_at is null and file_kind in ('csv', 'xlsx', 'xls', 'pdf')) then
    raise exception 'That file is not waiting for its rows.' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Rows come as an array.' using errcode = '22023';
  end if;
  -- A retried chunk inserts nothing twice: the same file and line are the same raw row.
  insert into public.raw_rows (tenant_id, file_id, row_number, payload)
  select p_tenant_id, p_file_id, (r ->> 'row_number')::integer, r -> 'payload'
    from jsonb_array_elements(p_rows) r
  on conflict (file_id, row_number) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.insert_raw_rows(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.insert_raw_rows(uuid, uuid, jsonb) to service_role;

-- ─── self-check ────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if position('''xls'', ''pdf''' in pg_get_functiondef('public.insert_raw_rows(uuid, uuid, jsonb)'::regprocedure)) = 0 then
    raise exception '20261009120000: insert_raw_rows still refuses PDF and .xls rows';
  end if;
  if has_function_privilege('authenticated', 'public.insert_raw_rows(uuid, uuid, jsonb)', 'execute') then
    raise exception '20261009120000: insert_raw_rows is open to signed-in users';
  end if;
end $$;
