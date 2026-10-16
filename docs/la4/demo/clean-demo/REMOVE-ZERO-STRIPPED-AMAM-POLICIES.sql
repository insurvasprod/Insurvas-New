-- Remove the 7 American Amicable look-alike policies 118800001–118800007 from the demo agency
-- "LA-1.25 Alert Demo". They came from one file, uploaded on 2026-10-12 after Excel stripped the
-- leading zeros (file 46694258…, "4-American-Amicable-Policies.csv", dated Oct 12). The real
-- policies are 0118800001–0118800007 and stay exactly as they are.
--
-- What this does, all in one transaction:
--   1. Deletes the zero-stripped file and everything built from it: its raw rows, its run steps,
--      its finding, its matching stats, the two "already have this file" skip records, and for the
--      7 wrong numbers their snapshots, current rows, events, links and expected commission.
--   2. Deletes the one extra client it created (a provisional "GLLAREVA Rinor" from 118800007).
--      The other 6 wrong numbers had reused the real clients, which stay. The real Rinor and the
--      household stay.
--   3. Makes the earlier Oct 12 upload (file 32d4ed32…, with the correct 0118800… numbers) the
--      Oct 12 file again, as it was before the zero-stripped one replaced it, and points the
--      "Import your book" record for American Amicable at it.
-- Some tables refuse deletes by design. Their guards are switched off for this transaction only
-- and back on before it ends. Any mismatch raises and the WHOLE script rolls back.
begin;

do $$
declare
  v_t       constant uuid := 'd6f3950f-0d88-4e66-869f-0de2ea6b396b';
  v_carrier constant uuid := '5bd2ff41-fd83-485e-9373-9ada7a0aa3c7';  -- American Amicable
  v_bad     constant uuid := '46694258-9447-40e0-9958-8e6bdd33a9a6';  -- zero-stripped, Oct 12
  v_prev    constant uuid := '32d4ed32-264c-4511-abc8-261fe73dca25';  -- correct numbers, Oct 12, replaced by v_bad
  v_client  constant uuid := '1eee96ed-d51d-48c6-a73b-c09067894c6e';  -- provisional client from 118800007
  v_nums    constant text[] := array['118800001','118800002','118800003','118800004','118800005','118800006','118800007'];
  v_tables  constant text[] := array['agent_findings','policy_match_ladder','policy_match','expected_commission','policy_event','policy_current','policy_snapshot','pipeline_stage_run','file_registry_skips','raw_rows','file_registry','book_import_carrier','contacts'];
  v_guards  text[][] := '{}';
  v_g record;
  v_rel regclass;
  i integer;
  n bigint;
