-- LA-1 audit · the transfer inbox keeps the callers who have waited longest.
--
-- list_transfer_inbox capped every view at the NEWEST 500 rows (20260924170000, kept by 20260929140300).
-- In a queue deeper than 500, the callers who had waited longest dropped off the inbox and the Agent
-- Floor, exactly the ones that most need answering. For the waiting views ('unclaimed', and 'open',
-- which the floor reads) the cap now keeps the 500 oldest; history views ('all', 'claimed', a
-- terminal status) still keep the newest. Display order is unchanged: longest wait first.
--
-- Restated from 20260929140300 (the M1 perf pass's index-usable status list), so it carries that
-- change too, and from 20260925709850's age column through it. If 20260929140300 is applied AFTER
-- this file, re-apply this file. The bundle is not changed; its `truncated` flag still means "the
-- 500 limit was reached".

do $$
begin
  if to_regprocedure('public.lead_values_age(jsonb,date)') is null then
    raise exception '20261015593000: apply 20260925709850 (inbound transfer foundations) first'
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
    -- LA-1 audit: callers still waiting keep their place. For the waiting views ('unclaimed', and
    -- 'open', the floor) the cap keeps the 500 who have waited LONGEST, so the oldest caller is never
    -- the one hidden; history views keep the newest. The bundle's `truncated` flag reads this 500.
    order by case when p_status in ('unclaimed', 'open') then q.queued_at end asc,
             q.queued_at desc
    limit 500
  ) newest
  order by newest.queued_at asc
$function$;

revoke all on function public.list_transfer_inbox(uuid, text, uuid, text, text, text, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.list_transfer_inbox(uuid, text, uuid, text, text, text, uuid) to service_role;

-- ─── self-check ──────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_body text := replace(pg_get_functiondef('public.list_transfer_inbox(uuid,text,uuid,text,text,text,uuid)'::regprocedure), E'\r\n', E'\n');
begin
  if position('then q.queued_at end asc' in v_body) = 0 then
    raise exception '20261015593000: list_transfer_inbox still drops the longest-waiting callers';
  end if;
  if position('lead_values_age(l.values)' in v_body) = 0 or position('and q.status = any (case p_status' in v_body) = 0 then
    raise exception '20261015593000: the restatement lost the age column or the status seek';
  end if;
end
$$;
