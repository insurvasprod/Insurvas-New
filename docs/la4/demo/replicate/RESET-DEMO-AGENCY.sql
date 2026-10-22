-- Put the demo agency "Advance Team (QA demo)" back to how it was before the working demo of
-- Oct 9, 2026 (which began 14:08 UTC), so docs/la4/demo/replicate/REPLICATE-THE-DEMO.md gives the
-- same results again.
--
-- Removes what the 10 workflows created: the 4 uploaded files (LA14 Oct 9 policies, two Corebridge
-- statements, American Amicable's book) with their raw rows, snapshots, lines, findings and runs;
-- the 70 American Amicable policies, links and provisional clients; the logged call; the dispute
-- letter; the agent-code mapping; the 14-day LA14 rule; the 2 new findings; the import item.
-- Puts back: LA14's earlier Oct 9 file as the current one, DEMO-1006 unpaid (paid-to Oct 1),
-- DEMO-1002's short-paid finding open, and the 8 LA14 expected-commission dates (Oct 5, due Oct 26).
--
-- Eight tables refuse these changes by design. Their guards are found by the script, switched off
-- for this transaction only, and switched back on before it ends; the script then proves it. Any
-- mismatch raises and the WHOLE script rolls back. Only the demo agency's rows are touched.
begin;

do $$
declare
  v_t   constant uuid := 'd6f3950f-0d88-4e66-869f-0de2ea6b396b';
  v_t0  constant timestamptz := '2026-10-09 14:08:00+00';
  v_la14 constant uuid := '6671c092-edff-49b6-982f-1923941f0dfc';
  v_amam constant uuid := '5bd2ff41-fd83-485e-9373-9ada7a0aa3c7';
  v_up2  constant uuid := '33e58df6-4615-4241-8283-bf987a0ec0a1';  -- LA14-demo-upload-2.csv, the Oct 9 file before the demo
  v_new  constant uuid[] := array['aa127ea1-6372-48e5-a922-e94e0ac0eaa8',   -- LA14-policies-2026-10-09.csv
                                  '20517533-969f-4d6f-972c-3f958d872dbd',   -- American Amicable Policies.csv
                                  '0fed702c-000f-453c-9dab-ad5d0ff69e0c',   -- Corebridge corrected statement
                                  'b3b3e93c-0e41-4e9b-a31c-1225c9aef6ce']::uuid[];  -- Corebridge short statement
  v_tables constant text[] := array['raw_rows', 'commission_entry', 'policy_match', 'retention_action', 'commission_dispute',
                                    'carrier_retention_rule', 'file_registry', 'policy_snapshot'];
  v_guards text[][] := '{}';
  v_g record;
  v_rel regclass;
  i integer;
  n bigint;
  v_left text;
begin
  if (select name from public.tenants where id = v_t) is distinct from 'LA-1.25 Alert Demo' then
    raise exception 'reset: % is not the demo agency; nothing changed', v_t;
  end if;
  if (select count(*) from public.file_registry where tenant_id = v_t and id = any(v_new)) <> 4 then
    raise exception 'reset: the 4 demo files are not all there (already reset?); nothing changed';
  end if;

  -- The guards on those tables (delete or update row triggers, not a partition's copy).
  for v_g in select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
              where c.relnamespace = 'public'::regnamespace and c.relname = any(v_tables)
                and not t.tgisinternal and t.tgparentid = 0 and ((t.tgtype & 8) <> 0 or (t.tgtype & 16) <> 0) loop
    v_guards := v_guards || array[array[v_g.relname::text, v_g.tgname::text]];
  end loop;
  if coalesce(array_length(v_guards, 1), 0) <> 8 then
    raise exception 'reset: expected 8 guards, found %; nothing changed', coalesce(array_length(v_guards, 1), 0);
  end if;
  for i in 1 .. array_length(v_guards, 1) loop
    execute format('alter table public.%I disable trigger %I', v_guards[i][1], v_guards[i][2]);
    for v_rel in select inhrelid::regclass from pg_inherits where inhparent = ('public.' || v_guards[i][1])::regclass loop
      execute format('alter table %s disable trigger %I', v_rel, v_guards[i][2]);
    end loop;
  end loop;

  -- Findings and the letter: DEMO-1002 open again, the two new findings and the letter gone.
  update public.commission_discrepancy
     set status = 'open', resolution = null, resolution_note = null, resolved_by = null, resolved_at = null, dispute_id = null
   where tenant_id = v_t and id = 'ca187602-b692-45b0-93d5-95dbc9c696d5';
  get diagnostics n = row_count; if n <> 1 then raise exception 'reset: DEMO-1002 finding not found'; end if;
  delete from public.commission_discrepancy where tenant_id = v_t and detected_at >= v_t0;
  delete from public.commission_dispute where tenant_id = v_t and created_at >= v_t0;

  -- The import item, the call, the agent mapping, the 14-day rule.
  delete from public.queue_item where tenant_id = v_t and created_at >= v_t0;
  delete from public.retention_action where tenant_id = v_t and acted_at >= v_t0;
  delete from public.carrier_agent_map where tenant_id = v_t and mapped_at >= v_t0;
  delete from public.carrier_retention_rule where tenant_id = v_t and created_at >= v_t0;

  -- Everything that came from the 4 files.
  delete from public.agent_findings where tenant_id = v_t and file_id = any(v_new);
  delete from public.policy_change where tenant_id = v_t and (to_file_id = any(v_new) or from_file_id = any(v_new));
  delete from public.policy_event where tenant_id = v_t and file_id = any(v_new);
  delete from public.policy_match where tenant_id = v_t and created_at >= v_t0;
  delete from public.policy_match_ladder where tenant_id = v_t and created_at >= v_t0;
  delete from public.commission_entry where tenant_id = v_t and file_id = any(v_new);
  delete from public.policy_current where tenant_id = v_t and carrier_id = v_amam;
  delete from public.policy_snapshot where tenant_id = v_t and file_id = any(v_new);
  update public.policy_snapshot set superseded = false where tenant_id = v_t and file_id = v_up2;
  get diagnostics n = row_count; if n <> 8 then raise exception 'reset: expected 8 snapshots of the earlier Oct 9 file, found %', n; end if;
  delete from public.raw_rows where tenant_id = v_t and file_id = any(v_new);
  delete from public.pipeline_stage_run where tenant_id = v_t and (file_id = any(v_new) or started_at >= v_t0);
  delete from public.pipeline_run where tenant_id = v_t and started_at >= v_t0;
  delete from public.reprocess_runs where tenant_id = v_t and started_at >= v_t0;
  delete from public.file_registry_skips where tenant_id = v_t and (skipped_at >= v_t0 or original_file_id = any(v_new));
  delete from public.book_import_carrier where tenant_id = v_t and carrier_id = v_amam;

  -- LA14's earlier Oct 9 file is the current one again; the 4 files go.
  -- (the 4 go first: only one file per carrier, type and day can be current)
  delete from public.file_registry where tenant_id = v_t and id = any(v_new);
  get diagnostics n = row_count; if n <> 4 then raise exception 'reset: expected to remove 4 files, removed %', n; end if;
  update public.file_registry set superseded_by_file_id = null, superseded_at = null, status = 'parsed'
   where tenant_id = v_t and id = v_up2;
  get diagnostics n = row_count; if n <> 1 then raise exception 'reset: the earlier Oct 9 file was not found'; end if;

  -- American Amicable's 70 provisional clients and their households.
  delete from public.contact_phones where tenant_id = v_t and created_at >= v_t0;
  delete from public.contacts where tenant_id = v_t and created_at >= v_t0 and provisional;
  delete from public.households where tenant_id = v_t and created_at >= v_t0;

  -- The 8 LA14 expected-commission dates, as they were (when commission is due may change; the figure never does).
  update public.expected_commission set trigger_occurred_on = '2026-10-05', overdue_from = '2026-10-26'
   where tenant_id = v_t and carrier_id = v_la14;
  get diagnostics n = row_count; if n <> 8 then raise exception 'reset: expected 8 LA14 expected-commission rows, found %', n; end if;

  -- Guards back on (run the delayed checks first, or the tables can't be altered).
  set constraints all immediate;
  for i in 1 .. array_length(v_guards, 1) loop
    execute format('alter table public.%I enable trigger %I', v_guards[i][1], v_guards[i][2]);
    for v_rel in select inhrelid::regclass from pg_inherits where inhparent = ('public.' || v_guards[i][1])::regclass loop
      execute format('alter table %s enable trigger %I', v_rel, v_guards[i][2]);
    end loop;
  end loop;

  -- LA14's current policies rebuilt from its files (DEMO-1006 back to paid-to Oct 1, no agent on AGENT TWO).
  perform public.refresh_policy_current(v_t, v_la14, null, null);

  -- Proof 1: nothing the demo created is left.
  select string_agg(t || ' ' || c, ', ') into v_left from (
    select 'files' t, count(*) c from public.file_registry where tenant_id = v_t and received_at >= v_t0
    union all select 'raw rows', count(*) from public.raw_rows where tenant_id = v_t and created_at >= v_t0
    union all select 'snapshots', count(*) from public.policy_snapshot where tenant_id = v_t and created_at >= v_t0
    union all select 'links', count(*) from public.policy_match where tenant_id = v_t and created_at >= v_t0
    union all select 'clients', count(*) from public.contacts where tenant_id = v_t and created_at >= v_t0
    union all select 'households', count(*) from public.households where tenant_id = v_t and created_at >= v_t0
    union all select 'calls', count(*) from public.retention_action where tenant_id = v_t and acted_at >= v_t0
    union all select 'letters', count(*) from public.commission_dispute where tenant_id = v_t and created_at >= v_t0
    union all select 'findings', count(*) from public.commission_discrepancy where tenant_id = v_t and detected_at >= v_t0
    union all select 'lines', count(*) from public.commission_entry where tenant_id = v_t and created_at >= v_t0
    union all select 'rules', count(*) from public.carrier_retention_rule where tenant_id = v_t and created_at >= v_t0
    union all select 'agent maps', count(*) from public.carrier_agent_map where tenant_id = v_t and mapped_at >= v_t0
    union all select 'queue items', count(*) from public.queue_item where tenant_id = v_t and created_at >= v_t0
    union all select 'American Amicable policies', count(*) from public.policy_current where tenant_id = v_t and carrier_id = v_amam
  ) x where c > 0;
  if v_left is not null then raise exception 'reset: left behind (%); rolled back', v_left; end if;

  -- Proof 2: the state before the demo.
  if not exists (select 1 from public.file_registry where id = v_up2 and status = 'parsed' and superseded_by_file_id is null) then
    raise exception 'reset: the earlier Oct 9 file is not current; rolled back';
  end if;
  if not exists (select 1 from public.policy_current where tenant_id = v_t and carrier_id = v_la14 and policy_number = 'DEMO-1006' and paid_to_date = '2026-10-01') then
    raise exception 'reset: DEMO-1006 is not back to paid-to Oct 1; rolled back';
  end if;
  if (select count(*) from public.policy_current where tenant_id = v_t and carrier_id = v_la14) <> 8 then
    raise exception 'reset: LA14 does not have its 8 policies; rolled back';
  end if;
  if not exists (select 1 from public.commission_discrepancy where id = 'ca187602-b692-45b0-93d5-95dbc9c696d5' and status = 'open' and dispute_id is null) then
    raise exception 'reset: DEMO-1002 finding is not open; rolled back';
  end if;

  -- Proof 3: every trigger in the database is on.
  select count(*) into n from pg_trigger where not tgisinternal and tgenabled <> 'O';
  if n > 0 then raise exception 'reset: % trigger(s) still off; rolled back', n; end if;
end $$;

-- Should read: 7 files, 8 LA14 policies, DEMO-1006 paid to 2026-10-01, 0 triggers off.
select
  (select count(*) from public.file_registry where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b') as files,
  (select count(*) from public.policy_current where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b' and carrier_id = '6671c092-edff-49b6-982f-1923941f0dfc') as la14_policies,
  (select paid_to_date from public.policy_current where tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b' and policy_number = 'DEMO-1006') as demo_1006_paid_to,
  (select count(*) from pg_trigger where not tgisinternal and tgenabled <> 'O') as triggers_off;

commit;
