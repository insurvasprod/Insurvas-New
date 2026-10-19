-- AG-1.4 (Notion sprint, Agency Module 0 / AG-1) · statement attribution by writing number, and the disagreement queue.
--
-- A carrier statement arrives for the agency; every row is money that belongs to one producer. A row given to the
-- wrong producer is money taken from the right one. The rule, in order:
--   1. the WRITING NUMBER on the row → (carrier, writing number) → producer. LA-4 already captures it
--      (commission_entry.agent_identifier) and maps it (carrier_agent_map, fed by AG-0.9). Primary path.
--   2. no usable writing number → our own APPLICATION RECORD: whoever opened the case (LA-3).
--   3. BOTH exist and they DISAGREE → the disagreement queue. No winner is picked silently.
--   4. NEITHER → unattributed: visible to the owner, excluded from every producer figure until resolved, and
--      NEVER defaulted to the owner.
-- Resolving writes the chosen producer, who chose and why, onto the queue row. raw_rows (immutable layer 1) is
-- never edited. Until resolved, no producer ledger entry is written for that row (AG-1.5 asks agency_entry_producer).
--
-- The LA-4.3 / LA-4.4 amendment (writing number a REQUIRED mapped field; a profile that cannot find it raises) is
-- enforced at layout publish for agency tenants in lib/ingestion (see lib/agency/attributionCore.ts).
--
-- Requires 20261018155000 (carrier_agent_map write-through), LA-4.12 commission_entry.
--
-- Rollback: drop function agency_attribution_resolve, agency_entry_producer, agency_attribution_scan,
--   agency_entry_candidates; drop table agency_attribution_item.

create table if not exists public.agency_attribution_item (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  commission_entry_id uuid not null references public.commission_entry(id) on delete restrict,
  kind text not null,
  writing_number_user_id uuid references public.users(id) on delete set null,
  application_user_id uuid references public.users(id) on delete set null,
  carrier_id uuid,
  policy_number text,
  agent_identifier text,
  amount_cents bigint not null,
  file_id uuid,
  row_number integer,
  status text not null default 'open',
  resolved_user_id uuid references public.users(id) on delete restrict,
  resolved_by uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  reason text,
  created_at timestamptz not null default now(),
  constraint agency_attribution_one unique (commission_entry_id),
  constraint agency_attribution_kind check (kind in ('disagreement', 'unattributed')),
  constraint agency_attribution_status check (status in ('open', 'resolved')),
  constraint agency_attribution_resolution check (
    (status = 'open' and resolved_user_id is null and resolved_at is null)
    or (status = 'resolved' and resolved_user_id is not null and resolved_at is not null and length(btrim(coalesce(reason, ''))) between 1 and 500)
  )
);
create index if not exists agency_attribution_open on public.agency_attribution_item (tenant_id, status, created_at);

