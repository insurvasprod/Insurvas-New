-- Clear the demo agency "Advance Team (QA demo)" (tenant "LA-1.25 Alert Demo") of every policy and
-- commission record, and of the Rinor test leads, so the carrier-file run of 2026-10-13 starts from zero.
-- Owner request 2026-10-13: "clear everything up for the data side for policies and commissions",
-- scope chosen: policies + commissions + the test applications.
--
-- Removed:
--   carrier files and their raw rows, snapshots, history, policies, links and reviews, the ledger,
--   account lines, expected commission, discrepancies, dispute letters, logged calls, findings,
--   Exceptions items, runs, policy notes, the book-import progress; the clients the carrier files
--   created (provisional) and their households;
--   the hand-entered policies (LA-0.7) with their lapse signals, and the typed-in statements with
--   their lines, matches and discrepancies;
--   the recorded sales (Policies: Issued, waiting for the carrier file);
--   Rinor Gllareva four test leads (with their applications, calls and everything that hangs off a
--   lead) and his client record.
-- Kept: every setting (rate card, advance rules, product mappings, carrier rules and settings,
--   layouts, agent codes, statement column mappings, pipeline sync), the carriers the agency writes,
--   every other lead, client, application and module.
-- Storage needs nothing: uploads sit under <agency>/upload/, which nothing re-reads, and the same
-- file can be uploaded again once its registry row is gone.
--
-- Safe to run again: on a second run there is simply less to remove (the Rinor records are gone).
--
-- Some tables refuse deletes by design. The script finds every delete guard on the tables it empties,
-- switches them off for this transaction only, back on before it ends, and proves it. Any mismatch
-- raises and the WHOLE script rolls back.
begin;

do $$
declare
  v_t constant uuid := 'd6f3950f-0d88-4e66-869f-0de2ea6b396b';
  v_rinor_leads constant uuid[] := array['f11de550-de63-461a-a2d9-b427c9cc0f70', 'dd37b9ee-d05d-4a43-a8da-5108fbebec96',
                                         '6d98f928-a1b4-48ba-b874-90b6db768e7c', '20e0aa8a-ce5b-4291-a844-a7c396ffc4ce']::uuid[];
  v_rinor_contact constant uuid := '463caa00-30c5-490b-80b1-6e1835440428';
  v_tables constant text[] := array['agent_findings', 'book_import_carrier', 'carrier_account_statement', 'retention_action', 'policy_annotation',
    'commission_discrepancy', 'commission_dispute', 'queue_item', 'policy_match_review', 'policy_match_ladder', 'policy_match',
    'expected_commission', 'commission_entry', 'commission_account_entry', 'policy_change', 'policy_event', 'policy_current',
    'policy_snapshot', 'unmapped_status_occurrences', 'unmapped_status_queue', 'reprocess_runs', 'pipeline_stage_run', 'pipeline_run',
    'file_registry_skips', 'raw_rows', 'file_registry',
    'tenant_commission_statement_matches', 'tenant_commission_discrepancies', 'tenant_commission_statement_lines',
    'tenant_commission_statements', 'tenant_policy_lapse_signals', 'tenant_policies',
    'contact_phones', 'contact_emails', 'contacts', 'households', 'agent_leads'];
  v_clients uuid[];
  v_homes uuid[];
  v_contacts_before bigint;
  v_leads_before bigint;
  v_rinor_found integer;
  v_rinor_client uuid[];
  v_rates_before bigint;
  v_rules_before bigint;
  v_layouts_before bigint;
  v_guards text[][] := '{}';
  v_g record;
  v_rel regclass;
  i integer;
  n bigint;
  v_left text;
