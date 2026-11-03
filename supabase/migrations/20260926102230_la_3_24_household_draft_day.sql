-- LA-3.24 — a spouse's draft day can follow the primary insured's.
--
-- Address and contact values carry tenant_application_values.linked_to_primary and the payment
-- method carries tenant_application_payment_methods.linked_to_primary (20260926100000). The draft
-- day lives on tenant_applications.draft_day, which had no link of its own, so "Both premiums leave
-- on the same day" had nowhere to be remembered — and nothing to detach.
--
--   tenant_applications  +1 column  draft_day_linked — spouse attempts only; the app copies the
--                                   primary's draft_day onto the spouse while it is true
--
-- Down:
--   alter table public.tenant_applications drop column draft_day_linked;

alter table public.tenant_applications
  add column if not exists draft_day_linked boolean not null default false;

alter table public.tenant_applications
  drop constraint if exists tenant_applications_draft_day_linked_spouse,
  add constraint tenant_applications_draft_day_linked_spouse
    check (not draft_day_linked or insured_role = 'spouse') not valid;
alter table public.tenant_applications validate constraint tenant_applications_draft_day_linked_spouse;

-- ── checks ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tenant_applications' and column_name = 'draft_day_linked') then
    raise exception '20260926102230: tenant_applications.draft_day_linked is missing';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_applications_draft_day_linked_spouse' and contype = 'c') then
    raise exception '20260926102230: a primary attempt could be linked to itself';
  end if;
end $$;
