-- Record the moment a trial ends, and how (Admin › Trials, board p-adm-trials).
--
-- The Trials page's "Converted this month" and "Lapsed this month" tiles had nothing to count
-- from: no column says when a subscription stopped trialing. They were inferred from the first
-- successful payment or the cancellation date, and many cancelled trials carry no cancellation
-- date at all. Owner decision (2026-09-25): record it.
--
-- A BEFORE UPDATE trigger stamps the subscription the first time its status leaves 'trialing':
--   converted — the new status is a paying one (active, past_due, cancelling), the same reading
--               lib/trials/boardModel.ts isConvertedStatus uses;
--   lapsed    — anything else (cancelled, expired, …).
-- It is written once and never moved: a converted subscription later cancelled is still a trial
-- that converted. No backfill — history cannot be recovered honestly, so existing rows stay null
-- and the page keeps inferring for them (and says so on hover).

alter table public.subscriptions
  add column if not exists trial_outcome text,
  add column if not exists trial_outcome_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_trial_outcome_check') then
    alter table public.subscriptions add constraint subscriptions_trial_outcome_check
      check (trial_outcome is null or trial_outcome in ('converted', 'lapsed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_trial_outcome_pair_check') then
    alter table public.subscriptions add constraint subscriptions_trial_outcome_pair_check
      check ((trial_outcome is null) = (trial_outcome_at is null));
  end if;
end $$;

create or replace function public.record_subscription_trial_outcome()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'trialing'
     and new.status is distinct from 'trialing'
     and old.trial_outcome_at is null
     and new.trial_outcome_at is null then
    new.trial_outcome := case when new.status in ('active', 'past_due', 'cancelling') then 'converted' else 'lapsed' end;
    new.trial_outcome_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.record_subscription_trial_outcome() from public, anon, authenticated;

drop trigger if exists subscriptions_record_trial_outcome on public.subscriptions;
create trigger subscriptions_record_trial_outcome
  before update of status on public.subscriptions
  for each row
  execute function public.record_subscription_trial_outcome();

-- The month tiles read "ended this month"; the index keeps that a range scan as the table grows.
create index if not exists subscriptions_trial_outcome_at_idx
  on public.subscriptions (trial_outcome_at)
  where trial_outcome_at is not null;

do $$
begin
  -- A role that cannot create objects cannot have applied anything above either (scripts/
  -- check-migrations.mjs parse-checks with such a role); a real apply always reaches the checks.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260925502000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'subscriptions' and column_name = 'trial_outcome_at') then
    raise exception 'subscriptions.trial_outcome_at is missing';
  end if;
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'subscriptions' and t.tgname = 'subscriptions_record_trial_outcome' and not t.tgisinternal
  ) then
    raise exception 'subscriptions_record_trial_outcome trigger is missing';
  end if;
end $$;
