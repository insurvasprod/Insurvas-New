-- M1 LA-1.12-4 / M2 LA-2.9-3 · the dialer's outcomes become rows in the ONE disposition vocabulary.
--
-- Until now the dialer kept its own hard-coded list (the route's BUILT_IN_OUTCOMES and the
-- workspace's OUTBOUND_DISPOSITIONS): ten call outcomes plus the inbound return call, five of which
-- (no answer, voicemail, busy, wrong number, disconnected) had no tenant row at all, so Settings ›
-- Dispositions could neither rename nor retime them.
--
-- This file
--   1. adds dispositions.dialer_position, the button (and number key) an outcome sits on in the
--      dialer. Null = not a dialer button. Keys 1-9 pick positions 1-9 and key 0 picks position 10.
--   2. adds seed_dialer_outcomes(tenant), which inserts the missing outcomes with the SAME keys,
--      labels, next-action effects and keyboard order the dialer used, and puts the dialer positions
--      on the rows the tenant already had (callback, not interested, application, call dropped, do
--      not call). A tenant whose dialer set was already positioned is left exactly as it is, and an
--      existing row is never overwritten, so a tenant's own edits survive a re-run.
--   3. calls it from seed_default_dispositions, so every NEW tenant gets them too, and once for every
--      existing tenant.
--
-- Behaviour is unchanged. complete_existing_dial_disposition already reads the tenant row first and
-- falls back to disposition_default_ends_call only when there is none: no answer / voicemail / busy
-- are seeded with next action 'cadence' (ends_call false, the cadence branch they took before), and
-- wrong number / disconnected with 'close' (ends_call true, the vendor-claim branch they took
-- before). The inbound return call is handled by key before that lookup, so its row changes nothing.
-- None of them is mapped to a stage, so the inbound outcome wizard (listMappedOutcomes) does not
-- offer them and no lead is routed anywhere new.
--
-- The app works before this file is applied: lib/dialerScripts/outcomes.ts holds the pre-migration
-- list, used only while no tenant row carries a dialer position.

alter table public.dispositions add column if not exists dialer_position smallint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dispositions_dialer_position_range'
                  and conrelid = 'public.dispositions'::regclass) then
    alter table public.dispositions
      add constraint dispositions_dialer_position_range check (dialer_position is null or dialer_position between 1 and 99);
  end if;
end
$$;

