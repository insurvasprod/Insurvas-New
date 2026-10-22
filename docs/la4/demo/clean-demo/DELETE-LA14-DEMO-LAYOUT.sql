-- Delete the layout "Demo — LA14 Market commission file" (demo_la14_commissions, v1) from Staff ›
-- Layout maps, with its 9 columns and its LA14 commissions assignment. Left over from the old LA14 demo;
-- no file was ever read with it. Every other layout stays.
-- A published layout refuses deletes by design, so the two layout guards are switched off for this
-- transaction only and back on before it ends. Any mismatch raises and the WHOLE script rolls back.
begin;

do $$
declare
  v_map constant uuid := '09bb363c-1ae5-424d-bcdb-cf1a99824550';
  n bigint;
begin
  if (select layout_key from public.carrier_layout_map where id = v_map) is distinct from 'demo_la14_commissions' then
    raise exception 'delete: % is not the LA14 demo layout; nothing changed', v_map;
  end if;
  if (select count(*) from public.carrier_layout_map where layout_key = 'demo_la14_commissions') <> 1 then
    raise exception 'delete: the LA14 demo layout has more than one version; nothing changed';
  end if;
  if exists (select 1 from public.file_registry where parser_id = v_map) or exists (select 1 from public.agent_findings where map_id = v_map) then
    raise exception 'delete: a carrier file was read with this layout; nothing changed';
  end if;

  alter table public.carrier_layout_map disable trigger carrier_layout_map_guard;
  alter table public.carrier_layout_map_entry disable trigger carrier_layout_map_entry_guard;

  delete from public.carrier_layout_assignment where layout_key = 'demo_la14_commissions';
  get diagnostics n = row_count; if n <> 1 then raise exception 'delete: expected 1 assignment, found %', n; end if;
  delete from public.carrier_layout_map_entry where map_id = v_map;
  get diagnostics n = row_count; if n <> 9 then raise exception 'delete: expected 9 columns, found %', n; end if;
  delete from public.carrier_layout_map where id = v_map;
  get diagnostics n = row_count; if n <> 1 then raise exception 'delete: the layout was not removed'; end if;

  alter table public.carrier_layout_map enable trigger carrier_layout_map_guard;
  alter table public.carrier_layout_map_entry enable trigger carrier_layout_map_entry_guard;

  if (select count(*) from public.carrier_layout_map) <> 17 then
    raise exception 'delete: expected 17 layouts left; rolled back';
  end if;
  select count(*) into n from pg_trigger where not tgisinternal and tgenabled <> 'O';
  if n > 0 then raise exception 'delete: % trigger(s) still off; rolled back', n; end if;
end $$;

-- Should read: 17 layouts, 0 LA14 demo layouts, 17 assignments, 0 triggers off.
select
  (select count(*) from public.carrier_layout_map) as layouts,
  (select count(*) from public.carrier_layout_map where layout_key = 'demo_la14_commissions') as la14_demo_layouts,
  (select count(*) from public.carrier_layout_assignment) as assignments,
  (select count(*) from pg_trigger where not tgisinternal and tgenabled <> 'O') as triggers_off;

commit;
