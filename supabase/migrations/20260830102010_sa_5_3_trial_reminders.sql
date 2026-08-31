-- SA-5.3 · Trial management.
--
-- Backfilled into the repo on 2026-08-30: this was applied to the database when SA-5.3 was built
-- but never written here, which is backlog #29 happening again. Copied verbatim from
-- supabase_migrations.schema_migrations version 20260830102010, so this file is the SQL that
-- actually ran rather than a re-typed approximation of it.

create type public.trial_reminder_kind as enum ('four_days_left', 'final_day');

create table public.trial_reminders (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  kind            public.trial_reminder_kind not null,
  due_at          timestamptz not null,
  sent_at         timestamptz not null default now(),
  delivered       boolean not null default false,
  -- What the trial was ending at when this went out. If an extension moves the end date, the
  -- reminder for the NEW date is a different thing and is allowed to send again.
  trial_ends_at   timestamptz not null,

  -- "Each reminder is sent once and only once." Enforced here rather than by the job remembering,
  -- because a job that runs twice — a retry, an overlapping cron, a manual run — is ordinary.
  unique (subscription_id, kind, trial_ends_at)
);

comment on table public.trial_reminders is
  'One row per reminder actually sent. Keyed on the trial end date so an extension re-arms them.';

create index trial_reminders_subscription_idx on public.trial_reminders (subscription_id);

alter table public.trial_reminders enable row level security;
revoke all on public.trial_reminders from tenant_app, anon, authenticated;

/**
 * Extends a trial by whole days.
 *
 * Moves `trial_ends_at` and the current period end together — the charge date IS the period end,
 * so pushing one without the other would leave the customer charged before their trial was over.
 *
 * Reminders need no adjustment: they are computed relative to trial_ends_at, so moving it moves
 * them, which is what "pushes every reminder, not just the next one" means in practice.
 */
create or replace function public.extend_trial(
  p_subscription_id uuid,
  p_days            integer
)
returns table(trial_ends_at timestamptz, current_period_end timestamptz)
language plpgsql
as $$
declare
  v_row public.subscriptions%rowtype;
begin
  if p_days <= 0 then
    raise exception 'an extension must be at least one day';
  end if;

  select * into v_row from public.subscriptions where id = p_subscription_id for update;

  if not found then raise exception 'no such subscription'; end if;
  if v_row.status <> 'trialing' then
    raise exception 'only a trialing subscription can be extended (this one is %)', v_row.status;
  end if;
  if v_row.trial_ends_at is null then
    raise exception 'this subscription has no trial end date';
  end if;

  update public.subscriptions
     set trial_ends_at = v_row.trial_ends_at + make_interval(days => p_days),
         current_period_end = coalesce(v_row.current_period_end, v_row.trial_ends_at)
                              + make_interval(days => p_days)
   where id = p_subscription_id
  returning subscriptions.trial_ends_at, subscriptions.current_period_end
  into trial_ends_at, current_period_end;

  return next;
end;
$$;

revoke execute on function public.extend_trial(uuid, integer) from public, anon, authenticated;
grant execute on function public.extend_trial(uuid, integer) to service_role;

/**
 * Trials in flight, with the signals that say whether one will convert.
 *
 * `last_login_at` stands in for the setup-progress column the ticket describes: nothing records
 * which setup steps are done, and the steps refer to product features that mostly do not exist —
 * so almost every trial would read 0/5 regardless of engagement. Whether the owner has ever logged
 * in is measured, and prompts the same phone call.
 */
create or replace view public.admin_trials_in_flight as
select
  s.id                as subscription_id,
  s.tenant_id,
  t.name              as tenant_name,
  p.name              as plan_name,
  p.code              as plan_code,
  s.billing_cycle,
  s.started_at,
  s.trial_ends_at,
  greatest(0, ceil(extract(epoch from (s.trial_ends_at - now())) / 86400))::integer as days_remaining,
  greatest(0, floor(extract(epoch from (now() - s.started_at)) / 86400))::integer   as days_elapsed,
  owner_user.email    as owner_email,
  owner_user.name     as owner_name,
  owner_user.last_login_at,
  (pp.provider_customer_id is not null) as has_payment_method,
  bp.business_name
from public.subscriptions s
join public.tenants t on t.id = s.tenant_id
join public.plans p on p.id = s.plan_id
left join lateral (
  select u.email, u.name, u.last_login_at
    from public.tenant_users tu
    join public.users u on u.id = tu.user_id
   where tu.tenant_id = s.tenant_id and tu.role = 'owner'
   limit 1
) owner_user on true
left join public.payment_providers pp on pp.tenant_id = s.tenant_id and pp.is_default
left join public.business_profiles bp on bp.tenant_id = s.tenant_id
where s.status = 'trialing'
  and s.trial_ends_at is not null;

revoke all on public.admin_trials_in_flight from tenant_app, anon, authenticated;
