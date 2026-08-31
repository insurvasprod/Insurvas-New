-- SA-4.11 · The delivery log.
--
-- Built before the settings table and the template editor on purpose: right now a failed email is
-- completely invisible — every seam either console.logs or returns delivered:false and the reason
-- is lost. One row per attempt makes "did the customer get it, and if not why" answerable, which
-- is the question that actually gets asked.

create type public.email_status as enum ('sent', 'failed', 'skipped');

create table public.email_log (
  id                  uuid primary key default gen_random_uuid(),
  ts                  timestamptz not null default now(),
  to_address          text not null,
  template_key        text not null,
  subject             text not null,
  status              public.email_status not null,
  provider            text not null default 'smtp',
  provider_message_id text,
  -- Why it did not go. 'email_not_configured' when no SMTP credentials are set, otherwise the
  -- provider's own complaint, trimmed.
  failure_reason      text,
  -- Ties a send back to the thing that caused it, so a support question about one user's
  -- invitation does not require a text search of the log.
  tenant_id           uuid references public.tenants(id) on delete set null,
  user_id             uuid references public.users(id) on delete set null,
  -- The idempotency key the caller used, when it had one. Lets a retry be recognised as a retry.
  dedupe_key          text
);

comment on table public.email_log is
  'One row per outbound email attempt, including the ones that did not send. SA-4.11.';

create index email_log_ts_idx on public.email_log (ts desc);
create index email_log_to_idx on public.email_log (to_address, ts desc);
create index email_log_template_idx on public.email_log (template_key, ts desc);
create index email_log_user_idx on public.email_log (user_id, ts desc) where user_id is not null;

-- A partial unique index rather than a plain one: only sends that carry a dedupe key are
-- constrained, and only successful ones. A failed attempt must be allowed to be retried.
create unique index email_log_dedupe_idx
  on public.email_log (dedupe_key)
  where dedupe_key is not null and status = 'sent';

alter table public.email_log enable row level security;

-- The tenant plane has no business reading who was emailed what.
revoke all on public.email_log from tenant_app, anon, authenticated;
grant select, insert on public.email_log to service_role;

-- A delivery record is evidence of what we told someone, in the same way an acceptance record is
-- evidence of what they agreed to. Correct it by sending again, not by editing history.
revoke update, delete, truncate on public.email_log from public, service_role;

/**
 * Deletes log rows older than the retention window.
 *
 * The ticket scopes the log to "last 30 days of sends", so something has to remove the rest. This
 * is that something; it is not called automatically, because a silent nightly delete of delivery
 * evidence should be a scheduled job somebody chose to run, not a trigger nobody can see.
 */
create or replace function public.prune_email_log(p_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if p_days < 1 then raise exception 'retention must be at least one day'; end if;

  delete from public.email_log where ts < now() - make_interval(days => p_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.prune_email_log(integer) from public, anon, authenticated;
grant execute on function public.prune_email_log(integer) to service_role;
