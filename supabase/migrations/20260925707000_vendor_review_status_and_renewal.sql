-- ---------------------------------------------------------------------------
-- Vendors · a vendor can be under review, has a renewal date and a category label
--
-- User decisions (2026-09-25, Vendors concept board LA-2 §5):
--   * status gains 'under_review' beside 'active' and 'inactive'. It is STORED because it is a
--     person's judgement ("we are deciding whether to keep buying from them"). An under-review
--     vendor can still be given new campaigns — the screen warns, the database does not refuse.
--   * "Trialling" is NOT a status. It is derived (tenant_vendor_card, 20260925707100) from the
--     vendor's campaigns and leads, so it can never be left stale by someone forgetting to change it.
--   * renews_on: the contract renewal date, entered by hand. Nothing computes it and nothing acts on
--     it; the drop-recommendation facts quote it so the decision is made before the renewal, not after.
--   * category: a short free-text source label ("Direct mail responders", "Aged & ping-post").
--     lead_type stays the closed list/realtime/aged vocabulary the rest of the product keys on; the
--     label is for people and nothing branches on it.
--
-- Additive. The status check is replaced (drop + add under its own name), never loosened to free
-- text. Existing rows are all 'active' or 'inactive' and stay valid.
-- ---------------------------------------------------------------------------

alter table public.tenant_lead_vendors
  add column if not exists category text,
  add column if not exists renews_on date;

-- The column check from 20260913260000 was declared inline, so Postgres named it
-- tenant_lead_vendors_status_check. Any other check that constrains status is dropped too, so the
-- table ends with exactly one rule for it.
do $$
declare
  r record;
begin
  for r in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.tenant_lead_vendors'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ~ '\mstatus\M'
  loop
    execute format('alter table public.tenant_lead_vendors drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.tenant_lead_vendors
  add constraint tenant_lead_vendors_status_check
  check (status in ('active', 'under_review', 'inactive'));

alter table public.tenant_lead_vendors drop constraint if exists tenant_lead_vendors_category_check;
alter table public.tenant_lead_vendors
  add constraint tenant_lead_vendors_category_check
  check (category is null or char_length(btrim(category)) between 1 and 80);

-- Column meanings (kept here rather than as COMMENT ON, which the parse-checker cannot see past
-- a privilege-blocked ADD COLUMN):
--   status     active | under_review | inactive. Trialling is derived by tenant_vendor_card.
--   renews_on  contract renewal date, entered by hand; quoted by the drop facts, acted on by nothing.
--   category   free-text source label for people; lead_type is the vocabulary code branches on.

-- ── assertions ─────────────────────────────────────────────────────────────
do $$
declare
  v_defs text;
  v_count integer;
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925707000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tenant_lead_vendors' and column_name = 'renews_on' and data_type = 'date') then
    raise exception 'tenant_lead_vendors.renews_on is missing or not a date';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tenant_lead_vendors' and column_name = 'category') then
    raise exception 'tenant_lead_vendors.category is missing';
  end if;

  select count(*), string_agg(pg_get_constraintdef(c.oid), ' | ')
    into v_count, v_defs
    from pg_constraint c
   where c.conrelid = 'public.tenant_lead_vendors'::regclass and c.contype = 'c'
     and pg_get_constraintdef(c.oid) ~ '\mstatus\M';
  if v_count <> 1 then
    raise exception 'tenant_lead_vendors should have exactly one status check, found %: %', v_count, v_defs;
  end if;
  if strpos(v_defs, 'under_review') = 0 or strpos(v_defs, 'inactive') = 0 or strpos(v_defs, 'active') = 0 then
    raise exception 'tenant_lead_vendors status check does not allow active / under_review / inactive: %', v_defs;
  end if;
  -- Trialling is derived. If it ever becomes a stored status, the derivation and the column disagree.
  if strpos(v_defs, 'trial') > 0 then
    raise exception 'trialling must not be a stored vendor status';
  end if;

  if exists (select 1 from public.tenant_lead_vendors where status not in ('active', 'under_review', 'inactive')) then
    raise exception 'a vendor row carries a status outside the new rule';
  end if;
  raise notice '20260925707000: vendors can be under review, and carry a renewal date and a category label';
end $$;
