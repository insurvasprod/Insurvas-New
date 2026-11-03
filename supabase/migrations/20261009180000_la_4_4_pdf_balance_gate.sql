-- LA-4.4 · the balance gate for PDF statements (2026-10-09). The spec: "line amounts must add up to
-- the statement totals, or the file is flagged" — exactly, not within a tolerance — and opening +
-- activity = closing, checked on its own. A statement that fails is marked failed with the computed
-- sum, the stated total and the difference, and nothing is written past its raw rows.
--
-- The PDF layout now names where each statement states its total (and its balances): the reader
-- (lib/ingestion/pdfLayout.ts) brings the total in as the statement's total row, which the layout
-- map checks the lines against, and refuses a statement whose own balances don't add up.
--
-- Published layouts are frozen, so each PDF carrier gets a new version, IN REVIEW, published by
-- staff after reading it: ssl_statement_pdf, americo_statement_pdf, corebridge_statement_pdf. Its columns are copied from the version before; only
-- pdf_layout changes. GENERATED from scripts/la4-bucket-layouts.mjs (LATER_VERSIONS);
-- lib/ingestion/bucketLayouts.test.mjs reads the samples with exactly these layouts.
--
-- Rollback: delete these in-review versions by layout_key and version (their entries cascade).

do $$
declare
  v_from public.carrier_layout_map%rowtype;
  v_map uuid;
