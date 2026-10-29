-- "I already chose a plan on the landing page, why choose again?" (manager review, 2026-10-28, 03:43).
--
-- signup_selections always holds a plan: the one picked on the pricing page, or the default one when
-- the person came from "Start free trial". Its presence cannot tell the two apart, so the plan step
-- could never skip the chooser. plan_chosen_at records that the person picked it themselves:
--   * set when /signup?plan=… (or Google, carrying the same plan) creates the account;
--   * set when the plan step's chooser is saved;
--   * null for the default plan, so the chooser is shown.
-- Existing rows stay null: their owners see the chooser once, as they do today.

alter table public.signup_selections
  add column if not exists plan_chosen_at timestamptz;

comment on column public.signup_selections.plan_chosen_at is
  'When the person picked this plan themselves (pricing page or the plan step). Null: the default plan, not yet chosen. See 20261028210000.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'signup_selections' and column_name = 'plan_chosen_at'
  ) then
    raise exception 'signup_selections.plan_chosen_at is missing';
  end if;
end;
$$;
