-- ---------------------------------------------------------------------------
-- Scorecard (LA-2 §14 concept) · two columns the vendor scorecard needs
--
-- 1. tenant_campaigns.is_test_batch
--    A trial buy — "500 records to see what they are like" — is not comparable with a committed
--    buy. User decision: a MANUAL flag, set on the campaign (the Campaigns page owns the toggle and
--    its PATCH field). The scorecard shows the row with a "Test batch" chip and keeps it out of the
--    ranking; nothing else changes because of it — the leads still dial, the spend still counts in
--    the totals.
--
-- 2. tenant_issued_policies.lapsed_at
--    "Issued & persisting 60 days" needs to know WHEN a policy stopped being in force, not only
--    that it did: a policy that lapsed on day 200 persisted 60 days, one that lapsed on day 20 did
--    not. The status column alone cannot tell them apart. Written by mark_issued_policy_lapsed
--    (20260925708300) and never before the issue date.
--
-- Additive and idempotent. No backfill: every existing campaign is a committed buy until someone
-- says otherwise, and the live policy table has no rows (20260922190000 measured 0).
-- ---------------------------------------------------------------------------

alter table public.tenant_campaigns
  add column if not exists is_test_batch boolean not null default false;

alter table public.tenant_issued_policies
  add column if not exists lapsed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tenant_issued_policies'::regclass
       and conname = 'tenant_issued_policies_lapse_after_issue'
  ) then
    alter table public.tenant_issued_policies
      add constraint tenant_issued_policies_lapse_after_issue
      check (lapsed_at is null or lapsed_at >= issued_at);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tenant_issued_policies'::regclass
       and conname = 'tenant_issued_policies_lapse_matches_status'
  ) then
    -- A lapse date on a live policy would make it count as persisting and as lapsed at once.
    alter table public.tenant_issued_policies
      add constraint tenant_issued_policies_lapse_matches_status
      check (status <> 'issued' or lapsed_at is null);
  end if;
end $$;

do $$
begin
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925708000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tenant_campaigns'
                    and column_name = 'is_test_batch' and data_type = 'boolean' and is_nullable = 'NO') then
    raise exception 'tenant_campaigns.is_test_batch did not land';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tenant_issued_policies'
                    and column_name = 'lapsed_at') then
    raise exception 'tenant_issued_policies.lapsed_at did not land';
  end if;
  if (select count(*) from pg_constraint
       where conrelid = 'public.tenant_issued_policies'::regclass
         and conname in ('tenant_issued_policies_lapse_after_issue', 'tenant_issued_policies_lapse_matches_status')) <> 2 then
    raise exception 'the lapse checks on tenant_issued_policies did not land';
  end if;
  raise notice '20260925708000: is_test_batch and lapsed_at are in place';
end $$;