revoke all on public.agency_attribution_item from public, anon, authenticated;
revoke insert, update, delete, truncate on public.agency_attribution_item from service_role, tenant_app;
grant select on public.agency_attribution_item to service_role, tenant_app;
alter table public.agency_attribution_item enable row level security;
drop policy if exists agency_attribution_tenant_read on public.agency_attribution_item;
create policy agency_attribution_tenant_read on public.agency_attribution_item for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- ─── the two candidates for a statement row ───────────────────────────────────────────────────────
create or replace function public.agency_entry_candidates(p_tenant_id uuid, p_entry_id uuid)
returns table(writing_number_user_id uuid, application_user_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    -- 1. the writing number, mapped now (a number mapped after the row was written still counts)
    coalesce(e.agent_user_id,
             (select m.user_id from public.carrier_agent_map m
               where m.tenant_id = e.tenant_id and m.carrier_id = e.carrier_id and m.agent_identifier = e.agent_identifier)),
    -- 2. the application record: whoever opened the case the policy came from
    coalesce(
      (select c.opened_by from public.policy_current pc join public.tenant_application_cases c on c.id = pc.case_id
        where pc.tenant_id = e.tenant_id and pc.carrier_id = e.carrier_id and pc.policy_number = e.policy_number),
      (select c.opened_by from public.policy_current pc join public.tenant_applications a on a.id = pc.application_id
         join public.tenant_application_cases c on c.id = a.case_id
        where pc.tenant_id = e.tenant_id and pc.carrier_id = e.carrier_id and pc.policy_number = e.policy_number))
    from public.commission_entry e
   where e.tenant_id = p_tenant_id and e.id = p_entry_id;
$$;

-- ─── the producer a row belongs to, or null while it waits for a person ──────────────────────────
create or replace function public.agency_entry_producer(p_tenant_id uuid, p_entry_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.agency_attribution_item%rowtype;
  v_wn uuid;
  v_app uuid;
begin
  select * into v_item from public.agency_attribution_item where commission_entry_id = p_entry_id;
  if found then
    return case when v_item.status = 'resolved' then v_item.resolved_user_id end;
  end if;
  select c.writing_number_user_id, c.application_user_id into v_wn, v_app from public.agency_entry_candidates(p_tenant_id, p_entry_id) c;
  if v_wn is not null and v_app is not null and v_wn <> v_app then return null; end if; -- 3. a person decides
  return coalesce(v_wn, v_app);                                                           -- 1, then 2; 4 = null
end;
$$;

-- ─── fill the queue ───────────────────────────────────────────────────────────────────────────────
create or replace function public.agency_attribution_scan(p_tenant_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  if coalesce(public.tenant_plan_audience(p_tenant_id), '') <> 'agency' then return 0; end if;
  insert into public.agency_attribution_item (tenant_id, commission_entry_id, kind, writing_number_user_id, application_user_id,
                                              carrier_id, policy_number, agent_identifier, amount_cents, file_id, row_number)
  select e.tenant_id, e.id,
         case when c.writing_number_user_id is null and c.application_user_id is null then 'unattributed' else 'disagreement' end,
         c.writing_number_user_id, c.application_user_id, e.carrier_id, e.policy_number, e.agent_identifier, e.amount_cents, e.file_id, e.row_number
    from public.commission_entry e
    cross join lateral public.agency_entry_candidates(e.tenant_id, e.id) c
   where e.tenant_id = p_tenant_id
     and coalesce(e.payee_level, 'writing_agent') = 'writing_agent'
     and ((c.writing_number_user_id is null and c.application_user_id is null)
          or (c.writing_number_user_id is not null and c.application_user_id is not null and c.writing_number_user_id <> c.application_user_id))
     and not exists (select 1 from public.agency_attribution_item i where i.commission_entry_id = e.id)
     and not exists (select 1 from public.producer_ledger_entry l where l.commission_entry_id = e.id)
  on conflict on constraint agency_attribution_one do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ─── a person decides ─────────────────────────────────────────────────────────────────────────────
create or replace function public.agency_attribution_resolve(p_tenant_id uuid, p_item_id uuid, p_user_id uuid, p_reason text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.producer p where p.tenant_id = p_tenant_id and p.user_id = p_user_id) then
    raise exception 'attribution_not_a_producer' using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'attribution_reason_required' using errcode = 'P0001'; end if;
  update public.agency_attribution_item
     set status = 'resolved', resolved_user_id = p_user_id, resolved_by = p_actor, resolved_at = now(), reason = btrim(p_reason)
   where tenant_id = p_tenant_id and id = p_item_id and status = 'open';
  if not found then raise exception 'attribution_item_not_open' using errcode = 'P0001'; end if;
end;
$$;

revoke all on function public.agency_entry_candidates(uuid, uuid), public.agency_entry_producer(uuid, uuid),
  public.agency_attribution_scan(uuid), public.agency_attribution_resolve(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.agency_entry_candidates(uuid, uuid), public.agency_entry_producer(uuid, uuid),
  public.agency_attribution_scan(uuid), public.agency_attribution_resolve(uuid, uuid, uuid, text, uuid) to service_role;

-- ─── self-check ───────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if has_table_privilege('service_role', 'public.agency_attribution_item', 'UPDATE') then
    raise exception 'AG-1.4: the attribution queue can be edited outside its resolver';
  end if;
  if pg_get_functiondef('public.agency_entry_producer(uuid,uuid)'::regprocedure) ~* 'tenant_owner_user' then
    raise exception 'AG-1.4: an unattributed row defaults to the owner';
  end if;
end;
$$;