begin
  if (select name from public.tenants where id = v_t) is distinct from 'LA-1.25 Alert Demo' then
    raise exception 'clear: % is not the demo agency - nothing changed', v_t;
  end if;
  -- The Rinor test records still there (none, on a second run). Each id still present must be his.
  select count(*) into v_rinor_found from public.agent_leads where tenant_id = v_t and id = any(v_rinor_leads);
  if (select count(*) from public.agent_leads where tenant_id = v_t and id = any(v_rinor_leads)
        and lower(values ->> 'first_name') = 'rinor' and lower(values ->> 'last_name') = 'gllareva') <> v_rinor_found then
    raise exception 'clear: a test lead id now holds someone other than Rinor Gllareva - nothing changed';
  end if;
  if exists (select 1 from public.contacts where tenant_id = v_t and id = v_rinor_contact
               and not (lower(first_name) = 'rinor' and lower(last_name) = 'gllareva' and household_id is null)) then
    raise exception 'clear: the client % is not Rinor Gllareva (or has a household) - nothing changed', v_rinor_contact;
  end if;
  select coalesce(array_agg(id), '{}') into v_rinor_client from public.contacts where tenant_id = v_t and id = v_rinor_contact;

  -- The clients LA-4 created (provisional, built from a carrier policy file), plus the Rinor client.
  select array_agg(id), array_agg(distinct household_id) filter (where household_id is not null) into v_clients, v_homes
    from public.contacts where tenant_id = v_t and provisional and provisional_source ->> 'kind' = 'carrier_policy';
  v_clients := coalesce(v_clients, '{}') || v_rinor_client;
  v_homes := coalesce(v_homes, '{}');
  if exists (select 1 from public.contacts where household_id = any(v_homes) and not (id = any(v_clients))) then
    raise exception 'clear: a household of an imported client holds another client - nothing changed';
  end if;
  if exists (select 1 from public.merge_log where kept_id = any(v_clients) or merged_id = any(v_clients))
     or exists (select 1 from public.contact_merge_log where kept_id = any(v_clients) or merged_id = any(v_clients)) then
    raise exception 'clear: a client to remove is in a merge log - nothing changed';
  end if;

  select count(*) into v_contacts_before from public.contacts where tenant_id = v_t;
  select count(*) into v_leads_before from public.agent_leads where tenant_id = v_t;
  select count(*) into v_rates_before from public.commission_schedules where tenant_id = v_t;
  select count(*) into v_rules_before from public.advance_rules where tenant_id = v_t;
  select count(*) into v_layouts_before from public.carrier_layout_map where tenant_id = v_t;

  -- Every row trigger that fires on DELETE on those tables (its own, not the copy on a partition).
  for v_g in select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
              where c.relnamespace = 'public'::regnamespace and c.relname = any(v_tables)
                and not t.tgisinternal and t.tgparentid = 0 and (t.tgtype & 8) <> 0 loop
    v_guards := v_guards || array[array[v_g.relname::text, v_g.tgname::text]];
  end loop;
  if coalesce(array_length(v_guards, 1), 0) < 7 then
    raise exception 'clear: found only % delete guards, expected at least 7 (ledger, account lines, letters, expected, links, raw rows, calls) - nothing changed', coalesce(array_length(v_guards, 1), 0);
  end if;
  for i in 1 .. array_length(v_guards, 1) loop
    execute format('alter table public.%I disable trigger %I', v_guards[i][1], v_guards[i][2]);
    for v_rel in select inhrelid::regclass from pg_inherits where inhparent = ('public.' || v_guards[i][1])::regclass loop
      execute format('alter table %s disable trigger %I', v_rel, v_guards[i][2]);
    end loop;
  end loop;

  -- LA-4: each table emptied before anything it points at.
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
  -- A reversing line points at the line it reverses (on delete restrict, checked row by row), so
  -- lines nothing points at go first, round by round.
  loop
    delete from public.commission_entry e where e.tenant_id = v_t
       and not exists (select 1 from public.commission_entry r where r.reverses_entry_id = e.id);
    get diagnostics n = row_count;
    exit when n = 0;
  end loop;
  if exists (select 1 from public.commission_entry where tenant_id = v_t) then raise exception 'clear: ledger lines left after the rounds'; end if;
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

  -- LA-0.7: the typed-in statements and the hand-entered policies.
  delete from public.tenant_commission_statement_matches where tenant_id = v_t;
  delete from public.tenant_commission_discrepancies where tenant_id = v_t;
  delete from public.tenant_commission_statement_lines where tenant_id = v_t;
  loop
    delete from public.tenant_commission_statements s where s.tenant_id = v_t
       and not exists (select 1 from public.tenant_commission_statements r where r.reprocessed_from = s.id);
    get diagnostics n = row_count;
    exit when n = 0;
  end loop;
  delete from public.tenant_policy_lapse_signals where tenant_id = v_t;
  delete from public.tenant_policies where tenant_id = v_t;

  -- The recorded sales (LA-3): Policies lists each as Issued, waiting for the carrier file, until a
  -- carrier file names it. Nothing points at them and they have no delete guard.
  delete from public.tenant_issued_policies where tenant_id = v_t;

  -- The Rinor test leads (their applications, calls and the rest go with them), then the clients.
  delete from public.agent_leads where tenant_id = v_t and id = any(v_rinor_leads);
  get diagnostics n = row_count; if n <> v_rinor_found then raise exception 'clear: removed % of the % Rinor leads', n, v_rinor_found; end if;
  update public.agent_leads set contact_id = null where tenant_id = v_t and contact_id = any(v_clients);
  delete from public.contact_phones where tenant_id = v_t and contact_id = any(v_clients);
  delete from public.contact_emails where contact_id = any(v_clients);
  delete from public.contacts where tenant_id = v_t and id = any(v_clients);
  get diagnostics n = row_count; if n <> cardinality(v_clients) then raise exception 'clear: removed % of % clients', n, cardinality(v_clients); end if;
  delete from public.households where tenant_id = v_t and id = any(v_homes);

  -- Guards back on (the delayed checks run first, or the tables cannot be altered).
  set constraints all immediate;
  for i in 1 .. array_length(v_guards, 1) loop
    execute format('alter table public.%I enable trigger %I', v_guards[i][1], v_guards[i][2]);
    for v_rel in select inhrelid::regclass from pg_inherits where inhparent = ('public.' || v_guards[i][1])::regclass loop
      execute format('alter table %s enable trigger %I', v_rel, v_guards[i][2]);
    end loop;
  end loop;

  -- Proof 1: every policy and commission page is empty.
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
    union all select 'hand policies', count(*) from public.tenant_policies where tenant_id = v_t
    union all select 'hand statements', count(*) from public.tenant_commission_statements where tenant_id = v_t
    union all select 'hand statement lines', count(*) from public.tenant_commission_statement_lines where tenant_id = v_t
    union all select 'recorded sales', count(*) from public.tenant_issued_policies where tenant_id = v_t
    union all select 'imported clients', count(*) from public.contacts where tenant_id = v_t and provisional_source ->> 'kind' = 'carrier_policy'
    union all select 'Rinor leads', count(*) from public.agent_leads where tenant_id = v_t and lower(values ->> 'last_name') = 'gllareva'
    union all select 'Rinor clients', count(*) from public.contacts where tenant_id = v_t and lower(last_name) = 'gllareva'
  ) x where c > 0;
  if v_left is not null then raise exception 'clear: left behind (%) - rolled back', v_left; end if;

  -- Proof 2: nothing else was touched.
  if (select count(*) from public.contacts where tenant_id = v_t) <> v_contacts_before - cardinality(v_clients) then
    raise exception 'clear: clients other than the imported ones and Rinor were removed - rolled back';
  end if;
  if (select count(*) from public.agent_leads where tenant_id = v_t) <> v_leads_before - v_rinor_found then
    raise exception 'clear: leads other than the Rinor test leads were removed - rolled back';
  end if;
  if (select count(*) from public.commission_schedules where tenant_id = v_t) <> v_rates_before
     or (select count(*) from public.advance_rules where tenant_id = v_t) <> v_rules_before
     or (select count(*) from public.carrier_layout_map where tenant_id = v_t) <> v_layouts_before then
    raise exception 'clear: a setting changed - rolled back';
  end if;
  if (select count(*) from public.tenant_carriers where tenant_id = v_t) = 0 then
    raise exception 'clear: the carriers the agency writes are gone - rolled back';
  end if;

  -- Proof 3: every trigger in the database is on.
  select count(*) into n from pg_trigger where not tgisinternal and tgenabled <> 'O';
  if n > 0 then raise exception 'clear: % trigger(s) still off - rolled back', n; end if;
end $$;

-- Should read: 0 files, 0 policies, 0 ledger lines, 0 hand policies, 0 Rinor leads, 0 triggers off,
-- and the settings counts unchanged (8 rates, 6 advance rules).
select
  (select count(*) from public.file_registry where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as files,
  (select count(*) from public.policy_current where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as policies,
  (select count(*) from public.commission_entry where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as ledger_lines,
  (select count(*) from public.tenant_policies where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as hand_policies,
  (select count(*) from public.agent_leads where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b' and lower(values ->> 'last_name') = 'gllareva') as rinor_leads,
  (select count(*) from public.commission_schedules where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as rates,
  (select count(*) from public.advance_rules where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as advance_rules,
  (select count(*) from pg_trigger where not tgisinternal and tgenabled <> 'O') as triggers_off;

commit;
