-- AG-1.11 (Notion sprint, Agency Module 0 / AG-1) · the Application Review queue (the honest name for Team QA).
--
-- Named honestly: call recording was declined in LA-6, so there is nothing to listen to. This reviews PAPERWORK —
-- wrong form, missing or implausible field, draft day past 28, payment method mismatch, SS payment date against
-- the birth day, a bank or routing number that failed verification. The screen and the menu node say
-- "Application review" everywhere, never "QA".
--
--   application_review   one row per SAMPLED submitted application. The reviewer reads LA-3's own check results
--                        (lib/applications/mutations.ts qaVerdictForReview — not a single check reimplemented
--                        here) and records pass, fail with a note, or fix-and-resubmit, tagging an error type.
--                        A fix is a NEW application version through LA-3 with an audit row naming the reviewer;
--                        a review never edits an application.
--   agency_review_rate   the sample rate per producer, in basis points; unset = by tenure: 5000 (half) in his
--                        first 90 days, 1000 after. Sampling is deterministic (a hash of the application id below
--                        the rate), so the rate is honoured exactly over many applications and re-running the
--                        sampler never samples twice.
--   The output that matters is the per-producer error-type tally over time — a coachable fact.
--
-- Visible to owner, admin and manager (own reports); a producer sees his own reviews and his own tally.
--
-- Requires 20261018100000 (producer), LA-3 tenant_applications.
--
-- Rollback: drop function agency_review_sample, agency_review_record, agency_review_rate_bps; drop table
--   application_review, agency_review_rate.

create table if not exists public.agency_review_rate (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  producer_user_id uuid not null references public.users(id) on delete cascade,
  sample_bps integer not null,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, producer_user_id),
  constraint agency_review_rate_bps check (sample_bps between 0 and 10000)
);

create table if not exists public.application_review (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  application_id uuid not null references public.tenant_applications(id) on delete cascade,
  producer_user_id uuid not null references public.users(id) on delete restrict,
  sample_bps integer not null,
  sampled_at timestamptz not null default now(),
  status text not null default 'queued',
  error_types text[] not null default '{}',
  note text,
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  constraint application_review_one unique (application_id),
  constraint application_review_status check (status in ('queued', 'passed', 'failed', 'fix_requested')),
  constraint application_review_outcome check (
    (status = 'queued' and reviewed_at is null)
    or (status = 'passed' and reviewed_at is not null)
    or (status in ('failed', 'fix_requested') and reviewed_at is not null and cardinality(error_types) >= 1 and length(btrim(coalesce(note, ''))) between 1 and 1000)),
  constraint application_review_errors check (error_types <@ array['wrong_form', 'missing_field', 'implausible_field', 'draft_day_past_28',
    'payment_mismatch', 'ss_date_mismatch', 'bank_unverified', 'other']::text[])
);
create index if not exists application_review_queue on public.application_review (tenant_id, status, sampled_at);
create index if not exists application_review_producer on public.application_review (tenant_id, producer_user_id, reviewed_at);

revoke all on public.agency_review_rate, public.application_review from public, anon, authenticated;
revoke insert, update, delete, truncate on public.application_review from service_role, tenant_app;
revoke truncate on public.agency_review_rate from service_role, tenant_app;
grant select on public.application_review, public.agency_review_rate to service_role, tenant_app;
grant insert, update, delete on public.agency_review_rate to service_role;
alter table public.application_review enable row level security;
alter table public.agency_review_rate enable row level security;
drop policy if exists application_review_read on public.application_review;
create policy application_review_read on public.application_review for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
drop policy if exists agency_review_rate_read on public.agency_review_rate;
create policy agency_review_rate_read on public.agency_review_rate for select to tenant_app
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
-- AG-0.4: a producer's reviews are his own
drop policy if exists agency_producer_scope on public.application_review;
create policy agency_producer_scope on public.application_review as restrictive for select to tenant_app
  using ((select public.agency_session_visible_user_ids()) is null or producer_user_id = any (coalesce((select public.agency_session_visible_user_ids()), '{}'::uuid[])));

-- The rate for a producer: his own if set, else by tenure (new 5000, proven 1000).
create or replace function public.agency_review_rate_bps(p_tenant_id uuid, p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select r.sample_bps from public.agency_review_rate r where r.tenant_id = p_tenant_id and r.producer_user_id = p_user_id),
    (select case when coalesce(p.hired_on, p.created_at::date) > current_date - 90 then 5000 else 1000 end
       from public.producer p where p.tenant_id = p_tenant_id and p.user_id = p_user_id),
    1000);
$$;

-- Deterministic sampling: an application is sampled when a hash of its id falls below the producer's rate.
create or replace function public.agency_review_sample(p_tenant_id uuid, p_since timestamptz default now() - interval '30 days')
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  if coalesce(public.tenant_plan_audience(p_tenant_id), '') <> 'agency' then return 0; end if;
  insert into public.application_review (tenant_id, application_id, producer_user_id, sample_bps)
  select a.tenant_id, a.id, c.opened_by, public.agency_review_rate_bps(a.tenant_id, c.opened_by)
    from public.tenant_applications a
    join public.tenant_application_cases c on c.id = a.case_id
   where a.tenant_id = p_tenant_id and a.submitted_at is not null and a.submitted_at >= p_since and c.opened_by is not null
     and (abs(hashtextextended(a.id::text, 0)) % 10000) < public.agency_review_rate_bps(a.tenant_id, c.opened_by)
  on conflict on constraint application_review_one do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.agency_review_record(p_tenant_id uuid, p_review_id uuid, p_status text, p_error_types text[], p_note text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('passed', 'failed', 'fix_requested') then raise exception 'review_status_unknown' using errcode = 'P0001'; end if;
  update public.application_review
     set status = p_status, error_types = case when p_status = 'passed' then '{}' else coalesce(p_error_types, '{}') end,
         note = nullif(btrim(coalesce(p_note, '')), ''), reviewed_by = p_actor, reviewed_at = now()
   where tenant_id = p_tenant_id and id = p_review_id and status = 'queued';
  if not found then raise exception 'review_not_queued' using errcode = 'P0001'; end if;
end;
$$;
revoke all on function public.agency_review_rate_bps(uuid, uuid), public.agency_review_sample(uuid, timestamptz), public.agency_review_record(uuid, uuid, text, text[], text, uuid) from public, anon, authenticated;
grant execute on function public.agency_review_rate_bps(uuid, uuid), public.agency_review_sample(uuid, timestamptz), public.agency_review_record(uuid, uuid, text, text[], text, uuid) to service_role;
