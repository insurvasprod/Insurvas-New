-- Settings › States & licences and Settings › Team & access.
--
-- The two boards show things the vault and the team table did not keep:
--
--   licenses       whether the licence is resident or non-resident, and its lines of authority
--   eo_policies    per-claim and aggregate limits (only one coverage figure existed)
--   ce_records     ethics credits required and completed, inside the cycle's total
--   team           the states each agent is personally licensed in
--
-- All additive: every new column is nullable or defaulted, and the application reads each one as
-- "not recorded" until this file has been applied.
--
-- ── the per-agent half of eligibility ─────────────────────────────────────
--
-- LA-2.24 (20260923130000) made assignment eligibility per AGENCY, because nothing per agent
-- existed, and said how to add it later. This is that change, done the way that file asked for
-- rather than by adding user_id to `licenses`: an agency licence is still required, and if an owner
-- or producer has licensed states recorded on Team & access, the lead's state must also be one of
-- theirs. An agent with none recorded is judged on the agency's licences alone, exactly as before —
-- so applying this changes nothing for any tenant until somebody records a state.

-- ── licences ──────────────────────────────────────────────────────────────
alter table public.licenses add column if not exists licence_type text;
alter table public.licenses add column if not exists lines_of_authority text[] not null default '{}';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'licenses_licence_type_valid') then
    alter table public.licenses
      add constraint licenses_licence_type_valid check (licence_type is null or licence_type in ('resident', 'non_resident'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'licenses_lines_of_authority_bounded') then
    alter table public.licenses
      add constraint licenses_lines_of_authority_bounded check (coalesce(array_length(lines_of_authority, 1), 0) <= 12);
  end if;
end $$;

-- ── E&O limits ────────────────────────────────────────────────────────────
alter table public.eo_policies add column if not exists per_claim_cents bigint;
alter table public.eo_policies add column if not exists aggregate_cents bigint;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'eo_policies_limits_valid') then
    alter table public.eo_policies
      add constraint eo_policies_limits_valid check (
        (per_claim_cents is null or per_claim_cents >= 0)
        and (aggregate_cents is null or aggregate_cents >= 0)
        and (per_claim_cents is null or aggregate_cents is null or aggregate_cents >= per_claim_cents)
      );
  end if;
end $$;

-- ── CE ethics credits ─────────────────────────────────────────────────────
alter table public.ce_records add column if not exists ethics_required integer;
alter table public.ce_records add column if not exists ethics_completed integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ce_records_ethics_valid') then
    alter table public.ce_records
      add constraint ce_records_ethics_valid check (
        (ethics_required is null or ethics_required between 0 and credits_required)
        and (ethics_completed is null or ethics_completed between 0 and credits_completed)
        and (ethics_required is null or ethics_completed is null or ethics_completed <= ethics_required)
      );
  end if;
end $$;

-- ── the states each agent is licensed in ──────────────────────────────────
create table if not exists public.tenant_user_licensed_states (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  state text not null check (state ~ '^[A-Z]{2}$'),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id, state)
);
create index if not exists tenant_user_licensed_states_user_idx on public.tenant_user_licensed_states (user_id);

alter table public.tenant_user_licensed_states enable row level security;
revoke all on public.tenant_user_licensed_states from anon, authenticated, public;
grant select, insert, update, delete on public.tenant_user_licensed_states to service_role;
grant select on public.tenant_user_licensed_states to tenant_app;
drop policy if exists tenant_user_licensed_states_read on public.tenant_user_licensed_states;
create policy tenant_user_licensed_states_read on public.tenant_user_licensed_states
  for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Replaces one person's list in one statement, so a half-written list is never read by the router.
create or replace function public.set_tenant_user_licensed_states(p_tenant_id uuid, p_user_id uuid, p_states text[])
returns setof text
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (select 1 from public.tenant_users tu where tu.tenant_id = p_tenant_id and tu.user_id = p_user_id) then
    raise exception 'member_not_found';
  end if;
  delete from public.tenant_user_licensed_states s where s.tenant_id = p_tenant_id and s.user_id = p_user_id;
  insert into public.tenant_user_licensed_states (tenant_id, user_id, state)
  select distinct p_tenant_id, p_user_id, upper(btrim(x)) from unnest(coalesce(p_states, '{}')) as x where btrim(x) <> '';
  return query select s.state from public.tenant_user_licensed_states s
    where s.tenant_id = p_tenant_id and s.user_id = p_user_id order by s.state;