begin
  -- Checks first: the right agency, the right files, the right client, nothing unexpected attached.
  if (select name from public.tenants where id = v_t) is distinct from 'LA-1.25 Alert Demo' then
    raise exception 'remove: % is not the demo agency; nothing changed', v_t;
  end if;
  if not exists (select 1 from public.file_registry where tenant_id = v_t and id = v_bad and carrier_id = v_carrier
                  and file_type = 'policies' and file_date = '2026-10-12' and status = 'parsed' and superseded_by_file_id is null) then
    raise exception 'remove: the zero-stripped file is not there as the current Oct 12 file (already removed?); nothing changed';
  end if;
  if (select superseded_by_file_id from public.file_registry where tenant_id = v_t and id = v_prev) is distinct from v_bad then
    raise exception 'remove: the earlier Oct 12 file is not the one the zero-stripped file replaced; nothing changed';
  end if;
  if exists (select 1 from public.policy_snapshot where tenant_id = v_t and file_id = v_bad and not (policy_number = any(v_nums))) then
    raise exception 'remove: the zero-stripped file holds a policy outside the 7 look-alikes; nothing changed';
  end if;
  if exists (select 1 from public.policy_snapshot where tenant_id = v_t and policy_number = any(v_nums) and file_id <> v_bad) then
    raise exception 'remove: another file also lists a look-alike number; nothing changed';
  end if;
  if exists (select 1 from public.commission_entry where tenant_id = v_t and policy_number = any(v_nums))
     or exists (select 1 from public.commission_discrepancy where tenant_id = v_t and policy_number = any(v_nums))
     or exists (select 1 from public.queue_item where tenant_id = v_t and policy_number = any(v_nums))
     or exists (select 1 from public.retention_action where tenant_id = v_t and policy_number = any(v_nums))
     or exists (select 1 from public.policy_annotation where tenant_id = v_t and policy_number = any(v_nums))
     or exists (select 1 from public.policy_change where tenant_id = v_t and (policy_number = any(v_nums) or v_bad in (from_file_id, to_file_id)))
     or exists (select 1 from public.policy_match_review where tenant_id = v_t and (policy_number = any(v_nums) or file_id = v_bad))
     or exists (select 1 from public.tenant_issued_policies where tenant_id = v_t and policy_number = any(v_nums)) then
    raise exception 'remove: a look-alike number has commission, a queue item, a change row, a review or a sale on it; nothing changed';
  end if;
  if exists (select 1 from public.policy_match m where m.superseded_by_id in
              (select id from public.policy_match where tenant_id = v_t and policy_number = any(v_nums))
              and not (m.policy_number = any(v_nums))) then
    raise exception 'remove: another link points at a look-alike link; nothing changed';
  end if;
  if not exists (select 1 from public.contacts where tenant_id = v_t and id = v_client and provisional
                  and provisional_source ->> 'kind' = 'carrier_policy' and provisional_source ->> 'policy_number' = '118800007') then
    raise exception 'remove: the extra client is not the provisional one from 118800007; nothing changed';
  end if;
  if exists (select 1 from public.policy_current where tenant_id = v_t and contact_id = v_client and not (policy_number = any(v_nums)))
     or exists (select 1 from public.policy_match where tenant_id = v_t and contact_id = v_client and not (policy_number = any(v_nums)))
     or exists (select 1 from public.agent_leads where contact_id = v_client)
     or exists (select 1 from public.contacts where merged_into_id = v_client)
     or exists (select 1 from public.contact_merge_log where v_client in (kept_id, merged_id))
     or exists (select 1 from public.merge_log where v_client in (kept_id, merged_id)) then
    raise exception 'remove: the extra client is used by something else; nothing changed';
  end if;

  -- Every row trigger that fires on DELETE or UPDATE on those tables (its own, not a partition's copy).
  for v_g in select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
              where c.relnamespace = 'public'::regnamespace and c.relname = any(v_tables)
                and not t.tgisinternal and t.tgparentid = 0 and (t.tgtype & 24) <> 0 and t.tgname <> 'contacts_touch_updated_at' loop
    v_guards := v_guards || array[array[v_g.relname::text, v_g.tgname::text]];
  end loop;
  if coalesce(array_length(v_guards, 1), 0) < 4 then
    raise exception 'remove: found only % guards, expected at least 4; nothing changed', coalesce(array_length(v_guards, 1), 0);
  end if;
  for i in 1 .. array_length(v_guards, 1) loop
    execute format('alter table public.%I disable trigger %I', v_guards[i][1], v_guards[i][2]);
    for v_rel in select inhrelid::regclass from pg_inherits where inhparent = ('public.' || v_guards[i][1])::regclass loop
      execute format('alter table %s disable trigger %I', v_rel, v_guards[i][2]);
    end loop;
  end loop;

  -- 1 · the look-alike policies, each table before anything it points at.
  delete from public.agent_findings where tenant_id = v_t and file_id = v_bad;
  get diagnostics n = row_count; if n <> 1 then raise exception 'remove: % findings, expected 1', n; end if;
  delete from public.policy_match_ladder where tenant_id = v_t and file_id = v_bad;
  get diagnostics n = row_count; if n > 1 then raise exception 'remove: % ladder rows, expected 1', n; end if;
  delete from public.policy_match where tenant_id = v_t and carrier_id = v_carrier and policy_number = any(v_nums);
  get diagnostics n = row_count; if n <> 7 then raise exception 'remove: % links, expected 7', n; end if;
  delete from public.expected_commission where tenant_id = v_t and carrier_id = v_carrier and policy_number = any(v_nums);
  get diagnostics n = row_count; if n <> 7 then raise exception 'remove: % expected-commission rows, expected 7', n; end if;
  delete from public.policy_event where tenant_id = v_t and policy_number = any(v_nums) and file_id = v_bad;
  get diagnostics n = row_count; if n <> 7 then raise exception 'remove: % events, expected 7', n; end if;
  if exists (select 1 from public.policy_event where tenant_id = v_t and file_id = v_bad) then
    raise exception 'remove: the zero-stripped file still has other events';
  end if;
  delete from public.policy_current where tenant_id = v_t and carrier_id = v_carrier and policy_number = any(v_nums);
  get diagnostics n = row_count; if n <> 7 then raise exception 'remove: % current rows, expected 7', n; end if;
  delete from public.policy_snapshot where tenant_id = v_t and file_id = v_bad;
  get diagnostics n = row_count; if n <> 7 then raise exception 'remove: % snapshots, expected 7', n; end if;

  -- The file itself: its run steps, the two skip records of the same bytes, its raw rows, its registration.
  delete from public.pipeline_stage_run where tenant_id = v_t and file_id = v_bad;
  delete from public.file_registry_skips where tenant_id = v_t and original_file_id = v_bad;
  get diagnostics n = row_count; if n <> 2 then raise exception 'remove: % skip records, expected 2', n; end if;
  update public.book_import_carrier set file_id = v_prev, updated_at = now()
   where tenant_id = v_t and carrier_id = v_carrier and file_id = v_bad;
  get diagnostics n = row_count; if n <> 1 then raise exception 'remove: % import records repointed, expected 1', n; end if;
  delete from public.raw_rows where tenant_id = v_t and file_id = v_bad;
  get diagnostics n = row_count; if n <> 7 then raise exception 'remove: % raw rows, expected 7', n; end if;
  delete from public.file_registry where tenant_id = v_t and id = v_bad;
  get diagnostics n = row_count; if n <> 1 then raise exception 'remove: the file was not removed'; end if;

  -- 3 · the earlier Oct 12 upload is the Oct 12 file again (only one file per carrier, type and day is current).
  update public.file_registry set superseded_by_file_id = null, superseded_at = null, status = 'parsed'
   where tenant_id = v_t and id = v_prev;
  get diagnostics n = row_count; if n <> 1 then raise exception 'remove: the earlier Oct 12 file was not restored'; end if;

  -- 2 · the extra client (its phones and duplicate reviews go with it).
  delete from public.contacts where tenant_id = v_t and id = v_client;
  get diagnostics n = row_count; if n <> 1 then raise exception 'remove: the extra client was not removed'; end if;

  -- Guards back on (the delayed checks run first, or the tables can't be altered).
  set constraints all immediate;
  for i in 1 .. array_length(v_guards, 1) loop
    execute format('alter table public.%I enable trigger %I', v_guards[i][1], v_guards[i][2]);
    for v_rel in select inhrelid::regclass from pg_inherits where inhparent = ('public.' || v_guards[i][1])::regclass loop
      execute format('alter table %s enable trigger %I', v_rel, v_guards[i][2]);
    end loop;
  end loop;

  -- Proof: no look-alike is left anywhere, the real 7 are untouched, every guard is back on.
  if exists (select 1 from public.policy_current where tenant_id = v_t and policy_number = any(v_nums))
     or exists (select 1 from public.policy_snapshot where tenant_id = v_t and policy_number = any(v_nums)) then
    raise exception 'remove: a look-alike is still in the book; rolled back';
  end if;
  if (select count(*) from public.policy_current where tenant_id = v_t and carrier_id = v_carrier and policy_number like '011880000_') <> 7 then
    raise exception 'remove: the 7 real policies are not all in the book; rolled back';
  end if;
  select count(*) into n from pg_trigger where not tgisinternal and tgenabled <> 'O';
  if n > 0 then raise exception 'remove: % trigger(s) still off; rolled back', n; end if;
end $$;

-- Should read: look_alikes 0, real_policies 7, oct12_file parsed, extra_client 0, triggers_off 0.
select
  (select count(*) from public.policy_current where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b' and policy_number like '1188%') as look_alikes,
  (select count(*) from public.policy_current where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b' and policy_number like '011880000_') as real_policies,
  (select status from public.file_registry where id = '32d4ed32-264c-4511-abc8-261fe73dca25') as oct12_file,
  (select count(*) from public.contacts where id = '1eee96ed-d51d-48c6-a73b-c09067894c6e') as extra_client,
  (select count(*) from pg_trigger where not tgisinternal and tgenabled <> 'O') as triggers_off;

commit;
