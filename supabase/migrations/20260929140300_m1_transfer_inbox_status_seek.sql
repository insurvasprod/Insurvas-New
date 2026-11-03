-- M1 perf · LA-1.10-10, the transfer inbox with 500 waiting (target under 1 s).
--
-- APPLY AFTER 20260925709850 (inbound transfer foundations). list_transfer_inbox below is restated
-- from 709850's version, which carries the LA-1.10-2 age column (lead_values_age). On 2026-09-30 the
-- live body was already identical to it, byte for byte after CRLF normalisation. Starting from 709850
-- keeps the age change whichever of the two files is applied last. This file refuses to run if
-- lead_values_age is missing.
--
-- Measured 2026-09-30: list_transfer_inbox_bundle took 2.0 to 2.4 s warm and 8.1 s cold, and 2 of 5
-- runs hit the statement timeout. The bundle calls list_transfer_inbox, a SQL function, which is
-- planned once for any p_status. Its status test is an OR over the parameter, so that plan cannot
-- seek the (tenant_id, status, queued_at) index and reads every inbound row the tenant ever had
-- (5,500 on the load-test tenant, all but the 500 waiting ones finished) before keeping the newest
-- 500. Generic-plan EXPLAIN, read-only: 5,468 buffers and 1,078 ms for zero waiting rows.
--
-- The one change: the same status test as one list the index can seek on, added beside the
-- original test (which stays, so the result is unchanged). 'all' is every status
-- lead_queue_status_check allows, and the check below fails if that constraint ever allows one the
-- list does not name. After: 20 buffers and 9 ms for the same call. The bundle is not changed.

do $$
begin
  if to_regprocedure('public.lead_values_age(jsonb,date)') is null then
    raise exception '20260929140300: apply 20260925709850 (inbound transfer foundations) first'
      using hint = 'list_transfer_inbox below reads lead_values_age for the LA-1.10-2 age column';
  end if;
end
$$;

create or replace function public.list_transfer_inbox(p_tenant_id uuid, p_status text default 'unclaimed'::text, p_partner_id uuid default null::uuid, p_product_line text default null::text, p_state text default null::text, p_screening_outcome text default null::text, p_claimed_by uuid default null::uuid)
returns table(id uuid, lead_id uuid, partner_id uuid, partner_name text, product_line text, status text, owner_user_id uuid, owner_name text, claimed_at timestamp with time zone, queued_at timestamp with time zone, wait_seconds integer, customer text, age text, state text, screening_outcome text, screening_warning text, duplicate_warning boolean, preflight_status text, preflight_result jsonb)
language sql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select newest.* from (
    select q.id as id, q.lead_id as lead_id, q.partner_id as partner_id, coalesce(p.name, 'Unassigned partner') as partner_name, q.product_line as product_line,
      q.status as status, coalesce(q.owner_user_id, q.claimed_by) as owner_user_id, u.name as owner_name, q.claimed_at as claimed_at, q.queued_at as queued_at,
      greatest(0, floor(extract(epoch from (now() - q.queued_at)))::integer) as wait_seconds,
      coalesce(nullif(btrim(l.values->>'full_name'), ''), nullif(btrim(l.values->>'name'), ''),
        nullif(btrim(concat_ws(' ', l.values->>'first_name', l.values->>'last_name')), ''), 'Unnamed customer') as customer,
      -- LA-1.10-2: the recorded age, else worked out from the date of birth.
      coalesce(public.lead_values_age(l.values), '—') as age,
      coalesce(nullif(btrim(l.values->>'state'), ''), nullif(btrim(l.values->>'state_code'), ''), nullif(btrim(l.values->>'primary_state'), ''), nullif(btrim(l.carrier_state), ''), '—') as state,
      coalesce(nullif(btrim(q.screening_outcome), ''), nullif(btrim(l.screening_outcome), ''), 'not_checked') as screening_outcome,
      coalesce(q.screening_warning, l.screening_warning) as screening_warning,
      coalesce((l.values->>'duplicate_warning')::boolean, false) as duplicate_warning, l.preflight_status as preflight_status, l.preflight_result as preflight_result
    from public.lead_queue q
    join public.agent_leads l on l.id = q.lead_id and l.tenant_id = q.tenant_id
    left join public.partners p on p.id = q.partner_id and p.tenant_id = q.tenant_id
    left join public.users u on u.id = coalesce(q.owner_user_id, q.claimed_by)
    where q.tenant_id = p_tenant_id
      -- Inbound transfers only: a dialer lead is served by the dialer, not claimed from the inbox.
      and q.partner_id is not null
      and (p_status = 'all'
        -- Everything still being worked: waiting, or with an agent. Terminal history is not.
        or (p_status = 'open' and q.status in ('unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active'))
        -- "Claimed" in the inbox means with an agent, at whichever stage: a buffer assistant, a
        -- handoff in flight, or the licensed agent. Only the first of those is status 'claimed'.
        or (p_status = 'claimed' and q.status in ('claimed', 'buffer_active', 'handed_pending', 'la_active'))
        or q.status = p_status)
      -- The same statuses as the test above, as one list the (tenant_id, status, queued_at) index can
      -- seek on. The test above cannot: a SQL function is planned once for any p_status, so an OR
      -- over the parameter reads every inbound row the tenant ever had. 'all' is every status
      -- lead_queue_status_check allows, and the check at the end of this file keeps it that way.
      and q.status = any (case p_status
        when 'all' then array['unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active', 'completed', 'closed', 'dropped', 'expired']
        when 'open' then array['unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active']
        when 'claimed' then array['claimed', 'buffer_active', 'handed_pending', 'la_active']
        else array[p_status] end)
      and (p_partner_id is null or q.partner_id = p_partner_id)
      and (p_product_line is null or q.product_line = p_product_line)
      and (p_claimed_by is null or coalesce(q.owner_user_id, q.claimed_by) = p_claimed_by)
      and (p_state is null or coalesce(nullif(btrim(l.values->>'state'), ''), nullif(btrim(l.values->>'state_code'), ''), nullif(btrim(l.values->>'primary_state'), ''), nullif(btrim(l.carrier_state), '')) = p_state)
      and (p_screening_outcome is null or coalesce(q.screening_outcome, l.screening_outcome, 'not_checked') = p_screening_outcome)
    -- The newest 500, so a transfer that just arrived is never the one cut. The bundle's
    -- `truncated` flag reads this same 500.
    order by q.queued_at desc limit 500
  ) newest
  order by newest.queued_at asc
