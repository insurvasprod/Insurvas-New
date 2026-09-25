-- Team & access › Licensed in: a personal licence can expire.
--
-- tenant_user_licensed_states (20260924110000) records WHICH states a person is licensed in, and
-- nothing about until when. An agent whose Ohio licence lapsed kept being handed, and served, Ohio
-- leads until an owner remembered to untick the box. This file:
--
--   tenant_user_licensed_states.expires_on   the date the person's own licence in that state lapses;
--                                            null = no expiry recorded. The licence counts THROUGH
--                                            that day and stops counting the day after, as the
--                                            agency licence (licenses.expires_at) does.
--   set_tenant_user_licensed_states          restated: a save that keeps a state keeps its expiry.
--                                            It used to delete every row and re-insert, which
--                                            would silently wipe every expiry on each save.
--   set_tenant_user_licensed_states_with_expiry   the Team & access editor's save: states + dates.
--   assignment_candidate_is_eligible / assignment_ineligibility_reason   restated from their
--       latest definition (20260924310000). An expired personal state is NOT held.
--   agent_may_work_state                     restated from its latest definition (20260924220200):
--       the dialer applies the same rule, so an agent is not served a lead in a state they may no
--       longer be handed.
--
-- One subtlety, stated where it is enforced: "any states recorded?" still counts the expired rows.
-- An agent whose only recorded state has lapsed must not fall back to "judge me on the agency" —
-- that would turn a lapse into MORE reach, not less.
--
-- Additive and idempotent. Signatures, return types and grants are unchanged for every restated
-- function. Nothing existing becomes invalid: every row has no expiry.

-- ── schema ────────────────────────────────────────────────────────────────
alter table public.tenant_user_licensed_states add column if not exists expires_on date;
create index if not exists tenant_user_licensed_states_expiry_idx
  on public.tenant_user_licensed_states (expires_on) where expires_on is not null;

-- ── saves ─────────────────────────────────────────────────────────────────
-- Same signature and return as 20260924110000. A state that stays keeps its row, and so its expiry.
create or replace function public.set_tenant_user_licensed_states(p_tenant_id uuid, p_user_id uuid, p_states text[])
returns setof text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_states text[];
begin
  if not exists (select 1 from public.tenant_users tu where tu.tenant_id = p_tenant_id and tu.user_id = p_user_id) then
    raise exception 'member_not_found';
  end if;
  select coalesce(array_agg(distinct upper(btrim(x))), '{}'::text[]) into v_states
    from unnest(coalesce(p_states, '{}')) as x where btrim(x) <> '';
  delete from public.tenant_user_licensed_states s
   where s.tenant_id = p_tenant_id and s.user_id = p_user_id and not (s.state = any(v_states));
  insert into public.tenant_user_licensed_states (tenant_id, user_id, state)
  select p_tenant_id, p_user_id, x from unnest(v_states) as x
  on conflict (tenant_id, user_id, state) do nothing;
  return query select s.state from public.tenant_user_licensed_states s
    where s.tenant_id = p_tenant_id and s.user_id = p_user_id order by s.state;
end;
$$;
revoke all on function public.set_tenant_user_licensed_states(uuid, uuid, text[]) from public, anon, authenticated, tenant_app;
grant execute on function public.set_tenant_user_licensed_states(uuid, uuid, text[]) to service_role;

-- p_rows: [{ "state": "OH", "expires_on": "2026-10-04" | null }]. Replaces the person's list whole,
-- in one statement, so the router never reads half of it.
create or replace function public.set_tenant_user_licensed_states_with_expiry(p_tenant_id uuid, p_user_id uuid, p_rows jsonb)
returns table (state text, expires_on date)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_row jsonb;
  v_state text;
  v_date date;
  v_states text[] := '{}'::text[];
  v_dates date[] := '{}'::date[];
