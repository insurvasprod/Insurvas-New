-- Empty every LA-4 page for the demo agency "Advance Team (QA demo)" (tenant "LA-1.25 Alert Demo"),
-- so a demo can start from zero and show each upload moving the money through.
--
-- Removed: carrier files and their raw rows, snapshots, history, policies, links, the ledger,
-- account lines, expected commission, discrepancies, dispute letters, logged calls, findings, the
-- import progress and Exceptions items, runs, the policy notes; the 8 clients the LA14 file created
-- (provisional, linked to nothing else) and their households; and the settings: rate card (rates,
-- product mappings, advance rules), carrier rules and settings, the agency's own LA14 layout, the
-- agent-code mapping, sender domains, scorecard setting.
-- Kept: everything outside LA-4 (leads, calls, the 2,001 other clients, applications, hand-entered
-- policies and statements from LA-0.7, quoting), and the list of carriers the agency writes
-- (onboarding), so Import your book still asks for the same carriers.
-- Storage needs nothing: uploaded copies sit under <agency>/upload/, which nothing re-reads, and a
-- re-upload of the same file is accepted.
--
-- Some tables refuse deletes by design. The script finds every delete guard on the tables it
-- empties, switches them off for this transaction only and back on before it ends, then proves it.
-- Any mismatch raises and the WHOLE script rolls back.
begin;

do $$
declare
  v_t constant uuid := 'd6f3950f-0d88-4e66-869f-0de2ea6b396b';
  v_tables constant text[] := array['agent_findings', 'book_import_carrier', 'carrier_account_statement', 'retention_action', 'policy_annotation', 'commission_discrepancy', 'commission_dispute', 'queue_item', 'policy_match_review', 'policy_match_ladder', 'policy_match', 'expected_commission', 'commission_entry', 'commission_account_entry', 'policy_change', 'policy_event', 'policy_current', 'policy_snapshot', 'unmapped_status_occurrences', 'unmapped_status_queue', 'reprocess_runs', 'pipeline_stage_run', 'pipeline_run', 'file_registry_skips', 'raw_rows', 'file_registry', 'carrier_layout_assignment', 'carrier_layout_map', 'carrier_layout_map_entry', 'carrier_retention_rule', 'carrier_operating_settings', 'carrier_inbound_senders', 'advance_rules', 'commission_schedules', 'commission_schedule_band', 'carrier_product_family', 'carrier_agent_map', 'book_insight_settings', 'contact_phones', 'contacts', 'households'];
  v_clients uuid[];
  v_homes uuid[];
  v_contacts_before bigint;
  v_hand_before bigint;
  v_guards text[][] := '{}';
  v_g record;
  v_rel regclass;
  i integer;
  n bigint;
  v_left text;
