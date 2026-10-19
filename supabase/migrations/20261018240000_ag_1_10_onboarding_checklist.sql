-- AG-1.10 (Notion sprint, Agency Module 0 / AG-1) · the producer onboarding checklist, feeding can_submit.
--
-- Not recruiting, not an LMS: seven items between an invited producer and his first application, each one
-- something a later module needs in order to be CORRECT.
--   licence       state licence number + expiry         → the licence gate (LA-6.2)
--   appointments  state appointments per carrier          → the licence gate; state routing (AG-0.10)
--   contracting   carrier contracting complete            → the owner approves
--   numbers       a writing number per appointed carrier  → statement attribution (AG-1.4)
--   levels        a contract level per appointed carrier  → the override arithmetic (AG-1.3)
--   eo            E&O certificate + expiry                → the licence gate
--   w9            W-9 on file                             → the owner uploads; encrypted at rest, masked, never
--                                                           sent to an AI provider; no SSN is collected here
--
-- can_submit is DERIVED — written only by producer_refresh_can_submit (no app role holds a grant on it, AG-0.1).
-- Until every item holds, it stays false and the Sell module refuses him naming the FIRST missing item
-- (can_submit_reason), not "not authorised". An expiring licence, appointment or E&O flips it back to false with
-- no human action: the daily job re-derives every producer (and the agency dashboard warns 60 days ahead).
-- Completing the checklist moves an onboarding producer to active.
--
-- The owner (producer #1 after AG-0.8) holds the agency's contracts: his licence, appointments and E&O are the
-- agency's own records (licenses, appointments, eo_policies) — that is not a guess, it is what they are — and he
-- is not asked to approve his own contracting or to file a W-9 with himself.
--
-- The LA-6.2 amendment: the gate reads producer.can_submit PER PRODUCER, and the appointment check is per producer
-- per state per carrier (producer_appointment, AG-0.9) — enforced at submission (lib/agency/submitGate.ts).
--
-- Requires 20261018155000 (producer_appointment, levels, numbers), 20261018100000 (producer).
--
-- Rollback: select cron.unschedule('agency-can-submit-daily'); drop function producer_refresh_can_submit,
--   producer_refresh_can_submit_all, producer_checklist; drop table producer_onboarding_item.

create table if not exists public.producer_onboarding_item (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  producer_id uuid not null,
  item text not null,
  completed_at timestamptz not null default now(),
  completed_by uuid references public.users(id) on delete set null,
  expires_on date,
  -- a document's storage path (E&O certificate, W-9) — never the document's contents
  document_path text,
  note text,
  constraint producer_onboarding_item_producer_fk foreign key (producer_id, tenant_id) references public.producer (id, tenant_id) on delete cascade,
  constraint producer_onboarding_item_one unique (producer_id, item),
  constraint producer_onboarding_item_kind check (item in ('contracting', 'eo', 'w9'))
);
revoke all on public.producer_onboarding_item from public, anon, authenticated;
revoke truncate on public.producer_onboarding_item from service_role, tenant_app;
grant select on public.producer_onboarding_item to tenant_app;
grant select, insert, update, delete on public.producer_onboarding_item to service_role;
alter table public.producer_onboarding_item enable row level security;
drop policy if exists producer_onboarding_item_read on public.producer_onboarding_item;
create policy producer_onboarding_item_read on public.producer_onboarding_item for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- ─── the checklist, derived: one row per item with whether it holds and why not ───────────────────
create or replace function public.producer_checklist(p_tenant_id uuid, p_producer_id uuid, p_as_of date default current_date)
returns table(item text, seq integer, done boolean, detail text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_owner boolean;
  v_appointed uuid[];
  v_missing_numbers integer;
  v_missing_levels integer;
begin
  select p.user_id into v_user from public.producer p where p.tenant_id = p_tenant_id and p.id = p_producer_id;
  if v_user is null then return; end if;
  v_owner := exists (select 1 from public.tenant_users tu where tu.tenant_id = p_tenant_id and tu.user_id = v_user and tu.role::text = 'owner' and tu.agency_role is null);

  -- 1. licence: a licensed state with an expiry on record, not lapsed
  return query select 'licence', 1,
    exists (select 1 from public.tenant_user_licensed_states s where s.tenant_id = p_tenant_id and s.user_id = v_user and s.expires_on is not null and s.expires_on >= p_as_of)
    or (v_owner and exists (select 1 from public.licenses l where l.tenant_id = p_tenant_id and l.expires_at is not null and l.expires_at >= p_as_of)),
    'State licence number and expiry';

  -- 2. appointments: at least one carrier appointment in force
  select coalesce(array_agg(distinct a.carrier_id), '{}') into v_appointed
    from public.producer_appointment a
   where a.producer_id = p_producer_id and a.status = 'appointed' and (a.effective_from is null or a.effective_from <= p_as_of) and (a.expires_on is null or a.expires_on >= p_as_of);
  if v_owner and cardinality(v_appointed) = 0 then
    select coalesce(array_agg(distinct a.carrier_id), '{}') into v_appointed from public.appointments a
     where a.tenant_id = p_tenant_id and a.status = 'active' and (a.expires_at is null or a.expires_at >= p_as_of) and (a.terminated_at is null or a.terminated_at >= p_as_of);
  end if;
  return query select 'appointments', 2, cardinality(v_appointed) > 0, 'State appointments per carrier';

  -- 3. contracting: the owner approved it (the owner himself holds the contracts)
  return query select 'contracting', 3,
    v_owner or exists (select 1 from public.producer_onboarding_item i where i.producer_id = p_producer_id and i.item = 'contracting'),
    'Carrier contracting complete';

  -- 4. & 5. a writing number and a contract level for every appointed carrier
  select count(*) into v_missing_numbers from unnest(v_appointed) c(id)
   where not exists (select 1 from public.producer_writing_number w where w.producer_id = p_producer_id and w.carrier_id = c.id
                      and p_as_of between w.effective_from and coalesce(w.effective_to, '9999-12-31'::date));
  return query select 'numbers', 4, cardinality(v_appointed) > 0 and v_missing_numbers = 0,
    case when v_missing_numbers > 0 then format('Writing number per carrier (%s missing)', v_missing_numbers) else 'Writing number per carrier' end;
  select count(*) into v_missing_levels from unnest(v_appointed) c(id)
   where not exists (select 1 from public.producer_contract_level l where l.producer_id = p_producer_id and l.carrier_id = c.id
                      and p_as_of between l.effective_from and coalesce(l.effective_to, '9999-12-31'::date));
  return query select 'levels', 5, cardinality(v_appointed) > 0 and v_missing_levels = 0,
    case when v_missing_levels > 0 then format('Contract level per carrier (%s missing)', v_missing_levels) else 'Contract level per carrier' end;

  -- 6. E&O with an expiry, in force
  return query select 'eo', 6,
    exists (select 1 from public.producer_onboarding_item i where i.producer_id = p_producer_id and i.item = 'eo' and i.expires_on >= p_as_of and i.document_path is not null)
    or (v_owner and exists (select 1 from public.eo_policies e where e.tenant_id = p_tenant_id and e.expires_at is not null and e.expires_at >= p_as_of)),
    'E&O certificate and expiry';

  -- 7. W-9 (not asked of the owner)
  return query select 'w9', 7,
    v_owner or exists (select 1 from public.producer_onboarding_item i where i.producer_id = p_producer_id and i.item = 'w9' and i.document_path is not null),
    'W-9 on file';
end;
$$;

-- ─── the ONE writer of can_submit ─────────────────────────────────────────────────────────────────
create or replace function public.producer_refresh_can_submit(p_tenant_id uuid, p_producer_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_missing text;
  v_ok boolean;
begin
  select status into v_status from public.producer where tenant_id = p_tenant_id and id = p_producer_id for update;
  if v_status is null then return false; end if;
  select c.detail into v_missing from public.producer_checklist(p_tenant_id, p_producer_id) c where not c.done order by c.seq limit 1;
  v_ok := v_missing is null and v_status in ('onboarding', 'active');
  update public.producer
     set can_submit = v_ok,
         can_submit_reason = case
           when v_status in ('suspended', 'offboarded') then initcap(v_status)
           when v_missing is not null then v_missing || ' missing'
           else null end,
         can_submit_checked_at = now(),
         status = case when v_status = 'onboarding' and v_missing is null then 'active' else v_status end,
         updated_at = now()
   where tenant_id = p_tenant_id and id = p_producer_id;
  return v_ok;
end;
$$;

create or replace function public.producer_refresh_can_submit_all()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v record;
  v_n integer := 0;
begin
  for v in select p.tenant_id, p.id from public.producer p where p.status in ('onboarding', 'active') loop
    perform public.producer_refresh_can_submit(v.tenant_id, v.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.producer_checklist(uuid, uuid, date), public.producer_refresh_can_submit(uuid, uuid), public.producer_refresh_can_submit_all() from public, anon, authenticated;
grant execute on function public.producer_checklist(uuid, uuid, date), public.producer_refresh_can_submit(uuid, uuid) to service_role;

-- The E&O certificate and the W-9 live in a PRIVATE bucket (encrypted at rest by storage, read only through a
-- 60-second signed link the app issues to the owner, admin or the producer himself). Never sent to an AI provider.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('agency-documents', 'agency-documents', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg']::text[])
on conflict (id) do nothing;

-- Every morning: an expired licence, appointment or E&O flips can_submit with no human action.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'agency-can-submit-daily';
    perform cron.schedule('agency-can-submit-daily', '15 6 * * *', 'select public.producer_refresh_can_submit_all()');
  end if;
end;
$$;

-- ─── self-check (runs the job once, as the pg_cron note in memory insists) ────────────────────────
do $$
begin
  perform public.producer_refresh_can_submit_all();
  if has_column_privilege('service_role', 'public.producer', 'can_submit', 'UPDATE') then
    raise exception 'AG-1.10: can_submit has a human-reachable update path';
  end if;
end;
$$;