end;
$$;
revoke all on function public.set_tenant_user_licensed_states(uuid, uuid, text[]) from public, anon, authenticated, tenant_app;
grant execute on function public.set_tenant_user_licensed_states(uuid, uuid, text[]) to service_role;

-- ── eligibility, now asking the agent as well as the agency ────────────────
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
    )
    -- New: the agent's own states, when any are recorded. None recorded means "judge me on the
    -- agency", which is what every agent was before this file.
    and (
      not exists (select 1 from public.tenant_user_licensed_states s where s.tenant_id = p_tenant_id and s.user_id = p_user_id)
      or exists (select 1 from public.tenant_user_licensed_states s where s.tenant_id = p_tenant_id and s.user_id = p_user_id and s.state = v_state)
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
  ) into v_appointed;

  select not exists (select 1 from public.tenant_user_licensed_states s where s.tenant_id = p_tenant_id and s.user_id = p_user_id)
      or exists (select 1 from public.tenant_user_licensed_states s where s.tenant_id = p_tenant_id and s.user_id = p_user_id and s.state = v_state)
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
    return format('Your agency is licensed in %s but has no active carrier appointment there, so nothing can be written. Add one on States & licences.', v_state);
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

-- ── asserted against whatever this database holds ─────────────────────────
do $$
declare
  v_tenant uuid;
  v_user uuid;
  v_good text;
  v_other text;
begin
  if to_regclass('public.tenant_user_licensed_states') is null then
    raise notice 'per-agent eligibility check skipped: tenant_user_licensed_states is not present';
    return;
  end if;

  select tu.tenant_id, tu.user_id into v_tenant, v_user
    from public.tenant_users tu
   where tu.role::text in ('owner', 'producer')
     and not exists (select 1 from public.tenant_user_licensed_states s where s.tenant_id = tu.tenant_id and s.user_id = tu.user_id)
   order by tu.tenant_id
   limit 1;
  if v_tenant is null then
    raise notice 'per-agent eligibility check skipped: no owner or producer without recorded states';
    return;
  end if;

  select upper(btrim(l.state)) into v_good
    from public.licenses l
   where l.tenant_id = v_tenant
     and (l.expires_at is null or l.expires_at >= current_date)
     and exists (
       select 1 from public.appointments a
         join public.tenant_carriers tc on tc.tenant_id = a.tenant_id and tc.carrier_id = a.carrier_id and tc.is_active
        where a.tenant_id = v_tenant and upper(btrim(a.state)) = upper(btrim(l.state)) and a.status = 'active'
          and (a.effective_from is null or a.effective_from <= current_date)
          and (a.terminated_at is null or a.terminated_at >= current_date)
     )
   limit 1;
  if v_good is null then
    raise notice 'per-agent eligibility check skipped: tenant is not licensed and appointed anywhere';
    return;
  end if;

  -- Nothing recorded: the agency answer stands, unchanged by this file.
  if not public.assignment_candidate_is_eligible(v_tenant, v_user, 'owner', 'term_life', v_good, true) then
    raise exception 'per-agent eligibility: an agent with no recorded states lost %', v_good;
  end if;

  -- Record a different state, inside a savepoint that is always rolled back: now % must refuse.
  v_other := case when v_good = 'WY' then 'VT' else 'WY' end;
  begin
    insert into public.tenant_user_licensed_states (tenant_id, user_id, state) values (v_tenant, v_user, v_other);
    if public.assignment_candidate_is_eligible(v_tenant, v_user, 'owner', 'term_life', v_good, true) then
      raise exception 'per-agent eligibility: an agent licensed only in % was eligible in %', v_other, v_good;
    end if;
    if public.assignment_ineligibility_reason(v_tenant, v_user, 'owner', 'term_life', v_good, true) is null then
      raise exception 'per-agent eligibility: refused in % with no reason', v_good;
    end if;
    raise exception using errcode = 'P0001', message = 'rollback_probe';
  exception when others then
    if sqlerrm <> 'rollback_probe' then raise; end if;
  end;
  raise notice 'per-agent eligibility: % stays open with no recorded states and closes when the agent is licensed elsewhere', v_good;
end $$;
