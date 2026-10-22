-- LA-5.8 (Notion sprint, Module 5 — Retention) · the retention role, who owns each LA-5 card, and what
-- the scorecard needs to be fair.
--
--   tenant_user_role  + 'retention'. The same machinery as the setter (LA-2.12) and the buffer agent
--                     (LA-1.14): a value on the enum every gate already reads, not a flag and not a
--                     second permission model. Every route lists the roles it admits, so the new role
--                     reaches nothing until a route names it.
--   queue_assignment_rule  LA-4.9's ownership rules, extended with the three LA-5 queues:
--                     save_queue (retention if the role has users, else the writing agent),
--                     paper_bill (retention) and reinstatement (retention, escalating to the writing
--                     agent inside the agency's escalation window). A role with no users falls back to
--                     the owner, as in LA-4.9.
--   queue_owner / reassign_queue_item  LA-4.9's owner_role 'retention' now resolves to a member whose
--                     role IS retention, and only then (as before) to a producer.
--   retention_assignment  who owns each LA-5 card. One open row per card per queue; written by the app
--                     (the LA-5 queues are computed on read) and never left without an owner.
--   retention_settings  the assignment strategy (round-robin by default, by carrier, by exposure), the
--                     carrier→rep map, the rep order, and the reinstatement escalation (7 days).
--   save_attempt.client_reason  what the client said when they refused ("I can't afford it", "I don't
--                     want it any more"), so the scorecard can break save rate down by the reason.
--
-- ON THE ENUM AND THE TRANSACTION (as in 20260913380000): `add value` may run in a transaction, but the
-- new label may not be USED there. Everything below compares `role::text = 'retention'`.
--
-- Additive. Requires 20261008180000 (queue_assignment_rule), 20261014100000 (save_attempt,
-- retention_settings), 20261014400000 (reinstatement_case).
--
-- Rollback (the enum value cannot be removed; nothing uses it once the routes stop naming it):
--   drop table if exists public.retention_assignment;
--   alter table public.save_attempt drop column if exists client_reason;
--   alter table public.retention_settings drop column if exists assignment_strategy, drop column if exists assignment_carrier_reps,
--     drop column if exists assignment_rep_order, drop column if exists reinstatement_escalate_days;
--   (and restore queue_owner / reassign_queue_item and the two queue_assignment_rule checks from 20261008180000 / 20261008190000)

alter type public.tenant_user_role add value if not exists 'retention';

-- ─── LA-4.9's rules, with the LA-5 queues ───────────────────────────────────────────────────────
alter table public.queue_assignment_rule drop constraint if exists queue_assignment_rule_type;
alter table public.queue_assignment_rule add constraint queue_assignment_rule_type check (queue_type in (
  'no_deal_flow', 'no_policy', 'multi_policy', 'initial_import', 'unmapped_status', 'orphan_commission', 'file_failed',
  'save_queue', 'paper_bill', 'reinstatement'
));
-- The LA-5 queues are owned by retention, the writing agent or the owner — never by operations.
alter table public.queue_assignment_rule drop constraint if exists queue_assignment_rule_la5_role;
alter table public.queue_assignment_rule add constraint queue_assignment_rule_la5_role check (
  queue_type not in ('save_queue', 'paper_bill', 'reinstatement')
  or (owner_role in ('retention', 'writing_agent', 'admin') and (escalate_to_role is null or escalate_to_role = 'writing_agent'))
);

-- owner_role 'retention': a retention rep first, then (as LA-4.9 always did) a producer, then the owner.
create or replace function public.queue_owner(p_tenant_id uuid, p_queue_type text, p_writing_agent uuid default null)
returns table (user_id uuid, role text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_user uuid;
begin
  select r.owner_role into v_role from public.queue_assignment_rule r where r.tenant_id = p_tenant_id and r.queue_type = p_queue_type;
  v_role := coalesce(v_role, case p_queue_type when 'multi_policy' then 'operations' when 'orphan_commission' then 'operations' when 'file_failed' then 'operations' when 'unmapped_status' then 'operations' else 'writing_agent' end);
  if v_role = 'writing_agent' then
    select tu.user_id into v_user from public.tenant_users tu join public.users u on u.id = tu.user_id
     -- A writing agent who can open the queue screen (it carries premiums: owner or producer).
     where tu.tenant_id = p_tenant_id and tu.user_id = p_writing_agent and u.status = 'active' and tu.role::text in ('owner', 'producer');
  else
    select tu.user_id into v_user from public.tenant_users tu join public.users u on u.id = tu.user_id
     where tu.tenant_id = p_tenant_id and u.status = 'active'
       and tu.role::text = any (case v_role when 'operations' then array['bookkeeper'] when 'retention' then array['retention', 'producer'] else array['owner'] end)
     order by case when tu.role::text = 'retention' then 0 else 1 end, tu.accepted_at nulls last, tu.invited_at nulls last, tu.user_id limit 1;
  end if;
  if v_user is null then
    -- Nobody in that role (or the agent is unknown): the agency's owner, never nobody.
    select tu.user_id into v_user from public.tenant_users tu join public.users u on u.id = tu.user_id
     where tu.tenant_id = p_tenant_id and tu.role::text = 'owner' and u.status = 'active'
     order by tu.accepted_at nulls last, tu.invited_at nulls last, tu.user_id limit 1;
    v_role := 'admin';
  end if;
  if v_user is null then
    raise exception 'queue_owner: agency % has no active owner to own a queue item', p_tenant_id using errcode = 'P0001';
  end if;
  return query select v_user, v_role;
end;
$$;

create or replace function public.reassign_queue_item(p_tenant_id uuid, p_item_id uuid, p_role text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type text;
  v_user uuid;
  v_role text;
begin
  select queue_type into v_type from public.queue_item where id = p_item_id and tenant_id = p_tenant_id and status = 'open';
  if v_type is null then
    raise exception 'reassign_queue_item: no open item' using errcode = 'P0001';
  end if;
  if p_role = 'admin' then
    select o.user_id, o.role into v_user, v_role from public.queue_owner(p_tenant_id, '__admin__', null) o;
  else
    select tu.user_id into v_user from public.tenant_users tu join public.users u on u.id = tu.user_id
     where tu.tenant_id = p_tenant_id and u.status = 'active'
       and tu.role::text = any (case p_role when 'operations' then array['bookkeeper'] when 'retention' then array['retention', 'producer'] else array['owner'] end)
     order by case when tu.role::text = 'retention' then 0 else 1 end, tu.accepted_at nulls last, tu.user_id limit 1;
    v_role := p_role;
    if v_user is null then
      select o.user_id, o.role into v_user, v_role from public.queue_owner(p_tenant_id, '__admin__', null) o;
    end if;
  end if;
  update public.queue_item set assigned_to_user_id = v_user, assigned_role = v_role, updated_at = now() where id = p_item_id;
  return v_user;
end;
$$;

-- ─── assignment settings (LA-5.11 edits them) ───────────────────────────────────────────────────
alter table public.retention_settings add column if not exists assignment_strategy text not null default 'round_robin';
alter table public.retention_settings add column if not exists assignment_carrier_reps jsonb not null default '{}'::jsonb;
alter table public.retention_settings add column if not exists assignment_rep_order uuid[] not null default '{}';
alter table public.retention_settings add column if not exists reinstatement_escalate_days smallint not null default 7;
alter table public.retention_settings drop constraint if exists retention_settings_assignment;
alter table public.retention_settings add constraint retention_settings_assignment check (
  assignment_strategy in ('round_robin', 'by_carrier', 'by_exposure')
  and jsonb_typeof(assignment_carrier_reps) = 'object'
  and cardinality(assignment_rep_order) <= 200
  and reinstatement_escalate_days between 1 and 30
);

-- ─── who owns each LA-5 card ────────────────────────────────────────────────────────────────────
create table if not exists public.retention_assignment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  queue_type text not null,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  policy_number text not null,
  -- A user removed outright takes their rows with them; the next read assigns the cards again.
  assigned_to_user_id uuid not null references public.users(id) on delete cascade,
  assigned_role text not null,
  strategy text,
  exposure_cents bigint,
  assigned_at timestamptz not null default now(),
  -- Set when a reinstatement case moved to the writing agent inside the escalation window.
  escalated_at timestamptz,
  -- Set when the card left the queue for good (a lapse, a resolved case, a converted bill).
  closed_at timestamptz,
  constraint retention_assignment_queue check (queue_type in ('save_queue', 'paper_bill', 'reinstatement')),
  constraint retention_assignment_role check (assigned_role in ('retention', 'writing_agent', 'admin')),
  constraint retention_assignment_strategy check (strategy is null or strategy in ('round_robin', 'by_carrier', 'by_exposure')),
  constraint retention_assignment_escalated check (escalated_at is null or (queue_type = 'reinstatement' and assigned_role = 'writing_agent'))
);
-- One owner per open card per queue.
create unique index if not exists retention_assignment_open_key on public.retention_assignment (tenant_id, queue_type, carrier_id, policy_number) where closed_at is null;
create index if not exists retention_assignment_owner_idx on public.retention_assignment (tenant_id, assigned_to_user_id) where closed_at is null;
create index if not exists retention_assignment_user_idx on public.retention_assignment (assigned_to_user_id);
create index if not exists retention_assignment_carrier_idx on public.retention_assignment (carrier_id);

-- ─── the client's own reason, on a refused save call ────────────────────────────────────────────
alter table public.save_attempt add column if not exists client_reason text;
alter table public.save_attempt drop constraint if exists save_attempt_client_reason;
alter table public.save_attempt add constraint save_attempt_client_reason check (
  client_reason is null or (client_reason in ('affordability', 'no_longer_wanted') and contact_outcome = 'reached_refused')
);

-- ─── access ─────────────────────────────────────────────────────────────────────────────────────
alter table public.retention_assignment enable row level security;
drop policy if exists retention_assignment_read on public.retention_assignment;
create policy retention_assignment_read on public.retention_assignment for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.retention_assignment from public, anon, authenticated;
grant select on public.retention_assignment to tenant_app;
-- Ownership moves and closes; a row is history and is never removed.
grant select, insert, update on public.retention_assignment to service_role;
revoke delete, truncate on public.retention_assignment from service_role, tenant_app;
revoke insert, update on public.retention_assignment from tenant_app;

-- ─── self-check ─────────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_labels text;
begin
  select string_agg(e.enumlabel, ',' order by e.enumsortorder) into v_labels
    from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'tenant_user_role';
  if v_labels not like '%retention%' then
    raise exception '20261016200000: retention did not reach tenant_user_role (got %)', v_labels;
  end if;
  if pg_get_functiondef('public.queue_owner(uuid, text, uuid)'::regprocedure) not like '%array[''retention'', ''producer'']%' then
    raise exception '20261016200000: queue_owner does not prefer a retention rep';
  end if;
  if has_table_privilege('service_role', 'public.retention_assignment', 'DELETE') or has_table_privilege('tenant_app', 'public.retention_assignment', 'INSERT') then
    raise exception '20261016200000: retention_assignment grants are wrong';
  end if;
end $$;
