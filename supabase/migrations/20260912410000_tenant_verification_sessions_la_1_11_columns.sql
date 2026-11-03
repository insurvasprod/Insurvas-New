-- Add the two columns LA-1.11 puts on a verification session.
--
-- Correcting an omission in 20260912400000. That migration built tenant_verification_sessions from
-- this repository's declaration in 20260902230000 -- which is LA-1.10's, the base table. LA-1.11
-- then extends it in 20260903090000:
--
--   alter table public.verification_sessions
--     add column if not exists progress_percentage integer not null default 0,
--     add column if not exists completed_at timestamptz,
--     add column if not exists last_actor_id uuid references public.users(id) on delete set null;
--
-- progress_percentage was carried across; completed_at and last_actor_id were not. The functions
-- ported in the same migration use both -- update_verification_field sets completed_at when progress
-- reaches 100 and stamps last_actor_id on every change, and accept_buffer_handoff stamps
-- last_actor_id on the licensed agent -- so the panel fails with
--
--   42703 column tenant_verification_sessions.completed_at does not exist
--
-- I reproduced a table from one of its three declaring migrations and did not check the other two.
-- The columns a table has are the sum of every migration that touches it, not the CREATE alone.
--
-- LA-1.14's changes to the same table were carried across correctly: agent_role already allows
-- 'assistant' in 20260912400000.
--
-- Safe: both columns are nullable with no default beyond LA-1.11's own, and the table holds no rows
-- that predate this work.

alter table public.tenant_verification_sessions
  add column if not exists completed_at timestamptz,
  add column if not exists last_actor_id uuid references public.users(id) on delete set null;

-- Assert the shape the application selects, rather than assuming these were the only two missing.
-- lib/verification/service.ts reads exactly this list.
do $$
declare
  missing text;
begin
  select string_agg(needed, ', ') into missing
  from unnest(array[
    'id', 'tenant_id', 'work_item_id', 'lead_id', 'user_id', 'agent_role', 'status',
    'started_at', 'completed_at', 'progress_percentage', 'last_actor_id'
  ]) as needed
  where not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'tenant_verification_sessions'
       and column_name = needed
  );

  if missing is not null then
    raise exception 'tenant_verification_sessions is still missing: %', missing;
  end if;
end;
$$;
