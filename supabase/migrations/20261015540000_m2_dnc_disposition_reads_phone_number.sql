-- M2 audit (LA-2.3 / LA-2.9) · a Do not call outcome suppresses the number the dialer actually dialled.
--
-- The dialer resolves a lead's number as `values.phone ?? values.phone_number`, normalised
-- (lib/dialerScripts/service.ts leadPhone + normalizeDialPhone). The four live functions that record
-- a Do not call read `values->>'phone'` alone, so a lead whose file stored its number under
-- `phone_number` was dialled, marked Do not call, closed — and never added to the do-not-call list.
-- It could then be dialled again from any other lead or list carrying the same number. That is the
-- exact TCPA exposure the outcome exists to remove.
--
--   complete_existing_dial_disposition  the dialer's outcome (live path)
--   apply_lead_disposition_move         Do not call chosen on a pipeline board / table / lead page
--   complete_disposition                the disposition wizard (LA-1)
--   complete_dial_disposition           the older dialer path, still installed
--
-- An IN-PLACE edit of each live body (pg_get_functiondef, CRLF normalised first because bodies
-- pasted through the SQL editor are stored with CRLF): one single-line anchor per function,
-- counted, replaced once. Everything else in each body — including every later patch — is kept.
-- Re-running is a no-op. suppress_phone and complete_disposition already normalise the digits, so the
-- expression only has to choose the same field the dialer chose; a blank `phone` falls through to
-- `phone_number` rather than being suppressed as nothing.

do $$
declare
  v_sigs text[] := array[
    'public.complete_existing_dial_disposition(uuid,uuid,uuid,text,timestamptz,text)',
    'public.apply_lead_disposition_move(uuid,uuid,text,uuid,text)',
    'public.complete_disposition(uuid,uuid,uuid,uuid,text,text)',
    'public.complete_dial_disposition(uuid,uuid,uuid,text,timestamptz,text)'
  ];
  v_anchors text[] := array[
    'v_phone := v_lead.values->>''phone'';',
    'l.stage_id, l.partner_id, l.values->>''phone'' as phone into v_lead',
    'select l.values->>''phone'',',
    'select l.values->>''phone'', l.values->>''state'''
  ];
  v_news text[] := array[
    'v_phone := coalesce(nullif(btrim(v_lead.values->>''phone''), ''''), nullif(btrim(v_lead.values->>''phone_number''), ''''));',
    'l.stage_id, l.partner_id, coalesce(nullif(btrim(l.values->>''phone''), ''''), nullif(btrim(l.values->>''phone_number''), '''')) as phone into v_lead',
    'select coalesce(nullif(btrim(l.values->>''phone''), ''''), nullif(btrim(l.values->>''phone_number''), '''')),',
    'select coalesce(nullif(btrim(l.values->>''phone''), ''''), nullif(btrim(l.values->>''phone_number''), '''')), l.values->>''state'''
  ];
  v_sig regprocedure;
  v_body text;
  v_count integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20261015540000: skipped, % cannot create in public', current_user;
    return;
  end if;
  for i in 1 .. array_length(v_sigs, 1) loop
    v_sig := to_regprocedure(v_sigs[i]);
    if v_sig is null then
      raise exception '20261015540000: % is not installed', v_sigs[i];
    end if;
    v_body := replace(pg_get_functiondef(v_sig), E'\r\n', E'\n');
    if position(v_news[i] in v_body) > 0 then
      raise notice '20261015540000: % already reads phone_number', v_sigs[i];
      continue;
    end if;
    v_count := (length(v_body) - length(replace(v_body, v_anchors[i], ''))) / length(v_anchors[i]);
    if v_count <> 1 then
      raise exception '20261015540000: expected the phone read once in %, found %', v_sigs[i], v_count;
    end if;
    execute replace(v_body, v_anchors[i], v_news[i]);
  end loop;
end
$$;

-- ─── self-check ──────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_sigs text[] := array[
    'public.complete_existing_dial_disposition(uuid,uuid,uuid,text,timestamptz,text)',
    'public.apply_lead_disposition_move(uuid,uuid,text,uuid,text)',
    'public.complete_disposition(uuid,uuid,uuid,uuid,text,text)',
    'public.complete_dial_disposition(uuid,uuid,uuid,text,timestamptz,text)'
  ];
  v_body text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20261015540000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  for i in 1 .. array_length(v_sigs, 1) loop
    v_body := replace(pg_get_functiondef(to_regprocedure(v_sigs[i])), E'\r\n', E'\n');
    if position('values->>''phone_number''' in v_body) = 0 then
      raise exception '20261015540000: % still reads values->>''phone'' alone', v_sigs[i];
    end if;
    -- Every read of the lead's phone in the body is the resolved one, never the bare key.
    if (length(v_body) - length(replace(v_body, 'values->>''phone''', ''))) / length('values->>''phone''')
       <> (length(v_body) - length(replace(v_body, 'nullif(btrim(v_lead.values->>''phone''), '''')', ''))) / length('nullif(btrim(v_lead.values->>''phone''), '''')')
        + (length(v_body) - length(replace(v_body, 'nullif(btrim(l.values->>''phone''), '''')', ''))) / length('nullif(btrim(l.values->>''phone''), '''')') then
      raise exception '20261015540000: % has a bare values->>''phone'' read left', v_sigs[i];
    end if;
  end loop;
  -- The DNC branches themselves are unchanged.
  if position('suppress_phone(p_tenant_id, v_phone, ''internal'', ''Agent recorded do not call on the dialer''' in
       pg_get_functiondef('public.complete_existing_dial_disposition(uuid,uuid,uuid,text,timestamptz,text)'::regprocedure)) = 0 then
    raise exception '20261015540000: the dialer''s do-not-call write changed';
  end if;
  if position('public.suppress_phone(p_tenant_id, v_lead.phone, ''internal''' in
       pg_get_functiondef('public.apply_lead_disposition_move(uuid,uuid,text,uuid,text)'::regprocedure)) = 0 then
    raise exception '20261015540000: the board''s do-not-call write changed';
  end if;
end
$$;