begin
  if not exists (select 1 from public.tenant_users tu where tu.tenant_id = p_tenant_id and tu.user_id = p_user_id) then
    raise exception 'member_not_found';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 60 then
    raise exception 'invalid_licensed_states' using errcode = '22023';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_state := upper(btrim(coalesce(v_row->>'state', '')));
    if v_state !~ '^[A-Z]{2}$' then raise exception 'invalid_licensed_states' using errcode = '22023'; end if;
    v_date := case when jsonb_typeof(v_row->'expires_on') = 'string' and btrim(v_row->>'expires_on') <> ''
                   then (v_row->>'expires_on')::date end;
    if v_state = any(v_states) then continue; end if;
    v_states := v_states || v_state;
    v_dates := v_dates || v_date;
  end loop;

  delete from public.tenant_user_licensed_states s
   where s.tenant_id = p_tenant_id and s.user_id = p_user_id and not (s.state = any(v_states));
  insert into public.tenant_user_licensed_states as s (tenant_id, user_id, state, expires_on)
  select p_tenant_id, p_user_id, x.state, x.expires_on
    from unnest(v_states, v_dates) as x(state, expires_on)
  on conflict on constraint tenant_user_licensed_states_pkey do update set expires_on = excluded.expires_on;

  return query select s.state, s.expires_on from public.tenant_user_licensed_states s
    where s.tenant_id = p_tenant_id and s.user_id = p_user_id order by s.state;
end;
$$;
revoke all on function public.set_tenant_user_licensed_states_with_expiry(uuid, uuid, jsonb) from public, anon, authenticated, tenant_app;
grant execute on function public.set_tenant_user_licensed_states_with_expiry(uuid, uuid, jsonb) to service_role;

