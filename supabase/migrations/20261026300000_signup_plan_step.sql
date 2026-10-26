-- Sign-up gets its own plan step (owner, 2026-10-26: Step 4 of 5, "Your plan", option B).
--
-- The plan used to be picked on the account form. It is now picked after Your agency, with the
-- seat count and any add-on modules the plan offers, and Payment shows all of it.
--
-- 1. signup_selections.seats: how many seats the owner said they need. For an agency plan it picks
--    the seat band (the band IS the plan, AG-0.12); for a one-agent plan it is 1. It is shown on
--    Payment and never billed on its own. Null on rows chosen before this step existed.
-- 2. signup_selection_addons: the add-ons ticked on the plan step. Checkout completion attaches
--    them to the new subscription with admin_attach_addon, so they bill the way an admin-attached
--    add-on already does. Written and read by the service role only; no tenant role sees it.

alter table public.signup_selections
  add column if not exists seats integer;

alter table public.signup_selections
  drop constraint if exists signup_selections_seats_positive;
alter table public.signup_selections
  add constraint signup_selections_seats_positive check (seats is null or seats between 1 and 100000);

create table if not exists public.signup_selection_addons (
  tenant_id   uuid not null references public.signup_selections (tenant_id) on delete cascade,
  addon_id    uuid not null references public.addons (id) on delete cascade,
  selected_at timestamptz not null default now(),
  constraint signup_selection_addons_pkey primary key (tenant_id, addon_id)
);

create index if not exists signup_selection_addons_addon_idx on public.signup_selection_addons (addon_id);

alter table public.signup_selection_addons enable row level security;

-- Supabase grants every new table to anon, authenticated and service_role by default. Only the
-- service role (the sign-up routes and checkout completion) reads or writes this one.
revoke all on table public.signup_selection_addons from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'tenant_app') then
    execute 'revoke all on table public.signup_selection_addons from tenant_app';
  end if;
end
$$;
grant select, insert, delete on table public.signup_selection_addons to service_role;
revoke update, truncate on table public.signup_selection_addons from service_role;

-- Check block: fails the script, rolled back, if any piece did not land.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'signup_selections' and column_name = 'seats') then
    raise exception 'signup_selections.seats missing';
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'signup_selection_addons' and c.relrowsecurity) then
    raise exception 'signup_selection_addons missing or RLS off';
  end if;
  if has_table_privilege('authenticated', 'public.signup_selection_addons', 'select') then
    raise exception 'signup_selection_addons readable by authenticated';
  end if;
end
$$;
