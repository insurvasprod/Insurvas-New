-- Guided setup walkthrough (2026-10-21, owner request; Notion basis: Basic Idea Individual Agent Side
-- §5.2 step 8 "a checklist, not a wall — skip any step and come back", LA-0.3 setup checklist).
--
-- One row per person per workspace: the steps they put aside, the read-only steps they ticked
-- themselves, and whether they hid the dashboard card. Whether a step is DONE is never stored here —
-- it is read from the data the step creates (lib/dashboard/setupProgress.ts) — except for the member
-- steps that only open a screen, which the reader ticks (done_steps).
--
-- Replaces the per-browser localStorage "Hide" flag on the dashboard checklist.
--
-- Written only by the app's /api/app/setup route through the service role, always filtered by the
-- session's tenant and user; RLS is on with no policy, so no browser session reads or writes it.
--
-- Rollback: drop table public.tenant_setup_guide;

create table if not exists public.tenant_setup_guide (
  tenant_id uuid not null,
  user_id uuid not null,
  skipped_steps text[] not null default '{}'::text[],
  done_steps text[] not null default '{}'::text[],
  hidden_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_setup_guide_pkey primary key (tenant_id, user_id),
  -- Leaving the workspace removes the row with the membership.
  constraint tenant_setup_guide_member_fk foreign key (tenant_id, user_id)
    references public.tenant_users (tenant_id, user_id) on delete cascade,
  constraint tenant_setup_guide_steps_valid check (
    cardinality(skipped_steps) <= 50 and cardinality(done_steps) <= 50
    and array_to_string(skipped_steps, ',') ~ '^[a-z0-9-]*(,[a-z0-9-]+)*$'
    and array_to_string(done_steps, ',') ~ '^[a-z0-9-]*(,[a-z0-9-]+)*$'
  )
);

alter table public.tenant_setup_guide enable row level security;

revoke all on public.tenant_setup_guide from anon, authenticated;
-- Supabase grants service_role everything by default; it needs only these three.
revoke all on public.tenant_setup_guide from service_role;
grant select, insert, update on public.tenant_setup_guide to service_role;

create or replace function public.touch_tenant_setup_guide_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $function$
begin new.updated_at := now(); return new; end;
$function$;
revoke all on function public.touch_tenant_setup_guide_updated_at() from public, anon, authenticated;

drop trigger if exists tenant_setup_guide_touch_updated_at on public.tenant_setup_guide;
create trigger tenant_setup_guide_touch_updated_at before update on public.tenant_setup_guide
for each row execute function public.touch_tenant_setup_guide_updated_at();

do $check$
begin
  if not exists (select 1 from pg_class where oid = 'public.tenant_setup_guide'::regclass and relrowsecurity) then
    raise exception 'tenant_setup_guide: RLS is not on';
  end if;
  if has_table_privilege('authenticated', 'public.tenant_setup_guide', 'select') then
    raise exception 'tenant_setup_guide: authenticated can still read it';
  end if;
  if has_table_privilege('service_role', 'public.tenant_setup_guide', 'delete') then
    raise exception 'tenant_setup_guide: service_role can still delete';
  end if;
end;
$check$;
