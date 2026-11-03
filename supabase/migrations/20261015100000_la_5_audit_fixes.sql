-- LA-5 audit fixes (2026-10-15). Each change is one the audit of LA-5.4, 5.6 and 5.7 against the
-- Notion tasks found; the functions are otherwise exactly as their own migrations left them.
--
--   la5_agency_today(tenant)          the agency's own calendar day (agency_profiles.timezone; UTC when
--                                     unset or not a real zone). Deadlines stop running on UTC, which is
--                                     already tomorrow in a US evening.
--   servicing_norm_address(text)      "123 Main Street, Apt. 4" and "123 MAIN ST APT 4" are one address.
--   verify_servicing_requests         · a field the carrier's file cannot show no longer blocks the ones
--                                       it can: a paper bill switched to bank draft verifies on the payment
--                                       method even when the carrier sends no draft day (most don't);
--                                     · addresses and ZIPs compare normalised, not as exact text;
--                                     · a request fails only against a file dated on or after the change was
--                                       due — an older file can no longer fail it after the grace period.
--   sync_reinstatement_cases          · counts and expires on the agency's day;
--                                     · a case opened before its carrier's window was known gets its deadline
--                                       when one is configured, instead of waiting forever.
--   winback_reason_category           · "didn't like the death benefit" is not a death;
--                                     · "closed it, don't want it" is no longer wanted, not administrative.
--
-- Requires 20261014200000, 20261014400000, 20261014500000 (all live). Replaces functions only.
--
-- Rollback: re-run the three functions' definitions from those migrations, then
--   drop function if exists public.servicing_norm_address(text);
--   drop function if exists public.la5_agency_today(uuid);

create or replace function public.la5_agency_today(p_tenant_id uuid)
returns date
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_zone text;
begin
  select ap.timezone into v_zone from public.agency_profiles ap where ap.tenant_id = p_tenant_id;
  begin
    return (now() at time zone coalesce(nullif(btrim(v_zone), ''), 'UTC'))::date;
  exception when others then
    return (now() at time zone 'UTC')::date;
  end;
end;
$$;
revoke all on function public.la5_agency_today(uuid) from public, anon, authenticated;
grant execute on function public.la5_agency_today(uuid) to service_role;

create or replace function public.servicing_norm_address(p_text text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v text := ' ' || upper(regexp_replace(coalesce(p_text, ''), '[.,#]', ' ', 'g')) || ' ';
  pair text[];
begin
  v := regexp_replace(v, '\s+', ' ', 'g');
  foreach pair slice 1 in array array[
    ['STREET', 'ST'], ['AVENUE', 'AVE'], ['ROAD', 'RD'], ['DRIVE', 'DR'], ['LANE', 'LN'], ['BOULEVARD', 'BLVD'],
    ['COURT', 'CT'], ['PLACE', 'PL'], ['APARTMENT', 'APT'], ['SUITE', 'STE'],
    ['NORTH', 'N'], ['SOUTH', 'S'], ['EAST', 'E'], ['WEST', 'W']]
  loop
    v := replace(v, ' ' || pair[1] || ' ', ' ' || pair[2] || ' ');
  end loop;
  return nullif(btrim(v), '');
end;
$$;
revoke all on function public.servicing_norm_address(text) from public, anon, authenticated;
grant execute on function public.servicing_norm_address(text) to service_role;


create or replace function public.verify_servicing_requests(p_tenant_id uuid default null, p_carrier_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
      if r.requested_by is not null then
        insert into public.agent_notifications (tenant_id, recipient_user_id, kind, title, body, link, source_key)
        values (r.tenant_id, r.requested_by, 'servicing_failed', 'A fix did not take: ' || r.policy_number, left(v_reason, 1000), '/app/servicing?status=failed', 'servicing-failed:' || r.id)
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
$$;


create or replace function public.sync_reinstatement_cases(p_tenant_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_opened integer := 0;
  v_reinstated integer := 0;
  v_expired integer := 0;
  v_alerts integer := 0;
  r record;
  v_crossed integer[];
  v_new integer[];
  v_recipient uuid;
  v_days integer;
begin
  perform set_config('app.reinstatement_sync', 'on', true);

  -- 1. Open a case for every lapse inside its carrier window. With no window configured, only a lapse
  --    the newest file brought (nothing is invented about an old one).
  with lapses as (
    select pc.tenant_id, pc.agency_id, pc.carrier_id, pc.policy_number, pc.contact_id, pc.lapsed_on, pc.last_snapshot_date,
           (select case when own.cleared then plat.window_days else coalesce(own.window_days, plat.window_days) end
              from (select 1) one
              left join lateral (
                select r1.window_days, r1.cleared from public.carrier_retention_rule r1
                 where r1.tenant_id = pc.tenant_id and r1.carrier_id = pc.carrier_id and r1.rule_type = 'reinstatement' and r1.effective_from <= public.la5_agency_today(pc.tenant_id)
                 order by r1.effective_from desc, r1.created_at desc limit 1) own on true
              left join lateral (
                select r2.window_days from public.carrier_retention_rule r2
                 where r2.tenant_id is null and r2.carrier_id = pc.carrier_id and r2.rule_type = 'reinstatement' and r2.effective_from <= public.la5_agency_today(pc.tenant_id)
                 order by r2.effective_from desc, r2.created_at desc limit 1) plat on true) as window_days
      from public.policy_current pc
     where pc.status_normalized = 'lapsed' and pc.lapsed_on is not null
       and (p_tenant_id is null or pc.tenant_id = p_tenant_id)
  ), opened as (
    insert into public.reinstatement_case (tenant_id, agency_id, carrier_id, policy_number, contact_id, lapsed_on, window_days, deadline)
    select l.tenant_id, l.agency_id, l.carrier_id, l.policy_number, l.contact_id, l.lapsed_on, l.window_days, l.lapsed_on + l.window_days
      from lapses l
     where (l.window_days is not null and l.lapsed_on + l.window_days >= public.la5_agency_today(l.tenant_id))
        or (l.window_days is null and l.lapsed_on = l.last_snapshot_date)
    on conflict (tenant_id, carrier_id, policy_number, lapsed_on) do nothing
    returning 1
  )
  select count(*) into v_opened from opened;

  -- 1b. A case opened before its carrier's window was known gets its deadline once one is configured
  --     (LA-4.17), so it can count down and close instead of waiting forever.
  update public.reinstatement_case c set window_days = l.window_days, deadline = c.lapsed_on + l.window_days
    from (select pc.tenant_id, pc.carrier_id, pc.policy_number,
                 (select case when own.cleared then plat.window_days else coalesce(own.window_days, plat.window_days) end
                    from (select 1) one
                    left join lateral (
                      select r1.window_days, r1.cleared from public.carrier_retention_rule r1
                       where r1.tenant_id = pc.tenant_id and r1.carrier_id = pc.carrier_id and r1.rule_type = 'reinstatement' and r1.effective_from <= public.la5_agency_today(pc.tenant_id)
                       order by r1.effective_from desc, r1.created_at desc limit 1) own on true
                    left join lateral (
                      select r2.window_days from public.carrier_retention_rule r2
                       where r2.tenant_id is null and r2.carrier_id = pc.carrier_id and r2.rule_type = 'reinstatement' and r2.effective_from <= public.la5_agency_today(pc.tenant_id)
                       order by r2.effective_from desc, r2.created_at desc limit 1) plat on true) as window_days
            from public.policy_current pc
           where (p_tenant_id is null or pc.tenant_id = p_tenant_id)) l
   where c.deadline is null and c.status in ('identified', 'contacted', 'client_agreed', 'submitted')
     and (p_tenant_id is null or c.tenant_id = p_tenant_id)
     and l.tenant_id = c.tenant_id and l.carrier_id = c.carrier_id and l.policy_number = c.policy_number
     and l.window_days is not null;

  -- 2. Reinstated: a newer file shows the policy back in force. The file proves it, not a call.
  with back as (
    update public.reinstatement_case c set status = 'reinstated', resolved_at = now()
      from public.policy_current pc
     where c.status in ('identified', 'contacted', 'client_agreed', 'submitted')
       and (p_tenant_id is null or c.tenant_id = p_tenant_id)
       and pc.tenant_id = c.tenant_id and pc.carrier_id = c.carrier_id and pc.policy_number = c.policy_number
       and pc.status_normalized in ('active', 'at_risk', 'paid_up')
       and pc.last_snapshot_date > c.lapsed_on
    returning 1
  )
  select count(*) into v_reinstated from back;

  -- 3. Expired: the window closed. Counted apart from declines.
  with gone as (
    update public.reinstatement_case c set status = 'expired', resolved_at = now()
     where c.status in ('identified', 'contacted', 'client_agreed', 'submitted')
       and (p_tenant_id is null or c.tenant_id = p_tenant_id)
       and c.deadline is not null and c.deadline < public.la5_agency_today(c.tenant_id)
    returning 1
  )
  select count(*) into v_expired from gone;

  -- 4. Alerts as the deadline nears: once per threshold; a case found already late gets one alert, for the nearest.
  for r in
    select c.*, coalesce(rs.reinstatement_amber_days, 14) as amber, coalesce(rs.reinstatement_red_days, 7) as red, coalesce(rs.reinstatement_pin_days, 3) as pin, pc.agent_user_id
      from public.reinstatement_case c
      left join public.retention_settings rs on rs.tenant_id = c.tenant_id
      left join public.policy_current pc on pc.tenant_id = c.tenant_id and pc.carrier_id = c.carrier_id and pc.policy_number = c.policy_number
     where c.status in ('identified', 'contacted', 'client_agreed', 'submitted')
       and (p_tenant_id is null or c.tenant_id = p_tenant_id)
       and c.deadline is not null
       and c.deadline - public.la5_agency_today(c.tenant_id) <= coalesce(rs.reinstatement_amber_days, 14)
  loop
    v_days := r.deadline - public.la5_agency_today(r.tenant_id);
    v_crossed := array(select t from unnest(array[r.amber, r.red, r.pin]) t where v_days <= t);
    v_new := array(select t from unnest(v_crossed) t where not (t = any (r.alerted_days)));
    if cardinality(v_new) = 0 then continue; end if;

    select tu.user_id into v_recipient from public.tenant_users tu join public.users u on u.id = tu.user_id
     where tu.tenant_id = r.tenant_id and u.status = 'active' and tu.user_id = coalesce(r.worked_by, r.agent_user_id) and tu.role::text in ('owner', 'producer');
    if v_recipient is null then
      select tu.user_id into v_recipient from public.tenant_users tu join public.users u on u.id = tu.user_id
       where tu.tenant_id = r.tenant_id and tu.role::text = 'owner' and u.status = 'active'
       order by tu.accepted_at nulls last, tu.invited_at nulls last, tu.user_id limit 1;
    end if;
    if v_recipient is not null then
      insert into public.agent_notifications (tenant_id, recipient_user_id, kind, title, body, link, source_key)
      values (r.tenant_id, v_recipient, 'reinstatement_closing',
              case when v_days <= 0 then 'Reinstatement window closes today: ' || r.policy_number
                   else 'Reinstatement window closes in ' || v_days || (case when v_days = 1 then ' day: ' else ' days: ' end) || r.policy_number end,
              'Policy ' || r.policy_number || ' lapsed on ' || to_char(r.lapsed_on, 'FMDD Mon') || '. The carrier stops taking it back after ' || to_char(r.deadline, 'FMDD Mon') || '. After that it is gone for good.',
              '/app/reinstatement', 'reinstatement:' || r.id || ':' || (select min(t) from unnest(v_new) t))
      on conflict (tenant_id, recipient_user_id, source_key) do nothing;
      v_alerts := v_alerts + 1;
    end if;
    update public.reinstatement_case set alerted_days = (select array_agg(distinct t order by t) from unnest(r.alerted_days || v_crossed) t) where id = r.id;
  end loop;

  return jsonb_build_object('opened', v_opened, 'reinstated', v_reinstated, 'expired', v_expired, 'alerts', v_alerts);
end;
$$;


create or replace function public.winback_reason_category(p_text text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_text is null or btrim(p_text) = '' then null
    when p_text ~* '\m(died|passed away|deceased|funeral)\M' or (p_text ~* '\mdeath\M' and p_text !~* '\mdeath benefits?\M') then 'deceased'
    when p_text ~* '(do not (call|contact)|don''?t (call|contact)|stop calling|never call|remove (me|her|him|them)|complain|harass)' then 'do_not_contact'
    when p_text ~* '(afford|money|expensive|too much|cost|price|budget|income|can''?t pay|cannot pay)' then 'affordability'
    when p_text ~* '(don''?t want|do not want|no longer (want|need)|not interested|changed (her|his|their|my) mind|other (policy|coverage)|already covered)' then 'no_longer_wanted'
    when p_text ~* '\m(bank|card|account|moved|address|closed)\M' then 'administrative'
    when p_text ~* '(no longer|cancel)' then 'no_longer_wanted'
    else null
  end;
$$;


-- ─── self-check ─────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v jsonb;
begin
  if public.servicing_norm_address('123 Main Street, Apt. 4') is distinct from public.servicing_norm_address('123 MAIN ST APT 4')
     or public.servicing_norm_address('9 North Oak Avenue') is distinct from public.servicing_norm_address('9 N OAK AVE')
     or public.servicing_norm_address('123 Main St') = public.servicing_norm_address('124 Main St') then
    raise exception '20261015100000: address normalising is wrong';
  end if;
  if public.winback_reason_category('She didn''t like the death benefit') is not distinct from 'deceased'
     or public.winback_reason_category('I closed it, don''t want it') is distinct from 'no_longer_wanted'
     or public.winback_reason_category('Her husband passed away') is distinct from 'deceased'
     or public.winback_reason_category('Death claim filed by the family') is distinct from 'deceased'
     or public.winback_reason_category('Bank account closed') is distinct from 'administrative'
     or public.winback_reason_category('She said they could not afford it') is distinct from 'affordability'
     or public.winback_reason_category('Asked us to stop calling') is distinct from 'do_not_contact'
     or public.winback_reason_category('Cancelled, has other coverage now') is distinct from 'no_longer_wanted'
     or public.winback_reason_category('Just because') is not null then
    raise exception '20261015100000: the reason classifier is wrong';
  end if;
  if public.la5_agency_today('00000000-0000-0000-0000-000000000000') is null then
    raise exception '20261015100000: the agency day is null';
  end if;
  -- Run both jobs once, as cron will, and roll them back.
  begin
    v := public.verify_servicing_requests();
    if v ? 'verified' is not true then raise exception '20261015100000: the servicing check did not report'; end if;
    v := public.sync_reinstatement_cases();
    if v ? 'opened' is not true then raise exception '20261015100000: the reinstatement check did not report'; end if;
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
end $$;