begin
  -- Sentinel Security Life Statement_<n> (PDF), version 3
  select * into v_from from public.carrier_layout_map where tenant_id is null and layout_key = 'ssl_statement_pdf' and status = 'published' order by version desc limit 1;
  if v_from.id is null then raise exception '20261009180000: ssl_statement_pdf has no published version'; end if;
  if v_from.version <> 2 then raise exception '20261009180000: ssl_statement_pdf is at version %, expected 2', v_from.version; end if;
  if not exists (select 1 from public.carrier_layout_map where tenant_id is null and layout_key = 'ssl_statement_pdf' and version = 3) then
    insert into public.carrier_layout_map (tenant_id, layout_key, name, file_type, version, status, header_row_index, sheet_name, row_count_swing_pct, total_row_column, total_row_value, pdf_layout, proposal_source)
    values (null, 'ssl_statement_pdf', v_from.name, v_from.file_type, 3, 'in_review', v_from.header_row_index, v_from.sheet_name, v_from.row_count_swing_pct, v_from.total_row_column, v_from.total_row_value,
            '{"start":"MANUAL ADJUSTMENTS","stop":["TOTAL MANUAL ADJUSTMENTS"],"columns":[{"name":"Policy #","x":40},{"name":"Name","x":75},{"name":"Plan Code","x":105},{"name":"Adjustment Type","x":125},{"name":"Adjustment Description","x":170},{"name":"(+/-) Adjustment Amount","x":260}],"rowStart":{"column":"Adjustment Type","pattern":"^[A-Z]{1,4}$"},"total":{"label":"TOTAL MANUAL ADJUSTMENTS","column":"(+/-) Adjustment Amount"},"balance":{"opening":{"label":"Beginning Commission Balance:"},"activity":{"label":"Total Commissions:","after":"SUMMARY TOTALS"},"closing":{"label":"Ending Balance:"}}}'::jsonb, 'manual')
    returning id into v_map;
    insert into public.carrier_layout_map_entry (map_id, source_column, target_field, data_type, transform, required, sort_order, enum_values)
    select v_map, e.source_column, e.target_field, e.data_type, e.transform, e.required, e.sort_order, e.enum_values
      from public.carrier_layout_map_entry e where e.map_id = v_from.id;
  end if;

  -- Americo Commissions - Statements - Agent Portal (PDF), version 2
  select * into v_from from public.carrier_layout_map where tenant_id is null and layout_key = 'americo_statement_pdf' and status = 'published' order by version desc limit 1;
  if v_from.id is null then raise exception '20261009180000: americo_statement_pdf has no published version'; end if;
  if v_from.version <> 1 then raise exception '20261009180000: americo_statement_pdf is at version %, expected 1', v_from.version; end if;
  if not exists (select 1 from public.carrier_layout_map where tenant_id is null and layout_key = 'americo_statement_pdf' and version = 2) then
    insert into public.carrier_layout_map (tenant_id, layout_key, name, file_type, version, status, header_row_index, sheet_name, row_count_swing_pct, total_row_column, total_row_value, pdf_layout, proposal_source)
    values (null, 'americo_statement_pdf', v_from.name, v_from.file_type, 2, 'in_review', v_from.header_row_index, v_from.sheet_name, v_from.row_count_swing_pct, v_from.total_row_column, v_from.total_row_value,
            '{"start":"OVERRIDE ACTIVITY","stop":["TOTAL PAY BASIS"],"columns":[{"name":"Policy Number","x":30},{"name":"Name/Desc","x":100},{"name":"Issue Age","x":170},{"name":"Eff. Date","x":210},{"name":"Plan","x":255},{"name":"TRDT","x":295},{"name":"PRDT","x":335},{"name":"Months","x":370},{"name":"DU PRO LV","x":410},{"name":"Base Amount","x":465},{"name":"TRX","x":520},{"name":"Rate","x":560},{"name":"Split","x":600},{"name":"Amt Acct","x":635},{"name":"Primary Balance","x":680}],"rowStart":{"column":"Policy Number","pattern":"^[A-Z]{2}\\d{6,}$"},"continuation":[{"name":"Agent Code","x":115},{"name":"Agent Name","x":155}],"total":{"label":"PRIMARY BALANCE TOTAL","column":"Primary Balance"},"balance":{"opening":{"label":"Primary","after":"Account Balances","nth":0},"activity":{"label":"Primary","after":"Account Balances","nth":1},"closing":{"label":"Primary","after":"Account Balances","nth":2}}}'::jsonb, 'manual')
    returning id into v_map;
    insert into public.carrier_layout_map_entry (map_id, source_column, target_field, data_type, transform, required, sort_order, enum_values)
    select v_map, e.source_column, e.target_field, e.data_type, e.transform, e.required, e.sort_order, e.enum_values
      from public.carrier_layout_map_entry e where e.map_id = v_from.id;
  end if;

  -- Corebridge view_statements (PDF, weekly), version 2
  select * into v_from from public.carrier_layout_map where tenant_id is null and layout_key = 'corebridge_statement_pdf' and status = 'published' order by version desc limit 1;
  if v_from.id is null then raise exception '20261009180000: corebridge_statement_pdf has no published version'; end if;
  if v_from.version <> 1 then raise exception '20261009180000: corebridge_statement_pdf is at version %, expected 1', v_from.version; end if;
  if not exists (select 1 from public.carrier_layout_map where tenant_id is null and layout_key = 'corebridge_statement_pdf' and version = 2) then
    insert into public.carrier_layout_map (tenant_id, layout_key, name, file_type, version, status, header_row_index, sheet_name, row_count_swing_pct, total_row_column, total_row_value, pdf_layout, proposal_source)
    values (null, 'corebridge_statement_pdf', v_from.name, v_from.file_type, 2, 'in_review', v_from.header_row_index, v_from.sheet_name, v_from.row_count_swing_pct, v_from.total_row_column, v_from.total_row_value,
            '{"start":"TRANSACTION DETAIL","stop":["TOTAL ADVANCES PAID"],"columns":[{"name":"CO","x":30},{"name":"POLICY","x":51},{"name":"INSURED","x":101},{"name":"EFF DATE","x":156},{"name":"AGENT#","x":198},{"name":"COMM TYPE","x":232},{"name":"ANNUAL PREM","x":292},{"name":"PREM PAID","x":345},{"name":"SPLIT","x":392},{"name":"SPLIT PREM","x":425},{"name":"ADV","x":470},{"name":"COMM RATE","x":495},{"name":"OUTSTANDING ADV BAL","x":538},{"name":"ACTIVITY","x":615}],"rowStart":{"column":"CO","pattern":"^[A-Z]{3}$"},"total":{"label":"TOTAL ADVANCES PAID","column":"ACTIVITY"},"balance":{"opening":{"label":"PRIOR ACCOUNT BALANCE"},"activity":{"label":"COMMISSIONS CURRENT PERIOD"},"closing":{"label":"ENDING ACCOUNT BALANCE"}}}'::jsonb, 'manual')
    returning id into v_map;
    insert into public.carrier_layout_map_entry (map_id, source_column, target_field, data_type, transform, required, sort_order, enum_values)
    select v_map, e.source_column, e.target_field, e.data_type, e.transform, e.required, e.sort_order, e.enum_values
      from public.carrier_layout_map_entry e where e.map_id = v_from.id;
  end if;
end $$;

-- ─── self-check ────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from public.carrier_layout_map
       where tenant_id is null and pdf_layout ? 'total' and pdf_layout ? 'balance'
         and (layout_key, version) in (('ssl_statement_pdf', 3), ('americo_statement_pdf', 2), ('corebridge_statement_pdf', 2))) <> 3 then
    raise exception '20261009180000: not every PDF layout names its total and balances';
  end if;
  if exists (select 1 from public.carrier_layout_map m
              where m.tenant_id is null and (m.layout_key, m.version) in (('ssl_statement_pdf', 3), ('americo_statement_pdf', 2), ('corebridge_statement_pdf', 2))
                and (select count(*) from public.carrier_layout_map_entry e where e.map_id = m.id) = 0) then
    raise exception '20261009180000: a new version has no columns';
  end if;
end $$;
