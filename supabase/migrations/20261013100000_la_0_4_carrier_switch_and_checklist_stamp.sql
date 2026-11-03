-- LA-0.4 · the agency's carrier switch ("Contracted? [x]"), and LA-0.3 · the setup checklist's
-- one-time "finished" stamp. Owner decisions 2026-10-13: a new column for the switch, and the
-- checklist shows until its steps are really done.
--
-- The switch lives on tenant_carrier_requirements, the per-tenant, per-carrier terms of the
-- contract (20260924220100), NOT on tenant_carriers: those rows are effective-dated and
-- re-inserted on every contract change, which would drop a flag the owner set once, and
-- tenant_carriers.is_active already means "the current contract row". No row, or contracted =
-- true, means the carrier is on.
--
-- A switched-off carrier leaves every "who do we write with now" list (quoting, assignment,
-- routing, pickers, book import). Money keeps flowing on the policies already written with it:
-- commission, advances, chargebacks and disputes do not read the switch.
--
-- The two assignment gates below are restated from 20260925702000_agent_licence_expiry.sql, made
-- by script; the only changes are the switch on each tenant_carriers join and one clearer reason.
--
-- Additive and idempotent. Ends with a check block that raises if anything did not land.

alter table public.tenant_carrier_requirements
  add column if not exists contracted boolean not null default true;
comment on column public.tenant_carrier_requirements.contracted is
  'LA-0.4 agency switch: false = the agency no longer writes with this carrier. History and money on existing policies are unaffected.';

alter table public.tenants
  add column if not exists setup_checklist_completed_at timestamptz;
comment on column public.tenants.setup_checklist_completed_at is
  'LA-0.3: set once, the first time every setup checklist step is done; the checklist never shows again after it.';

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
         and tc.is_active and not exists (select 1 from public.tenant_carrier_requirements r where r.tenant_id = tc.tenant_id and r.carrier_id = tc.carrier_id and not r.contracted)
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
        on tc.tenant_id = a.tenant_id and tc.carrier_id = a.carrier_id and tc.is_active and not exists (select 1 from public.tenant_carrier_requirements r where r.tenant_id = tc.tenant_id and r.carrier_id = tc.carrier_id and not r.contracted)
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
        join public.tenant_carriers tc on tc.tenant_id = a.tenant_id and tc.carrier_id = a.carrier_id and tc.is_active and not exists (select 1 from public.tenant_carrier_requirements r where r.tenant_id = tc.tenant_id and r.carrier_id = tc.carrier_id and not r.contracted)
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
        join public.tenant_carriers tc on tc.tenant_id = a.tenant_id and tc.carrier_id = a.carrier_id and tc.is_active and not exists (select 1 from public.tenant_carrier_requirements r where r.tenant_id = tc.tenant_id and r.carrier_id = tc.carrier_id and not r.contracted)
       where a.tenant_id = p_tenant_id and upper(btrim(a.state)) = v_state
         and a.status = 'pending'
    ) then
      return format('Your agency''s carrier appointment in %s is still pending with the carrier. %s leads can be worked once it is active.', v_state, v_state);
    end if;
    -- LA-0.4 switch: appointed there, but only with carriers the agency has switched off.
    if exists (
      select 1 from public.appointments a
        join public.tenant_carriers tc on tc.tenant_id = a.tenant_id and tc.carrier_id = a.carrier_id and tc.is_active
        join public.tenant_carrier_requirements r on r.tenant_id = a.tenant_id and r.carrier_id = a.carrier_id and not r.contracted
       where a.tenant_id = p_tenant_id and upper(btrim(a.state)) = v_state
         and a.status = 'active'
         and (a.effective_from is null or a.effective_from <= current_date)
         and (a.terminated_at is null or a.terminated_at >= current_date)
         and (a.expires_at is null or a.expires_at >= current_date)
    ) then
      return format('Your agency''s carriers appointed in %s are switched off in the carrier library. Switch one back on in Settings › Carrier library to work %s leads.', v_state, v_state);
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

-- Check: every piece landed, or the whole script rolls back in the SQL editor's transaction.
do $check$
declare
  v_missing text := '';
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'tenant_carrier_requirements' and column_name = 'contracted') then
    v_missing := v_missing || ' tenant_carrier_requirements.contracted';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'tenants' and column_name = 'setup_checklist_completed_at') then
    v_missing := v_missing || ' tenants.setup_checklist_completed_at';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('assignment_candidate_is_eligible', 'assignment_ineligibility_reason')
         and p.prosrc like '%not r.contracted%') <> 2 then
    v_missing := v_missing || ' the switch in both assignment gates';
  end if;
  if v_missing <> '' then
    raise exception 'LA-0.4 switch / LA-0.3 stamp did not land:%', v_missing;
  end if;
end
$check$;