$function$;

revoke all on function public.list_transfer_inbox(uuid, text, uuid, text, text, text, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.list_transfer_inbox(uuid, text, uuid, text, text, text, uuid) to service_role;

do $$
declare
  v_sig regprocedure := 'public.list_transfer_inbox(uuid,text,uuid,text,text,text,uuid)'::regprocedure;
  v_body text;
  v_check text;
  v_allowed text[];
  v_listed constant text[] := array['unclaimed', 'claimed', 'buffer_active', 'handed_pending', 'la_active', 'completed', 'closed', 'dropped', 'expired'];
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260929140300: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  v_body := replace(pg_get_functiondef(v_sig), E'\r\n', E'\n');
  if position('lead_values_age(l.values)' in v_body) = 0 then
    raise exception '20260929140300: the LA-1.10-2 age column is missing from list_transfer_inbox';
  end if;
  if position('and q.status = any (case p_status' in v_body) = 0 then
    raise exception '20260929140300: the index-usable status list is not live';
  end if;
  -- Every status the table allows must be in the 'all' list, or 'all' would hide rows.
  select pg_get_constraintdef(oid) into v_check
  from pg_constraint
  where conrelid = 'public.lead_queue'::regclass and conname = 'lead_queue_status_check';
  if v_check is null then
    raise exception '20260929140300: lead_queue_status_check is gone, so the ''all'' list cannot be checked';
  end if;
  select array_agg(m[1]) into v_allowed from regexp_matches(v_check, '''([a-z_]+)''', 'g') m;
  if not (v_listed @> v_allowed) then
    raise exception '20260929140300: lead_queue allows statuses the inbox ''all'' list lacks: %', array(select unnest(v_allowed) except select unnest(v_listed));
  end if;
  if has_function_privilege('anon', v_sig, 'execute') or has_function_privilege('authenticated', v_sig, 'execute') then
    raise exception '20260929140300: list_transfer_inbox is callable by a public role';
  end if;
end
$$;