-- ── eligibility ───────────────────────────────────────────────────────────
-- Restated from 20260924310000. The only change in each function is the personal-state clause:
-- a recorded state counts while its expires_on is null or today or later.
create or replace function public.assignment_candidate_is_eligible(
  p_tenant_id uuid,
  p_user_id uuid,
  p_role text,
  p_product text,
  p_state text,
  p_requires_licensed boolean
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_state text := upper(btrim(coalesce(p_state, '')));
begin
  if p_role not in ('owner', 'producer', 'setter') then return false; end if;
  if p_requires_licensed and p_role = 'setter' then return false; end if;
  if p_role = 'setter' then return true; end if;
  if v_state = '' then return false; end if;

  return
    exists (
      select 1 from public.licenses l
       where l.tenant_id = p_tenant_id
         and upper(btrim(l.state)) = v_state
         and (l.expires_at is null or l.expires_at >= current_date)
    )
    and exists (
      select 1
        from public.appointments a
        join public.tenant_carriers tc
          on tc.tenant_id = a.tenant_id
         and tc.carrier_id = a.carrier_id
         and tc.is_active
       where a.tenant_id = p_tenant_id
         and upper(btrim(a.state)) = v_state
         and a.status = 'active'
         and (a.effective_from is null or a.effective_from <= current_date)
         and (a.terminated_at is null or a.terminated_at >= current_date)
         and (a.expires_at is null or a.expires_at >= current_date)
    )
    -- The agent's own states, when any are recorded (expired rows still count as "recorded", so a
    -- lapse never widens reach back to the agency's). New: a lapsed personal state is not held.
    and (
      not exists (select 1 from public.tenant_user_licensed_states s where s.tenant_id = p_tenant_id and s.user_id = p_user_id)
      or exists (select 1 from public.tenant_user_licensed_states s
                  where s.tenant_id = p_tenant_id and s.user_id = p_user_id and s.state = v_state
                    and (s.expires_on is null or s.expires_on >= current_date))
    );
end;
$function$;

create or replace function public.assignment_ineligibility_reason(
  p_tenant_id uuid,
  p_user_id uuid,
  p_role text,
  p_product text,
  p_state text,
  p_requires_licensed boolean
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_state text := upper(btrim(coalesce(p_state, '')));
  v_licensed boolean;
  v_appointed boolean;
  v_agent_ok boolean;
  v_lapsed date;
begin
  if p_role not in ('owner', 'producer', 'setter') then
    return format('A %s cannot be given leads to work.', coalesce(p_role, 'member with no role'));
  end if;
  if p_requires_licensed and p_role = 'setter' then
    return 'This lead needs a licensed agent, and a setter cannot write business.';
  end if;
  if p_role = 'setter' then return null; end if;
  if v_state = '' then
    return 'This lead has no state on it, so there is no way to tell who is licensed to work it.';
  end if;

  select exists (
    select 1 from public.licenses l
     where l.tenant_id = p_tenant_id and upper(btrim(l.state)) = v_state
       and (l.expires_at is null or l.expires_at >= current_date)
  ) into v_licensed;

  select exists (
    select 1 from public.appointments a
      join public.tenant_carriers tc
        on tc.tenant_id = a.tenant_id and tc.carrier_id = a.carrier_id and tc.is_active
     where a.tenant_id = p_tenant_id and upper(btrim(a.state)) = v_state
       and a.status = 'active'
       and (a.effective_from is null or a.effective_from <= current_date)
       and (a.terminated_at is null or a.terminated_at >= current_date)
       and (a.expires_at is null or a.expires_at >= current_date)
  ) into v_appointed;

  select not exists (select 1 from public.tenant_user_licensed_states s where s.tenant_id = p_tenant_id and s.user_id = p_user_id)
      or exists (select 1 from public.tenant_user_licensed_states s
                  where s.tenant_id = p_tenant_id and s.user_id = p_user_id and s.state = v_state
                    and (s.expires_on is null or s.expires_on >= current_date))
    into v_agent_ok;

  if v_licensed and v_appointed and v_agent_ok then return null; end if;

  if not v_licensed and not v_appointed then
    return format(
      'Your agency %s for %s and has no active carrier appointment there. Both are needed before anyone can be given a %s lead.',
      case when exists (select 1 from public.licenses l where l.tenant_id = p_tenant_id and upper(btrim(l.state)) = v_state)
           then 'has an expired licence' else 'has no licence on record' end,
      v_state, v_state);
  end if;
  if not v_licensed then
    if exists (select 1 from public.licenses l where l.tenant_id = p_tenant_id and upper(btrim(l.state)) = v_state) then
      return format('Your agency''s %s licence has expired. Renew it on States & licences before working %s leads.', v_state, v_state);
    end if;
    return format('Your agency has no %s licence on record. Add it on States & licences before working %s leads.', v_state, v_state);
  end if;
  if not v_appointed then
    if exists (
      select 1 from public.appointments a
        join public.tenant_carriers tc on tc.tenant_id = a.tenant_id and tc.carrier_id = a.carrier_id and tc.is_active
       where a.tenant_id = p_tenant_id and upper(btrim(a.state)) = v_state
         and a.status = 'active'
         and (a.effective_from is null or a.effective_from <= current_date)
         and (a.terminated_at is null or a.terminated_at >= current_date)
         and a.expires_at < current_date
    ) then
      return format('Your agency''s carrier appointment in %s has expired, so nothing can be written there. Renew it on Appointments & licences.', v_state);
    end if;
    if exists (
      select 1 from public.appointments a
        join public.tenant_carriers tc on tc.tenant_id = a.tenant_id and tc.carrier_id = a.carrier_id and tc.is_active
       where a.tenant_id = p_tenant_id and upper(btrim(a.state)) = v_state
         and a.status = 'pending'
    ) then
      return format('Your agency''s carrier appointment in %s is still pending with the carrier. %s leads can be worked once it is active.', v_state, v_state);
    end if;
    return format('Your agency is licensed in %s but has no active carrier appointment there, so nothing can be written. Add one on States & licences.', v_state);
  end if;
  -- New: the person's own licence in the state is recorded and has lapsed.
  select s.expires_on into v_lapsed from public.tenant_user_licensed_states s
   where s.tenant_id = p_tenant_id and s.user_id = p_user_id and s.state = v_state and s.expires_on < current_date;
  if v_lapsed is not null then
    return format('This agent''s own %s licence expired on %s. Record the renewal on Team & access, or give the lead to someone licensed there.',
                  v_state, to_char(v_lapsed, 'FMDD Mon YYYY'));
  end if;
  return format('This agent is not licensed in %s. Add %s to their licensed states on Team & access, or give the lead to someone who is.', v_state, v_state);
end;
$function$;

revoke all on function public.assignment_candidate_is_eligible(uuid, uuid, text, text, text, boolean)
  from public, anon, authenticated, tenant_app;
grant execute on function public.assignment_candidate_is_eligible(uuid, uuid, text, text, text, boolean)
  to service_role;
revoke all on function public.assignment_ineligibility_reason(uuid, uuid, text, text, text, boolean)
  from public, anon, authenticated, tenant_app;
grant execute on function public.assignment_ineligibility_reason(uuid, uuid, text, text, text, boolean)
  to service_role;

-- ── the dialer's rule ─────────────────────────────────────────────────────
-- Restated from 20260924220200 (no later file redefines it; 20260925700000 and 20260925701100 only
-- call it). Same signature, language, volatility and grants. The only change is the personal-state
-- clause, identical to the router's above.
create or replace function public.agent_may_work_state(p_tenant_id uuid, p_user_id uuid, p_state text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  with member as (
    select tu.role::text as role
      from public.tenant_users tu
     where tu.tenant_id = p_tenant_id and tu.user_id = p_user_id
  ), wanted as (
    select upper(btrim(coalesce(p_state, ''))) as state
  )
  select coalesce((
    select case
      when m.role = 'setter' then true
      when m.role not in ('owner', 'producer') then false
      when w.state = '' then false
      else exists (
             select 1 from public.licenses l
              where l.tenant_id = p_tenant_id
                and upper(btrim(l.state)) = w.state
                and (l.expires_at is null or l.expires_at >= current_date)
           )
           and (
             not exists (select 1 from public.tenant_user_licensed_states s where s.tenant_id = p_tenant_id and s.user_id = p_user_id)
             or exists (select 1 from public.tenant_user_licensed_states s
                         where s.tenant_id = p_tenant_id and s.user_id = p_user_id and s.state = w.state
                           and (s.expires_on is null or s.expires_on >= current_date))
           )
    end
    from member m cross join wanted w
  ), false);
$function$;

revoke all on function public.agent_may_work_state(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.agent_may_work_state(uuid, uuid, text) to tenant_app, service_role;

-- ── asserted against whatever this database holds ─────────────────────────
do $$
declare
  v_def text;
begin
  -- A parse-check run (tenant_app) cannot add the column or replace the functions.
  if not has_schema_privilege('public', 'CREATE')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'tenant_user_licensed_states' and column_name = 'expires_on') then
    raise notice 'agent licence expiry: schema not present; skipping the checks';
    return;
  end if;

  select pg_get_functiondef('public.assignment_candidate_is_eligible(uuid, uuid, text, text, text, boolean)'::regprocedure) into v_def;
  if v_def !~ 's\.expires_on is null or s\.expires_on >= current_date' then
    raise exception 'assignment_candidate_is_eligible still accepts a lapsed personal licence';
  end if;
  if v_def !~ 'a\.expires_at is null or a\.expires_at >= current_date' or v_def !~ 'a\.status = ''active''' or v_def !~ 'l\.expires_at is null or l\.expires_at >= current_date' then
    raise exception 'assignment_candidate_is_eligible lost a rule after the rewrite';
  end if;
  select pg_get_functiondef('public.assignment_ineligibility_reason(uuid, uuid, text, text, text, boolean)'::regprocedure) into v_def;
  if v_def !~ 'own %s licence expired on' or v_def !~ 'has expired, so nothing can be written there' or v_def !~ 'still pending with the carrier' then
    raise exception 'assignment_ineligibility_reason does not explain every refusal';
  end if;
  select pg_get_functiondef('public.agent_may_work_state(uuid, uuid, text)'::regprocedure) into v_def;
  if v_def !~ 's\.expires_on is null or s\.expires_on >= current_date' then
    raise exception 'agent_may_work_state still serves a lapsed personal licence';
  end if;
  select pg_get_functiondef('public.set_tenant_user_licensed_states(uuid, uuid, text[])'::regprocedure) into v_def;
  if v_def ~ 'delete from public\.tenant_user_licensed_states s where s\.tenant_id = p_tenant_id and s\.user_id = p_user_id;' then
    raise exception 'set_tenant_user_licensed_states still wipes every expiry on save';
  end if;

  if has_function_privilege('tenant_app', 'public.assignment_candidate_is_eligible(uuid, uuid, text, text, text, boolean)', 'execute')
     or has_function_privilege('tenant_app', 'public.set_tenant_user_licensed_states_with_expiry(uuid, uuid, jsonb)', 'execute') then
    raise exception 'the tenant plane can execute a service-role function';
  end if;
  if not has_function_privilege('tenant_app', 'public.agent_may_work_state(uuid, uuid, text)', 'execute') then
    raise exception 'agent_may_work_state lost its tenant_app grant (the dialer calls it)';
  end if;
  raise notice 'agent licence expiry: a lapsed personal state is refused by assignment and by the dialer';
end $$;