create or replace function public.seed_dialer_outcomes(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_configured boolean;
begin
  -- Positioned already (this ran before, or the owner arranged the dialer): only add missing rows.
  select exists (select 1 from public.dispositions d
                  where d.tenant_id = p_tenant_id and d.dialer_position is not null)
    into v_configured;

  insert into public.dispositions
    (tenant_id, disposition_key, label, counts_as_work_completed, closes_as, sort_order, next_action, dialer_position)
  values
    (p_tenant_id, 'no_answer', 'No answer', false, 'dropped', 90, 'cadence', 1),
    (p_tenant_id, 'voicemail', 'Voicemail', false, 'dropped', 100, 'cadence', 5),
    (p_tenant_id, 'busy', 'Busy', false, 'dropped', 110, 'cadence', 6),
    (p_tenant_id, 'wrong_number', 'Wrong number', false, 'completed', 120, 'close', 9),
    (p_tenant_id, 'disconnected', 'Disconnected', false, 'completed', 130, 'close', 10),
    -- Offered only on the search path (the customer rang back), so it has no dialer position.
    (p_tenant_id, 'inbound_return_call', 'Inbound return call', false, 'completed', 140, 'cadence', null)
  on conflict (tenant_id, disposition_key) do nothing;

  if not v_configured then
    update public.dispositions d
       set dialer_position = v.pos
      from (values ('no_answer', 1), ('callback_scheduled', 2), ('not_interested', 3),
                   ('application_submitted', 4), ('voicemail', 5), ('busy', 6), ('call_dropped', 7),
                   ('do_not_call', 8), ('wrong_number', 9), ('disconnected', 10)) as v(key, pos)
     where d.tenant_id = p_tenant_id
       and d.disposition_key = v.key
       and d.dialer_position is null;
  end if;
end;
$function$;

revoke all on function public.seed_dialer_outcomes(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.seed_dialer_outcomes(uuid) to service_role;

-- Restated from the live body (20260912430000) with one line added: the dialer outcomes.
create or replace function public.seed_default_dispositions(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  insert into public.dispositions (tenant_id, disposition_key, label, counts_as_work_completed, closes_as, sort_order)
  values
    (p_tenant_id, 'application_submitted', 'Application submitted', true, 'completed', 10),
    (p_tenant_id, 'sent_to_underwriting', 'Sent to underwriting', true, 'completed', 20),
    (p_tenant_id, 'callback_scheduled', 'Callback scheduled', false, 'completed', 30),
    (p_tenant_id, 'did_not_qualify', 'Did not qualify', false, 'completed', 40),
    (p_tenant_id, 'no_payment_method', 'No payment method', false, 'completed', 50),
    (p_tenant_id, 'not_interested', 'Not interested', false, 'completed', 60),
    (p_tenant_id, 'do_not_call', 'Do not call', false, 'completed', 70),
    (p_tenant_id, 'call_dropped', 'Call dropped', false, 'dropped', 80)
  on conflict (tenant_id, disposition_key) do update set label = excluded.label, counts_as_work_completed = excluded.counts_as_work_completed, closes_as = excluded.closes_as, sort_order = excluded.sort_order, is_active = true;
  perform public.seed_default_disposition_flows(p_tenant_id);
  perform public.seed_dialer_outcomes(p_tenant_id);
end;
$function$;

revoke all on function public.seed_default_dispositions(uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.seed_default_dispositions(uuid) to service_role;

-- Every existing tenant, once. Small: six rows per tenant at most.
do $$
declare
  v_tenant uuid;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929200000: backfill skipped, % cannot create in public', current_user;
    return;
  end if;
  for v_tenant in select t.id from public.tenants t loop
    perform public.seed_dialer_outcomes(v_tenant);
  end loop;
end
$$;

do $$
declare
  v_missing integer;
  v_demo text;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929200000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  select count(*) into v_missing
    from public.tenants t
   where not exists (select 1 from public.dispositions d where d.tenant_id = t.id and d.disposition_key = 'no_answer')
      or not exists (select 1 from public.dispositions d where d.tenant_id = t.id and d.disposition_key = 'inbound_return_call');
  if v_missing > 0 then
    raise exception '20260929200000: % tenants have no dialer outcome rows', v_missing;
  end if;

  -- The seeded effects are the ones the dialer had: no answer stays on the cadence, a wrong number
  -- still ends the call.
  if exists (select 1 from public.dispositions d where d.disposition_key in ('no_answer', 'voicemail', 'busy')
              and d.dialer_position is not null and d.ends_call) then
    raise exception '20260929200000: an attempt outcome would end the call instead of retrying';
  end if;
  if exists (select 1 from public.dispositions d where d.disposition_key in ('wrong_number', 'disconnected')
              and d.dialer_position is not null and d.ends_call is not true) then
    raise exception '20260929200000: wrong number or disconnected no longer ends the call';
  end if;

  -- The demo tenant's buttons, in the order and on the keys the dialer used.
  select string_agg(d.disposition_key, ',' order by d.dialer_position) into v_demo
    from public.dispositions d
   where d.tenant_id = 'd6f3950f-0d88-4e66-869f-0de2ea6b396b' and d.dialer_position is not null and d.is_active;
  if v_demo is not null and v_demo <> 'no_answer,callback_scheduled,not_interested,application_submitted,voicemail,busy,call_dropped,do_not_call,wrong_number,disconnected' then
    raise exception '20260929200000: the demo dialer order changed: %', v_demo;
  end if;

  if position('seed_dialer_outcomes' in (select prosrc from pg_proc where oid = 'public.seed_default_dispositions(uuid)'::regprocedure)) = 0 then
    raise exception '20260929200000: new tenants would not get the dialer outcomes';
  end if;
end
$$;
