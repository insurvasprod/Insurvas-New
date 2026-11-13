-- ============================================================================
-- Pending migrations — 1 files, each in its own transaction
-- Generated 2026-11-12 by scripts/build-pending-bundle.mjs. Do not hand-edit; regenerate.
--
-- HOW TO RUN: Supabase dashboard → SQL editor → paste this whole file → Run.
-- Each file is begin … commit on its own. The SQL editor STOPS at the first error: that file is
-- rolled back, the files before it stay applied, and nothing after it runs. Fix the named file,
-- regenerate, and run the whole script again — re-running is safe: the files use
-- create-or-replace / if-not-exists, and history rows use on-conflict-do-nothing.
--
-- AFTERWARDS: node --env-file=.env.local scripts/verify-applied-migrations.mjs
--
-- Files, in order:
--    1. 20261112310000_team_carriers_r8.sql
-- ============================================================================

-- ─── [1/1] 20261112310000_team_carriers_r8.sql ───────────────────────────────────
begin;

-- Settings round 8, wave 3 · Team & access and the Browser extension (board docs/design/settings-r8/team-carriers.html).
--
-- The screens ship before this file is applied. Each piece is probed by the app; until it exists the
-- page keeps working and its status line says "needs a database update" where the piece is used.
--
--   1. tenant_hand_over_member_work   "Hand over now" in the person sheet: moves a person's open work to a
--                                     teammate WITHOUT deactivating them (before a role change, a leave).
--                                     The moves and the taker rules are tenant_deactivate_member's
--                                     (20261015640000), restated without the account switch-off.
--   2. tenant_extension_access_block  "Revoke" on Settings › Browser extension: a person may no longer open
--                                     extension grants, for every carrier (carrier_id null) or one carrier.
--                                     Read by the grant mint (lib/extension/accessBlocks.ts).

-- ─── 1 · hand over open work, keep the person ────────────────────────────────────────────────────
create or replace function public.tenant_hand_over_member_work(p_tenant_id uuid, p_user_id uuid, p_actor uuid, p_to uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_role text;
  v_open jsonb;
  v_moved jsonb := '{}'::jsonb;
  v_n integer;
  v_target_role text;
  v_cannot text[] := '{}';
begin
  select tu.role::text into v_role
    from public.tenant_users tu
   where tu.tenant_id = p_tenant_id and tu.user_id = p_user_id and tu.accepted_at is not null
   for update of tu;
  if v_role is null then
    raise exception 'member_not_found' using errcode = 'P0001';
  end if;

  select tu.role::text into v_target_role
    from public.tenant_users tu join public.users u on u.id = tu.user_id
   where tu.tenant_id = p_tenant_id and tu.user_id = p_to and tu.accepted_at is not null and u.status = 'active';
  if p_to is null or p_to = p_user_id or v_target_role is null then
    raise exception 'reassign_target_invalid' using errcode = 'P0001';
  end if;

  v_open := public.tenant_member_open_work(p_tenant_id, p_user_id);

  if v_target_role not in ('owner', 'producer') then
    if (v_open->>'claimed_leads')::int > 0 then v_cannot := array_append(v_cannot, 'claimed_leads'); end if;
    if (v_open->>'callbacks')::int > 0 then v_cannot := array_append(v_cannot, 'callbacks'); end if;
    if (v_open->>'appointments')::int > 0 then v_cannot := array_append(v_cannot, 'appointments'); end if;
    if (v_open->>'reinstatement_cases')::int > 0 then v_cannot := array_append(v_cannot, 'reinstatement_cases'); end if;
    if (v_open->>'servicing_requests')::int > 0 then v_cannot := array_append(v_cannot, 'servicing_requests'); end if;
  end if;
  if exists (
    select 1 from public.queue_item q
     where q.tenant_id = p_tenant_id and q.assigned_to_user_id = p_user_id and q.status = 'open'
       and not (case q.assigned_role
                  when 'writing_agent' then v_target_role in ('owner', 'producer')
                  when 'retention' then v_target_role in ('owner', 'producer')
                  when 'operations' then v_target_role in ('owner', 'bookkeeper')
                  else v_target_role = 'owner'
                end)
  ) then
    v_cannot := array_append(v_cannot, 'queue_items');
  end if;
  if cardinality(v_cannot) > 0 then
    raise exception 'reassign_target_cannot_work:%', array_to_string(v_cannot, ',') using errcode = 'P0001';
  end if;

  update public.queue_item set assigned_to_user_id = p_to, updated_at = now()
   where tenant_id = p_tenant_id and assigned_to_user_id = p_user_id and status = 'open';
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('queue_items', v_n);

  update public.reinstatement_case set worked_by = p_to
   where tenant_id = p_tenant_id and worked_by = p_user_id and status in ('identified', 'contacted', 'client_agreed', 'submitted');
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('reinstatement_cases', v_n);

  update public.lead_queue set claimed_by = p_to, owner_user_id = p_to, updated_at = now()
   where tenant_id = p_tenant_id and claimed_by = p_user_id and status = 'claimed' and disposition is null;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('claimed_leads', v_n);

  update public.tenant_callbacks set assigned_to = p_to, updated_at = now()
   where tenant_id = p_tenant_id and assigned_to = p_user_id and status in ('scheduled', 'due');
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('callbacks', v_n);

  update public.tenant_appointments set agent_user_id = p_to
   where tenant_id = p_tenant_id and agent_user_id = p_user_id and status in ('booked', 'confirmed') and starts_at_utc > now();
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('appointments', v_n);

  -- Who follows the request up now; who asked for it (requested_by) stays as it was.
  update public.servicing_request set assigned_to = p_to
   where tenant_id = p_tenant_id and coalesce(assigned_to, requested_by) = p_user_id and status in ('draft', 'submitted', 'awaiting_carrier', 'confirmed_by_carrier');
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('servicing_requests', v_n);

  return jsonb_build_object('role', v_role, 'open', v_open, 'moved', v_moved, 'handed_to', p_to, 'actor', p_actor);
end;
$$;

revoke all on function public.tenant_hand_over_member_work(uuid, uuid, uuid, uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'tenant_app') then
    execute 'revoke all on function public.tenant_hand_over_member_work(uuid, uuid, uuid, uuid) from tenant_app';
  end if;
end $$;
grant execute on function public.tenant_hand_over_member_work(uuid, uuid, uuid, uuid) to service_role;

-- ─── 2 · who may not use the browser extension ───────────────────────────────────────────────────
create table if not exists public.tenant_extension_access_block (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  -- null = every carrier site.
  carrier_id uuid references public.carriers(id) on delete cascade,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists tenant_extension_access_block_one
  on public.tenant_extension_access_block (tenant_id, user_id, coalesce(carrier_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists tenant_extension_access_block_user_idx on public.tenant_extension_access_block (user_id);

alter table public.tenant_extension_access_block enable row level security;
-- Server-only: the service role reads and writes it; no tenant session or anonymous key sees it.
revoke all on table public.tenant_extension_access_block from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'tenant_app') then
    execute 'revoke all on table public.tenant_extension_access_block from tenant_app';
  end if;
end $$;
grant select, insert, delete on table public.tenant_extension_access_block to service_role;

-- ─── checks ──────────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.tenant_hand_over_member_work(uuid, uuid, uuid, uuid)') is null then
    raise exception '20261112310000: tenant_hand_over_member_work is missing';
  end if;
  if to_regclass('public.tenant_extension_access_block') is null then
    raise exception '20261112310000: tenant_extension_access_block is missing';
  end if;
end $$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20261112310000', 'team_carriers_r8') on conflict do nothing;
  end if;
end $bundle$;
commit;
