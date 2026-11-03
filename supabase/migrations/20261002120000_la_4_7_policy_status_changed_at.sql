-- LA-4.7: when a policy's status last changed — the lapse date persistency and chargebacks need.
--
-- The ledger has been reading a lapsed policy's lapse date from `updated_at`, which ANY edit moves:
-- fix a typo in the insured's name a month after the lapse and the policy "lapsed" a month later,
-- so its chargeback, its persistency cohort and the month it stopped earning all shift. This column
-- moves only when the status itself changes.
--
--   · a BEFORE INSERT OR UPDATE trigger stamps it: on insert, now(); on update, now() only when the
--     status is different from before;
--   · existing lapsed and cancelled rows are backfilled from updated_at (the best date there is),
--     active and pending ones from created_at.
--
-- Additive. Requires 20260917120000 (tenant_policies).
--
-- Down: drop trigger if exists tenant_policies_status_changed_at on public.tenant_policies;
--       drop function if exists public.stamp_tenant_policy_status_changed_at();
--       alter table public.tenant_policies drop column if exists status_changed_at;

alter table public.tenant_policies add column if not exists status_changed_at timestamptz;

-- The backfill must not touch updated_at: the touch trigger is paused for this one statement, so
-- every policy keeps the "last edited" it had.
alter table public.tenant_policies disable trigger tenant_policies_updated_at;
update public.tenant_policies
   set status_changed_at = case when status in ('lapsed', 'cancelled') then updated_at else created_at end
 where status_changed_at is null;
alter table public.tenant_policies enable trigger tenant_policies_updated_at;

alter table public.tenant_policies alter column status_changed_at set default now();
alter table public.tenant_policies alter column status_changed_at set not null;

create or replace function public.stamp_tenant_policy_status_changed_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.status_changed_at := coalesce(new.status_changed_at, now());
  elsif new.status is distinct from old.status then
    new.status_changed_at := now();
  else
    -- An edit that leaves the status alone leaves its date alone, whatever the caller sent.
    new.status_changed_at := old.status_changed_at;
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_tenant_policy_status_changed_at() from public, anon, authenticated;

drop trigger if exists tenant_policies_status_changed_at on public.tenant_policies;
create trigger tenant_policies_status_changed_at
  before insert or update on public.tenant_policies
  for each row execute function public.stamp_tenant_policy_status_changed_at();

create index if not exists tenant_policies_tenant_status_changed_idx
  on public.tenant_policies (tenant_id, status, status_changed_at);

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenant_policies' and column_name = 'status_changed_at' and is_nullable = 'NO') then
    raise exception '20261002120000: tenant_policies.status_changed_at is missing or nullable';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tenant_policies_status_changed_at' and not tgisinternal) then
    raise exception '20261002120000: the status_changed_at trigger is missing';
  end if;
end $$;