begin
  if (select name from public.tenants where id = v_t) is distinct from 'LA-1.25 Alert Demo' then
    raise exception 'wipe: % is not the demo agency; nothing changed', v_t;
  end if;

  -- The clients LA-4 created: provisional, built from a carrier policy file.
  select array_agg(id), array_agg(distinct household_id) filter (where household_id is not null) into v_clients, v_homes
    from public.contacts where tenant_id = v_t and provisional and provisional_source ->> 'kind' = 'carrier_policy';
  v_clients := coalesce(v_clients, '{}'); v_homes := coalesce(v_homes, '{}');
  if exists (select 1 from public.contacts where household_id = any(v_homes) and not (id = any(v_clients))) then
    raise exception 'wipe: a household of an imported client holds another client; nothing changed';
  end if;
  select count(*) into v_contacts_before from public.contacts where tenant_id = v_t;
  select count(*) into v_hand_before from public.tenant_policies where tenant_id = v_t;

  -- Every row trigger that fires on DELETE on those tables (its own, not a partition's copy).
  for v_g in select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
              where c.relnamespace = 'public'::regnamespace and c.relname = any(v_tables)
                and not t.tgisinternal and t.tgparentid = 0 and (t.tgtype & 8) <> 0 loop
    v_guards := v_guards || array[array[v_g.relname::text, v_g.tgname::text]];
  end loop;
  if coalesce(array_length(v_guards, 1), 0) < 10 then
    raise exception 'wipe: found only % delete guards, expected at least 10; nothing changed', coalesce(array_length(v_guards, 1), 0);
  end if;
  for i in 1 .. array_length(v_guards, 1) loop
    execute format('alter table public.%I disable trigger %I', v_guards[i][1], v_guards[i][2]);
    for v_rel in select inhrelid::regclass from pg_inherits where inhparent = ('public.' || v_guards[i][1])::regclass loop
      execute format('alter table %s disable trigger %I', v_rel, v_guards[i][2]);
    end loop;
  end loop;

  -- Each table emptied before anything it points at.
  delete from public.agent_findings where tenant_id = v_t;
  delete from public.book_import_carrier where tenant_id = v_t;
  delete from public.carrier_account_statement where tenant_id = v_t;
  delete from public.retention_action where tenant_id = v_t;
  delete from public.policy_annotation where tenant_id = v_t;
  delete from public.commission_discrepancy where tenant_id = v_t;
  delete from public.commission_dispute where tenant_id = v_t;
  delete from public.queue_item where tenant_id = v_t;
  delete from public.policy_match_review where tenant_id = v_t;
  delete from public.policy_match_ladder where tenant_id = v_t;
  delete from public.policy_match where tenant_id = v_t;
  delete from public.expected_commission where tenant_id = v_t;
  delete from public.commission_entry where tenant_id = v_t;
  delete from public.commission_account_entry where tenant_id = v_t;
  delete from public.policy_change where tenant_id = v_t;
  delete from public.policy_event where tenant_id = v_t;
  delete from public.policy_current where tenant_id = v_t;
  delete from public.policy_snapshot where tenant_id = v_t;
  delete from public.unmapped_status_occurrences where file_id in (select id from public.file_registry where tenant_id = v_t);
  delete from public.unmapped_status_queue where tenant_id = v_t;
  delete from public.reprocess_runs where tenant_id = v_t;
  delete from public.pipeline_stage_run where tenant_id = v_t;
  delete from public.pipeline_run where tenant_id = v_t;
  delete from public.file_registry_skips where tenant_id = v_t;
  delete from public.raw_rows where tenant_id = v_t;
  delete from public.file_registry where tenant_id = v_t;
  delete from public.carrier_layout_assignment where tenant_id = v_t;
  delete from public.carrier_layout_map where tenant_id = v_t;
  delete from public.carrier_retention_rule where tenant_id = v_t;
  delete from public.carrier_operating_settings where tenant_id = v_t;
  delete from public.carrier_inbound_senders where tenant_id = v_t;
  delete from public.advance_rules where tenant_id = v_t;
  delete from public.commission_schedules where tenant_id = v_t;
  delete from public.carrier_product_family where tenant_id = v_t;
  delete from public.carrier_agent_map where tenant_id = v_t;
  delete from public.book_insight_settings where tenant_id = v_t;
  delete from public.contact_phones where tenant_id = v_t and contact_id = any(v_clients);
  delete from public.contacts where tenant_id = v_t and id = any(v_clients);
  get diagnostics n = row_count; if n <> cardinality(v_clients) then raise exception 'wipe: removed % of % imported clients', n, cardinality(v_clients); end if;
  delete from public.households where tenant_id = v_t and id = any(v_homes);

  -- Guards back on (the delayed checks run first, or the tables can't be altered).
  set constraints all immediate;
  for i in 1 .. array_length(v_guards, 1) loop
    execute format('alter table public.%I enable trigger %I', v_guards[i][1], v_guards[i][2]);
    for v_rel in select inhrelid::regclass from pg_inherits where inhparent = ('public.' || v_guards[i][1])::regclass loop
      execute format('alter table %s enable trigger %I', v_rel, v_guards[i][2]);
    end loop;
  end loop;

  -- Proof 1: every LA-4 page is empty.
  select string_agg(t || ' ' || c, ', ') into v_left from (
    select 'files' t, count(*) c from public.file_registry where tenant_id = v_t
    union all select 'raw rows', count(*) from public.raw_rows where tenant_id = v_t
    union all select 'snapshots', count(*) from public.policy_snapshot where tenant_id = v_t
    union all select 'policies', count(*) from public.policy_current where tenant_id = v_t
    union all select 'history', count(*) from public.policy_change where tenant_id = v_t
    union all select 'links', count(*) from public.policy_match where tenant_id = v_t
    union all select 'ledger lines', count(*) from public.commission_entry where tenant_id = v_t
    union all select 'account lines', count(*) from public.commission_account_entry where tenant_id = v_t
    union all select 'expected', count(*) from public.expected_commission where tenant_id = v_t
    union all select 'discrepancies', count(*) from public.commission_discrepancy where tenant_id = v_t
    union all select 'letters', count(*) from public.commission_dispute where tenant_id = v_t
    union all select 'calls', count(*) from public.retention_action where tenant_id = v_t
    union all select 'findings', count(*) from public.agent_findings where tenant_id = v_t
    union all select 'exceptions', count(*) from public.queue_item where tenant_id = v_t
    union all select 'runs', count(*) from public.pipeline_run where tenant_id = v_t
    union all select 'rates', count(*) from public.commission_schedules where tenant_id = v_t
    union all select 'advance rules', count(*) from public.advance_rules where tenant_id = v_t
    union all select 'carrier rules', count(*) from public.carrier_retention_rule where tenant_id = v_t
    union all select 'agency layouts', count(*) from public.carrier_layout_map where tenant_id = v_t
    union all select 'agent codes', count(*) from public.carrier_agent_map where tenant_id = v_t
    union all select 'imported clients', count(*) from public.contacts where tenant_id = v_t and provisional_source ->> 'kind' = 'carrier_policy'
  ) x where c > 0;
  if v_left is not null then raise exception 'wipe: left behind (%); rolled back', v_left; end if;

  -- Proof 2: nothing outside LA-4 was touched.
  if (select count(*) from public.contacts where tenant_id = v_t) <> v_contacts_before - cardinality(v_clients) then
    raise exception 'wipe: clients other than the imported ones were removed; rolled back';
  end if;
  if (select count(*) from public.tenant_policies where tenant_id = v_t) <> v_hand_before then
    raise exception 'wipe: hand-entered policies changed; rolled back';
  end if;
  if (select count(*) from public.tenant_carriers where tenant_id = v_t) = 0 then
    raise exception 'wipe: the carriers the agency writes are gone; rolled back';
  end if;

  -- Proof 3: every trigger in the database is on.
  select count(*) into n from pg_trigger where not tgisinternal and tgenabled <> 'O';
  if n > 0 then raise exception 'wipe: % trigger(s) still off; rolled back', n; end if;
end $$;

-- Should read: 0 files, 0 policies, 0 ledger lines, 2001 clients, 120 hand policies, 0 triggers off.
select
  (select count(*) from public.file_registry where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as files,
  (select count(*) from public.policy_current where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as policies,
  (select count(*) from public.commission_entry where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as ledger_lines,
  (select count(*) from public.contacts where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as clients,
  (select count(*) from public.tenant_policies where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as hand_policies,
  (select count(*) from pg_trigger where not tgisinternal and tgenabled <> 'O') as triggers_off;

commit;
