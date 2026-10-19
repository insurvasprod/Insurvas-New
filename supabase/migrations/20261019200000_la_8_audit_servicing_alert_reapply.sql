-- LA-8 audit · re-apply the one piece of 20261015640000 that is not live (found 2026-10-19).
--
-- The full-catalog check of 2026-10-19 found 20261015640000 live in every part but one: the live
-- verify_servicing_requests still sends "A fix did not take" to the requester only, so its own self-check
-- ("still alerts only the requester") fails against live. The live body otherwise matches the file line
-- for line (78 of 80 lines), so this restates the function exactly as 20261015640000 wrote it. The only
-- difference from live is the recipient: whoever follows the request up now (the handover's taker), else
-- whoever asked. Nothing else in 20261015640000 is re-run.
--
-- Rollback: re-run verify_servicing_requests from 20261015100000.

CREATE OR REPLACE FUNCTION public.verify_servicing_requests(p_tenant_id uuid DEFAULT NULL::uuid, p_carrier_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r record;
  c jsonb;
  v_snap public.policy_snapshot%rowtype;
  v_grace integer;
  v_deadline date;
  v_field text;
  v_want text;
  v_have text;
  v_all_match boolean;
  v_unprovable jsonb;
  v_mismatch_field text;
  v_mismatch_have text;
  v_proven integer;
  v_reason text;
  v_verified integer := 0;
  v_failed integer := 0;
  v_waiting integer := 0;
  v_unprovable_count integer := 0;
  v_policies jsonb := '[]'::jsonb;
begin
  perform set_config('app.servicing_verifier', 'on', true);
  for r in
    select q.* from public.servicing_request q
     where q.status in ('submitted', 'awaiting_carrier', 'confirmed_by_carrier')
       and (p_tenant_id is null or q.tenant_id = p_tenant_id)
       and (p_carrier_id is null or q.carrier_id = p_carrier_id)
     order by q.tenant_id, q.created_at
     for update
  loop
    -- The newest file for this policy dated on or after the request was sent.
    select s.* into v_snap from public.policy_snapshot s
     where s.tenant_id = r.tenant_id and s.carrier_id = r.carrier_id and s.policy_number = r.policy_number
       and not s.superseded and s.snapshot_date >= (r.submitted_at at time zone 'UTC')::date
     order by s.snapshot_date desc limit 1;
    if not found then
      v_waiting := v_waiting + 1;
      continue;
    end if;

    v_all_match := true;
    v_proven := 0;
    v_unprovable := '[]'::jsonb;
    v_mismatch_field := null;
    v_mismatch_have := null;
    for c in select * from jsonb_array_elements(r.field_changes_json) loop
      v_field := c->>'field';
      v_want := c->>'to';
      v_have := case when v_field = 'payment_method' then v_snap.payment_method else v_snap.extra->'fields'->>v_field end;
      if v_have is null then
        v_unprovable := v_unprovable || to_jsonb(v_field);
      elsif v_want is null then
        v_all_match := false;
      elsif (v_have ~ '^\d+(\.0+)?$' and v_want ~ '^\d+(\.0+)?$' and v_have::numeric = v_want::numeric)
         or lower(regexp_replace(btrim(v_have), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(v_want), '\s+', ' ', 'g'))
         or (v_field = 'insured_address' and public.servicing_norm_address(v_have) = public.servicing_norm_address(v_want))
         or (v_field = 'insured_zip' and left(regexp_replace(v_have, '\D', '', 'g'), 5) = left(regexp_replace(v_want, '\D', '', 'g'), 5)) then
        v_proven := v_proven + 1;
      else
        v_all_match := false;
        if v_mismatch_field is null then
          v_mismatch_field := v_field;
          v_mismatch_have := v_have;
        end if;
      end if;
    end loop;

    if v_all_match and v_proven > 0 then
      update public.servicing_request set status = 'verified_in_file', verified_at = now(), verified_snapshot_date = v_snap.snapshot_date,
             checked_snapshot_date = v_snap.snapshot_date, unprovable_fields = v_unprovable
       where id = r.id;
      v_verified := v_verified + 1;
      v_policies := v_policies || jsonb_build_object('tenant_id', r.tenant_id, 'carrier_id', r.carrier_id, 'policy_number', r.policy_number);
      continue;
    end if;

    select coalesce((select rs.servicing_grace_days from public.retention_settings rs where rs.tenant_id = r.tenant_id), 10) into v_grace;
    v_deadline := coalesce(r.expected_effective_date, (r.submitted_at at time zone 'UTC')::date + 30) + v_grace;

    -- A field the file cannot show is never a failure: it waits, and says why.
    if v_mismatch_field is not null and public.la5_agency_today(r.tenant_id) > v_deadline
       and v_snap.snapshot_date >= coalesce(r.expected_effective_date, (r.submitted_at at time zone 'UTC')::date) then
      v_reason := format('%s was %s on %s and the carrier file of %s still shows %s %s.',
        case r.request_type when 'draft_date_change' then 'The draft date change' when 'payment_method_change' then 'The payment change'
             when 'bill_to_draft_conversion' then 'The switch to bank draft' else 'The address change' end,
        case when r.carrier_confirmed_at is not null then 'confirmed by the carrier' else 'sent' end,
        to_char(coalesce(r.carrier_confirmed_at, r.submitted_at), 'FMDD Mon'),
        to_char(v_snap.snapshot_date, 'FMDD Mon'),
        case v_mismatch_field when 'draft_day' then 'draft day' when 'payment_method' then 'payment method' when 'insured_address' then 'the address'
             when 'insured_zip' then 'ZIP' when 'insured_state' then 'state' else replace(v_mismatch_field, '_', ' ') end,
        case when v_mismatch_field = 'payment_method' then replace(v_mismatch_have, '_', ' ') else v_mismatch_have end);
      update public.servicing_request set status = 'failed', failed_at = now(), failure_reason = left(v_reason, 500),
             checked_snapshot_date = v_snap.snapshot_date, unprovable_fields = v_unprovable
       where id = r.id;
      -- [audit] who follows the request up now (the handover's taker), else who asked
      if coalesce(r.assigned_to, r.requested_by) is not null then
        insert into public.agent_notifications (tenant_id, recipient_user_id, kind, title, body, link, source_key)
        values (r.tenant_id, coalesce(r.assigned_to, r.requested_by), 'servicing_failed', 'A fix did not take: ' || r.policy_number, left(v_reason, 1000), '/app/servicing?status=failed', 'servicing-failed:' || r.id)
        on conflict (tenant_id, recipient_user_id, source_key) do nothing;
      end if;
      v_failed := v_failed + 1;
    else
      update public.servicing_request set checked_snapshot_date = v_snap.snapshot_date, unprovable_fields = v_unprovable
       where id = r.id and (checked_snapshot_date is distinct from v_snap.snapshot_date or unprovable_fields is distinct from v_unprovable);
      if jsonb_array_length(v_unprovable) > 0 then v_unprovable_count := v_unprovable_count + 1; else v_waiting := v_waiting + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('verified', v_verified, 'failed', v_failed, 'waiting', v_waiting, 'unprovable', v_unprovable_count, 'verified_policies', v_policies);
end;
$function$;

revoke all on function public.verify_servicing_requests(uuid, uuid) from public, anon, authenticated;
grant execute on function public.verify_servicing_requests(uuid, uuid) to service_role;

-- ─── self-check ───────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if position('coalesce(r.assigned_to, r.requested_by)' in pg_get_functiondef('public.verify_servicing_requests(uuid, uuid)'::regprocedure)) = 0 then
    raise exception 'verify_servicing_requests still alerts only the requester';
  end if;
end;
$$;
