-- The retention run, faster on a big book (2026-10-16).
--
-- The E2E run timed a dry run at ~1 s on an agency with almost no data, and it hit the statement
-- timeout once under load. In retention_execute (live body, read 2026-10-16), three costs grow with
-- the book or with everyone else's:
--   · legal_hold_active / legal_hold_active_for_lead are SECURITY DEFINER SQL functions, so they are
--     never inlined: they ran once per candidate row, with their own sub-queries. Now one look at
--     legal_hold up front; with no active hold (the normal case) no row is held and no check runs.
--     With a hold, every check runs exactly as before.
--   · each consent artefact searched every transfer verdict's JSON for itself (consents x verdicts).
--     Now the verdicts are read once into retention_consent_relied (consent id -> last pass).
--   · screening_audit had no index starting with tenant_id: every run read every agency's rows.
-- Same rules, same results; only how they are found changed.
-- Rollback: restore retention_execute from 20261015630000; drop index public.screening_audit_tenant_ts_idx.

create index if not exists screening_audit_tenant_ts_idx on public.screening_audit (tenant_id, ts);

CREATE OR REPLACE FUNCTION public.retention_execute(p_tenant_id uuid, p_mode text, p_triggered_by text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_run uuid;
  v_live boolean := p_mode = 'live';
  v_window integer;
  v_results jsonb := '[]'::jsonb;
  v_held integer := 0;
  v_unruled text[] := '{}';
  v_type text;
  v_rules jsonb;
  m integer; h integer; p integer; v_old timestamptz; v_new timestamptz;
  v_tokens jsonb;
  pol record;
  v_dry_fingerprint text;
  v_dry_delivered integer;
  v_dry_ack timestamptz;
  v_fingerprint text := public.retention_rules_fingerprint(p_tenant_id);
  -- Most agencies hold nothing: then no row is held, and the per-row checks below never run.
  v_any_hold boolean := exists (select 1 from public.legal_hold h where h.tenant_id = p_tenant_id and h.released_at is null);
begin
  if p_mode not in ('dry_run', 'live') then
    raise exception 'retention_execute: mode is dry_run or live';
  end if;
  if v_live then
    select coalesce(s.purge_dry_run_window_days, 7) into v_window from public.compliance_settings s where s.tenant_id = p_tenant_id;
    v_window := coalesce(v_window, 7);
    select r.rules_fingerprint, r.summary_delivered_count, r.summary_acknowledged_at into v_dry_fingerprint, v_dry_delivered, v_dry_ack
      from public.retention_run r
     where r.tenant_id = p_tenant_id and r.mode = 'dry_run' and r.finished_at >= now() - make_interval(days => v_window)
     order by r.finished_at desc limit 1;
    if not found then
      raise exception 'retention_execute: a live run needs a dry run in the last % days', v_window using errcode = 'check_violation';
    end if;
    -- The live run deletes what the dry run showed — not what different rules would select.
    if v_dry_fingerprint is distinct from v_fingerprint then
      raise exception 'retention_execute: the retention rules changed after the last dry run; run a new dry run first' using errcode = 'check_violation';
    end if;
    -- Someone must have seen what it will delete.
    if coalesce(v_dry_delivered, 0) = 0 and v_dry_ack is null then
      raise exception 'retention_execute: nobody has received or acknowledged the last dry run''s summary' using errcode = 'check_violation';
    end if;
    perform set_config('app.retention_purge', 'on', true);
  end if;
  insert into public.retention_run (tenant_id, mode, triggered_by, rules_fingerprint) values (p_tenant_id, p_mode, coalesce(p_triggered_by, 'manual'), v_fingerprint) returning id into v_run;

  foreach v_type in array array['consent_artefacts', 'call_attempt_logs', 'scrub_screening_results', 'transfer_verdicts', 'lead_data_unconverted',
                                'nurture_winback_candidates', 'complaint_records', 'policy_commission_records', 'compliance_evidence_reports'] loop
    select jsonb_object_agg(x.state, jsonb_build_object('days', x.retain_days, 'action', x.action)) into v_rules from public.retention_cutoffs(p_tenant_id, v_type) x;
    if v_rules is null or v_rules = '{}'::jsonb then
      v_unruled := v_unruled || v_type;
      continue;
    end if;

    if v_type = 'consent_artefacts' then
      -- Aged from its last reliance, not its capture: a consent a call or a transfer relied on last
      -- month is the defence for that contact, whenever it was captured.
      create temp table if not exists retention_due (id uuid, held boolean, at timestamptz) on commit drop;
      truncate retention_due;
      create temp table if not exists retention_consent_relied (consent_id text primary key, at timestamptz) on commit drop;
      truncate retention_consent_relied;
      insert into retention_consent_relied
      select ch->>'source_record_id', max(v.evaluated_at)
        from public.transfer_verdict v cross join lateral jsonb_array_elements(case when jsonb_typeof(v.checks_json) = 'array' then v.checks_json else '[]'::jsonb end) ch
       where v.tenant_id = p_tenant_id and ch->>'check' = 'consent_artefact' and ch->>'result' = 'pass' and ch->>'source_record_id' is not null
       group by 1;
      insert into retention_due
      select c.id, (v_any_hold and public.legal_hold_active_for_lead(p_tenant_id, c.lead_id, coalesce(c.phone_digits, public.compliance_lead_phone(l.values)))), rel.last_relied
        from public.tenant_consent_artefacts c
        join public.agent_leads l on l.id = c.lead_id and l.tenant_id = c.tenant_id
        cross join lateral (
          select greatest(
                   coalesce(c.consent_timestamp, c.captured_at),
                   (select max(i.event_at) from public.compliance_index i
                     where i.tenant_id = c.tenant_id and i.event_type = 'call_attempt'
                       and i.phone_digits = coalesce(c.phone_digits, public.compliance_lead_phone(l.values))
                       and i.event_at >= coalesce(c.consent_timestamp, c.captured_at)),
                   (select r.at from retention_consent_relied r where r.consent_id = c.id::text)
                 ) as last_relied
        ) rel
        cross join lateral (select coalesce(v_rules->upper(l.values->>'state'), v_rules->'**') r) rr
       where c.tenant_id = p_tenant_id and rr.r->>'action' = 'purge'
         and rel.last_relied < now() - make_interval(days => (rr.r->>'days')::int);
      select count(*), count(*) filter (where held), min(at), max(at) into m, h, v_old, v_new from retention_due;
      p := 0;
      if v_live then
        with d as (delete from public.tenant_consent_artefacts t using retention_due x where t.id = x.id and not x.held returning 1) select count(*) into p from d;
      end if;
      v_results := v_results || jsonb_build_array(jsonb_build_object('record_type', v_type, 'table', 'tenant_consent_artefacts', 'rows_matched', m, 'rows_held', h, 'rows_purged', p, 'oldest', v_old, 'newest', v_new,
                                                                     'note', 'Aged from the last call or transfer that relied on it.'));
      v_held := v_held + h;

    elsif v_type = 'call_attempt_logs' then
      create temp table if not exists retention_due (id uuid, held boolean, at timestamptz) on commit drop;
      truncate retention_due;
      insert into retention_due
      select a.id, (v_any_hold and public.legal_hold_active_for_lead(p_tenant_id, a.lead_id, coalesce(a.dialled_phone_digits, public.compliance_lead_phone(l.values)))), a.attempted_at
        from public.tenant_call_attempts a
        join public.agent_leads l on l.id = a.lead_id and l.tenant_id = a.tenant_id
        cross join lateral (select coalesce(v_rules->upper(coalesce(a.window_state, l.values->>'state')), v_rules->'**') r) rr
       where a.tenant_id = p_tenant_id and rr.r->>'action' = 'purge'
         and a.attempted_at < now() - make_interval(days => (rr.r->>'days')::int);
      select count(*), count(*) filter (where held), min(at), max(at) into m, h, v_old, v_new from retention_due;
      p := 0;
      if v_live then
        delete from public.tenant_dial_dnc_checks k using retention_due x where k.attempt_id = x.id and not x.held;
        with d as (delete from public.tenant_call_attempts t using retention_due x where t.id = x.id and not x.held returning 1) select count(*) into p from d;
      end if;
      v_results := v_results || jsonb_build_array(jsonb_build_object('record_type', v_type, 'table', 'tenant_call_attempts', 'rows_matched', m, 'rows_held', h, 'rows_purged', p, 'oldest', v_old, 'newest', v_new));
      v_held := v_held + h;

    elsif v_type = 'scrub_screening_results' then
      -- No state on a screen: the all-states rule.
      if v_rules->'**'->>'action' = 'purge' then
        select count(*), count(*) filter (where (v_any_hold and public.legal_hold_active(p_tenant_id, s.phone_digits, null, null))), min(s.ts), max(s.ts) into m, h, v_old, v_new
          from public.screening_audit s where s.tenant_id = p_tenant_id and s.ts < now() - make_interval(days => (v_rules->'**'->>'days')::int);
        p := 0;
        if v_live then
          with d as (delete from public.screening_audit s where s.tenant_id = p_tenant_id and s.ts < now() - make_interval(days => (v_rules->'**'->>'days')::int)
                       and not (v_any_hold and public.legal_hold_active(p_tenant_id, s.phone_digits, null, null)) returning 1) select count(*) into p from d;
        end if;
        v_results := v_results || jsonb_build_array(jsonb_build_object('record_type', v_type, 'table', 'screening_audit', 'rows_matched', m, 'rows_held', h, 'rows_purged', p, 'oldest', v_old, 'newest', v_new));
        v_held := v_held + h;
        select count(*), count(*) filter (where (v_any_hold and public.legal_hold_active(p_tenant_id, r.phone_digits, null, null))), min(r.rejected_at), max(r.rejected_at) into m, h, v_old, v_new
          from public.tenant_campaign_scrub_rejections r where r.tenant_id = p_tenant_id and r.rejected_at < now() - make_interval(days => (v_rules->'**'->>'days')::int);
        p := 0;
        if v_live then
          update public.lead_claim_items i set scrub_rejection_id = null from public.tenant_campaign_scrub_rejections r
           where i.scrub_rejection_id = r.id and r.tenant_id = p_tenant_id and r.rejected_at < now() - make_interval(days => (v_rules->'**'->>'days')::int)
             and not (v_any_hold and public.legal_hold_active(p_tenant_id, r.phone_digits, null, null));
          with d as (delete from public.tenant_campaign_scrub_rejections r where r.tenant_id = p_tenant_id and r.rejected_at < now() - make_interval(days => (v_rules->'**'->>'days')::int)
                       and not (v_any_hold and public.legal_hold_active(p_tenant_id, r.phone_digits, null, null)) returning 1) select count(*) into p from d;
        end if;
        v_results := v_results || jsonb_build_array(jsonb_build_object('record_type', v_type, 'table', 'tenant_campaign_scrub_rejections', 'rows_matched', m, 'rows_held', h, 'rows_purged', p, 'oldest', v_old, 'newest', v_new));
        v_held := v_held + h;
      end if;

    elsif v_type = 'transfer_verdicts' then
      select count(*), count(*) filter (where (v_any_hold and public.legal_hold_active(p_tenant_id, v.phone_digits, null, null))), min(v.evaluated_at), max(v.evaluated_at) into m, h, v_old, v_new
        from public.transfer_verdict v cross join lateral (select coalesce(v_rules->v.carrier_state, v_rules->'**') r) rr
       where v.tenant_id = p_tenant_id and rr.r->>'action' = 'purge' and v.evaluated_at < now() - make_interval(days => (rr.r->>'days')::int);
      p := 0;
      if v_live then
        with d as (delete from public.transfer_verdict v
                    where v.tenant_id = p_tenant_id and coalesce(v_rules->v.carrier_state, v_rules->'**')->>'action' = 'purge'
                      and v.evaluated_at < now() - make_interval(days => (coalesce(v_rules->v.carrier_state, v_rules->'**')->>'days')::int)
                      and not (v_any_hold and public.legal_hold_active(p_tenant_id, v.phone_digits, null, null)) returning 1) select count(*) into p from d;
      end if;
      v_results := v_results || jsonb_build_array(jsonb_build_object('record_type', v_type, 'table', 'transfer_verdict', 'rows_matched', m, 'rows_held', h, 'rows_purged', p, 'oldest', v_old, 'newest', v_new));
      v_held := v_held + h;

    elsif v_type = 'lead_data_unconverted' then
      -- Never converted: no submitted application, no client with a policy. The row stays (vendor cost
      -- reporting counts it); the person's fields go. The number stays only while a call or consent
      -- record still within its own retention points at the lead.
      create temp table if not exists retention_due (id uuid, held boolean, at timestamptz) on commit drop;
      truncate retention_due;
      insert into retention_due
      select l.id, (v_any_hold and public.legal_hold_active_for_lead(p_tenant_id, l.id, public.compliance_lead_phone(l.values))), l.created_at
        from public.agent_leads l
        cross join lateral (select coalesce(v_rules->upper(l.values->>'state'), v_rules->'**') r) rr
       where l.tenant_id = p_tenant_id and rr.r->>'action' in ('purge', 'anonymise')
         and l.created_at < now() - make_interval(days => (rr.r->>'days')::int)
         and not (l.values ? '_retention_purged') and not (l.values ? '_erased')
         and not exists (select 1 from public.tenant_applications a where a.tenant_id = l.tenant_id and a.lead_id = l.id and a.submitted_at is not null)
         and not exists (select 1 from public.policy_current pc where pc.tenant_id = l.tenant_id and l.contact_id is not null and pc.contact_id = l.contact_id);
      select count(*), count(*) filter (where held), min(at), max(at) into m, h, v_old, v_new from retention_due;
      p := 0;
      if v_live then
        with u as (
          update public.agent_leads l
             set values = jsonb_strip_nulls(jsonb_build_object(
                   '_retention_purged', now()::date,
                   'state', l.values->>'state',
                   'phone', case when exists (select 1 from public.tenant_call_attempts a where a.lead_id = l.id)
                                   or exists (select 1 from public.tenant_consent_artefacts c where c.lead_id = l.id)
                                 then l.values->>'phone' end))
            from retention_due x where l.id = x.id and not x.held
          returning 1) select count(*) into p from u;
      end if;
      v_results := v_results || jsonb_build_array(jsonb_build_object('record_type', v_type, 'table', 'agent_leads', 'rows_matched', m, 'rows_held', h, 'rows_purged', p, 'oldest', v_old, 'newest', v_new,
                                                                     'note', 'Personal fields removed; the row stays for vendor cost reporting.'));
      v_held := v_held + h;

    elsif v_type = 'nurture_winback_candidates' then
      if v_rules->'**'->>'action' = 'purge' then
        select count(*), 0, min(w.created_at), max(w.created_at) into m, h, v_old, v_new
          from public.winback_candidate w where w.tenant_id = p_tenant_id and w.created_at < now() - make_interval(days => (v_rules->'**'->>'days')::int);
        select count(*) into h from public.winback_candidate w
         where w.tenant_id = p_tenant_id and w.created_at < now() - make_interval(days => (v_rules->'**'->>'days')::int)
           and (v_any_hold and public.legal_hold_active(p_tenant_id, null, null, w.source_policy_number));
        p := 0;
        if v_live then
          with d as (delete from public.winback_candidate w where w.tenant_id = p_tenant_id and w.created_at < now() - make_interval(days => (v_rules->'**'->>'days')::int)
                       and not (v_any_hold and public.legal_hold_active(p_tenant_id, null, null, w.source_policy_number)) returning 1) select count(*) into p from d;
        end if;
        v_results := v_results || jsonb_build_array(jsonb_build_object('record_type', v_type, 'table', 'winback_candidate', 'rows_matched', m, 'rows_held', h, 'rows_purged', p, 'oldest', v_old, 'newest', v_new));
        v_held := v_held + h;
      end if;

    elsif v_type = 'complaint_records' then
      select count(*), count(*) filter (where (v_any_hold and public.legal_hold_active(p_tenant_id, c.phone_digits, c.contact_id, c.policy_number))), min(c.received_at), max(c.received_at) into m, h, v_old, v_new
        from public.complaint c cross join lateral (select coalesce(v_rules->c.regulator_state, v_rules->'**') r) rr
       where c.tenant_id = p_tenant_id and c.status = 'resolved' and c.complainant_name is distinct from null
         and c.received_at < now() - make_interval(days => (rr.r->>'days')::int);
      p := 0;
      if v_live then
        with u as (update public.complaint c set complainant_name = null, phone_digits = null, contact_id = null, policy_number = null,
                          summary = 'Anonymised under the retention schedule.', response_text = case when c.response_text is null then null else 'Anonymised under the retention schedule.' end,
                          attachments_json = '[]'::jsonb, response_attachments_json = '[]'::jsonb, notes = null
                    where c.tenant_id = p_tenant_id and c.status = 'resolved' and c.complainant_name is distinct from null
                      and c.received_at < now() - make_interval(days => (coalesce(v_rules->c.regulator_state, v_rules->'**')->>'days')::int)
                      and not (v_any_hold and public.legal_hold_active(p_tenant_id, c.phone_digits, c.contact_id, c.policy_number)) returning 1) select count(*) into p from u;
      end if;
      v_results := v_results || jsonb_build_array(jsonb_build_object('record_type', v_type, 'table', 'complaint', 'rows_matched', m, 'rows_held', h, 'rows_purged', p, 'oldest', v_old, 'newest', v_new, 'note', 'Anonymised, kept.'));
      v_held := v_held + h;

    elsif v_type = 'policy_commission_records' then
      -- Policies that ended more than the period ago: the person's identifiers are erased from the
      -- carrier rows behind them; the money and the policy stay.
      m := 0; h := 0; p := 0; v_old := null; v_new := null;
      for pol in
        select pc.carrier_id, pc.policy_number, pc.contact_id, coalesce(pc.termination_date, pc.lapsed_on) as ended,
               (v_any_hold and public.legal_hold_active(p_tenant_id, null, pc.contact_id, pc.policy_number)) as held
          from public.policy_current pc
          cross join lateral (select v_rules->'**' r) rr
         where pc.tenant_id = p_tenant_id and coalesce(pc.termination_date, pc.lapsed_on) is not null and rr.r->>'action' = 'anonymise'
           and coalesce(pc.termination_date, pc.lapsed_on) < (now() - make_interval(days => (rr.r->>'days')::int))::date
           and pc.contact_id is not null
      loop
        m := m + 1;
        v_old := least(coalesce(v_old, pol.ended), pol.ended);
        v_new := greatest(coalesce(v_new, pol.ended), pol.ended);
        if pol.held then h := h + 1; continue; end if;
        if v_live then
          v_tokens := public.data_subject_discover(p_tenant_id, null, null, pol.contact_id);
          perform set_config('app.data_subject_deletion', 'retention', true);
          update public.raw_rows r set payload = public.erase_matching_values(r.payload, array(select jsonb_array_elements_text(v_tokens->'tokens')), array(select jsonb_array_elements_text(v_tokens->'digits')))
            from public.policy_snapshot s where s.tenant_id = p_tenant_id and s.carrier_id = pol.carrier_id and s.policy_number = pol.policy_number and r.id = s.raw_row_id;
          update public.policy_snapshot s set extra = public.erase_matching_values(s.extra, array(select jsonb_array_elements_text(v_tokens->'tokens')), array(select jsonb_array_elements_text(v_tokens->'digits')))
           where s.tenant_id = p_tenant_id and s.carrier_id = pol.carrier_id and s.policy_number = pol.policy_number;
          update public.policy_current pc set extra = public.erase_matching_values(pc.extra, array(select jsonb_array_elements_text(v_tokens->'tokens')), array(select jsonb_array_elements_text(v_tokens->'digits')))
           where pc.tenant_id = p_tenant_id and pc.carrier_id = pol.carrier_id and pc.policy_number = pol.policy_number;
          perform set_config('app.data_subject_deletion', '', true);
          p := p + 1;
        end if;
      end loop;
      v_results := v_results || jsonb_build_array(jsonb_build_object('record_type', v_type, 'table', 'policy_current', 'rows_matched', m, 'rows_held', h, 'rows_purged', p, 'oldest', v_old, 'newest', v_new,
                                                                     'note', 'Anonymised, kept: the carrier rows behind each policy lose the person''s identifiers.'));
      v_held := v_held + h;

    elsif v_type = 'compliance_evidence_reports' then
      v_results := v_results || jsonb_build_array(jsonb_build_object('record_type', v_type, 'table', null, 'rows_matched', 0, 'rows_held', 0, 'rows_purged', 0,
                                                                     'note', 'No report copies are stored; each report is generated from the index when asked for.'));
    end if;
  end loop;

  -- Stated, never run: the do-not-call list.
  v_results := v_results || jsonb_build_array(jsonb_build_object('record_type', 'internal_dnc', 'table', 'tenant_do_not_call', 'rows_matched', 0, 'rows_held', 0, 'rows_purged', 0, 'note', 'Never deleted.'));
  update public.retention_run set finished_at = now(), results_json = v_results, held_count = v_held, unruled = v_unruled where id = v_run;
  -- The win-back guard's exception ends with this run.
  perform set_config('app.retention_purge', '', true);
  return v_run;
end $function$;

do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc where oid = 'public.retention_execute(uuid,text,text)'::regprocedure;
  if v_src not like '%v_any_hold boolean := exists%' then raise exception 'retention_execute has no up-front hold check'; end if;
  if (length(v_src) - length(replace(v_src, '(v_any_hold and public.legal_hold_active', ''))) / length('(v_any_hold and public.legal_hold_active') <> 15 then
    raise exception 'retention_execute: not every hold check is guarded';
  end if;
  if v_src like '%checks_json @> jsonb_build_array%' then raise exception 'retention_execute still searches each verdict per consent'; end if;
  if to_regclass('public.screening_audit_tenant_ts_idx') is null then raise exception 'screening_audit_tenant_ts_idx is missing'; end if;
end $$;
