-- AG-0.9 (Notion sprint, Agency Module 0) · producer contract levels and writing numbers.
-- (Timestamped before AG-0.8's file because the solo → agency backfill moves a solo agent's levels and numbers
-- INTO these tables; the task order in Notion is unchanged.)
--
-- These two tables are what make AG-1's override arithmetic and statement attribution possible. Neither can be
-- guessed.
--
--   producer_contract_level   one level per producer per carrier, integer basis points (9000 = 90%), effective-
--                             dated. Looked up AS OF the policy's effective date, never "the current level": a
--                             June promotion must not change what was earned in May.
--   producer_writing_number   the carrier's name for this producer, effective-dated. A number belongs to ONE
--                             producer at a time — two producers claiming one number is refused by the DATABASE
--                             (exclusion over the date range, plus the spec's unique (carrier, number, from)),
--                             because reconciling it afterwards means money already went to the wrong person.
--                             Scoped per agency (tenant): carriers are shared across tenants and a refusal must
--                             not reveal another agency's numbers.
--   carrier_agent_map         LA-4's existing (carrier, agent identifier) → user map, which the commission writer
--                             (record_commission_entries) and refresh_policy_current already read. A writing number
--                             saved here is written through to it, so attribution needs no second engine (AG-1.4
--                             builds the disagreement queue on top).
--   agency level              the agency's own level stays where LA-0.4 keeps it: tenant_carriers.contract_level_bp.
--
-- Missing = null, and a visible prompt. Never a default, never the agency's level.
-- One level per CARRIER, not per carrier and product: a known gap, accepted in module doc §5 (comment below).
--
-- Requires 20261018100000 (producer, agency).
--
-- Rollback: drop table producer_writing_number, producer_contract_level; drop functions set_producer_carrier,
--   producer_level_bps_as_of, agency_level_bps_as_of.

create table if not exists public.producer_contract_level (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  agency_id uuid not null,
  producer_id uuid not null,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  level_bps integer not null,
  effective_from date not null,
  effective_to date,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint producer_contract_level_producer_fk foreign key (producer_id, tenant_id) references public.producer (id, tenant_id) on delete cascade,
  constraint producer_contract_level_agency_fk foreign key (agency_id, tenant_id) references public.agency (id, tenant_id) on delete cascade,
  constraint producer_contract_level_unique_start unique (producer_id, carrier_id, effective_from),
  constraint producer_contract_level_bps check (level_bps between 0 and 30000),
  constraint producer_contract_level_dates check (effective_to is null or effective_to >= effective_from),
  constraint producer_contract_level_no_overlap exclude using gist (
    producer_id with =, carrier_id with =, daterange(effective_from, effective_to, '[]') with &&
  )
);
comment on table public.producer_contract_level is
  'AG-0.9. One level per producer per CARRIER, not per carrier and product. Known gap, accepted in Agency Module 0 §5: a carrier that pays Final Expense and Term at different levels is modelled at one level for both. The fix is a third key (product) here, expected within a year. Not an oversight.';

create table if not exists public.producer_writing_number (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  agency_id uuid not null,
  producer_id uuid not null,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  writing_number text not null,
  effective_from date not null,
  effective_to date,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint producer_writing_number_producer_fk foreign key (producer_id, tenant_id) references public.producer (id, tenant_id) on delete cascade,
  constraint producer_writing_number_agency_fk foreign key (agency_id, tenant_id) references public.agency (id, tenant_id) on delete cascade,
  constraint producer_writing_number_unique_start unique (tenant_id, carrier_id, writing_number, effective_from),
  constraint producer_writing_number_text check (length(btrim(writing_number)) between 1 and 120 and writing_number = btrim(writing_number)),
  constraint producer_writing_number_dates check (effective_to is null or effective_to >= effective_from),
  -- one number → one producer at a time
  constraint producer_writing_number_one_owner exclude using gist (
    tenant_id with =, carrier_id with =, writing_number with =, daterange(effective_from, effective_to, '[]') with &&
  ),
  -- and one number per producer per carrier at a time
  constraint producer_writing_number_one_per_carrier exclude using gist (
    producer_id with =, carrier_id with =, daterange(effective_from, effective_to, '[]') with &&
  )
);
create index if not exists producer_writing_number_lookup on public.producer_writing_number (tenant_id, carrier_id, writing_number, effective_from);

revoke all on public.producer_contract_level, public.producer_writing_number from public, anon, authenticated;
revoke insert, update, delete, truncate on public.producer_contract_level, public.producer_writing_number from service_role, tenant_app;
grant select on public.producer_contract_level, public.producer_writing_number to service_role, tenant_app;
alter table public.producer_contract_level enable row level security;
alter table public.producer_writing_number enable row level security;
drop policy if exists producer_contract_level_tenant_read on public.producer_contract_level;
create policy producer_contract_level_tenant_read on public.producer_contract_level for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
drop policy if exists producer_writing_number_tenant_read on public.producer_writing_number;
create policy producer_writing_number_tenant_read on public.producer_writing_number for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- ─── lookups, as of a date ───────────────────────────────────────────────────────────────────────
create or replace function public.producer_level_bps_as_of(p_tenant_id uuid, p_producer_user_id uuid, p_carrier_id uuid, p_as_of date)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select l.level_bps
    from public.producer_contract_level l
    join public.producer p on p.id = l.producer_id
   where l.tenant_id = p_tenant_id and p.user_id = p_producer_user_id and l.carrier_id = p_carrier_id
     and p_as_of between l.effective_from and coalesce(l.effective_to, '9999-12-31'::date);
$$;

create or replace function public.agency_level_bps_as_of(p_tenant_id uuid, p_carrier_id uuid, p_as_of date)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select tc.contract_level_bp
    from public.tenant_carriers tc
   where tc.tenant_id = p_tenant_id and tc.carrier_id = p_carrier_id and tc.effective_from <= p_as_of
   order by tc.effective_from desc
   limit 1;
$$;
revoke all on function public.producer_level_bps_as_of(uuid, uuid, uuid, date), public.agency_level_bps_as_of(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.producer_level_bps_as_of(uuid, uuid, uuid, date), public.agency_level_bps_as_of(uuid, uuid, date) to service_role, tenant_app;

-- ─── the one writer: close the row in force, insert the new one ──────────────────────────────────
-- Pass p_level_bps and/or p_writing_number (null = leave that one alone).
create or replace function public.set_producer_carrier(
  p_tenant_id uuid,
  p_producer_id uuid,
  p_carrier_id uuid,
  p_level_bps integer,
  p_writing_number text,
  p_effective_from date,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agency uuid;
  v_user uuid;
  v_number text := nullif(btrim(coalesce(p_writing_number, '')), '');
begin
  select agency_id, user_id into v_agency, v_user from public.producer where tenant_id = p_tenant_id and id = p_producer_id;
  if v_agency is null then raise exception 'producer_not_found' using errcode = 'P0001'; end if;
  if p_effective_from is null then raise exception 'effective_from_required' using errcode = 'P0001'; end if;

  if p_level_bps is not null then
    if exists (select 1 from public.producer_contract_level where producer_id = p_producer_id and carrier_id = p_carrier_id and effective_from = p_effective_from) then
      raise exception 'level_same_day' using errcode = 'P0001', hint = 'A level already starts that day. Pick the next day.';
    end if;
    update public.producer_contract_level set effective_to = p_effective_from - 1
     where producer_id = p_producer_id and carrier_id = p_carrier_id and effective_from < p_effective_from
       and (effective_to is null or effective_to >= p_effective_from);
    insert into public.producer_contract_level (tenant_id, agency_id, producer_id, carrier_id, level_bps, effective_from, effective_to, created_by)
    values (p_tenant_id, v_agency, p_producer_id, p_carrier_id, p_level_bps, p_effective_from,
            (select min(l.effective_from) - 1 from public.producer_contract_level l where l.producer_id = p_producer_id and l.carrier_id = p_carrier_id and l.effective_from > p_effective_from),
            p_actor);
  end if;

  if v_number is not null then
    -- Refused, not reconciled later: another producer of this agency holds that number on that day.
    if exists (select 1 from public.producer_writing_number w
                where w.tenant_id = p_tenant_id and w.carrier_id = p_carrier_id and w.writing_number = v_number and w.producer_id <> p_producer_id
                  and p_effective_from <= coalesce(w.effective_to, '9999-12-31'::date)) then
      raise exception 'writing_number_taken' using errcode = 'P0001';
    end if;
    update public.producer_writing_number set effective_to = p_effective_from - 1
     where producer_id = p_producer_id and carrier_id = p_carrier_id and effective_from < p_effective_from
       and (effective_to is null or effective_to >= p_effective_from);
    insert into public.producer_writing_number (tenant_id, agency_id, producer_id, carrier_id, writing_number, effective_from, created_by)
    values (p_tenant_id, v_agency, p_producer_id, p_carrier_id, v_number, p_effective_from, p_actor);
    -- Through to LA-4's attribution map, which the commission writer and the policy refresh already read.
    insert into public.carrier_agent_map (tenant_id, carrier_id, agent_identifier, user_id, mapped_by, mapped_at)
    values (p_tenant_id, p_carrier_id, v_number, v_user, p_actor, now())
    on conflict (tenant_id, carrier_id, agent_identifier) do update set user_id = excluded.user_id, mapped_by = excluded.mapped_by, mapped_at = excluded.mapped_at;
  end if;
end;
$$;
revoke all on function public.set_producer_carrier(uuid, uuid, uuid, integer, text, date, uuid) from public, anon, authenticated;
grant execute on function public.set_producer_carrier(uuid, uuid, uuid, integer, text, date, uuid) to service_role;

-- ─── appointments, per producer ───────────────────────────────────────────────────────────────────
-- LA-0.5's `appointments` is the AGENCY's (tenant, carrier, state). In an agency each producer is appointed
-- separately, and three later tasks read it per producer: the Carriers tab (AG-1.1), state routing that must
-- never send a lead to a producer who cannot write that state (AG-0.10), and the licence gate (AG-1.10 / LA-6.2
-- amendment: per producer per state per carrier). One row per producer, carrier and state.
create table if not exists public.producer_appointment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  agency_id uuid not null,
  producer_id uuid not null,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  state text not null,
  status text not null default 'appointed',
  effective_from date,
  expires_on date,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint producer_appointment_producer_fk foreign key (producer_id, tenant_id) references public.producer (id, tenant_id) on delete cascade,
  constraint producer_appointment_agency_fk foreign key (agency_id, tenant_id) references public.agency (id, tenant_id) on delete cascade,
  constraint producer_appointment_one unique (producer_id, carrier_id, state),
  constraint producer_appointment_state check (state ~ '^[A-Z]{2}$'),
  constraint producer_appointment_status check (status in ('pending', 'appointed', 'terminated'))
);
revoke all on public.producer_appointment from public, anon, authenticated;
revoke truncate on public.producer_appointment from service_role, tenant_app;
grant select on public.producer_appointment to tenant_app;
grant select, insert, update, delete on public.producer_appointment to service_role;
alter table public.producer_appointment enable row level security;
drop policy if exists producer_appointment_tenant_read on public.producer_appointment;
create policy producer_appointment_tenant_read on public.producer_appointment for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Whether a producer can write a carrier in a state on a date: appointed, and not past expiry.
create or replace function public.producer_appointed(p_tenant_id uuid, p_producer_user_id uuid, p_carrier_id uuid, p_state text, p_as_of date default current_date)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.producer_appointment a join public.producer p on p.id = a.producer_id
     where a.tenant_id = p_tenant_id and p.user_id = p_producer_user_id and a.carrier_id = p_carrier_id and a.state = upper(p_state)
       and a.status = 'appointed' and (a.effective_from is null or a.effective_from <= p_as_of) and (a.expires_on is null or p_as_of <= a.expires_on)
  );
$$;
revoke all on function public.producer_appointed(uuid, uuid, uuid, text, date) from public, anon, authenticated;
grant execute on function public.producer_appointed(uuid, uuid, uuid, text, date) to service_role, tenant_app;

-- ─── self-check ───────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'producer_writing_number_one_owner' and contype = 'x') then
    raise exception 'AG-0.9: a writing number can be claimed by two producers at once';
  end if;
  if obj_description('public.producer_contract_level'::regclass) not like '%Known gap%' then
    raise exception 'AG-0.9: the per-product gap is not named on the table';
  end if;
end;
$$;
