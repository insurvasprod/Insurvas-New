-- AG-1.6 (Notion sprint, Agency Module 0 / AG-1) · commission splits on top of the override.
--
-- Splits and overrides are two different things; merged, they collide:
--   override  the agency keeps the gap between its level and the producer's — COMPUTED, nobody types it (AG-1.3)
--   split     two producers agreed to share one policy 60/40 — ENTERED, per policy
-- Order of operations, fixed:
--   1. agency commission (agency level × premium)
--   2. producer pool    (the WRITING producer's level × premium — the non-writer's level is not applied; he gets
--                        his share of the writer's pool, and the screen says so)
--   3. owner override   (1 − 2)
--   4. split the pool   (these shares)
-- Shares are integer basis points summing to EXACTLY 10000 — anything else is refused, never normalised. A split
-- survives a chargeback (each party is debited his share, in the same proportions) and a split with an offboarded
-- producer still pays into his frozen balance; his share is never reassigned (AG-1.5 posts both).
--
-- The LA-7.5 amendment (decision D4): on an AGENCY plan the old producer_split rule (a percentage of the agency's
-- commission) is not applied — AG-1.5's writer replaces it there. A solo agent's LA-7.5 keeps working unchanged.
--
-- Requires 20261018100000 (agency, producer).
--
-- Rollback: drop function set_policy_split(uuid, uuid, text, jsonb, uuid); drop table policy_split.

create table if not exists public.policy_split (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  agency_id uuid not null,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  policy_number text not null,
  producer_user_id uuid not null references public.users(id) on delete restrict,
  share_bps integer not null,
  is_writer boolean not null default false,
  set_id uuid not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- a set is replaced, never edited: the old set is closed by superseded_at
  superseded_at timestamptz,
  constraint policy_split_agency_fk foreign key (agency_id, tenant_id) references public.agency (id, tenant_id) on delete cascade,
  constraint policy_split_share check (share_bps between 1 and 10000),
  constraint policy_split_policy check (length(btrim(policy_number)) between 1 and 100)
);
create unique index if not exists policy_split_one_live_per_producer
  on public.policy_split (tenant_id, carrier_id, policy_number, producer_user_id) where superseded_at is null;
create index if not exists policy_split_live on public.policy_split (tenant_id, carrier_id, policy_number) where superseded_at is null;

revoke all on public.policy_split from public, anon, authenticated;
revoke insert, update, delete, truncate on public.policy_split from service_role, tenant_app;
grant select on public.policy_split to service_role, tenant_app;
alter table public.policy_split enable row level security;
drop policy if exists policy_split_tenant_read on public.policy_split;
create policy policy_split_tenant_read on public.policy_split for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- p_shares: [{ "producer_user_id": uuid, "share_bps": int }, …]; p_writer: the writing producer (must be in it).
-- An empty array removes the split (the writer keeps the whole pool again).
create or replace function public.set_policy_split(p_tenant_id uuid, p_carrier_id uuid, p_policy_number text, p_shares jsonb, p_writer uuid, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agency uuid;
  v_total bigint;
  v_count integer;
  v_set uuid := gen_random_uuid();
begin
  select a.id into v_agency from public.agency a where a.tenant_id = p_tenant_id;
  if v_agency is null then raise exception 'agency_plan_required' using errcode = 'P0001'; end if;
  if jsonb_typeof(coalesce(p_shares, '[]'::jsonb)) <> 'array' then raise exception 'split_shape' using errcode = 'P0001'; end if;
  select count(*), coalesce(sum((s->>'share_bps')::bigint), 0) into v_count, v_total from jsonb_array_elements(coalesce(p_shares, '[]'::jsonb)) s;
  if v_count > 0 then
    if v_total <> 10000 then raise exception 'split_must_total_10000:%', v_total using errcode = 'P0001'; end if;
    if exists (select 1 from jsonb_array_elements(p_shares) s where (s->>'share_bps') !~ '^[0-9]+$' or (s->>'share_bps')::int < 1) then
      raise exception 'split_share_positive' using errcode = 'P0001';
    end if;
    if not exists (select 1 from jsonb_array_elements(p_shares) s where (s->>'producer_user_id')::uuid = p_writer) then
      raise exception 'split_writer_missing' using errcode = 'P0001';
    end if;
    if exists (select 1 from jsonb_array_elements(p_shares) s
                where not exists (select 1 from public.producer p where p.tenant_id = p_tenant_id and p.user_id = (s->>'producer_user_id')::uuid)) then
      raise exception 'split_not_a_producer' using errcode = 'P0001';
    end if;
    if (select count(distinct s->>'producer_user_id') from jsonb_array_elements(p_shares) s) <> v_count then
      raise exception 'split_duplicate_producer' using errcode = 'P0001';
    end if;
  end if;

  update public.policy_split set superseded_at = now()
   where tenant_id = p_tenant_id and carrier_id = p_carrier_id and policy_number = btrim(p_policy_number) and superseded_at is null;
  insert into public.policy_split (tenant_id, agency_id, carrier_id, policy_number, producer_user_id, share_bps, is_writer, set_id, created_by)
  select p_tenant_id, v_agency, p_carrier_id, btrim(p_policy_number), (s->>'producer_user_id')::uuid, (s->>'share_bps')::int,
         (s->>'producer_user_id')::uuid = p_writer, v_set, p_actor
    from jsonb_array_elements(coalesce(p_shares, '[]'::jsonb)) s;
  return v_set;
end;
$$;
revoke all on function public.set_policy_split(uuid, uuid, text, jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_policy_split(uuid, uuid, text, jsonb, uuid, uuid) to service_role;

-- ─── self-check ───────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if pg_get_functiondef('public.set_policy_split(uuid,uuid,text,jsonb,uuid,uuid)'::regprocedure) not like '%split_must_total_10000%' then
    raise exception 'AG-1.6: a split that does not total 10000 is not refused';
  end if;
end;
$$;
